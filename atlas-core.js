/* Inkbound Atlas — procedural world model.
   Map space is 1600 × 1100 px. The simulation grid is 800 × 550 cells (2 px per cell).
   Everything here is deterministic from the seed; nothing touches the DOM, so the
   same file runs in Node for tests. Terrain range shaping follows the frontier-
   propagation idea from Azgaar's Fantasy Map Generator (MIT); hydrology uses
   priority-flood drainage (Barnes et al.). */
(function(root){
'use strict';
const W=1600,H=1100,GW=800,GH=550,CELL=2,N=GW*GH;
const clamp=(v,a,b)=>v<a?a:v>b?b:v,lerp=(a,b,t)=>a+(b-a)*t;
const smoothstep=(a,b,x)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t)};
const D4=[[1,0],[-1,0],[0,1],[0,-1]],D8=[[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];

function rng(seed){let s=(seed>>>0)||1;return()=>{s|=0;s=s+0x6D2B79F5|0;let t=Math.imul(s^s>>>15,1|s);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}

/* Seeded gradient noise with fBm and ridged variants. */
function makeNoise(seed){
  const r=rng(seed),perm=new Uint16Array(512),g=new Float32Array(512*2),p=Array.from({length:256},(_,i)=>i);
  for(let i=255;i>0;i--){const j=Math.floor(r()*(i+1));const t=p[i];p[i]=p[j];p[j]=t}
  for(let i=0;i<512;i++){perm[i]=p[i&255];const a=r()*Math.PI*2;g[i*2]=Math.cos(a);g[i*2+1]=Math.sin(a)}
  const fade=t=>t*t*t*(t*(t*6-15)+10);
  function n2(x,y){const X=Math.floor(x),Y=Math.floor(y),fx=x-X,fy=y-Y,u=fade(fx),v=fade(fy),xi=X&255,yi=Y&255;
    const h00=perm[perm[xi]+yi],h10=perm[perm[xi+1]+yi],h01=perm[perm[xi]+yi+1],h11=perm[perm[xi+1]+yi+1];
    const a=g[h00*2]*fx+g[h00*2+1]*fy,b=g[h10*2]*(fx-1)+g[h10*2+1]*fy,c=g[h01*2]*fx+g[h01*2+1]*(fy-1),d=g[h11*2]*(fx-1)+g[h11*2+1]*(fy-1);
    return lerp(lerp(a,b,u),lerp(c,d,u),v)*1.4}
  function fbm(x,y,oct=5,lac=2,gain=.5){let s=0,a=1,f=1,norm=0;for(let i=0;i<oct;i++){s+=n2(x*f,y*f)*a;norm+=a;a*=gain;f*=lac}return s/norm}
  function ridged(x,y,oct=4){let s=0,a=.55,f=1,w=1;for(let i=0;i<oct;i++){let n=1-Math.abs(n2(x*f,y*f));n=n*n*w;w=clamp(n*2,0,1);s+=n*a;a*=.5;f*=2.05}return s}
  return{n2,fbm,ridged}}

/* Chamfer 3-4 distance transform from source cells. Optionally propagates the nearest source id. */
function chamfer(src,withId){
  const d=new Float32Array(N).fill(1e9),id=withId?new Int32Array(N).fill(-1):null;
  for(let i=0;i<N;i++)if(src[i]){d[i]=0;if(id)id[i]=i}
  const relax=(i,j,c)=>{const v=d[j]+c;if(v<d[i]){d[i]=v;if(id)id[i]=id[j]}};
  for(let y=0;y<GH;y++)for(let x=0;x<GW;x++){const i=y*GW+x;if(x>0)relax(i,i-1,3);if(y>0){relax(i,i-GW,3);if(x>0)relax(i,i-GW-1,4);if(x<GW-1)relax(i,i-GW+1,4)}}
  for(let y=GH-1;y>=0;y--)for(let x=GW-1;x>=0;x--){const i=y*GW+x;if(x<GW-1)relax(i,i+1,3);if(y<GH-1){relax(i,i+GW,3);if(x<GW-1)relax(i,i+GW+1,4);if(x>0)relax(i,i+GW-1,4)}}
  for(let i=0;i<N;i++)d[i]/=3;
  return{d,id}}

/* 4-connected components of cells where mask===value; tiny ones flip to the other value. */
function despeckle(mask,value,minSize){
  const seen=new Uint8Array(N),stack=[];
  for(let i=0;i<N;i++){if(seen[i]||mask[i]!==value)continue;const cells=[];stack.push(i);seen[i]=1;
    while(stack.length){const c=stack.pop();cells.push(c);const x=c%GW,y=(c-x)/GW;for(const [dx,dy] of D4){const nx=x+dx,ny=y+dy;if(nx<0||ny<0||nx>=GW||ny>=GH)continue;const j=ny*GW+nx;if(!seen[j]&&mask[j]===value){seen[j]=1;stack.push(j)}}}
    if(cells.length<minSize)for(const c of cells)mask[c]=1-value}}

/* Clusters (8-connected) of cells satisfying pred, largest first. */
function clusters(pred,minSize){
  const seen=new Uint8Array(N),out=[],stack=[];
  for(let i=0;i<N;i++){if(seen[i]||!pred(i))continue;const cells=[];stack.push(i);seen[i]=1;
    while(stack.length){const c=stack.pop();cells.push(c);const x=c%GW,y=(c-x)/GW;for(const [dx,dy] of D8){const nx=x+dx,ny=y+dy;if(nx<0||ny<0||nx>=GW||ny>=GH)continue;const j=ny*GW+nx;if(!seen[j]&&pred(j)){seen[j]=1;stack.push(j)}}}
    if(cells.length>=minSize)out.push(cells)}
  return out.sort((a,b)=>b.length-a.length)}

/* Box blur (3×3) of a float field, n passes. */
function blur(field,passes=1){let a=field,b=new Float32Array(N);for(let p=0;p<passes;p++){for(let y=0;y<GH;y++)for(let x=0;x<GW;x++){let s=0,c=0;for(let dy=-1;dy<=1;dy++){const yy=y+dy;if(yy<0||yy>=GH)continue;for(let dx=-1;dx<=1;dx++){const xx=x+dx;if(xx<0||xx>=GW)continue;s+=a[yy*GW+xx];c++}}b[y*GW+x]=s/c}const t=a;a=b;b=t}return a}

/* Marching squares. Returns chained polylines in px space; each has .closed. */
function isolines(field,level){
  const segs=[],adj=new Map(),HK=(x,y)=>y*GW+x,VK=(x,y)=>N+y*GW+x;
  const P=(x,y)=>[x*CELL+CELL/2,y*CELL+CELL/2];
  const add=(k1,p1,k2,p2)=>{const s=segs.length;segs.push([k1,p1,k2,p2]);(adj.get(k1)||adj.set(k1,[]).get(k1)).push(s);(adj.get(k2)||adj.set(k2,[]).get(k2)).push(s)};
  for(let y=0;y<GH-1;y++)for(let x=0;x<GW-1;x++){
    const a=field[y*GW+x],b=field[y*GW+x+1],c=field[(y+1)*GW+x+1],d=field[(y+1)*GW+x];
    const idx=(a>=level?8:0)|(b>=level?4:0)|(c>=level?2:0)|(d>=level?1:0);if(idx===0||idx===15)continue;
    const T=()=>[HK(x,y),P(x+(level-a)/(b-a),y)],R=()=>[VK(x+1,y),P(x+1,y+(level-b)/(c-b))],B=()=>[HK(x,y+1),P(x+(level-d)/(c-d),y+1)],L=()=>[VK(x,y),P(x,y+(level-a)/(d-a))];
    const join=(e1,e2)=>{const [k1,p1]=e1(),[k2,p2]=e2();add(k1,p1,k2,p2)};
    switch(idx){case 1:join(L,B);break;case 2:join(B,R);break;case 3:join(L,R);break;case 4:join(T,R);break;
      case 5:if((a+b+c+d)/4>=level){join(T,L);join(B,R)}else{join(T,R);join(L,B)}break;
      case 6:join(T,B);break;case 7:join(T,L);break;case 8:join(T,L);break;case 9:join(T,B);break;
      case 10:if((a+b+c+d)/4>=level){join(T,R);join(L,B)}else{join(T,L);join(B,R)}break;
      case 11:join(T,R);break;case 12:join(L,R);break;case 13:join(B,R);break;case 14:join(L,B);break}}
  const used=new Uint8Array(segs.length),lines=[];
  const next=(key,self)=>{const list=adj.get(key);if(!list)return -1;for(const s of list)if(s!==self&&!used[s])return s;return -1};
  for(let s=0;s<segs.length;s++){if(used[s])continue;used[s]=1;const seg=segs[s];let pts=[seg[1],seg[3]],headKey=seg[0],tailKey=seg[2],cur=s,closed=false;
    for(;;){const n=next(tailKey,cur);if(n<0)break;used[n]=1;const g=segs[n];if(g[0]===tailKey){pts.push(g[3]);tailKey=g[2]}else{pts.push(g[1]);tailKey=g[0]}cur=n;if(tailKey===headKey){closed=true;break}}
    if(!closed){cur=s;for(;;){const n=next(headKey,cur);if(n<0)break;used[n]=1;const g=segs[n];if(g[2]===headKey){pts.unshift(g[1]);headKey=g[0]}else{pts.unshift(g[3]);headKey=g[2]}cur=n}}
    pts.closed=closed;lines.push(pts)}
  return lines}

/* Chaikin corner cutting. */
function smoothLine(pts,iter=2){let p=pts;for(let k=0;k<iter;k++){const out=[];const n=p.length;if(n<3)return p;if(p.closed){for(let i=0;i<n;i++){const a=p[i],b=p[(i+1)%n];out.push([a[0]*.75+b[0]*.25,a[1]*.75+b[1]*.25],[a[0]*.25+b[0]*.75,a[1]*.25+b[1]*.75])}out.closed=true}else{out.push(p[0]);for(let i=0;i<n-1;i++){const a=p[i],b=p[i+1];out.push([a[0]*.75+b[0]*.25,a[1]*.75+b[1]*.25],[a[0]*.25+b[0]*.75,a[1]*.25+b[1]*.75])}out.push(p[n-1])}p=out}return p}
function lineLength(pts){let l=0;for(let i=1;i<pts.length;i++)l+=Math.hypot(pts[i][0]-pts[i-1][0],pts[i][1]-pts[i-1][1]);return l}

/* Binary heap keyed by a float array. */
function Heap(key){const a=[];return{get size(){return a.length},push(i){let k=a.length;a.push(i);while(k){const p=(k-1)>>1;if(key[a[p]]<=key[i])break;a[k]=a[p];k=p}a[k]=i},
  pop(){const top=a[0],last=a.pop();if(a.length){let k=0;a[0]=last;for(;;){let c=k*2+1;if(c>=a.length)break;if(c+1<a.length&&key[a[c+1]]<key[a[c]])c++;if(key[last]<=key[a[c]])break;a[k]=a[c];k=c}a[k]=last}return top}}}

/* ---------- Names ---------- */
const SYL={hard:['Kar','Dor','Thar','Grim','Bran','Vor','Skar','Ur','Mor','Drak','Hal','Rok','Tor','Gal','Ulf','Bar','Kal','Vind','Hrim','Nar'],
  soft:['Ael','Ela','Sil','Lir','Ael','Mira','Ithil','Ser','Lo','Fael','Nym','Ava','Ely','Cal','Ola','Wen','Isla','Amar','Vel','Thia'],
  mid:['a','e','i','o','u','ae','ia','ei','ar','en','or','il'],
  end:['dor','wen','mar','rick','th','dun','val','mere','dale','holm','wick','ford','gard','stad','by','burgh','ost','ain','ith','an','on','moor','haven','reach','fell','wold','ness','more','wyn','ley']};
function makeNames(R){const used=new Set();
  const vowel=ch=>/[aeiouy]/i.test(ch);
  function word(flavor){for(let t=0;t<60;t++){const pre=(flavor==='hard'?SYL.hard:SYL.soft)[Math.floor(R()*20)];let end=SYL.end[Math.floor(R()*SYL.end.length)];let w;
      if(!vowel(pre[pre.length-1])&&R()<.35)w=pre+SYL.mid[Math.floor(R()*SYL.mid.length)].replace(/^([aeiou])[aeiou]$/,'$1')+end;
      else if(vowel(pre[pre.length-1])&&vowel(end[0]))w=pre+['r','l','n','th','v'][Math.floor(R()*5)]+end;
      else w=pre+end;
      if(/[aeiou]{3}/i.test(w)||/(.)\1\1/.test(w))continue;const c=w[0]+w.slice(1).toLowerCase();if(!used.has(c)&&c.length<=10){used.add(c);return c}}return 'Nowhere'}
  const pick=arr=>arr[Math.floor(R()*arr.length)];
  const templates={mountain:['The {N} Peaks','The {N} Teeth','The {N} Crown','The Spine of {N}','The {N} Reach','The {N} Fells','The Wall of {N}'],
    forest:['The {N} Wood','{N}wood','The Deep of {N}','The {N} Weald','The {N} Wilds','The Greenwood of {N}','The {N} Thicket'],
    plains:['The {N} Plains','The {N} Expanse','The {N} March','The Fields of {N}','The {N} Steppe','The {N} Downs','The {N} Meadows'],
    desert:['The {N} Wastes','The Sands of {N}','The {N} Erg','The Red {N}','The {N} Barrens'],
    canyon:['The {N} Vale','The Sundered {N}','The {N} Rift','The Cleft of {N}','The {N} Gorge'],
    ice:['The {N} Reach','The White {N}','The {N} Waste','The Frost of {N}'],
    tundra:['The {N} Tundra','The Cold {N}','The {N} Barrens'],
    sea:['The {N} Sea','The Sea of {N}','The {N} Deep','The Gulf of {N}','The {N} Ocean'],
    bay:['Bay of {N}','{N} Bay','The {N} Sound','The {N} Firth'],
    lake:['The {N} Tarn','{N} Pool','Loch {N}'],lakeBig:['Lake {N}','{N} Mere','The {N} Water','Loch {N}'],
    river:['River {N}','The {N}','{N} Water'],
    marsh:['The {N} Fens','The {N} Mire']};
  return{region(type,flavor='soft'){return pick(templates[type]||templates.plains).replace('{N}',word(flavor))},town(flavor='soft'){return word(flavor)},word}}

/* ---------- The build ---------- */
function build(opts={}){
  const t0=Date.now();
  const seed=(opts.seed>>>0)||1,kind=opts.kind||'kingdom',rugged=Number(opts.rugged)||1,detail=Number(opts.detail)||3,traits=opts.traits||{},edits=opts.edits||[];
  const R=rng(seed),NA=makeNoise(seed),NB=makeNoise(seed^0x9e3779b9),NC=makeNoise((seed*7+13)>>>0),names=makeNames(rng(seed^0x51ed270b));
  const off=[R()*97,R()*97,R()*97,R()*97];

  /* 1. Landness field and mask */
  const land=new Float32Array(N);
  const targetFrac={kingdom:.50,frozen:.47,desert:.52,islands:.26}[kind]||.5;
  let centers=[[0,0]];if(kind==='islands'){const k=3+Math.floor(R()*3);centers=Array.from({length:k},()=>[(R()-.5)*1.05,(R()-.5)*.62])}
  for(let y=0;y<GH;y++)for(let x=0;x<GW;x++){const i=y*GW+x,nx=(x-GW/2)/GH,ny=(y-GH/2)/GH;
    const wx=NB.fbm(nx*2.1+off[0],ny*2.1,4)*.17,wy=NB.fbm(nx*2.1,ny*2.1+off[1],4)*.17,qx=nx+wx,qy=ny+wy;
    let shape=NA.fbm(qx*2.4+off[2],qy*2.4+off[3],6,2,.53);let v;
    if(kind==='islands'){let fall=-2;for(const [cx,cy] of centers){fall=Math.max(fall,1-Math.hypot((qx-cx)/.34,(qy-cy)/.28))}shape=shape*.8+NA.fbm(qx*5.2+off[1],qy*5.2,4)*.4;v=fall*.55+shape*.95}
    else{const d=Math.hypot(qx/.66,qy/.45);v=(1-d*d)*.9+shape*1.05}
    const edge=Math.min(x,y,GW-1-x,GH-1-y);land[i]=v-(1-smoothstep(22,62,edge))*3}
  const sample=[];for(let i=0;i<N;i+=5)sample.push(land[i]);sample.sort((a,b)=>b-a);const thr=sample[Math.floor(sample.length*targetFrac)];
  const mask=new Uint8Array(N);for(let i=0;i<N;i++)mask[i]=land[i]>thr?1:0;
  for(const e of edits){const cx=e.x/CELL,cy=e.y/CELL,r=(e.r||36)/CELL;for(let y=Math.max(0,Math.floor(cy-r));y<=Math.min(GH-1,Math.ceil(cy+r));y++)for(let x=Math.max(0,Math.floor(cx-r));x<=Math.min(GW-1,Math.ceil(cx+r));x++){const dx=x-cx,dy=y-cy,rr=r*(.85+NC.n2(x*.25+cx,y*.25)*.3);if(dx*dx+dy*dy<=rr*rr)mask[y*GW+x]=e.type==='land'?1:0}}
  for(let x=0;x<GW;x++)for(let y=0;y<21;y++){mask[y*GW+x]=0;mask[(GH-1-y)*GW+x]=0}
  for(let y=0;y<GH;y++)for(let x=0;x<21;x++){mask[y*GW+x]=0;mask[y*GW+GW-1-x]=0}
  despeckle(mask,1,kind==='islands'?22:16);despeckle(mask,0,10);
  let landCount=0;for(let i=0;i<N;i++)landCount+=mask[i];

  /* 2. Distances to coast */
  const sea=new Uint8Array(N);for(let i=0;i<N;i++)sea[i]=mask[i]?0:1;
  const dLand=chamfer(sea).d;   // for land cells: distance to sea
  const dSea=chamfer(mask).d;   // for sea cells: distance to land

  /* 3. Mountain spines and rift */
  const interior=[];for(let i=0;i<N;i++)if(mask[i]&&dLand[i]>9)interior.push(i);
  const spineCount={kingdom:3,frozen:3,desert:2,islands:2}[kind]||3;
  const spines=[];
  function pickSpine(type){if(!interior.length)return null;let a=interior[Math.floor(R()*interior.length)],b=a,best=-1;
    for(let t=0;t<48;t++){const c=interior[Math.floor(R()*interior.length)];const d=Math.hypot(c%GW-a%GW,((c/GW)|0)-((a/GW)|0));const s=d*(1-.6*Math.abs(spines.reduce((m,sp)=>Math.min(m,Math.hypot(c%GW-sp.mid[0],((c/GW)|0)-sp.mid[1])),1e9)<70?1:0));if(s>best){best=s;b=c}}
    const ax=a%GW,ay=(a/GW)|0,bx=b%GW,by=(b/GW)|0;const len=Math.hypot(bx-ax,by-ay);if(len<60)return null;
    const cx=(ax+bx)/2+(R()-.5)*len*.5,cy=(ay+by)/2+(R()-.5)*len*.4;
    return{a:[ax,ay],c:[cx,cy],b:[bx,by],mid:[(ax+bx)/2,(ay+by)/2],type,width:type==='rift'?8+R()*4:(kind==='islands'?10:12)+R()*8,amp:type==='rift'?24:(36+R()*12)*rugged,len}}
  for(let s=0;s<spineCount;s++){const sp=pickSpine('range');if(sp)spines.push(sp)}
  if(traits.rift||(kind==='kingdom'&&R()<.45)){const sp=pickSpine('rift');if(sp)spines.push(sp)}
  for(const sp of spines){const src=new Uint8Array(N),tOf=new Float32Array(N);const steps=Math.ceil(sp.len*2);
    for(let k=0;k<=steps;k++){const t=k/steps,u=1-t;const x=Math.round(u*u*sp.a[0]+2*u*t*sp.c[0]+t*t*sp.b[0]),y=Math.round(u*u*sp.a[1]+2*u*t*sp.c[1]+t*t*sp.b[1]);if(x<0||y<0||x>=GW||y>=GH)continue;const i=y*GW+x;src[i]=1;tOf[i]=t}
    const {d,id}=chamfer(src,true);sp.dist=d;sp.tpar=new Float32Array(N);for(let i=0;i<N;i++)sp.tpar[i]=id[i]>=0?tOf[id[i]]:0}

  /* 4. Heights */
  const h=new Float32Array(N),riftZone=new Float32Array(N);
  for(let y=0;y<GH;y++)for(let x=0;x<GW;x++){const i=y*GW+x;
    if(!mask[i]){h[i]=19.2-Math.min(10.5,dSea[i]*.55)+NA.fbm(x/38,y/38,3)*1.2;continue}
    const dl=dLand[i];let base=21+15*(1-Math.exp(-dl/26))+NA.fbm(x/72+off[0],y/72+off[1],4)*7.5+NA.fbm(x/21,y/21,3)*2.2;
    if(kind==='frozen')base+=4;let mtn=0;
    for(const sp of spines){const d=sp.dist[i],t=sp.tpar[i];const taper=Math.pow(Math.sin(Math.PI*clamp(t,0,1)),.55);const w=sp.width*(.7+.6*(NB.fbm(x/55+off[2],y/55,3)+.5));const g=Math.exp(-(d*d)/(2*w*w));
      if(sp.type==='range'){const r=NC.ridged(x/22+off[3],y/22,4);mtn+=g*taper*sp.amp*(.28+.95*r)}
      else{mtn-=g*taper*sp.amp*(.6+.4*NA.fbm(x/30,y/30,3));riftZone[i]=Math.max(riftZone[i],g*taper)}}
    let v=base+mtn;if(v>72)v=72+26*(1-Math.exp(-(v-72)/26));h[i]=clamp(v,20.5,98)}
  {const s=new Float32Array(N);for(let y=1;y<GH-1;y++)for(let x=1;x<GW-1;x++){const i=y*GW+x;if(!mask[i]){s[i]=h[i];continue}let sum=0,c=0;for(const [dx,dy] of D8){const j=i+dy*GW+dx;if(mask[j]){sum+=h[j];c++}}s[i]=c?clamp(h[i]*.55+sum/c*.45,20.5,98):h[i]}for(let i=0;i<N;i++)if(mask[i]&&s[i])h[i]=s[i]}
  const hRender=Float32Array.from(h);
  for(let y=0;y<GH;y++)for(let x=0;x<GW;x++){const i=y*GW+x;if(mask[i])h[i]=clamp(h[i]+NC.n2(x/4.6+3,y/4.6)*1.3+NB.n2(x/9,y/9+5)*.9,20.5,98)}

  /* 5. Hydrology: priority flood, drainage, flow accumulation */
  const level=Float32Array.from(h),down=new Int32Array(N).fill(-1),seen=new Uint8Array(N),order=[];const heap=Heap(level);
  for(let y=1;y<GH-1;y++)for(let x=1;x<GW-1;x++){const i=y*GW+x;if(!mask[i])continue;for(const [dx,dy] of D8){const j=i+dy*GW+dx;if(!mask[j]){seen[i]=1;down[i]=j;heap.push(i);break}}}
  while(heap.size){const i=heap.pop();order.push(i);const x=i%GW,y=(i-x)/GW;for(const [dx,dy] of D8){const nx=x+dx,ny=y+dy;if(nx<1||ny<1||nx>=GW-1||ny>=GH-1)continue;const j=ny*GW+nx;if(!mask[j]||seen[j])continue;seen[j]=1;down[j]=i;level[j]=Math.max(h[j],level[i]+.002);heap.push(j)}}
  const moistureBase=new Float32Array(N);for(let y=0;y<GH;y++)for(let x=0;x<GW;x++){const i=y*GW+x;moistureBase[i]=.5+.5*NB.fbm(x/95+off[1],y/95+off[3],4)}
  const flow=new Float32Array(N);for(let k=order.length-1;k>=0;k--){const i=order[k];flow[i]+=.4+moistureBase[i]*1.2;const j=down[i];if(j>=0&&mask[j])flow[j]+=flow[i]}
  const thrFlow=Math.max(120,landCount/(kind==='desert'?300:640));
  const isRiver=new Uint8Array(N);let riverCells=0;for(let i=0;i<N;i++)if(mask[i]&&flow[i]>=thrFlow){isRiver[i]=1;riverCells++}
  // lakes: filled depressions
  const lakeDepth=new Float32Array(N);for(let i=0;i<N;i++)lakeDepth[i]=mask[i]?level[i]-h[i]:0;
  const lakeMask=new Uint8Array(N);for(let i=0;i<N;i++)lakeMask[i]=lakeDepth[i]>1.4&&h[i]<58?1:0;
  const lakeGroups=clusters(i=>lakeMask[i],40);const lakeCells=new Uint8Array(N);for(const g of lakeGroups)for(const c of g)lakeCells[c]=1;
  for(let i=0;i<N;i++)if(!lakeCells[i])lakeMask[i]=0;
  const dRiver=chamfer(isRiver).d;

  /* 6. Climate and biomes */
  const moisture=new Float32Array(N),temp=new Float32Array(N),biome=new Uint8Array(N);
  const BIOMES=['sea','plains','forest','hills','mountain','ice','desert','canyon','tundra','marsh','lake'];
  const tempBase={kingdom:[.22,.78],frozen:[-.12,.9],desert:[.6,.5],islands:[.42,.6]}[kind]||[.22,.78];
  for(let y=0;y<GH;y++)for(let x=0;x<GW;x++){const i=y*GW+x;if(!mask[i]){biome[i]=0;continue}
    let m=moistureBase[i]+.38*Math.exp(-dRiver[i]/5)+.16*Math.exp(-dLand[i]/22)-(h[i]-20)/80*.45;if(kind==='desert')m-=.36;if(kind==='frozen')m+=.05;m+=NC.n2(x/17,y/17)*.08;moisture[i]=m;
    let t=tempBase[0]+tempBase[1]*(y/GH)-(h[i]-20)/80*.95+NB.n2(x/40+9,y/40)*.05;temp[i]=t;
    let b;if(lakeMask[i])b=10;else if(h[i]>=87||t<.1)b=5;else if(h[i]>=62)b=4;else if(h[i]>=50)b=3;else if(riftZone[i]>.35&&h[i]<44)b=7;else if(m>.86&&h[i]<25&&dLand[i]<14)b=9;else if(kind==='desert'&&m<.52)b=6;else if(m>.6&&t>.2)b=2;else if(t<.24)b=8;else b=1;biome[i]=b}

  /* 7. Vector geometry */
  const coast=isolines(h,20).map(l=>{const s=smoothLine(l,1);s.closed=l.closed;return s});
  const contourLevels=[];for(let lv=24;lv<=96;lv+=4)contourLevels.push(lv);
  const hForContours=blur(hRender,1);for(let i=0;i<N;i++)if(!mask[i])hForContours[i]=Math.min(hForContours[i],19.5);
  const contours=contourLevels.map(lv=>({level:lv,index:lv%20===0,lines:isolines(hForContours,lv).filter(l=>l.length>6).map(l=>{const s=smoothLine(l,1);s.closed=l.closed;return s})}));
  const dSeaSmooth=blur(dSea,2);const seaRings=[2.2,5.5,10,16,24,34].map(lv=>isolines(dSeaSmooth,lv).filter(l=>l.length>10).map(l=>{const s=smoothLine(l,1);s.closed=l.closed;return s}));
  const lakeField=blur(Float32Array.from(lakeMask),1);const lakes=isolines(lakeField,.5).filter(l=>l.length>8).map(l=>{const s=smoothLine(l,2);s.closed=l.closed;return s});
  // rivers as polylines from heads to mouths / confluences
  const visited=new Uint8Array(N),rivers=[];const heads=[];
  for(let i=0;i<N;i++){if(!isRiver[i])continue;const x=i%GW,y=(i-x)/GW;let up=false;for(const [dx,dy] of D8){const j=(y+dy)*GW+x+dx;if(j>=0&&j<N&&isRiver[j]&&down[j]===i){up=true;break}}if(!up)heads.push(i)}
  heads.sort((a,b)=>flow[a]-flow[b]);
  for(const head of heads){if(visited[head])continue;const cells=[];let i=head;for(;;){cells.push(i);visited[i]=1;const j=down[i];if(j<0)break;if(!mask[j]){cells.push(j);break}if(visited[j]||!isRiver[j]){cells.push(j);break}i=j}
    if(cells.length<4)continue;const pts=cells.map(c=>[(c%GW)*CELL+1,((c/GW)|0)*CELL+1]);const flows=cells.map(c=>flow[c]);
    const sm=smoothLine(pts,2).map(([x,y],k,arr)=>{const a=arr[Math.max(0,k-1)],b=arr[Math.min(arr.length-1,k+1)];const dx=b[0]-a[0],dy=b[1]-a[1],L=Math.hypot(dx,dy)||1;const w=NC.n2(x/11+1,y/11)*2.4;return[x-dy/L*w,y+dx/L*w]});const widths=sm.map((_,k)=>{const f=flows[Math.min(flows.length-1,Math.floor(k/sm.length*flows.length))];return .7+1.15*Math.log2(f/thrFlow+1)});
    rivers.push({points:sm,widths,flow:flows[flows.length-1],length:lineLength(sm),mouthSea:!mask[cells[cells.length-1]]})}
  rivers.sort((a,b)=>b.flow-a.flow);

  /* 8. Map furniture corners: compass goes to the emptiest sea corner, cartouche to a bottom corner */
  const cornerSpots=[[150,140],[W-150,140],[150,H-150],[W-150,H-150]];const cornerScore=cornerSpots.map(([cx,cy])=>{let s=0,n=0;for(let dy=-90;dy<=90;dy+=15)for(let dx=-90;dx<=90;dx+=15){const i=Math.floor((cy+dy)/CELL)*GW+Math.floor((cx+dx)/CELL);s+=mask[i]?0:Math.min(40,dSea[i]);n++}return s/n});
  let compassCorner=0;cornerScore.forEach((v,i)=>{if(v>cornerScore[compassCorner])compassCorner=i});
  const cartoucheCorner=[3,2,1,0].filter(i=>i!==compassCorner).sort((a,b)=>(cornerScore[b]+(b>=2?12:0))-(cornerScore[a]+(a>=2?12:0)))[0];
  const cartW=420,cartH=170;const cartRect={x:cartoucheCorner%2===0?40:W-40-cartW,y:cartoucheCorner>=2?H-40-cartH:40,w:cartW,h:cartH};
  const furniture={compass:{x:cornerSpots[compassCorner][0],y:cornerSpots[compassCorner][1]},cartouche:cartoucheCorner,cartoucheRect:cartRect};
  const nearFurniture=(px,py)=>Math.hypot(px-furniture.compass.x,py-furniture.compass.y)<170||(px>cartRect.x-30&&px<cartRect.x+cartRect.w+30&&py>cartRect.y-30&&py<cartRect.y+cartRect.h+30);

  /* 9. Settlements and roads */
  const towns=[];{const score=new Float32Array(N);
    for(let y=22;y<GH-22;y++)for(let x=22;x<GW-22;x++){const i=y*GW+x;if(!mask[i]||lakeMask[i]||h[i]>48||biome[i]===9)continue;let s=.2+moisture[i]*.6-(h[i]-20)/28;
      if(isRiver[i]){s+=1.2;if(!mask[down[i]]||lakeMask[down[i]])s+=2.6;let ups=0;for(const [dx,dy] of D8){const j=(y+dy)*GW+x+dx;if(isRiver[j]&&down[j]===i)ups++}if(ups>1)s+=1.6;s+=Math.log2(flow[i]/thrFlow+1)*.35}
      if(dLand[i]<=2.5)s+=1.4;if(biome[i]===2)s+=.25;if(biome[i]===6)s-=.6;if(biome[i]===8)s-=.5;if(nearFurniture(x*CELL,y*CELL))s-=3;score[i]=s+R()*.15}
    const want={kingdom:6,frozen:5,desert:5,islands:6}[kind]+(detail-2);const cand=[];for(let i=0;i<N;i++)if(score[i]>1.4)cand.push(i);cand.sort((a,b)=>score[b]-score[a]);
    for(const i of cand){if(towns.length>=want)break;const x=i%GW,y=(i-x)/GW;if(towns.some(t=>Math.hypot(t.cx-x,t.cy-y)<62))continue;towns.push({cx:x,cy:y,x:x*CELL+1,y:y*CELL+1,score:score[i],port:dLand[i]<=2.5,river:!!isRiver[i]})}
    towns.forEach((t,k)=>{t.type=k===0?'city':'town';t.name=names.town(temp[t.cy*GW+t.cx]<.35?'hard':'soft')});
    // ruins in wild highlands
    const ruinSpots=[];for(let i=0;i<N;i+=3){if(!mask[i])continue;const x=i%GW,y=(i-x)/GW;if(x<30||y<30||x>GW-30||y>GH-30)continue;if(h[i]>44&&h[i]<60&&dRiver[i]>6&&towns.every(t=>Math.hypot(t.cx-x,t.cy-y)>90))ruinSpots.push(i)}
    for(let k=0;k<2&&ruinSpots.length;k++){const i=ruinSpots[Math.floor(R()*ruinSpots.length)];const x=i%GW,y=(i-x)/GW;if(towns.some(t=>Math.hypot(t.cx-x,t.cy-y)<80))continue;towns.push({cx:x,cy:y,x:x*CELL+1,y:y*CELL+1,type:'ruin',name:'Ruins of '+names.word('hard')})}}
  const roads=[];{const settled=towns.filter(t=>t.type!=='ruin');if(settled.length>1){
    // minimum spanning tree over straight distance, then least-cost paths on the grid
    const inTree=[settled[0]],rest=settled.slice(1),pairs=[];while(rest.length){let best=null,bd=1e9;for(const a of inTree)for(const b of rest){const d=Math.hypot(a.cx-b.cx,a.cy-b.cy);if(d<bd){bd=d;best=[a,b]}}pairs.push(best);inTree.push(best[1]);rest.splice(rest.indexOf(best[1]),1)}
    const cost=new Float32Array(N);for(let i=0;i<N;i++){if(!mask[i]){cost[i]=lakeMask[i]?60:1e9;continue}const x=i%GW,y=(i-x)/GW;const gx=x<GW-1&&mask[i+1]?Math.abs(h[i+1]-h[i]):0,gy=y<GH-1&&mask[i+GW]?Math.abs(h[i+GW]-h[i]):0;cost[i]=1+(gx+gy)*4+(h[i]>62?9:h[i]>50?2.5:0)+(isRiver[i]?4:0)+(biome[i]===2?.8:0)+(lakeMask[i]?60:0)}
    for(const [a,b] of pairs){if(Math.hypot(a.cx-b.cx,a.cy-b.cy)>260)continue;const dist=new Float32Array(N).fill(1e9),prev=new Int32Array(N).fill(-1),done=new Uint8Array(N),hp=Heap(dist);const s=a.cy*GW+a.cx,g=b.cy*GW+b.cx;dist[s]=0;hp.push(s);let found=false,budget=260000;
      while(hp.size&&budget-->0){const i=hp.pop();if(done[i])continue;done[i]=1;if(i===g){found=true;break}const x=i%GW,y=(i-x)/GW;for(const [dx,dy] of D8){const nx=x+dx,ny=y+dy;if(nx<21||ny<21||nx>=GW-21||ny>=GH-21)continue;const j=ny*GW+nx;if(done[j]||cost[j]>=1e9)continue;const nd=dist[i]+cost[j]*(dx&&dy?1.414:1);if(nd<dist[j]){dist[j]=nd;prev[j]=i;hp.push(j)}}}
      if(!found)continue;const pts=[];for(let i=g;i>=0;i=prev[i])pts.push([(i%GW)*CELL+1,((i/GW)|0)*CELL+1]);roads.push(smoothLine(pts.filter((_,k)=>k%3===0||k===pts.length-1),2))}}}

  /* 10. Regions and labels */
  const labels=[];const usedNames=new Set();
  function interiorPoint(cells){const m=new Uint8Array(N);for(const c of cells)m[c]=1;const inv=new Uint8Array(N);for(let i=0;i<N;i++)inv[i]=m[i]?0:1;
    // distance inside the cluster: run chamfer from outside cells, restricted to the bounding box for speed
    let minx=GW,miny=GH,maxx=0,maxy=0;for(const c of cells){const x=c%GW,y=(c-x)/GW;if(x<minx)minx=x;if(x>maxx)maxx=x;if(y<miny)miny=y;if(y>maxy)maxy=y}
    const d=chamfer(inv).d;let best=-1,bi=cells[0];for(const c of cells)if(d[c]>best){best=d[c];bi=c}
    // principal axis
    let sx=0,sy=0;for(const c of cells){sx+=c%GW;sy+=(c/GW)|0}const n=cells.length,mx=sx/n,my=sy/n;let cxx=0,cyy=0,cxy=0;for(const c of cells){const dx=c%GW-mx,dy=((c/GW)|0)-my;cxx+=dx*dx;cyy+=dy*dy;cxy+=dx*dy}
    let angle=.5*Math.atan2(2*cxy,cxx-cyy);if(angle>Math.PI/2)angle-=Math.PI;if(angle<-Math.PI/2)angle+=Math.PI;angle=clamp(angle,-.42,.42);
    return{x:(bi%GW)*CELL+1,y:((bi/GW)|0)*CELL+1,radius:best*CELL,angle,extent:{w:(maxx-minx)*CELL,h:(maxy-miny)*CELL},size:n}}
  function placeLabel(p,name,maxWidth,small){const w=Math.min(maxWidth,name.length*(small?8:12.5));for(const dy of [0,-46,46,-92,92]){const yy=p.y+dy;if(yy<90||yy>H-90)continue;if(!labels.some(l=>Math.abs(l.y-yy)<(small?44:36)&&Math.abs(l.x-p.x)<(l.estW+w)/2+12))return{x:clamp(p.x,70+w/2,W-70-w/2),y:yy,estW:w}}return null}
  function addRegion(type,cells,flavor,minRadius){const p=interiorPoint(cells);if(p.radius<minRadius)return;const name=names.region(type,flavor);if(usedNames.has(name))return;const maxWidth=Math.max(140,Math.min(p.extent.w*.9,520));const spot=placeLabel(p,name,maxWidth,type==='lake'||type==='lakeBig');if(!spot)return;usedNames.add(name);labels.push({kind:type==='lakeBig'?'lake':type,name:name.toUpperCase(),x:spot.x,y:spot.y,estW:spot.estW,angle:p.angle,radius:p.radius,maxWidth,size:p.size})}
  const ranges=clusters(i=>mask[i]&&h[i]>=60,260);ranges.slice(0,3).forEach(c=>addRegion('mountain',c,'hard',9));
  const forests=clusters(i=>biome[i]===2,700);forests.slice(0,2).forEach(c=>addRegion('forest',c,'soft',12));
  const plains=clusters(i=>biome[i]===1,1400);plains.slice(0,2).forEach(c=>addRegion('plains',c,'soft',14));
  clusters(i=>biome[i]===6,1200).slice(0,2).forEach(c=>addRegion('desert',c,'hard',14));
  clusters(i=>biome[i]===7,350).slice(0,1).forEach(c=>addRegion('canyon',c,'hard',8));
  clusters(i=>biome[i]===5&&h[i]<87,900).slice(0,1).forEach(c=>addRegion('ice',c,'hard',12));
  clusters(i=>biome[i]===8,1200).slice(0,1).forEach(c=>addRegion('tundra',c,'hard',12));
  lakeGroups.slice(0,2).forEach(c=>{if(c.length>120)addRegion(c.length>420?'lakeBig':'lake',c,'soft',5)});
  // sea labels: the deepest open water, then a bay
  {const seaOK=i=>{const x=i%GW,y=(i-x)/GW;return !mask[i]&&dSea[i]>18&&Math.min(x,y,GW-1-x,GH-1-y)>38&&Math.hypot(x*CELL-furniture.compass.x,y*CELL-furniture.compass.y)>215&&!nearFurniture(x*CELL,y*CELL)};const groups=clusters(seaOK,300);groups.slice(0,2).forEach((g,k)=>{const p=interiorPoint(g);const type=k===0?'sea':'bay';if(k===1&&(g.length<900||p.radius<26))return;const name=names.region(type,'soft');const maxWidth=Math.min(620,p.radius*2.8);const spot=placeLabel(p,name,maxWidth);if(!spot)return;labels.push({kind:type,name:name.toUpperCase(),x:spot.x,y:spot.y,estW:spot.estW,angle:p.angle*.6,radius:p.radius,maxWidth,size:g.length})})}
  rivers.slice(0,3).forEach((r,k)=>{if(r.length>160)r.name=names.region('river','soft')});
  labels.forEach(l=>{l.x=clamp(l.x,120,W-120);l.y=clamp(l.y,90,H-90);if(l.x>cartRect.x-40&&l.x<cartRect.x+cartRect.w+40&&l.y>cartRect.y-30&&l.y<cartRect.y+cartRect.h+30)l.y=cartRect.y>H/2?cartRect.y-40:cartRect.y+cartRect.h+40});

  /* 11. Symbols for the ink view */
  const features=placeSymbols({mask,h,biome,temp,moisture,dRiver,dLand,lakeMask,isRiver,towns,labels,detail,kind,R:rng(seed^0xabcdef)});

  /* Camera shots for the reveal film, derived from real regions */
  const shots=[];const focusable=labels.filter(l=>['mountain','forest','canyon','desert','plains','ice'].includes(l.kind)).slice(0,4);
  focusable.forEach(l=>shots.push({name:l.name,x:l.x,y:l.y,zoom:2.2+Math.min(.5,120/Math.max(60,l.radius))}));

  const stats={landCells:landCount,riverCells,lakes:lakeGroups.length,towns:towns.length,ms:Date.now()-t0};
  const model={W,H,GW,GH,CELL,seed,kind,detail,rugged,traits,mask,h,hRender,level,flow,down,dLand,dSea,dRiver,moisture,temp,biome,BIOMES,lakeMask,isRiver,thrFlow,coast,contours,seaRings,lakes,rivers,towns,roads,labels,features,spines:spines.map(s=>({a:s.a,b:s.b,c:s.c,type:s.type})),shots,stats,names,furniture,
    sampleHeight(px,py){const gx=clamp(px/CELL-.5,0,GW-1.001),gy=clamp(py/CELL-.5,0,GH-1.001),x0=Math.floor(gx),y0=Math.floor(gy),u=gx-x0,v=gy-y0,i=y0*GW+x0;return hRender[i]*(1-u)*(1-v)+hRender[i+1]*u*(1-v)+hRender[i+GW]*(1-u)*v+hRender[i+GW+1]*u*v},
    cellAt(px,py){const x=clamp(Math.floor(px/CELL),0,GW-1),y=clamp(Math.floor(py/CELL),0,GH-1);return y*GW+x},
    onLand(px,py){return mask[this.cellAt(px,py)]===1&&!lakeMask[this.cellAt(px,py)]}};
  return model}

/* ---------- Symbol placement ---------- */
function placeSymbols(ctx){
  const{mask,h,biome,temp,moisture,dRiver,dLand,lakeMask,towns,labels,detail,kind,R}=ctx;
  const features=[];const occ=[];const BUCKET=40,cols=Math.ceil(W/BUCKET),rows=Math.ceil(H/BUCKET),grid=Array.from({length:cols*rows},()=>[]);
  const density=[.62,.82,1][detail-1]||1;
  function free(x,y,r){const c0=Math.max(0,Math.floor((x-r)/BUCKET)),c1=Math.min(cols-1,Math.floor((x+r)/BUCKET)),r0=Math.max(0,Math.floor((y-r)/BUCKET)),r1=Math.min(rows-1,Math.floor((y+r)/BUCKET));for(let cy=r0;cy<=r1;cy++)for(let cx=c0;cx<=c1;cx++)for(const o of grid[cy*cols+cx]){if(Math.hypot(o.x-x,o.y-y)<o.r+r)return false}return true}
  function take(x,y,r){grid[Math.floor(y/BUCKET)*cols+Math.floor(x/BUCKET)].push({x,y,r})}
  const cell=(x,y)=>Math.floor(y/CELL)*GW+Math.floor(x/CELL);
  // reserve label zones and towns
  for(const l of labels)if(l.kind!=='sea'&&l.kind!=='bay'){take(l.x,l.y,Math.min(l.maxWidth/2,90));take(l.x-Math.min(l.maxWidth/2,90)*.6,l.y,40);take(l.x+Math.min(l.maxWidth/2,90)*.6,l.y,40)}
  for(const t of towns){const s=t.type==='city'?20:t.type==='ruin'?12:14;const f={x:t.x,y:t.y,type:t.type,s,v:R(),name:t.name,birth:.86+R()*.06,bounds:{x:t.x-s*1.5,y:t.y-s*1.4,w:s*3,h:s*2.2}};features.push(f);take(t.x,t.y,s*1.6)}
  // mountains first (big → small), on a jittered grid
  const cand=[];
  for(let y=48;y<H-48;y+=7)for(let x=48;x<W-48;x+=7){const xx=x+(R()-.5)*7,yy=y+(R()-.5)*7;const i=cell(xx,yy);if(!mask[i]||lakeMask[i])continue;const e=h[i],b=biome[i];
    if(e>=58&&R()<.7*density){const s=11+Math.pow((e-58)/40,1.15)*30;cand.push({x:xx,y:yy,type:e>=84||b===5?'peak':'mountain',s,e,pri:0,r:s*.38})}
    else if(e>=48&&b!==5&&R()<.2*density){const s=7+(e-48)/10*6;cand.push({x:xx,y:yy,type:'hill',s,e,pri:1,r:s*1.0})}}
  cand.sort((a,b)=>a.pri-b.pri||b.e-a.e);
  for(const c of cand){if(!free(c.x,c.y,c.r))continue;if(c.type!=='peak'&&c.type!=='mountain'&&dRiver[cell(c.x,c.y)]<2.5)continue;take(c.x,c.y,c.r);features.push({x:c.x,y:c.y,type:c.type,s:c.s,v:R(),birth:.16+c.x/W*.16+R()*.03,bounds:{x:c.x-c.s*.9,y:c.y-c.s,w:c.s*1.8,h:c.s*1.1}})}
  // trees, dunes, grass, marsh
  const step=6;for(let y=46;y<H-46;y+=step)for(let x=46;x<W-46;x+=step){const xx=x+(R()-.5)*step*1.4,yy=y+(R()-.5)*step*1.4;const i=cell(xx,yy);if(!mask[i]||lakeMask[i])continue;const b=biome[i];let type=null,s=0,r=0,p=0;
    if(b===2){type=temp[i]<.42?'conifer':'broadleaf';const dens=clamp((moisture[i]-.6)*2.4+.55,.35,1);s=type==='conifer'?7.5+R()*3.5:6+R()*3;r=s*.42;p=.74*dens*density}
    else if(b===6){type='dune';s=9+R()*7;r=s*1.3;p=.22*density}
    else if(b===1&&R()<.045*density){type='grass';s=4+R()*2;r=9;p=1}
    else if(b===8&&R()<.05*density){type='grass';s=3.5;r=10;p=1}
    else if(b===9){type='marsh';s=6+R()*3;r=8;p=.5*density}
    else if(b===3&&R()<.06*density&&dRiver[i]>3){type='hill';s=7+R()*3;r=s;p=1}
    if(!type||R()>p)continue;if(dRiver[i]<(type==='marsh'?0:2.2))continue;if(!free(xx,yy,r))continue;take(xx,yy,r);
    features.push({x:xx,y:yy,type,s,v:R(),birth:type==='conifer'||type==='broadleaf'?.38+yy/H*.14+R()*.04:.6+xx/W*.1+R()*.05,bounds:{x:xx-r,y:yy-s,w:r*2,h:s+r}})}
  features.sort((a,b)=>a.y-b.y);return features}

root.Atlas={build,rng,makeNoise,isolines,smoothLine,lineLength,chamfer,clusters,W,H,GW,GH,CELL};
if(typeof module!=='undefined')module.exports=root.Atlas;
})(typeof window!=='undefined'?window:globalThis);
