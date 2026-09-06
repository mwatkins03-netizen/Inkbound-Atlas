/* Inkbound Atlas — renderer. Two views over one model:
   "ink"    — a traditional hand-drawn chart: parchment washes, coast rings, terrain symbols, labels along arcs.
   "relief" — a topographic atlas: hypsometric tint, hillshade, smooth contours, vector rivers.
   Glyphs are written against the Canvas 2D API; SvgContext replays the same calls into SVG for the symbol sheet. */
(function(root){
'use strict';
const A=root.Atlas,{W,H,GW,GH,CELL}=A;
const clamp=(v,a,b)=>v<a?a:v>b?b:v,lerp=(a,b,t)=>a+(b-a)*t,ss=(a,b,x)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t)};
const hex=c=>[parseInt(c.slice(1,3),16),parseInt(c.slice(3,5),16),parseInt(c.slice(5,7),16)];
const mix=(a,b,t)=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t];
const rgb=c=>`rgb(${c[0]|0},${c[1]|0},${c[2]|0})`;
const SERIF='"Cormorant Garamond","Cormorant",Georgia,"Times New Roman",serif';

const PALETTES={
  parchment:{name:'Walnut ink / aged parchment',paper:'#e8dab6',paperDeep:'#cdb98d',land:'#ecdfbd',ink:'#3a2b18',inkSoft:'#7a6446',seaInk:'#8a7656',water:'#7d9aa3',waterDeep:'#5c7c86',waterInk:'#4d6a72',
    forest:'#7f8f5f',forestFill:'#a8b184',forestInk:'#4f5d3a',mountainWash:'#a08a6c',mountainFill:'#e4d6b4',snow:'#f6f1e4',sand:'#d8bf86',canyon:'#c48a5e',marsh:'#93a07c',tundra:'#c9c3a8',ice:'#dfe6e2',road:'#6f4f30',gold:'#a8863f',
    reliefSea:'#d6d9c9',reliefSeaDeep:'#b7c1b8',reliefPaper:'#e4d9bd',
    hypso:[[20,'#a4b489'],[27,'#bcc48f'],[36,'#d7cf9c'],[46,'#d2b984'],[56,'#bd9a6c'],[66,'#a3805c'],[78,'#8e7466'],[88,'#b3a89b'],[98,'#f5f2ea']]},
  ivory:{name:'Graphite / ivory paper',paper:'#f0eee4',paperDeep:'#d9d6c6',land:'#f6f4ea',ink:'#2a2e2d',inkSoft:'#5c6361',seaInk:'#8a8e88',water:'#8a9aa0',waterDeep:'#66787f',waterInk:'#4f5f66',
    forest:'#8c9685',forestFill:'#c6ccbb',forestInk:'#4c554e',mountainWash:'#9b9a92',mountainFill:'#eeece2',snow:'#ffffff',sand:'#e0d8bf',canyon:'#c9a88b',marsh:'#a9b0a0',tundra:'#d7d5c8',ice:'#e9edeb',road:'#5c5a52',gold:'#7c7461',
    reliefSea:'#dfe2dd',reliefSeaDeep:'#c4cbc9',reliefPaper:'#eeece3',
    hypso:[[20,'#b8c2a8'],[27,'#c9cfae'],[36,'#dcdcbf'],[46,'#d8cdb0'],[56,'#c7b69b'],[66,'#ad9c86'],[78,'#958a7e'],[88,'#b8b2a9'],[98,'#f7f6f2']]},
  night:{name:'Starlight / midnight blue',paper:'#152838',paperDeep:'#0d1a26',land:'#1c3244',ink:'#e8e0c4',inkSoft:'#b8b199',seaInk:'#5d7d90',water:'#7fb2c2',waterDeep:'#5a8ea0',waterInk:'#a9d3df',
    forest:'#4f7f6d',forestFill:'#2f5a50',forestInk:'#a9c9b6',mountainWash:'#4b6580',mountainFill:'#22384c',snow:'#dbe6ec',sand:'#6d6650',canyon:'#7a5b47',marsh:'#3f6a5e',tundra:'#3e5566',ice:'#4c6f80',road:'#d1b784',gold:'#d6b777',
    reliefSea:'#1b3040',reliefSeaDeep:'#10202d',reliefPaper:'#182b3b',
    hypso:[[20,'#2f5a4c'],[27,'#3c6a55'],[36,'#57785a'],[46,'#6e7b5a'],[56,'#7d7358'],[66,'#7e6a5a'],[78,'#7d7370'],[88,'#a4a7ab'],[98,'#e6ecf0']]}};

const caches=new WeakMap();
function cache(model){let c=caches.get(model);if(!c){c={};caches.set(model,c)}return c}

/* ---------- Path2D builders ---------- */
function pathOf(lines){const p=new Path2D();for(const l of lines){if(l.length<2)continue;p.moveTo(l[0][0],l[0][1]);for(let i=1;i<l.length;i++)p.lineTo(l[i][0],l[i][1]);if(l.closed)p.closePath()}return p}
function partialPath(lines,frac){const p=new Path2D();for(const l of lines){const n=Math.max(2,Math.floor(l.length*frac));p.moveTo(l[0][0],l[0][1]);for(let i=1;i<n&&i<l.length;i++)p.lineTo(l[i][0],l[i][1]);if(l.closed&&n>=l.length)p.closePath()}return p}
function geometry(model){const c=cache(model);if(c.geo)return c.geo;
  const land=pathOf(model.coast);const seaClip=new Path2D();seaClip.rect(0,0,W,H);seaClip.addPath(land);
  const lakes=pathOf(model.lakes);
  const contoursRegular=pathOf(model.contours.filter(c=>!c.index).flatMap(c=>c.lines)),contoursIndex=pathOf(model.contours.filter(c=>c.index).flatMap(c=>c.lines));
  const rings=model.seaRings.map(pathOf);
  const riverRibbons=model.rivers.map(r=>ribbon(r.points,r.widths));
  c.geo={land,seaClip,lakes,contoursRegular,contoursIndex,rings,riverRibbons};return c.geo}
function ribbon(pts,widths,frac=1){const n=Math.max(2,Math.floor(pts.length*frac));const L=[],Rr=[];for(let i=0;i<n;i++){const p=pts[i],a=pts[Math.max(0,i-1)],b=pts[Math.min(n-1,i+1)];let dx=b[0]-a[0],dy=b[1]-a[1];const len=Math.hypot(dx,dy)||1;dx/=len;dy/=len;const w=widths[i]*(i<3?.55+i*.15:1)/2;L.push([p[0]-dy*w,p[1]+dx*w]);Rr.push([p[0]+dy*w,p[1]-dx*w])}
  const p=new Path2D();p.moveTo(L[0][0],L[0][1]);for(let i=1;i<L.length;i++)p.lineTo(L[i][0],L[i][1]);for(let i=Rr.length-1;i>=0;i--)p.lineTo(Rr[i][0],Rr[i][1]);p.closePath();return p}

