/* Inkbound terrain model. range() adapts Azgaar's MIT-licensed addRange
   frontier propagation to a regular, longitude-wrapped grid.
   Copyright 2017-2024 Max Haniyeu (Azgaar). See licenses/azgaar-MIT.txt.
   Other generation/rendering code is original. Lutz's DEM visualization
   methodology is a reference; no GPL notebook code or artwork is included. */
(function(root){
const TAU=2*Math.PI,clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function rng(seed){return()=>{seed|=0;seed=seed+0x6d2b79f5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
function create(seed,coasts=[],options={}){const w=1024,h=512,n=w*h,random=rng(seed),mask=new Uint8Array(n),heights=new Float32Array(n);const rugged=Number(options.rugged||1);
const xy=(lon,lat)=>[(lon/TAU+.5)*w,(.5-lat/Math.PI)*h],mapPoint=(x,y)=>xy((x/1600-.5)*2.7-.25,(.5-y/1100)*2);
function polygon(points){let ys=points.map(p=>p[1]);for(let y=Math.max(1,Math.floor(Math.min(...ys)));y<Math.min(h-1,Math.ceil(Math.max(...ys)));y++){let xs=[];for(let i=0,j=points.length-1;i<points.length;j=i++){let a=points[i],b=points[j];if((a[1]>y+.5)!==(b[1]>y+.5))xs.push(a[0]+(y+.5-a[1])*(b[0]-a[0])/(b[1]-a[1]))}xs.sort((a,b)=>a-b);for(let k=0;k+1<xs.length;k+=2)for(let x=Math.ceil(xs[k]);x<xs[k+1];x++)mask[y*w+(x+w)%w]=1}}
coasts.forEach(p=>polygon(p.map(([x,y])=>mapPoint(x,y))));
for(let [cx,cy,rx,ry] of [[2.35,.0,.63,.99],[-2.6,-.22,.42,.61]]){let phase=random()*6;polygon(Array.from({length:260},(_,i)=>{let a=i/260*TAU,r=1+.14*Math.sin(a*3+phase)+.07*Math.sin(a*11)+.045*Math.sin(a*29);return xy(cx+Math.cos(a)*rx*r,cy+Math.sin(a)*ry*r)}))}
const hash=(x,y)=>{let t=Math.imul(x+seed,374761393)^Math.imul(y,668265263);t=Math.imul(t^t>>>13,1274126177);return((t^t>>>16)>>>0)/4294967295};
function noise(x,y){let ix=Math.floor(x),iy=Math.floor(y),u=x-ix,v=y-iy;u=u*u*(3-2*u);v=v*v*(3-2*v);let a=hash(ix,iy),b=hash(ix+1,iy),c=hash(ix,iy+1),d=hash(ix+1,iy+1);return(a+(b-a)*u)*(1-v)+(c+(d-c)*u)*v}
for(let i=0;i<n;i++){let x=i%w,y=Math.floor(i/w);heights[i]=mask[i]?23+noise(x/65,y/65)*9+noise(x/11,y/11)*3:8+noise(x/35,y/35)*7}
const neighbors=i=>{const x=i%w,y=(i-x)/w;let a=[y*w+(x+w-1)%w,y*w+(x+1)%w];if(y>0)a.push(i-w);if(y<h-1)a.push(i+w);return a};
function index(p){return clamp(Math.floor(p[1]),1,h-2)*w+((Math.floor(p[0])+w)%w)}
function range(start,end,height,sign=1){let cur=index(start),goal=index(end),used=new Uint8Array(n),ridge=[cur];used[cur]=1;for(let iter=0;cur!==goal&&iter<1300;iter++){let best=-1,min=Infinity,gx=goal%w,gy=Math.floor(goal/w);for(let e of neighbors(cur)){if(used[e]||!mask[e])continue;let dx=Math.abs(gx-e%w);dx=Math.min(dx,w-dx);let diff=dx*dx+Math.pow(gy-Math.floor(e/w),2);if(random()>.85)diff/=2;if(diff<min){min=diff;best=e}}if(best<0)break;cur=best;used[cur]=1;ridge.push(cur)}
// Adapted from HeightmapModule.addRange: propagate height in successive frontiers.
let queue=ridge.slice(),amplitude=height;while(queue.length&&amplitude>=2){const frontier=queue;queue=[];for(let i of frontier)if(mask[i])heights[i]=clamp(heights[i]+sign*amplitude*(random()*.3+.85),20.5,98);amplitude=Math.pow(amplitude,.84)-1;for(let f of frontier)for(let i of neighbors(f))if(!used[i]&&mask[i]){queue.push(i);used[i]=1}}
}
for(let [a,b,c,d,e] of [[270,320,1180,310,48],[400,400,680,590,24],[920,410,1120,470,32],[300,710,650,800,21],[1100,620,1250,850,37]])range(mapPoint(a,b),mapPoint(c,d),e*rugged);
range(mapPoint(1070,560),mapPoint(1110,840),28,-1);range(xy(2,.4),xy(2.6,-.45),44*rugged);range(xy(-2.7,.1),xy(-2.5,-.7),33*rugged);
// Small drainage-scale variation, then conservative smoothing without moving coastlines.
let smooth=heights.slice();for(let i=0;i<n;i++)if(mask[i]){let ns=neighbors(i).filter(j=>mask[j]);smooth[i]=ns.length?heights[i]*.72+ns.reduce((a,j)=>a+heights[j],0)/ns.length*.28:heights[i]}heights.set(smooth);
// Priority flood assigns a drainage parent and fills internal depressions only for routing.
const downstream=new Int32Array(n).fill(-1),seen=new Uint8Array(n),level=heights.slice(),order=[],heap=[];
function push(i){let k=heap.length;heap.push(i);while(k){let p=(k-1)>>1;if(level[heap[p]]<=level[i])break;heap[k]=heap[p];k=p}heap[k]=i}
function pop(){const out=heap[0],last=heap.pop();if(heap.length){let k=0;heap[0]=last;while(k*2+1<heap.length){let c=k*2+1;if(c+1<heap.length&&level[heap[c+1]]<level[heap[c]])c++;if(level[last]<=level[heap[c]])break;heap[k]=heap[c];k=c}heap[k]=last}return out}
for(let i=0;i<n;i++)if(mask[i]){let sea=neighbors(i).find(j=>!mask[j]);if(sea!==undefined){seen[i]=1;downstream[i]=sea;push(i)}}
while(heap.length){let i=pop();order.push(i);for(let j of neighbors(i))if(mask[j]&&!seen[j]){seen[j]=1;downstream[j]=i;level[j]=Math.max(heights[j],level[i]+.0001);push(j)}}
const flow=new Float32Array(n);for(let i=order.length-1;i>=0;i--){let cell=order[i];flow[cell]+=1;let to=downstream[cell];if(to>=0)flow[to]+=flow[cell]}
const texture=new Uint8Array(n*4);let riverCells=0;
for(let i=0;i<n;i++){let x=i%w,y=Math.floor(i/w),east=y*w+(x+1)%w,west=y*w+(x+w-1)%w,north=Math.max(0,i-w),south=Math.min(n-1,i+w);let dx=mask[east]&&mask[west]?(heights[east]-heights[west])*.30:0,dy=mask[north]&&mask[south]?(heights[south]-heights[north])*.30:0;let shade=clamp((1-dx*.5-dy*.6)/Math.sqrt(1+dx*dx+dy*dy),0,1);let river=mask[i]&&flow[i]>75;let latitude=.5-y/h,biome=!mask[i]?0:Math.abs(latitude)>.29||heights[i]>78?5:heights[i]>47?4:x/w>.49&&x/w<.58?3:y/h>.56?2:1;texture[i*4]=Math.round(heights[i]*2.55);texture[i*4+1]=Math.round(shade*255);texture[i*4+2]=river?Math.min(255,130+Math.log(flow[i])*10):0;texture[i*4+3]=biome*42;if(river)riverCells++}
function sample(lon,lat){let x=((lon/TAU+.5)*w%w+w)%w,y=clamp((.5-lat/Math.PI)*h,0,h-1),ix=Math.floor(x),iy=Math.floor(y),u=x-ix,v=y-iy;let ids=[iy*w+ix,iy*w+(ix+1)%w,Math.min(h-1,iy+1)*w+ix,Math.min(h-1,iy+1)*w+(ix+1)%w],h0=heights[ids[0]]*(1-u)+heights[ids[1]]*u,h1=heights[ids[2]]*(1-u)+heights[ids[3]]*u,value=h0*(1-v)+h1*v,land=value>=20;return{land,h:land?(value-20)/80*.008:0,elevation:value,biome:land?(['plains','forest','plains','canyon','mountain','ice'][Math.round(texture[ids[0]*4+3]/42)]||'plains'):'sea',river:flow[ids[0]]>75}}
return{width:w,height:h,heights,mask,downstream,level,flow,texture,sample,mapPoint,stats:{riverCells,landCells:order.length,maxRelief:.008}};
}
root.TerrainAtlas={create};if(typeof module!=='undefined')module.exports=root.TerrainAtlas;
})(typeof window!=='undefined'?window:globalThis);
