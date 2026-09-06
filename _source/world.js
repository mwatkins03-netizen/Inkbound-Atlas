/* Deterministic geography and collision layout; coordinates are independent of camera zoom. */
(function(root){
const W=1600,H=1100;
function random(s){return()=>{s|=0;s=s+0x6D2B79F5|0;let t=Math.imul(s^s>>>15,1|s);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
function inside(poly,x,y){let c=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){let a=poly[i],b=poly[j];if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])c=!c}return c}
function overlap(a,b,pad=3){return a.x<b.x+b.w+pad&&a.x+a.w+pad>b.x&&a.y<b.y+b.h+pad&&a.y+a.h+pad>b.y}
function fractal(base,rng,rounds=5,rough=13){let pts=base;for(let n=0;n<rounds;n++){let out=[];for(let i=0;i<pts.length;i++){let a=pts[i],b=pts[(i+1)%pts.length],dx=b[0]-a[0],dy=b[1]-a[1],l=Math.hypot(dx,dy);let d=(rng()-.5)*Math.min(l*.65,rough*Math.pow(.56,n));out.push(a,[(a[0]+b[0])/2-dy/l*d,(a[1]+b[1])/2+dx/l*d])}pts=out}return pts}
function ridge(x){return 310+90*Math.sin((x-250)/230)+28*Math.sin(x/80)}
function riverX(y){return 850+Math.sin(y/105)*48+(y-430)*.32}
const regionDefs=[{name:'THE GLASS CROWN',x:920,y:183,w:240,color:'#749da6',biome:'glacier'}, {name:'THE VERDANT DEEP',x:428,y:572,w:246,color:'#698254',biome:'forest'}, {name:'THE SUNDERED VALE',x:1115,y:628,w:255,color:'#b77953',biome:'canyon'}, {name:'THE GOLDEN EXPANSE',x:724,y:853,w:270,color:'#ba9a4c',biome:'plains'}];
function create(seed,kind,detail){const rng=random(seed),base=[[122,440],[180,322],[167,231],[274,166],[363,188],[418,108],[541,102],[607,162],[731,119],[800,95],[899,126],[1004,93],[1146,139],[1208,220],[1340,205],[1453,310],[1410,388],[1466,457],[1381,525],[1438,632],[1356,726],[1401,796],[1312,903],[1196,948],[1112,916],[1050,1001],[897,987],[813,930],[743,982],[632,947],[577,895],[490,930],[398,854],[283,824],[314,744],[220,722],[197,643],[130,597],[171,518]];let coasts=[];
if(kind==='islands'){for(let k=0;k<7;k++){let cx=320+(k%3)*440,cy=240+Math.floor(k/3)*300;coasts.push(fractal(Array.from({length:18},(_,i)=>{let a=i/18*Math.PI*2,r=.8+rng()*.3;return[cx+Math.cos(a)*170*r,cy+Math.sin(a)*125*r]}),rng,5,22))}}else{coasts.push(fractal(base.map(([x,y])=>[x+(rng()-.5)*22,y+(rng()-.5)*20]),rng,6,45));for(let j=0;j<16;j++){let x=95+rng()*1400,y=65+rng()*930;if(coasts.some(p=>inside(p,x,y)))continue;coasts.push(fractal(Array.from({length:8},(_,i)=>{let a=i/8*Math.PI*2;return[x+Math.cos(a)*(4+rng()*9),y+Math.sin(a)*(4+rng()*9)]}),rng,3,3))}}
const onLand=(x,y)=>coasts.some(p=>inside(p,x,y));
const fits=b=>{for(let xx of [b.x,b.x+b.w/2,b.x+b.w])for(let yy of [b.y,b.y+b.h/2,b.y+b.h])if(!onLand(xx,yy))return false;return true};
const labels=regionDefs.map(r=>({...r,bounds:{x:r.x-r.w/2,y:r.y-17,w:r.w,h:28}})).filter(r=>fits(r.bounds));
let occupied=labels.map(r=>r.bounds),features=[];
function add(f,b){if(!fits(b)||occupied.some(a=>overlap(a,b,3)))return false;f.bounds=b;features.push(f);occupied.push(b);return true}
const towns=[['Highwatch',540,470],['Dunmere',756,700],['Ravenhold',1184,432],['Saltkeep',340,700],['Ashen Gate',1192,822]];
for(let [name,x,y] of towns){for(let j=0;j<35;j++){let xx=x+(rng()-.5)*50,yy=y+(rng()-.5)*50,s=19;let b={x:xx-53,y:yy-29,w:106,h:54};if(add({x:xx,y:yy,type:'castle',s,v:rng(),name},b))break}}
let candidates=[];const step=[31,25,20][detail-1]||20;
for(let y=120;y<1000;y+=step)for(let x=140;x<1450;x+=step){let xx=x+(rng()-.5)*13,yy=y+(rng()-.5)*13;if(!onLand(xx,yy))continue;let mt=Math.abs(yy-ridge(xx));let type,s;
if(mt<44&&xx>260&&xx<1210){type=mt<18?'peak':'mountain';s=type==='peak'?28+rng()*15:18+rng()*13}
else if(yy<270&&xx>680&&xx<1190){type='glacier';s=16+rng()*12}
else if(xx>970&&yy>535&&yy<810){type='mesa';s=14+rng()*15}
else if(xx<640&&yy>430&&yy<800){type=kind==='desert'?'dune':'tree';s=type==='tree'?9+rng()*5:12+rng()*7}
else if(xx>620&&xx<1000&&yy>510){type=kind==='desert'?'dune':'grass';s=8+rng()*5}
else if(xx>1200&&yy<510){type='volcano';s=24+rng()*10}
else if(rng()<.30){type='hill';s=10+rng()*9}else continue;
if(Math.abs(xx-riverX(yy))<25&&yy>415)continue;
if(Math.abs(xx-(1070+Math.sin(yy/62)*48))<78&&yy>550&&yy<815)continue;
const width={tree:s*.9,grass:10,dune:s*2,hill:s*2,mesa:s*1.8,volcano:s*1.5,peak:s*1.65,mountain:s*1.65,glacier:s*1.5}[type];let b={x:xx-width/2-2,y:yy-s*1.05-2,w:width+4,h:s*1.5+4};candidates.push({f:{x:xx,y:yy,type,s,v:rng()},b,priority:['peak','volcano'].includes(type)?0:['mountain','glacier','mesa'].includes(type)?1:2})}
candidates.sort((a,b)=>a.priority-b.priority||a.f.v-b.f.v);for(let {f,b} of candidates)add(f,b);features.sort((a,b)=>a.y-b.y);features.forEach(f=>{f.birth=f.type==='castle'?.86:['peak','mountain','glacier','volcano'].includes(f.type)?.18+f.x/W*.16:f.type==='tree'?.38+f.y/H*.1:f.type==='mesa'?.56+f.y/H*.08:.70+f.x/W*.07});return{coasts,features,labels,onLand,fits,ridge,riverX,seed,kind};}
root.WorldEngine={create,inside,overlap,random};if(typeof module!=='undefined')module.exports=root.WorldEngine;
})(typeof window!=='undefined'?window:globalThis);