/* ---------- Rasters ---------- */
function hypsoLUT(pal){const stops=pal.hypso.map(([h,c])=>[h,hex(c)]);const lut=new Array(256);for(let k=0;k<256;k++){const hgt=20+k/255*78;let i=0;while(i<stops.length-2&&stops[i+1][0]<hgt)i++;const [h0,c0]=stops[i],[h1,c1]=stops[i+1];lut[k]=mix(c0,c1,clamp((hgt-h0)/(h1-h0),0,1))}return lut}
function upsampleHeights(model,scale){const RW=Math.round(W*scale),RH=Math.round(H*scale),hi=new Float32Array(RW*RH),h=model.hRender||model.h;
  for(let y=0;y<RH;y++){const gy=clamp((y+.5)/scale/CELL-.5,0,GH-1.001),y0=Math.floor(gy),v=gy-y0;for(let x=0;x<RW;x++){const gx=clamp((x+.5)/scale/CELL-.5,0,GW-1.001),x0=Math.floor(gx),u=gx-x0,i=y0*GW+x0;hi[y*RW+x]=h[i]*(1-u)*(1-v)+h[i+1]*u*(1-v)+h[i+GW]*(1-u)*v+h[i+GW+1]*u*v}}
  // two separable 3-tap smoothing passes remove bilinear facets
  const tmp=new Float32Array(RW*RH);for(let pass=0;pass<2;pass++){for(let y=0;y<RH;y++)for(let x=1;x<RW-1;x++){const k=y*RW+x;tmp[k]=(hi[k-1]+hi[k]*2+hi[k+1])*.25}for(let y=1;y<RH-1;y++)for(let x=1;x<RW-1;x++){const k=y*RW+x;hi[k]=(tmp[k-RW]+tmp[k]*2+tmp[k+RW])*.25}}
  return{hi,RW,RH}}
function reliefRaster(model,pal,layers,scale){const c=cache(model);const key='relief|'+pal.name+'|'+scale+'|'+!!layers.forest;if(c[key])return c[key];
  const {hi,RW,RH}=c['hi'+scale]||(c['hi'+scale]=upsampleHeights(model,scale));const cv=document.createElement('canvas');cv.width=RW;cv.height=RH;const g=cv.getContext('2d'),img=g.createImageData(RW,RH),d=img.data;
  const lut=hypsoLUT(pal),paper=hex(pal.reliefPaper),seaA=hex(pal.reliefSea),seaB=hex(pal.reliefSeaDeep),forest=hex(pal.forest),sand=hex(pal.sand),canyon=hex(pal.canyon),marsh=hex(pal.marsh),snow=hex(pal.snow),tundra=hex(pal.tundra),ink=hex(pal.ink),water=hex(pal.water);
  const night=pal===PALETTES.night;const biome=model.biome,lakeMask=model.lakeMask,moisture=model.moisture;
  const Lx=-.52,Ly=-.58,Lz=.63;const kz=scale*CELL*.5;// height units → px slope exaggeration
  for(let y=0;y<RH;y++){const gy=clamp(Math.floor((y+.5)/scale/CELL),0,GH-1);for(let x=0;x<RW;x++){const k=y*RW+x,gx=clamp(Math.floor((x+.5)/scale/CELL),0,GW-1),ci=gy*GW+gx,hgt=hi[k];let col;
    const grain=((Math.imul(x*73856093^y*19349663,2654435761)>>>0)%1000)/1000-.5;
    if(hgt>=20){col=lut[clamp(Math.round((hgt-20)/78*255),0,255)].slice();const b=biome[ci];
      if(b===2&&layers.forest){const dots=grain>.31?1:0;col=mix(col,forest,.42+dots*.22*(1-(hgt-20)/78))}
      else if(b===6)col=mix(col,sand,.5);else if(b===7)col=mix(col,canyon,.33);else if(b===9)col=mix(col,marsh,.45);else if(b===8)col=mix(col,tundra,.35);else if(b===5)col=mix(col,snow,.55);
      if(b===10||lakeMask[ci])col=mix(col,water,.85);
      const dzdx=(hi[Math.min(RW*RH-1,k+1)]-hi[Math.max(0,k-1)])*kz,dzdy=(hi[Math.min(RW*RH-1,k+RW)]-hi[Math.max(0,k-RW)])*kz;const inv=1/Math.sqrt(dzdx*dzdx+dzdy*dzdy+1);const shade=clamp((-dzdx*Lx-dzdy*Ly+Lz)*inv,0,1);
      const slope=Math.min(1,Math.hypot(dzdx,dzdy)*.55);let lit=.64+.52*shade;lit*=1-slope*.1;col=[col[0]*lit,col[1]*lit,col[2]*lit];
      col=mix(col,paper,.08*(hgt-20)/78);if(night)col=mix(col,paper,.15)}
    else{const depth=clamp(20-hgt,0,12);let t=ss(0,11,depth);col=mix(seaA,seaB,t);const band=Math.floor(depth/2.6);col=mix(col,seaB,band*.045);if(depth<1.4)col=mix(col,paper,.35*(1-depth/1.4))}
    const gr=grain*7;d[k*4]=col[0]+gr;d[k*4+1]=col[1]+gr;d[k*4+2]=col[2]+gr;d[k*4+3]=255}}
  g.putImageData(img,0,0);c[key]=cv;return cv}
function washRaster(model,pal){const c=cache(model);const key='wash|'+pal.name;if(c[key])return c[key];
  const cv=document.createElement('canvas');cv.width=GW;cv.height=GH;const g=cv.getContext('2d'),img=g.createImageData(GW,GH),d=img.data;
  const land=hex(pal.land),forest=hex(pal.forestFill),mtn=hex(pal.mountainWash),snow=hex(pal.snow),sand=hex(pal.sand),canyon=hex(pal.canyon),marsh=hex(pal.marsh),tundra=hex(pal.tundra),ice=hex(pal.ice),paper=hex(pal.paper),water=hex(pal.water),deep=hex(pal.paperDeep);
  const {biome,h,dSea,mask,moisture,temp}=model;const src=new Float32Array(GW*GH*3);
  for(let i=0;i<GW*GH;i++){let col;if(!mask[i]){const t=ss(0,60,dSea[i]);col=mix(mix(water,paper,.72),paper,t*.9)}else{col=land.slice();const b=biome[i],e=(h[i]-20)/78;
      if(b===2)col=mix(col,forest,.55+.2*clamp(moisture[i]-.6,0,.4));else if(b===4)col=mix(col,mtn,.28+e*.5);else if(b===3)col=mix(col,mtn,.16);else if(b===5)col=mix(col,ice,.7);else if(b===6)col=mix(col,sand,.6);else if(b===7)col=mix(col,canyon,.45);else if(b===9)col=mix(col,marsh,.5);else if(b===8)col=mix(col,tundra,.5);else if(b===1)col=mix(col,sand,.14+.1*(1-moisture[i]));
      if(h[i]>87)col=mix(col,snow,.6)}src[i*3]=col[0];src[i*3+1]=col[1];src[i*3+2]=col[2]}
  // blur washes for a watercolor feel
  let a=src,b=new Float32Array(src.length);for(let pass=0;pass<3;pass++){for(let y=1;y<GH-1;y++)for(let x=1;x<GW-1;x++){const i=y*GW+x;for(let ch=0;ch<3;ch++){b[i*3+ch]=(a[(i-GW)*3+ch]+a[(i+GW)*3+ch]+a[(i-1)*3+ch]+a[(i+1)*3+ch]+a[i*3+ch]*2)/6}}const t=a;a=b;b=t}
  for(let i=0;i<GW*GH;i++){const gr=(((i*2654435761)>>>0)%100)/100-.5;d[i*4]=a[i*3]+gr*5;d[i*4+1]=a[i*3+1]+gr*5;d[i*4+2]=a[i*3+2]+gr*5;d[i*4+3]=255}
  g.putImageData(img,0,0);c[key]=cv;return cv}
