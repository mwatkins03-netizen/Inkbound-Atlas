/* Inkbound — whole-sphere world + 18th-century engraved globe gores.
   Builds a 1024×512 longitude-wrapped world around the atlas continent (which sits in its window of the
   sphere exactly as terrain.js places it), then paints a 4096×2048 equirectangular "engraving" in the manner
   of a c. 1750 terrestrial globe: hand-coloured coasts, stippled seas, Lehmann hachures, copperplate italics,
   graticule with Latin circles, ecliptic with zodiac, rhumb lines, ships, sea monsters, a rocaille cartouche
   and Terra Incognita for continents no ship from the known world has reached.
   Also returns a birth map so the globe can be revealed ink-stroke by ink-stroke in the film. */
(function(root){
'use strict';
const TAU=Math.PI*2,GW=1024,GH=512,N=GW*GH,S=4,TW=GW*S,TH=GH*S;
const clamp=(v,a,b)=>v<a?a:v>b?b:v,lerp=(a,b,t)=>a+(b-a)*t,ss=(a,b,x)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t)};
const SERIF='"Cormorant Garamond","Cormorant",Georgia,"Times New Roman",serif';
const D8=[[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
const wrapX=x=>(x%GW+GW)%GW;
const idx=(x,y)=>y*GW+wrapX(x);

/* ---- seeded 3D gradient noise (seamless on the sphere) ---- */
function noise3(seed){const r=root.Atlas.rng(seed),perm=new Uint16Array(512),p=Array.from({length:256},(_,i)=>i);for(let i=255;i>0;i--){const j=Math.floor(r()*(i+1));const t=p[i];p[i]=p[j];p[j]=t}for(let i=0;i<512;i++)perm[i]=p[i&255];
  const G=[[1,1,0],[-1,1,0],[1,-1,0],[-1,-1,0],[1,0,1],[-1,0,1],[1,0,-1],[-1,0,-1],[0,1,1],[0,-1,1],[0,1,-1],[0,-1,-1]];const fade=t=>t*t*t*(t*(t*6-15)+10);
  function n(x,y,z){const X=Math.floor(x),Y=Math.floor(y),Z=Math.floor(z),fx=x-X,fy=y-Y,fz=z-Z,u=fade(fx),v=fade(fy),w=fade(fz),xi=X&255,yi=Y&255,zi=Z&255;
    const g=(i,j,k,dx,dy,dz)=>{const h=perm[perm[perm[xi+i]+yi+j]+zi+k]%12;const q=G[h];return q[0]*dx+q[1]*dy+q[2]*dz};
    const a=lerp(g(0,0,0,fx,fy,fz),g(1,0,0,fx-1,fy,fz),u),b=lerp(g(0,1,0,fx,fy-1,fz),g(1,1,0,fx-1,fy-1,fz),u),c=lerp(g(0,0,1,fx,fy,fz-1),g(1,0,1,fx-1,fy,fz-1),u),d=lerp(g(0,1,1,fx,fy-1,fz-1),g(1,1,1,fx-1,fy-1,fz-1),u);
    return lerp(lerp(a,b,v),lerp(c,d,v),w)}
  const fbm=(x,y,z,oct=5,gain=.5)=>{let s=0,a=1,f=1,norm=0;for(let i=0;i<oct;i++){s+=n(x*f,y*f,z*f)*a;norm+=a;a*=gain;f*=2.02}return s/norm};
  const ridged=(x,y,z,oct=4)=>{let s=0,a=.55,f=1,w=1;for(let i=0;i<oct;i++){let v=1-Math.abs(n(x*f,y*f,z*f));v=v*v*w;w=clamp(v*2,0,1);s+=v*a;a*=.5;f*=2.05}return s};
  return{n,fbm,ridged}}

/* ---- wrap-aware helpers ---- */
function chamferWrap(src){const d=new Float32Array(N).fill(1e9);for(let i=0;i<N;i++)if(src[i])d[i]=0;
  const relax=(i,j,c)=>{const v=d[j]+c;if(v<d[i])d[i]=v};
  for(let pass=0;pass<2;pass++){
    for(let y=0;y<GH;y++)for(let x=0;x<GW;x++){const i=y*GW+x;relax(i,idx(x-1,y),3);if(y>0){relax(i,idx(x,y-1),3);relax(i,idx(x-1,y-1),4);relax(i,idx(x+1,y-1),4)}}
    for(let y=GH-1;y>=0;y--)for(let x=GW-1;x>=0;x--){const i=y*GW+x;relax(i,idx(x+1,y),3);if(y<GH-1){relax(i,idx(x,y+1),3);relax(i,idx(x+1,y+1),4);relax(i,idx(x-1,y+1),4)}}}
  for(let i=0;i<N;i++)d[i]/=3;return d}
function clustersWrap(pred,minSize){const seen=new Uint8Array(N),out=[],stack=[];for(let i=0;i<N;i++){if(seen[i]||!pred(i))continue;const cells=[];stack.push(i);seen[i]=1;while(stack.length){const c=stack.pop();cells.push(c);const x=c%GW,y=(c-x)/GW;for(const [dx,dy] of D8){const ny=y+dy;if(ny<0||ny>=GH)continue;const j=idx(x+dx,ny);if(!seen[j]&&pred(j)){seen[j]=1;stack.push(j)}}}if(cells.length>=minSize)out.push(cells)}return out.sort((a,b)=>b.length-a.length)}
function blurWrap(f,passes){let a=f,b=new Float32Array(N);for(let p=0;p<passes;p++){for(let y=0;y<GH;y++)for(let x=0;x<GW;x++){let s=0,c=0;for(let dy=-1;dy<=1;dy++){const yy=y+dy;if(yy<0||yy>=GH)continue;for(let dx=-1;dx<=1;dx++){s+=a[idx(x+dx,yy)];c++}}b[y*GW+x]=s/c}const t=a;a=b;b=t}return a}
/* marching squares in texture px (cells wrap at the seam; lines simply end there) */
function isolines(field,level){const segs=[],adj=new Map(),HK=(x,y)=>y*GW+x,VK=(x,y)=>N+y*GW+x,P=(x,y)=>[(x+.5)*S,(y+.5)*S];
  const add=(k1,p1,k2,p2)=>{const s=segs.length;segs.push([k1,p1,k2,p2]);(adj.get(k1)||adj.set(k1,[]).get(k1)).push(s);(adj.get(k2)||adj.set(k2,[]).get(k2)).push(s)};
  for(let y=0;y<GH-1;y++)for(let x=0;x<GW-1;x++){const a=field[y*GW+x],b=field[y*GW+x+1],c=field[(y+1)*GW+x+1],d=field[(y+1)*GW+x];const id=(a>=level?8:0)|(b>=level?4:0)|(c>=level?2:0)|(d>=level?1:0);if(id===0||id===15)continue;
    const T=()=>[HK(x,y),P(x+(level-a)/(b-a),y)],R=()=>[VK(x+1,y),P(x+1,y+(level-b)/(c-b))],B=()=>[HK(x,y+1),P(x+(level-d)/(c-d),y+1)],L=()=>[VK(x,y),P(x,y+(level-a)/(d-a))];const J=(e1,e2)=>{const [k1,p1]=e1(),[k2,p2]=e2();add(k1,p1,k2,p2)};
    switch(id){case 1:J(L,B);break;case 2:J(B,R);break;case 3:J(L,R);break;case 4:J(T,R);break;case 5:if((a+b+c+d)/4>=level){J(T,L);J(B,R)}else{J(T,R);J(L,B)}break;case 6:J(T,B);break;case 7:J(T,L);break;case 8:J(T,L);break;case 9:J(T,B);break;case 10:if((a+b+c+d)/4>=level){J(T,R);J(L,B)}else{J(T,L);J(B,R)}break;case 11:J(T,R);break;case 12:J(L,R);break;case 13:J(B,R);break;case 14:J(L,B);break}}
  const used=new Uint8Array(segs.length),lines=[];const next=(key,self)=>{const l=adj.get(key);if(!l)return -1;for(const s of l)if(s!==self&&!used[s])return s;return -1};
  for(let s=0;s<segs.length;s++){if(used[s])continue;used[s]=1;const sg=segs[s];let pts=[sg[1],sg[3]],hk=sg[0],tk=sg[2],cur=s,closed=false;
    for(;;){const n=next(tk,cur);if(n<0)break;used[n]=1;const g=segs[n];if(g[0]===tk){pts.push(g[3]);tk=g[2]}else{pts.push(g[1]);tk=g[0]}cur=n;if(tk===hk){closed=true;break}}
    if(!closed){cur=s;for(;;){const n=next(hk,cur);if(n<0)break;used[n]=1;const g=segs[n];if(g[2]===hk){pts.unshift(g[1]);hk=g[0]}else{pts.unshift(g[3]);hk=g[2]}cur=n}}
    pts.closed=closed;lines.push(pts)}return lines}
function Heap(key){const a=[];return{get size(){return a.length},push(i){let k=a.length;a.push(i);while(k){const p=(k-1)>>1;if(key[a[p]]<=key[i])break;a[k]=a[p];k=p}a[k]=i},pop(){const top=a[0],last=a.pop();if(a.length){let k=0;a[0]=last;for(;;){let c=k*2+1;if(c>=a.length)break;if(c+1<a.length&&key[a[c+1]]<key[a[c]])c++;if(key[last]<=key[a[c]])break;a[k]=a[c];k=c}a[k]=last}return top}}}
const lonOf=x=>(x+.5)/GW*TAU-Math.PI,latOf=y=>Math.PI/2-(y+.5)/GH*Math.PI;
const angDist=(l1,b1,l2,b2)=>Math.acos(clamp(Math.sin(b1)*Math.sin(b2)+Math.cos(b1)*Math.cos(b2)*Math.cos(l1-l2),-1,1));

/* ================= WORLD ================= */
function buildWorld(atlas,opts={}){
  const seed=(atlas.seed>>>0)||1,R=root.Atlas.rng(seed^0x77aa11),NZ=noise3(seed^0x3141),NB=noise3(seed*3+7),names=atlas.names;
  const t0=performance.now();
  // 1. landness on the sphere; the atlas window overrides
  const mask=new Uint8Array(N),h=new Float32Array(N),inWin=new Uint8Array(N),land=new Float32Array(N);
  const off=[R()*10,R()*10,R()*10];
  const ATLAS_LON=-.25,ATLAS_LAT=0;
  for(let y=0;y<GH;y++){const lat=latOf(y),cl=Math.cos(lat),sl=Math.sin(lat);for(let x=0;x<GW;x++){const lon=lonOf(x),px=cl*Math.cos(lon),py=cl*Math.sin(lon),pz=sl;const i=y*GW+x;
    let v=NZ.fbm(px*1.6+off[0],py*1.6+off[1],pz*1.6+off[2],5,.52)*1.0+NZ.fbm(px*3.6+off[2],py*3.6,pz*3.6+off[0],4)*.42;
    v+=ss(-1.05,-1.35,lat)*1.3;                      // Terra Australis
    v-=ss(1.2,1.45,lat)*.8;                          // open northern sea
    const dA=angDist(lon,lat,ATLAS_LON,ATLAS_LAT);v-=(1-ss(1.35,1.75,dA))*1.6;   // sea moat around the atlas window
    land[i]=v}}
  const sample=[];for(let i=0;i<N;i+=7)sample.push(land[i]);sample.sort((a,b)=>b-a);const thr=sample[Math.floor(sample.length*.30)];
  for(let i=0;i<N;i++)mask[i]=land[i]>thr?1:0;
  // atlas window: lon=(x/1600-.5)*2.7-.25, lat=(.5-y/1100)*2
  for(let y=0;y<GH;y++){const lat=latOf(y);for(let x=0;x<GW;x++){const lon=lonOf(x);const ax=((lon+.25)/2.7+.5)*1600,ay=(.5-lat/2)*1100;if(ax<0||ay<0||ax>=1600||ay>=1100)continue;const i=y*GW+x;inWin[i]=1;const c=atlas.cellAt(ax,ay);mask[i]=atlas.mask[c]&&!atlas.lakeMask[c]?1:0}}
  for(let x=0;x<GW;x++){mask[x]=0;mask[(GH-1)*GW+x]=0}
  // despeckle
  for(const [val,min] of [[1,40],[0,24]]){const cl=clustersWrap(i=>mask[i]===val,0);for(const c of cl)if(c.length<min)for(const k of c)mask[k]=1-val}
  const sea=new Uint8Array(N);for(let i=0;i<N;i++)sea[i]=1-mask[i];
  const dLand=chamferWrap(sea),dSea=chamferWrap(mask);
  // 2. heights
  for(let y=0;y<GH;y++){const lat=latOf(y),cl=Math.cos(lat),sl=Math.sin(lat);for(let x=0;x<GW;x++){const i=y*GW+x,lon=lonOf(x),px=cl*Math.cos(lon),py=cl*Math.sin(lon),pz=sl;
    if(inWin[i]){const ax=((lon+.25)/2.7+.5)*1600,ay=(.5-lat/2)*1100;h[i]=mask[i]?clamp(atlas.sampleHeight(ax,ay),20.5,98):clamp(atlas.h[atlas.cellAt(ax,ay)],6,19.4);continue}
    if(!mask[i]){h[i]=19.2-Math.min(10.5,dSea[i]*.5)+NZ.n(px*12,py*12,pz*12)*.8;continue}
    let base=21+14*(1-Math.exp(-dLand[i]/18))+NZ.fbm(px*7+1,py*7,pz*7,4)*6;
    const belt=ss(.25,.7,NB.fbm(px*2.4+off[1],py*2.4,pz*2.4+off[2],4)+.5);const r=NZ.ridged(px*9+off[0],py*9,pz*9,4);
    let v=base+belt*(38+18*NB.n(px*3,py*3,pz*3))*(.3+.9*r);if(v>72)v=72+26*(1-Math.exp(-(v-72)/26));h[i]=clamp(v,20.5,98)}}
  // 3. drainage (priority flood, wrap in x)
  const level=Float32Array.from(h),down=new Int32Array(N).fill(-1),seen=new Uint8Array(N),order=[],heap=Heap(level);
  for(let y=1;y<GH-1;y++)for(let x=0;x<GW;x++){const i=y*GW+x;if(!mask[i])continue;for(const [dx,dy] of D8){const j=idx(x+dx,y+dy);if(!mask[j]){seen[i]=1;down[i]=j;heap.push(i);break}}}
  while(heap.size){const i=heap.pop();order.push(i);const x=i%GW,y=(i-x)/GW;for(const [dx,dy] of D8){const ny=y+dy;if(ny<1||ny>=GH-1)continue;const j=idx(x+dx,ny);if(!mask[j]||seen[j])continue;seen[j]=1;down[j]=i;level[j]=Math.max(h[j],level[i]+.002);heap.push(j)}}
  const flow=new Float32Array(N);for(let k=order.length-1;k>=0;k--){const i=order[k];flow[i]+=1;const j=down[i];if(j>=0&&mask[j])flow[j]+=flow[i]}
  let landCount=0;for(let i=0;i<N;i++)landCount+=mask[i];const thrFlow=Math.max(90,landCount/900);
  const isRiver=new Uint8Array(N);for(let i=0;i<N;i++)if(mask[i]&&flow[i]>=thrFlow&&!inWin[i])isRiver[i]=1;
  // atlas rivers come from the atlas itself (denser, already curated)
  // 4. explored vs incognita per continent
  const continents=clustersWrap(i=>mask[i]===1,60);const contOf=new Int32Array(N).fill(-1);const contInfo=[];
  continents.forEach((cells,k)=>{let minD=9,sumx=0,sumy=0,hasWin=false;for(const c of cells){contOf[c]=k;const x=c%GW,y=(c-x)/GW;if(inWin[c])hasWin=true;const d=angDist(lonOf(x),latOf(y),ATLAS_LON,ATLAS_LAT);if(d<minD)minD=d;sumy+=y}
    const southern=cells.some(c=>(c/GW|0)>GH*.86);const known=hasWin||(minD<1.45&&!southern);const partly=!known&&minD<2.3&&!southern;contInfo.push({cells,known,partly,southern,size:cells.length,minD,hasWin})});
  // 5. climate for glyphs
  const moisture=new Float32Array(N),temp=new Float32Array(N),biome=new Uint8Array(N);const dRiver=chamferWrap(isRiver);
  for(let y=0;y<GH;y++){const lat=latOf(y),cl=Math.cos(lat),sl=Math.sin(lat);for(let x=0;x<GW;x++){const i=y*GW+x;if(!mask[i])continue;const lon=lonOf(x);const m=.5+.5*NB.fbm(cl*Math.cos(lon)*3+4,cl*Math.sin(lon)*3,sl*3,4)+.3*Math.exp(-dRiver[i]/4)+.15*Math.exp(-dLand[i]/14)-(h[i]-20)/80*.4;const t=1-Math.abs(lat)/1.35-(h[i]-20)/80*.9;moisture[i]=m;temp[i]=t;
    biome[i]=h[i]>=86||t<.08?5:h[i]>=60?4:(m>.62&&t>.25)?2:(m<.28&&t>.6)?6:1}}
  // 6. towns on known continents (outside the atlas window — the atlas has its own)
  const towns=[];{const score=new Float32Array(N);for(let y=8;y<GH-8;y++)for(let x=0;x<GW;x++){const i=y*GW+x;const k=contOf[i];if(k<0||!contInfo[k].known||inWin[i]||h[i]>46)continue;let s=.2+moisture[i]*.5;if(isRiver[i]){s+=1.1;if(!mask[down[i]])s+=2.4}if(dLand[i]<=2.5)s+=1.3;if(biome[i]===6)s-=.6;score[i]=s+R()*.2}
    const cand=[];for(let i=0;i<N;i++)if(score[i]>1.1)cand.push(i);cand.sort((a,b)=>score[b]-score[a]);for(const i of cand){if(towns.length>=22)break;const x=i%GW,y=(i-x)/GW;if(towns.some(t=>Math.hypot(Math.min(Math.abs(t.x-x),GW-Math.abs(t.x-x)),t.y-y)<26))continue;towns.push({x,y,port:dLand[i]<=2.5,name:names.town(temp[i]<.4?'hard':'soft'),major:towns.length<6})}}
  const stats={landCount,continents:continents.length,known:contInfo.filter(c=>c.known).length,towns:towns.length,ms:Math.round(performance.now()-t0)};
  return{seed,mask,h,dLand,dSea,flow,down,isRiver,thrFlow,inWin,contOf,contInfo,moisture,temp,biome,towns,names,ATLAS_LON,ATLAS_LAT,stats,atlas}}

/* ================= ENGRAVING ================= */
const LATIN={cont:['TERRA {N}','{N}IA','REGNUM {N}','{N}IA MAGNA','NOVA {N}','{N} AUSTRALIS','{N} BOREALIS'],sea:['OCEANUS {N}','MARE {N}','MARE {N}UM','OCEANUS {N}ICUS'],bay:['SINUS {N}','FRETUM {N}','GOLFO DI {N}'],range:['MONTES {N}','{N} MONS','ALPES {N}AE'],forest:['SYLVA {N}','{N} SALTUS'],desert:['DESERTUM {N}','SOLITUDO {N}'],island:['INSULA {N}','{N} INSULAE']};
function latinize(type,word,R){const t=LATIN[type][Math.floor(R()*LATIN[type].length)];return t.replace('{N}',word.toUpperCase())}

function paint(world,opts={}){
  const {mask,h,dLand,dSea,flow,isRiver,thrFlow,inWin,contOf,contInfo,biome,temp,towns,names,atlas}=world;const R=root.Atlas.rng(world.seed^0xbeef);const t0=performance.now();
  const pal=opts.palette||{paper:'#e6d7b0',paperLight:'#efe3c4',ink:'#3a2a18',inkSoft:'#6a5539',water:'#4d6572',washes:['#d79a9a','#dccb7d','#a3bd8f','#9bb4c9','#deb07f'],gold:'#a8863f'};
  const cv=document.createElement('canvas');cv.width=TW;cv.height=TH;const g=cv.getContext('2d');g.lineJoin='round';g.lineCap='round';
  const birth=document.createElement('canvas');birth.width=GW;birth.height=GH;const bg=birth.getContext('2d');
  const sx=x=>(x+.5)*S,sy=y=>(y+.5)*S;
  const distA=(x,y)=>angDist(lonOf(x),latOf(y),world.ATLAS_LON,world.ATLAS_LAT)/Math.PI; // 0..1 from the known world
  // --- paper
  g.fillStyle=pal.paper;g.fillRect(0,0,TW,TH);
  {const img=g.createImageData(TW,TH),d=img.data;const base=[0xe6,0xd7,0xb0];for(let y=0;y<TH;y++)for(let x=0;x<TW;x++){const k=(y*TW+x)*4;const gr=((Math.imul(x*73856093^y*19349663,2654435761)>>>0)%1000)/1000-.5;const mot=Math.sin(x*.0021+y*.0034)*Math.sin(x*.0007-y*.0013)*6;d[k]=base[0]+gr*10+mot;d[k+1]=base[1]+gr*10+mot;d[k+2]=base[2]+gr*9+mot*.8;d[k+3]=255}g.putImageData(img,0,0)}
  // foxing
  g.save();for(let k=0;k<180;k++){const x=R()*TW,y=R()*TH,r=4+R()*26;const gr=g.createRadialGradient(x,y,0,x,y,r);gr.addColorStop(0,'rgba(120,85,40,.16)');gr.addColorStop(1,'rgba(120,85,40,0)');g.fillStyle=gr;g.fillRect(x-r,y-r,r*2,r*2)}g.restore();
  // gore seams (12 gores) and polar cap circles at ±70°
  g.save();g.strokeStyle=pal.inkSoft;g.globalAlpha=.10;g.lineWidth=1.5;g.beginPath();for(let k=0;k<12;k++){const x=k/12*TW;g.moveTo(x,0);g.lineTo(x,TH)}g.stroke();g.globalAlpha=.14;g.beginPath();const capY=TH*(20/180);g.moveTo(0,capY);g.lineTo(TW,capY);g.moveTo(0,TH-capY);g.lineTo(TW,TH-capY);g.stroke();g.restore();
  // --- geometry
  const coast=isolines(h,20).map(l=>{const s=root.Atlas.smoothLine(l,1);s.closed=l.closed;return s});
  const landPath=new Path2D();for(const l of coast){l.forEach((p,i)=>i?landPath.lineTo(p[0],p[1]):landPath.moveTo(p[0],p[1]));if(l.closed)landPath.closePath()}
  const seaClip=new Path2D();seaClip.rect(0,0,TW,TH);seaClip.addPath(landPath);
  const dSeaSmooth=blurWrap(dSea,2);const rings=[1.6,3.4,5.8,9,13,18].map(lv=>isolines(dSeaSmooth,lv).filter(l=>l.length>8).map(l=>root.Atlas.smoothLine(l,1)));
  // --- graticule
  g.save();g.strokeStyle=pal.ink;g.lineWidth=1.1;g.globalAlpha=.28;g.beginPath();for(let lon=-180;lon<180;lon+=10){const x=(lon+180)/360*TW;g.moveTo(x,0);g.lineTo(x,TH)}for(let lat=-80;lat<=80;lat+=10){const y=(90-lat)/180*TH;g.moveTo(0,y);g.lineTo(TW,y)}g.stroke();
  g.globalAlpha=.7;g.lineWidth=2.6;g.beginPath();g.moveTo(0,TH/2);g.lineTo(TW,TH/2);g.stroke();
  g.lineWidth=1.8;g.setLineDash([14,7]);g.globalAlpha=.55;g.beginPath();for(const lat of [23.44,-23.44,66.56,-66.56]){const y=(90-lat)/180*TH;g.moveTo(0,y);g.lineTo(TW,y)}g.stroke();g.setLineDash([]);
  // ecliptic with zodiac
  g.globalAlpha=.6;g.lineWidth=2;g.beginPath();for(let k=0;k<=720;k++){const lon=k/720*TAU-Math.PI;const lat=23.44*Math.PI/180*Math.sin(lon+.6);const x=k/720*TW,y=(Math.PI/2-lat)/Math.PI*TH;k?g.lineTo(x,y):g.moveTo(x,y)}g.stroke();
  const zodiac='♈♉♊♋♌♍♎♏♐♑♒♓';const zodiacPts=[];g.font=`600 34px "Apple Symbols","Segoe UI Symbol","Noto Sans Symbols",${SERIF}`;g.textAlign='center';g.textBaseline='middle';g.fillStyle=pal.ink;g.globalAlpha=.75;for(let k=0;k<12;k++){const lon=k/12*TAU-Math.PI+TAU/24;const lat=23.44*Math.PI/180*Math.sin(lon+.6);const x=(lon+Math.PI)/TAU*TW,y=(Math.PI/2-lat)/Math.PI*TH-28;g.fillText(zodiac[k]+'\uFE0E',x,y);zodiacPts.push({x,y})}
  g.restore();
  const reserved=[];// text spans [x0,x1,y0,y1] in texture px that later lettering must avoid
  const seaSpan=(x0,x1,y,margin=4)=>{for(let x=x0;x<=x1;x+=16){const cx=Math.floor(((x%TW)+TW)%TW/S),cy=clamp(Math.floor(y/S),0,GH-1);const i=cy*GW+cx;if(mask[i]||dSea[i]<margin)return false}return true};
  const hits=(x0,x1,y0,y1)=>reserved.some(r=>x0<r[1]&&x1>r[0]&&y0<r[3]&&y1>r[2]);
  // --- sea: coast rings & stipple, rhumb lines from roses
  const roses=[];{const bands=[[-Math.PI,-Math.PI/3],[-Math.PI/3,Math.PI/3],[Math.PI/3,Math.PI]];for(const [a,b] of bands){let best=-1,bi=-1;for(let i=0;i<N;i+=3){const x=i%GW,y=(i-x)/GW;const lon=lonOf(x),lat=latOf(y);if(lon<a||lon>=b||Math.abs(lat)>1.1)continue;const v=dSea[i]-Math.abs(lat)*6;if(!mask[i]&&v>best){best=v;bi=i}}if(bi>=0&&dSea[bi]>22)roses.push({x:sx(bi%GW),y:sy(bi/GW|0)})}}
  g.save();g.clip(seaClip,'evenodd');
  g.strokeStyle=pal.inkSoft;g.globalAlpha=.10;g.lineWidth=1;g.beginPath();for(const r of roses)for(let k=0;k<32;k++){const a=k/32*TAU;g.moveTo(r.x,r.y);g.lineTo(r.x+Math.cos(a)*1500,r.y+Math.sin(a)*1500)}g.stroke();
  g.strokeStyle=pal.ink;rings.forEach((lines,i)=>{g.globalAlpha=.40-i*.055;g.lineWidth=i===0?1.6:1.1;if(i>1)g.setLineDash([6+i*2,4+i*2]);g.beginPath();for(const l of lines){l.forEach((p,k)=>k?g.lineTo(p[0],p[1]):g.moveTo(p[0],p[1]))}g.stroke();g.setLineDash([])});
  // stipple
  g.fillStyle=pal.ink;g.globalAlpha=.35;for(let i=0;i<N;i++){if(mask[i])continue;const d=dSea[i];if(d>14)continue;const p=Math.exp(-d/4.5)*.9;for(let k=0;k<3;k++)if(R()<p){const x=sx(i%GW)+(R()-.5)*S*1.4,y=sy(i/GW|0)+(R()-.5)*S*1.4;g.fillRect(x,y,1.3,1.3)}}
  g.restore();
  // --- land fill + hand-coloured coastal bands (one hue per continent)
  g.save();g.fillStyle=pal.paperLight;g.fill(landPath,'evenodd');g.clip(landPath,'evenodd');
  contInfo.forEach((c,k)=>{if(!c.known&&!c.partly)return;const col=pal.washes[k%pal.washes.length];const m=new Float32Array(N);for(const i of c.cells)m[i]=1;const lines=isolines(blurWrap(m,1),.5);g.strokeStyle=col;g.globalAlpha=.7;g.lineWidth=40;g.beginPath();for(const l of lines){l.forEach((p,i)=>i?g.lineTo(p[0],p[1]):g.moveTo(p[0],p[1]));if(l.closed)g.closePath()}g.stroke();g.globalAlpha=.16;g.fillStyle=col;g.beginPath();for(const l of lines){l.forEach((p,i)=>i?g.lineTo(p[0],p[1]):g.moveTo(p[0],p[1]));if(l.closed)g.closePath()}g.fill('evenodd')});
  // paper grain over land
  g.globalAlpha=.35;g.globalCompositeOperation='multiply';const pt=g.createPattern(root.AtlasRender.paperTexture?root.AtlasRender.paperTexture(root.AtlasRender.PALETTES.parchment):cv,'repeat');g.fillStyle=pt;g.fillRect(0,0,TW,TH);g.globalCompositeOperation='source-over';
  g.restore();
  // --- coastline: known → solid heavy; incognita → dashed where guessed
  g.save();g.lineWidth=2.4;g.strokeStyle=pal.ink;for(const l of coast){if(l.length<3)continue;const c=contOf[idx(Math.floor(l[Math.floor(l.length/2)][0]/S),Math.floor(l[Math.floor(l.length/2)][1]/S))];const info=c>=0?contInfo[c]:null;
    const known=info?info.known:true;g.globalAlpha=known?.95:.75;g.setLineDash(known?[]:(info&&info.partly?[18,10]:[6,12]));g.beginPath();l.forEach((p,i)=>i?g.lineTo(p[0],p[1]):g.moveTo(p[0],p[1]));if(l.closed)g.closePath();g.stroke()}g.setLineDash([]);g.restore();
  // --- hachures (Lehmann): known continents only
  g.save();g.clip(landPath,'evenodd');g.strokeStyle=pal.ink;g.lineCap='round';let strokes=0;
  for(let y=2;y<GH-2;y++)for(let x=0;x<GW;x++){const i=y*GW+x;if(!mask[i])continue;const k=contOf[i];if(k<0||!contInfo[k].known)continue;if(inWin[i]&&atlas.biome[atlas.cellAt(((lonOf(x)+.25)/2.7+.5)*1600,(.5-latOf(y)/2)*1100)]===10)continue;
    const gx=(h[idx(x+1,y)]-h[idx(x-1,y)])*.5,gy=(h[i+GW]-h[i-GW])*.5;const slope=Math.hypot(gx,gy);if(slope<.55)continue;if(R()>Math.min(1,slope/2.2))continue;
    const len=clamp(slope*3.2,4,13),nx=-gx/slope,ny=-gy/slope;const light=clamp((-gx*-.6-gy*-.8)/slope,-1,1);const alpha=.22+.4*(.5-.5*light);
    const px=sx(x)+(R()-.5)*S,py=sy(y)+(R()-.5)*S;g.globalAlpha=alpha;g.lineWidth=.9+slope*.25;g.beginPath();g.moveTo(px-nx*len*.35,py-ny*len*.35);g.lineTo(px+nx*len*.65,py+ny*len*.65);g.stroke();strokes++}
  // summit ticks
  g.globalAlpha=.8;g.lineWidth=1.3;for(let i=0;i<N;i++){if(!mask[i]||h[i]<84)continue;const k=contOf[i];if(k<0||!contInfo[k].known||R()>.35)continue;const x=sx(i%GW),y=sy(i/GW|0);g.beginPath();g.moveTo(x-4,y+3);g.lineTo(x,y-5);g.lineTo(x+4,y+3);g.stroke()}
  g.restore();
  // --- forests: tiny engraved tree clumps
  g.save();g.clip(landPath,'evenodd');g.strokeStyle=pal.ink;g.fillStyle=pal.ink;let trees=0;
  for(let y=2;y<GH-2;y+=1)for(let x=0;x<GW;x+=1){const i=y*GW+x;if(!mask[i])continue;const k=contOf[i];if(k<0||!contInfo[k].known)continue;let forest=biome[i]===2;if(inWin[i]){const ax=((lonOf(x)+.25)/2.7+.5)*1600,ay=(.5-latOf(y)/2)*1100;forest=atlas.biome[atlas.cellAt(ax,ay)]===2}let dune=biome[i]===6;if(inWin[i]){const ax=((lonOf(x)+.25)/2.7+.5)*1600,ay=(.5-latOf(y)/2)*1100;dune=atlas.biome[atlas.cellAt(ax,ay)]===6}
    if(dune&&R()<.16){const px=sx(x)+(R()-.5)*S*1.2,py=sy(y)+(R()-.5)*S*1.2,s=4+R()*3;g.globalAlpha=.55;g.lineWidth=.8;g.beginPath();g.moveTo(px-s,py);g.quadraticCurveTo(px-s*.2,py-s*.55,px+s*.7,py);g.stroke();g.beginPath();g.moveTo(px-s*.2,py+s*.3);g.quadraticCurveTo(px+s*.3,py-s*.05,px+s,py+s*.25);g.lineWidth=.6;g.stroke();continue}
    if(!forest||R()>.34)continue;
    const px=sx(x)+(R()-.5)*S*1.2,py=sy(y)+(R()-.5)*S*1.2,s=2.6+R()*1.6;g.globalAlpha=.7;g.lineWidth=.8;g.beginPath();g.moveTo(px,py+s*.9);g.lineTo(px,py-s*.2);g.stroke();g.globalAlpha=.55;g.beginPath();g.arc(px,py-s*.45,s*.62,0,TAU);g.fill();g.globalAlpha=.8;g.lineWidth=.7;g.beginPath();g.arc(px,py-s*.45,s*.62,Math.PI*.9,Math.PI*1.9);g.stroke();trees++}
  g.restore();
  // --- rivers: atlas rivers inside the window, generated rivers elsewhere
  g.save();g.strokeStyle=pal.water;g.lineCap='round';
  {const visited=new Uint8Array(N);const heads=[];for(let i=0;i<N;i++){if(!isRiver[i])continue;const x=i%GW,y=(i-x)/GW;let up=false;for(const [dx,dy] of D8){const j=idx(x+dx,y+dy);if(isRiver[j]&&world.down[j]===i){up=true;break}}if(!up)heads.push(i)}
    for(const head of heads){const ck=contOf[head];if(ck<0||!contInfo[ck].known)continue;const cells=[];let i=head;for(;;){cells.push(i);visited[i]=1;const j=world.down[i];if(j<0)break;if(!mask[j]||visited[j]){cells.push(j);break}i=j}if(cells.length<4)continue;
      const pts=[];for(const c of cells){const x=c%GW,y=(c-x)/GW;const p=[sx(x),sy(y)];if(pts.length&&Math.abs(p[0]-pts[pts.length-1][0])>TW/2)break;pts.push(p)}const sm=root.Atlas.smoothLine(pts,2);
      for(let k=1;k<sm.length;k++){const f=flow[cells[Math.min(cells.length-1,Math.floor(k/sm.length*cells.length))]];g.lineWidth=.8+1.3*Math.log2(f/thrFlow+1);g.globalAlpha=.85;g.beginPath();g.moveTo(sm[k-1][0],sm[k-1][1]);g.lineTo(sm[k][0],sm[k][1]);g.stroke()}}}
  // atlas rivers → globe coordinates
  const toGlobe=([ax,ay])=>{const lon=(ax/1600-.5)*2.7-.25,lat=(.5-ay/1100)*2;return[(lon+Math.PI)/TAU*TW,(Math.PI/2-lat)/Math.PI*TH]};
  for(const r of atlas.rivers){const pts=r.points.map(toGlobe);for(let k=1;k<pts.length;k++){g.lineWidth=(.6+r.widths[k]*.55)*1.2;g.globalAlpha=.85;g.beginPath();g.moveTo(pts[k-1][0],pts[k-1][1]);g.lineTo(pts[k][0],pts[k][1]);g.stroke()}}
  for(const l of atlas.lakes){const pts=l.map(toGlobe);g.fillStyle=pal.water;g.globalAlpha=.7;g.beginPath();pts.forEach((p,i)=>i?g.lineTo(p[0],p[1]):g.moveTo(p[0],p[1]));g.closePath();g.fill();g.lineWidth=1;g.globalAlpha=.9;g.stroke()}
  g.restore();
  // --- towns (globe) + atlas towns
  g.save();g.fillStyle=pal.ink;g.strokeStyle=pal.ink;const placed=[];
  const town=(x,y,name,major)=>{g.globalAlpha=1;g.lineWidth=1.2;g.beginPath();g.arc(x,y,major?5:3.4,0,TAU);g.fillStyle=pal.paperLight;g.fill();g.stroke();g.beginPath();g.arc(x,y,1.6,0,TAU);g.fillStyle=pal.ink;g.fill();
    if(major){g.beginPath();g.moveTo(x-6,y-4);g.lineTo(x-6,y-14);g.lineTo(x-3,y-17);g.lineTo(x,y-14);g.lineTo(x,y-4);g.fillStyle=pal.paperLight;g.fill();g.stroke()}
    g.font=major?`600 ${major?28:22}px ${SERIF}`:`italic 500 22px ${SERIF}`;g.textAlign='left';g.textBaseline='middle';const w=g.measureText(name).width;let lx=x+10,ly=y+2;if(placed.some(r=>Math.abs(r.x-lx)<(r.w+w)/2+6&&Math.abs(r.y-ly)<26)){ly=y+24;lx=x-w/2}g.lineWidth=4;g.strokeStyle=pal.paperLight;g.strokeText(name,lx,ly);g.fillStyle=pal.ink;g.fillText(name,lx,ly);placed.push({x:lx+w/2,y:ly,w});g.strokeStyle=pal.ink};
  for(const t of towns)town(sx(t.x),sy(t.y),t.name,t.major);
  for(const t of atlas.towns){if(t.type==='ruin')continue;const [x,y]=toGlobe([t.x,t.y]);town(x,y,t.name,t.type==='city')}
  g.restore();
  // --- cartouche spot (reserved now, drawn last)
  let cartSpot=null;{let best=-1,bi=-1;for(let i=0;i<N;i+=2){const x=i%GW,y=(i-x)/GW;if(mask[i]||Math.abs(latOf(y))>.5)continue;const px=sx(x),py=sy(y);const v=dSea[i]-(roses.some(r=>Math.hypot(r.x-px,r.y-py)<380)?40:0)-(px<320||px>TW-320?60:0);if(v>best){best=v;bi=i}}if(bi>=0){cartSpot={x:clamp(sx(bi%GW),330,TW-330),y:sy(bi/GW|0),lon:lonOf(bi%GW),lat:latOf(bi/GW|0)};reserved.push([cartSpot.x-320,cartSpot.x+320,cartSpot.y-190,cartSpot.y+190])}}
  // --- names: continents, seas, incognita
  g.save();g.fillStyle=pal.ink;g.textBaseline='middle';const usedNames=new Set();
  const interior=(cells)=>{const m=new Uint8Array(N);for(const c of cells)m[c]=1;const inv=new Uint8Array(N);for(let i=0;i<N;i++)inv[i]=m[i]?0:1;const d=chamferWrap(inv);let best=-1,bi=cells[0];for(const c of cells)if(d[c]>best){best=d[c];bi=c}return{x:bi%GW,y:bi/GW|0,r:best}};
  const spaced=(txt,x,y,px,spacing,italic,alpha,color,width)=>{g.font=`${italic?'italic ':''}${italic?500:600} ${px}px ${SERIF}`;g.fillStyle=color||pal.ink;g.globalAlpha=alpha;const w=[...txt].reduce((s,ch)=>s+g.measureText(ch).width+spacing,0);const L=Math.max(w+40,width||0);x=clamp(x,L/2+30,TW-L/2-30);y=clamp(y,px,TH-px);for(const dy of [0,-px-30,px+30,-2*px-60,2*px+60]){const yy=clamp(y+dy,px,TH-px);if(!hits(x-L/2,x+L/2,yy-px*.7,yy+px*.7)&&!roses.some(r=>r.x>x-L/2-50&&r.x<x+L/2+50&&Math.abs(r.y-yy)<80)){y=yy;break}}root.AtlasRender.textAlongPath(g,txt,root.AtlasRender.arcPath(x,y,L,0,-px*.35),{spacing,halo:pal.paperLight,haloWidth:5});reserved.push([x-L/2,x+L/2,y-px*.7,y+px*.7]);return w};
  let titleDone=false;const titleCont=contInfo.filter(c=>c.hasWin).sort((a,b)=>b.size-a.size)[0];contInfo.forEach((c,k)=>{const p=interior(c.cells);const x=sx(p.x),y=sy(p.y);if(c.southern){spaced('TERRA AUSTRALIS NONDUM COGNITA',x,Math.min(TH-60,Math.max(y,TH*.9)),54,22,true,.85,pal.inkSoft);return}
    if(!c.known){if(c.size>900&&p.r>6){const pool=c.partly?['TERRA INCOGNITA','REGIO NONDUM DETECTA','TERRA NUPER VISA','LITTORA INCOGNITA']:['PARTES INCOGNITAE','TERRA INCOGNITA','HIC SUNT DRACONES'];spaced(pool[k%pool.length],x,y,Math.min(64,22+p.r*3),16,true,.8,pal.inkSoft)}return}
    if(c.hasWin){ /* the atlas continent keeps its own name; draw the title once */ if(titleDone||c!==titleCont)return;titleDone=true;const title=(opts.title||'').toUpperCase();if(title){const [tx,ty]=toGlobe([800,70]);const tw=spaced(title,tx,ty,72,26,false,.9,pal.ink);reserved.push([tx-tw/2-40,tx+tw/2+40,ty-60,ty+40])}return}
    if(c.size>500&&p.r>5){const nm=latinize('cont',names.word(k%2?'hard':'soft'),R);spaced(nm,x,y,Math.min(78,26+p.r*4),Math.min(30,8+p.r*1.5),false,.9)}});
  // atlas region labels reprojected
  for(const l of atlas.labels){if(l.kind==='sea'||l.kind==='bay'||l.kind==='lake')continue;const [x,y]=toGlobe([l.x,l.y]);g.font=`600 26px ${SERIF}`;g.fillStyle=pal.ink;g.globalAlpha=.85;const w=[...l.name].reduce((s,ch)=>s+g.measureText(ch).width+5,0);root.AtlasRender.textAlongPath(g,l.name,root.AtlasRender.arcPath(x,y,w+30,l.angle*.8,-9),{spacing:5,halo:pal.paperLight,haloWidth:4})}
  // seas
  {const cand=[];for(let i=0;i<N;i+=3){const x=i%GW,y=(i-x)/GW;if(mask[i]||dSea[i]<18||Math.abs(latOf(y))>1.1)continue;cand.push(i)}cand.sort((a,b)=>dSea[b]-dSea[a]);const spots=[];
    for(const i of cand){if(spots.length>=14)break;const x=i%GW,y=(i-x)/GW;if(spots.some(s=>Math.min(Math.abs(s.x-x),GW-Math.abs(s.x-x))<170&&Math.abs(s.y-y)<110))continue;if(roses.some(r=>Math.hypot(r.x-sx(x),r.y-sy(y))<200))continue;spots.push({x,y,d:dSea[i]})}
    let drawn=0;const rows=[0,23.44,-23.44,66.56,-66.56].map(l=>(90-l)/180*TH);
    for(const p of spots){if(drawn>=5)break;const big=p.d>50;const nm=latinize(big?'sea':'bay',names.word('soft'),R);const x=sx(p.x);let y=sy(p.y);
      // nudge off the named circles
      for(const ry of rows)if(Math.abs(ry-y)<70)y+=(y>ry?70:-70);
      let ok=false,px=big?72:48,w=0,sp=0;for(const size of (big?[72,58,46]:[48,40])){px=size;sp=px*.5;g.font=`italic 500 ${px}px ${SERIF}`;w=[...nm].reduce((s,ch)=>s+g.measureText(ch).width+sp,0);
        if(roses.some(r=>Math.abs(r.x-x)<w/2+80&&Math.abs(r.y-y)<100))continue;if(hits(x-w/2-90,x+w/2+90,y-px*.9,y+px*.9))continue;if(!seaSpan(x-w/2-10,x+w/2+10,y,4))continue;ok=true;break}
      if(!ok)continue;g.fillStyle=pal.water;g.globalAlpha=.8;root.AtlasRender.textAlongPath(g,nm,root.AtlasRender.arcPath(x,y,w+40,0,-px*.35),{spacing:sp});reserved.push([x-w/2,x+w/2,y-px*.7,y+px*.7]);drawn++}}
  g.restore();
  // --- Latin circles (placed over open sea, twice around where possible) and degree numbers
  g.save();g.fillStyle=pal.ink;g.textBaseline='alphabetic';g.font=`italic 500 30px ${SERIF}`;const circ=[[0,'AEQUATOR'],[23.44,'TROPICUS CANCRI'],[-23.44,'TROPICUS CAPRICORNI'],[66.56,'CIRCULUS POLARIS ARCTICUS'],[-66.56,'CIRCULUS POLARIS ANTARCTICUS']];
  for(const [lat,txt] of circ){const y=(90-lat)/180*TH;const w=[...txt].reduce((s,ch)=>s+g.measureText(ch).width+6,0);const starts=[];for(let k=0;k<24;k++)starts.push(((k*7)%24)/24*TW);let placed=0,lastX=-1e9;
    for(const x0 of starts){if(placed>=2)break;if(x0+w>TW-20||Math.abs(x0-lastX)<TW*.3)continue;if(!seaSpan(x0-10,x0+w+10,y-6,3)&&!seaSpan(x0-10,x0+w+10,y-6,0))continue;if(hits(x0,x0+w,y-30,y+8))continue;if(roses.some(r=>r.x>x0-60&&r.x<x0+w+60&&Math.abs(r.y-y)<70))continue;if(zodiacPts.some(z=>z.x>x0-40&&z.x<x0+w+40&&Math.abs(z.y-y)<48))continue;
      g.globalAlpha=.8;root.AtlasRender.textAlongPath(g,txt,[[x0,y-8],[x0+w+20,y-8]],{spacing:6,halo:pal.paper,haloWidth:4});reserved.push([x0,x0+w,y-30,y+8]);placed++;lastX=x0}}
  g.font=`500 20px ${SERIF}`;g.textAlign='center';g.textBaseline='middle';g.globalAlpha=.7;for(let lon=-170;lon<180;lon+=10){const x=(lon+180)/360*TW;if(hits(x-14,x+14,TH/2-28,TH/2-4))continue;const i=Math.floor((TH/2-16)/S)*GW+Math.floor(x/S);if(mask[i])continue;g.fillText(String(Math.abs(lon)),x,TH/2-16)}
  for(let lat=-80;lat<=80;lat+=10){if(!lat)continue;const y=(90-lat)/180*TH;const i=Math.floor(y/S)*GW+Math.floor((TW/2+22)/S);if(mask[i])continue;g.fillText(String(Math.abs(lat)),TW/2+22,y)}g.restore();
  // --- compass roses, ships, monsters
  for(const r of roses)rose(g,r.x,r.y,54,pal);
  g.save();g.clip(seaClip,'evenodd');const shipSpots=[];for(let k=0;k<400&&shipSpots.length<9;k++){const i=Math.floor(R()*N);const x=i%GW,y=(i-x)/GW;if(mask[i]||dSea[i]<9||Math.abs(latOf(y))>1.15)continue;const px=sx(x),py=sy(y);if(roses.some(r=>Math.hypot(r.x-px,r.y-py)<140)||shipSpots.some(s=>Math.hypot(s[0]-px,s[1]-py)<260)||hits(px-70,px+70,py-60,py+60))continue;shipSpots.push([px,py])}
  shipSpots.forEach((s,k)=>{if(k<7)ship(g,s[0],s[1],26+R()*10,R()<.5,pal);else monster(g,s[0],s[1],40+R()*16,k%2,pal)});
  g.restore();
  // --- cartouche in the biggest open sea away from the roses
  var cartLL=null;if(cartSpot){cartouche(g,cartSpot.x,cartSpot.y,opts.title||'Globus Terrestris',world,pal,R);cartLL={lon:cartSpot.lon,lat:cartSpot.lat}}
  // varnish
  g.save();g.globalCompositeOperation='multiply';g.fillStyle='rgba(232,208,150,.28)';g.fillRect(0,0,TW,TH);g.restore();
  // --- birth map: reveal sweeps outward from the known world
  {const img=bg.createImageData(GW,GH),d=img.data;for(let y=0;y<GH;y++)for(let x=0;x<GW;x++){const i=y*GW+x;const dist=distA(x,y);let b=mask[i]?.10+.5*dist:.03+.3*dist;const k=i*4;const v=Math.round(clamp(b,0,1)*255);d[k]=v;d[k+1]=v;d[k+2]=v;d[k+3]=255}bg.putImageData(img,0,0)}
  const stats={...world.stats,hachures:strokes,trees,roses:roses.length,ships:shipSpots.length,paintMs:Math.round(performance.now()-t0)};
  return{canvas:cv,birth,stats,roses,cartouche:cartLL}}

/* ---- ornaments ---- */
function rose(g,x,y,r,pal){g.save();g.translate(x,y);g.strokeStyle=pal.ink;g.fillStyle=pal.paperLight;g.lineWidth=1.2;g.globalAlpha=.9;g.beginPath();g.arc(0,0,r,0,TAU);g.stroke();g.beginPath();g.arc(0,0,r*.88,0,TAU);g.stroke();
  for(let k=0;k<32;k++){const a=k/32*TAU,l=k%8===0?r*.16:k%4===0?r*.1:r*.05;g.beginPath();g.moveTo(Math.cos(a)*r*.88,Math.sin(a)*r*.88);g.lineTo(Math.cos(a)*(r*.88-l),Math.sin(a)*(r*.88-l));g.stroke()}
  const star=(n,len,w,dark)=>{for(let k=0;k<n;k++){const a=k/n*TAU-Math.PI/2,tip=[Math.cos(a)*len,Math.sin(a)*len],l=[Math.cos(a-Math.PI/2)*w,Math.sin(a-Math.PI/2)*w],rr=[Math.cos(a+Math.PI/2)*w,Math.sin(a+Math.PI/2)*w];g.beginPath();g.moveTo(0,0);g.lineTo(l[0],l[1]);g.lineTo(tip[0],tip[1]);g.closePath();g.fillStyle=dark?pal.ink:pal.paperLight;g.fill();g.stroke();g.beginPath();g.moveTo(0,0);g.lineTo(rr[0],rr[1]);g.lineTo(tip[0],tip[1]);g.closePath();g.fillStyle=dark?pal.paperLight:pal.ink;g.fill();g.stroke()}};
  g.save();g.rotate(Math.PI/16);star(16,r*.5,r*.045,false);g.restore();g.save();g.rotate(Math.PI/8);star(8,r*.62,r*.07,false);g.restore();star(8,r*.8,r*.09,true);star(4,r*.95,r*.1,false);
  g.beginPath();g.moveTo(0,-r*.95);g.lineTo(-r*.07,-r*1.08);g.lineTo(0,-r*1.16);g.lineTo(r*.07,-r*1.08);g.closePath();g.fillStyle=pal.gold;g.fill();g.stroke();g.restore()}
function ship(g,x,y,s,flip,pal){g.save();g.translate(x,y);if(flip)g.scale(-1,1);g.strokeStyle=pal.ink;g.fillStyle=pal.paperLight;g.lineWidth=1.1;g.globalAlpha=.9;
  g.beginPath();g.moveTo(-s*.9,0);g.quadraticCurveTo(-s*.7,s*.32,0,s*.34);g.quadraticCurveTo(s*.7,s*.3,s*.95,-s*.05);g.lineTo(s*.8,0);g.closePath();g.fill();g.stroke();
  for(const [mx,mh] of [[-s*.5,s*.95],[0,s*1.2],[s*.45,s*1.0]]){g.beginPath();g.moveTo(mx,0);g.lineTo(mx,-mh);g.stroke();g.beginPath();g.moveTo(mx-s*.02,-mh*.95);g.quadraticCurveTo(mx-s*.34,-mh*.55,mx-s*.05,-mh*.32);g.lineTo(mx-s*.02,-mh*.32);g.closePath();g.fill();g.stroke();g.beginPath();g.moveTo(mx-s*.02,-mh*.3);g.quadraticCurveTo(mx-s*.4,-mh*.15,mx-s*.05,-s*.02);g.closePath();g.fill();g.stroke()}
  g.beginPath();g.moveTo(0,-s*1.2);g.lineTo(s*.18,-s*1.13);g.lineTo(0,-s*1.06);g.fillStyle=pal.ink;g.fill();g.globalAlpha=.5;g.lineWidth=.8;g.beginPath();g.moveTo(-s*1.6,s*.3);g.quadraticCurveTo(-s*1.1,s*.2,-s*.9,s*.28);g.stroke();g.restore()}
function monster(g,x,y,s,kind,pal){g.save();g.translate(x,y);g.strokeStyle=pal.ink;g.fillStyle=pal.paperLight;g.lineWidth=1.2;g.globalAlpha=.9;
  if(kind){ // spouting whale
    g.beginPath();g.moveTo(-s,0);g.bezierCurveTo(-s*.8,-s*.5,s*.4,-s*.55,s*.7,-s*.1);g.bezierCurveTo(s*.9,s*.1,s*.3,s*.3,-s*.2,s*.28);g.bezierCurveTo(-s*.7,s*.3,-s*1.05,s*.2,-s,0);g.closePath();g.fill();g.stroke();
    g.beginPath();g.moveTo(-s*.95,0);g.quadraticCurveTo(-s*1.25,-s*.3,-s*1.45,-s*.05);g.lineTo(-s*1.3,s*.05);g.quadraticCurveTo(-s*1.5,s*.25,-s*1.25,s*.3);g.lineTo(-s*.95,s*.1);g.closePath();g.fill();g.stroke();
    g.beginPath();g.arc(s*.45,-s*.22,s*.05,0,TAU);g.fillStyle=pal.ink;g.fill();for(let k=-1;k<=1;k++){g.beginPath();g.moveTo(s*.35,-s*.5);g.quadraticCurveTo(s*.35+k*s*.25,-s*.9,s*.35+k*s*.5,-s*1.15);g.stroke()}g.lineWidth=.7;for(let k=0;k<6;k++){g.beginPath();g.moveTo(-s*.6+k*s*.2,s*.1);g.lineTo(-s*.55+k*s*.2,s*.26);g.stroke()}
  }else{ // sea serpent
    g.lineWidth=1.3;g.beginPath();for(let k=0;k<=40;k++){const t=k/40,px=-s+t*2*s,py=Math.sin(t*Math.PI*3)*s*.32*(1-t*.3);k?g.lineTo(px,py):g.moveTo(px,py)}g.stroke();g.lineWidth=s*.12;g.globalAlpha=.9;g.strokeStyle=pal.paperLight;g.beginPath();for(let k=0;k<=40;k++){const t=k/40,px=-s+t*2*s,py=Math.sin(t*Math.PI*3)*s*.32*(1-t*.3);k?g.lineTo(px,py):g.moveTo(px,py)}g.stroke();g.strokeStyle=pal.ink;g.lineWidth=1.1;g.beginPath();for(let k=0;k<=40;k++){const t=k/40,px=-s+t*2*s,py=Math.sin(t*Math.PI*3)*s*.32*(1-t*.3)-s*.06;k?g.lineTo(px,py):g.moveTo(px,py)}g.stroke();g.beginPath();for(let k=0;k<=40;k++){const t=k/40,px=-s+t*2*s,py=Math.sin(t*Math.PI*3)*s*.32*(1-t*.3)+s*.06;k?g.lineTo(px,py):g.moveTo(px,py)}g.stroke();
    g.beginPath();g.moveTo(-s,0);g.lineTo(-s*1.25,-s*.22);g.lineTo(-s*1.35,-s*.05);g.lineTo(-s*1.2,s*.1);g.closePath();g.fillStyle=pal.paperLight;g.fill();g.stroke();g.beginPath();g.arc(-s*1.18,-s*.1,s*.03,0,TAU);g.fillStyle=pal.ink;g.fill();for(let k=0;k<5;k++){const t=.1+k*.2,px=-s+t*2*s,py=Math.sin(t*Math.PI*3)*s*.32*(1-t*.3)-s*.08;g.beginPath();g.moveTo(px,py);g.lineTo(px+s*.04,py-s*.14);g.lineTo(px+s*.1,py);g.stroke()}}
  g.restore()}
function cartouche(g,x,y,title,world,pal,R){const w=560,hh=300;g.save();g.translate(x,y);g.strokeStyle=pal.ink;g.fillStyle=pal.paperLight;g.lineWidth=1.6;g.globalAlpha=.96;
  // rocaille frame: scrolled shell top, volutes at corners
  const frame=()=>{g.beginPath();g.moveTo(-w/2,-hh/2+30);g.quadraticCurveTo(-w/2-28,-hh/2-10,-w/2+40,-hh/2);g.lineTo(-40,-hh/2);g.quadraticCurveTo(-20,-hh/2-40,0,-hh/2-46);g.quadraticCurveTo(20,-hh/2-40,40,-hh/2);g.lineTo(w/2-40,-hh/2);g.quadraticCurveTo(w/2+28,-hh/2-10,w/2,-hh/2+30);g.lineTo(w/2,hh/2-30);g.quadraticCurveTo(w/2+28,hh/2+10,w/2-40,hh/2);g.lineTo(40,hh/2);g.quadraticCurveTo(0,hh/2+34,-40,hh/2);g.lineTo(-w/2+40,hh/2);g.quadraticCurveTo(-w/2-28,hh/2+10,-w/2,hh/2-30);g.closePath()};
  frame();g.fill();g.stroke();g.lineWidth=.8;g.save();g.scale(.955,.93);frame();g.stroke();g.restore();
  const volute=(cx,cy,dir)=>{g.lineWidth=1.3;g.beginPath();for(let k=0;k<=60;k++){const t=k/60,a=t*Math.PI*2.4,r=26*(1-t*.9);const px=cx+Math.cos(a)*r*dir,py=cy+Math.sin(a)*r;k?g.lineTo(px,py):g.moveTo(px,py)}g.stroke();g.beginPath();g.arc(cx,cy,3,0,TAU);g.fillStyle=pal.ink;g.fill();g.fillStyle=pal.paperLight};
  volute(-w/2+6,-hh/2+18,1);volute(w/2-6,-hh/2+18,-1);volute(-w/2+6,hh/2-18,1);volute(w/2-6,hh/2-18,-1);
  // shell crest
  g.lineWidth=1;for(let k=-4;k<=4;k++){g.beginPath();g.moveTo(0,-hh/2-8);g.lineTo(k*9,-hh/2-40-Math.abs(k)*-2);g.stroke()}
  g.fillStyle=pal.ink;g.textAlign='center';g.textBaseline='middle';
  const line=(txt,yy,px,italic,spacing)=>{g.font=`${italic?'italic ':''}${italic?500:600} ${px}px ${SERIF}`;const wdt=[...txt].reduce((s,ch)=>s+g.measureText(ch).width+spacing,0);root.AtlasRender.textAlongPath(g,txt,[[-wdt/2-10,yy],[wdt/2+10,yy]],{spacing})};
  line('GLOBUS TERRESTRIS',-hh/2+52,44,false,7);
  line('in quo',-hh/2+92,22,true,2);
  let t=title.toUpperCase();let px=40;g.font=`600 ${px}px ${SERIF}`;while([...t].reduce((s,ch)=>s+g.measureText(ch).width+6,0)>w-90&&px>18){px--;g.font=`600 ${px}px ${SERIF}`}line(t,-hh/2+132,px,false,6);
  line('cum omnibus regnis, montibus, fluminibus et oris maritimis',-hh/2+172,20,true,1.5);
  line('nuper detectis accuratissime describuntur',-hh/2+198,20,true,1.5);
  g.beginPath();g.moveTo(-90,-hh/2+222);g.lineTo(-10,-hh/2+222);g.moveTo(10,-hh/2+222);g.lineTo(90,-hh/2+222);g.strokeStyle=pal.ink;g.lineWidth=.8;g.stroke();g.beginPath();g.arc(0,-hh/2+222,3,0,TAU);g.fillStyle=pal.gold;g.fill();g.stroke();
  g.fillStyle=pal.ink;line(`Auctore INKBOUND · Atlas Nº ${String(world.seed).padStart(6,'0')}`,-hh/2+248,20,true,1.5);
  line('Londini, Anno MDCCLII',-hh/2+276,22,false,3);
  g.restore()}

root.GlobeWorld={buildWorld,paint,GW,GH,TW,TH};
})(typeof window!=='undefined'?window:globalThis);