function paperTexture(pal){const key='paper|'+pal.name;if(paperTexture[key])return paperTexture[key];const cv=document.createElement('canvas');cv.width=cv.height=256;const g=cv.getContext('2d'),img=g.createImageData(256,256),d=img.data;const R=A.rng(77);const dark=pal===PALETTES.night;
  for(let i=0;i<256*256;i++){const v=R();const fiber=Math.sin(i%256*.9+Math.floor(i/256)*.13)*.5;const t=(v-.5)*22+fiber*6;d[i*4]=d[i*4+1]=d[i*4+2]=dark?90+t:128+t;d[i*4+3]=dark?26:34}
  g.putImageData(img,0,0);paperTexture[key]=cv;return cv}

/* ---------- Glyphs (canvas-style API; also replayed into SVG) ---------- */
function glyph(g,f,pal,view){const s=f.s,R=A.rng(Math.floor((f.v||.5)*1e9)+7);const j=k=>(R()-.5)*k;const ink=pal.ink;
  g.save();g.translate(f.x,f.y);g.lineJoin='round';g.lineCap='round';g.strokeStyle=ink;g.fillStyle=pal.mountainFill;g.lineWidth=.9;
  const poly=(pts,close)=>{g.beginPath();pts.forEach((p,i)=>i?g.lineTo(p[0],p[1]):g.moveTo(p[0],p[1]));if(close)g.closePath()};
  switch(f.type){
    case 'mountain':case 'peak':{const peak=f.type==='peak';const wL=s*(.72+R()*.3),wR=s*(.66+R()*.34),px=j(s*.3);
      const shoulder=R()<.35;const left=shoulder?[[-wL,0],[-wL*.72+j(s*.06),-s*.4+j(s*.05)],[-wL*.52,-s*(.58+R()*.12)],[-wL*.4,-s*.5+j(s*.04)],[-wL*.2+j(s*.05),-s*.78],[px,-s]]:[[-wL,0],[-wL*.66+j(s*.1),-s*.36+j(s*.08)],[-wL*.34+j(s*.08),-s*.7+j(s*.07)],[px,-s]];const right=[[px,-s],[px+wR*.28+j(s*.08),-s*.66+j(s*.07)],[px+wR*.6+j(s*.1),-s*.33+j(s*.08)],[wR,0]];
      const ridge=[[px,-s],[px+wR*.1+j(s*.05),-s*.62],[px+wR*.06+j(s*.06),-s*.3],[px+wR*.2,0]];
      poly([...left,...right.slice(1)],true);g.fillStyle=pal.mountainFill;g.fill();g.lineWidth=.95;g.stroke();
      // shadow face
      poly([...ridge,...right.slice(1).reverse()],true);g.fillStyle=pal.mountainWash;g.globalAlpha=.5;g.fill();g.globalAlpha=1;
      g.lineWidth=.6;const n=5+Math.floor(s/7);for(let k=1;k<=n;k++){const t=k/(n+1);const a=bez(ridge,t),b=bez(right,Math.min(1,t*1.04));g.beginPath();g.moveTo(a[0],a[1]);g.lineTo(lerp(a[0],b[0],.9+R()*.08),lerp(a[1],b[1],.9));g.globalAlpha=.6;g.stroke()}g.globalAlpha=1;
      if(shoulder){g.lineWidth=.5;g.globalAlpha=.5;for(let k=0;k<3;k++){const a=bez(left,.3+k*.08);g.beginPath();g.moveTo(a[0],a[1]);g.lineTo(a[0]+s*.08,a[1]+s*.16+k*s*.03);g.stroke()}g.globalAlpha=1}
      g.lineWidth=.7;poly(ridge);g.stroke();
      // light-side texture
      g.lineWidth=.45;g.globalAlpha=.45;for(let k=0;k<2;k++){const t=.35+k*.3;const a=bez(left,t);g.beginPath();g.moveTo(a[0]+s*.06,a[1]+s*.04);g.lineTo(a[0]-s*.12,a[1]+s*.28);g.stroke()}g.globalAlpha=1;
      if(peak||s>30){const cap=[[px,-s]];const y0=-s*(.66+R()*.08);for(let k=0;k<=4;k++){const t=k/4;cap.push([lerp(bez(left,.72)[0],bez(right,.3)[0],t),y0+(k%2?s*.05:-s*.03)+j(s*.02)])}
        poly([cap[0],...cap.slice(1)].concat([[px,-s]]),true);
        g.beginPath();g.moveTo(px,-s);const lp=bez(left,.74),rp=bez(right,.28);g.lineTo(lp[0],lp[1]);for(let k=1;k<4;k++)g.lineTo(lerp(lp[0],rp[0],k/4),lerp(lp[1],rp[1],k/4)+(k%2?s*.06:-s*.02));g.lineTo(rp[0],rp[1]);g.closePath();g.fillStyle=pal.snow;g.fill();g.lineWidth=.6;g.stroke()}
      break}
    case 'hill':{const w=s*1.6;g.beginPath();g.moveTo(-w,0);g.bezierCurveTo(-w*.55,-s*1.18+j(s*.1),w*.25+j(s*.1),-s*1.15,w,0);g.fillStyle=pal.mountainFill;g.fill();g.lineWidth=.8;g.stroke();
      g.lineWidth=.5;g.globalAlpha=.6;for(let k=0;k<3;k++){const x0=w*.15+k*w*.22;g.beginPath();g.moveTo(x0,-s*.62+k*s*.16);g.lineTo(x0+w*.3,-s*.05+k*s*.02);g.stroke()}g.globalAlpha=1;break}
    case 'conifer':{g.beginPath();g.moveTo(0,-s*.1);g.lineTo(0,s*.42);g.lineWidth=.9;g.stroke();
      for(let k=0;k<3;k++){const yy=-s+k*s*.33,ww=s*(.2+k*.14);g.beginPath();g.moveTo(j(1)*.5,yy);g.lineTo(-ww+j(1.2),yy+s*.5);g.lineTo(ww*.25,yy+s*.42);g.lineTo(ww+j(1.2),yy+s*.5);g.closePath();g.fillStyle=pal.forestFill;g.fill();g.lineWidth=.6;g.stroke();
        g.beginPath();g.moveTo(ww*.25,yy+s*.42);g.lineTo(ww*.75,yy+s*.48);g.lineWidth=.5;g.globalAlpha=.5;g.stroke();g.globalAlpha=1}break}
    case 'broadleaf':{g.beginPath();g.moveTo(0,s*.05);g.lineTo(0,s*.45);g.moveTo(0,s*.2);g.lineTo(-s*.18,s*.45);g.moveTo(0,s*.2);g.lineTo(s*.2,s*.45);g.lineWidth=.9;g.stroke();
      const rx=s*.62,ry=s*.52,pts=[];for(let k=0;k<9;k++){const a=k/9*Math.PI*2,r=.86+R()*.28;pts.push([Math.cos(a)*rx*r,-s*.42+Math.sin(a)*ry*r])}
      g.beginPath();for(let k=0;k<9;k++){const p=pts[k],q=pts[(k+1)%9],m=[(p[0]+q[0])/2,(p[1]+q[1])/2];if(!k)g.moveTo(m[0],m[1]);const n=pts[(k+1)%9];const nm=[(n[0]+pts[(k+2)%9][0])/2,(n[1]+pts[(k+2)%9][1])/2];g.quadraticCurveTo(n[0],n[1],nm[0],nm[1])}g.closePath();g.fillStyle=pal.forestFill;g.fill();g.lineWidth=.65;g.stroke();
      g.lineWidth=.5;g.globalAlpha=.55;for(let k=0;k<3;k++){g.beginPath();g.moveTo(rx*.05+k*rx*.22,-s*.2+k*s*.03);g.lineTo(rx*.3+k*rx*.2,-s*.05-k*s*.04);g.stroke()}g.globalAlpha=1;break}
    case 'dune':{const w=s*1.5;g.lineWidth=.8;g.beginPath();g.moveTo(-w,0);g.quadraticCurveTo(-w*.25,-s*.6+j(s*.1),w*.55,-s*.05);g.stroke();g.beginPath();g.moveTo(-w*.1,s*.12);g.quadraticCurveTo(w*.3,-s*.2,w,s*.05);g.lineWidth=.6;g.stroke();
      g.lineWidth=.45;g.globalAlpha=.55;for(let k=0;k<3;k++){g.beginPath();g.moveTo(w*.05+k*w*.15,-s*.28+k*s*.09);g.lineTo(w*.2+k*w*.15,-s*.05+k*s*.03);g.stroke()}g.globalAlpha=1;break}
    case 'grass':{g.lineWidth=.6;for(let k=-1;k<=1;k++){g.beginPath();g.moveTo(k*s*.55,0);g.lineTo(k*s*.55+k*s*.2,-s*(.7+R()*.4));g.stroke()}g.beginPath();g.moveTo(-s*.8,0);g.lineTo(s*.8,0);g.globalAlpha=.6;g.stroke();g.globalAlpha=1;break}
    case 'marsh':{g.lineWidth=.6;g.beginPath();g.moveTo(-s,0);g.lineTo(s,0);g.moveTo(-s*.6,s*.35);g.lineTo(s*.6,s*.35);g.globalAlpha=.7;g.stroke();g.globalAlpha=1;for(let k=-1;k<=1;k++){g.beginPath();g.moveTo(k*s*.45,0);g.lineTo(k*s*.45+j(1),-s*(.6+R()*.4));g.stroke()}break}
    case 'town':{const house=(x,y,w,h)=>{g.beginPath();g.rect(x-w/2,y-h,w,h);g.fillStyle=pal.mountainFill;g.fill();g.lineWidth=.8;g.stroke();g.beginPath();g.moveTo(x-w/2-1,y-h);g.lineTo(x,y-h-w*.6);g.lineTo(x+w/2+1,y-h);g.closePath();g.fillStyle=pal.mountainWash;g.fill();g.stroke()};
      house(-s*.55,0,s*.55,s*.4);house(s*.5,s*.05,s*.6,s*.45);house(0,-s*.1,s*.5,s*.75);g.beginPath();g.moveTo(0,-s*1.15);g.lineTo(0,-s*1.5);g.lineTo(s*.28,-s*1.4);g.lineTo(0,-s*1.3);g.lineWidth=.8;g.stroke();
      g.beginPath();g.moveTo(-s*1.1,s*.08);g.lineTo(s*1.1,s*.08);g.lineWidth=.6;g.globalAlpha=.6;g.stroke();g.globalAlpha=1;break}
    case 'castle':{const tw=(x,y,w,h,roof)=>{g.beginPath();g.rect(x-w/2,y-h,w,h);g.fillStyle=pal.mountainFill;g.fill();g.lineWidth=.85;g.stroke();for(let k=-1;k<=1;k++){g.beginPath();g.rect(x+k*w*.3-w*.1,y-h-roof*.35,w*.2,roof*.35);g.fill();g.stroke()}};
      g.beginPath();g.moveTo(-s*1.2,s*.05);g.lineTo(s*1.2,s*.05);g.lineWidth=.6;g.globalAlpha=.6;g.stroke();g.globalAlpha=1;
      g.beginPath();g.rect(-s*.75,-s*.55,s*1.5,s*.6);g.fillStyle=pal.mountainWash;g.globalAlpha=.4;g.fill();g.globalAlpha=1;g.lineWidth=.85;g.stroke();g.lineWidth=.5;for(let k=-2;k<=2;k++){g.beginPath();g.moveTo(k*s*.3,-s*.55);g.lineTo(k*s*.3,-s*.3);g.stroke()}
      tw(-s*.85,0,s*.45,s*.95,s*.3);tw(s*.85,0,s*.45,s*.95,s*.3);tw(0,-s*.1,s*.6,s*1.35,s*.35);g.beginPath();g.moveTo(0,-s*1.55);g.lineTo(0,-s*1.95);g.lineTo(s*.3,-s*1.82);g.lineTo(0,-s*1.72);g.fillStyle=pal.gold;g.fill();g.lineWidth=.7;g.stroke();
      g.beginPath();g.arc(0,s*.05,s*.14,Math.PI,0);g.fillStyle=pal.ink;g.fill();break}
    case 'city':{const city=true;g.beginPath();g.ellipse(0,0,s*1.15,s*.5,0,0,Math.PI*2);g.fillStyle=pal.mountainFill;g.fill();g.lineWidth=.9;g.stroke();
      // wall
      g.beginPath();g.ellipse(0,0,s*1.15,s*.5,0,Math.PI*.05,Math.PI*.95);g.lineTo(-s*1.15*Math.cos(Math.PI*.05),-s*.34);g.ellipse(0,-s*.34,s*1.15,s*.5,0,Math.PI*.95,Math.PI*.05,true);g.closePath();g.fillStyle=pal.mountainWash;g.globalAlpha=.35;g.fill();g.globalAlpha=1;g.stroke();
      g.lineWidth=.5;for(let k=-3;k<=3;k++){const x=k*s*.28;g.beginPath();g.moveTo(x,s*.5*Math.sqrt(Math.max(0,1-(x/(s*1.15))**2)));g.lineTo(x,s*.5*Math.sqrt(Math.max(0,1-(x/(s*1.15))**2))-s*.3);g.stroke()}
      const tower=(x,y,w,h,roof)=>{g.beginPath();g.rect(x-w/2,y-h,w,h);g.fillStyle=pal.mountainFill;g.fill();g.lineWidth=.8;g.stroke();g.beginPath();g.moveTo(x-w/2-1,y-h);g.lineTo(x,y-h-roof);g.lineTo(x+w/2+1,y-h);g.closePath();g.fillStyle=pal.mountainWash;g.fill();g.stroke()};
      tower(-s*.95,s*.15,s*.3,s*.6,s*.3);tower(s*.95,s*.15,s*.3,s*.6,s*.3);tower(-s*.35,-s*.1,s*.34,s*.9,s*.35);tower(s*.4,-s*.1,s*.34,s*.8,s*.32);tower(0,-s*.25,s*.5,s*1.2,s*.45);
      if(city){g.beginPath();g.moveTo(0,-s*1.9);g.lineTo(0,-s*2.35);g.lineTo(s*.32,-s*2.22);g.lineTo(0,-s*2.1);g.fillStyle=pal.gold;g.fill();g.lineWidth=.7;g.stroke()}break}
    case 'ruin':{g.lineWidth=.8;for(let k=0;k<3;k++){const x=(k-1)*s*.6,h=s*(.5+R()*.8);g.beginPath();g.rect(x-s*.12,-h,s*.24,h);g.fillStyle=pal.mountainFill;g.fill();g.stroke();g.beginPath();g.moveTo(x-s*.2,-h);g.lineTo(x+s*.2,-h);g.stroke()}
      g.beginPath();g.moveTo(-s*.9,s*.15);g.lineTo(s*.9,s*.15);g.lineWidth=.6;g.stroke();g.beginPath();g.rect(s*.35,-s*.15,s*.5,s*.22);g.fillStyle=pal.mountainFill;g.fill();g.stroke();break}
    case 'tree':{f.type='broadleaf';glyph(g,f,pal,view);f.type='tree';break}
    case 'label':{g.font=`italic 500 ${Math.max(12,s)}px ${SERIF}`;g.textAlign='center';g.fillStyle=pal.ink;g.fillText(f.name||'',0,0);break}
    default:break}
  g.restore()}
function bez(pts,t){// polyline interpolation by arc parameter
  const n=pts.length-1;const x=t*n,i=Math.min(n-1,Math.floor(x)),u=x-i;return[lerp(pts[i][0],pts[i+1][0],u),lerp(pts[i][1],pts[i+1][1],u)]}

/* ---------- Text along a path ---------- */
function arcPath(cx,cy,length,angle,bulge){const pts=[];const ca=Math.cos(angle),sa=Math.sin(angle);for(let k=0;k<=48;k++){const t=k/48,u=(t-.5)*length,v=-bulge*4*(t-.5)*(t-.5)+bulge;pts.push([cx+u*ca-v*sa,cy+u*sa+v*ca])}return pts}
function textAlongPath(g,text,pts,opts={}){const spacing=opts.spacing||0;const widths=[...text].map(ch=>g.measureText(ch).width+spacing);const total=widths.reduce((a,b)=>a+b,0)-spacing;
  const cum=[0];for(let i=1;i<pts.length;i++)cum.push(cum[i-1]+Math.hypot(pts[i][0]-pts[i-1][0],pts[i][1]-pts[i-1][1]));const L=cum[cum.length-1];let d=(L-total)/2+(opts.offset||0);if(d<0)d=0;
  const at=dist=>{let i=1;while(i<cum.length-1&&cum[i]<dist)i++;const t=(dist-cum[i-1])/Math.max(1e-6,cum[i]-cum[i-1]);const a=pts[i-1],b=pts[i];return[lerp(a[0],b[0],t),lerp(a[1],b[1],t),Math.atan2(b[1]-a[1],b[0]-a[0])]};
  g.save();g.textAlign='left';g.textBaseline='middle';[...text].forEach((ch,i)=>{const w=widths[i]-spacing;const [x,y,ang]=at(d+w/2);g.save();g.translate(x,y);g.rotate(ang);if(opts.halo){g.lineWidth=opts.haloWidth||3;g.strokeStyle=opts.halo;g.lineJoin='round';g.strokeText(ch,-w/2,0)}g.fillText(ch,-w/2,0);g.restore();d+=widths[i]});g.restore();return total}

/* ---------- Layer painters ---------- */
const FONT_REGION=(px)=>`600 ${px}px ${SERIF}`,FONT_SEA=(px)=>`italic 500 ${px}px ${SERIF}`,FONT_TOWN=(px)=>`italic 500 ${px}px ${SERIF}`,FONT_RIVER=(px)=>`italic 400 ${px}px ${SERIF}`;

function paintMap(g,model,view,o){const pal=PALETTES[o.palette]||PALETTES.parchment,p=o.progress==null?1:o.progress,layers=o.layers||{contours:true,rivers:true,forest:true,cities:true},geo=geometry(model);const detailScale=o.detailScale||1;
  const coastFrac=ss(.04,.32,p),landAlpha=ss(.1,.36,p);
  if(view==='relief'){
    const ras=reliefRaster(model,pal,layers,o.rasterScale||2);
    g.save();g.globalAlpha=1;g.drawImage(ras,0,0,W,H);g.restore();
    if(landAlpha<1){g.save();g.globalAlpha=1-landAlpha;g.fillStyle=pal.reliefPaper;g.fillRect(0,0,W,H);g.restore()}
    // graticule
    g.save();g.strokeStyle=pal.ink;g.globalAlpha=.09;g.lineWidth=.6;g.beginPath();for(let x=100;x<W;x+=100){g.moveTo(x,0);g.lineTo(x,H)}for(let y=100;y<H;y+=100){g.moveTo(0,y);g.lineTo(W,y)}g.stroke();g.restore();
    if(layers.contours&&p>.4){g.save();g.clip(geo.land);g.globalAlpha=.3*ss(.4,.62,p);g.strokeStyle=pal.ink;g.lineWidth=.45/Math.sqrt(o.zoom||1);g.stroke(geo.contoursRegular);g.globalAlpha=.5*ss(.4,.62,p);g.lineWidth=.85/Math.sqrt(o.zoom||1);g.stroke(geo.contoursIndex);g.restore()}
    g.save();g.strokeStyle=pal.ink;g.lineWidth=1.05;g.globalAlpha=.9;g.stroke(coastFrac<1?partialPath(model.coast,coastFrac):geo.land);g.restore();
    paintWater(g,model,geo,pal,p,layers,view);
    if(layers.cities)paintRoads(g,model,pal,p,.35);
    if(o.showLabels!==false)paintLabels(g,model,pal,p,view,layers,o);
  }else{
    // paper wash: sea tints
    const wash=washRaster(model,pal);
    g.save();g.imageSmoothingEnabled=true;g.imageSmoothingQuality='high';g.drawImage(wash,0,0,W,H);g.restore();
    g.save();g.fillStyle=pal.paper;g.globalAlpha=1-ss(0,.1,p);g.fillRect(0,0,W,H);g.restore();
    // rhumb lines in the sea
    if(o.compass){g.save();g.clip(geo.seaClip,'evenodd');g.strokeStyle=pal.seaInk;g.globalAlpha=.16*ss(.02,.2,p);g.lineWidth=.5;g.beginPath();for(let k=0;k<32;k++){const a=k/32*Math.PI*2;g.moveTo(o.compass.x,o.compass.y);g.lineTo(o.compass.x+Math.cos(a)*2400,o.compass.y+Math.sin(a)*2400)}g.stroke();g.restore()}
    // coast rings
    g.save();g.clip(geo.seaClip,'evenodd');g.strokeStyle=pal.seaInk;g.lineCap='round';geo.rings.forEach((r,i)=>{g.globalAlpha=(.42-i*.06)*ss(.05,.3,p);g.lineWidth=i===0?.8:.6;g.stroke(r)});g.restore();
    // land
    g.save();g.globalAlpha=landAlpha;g.fillStyle=pal.land;g.fill(geo.land,'evenodd');g.clip(geo.land,'evenodd');g.globalAlpha=.9*ss(.22,.5,p);g.drawImage(wash,0,0,W,H);
    // paper grain on land
    g.globalAlpha=.5;g.globalCompositeOperation='multiply';const pt=g.createPattern(paperTexture(pal),'repeat');g.fillStyle=pt;g.fillRect(0,0,W,H);g.restore();
    // subtle contour whisper for terrain sense
    if(layers.contours&&p>.4){g.save();g.clip(geo.land,'evenodd');g.globalAlpha=.10*ss(.4,.6,p);g.strokeStyle=pal.inkSoft;g.lineWidth=.5;g.stroke(geo.contoursIndex);g.restore()}
    // coast line: soft inner shadow + crisp ink
    g.save();const cp=coastFrac<1?partialPath(model.coast,coastFrac):geo.land;g.strokeStyle=pal.ink;g.globalAlpha=.14;g.lineWidth=5;g.stroke(cp);g.globalAlpha=1;g.lineWidth=1.25;g.stroke(cp);g.restore();
    paintWater(g,model,geo,pal,p,layers,view);
    if(layers.cities)paintRoads(g,model,pal,p,.75);
    // symbols
    g.save();g.clip(geo.land,'evenodd');const feats=model.features;for(const f of feats){if(!layers.forest&&(f.type==='conifer'||f.type==='broadleaf'))continue;if(!layers.cities&&(f.type==='town'||f.type==='city'||f.type==='ruin'))continue;const birth=.45+f.birth*.5;if(p<birth)continue;
      if(p<birth+.06){const t=(p-birth)/.06;g.save();g.globalAlpha=.3+.7*t;g.translate(f.x,f.y);g.scale(1,.4+.6*t);g.translate(-f.x,-f.y);glyph(g,f,pal,view);g.restore()}else glyph(g,f,pal,view)}
    g.restore();
    if(o.showLabels!==false)paintLabels(g,model,pal,p,view,layers,o);
  }}
function paintWater(g,model,geo,pal,p,layers,view){
  const riverFrac=ss(.44,.72,p);
  if(layers.rivers&&riverFrac>0){g.save();const water=view==='relief'?pal.water:pal.water;model.rivers.forEach((r,i)=>{const rb=riverFrac<1?ribbon(r.points,r.widths,riverFrac):geo.riverRibbons[i];
      if(view==='ink'){g.fillStyle=pal.land;g.globalAlpha=1;g.fill(rb);g.fillStyle=water;g.globalAlpha=.8;g.fill(rb);g.strokeStyle=pal.waterInk;g.lineWidth=.45;g.globalAlpha=.85;g.stroke(rb)}
      else{g.fillStyle=water;g.globalAlpha=.95;g.fill(rb);g.strokeStyle=pal.waterDeep;g.lineWidth=.35;g.globalAlpha=.6;g.stroke(rb)}});g.restore()}
  const lakeA=ss(.5,.64,p);if(lakeA>0&&model.lakes.length){g.save();g.globalAlpha=lakeA;g.fillStyle=view==='ink'?pal.land:pal.water;g.fill(geo.lakes,'evenodd');g.fillStyle=pal.water;g.globalAlpha=lakeA*(view==='ink'?.78:1);g.fill(geo.lakes,'evenodd');g.strokeStyle=pal.waterInk;g.lineWidth=.8;g.globalAlpha=lakeA*.9;g.stroke(geo.lakes);
    if(view==='ink'){g.clip(geo.lakes,'evenodd');g.strokeStyle=pal.waterInk;g.globalAlpha=lakeA*.35;g.lineWidth=.5;g.beginPath();for(let y=0;y<H;y+=4){g.moveTo(0,y);g.lineTo(W,y)}g.stroke()}g.restore()}}
function paintRoads(g,model,pal,p,alpha){const a=ss(.78,.9,p);if(a<=0||!model.roads.length)return;g.save();g.strokeStyle=pal.road;g.globalAlpha=alpha*a;g.lineWidth=.9;g.setLineDash([3,3.5]);g.lineCap='round';g.beginPath();for(const r of model.roads){g.moveTo(r[0][0],r[0][1]);for(let i=1;i<r.length;i++)g.lineTo(r[i][0],r[i][1])}g.stroke();g.restore()}

function paintLabels(g,model,pal,p,view,layers,o){const a=ss(.86,1,p);if(a<=0)return;g.save();g.globalAlpha=a;g.textBaseline='middle';g.textAlign='left';const halo=view==='relief'?pal.reliefPaper:pal.paper;const placed=[];
  const rectFree=r=>!placed.some(q=>r.x<q.x+q.w&&r.x+r.w>q.x&&r.y<q.y+q.h&&r.y+r.h>q.y);
  // regions & seas
  const cc=model.furniture;const cartW=view==='relief'?400:370,cartH=view==='relief'?150:122;const cart={x:(cc.cartouche%2===0)?60:W-60-cartW,y:(cc.cartouche>=2)?H-60-cartH:60,w:cartW,h:cartH};
  for(const l of model.labels){const isSea=l.kind==='sea'||l.kind==='bay';const isLake=l.kind==='lake';if(isLake&&view==='relief'&&l.size<200)continue;
    let px=isSea?(l.kind==='sea'?26:17):isLake?13:l.kind==='mountain'?17:16;if(l.size>20000)px+=3;if(l.size<1200)px-=2;
    const sp=()=>isSea?px*.42:isLake?1:px*.28;const setFont=()=>{g.font=isSea?FONT_SEA(px):isLake?FONT_TOWN(px):FONT_REGION(px)};const measure=()=>[...l.name].reduce((s,ch)=>s+g.measureText(ch).width+sp(),0)-sp();
    setFont();let width=measure();while(width>l.maxWidth&&px>11){px-=1;setFont();width=measure()}const spacing=sp();
    const bulge=isSea?-px*.9:isLake?0:-px*.55;const hw=width/2*Math.cos(l.angle)+px;const lx=clamp(l.x,44+hw,W-44-hw);let ly=clamp(l.y,44+px+Math.abs(Math.sin(l.angle))*width/2,H-44-px-Math.abs(Math.sin(l.angle))*width/2);
    {const lh=px+Math.abs(Math.sin(l.angle))*width/2;if(lx-hw<cart.x+cart.w+8&&lx+hw>cart.x-8&&ly-lh<cart.y+cart.h+8&&ly+lh>cart.y-8)ly=cart.y>H/2?cart.y-lh-14:cart.y+cart.h+lh+14}const pts=arcPath(lx,ly,Math.max(width+20,60),l.angle,bulge);
    g.fillStyle=isSea?pal.waterInk:l.kind==='lake'?pal.waterInk:pal.ink;if(isSea)g.globalAlpha=a*.8;
    textAlongPath(g,l.name,pts,{spacing,halo:isSea?null:halo,haloWidth:3.5});g.globalAlpha=a;
    placed.push({x:lx-width/2-6,y:ly-px,w:width+12,h:px*2})}
  // rivers
  if(layers.rivers)for(const r of model.rivers){if(!r.name)continue;const px=12;g.font=FONT_RIVER(px);g.fillStyle=pal.waterInk;const pts=r.points;const start=Math.floor(pts.length*.45),seg=pts.slice(start,Math.min(pts.length-1,start+Math.floor(pts.length*.35)));if(seg.length<4)continue;
    // keep text upright
    const goesLeft=seg[seg.length-1][0]<seg[0][0];const path=(goesLeft?seg.slice().reverse():seg).map(([x,y])=>{return[x,y]});const offset=path.map((pt,i)=>{const a=path[Math.max(0,i-1)],b=path[Math.min(path.length-1,i+1)];const dx=b[0]-a[0],dy=b[1]-a[1],L=Math.hypot(dx,dy)||1;return[pt[0]+dy/L*(r.widths[start+i]||2)*.5+dy/L*5,pt[1]-dx/L*(r.widths[start+i]||2)*.5-dx/L*5]});
    textAlongPath(g,r.name,offset,{spacing:1.2,halo:halo,haloWidth:2.5})}
  // towns
  if(layers.cities){for(const t of model.towns){const px=t.type==='city'?15:t.type==='ruin'?11:13;g.font=t.type==='city'?`600 ${px}px ${SERIF}`:FONT_TOWN(px);g.fillStyle=t.type==='ruin'?pal.inkSoft:pal.ink;const w=g.measureText(t.name).width,h=px*1.2;const gs=t.type==='city'?24:t.type==='ruin'?14:17;
      const spots=[[t.x+gs*.8,t.y+2],[t.x-gs*.8-w,t.y+2],[t.x-w/2,t.y+gs+4],[t.x-w/2,t.y-gs-6]];let spot=spots[0];for(const s of spots){const r={x:s[0]-2,y:s[1]-h/2,w:w+4,h};if(rectFree(r)&&r.x>40&&r.x+r.w<W-40&&r.y>40&&r.y+r.h<H-40){spot=s;break}}
      if(view==='relief'){g.save();g.fillStyle=pal.ink;g.beginPath();g.arc(t.x,t.y,t.type==='city'?4.2:3,0,Math.PI*2);g.fill();g.strokeStyle=halo;g.lineWidth=1.2;g.stroke();if(t.type==='city'){g.beginPath();g.arc(t.x,t.y,7.5,0,Math.PI*2);g.strokeStyle=pal.ink;g.lineWidth=.9;g.stroke()}g.restore()}
      g.lineWidth=3;g.strokeStyle=halo;g.lineJoin='round';g.strokeText(t.name,spot[0],spot[1]);g.fillText(t.name,spot[0],spot[1]);placed.push({x:spot[0]-2,y:spot[1]-h/2,w:w+4,h})}}
  g.restore()}

/* ---------- Furniture (screen space) ---------- */
function corners(model){return model.furniture}
function paintFurniture(g,model,view,o){const pal=PALETTES[o.palette]||PALETTES.parchment,p=o.progress==null?1:o.progress,a=ss(.0,.12,p);if(a<=0)return;const {compass,cartouche}=corners(model);
  g.save();g.globalAlpha=a;g.strokeStyle=pal.ink;g.fillStyle=pal.ink;g.lineWidth=1;
  // neatline with graduated band
  g.globalAlpha=a*.9;g.lineWidth=1.4;g.strokeRect(22,22,W-44,H-44);g.lineWidth=.7;g.strokeRect(30,30,W-60,H-60);
  g.globalAlpha=a*.55;for(let x=30;x<W-30;x+=50){if(Math.floor(x/50)%2===0){g.fillRect(x,22,Math.min(50,W-30-x),8);g.fillRect(x,H-30,Math.min(50,W-30-x),8)}}for(let y=30;y<H-30;y+=50){if(Math.floor(y/50)%2===1){g.fillRect(22,y,8,Math.min(50,H-30-y));g.fillRect(W-30,y,8,Math.min(50,H-30-y))}}
  g.globalAlpha=a;for(const [cx,cy] of [[26,26],[W-26,26],[26,H-26],[W-26,H-26]]){g.beginPath();g.moveTo(cx,cy-9);g.lineTo(cx+9,cy);g.lineTo(cx,cy+9);g.lineTo(cx-9,cy);g.closePath();g.fillStyle=pal.paper;g.fill();g.lineWidth=.9;g.stroke();g.beginPath();g.arc(cx,cy,2,0,Math.PI*2);g.fillStyle=pal.ink;g.fill()}
  if(o.showFurniture===false){g.restore();return}
  // compass rose
  compassRose(g,compass.x,compass.y,58,pal);
  // scale bar next to the cartouche
  const cartW=view==='relief'?400:370,cartH=view==='relief'?150:122;const cx=(cartouche%2===0)?60:W-60-cartW,cy=(cartouche>=2)?H-60-cartH:60;
  cartoucheBox(g,cx,cy,cartW,cartH,pal,o.title||'',model,view);
  const sx=cartouche%2===0?cx+cartW+40:cx-320,sy=cartouche>=2?H-70:70;scaleBar(g,sx,sy,pal);
  g.restore()}
function compassRose(g,x,y,r,pal){g.save();g.translate(x,y);g.lineWidth=.8;g.strokeStyle=pal.ink;g.fillStyle=pal.paper;
  g.globalAlpha=.85;g.beginPath();g.arc(0,0,r*1.02,0,Math.PI*2);g.fill();g.globalAlpha=1;
  g.beginPath();g.arc(0,0,r,0,Math.PI*2);g.stroke();g.beginPath();g.arc(0,0,r*.9,0,Math.PI*2);g.stroke();
  for(let k=0;k<72;k++){const a=k/72*Math.PI*2,l=k%9===0?r*.14:k%3===0?r*.08:r*.04;g.beginPath();g.moveTo(Math.cos(a)*r*.9,Math.sin(a)*r*.9);g.lineTo(Math.cos(a)*(r*.9-l),Math.sin(a)*(r*.9-l));g.stroke()}
  const star=(n,len,w,fillDark)=>{for(let k=0;k<n;k++){const a=k/n*Math.PI*2-Math.PI/2;const tip=[Math.cos(a)*len,Math.sin(a)*len],l=[Math.cos(a-Math.PI/2)*w,Math.sin(a-Math.PI/2)*w],rr=[Math.cos(a+Math.PI/2)*w,Math.sin(a+Math.PI/2)*w];
      g.beginPath();g.moveTo(0,0);g.lineTo(l[0],l[1]);g.lineTo(tip[0],tip[1]);g.closePath();g.fillStyle=fillDark?pal.ink:pal.paper;g.fill();g.stroke();g.beginPath();g.moveTo(0,0);g.lineTo(rr[0],rr[1]);g.lineTo(tip[0],tip[1]);g.closePath();g.fillStyle=fillDark?pal.paper:pal.ink;g.fill();g.stroke()}};
  g.save();g.rotate(Math.PI/8);star(8,r*.5,r*.07,false);g.restore();star(8,r*.72,r*.09,true);g.save();star(4,r*.88,r*.11,false);g.restore();
  g.beginPath();g.arc(0,0,r*.09,0,Math.PI*2);g.fillStyle=pal.gold;g.fill();g.stroke();
  g.fillStyle=pal.ink;g.font=`600 ${r*.3}px ${SERIF}`;g.textAlign='center';g.textBaseline='middle';g.fillText('N',0,-r*1.2);g.font=`500 ${r*.22}px ${SERIF}`;g.fillText('E',r*1.18,0);g.fillText('S',0,r*1.2);g.fillText('W',-r*1.18,0);
  // fleur for north
  g.beginPath();g.moveTo(0,-r*.88);g.lineTo(-r*.06,-r*1.0);g.lineTo(0,-r*1.06);g.lineTo(r*.06,-r*1.0);g.closePath();g.fillStyle=pal.gold;g.fill();g.stroke();g.restore()}
function cartoucheBox(g,x,y,w,h,pal,title,model,view){g.save();g.fillStyle=pal.paper;g.globalAlpha=.93;g.fillRect(x,y,w,h);g.globalAlpha=1;g.strokeStyle=pal.ink;g.lineWidth=1.3;g.strokeRect(x,y,w,h);g.lineWidth=.6;g.strokeRect(x+6,y+6,w-12,h-12);
  for(const [cx,cy] of [[x+6,y+6],[x+w-6,y+6],[x+6,y+h-6],[x+w-6,y+h-6]]){g.beginPath();g.arc(cx,cy,3,0,Math.PI*2);g.fillStyle=pal.gold;g.fill();g.stroke()}
  g.fillStyle=pal.ink;g.textAlign='center';g.textBaseline='middle';const tw=w-40;let px=28;g.font=`600 ${px}px ${SERIF}`;const up=title.toUpperCase();while(g.measureText(up).width+up.length*3>tw&&px>14){px--;g.font=`600 ${px}px ${SERIF}`}
  const cx=x+w/2;let cy=y+40;textAlongPath(g,up,[[cx-tw/2,cy],[cx+tw/2,cy]],{spacing:3});
  g.font=`500 9px ${SERIF}`;textAlongPath(g,'A CHART OF LANDS KNOWN & UNKNOWN',[[cx-tw/2,cy+24],[cx+tw/2,cy+24]],{spacing:2.2});
  g.beginPath();g.moveTo(cx-60,cy+36);g.lineTo(cx-8,cy+36);g.moveTo(cx+8,cy+36);g.lineTo(cx+60,cy+36);g.lineWidth=.6;g.stroke();g.beginPath();g.arc(cx,cy+36,2.2,0,Math.PI*2);g.fillStyle=pal.gold;g.fill();g.stroke();
  g.fillStyle=pal.inkSoft;g.font=`italic 500 11px ${SERIF}`;g.fillText(`Atlas Nº ${String(model.seed).padStart(6,'0')} · ${model.towns.filter(t=>t.type!=='ruin').length} settlements · ${model.rivers.filter(r=>r.length>150).length} rivers`,cx,cy+52);
  if(view==='relief'){const lut=hypsoLUT(pal);const bx=x+30,by=y+h-36,bw=w-60;for(let k=0;k<bw;k++){g.fillStyle=rgb(lut[Math.floor(k/bw*255)]);g.fillRect(bx+k,by,1.2,10)}g.strokeStyle=pal.ink;g.lineWidth=.6;g.strokeRect(bx,by,bw,10);g.fillStyle=pal.inkSoft;g.font=`500 9px ${SERIF}`;g.textAlign='left';g.fillText('LOWLANDS',bx,by+18);g.textAlign='right';g.fillText('SNOWLINE',bx+bw,by+18);g.textAlign='center';g.fillText('HIGHLANDS',bx+bw/2,by+18)}
  g.restore()}
function scaleBar(g,x,y,pal){g.save();g.strokeStyle=pal.ink;g.fillStyle=pal.ink;g.lineWidth=.8;const seg=70;for(let k=0;k<4;k++){g.fillStyle=k%2?pal.paper:pal.ink;g.fillRect(x+k*seg,y-5,seg,6);g.strokeRect(x+k*seg,y-5,seg,6)}
  g.fillStyle=pal.ink;g.font=`500 10px ${SERIF}`;g.textAlign='center';g.textBaseline='alphabetic';[0,100,200,300,400].forEach((v,k)=>g.fillText(String(v),x+k*seg,y-9));g.font=`italic 500 11px ${SERIF}`;g.fillText('leagues',x+seg*2,y+16);g.restore()}

/* ---------- SVG replay context ---------- */
function SvgContext(){const els=[];let d=[],m=[1,0,0,1,0,0],stack=[];const st={fillStyle:'#000',strokeStyle:'#000',lineWidth:1,globalAlpha:1,lineCap:'round',lineJoin:'round',font:'12px serif',textAlign:'left',textBaseline:'alphabetic'};
  const tp=(x,y)=>[(m[0]*x+m[2]*y+m[4]).toFixed(2),(m[1]*x+m[3]*y+m[5]).toFixed(2)];const sc=()=>Math.sqrt(Math.abs(m[0]*m[3]-m[1]*m[2]));
  const ctx={beginPath(){d=[]},moveTo(x,y){d.push('M'+tp(x,y).join(','))},lineTo(x,y){d.push('L'+tp(x,y).join(','))},closePath(){d.push('Z')},
    quadraticCurveTo(cx,cy,x,y){d.push('Q'+tp(cx,cy).join(',')+' '+tp(x,y).join(','))},bezierCurveTo(a,b,c,e,x,y){d.push('C'+tp(a,b).join(',')+' '+tp(c,e).join(',')+' '+tp(x,y).join(','))},
    rect(x,y,w,h){d.push('M'+tp(x,y).join(','),'L'+tp(x+w,y).join(','),'L'+tp(x+w,y+h).join(','),'L'+tp(x,y+h).join(','),'Z')},
    arc(x,y,r,a0,a1,ccw){ctx.ellipse(x,y,r,r,0,a0,a1,ccw)},
    ellipse(x,y,rx,ry,rot,a0,a1,ccw){let span=a1-a0;if(ccw){if(span>0)span-=Math.PI*2}else if(span<0)span+=Math.PI*2;const n=24;for(let k=0;k<=n;k++){const a=a0+span*k/n;const px=Math.cos(a)*rx,py=Math.sin(a)*ry;const xx=x+px*Math.cos(rot)-py*Math.sin(rot),yy=y+px*Math.sin(rot)+py*Math.cos(rot);d.push((k===0&&!d.length?'M':'L')+tp(xx,yy).join(','))}},
    fill(){if(!d.length)return;els.push(`<path d="${d.join(' ')}" fill="${st.fillStyle}" fill-opacity="${st.globalAlpha}" stroke="none"/>`)},
    stroke(){if(!d.length)return;els.push(`<path d="${d.join(' ')}" fill="none" stroke="${st.strokeStyle}" stroke-width="${(st.lineWidth*sc()).toFixed(2)}" stroke-opacity="${st.globalAlpha}" stroke-linecap="${st.lineCap}" stroke-linejoin="${st.lineJoin}"/>`)},
    fillRect(x,y,w,h){ctx.beginPath();ctx.rect(x,y,w,h);ctx.fill()},strokeRect(x,y,w,h){ctx.beginPath();ctx.rect(x,y,w,h);ctx.stroke()},
    fillText(t,x,y){const p=tp(x,y);els.push(`<text x="${p[0]}" y="${p[1]}" font-family="Cormorant Garamond, Georgia, serif" font-size="${(parseFloat(st.font)||12)*sc()}" fill="${st.fillStyle}" text-anchor="${st.textAlign==='center'?'middle':st.textAlign==='right'?'end':'start'}">${t.replace(/&/g,'&amp;').replace(/</g,'&lt;')}</text>`)},
    strokeText(){},measureText(t){return{width:(parseFloat(st.font)||12)*.5*t.length}},
    save(){stack.push([m.slice(),{...st}])},restore(){const s=stack.pop();if(s){m=s[0];Object.assign(st,s[1])}},
    translate(x,y){m=[m[0],m[1],m[2],m[3],m[0]*x+m[2]*y+m[4],m[1]*x+m[3]*y+m[5]]},scale(x,y){m=[m[0]*x,m[1]*x,m[2]*y,m[3]*y,m[4],m[5]]},rotate(a){const c=Math.cos(a),s=Math.sin(a);m=[m[0]*c+m[2]*s,m[1]*c+m[3]*s,-m[0]*s+m[2]*c,-m[1]*s+m[3]*c,m[4],m[5]]},
    setLineDash(){},clip(){},createPattern(){return '#000'},drawImage(){},
    toSVG(w,h,bg){return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${bg?`<rect width="100%" height="100%" fill="${bg}"/>`:''}${els.join('')}</svg>`}};
  for(const k of Object.keys(st))Object.defineProperty(ctx,k,{get(){return st[k]},set(v){st[k]=v}});return ctx}

/* Symbol sheet: every glyph type at five sizes, as SVG or onto a canvas. */
const SHEET_TYPES=['peak','mountain','hill','conifer','broadleaf','dune','grass','marsh','city','town','castle','ruin'];
function symbolSheet(g,pal,label){const cols=5,cw=180,rh=120,x0=110,y0=90;g.save();if(label){g.fillStyle=pal.ink;g.font=`600 22px ${SERIF}`;g.textAlign='left';g.fillText('INKBOUND · PROCEDURAL SYMBOL LIBRARY',40,44)}
  SHEET_TYPES.forEach((type,row)=>{if(label){g.fillStyle=pal.inkSoft;g.font=`italic 500 12px ${SERIF}`;g.textAlign='left';g.fillText(type,20,y0+row*rh+8)}for(let k=0;k<cols;k++){const s=type==='conifer'||type==='broadleaf'||type==='grass'||type==='marsh'?7+k*3:type==='city'||type==='castle'?14+k*4:12+k*6;glyph(g,{x:x0+k*cw,y:y0+row*rh+10,type,s,v:(k+1)*.173+row*.031},pal,'ink')}});g.restore();return{width:x0+cols*cw,height:y0+SHEET_TYPES.length*rh}}

root.AtlasRender={PALETTES,paintMap,paintFurniture,glyph,geometry,reliefRaster,washRaster,SvgContext,symbolSheet,SHEET_TYPES,corners,textAlongPath,arcPath,SERIF};
})(typeof window!=='undefined'?window:globalThis);
