'use strict';
/* Inkbound — UI, camera, reveal film, drawing tools and exports. Rendering lives in atlas-render.js. */
const $=id=>document.getElementById(id),canvas=$('map'),ctx=canvas.getContext('2d'),W=1600,H=1100;
let mode='story',tool='land',seed=14827,kind='kingdom',title='The Elderlands',traits={},edits=[],strokes=[],history=[],current=null,zoom=1,pan={x:0,y:0},drag=null,filmStart=0,filmRAF=0,audio=null,model=null,features=[],pendingEdits=null;
const TITLES={islands:'The Shattered Isles',desert:'The Amber Dominion',frozen:'The Winter Reach',kingdom:'The Elderlands'};
function hash(t){let h=2166136261;for(let c of t)h=Math.imul(h^c.charCodeAt(0),16777619);return h>>>0}
function palette(){return AtlasRender.PALETTES[$('palette').value]||AtlasRender.PALETTES.parchment}
function view(){return $('atlas-view').value==='relief'?'relief':'ink'}
function layers(){return{contours:$('layer-contours').checked,rivers:$('layer-rivers').checked,forest:$('layer-forest').checked,cities:$('layer-cities').checked}}
function detectTraits(p){return{rift:/rift|canyon|vale|gorge|chasm/i.test(p),volcano:/volcan/i.test(p)}}

function make(){const t=performance.now();model=Atlas.build({seed,kind,detail:+$('detail').value,rugged:+$('terrain-rugged').value,traits,edits});features=model.features;window.AtlasStudio?.invalidate();
  $('seedtag').textContent=String(seed).padStart(6,'0');$('seedvalue').value=seed;['worldtitle','filmtitle'].forEach(id=>$(id).textContent=title);
  $('terrain-summary').textContent=`${model.stats.landCells.toLocaleString()} land cells · ${model.rivers.filter(r=>r.length>150).length} rivers · ${model.lakes.length} lakes · ${model.towns.filter(x=>x.type!=='ruin').length} settlements · drawn in ${Math.round(performance.now()-t)} ms`;
  draw()}

function camera(g,z=zoom,p=pan){g.translate(W/2+p.x,H/2+p.y);g.scale(z,z);g.translate(-W/2,-H/2)}
function paintAll(g,progress=1,opts={}){const pal=palette(),v=view();const z=opts.zoom??zoom,p=opts.pan??pan;
  g.setTransform(1,0,0,1,0,0);if(opts.scale)g.scale(opts.scale,opts.scale);
  g.fillStyle=v==='relief'?pal.reliefPaper:pal.paper;g.fillRect(0,0,W,H);
  g.save();g.beginPath();g.rect(30,30,W-60,H-60);g.clip();camera(g,z,p);
  AtlasRender.paintMap(g,model,v,{palette:$('palette').value,progress,layers:layers(),zoom:z,compass:AtlasRender.corners(model).compass,rasterScale:opts.rasterScale||2,showLabels:$('labels').checked,title});
  if(progress>=.99)for(const stroke of strokes)for(const f of stroke)AtlasRender.glyph(g,f,pal,v);
  g.restore();
  AtlasRender.paintFurniture(g,model,v,{palette:$('palette').value,progress,title,showFurniture:!filmStart&&opts.furniture!==false});
  g.setTransform(1,0,0,1,0,0)}
function draw(progress=1){if(!model)return;paintAll(ctx,progress)}

function generate(){if(mode==='story'){const p=$('prompt').value;seed=hash(p);kind=/island|archipelago|isles/i.test(p)?'islands':/desert|sand|dune/i.test(p)?'desert':/frozen|snow|ice|winter|glacial|tundra/i.test(p)?'frozen':'kingdom';if(/island kingdom/i.test(p))kind='kingdom';
    if(/glacial peaks in the north.*rift valley/i.test(p)&&kind==='kingdom')kind='kingdom';traits=detectTraits(p);title=p.match(/["“]([^"”]{1,60})["”]/)?.[1]||TITLES[kind]}
  else{const sv=$('seedvalue').value.trim();seed=/^\d+$/.test(sv)?Number(sv)>>>0:hash(sv);kind=$('shape').value;traits={};title=TITLES[kind]}
  edits=[];strokes=[];history=[];zoom=1;pan={x:0,y:0};make();$('status').textContent='Your world has been drawn. Explore it, or add your own details.'}

/* ---------- Controls ---------- */
document.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>{mode=b.dataset.mode;document.querySelectorAll('[data-mode]').forEach(t=>t.setAttribute('aria-selected',String(t===b)));['story','seed','draw'].forEach(id=>$(id).hidden=id!==mode);$('build').hidden=mode==='draw';canvas.style.cursor=mode==='draw'?'crosshair':'grab'});
document.querySelectorAll('[data-tool]').forEach(b=>b.onclick=()=>{tool=b.dataset.tool;document.querySelectorAll('[data-tool]').forEach(t=>t.classList.toggle('active',t===b))});
document.querySelectorAll('[data-preset]').forEach(b=>b.onclick=()=>{$('prompt').value={islands:'A shattered archipelago of forested islands, mountain peaks and coastal harbours. "The Shattered Isles"',frozen:'A frozen northern kingdom, snowy mountains, dark pine forests and isolated holds. "The Winter Reach"',desert:'A vast desert empire of dunes, red mountains, a great river and ancient fortresses. "The Amber Dominion"'}[b.dataset.preset];generate()});
$('build').onclick=generate;
$('shuffle').onclick=()=>{seed=Math.floor(Math.random()*1e9);edits=[];strokes=[];history=[];make();$('status').textContent='Discovered a new world · seed '+seed};
$('detail').oninput=()=>{$('detailout').textContent=['Sparse','Balanced','Abundant'][+$('detail').value-1];make()};
$('palette').onchange=()=>{draw();$('mapwrap').style.background=palette().paper};
$('labels').onchange=()=>draw();
$('undo').onclick=()=>{const last=history.pop();if(!last)return;if(last.type==='stroke')strokes.pop();else{edits.splice(edits.length-last.count,last.count);make()}draw()};
function setzoom(z){zoom=Math.max(.6,Math.min(4,z));$('reset').textContent=Math.round(zoom*100)+'%';draw()}
$('plus').onclick=()=>setzoom(zoom*1.25);$('minus').onclick=()=>setzoom(zoom/1.25);$('reset').onclick=()=>{pan={x:0,y:0};setzoom(1)};
canvas.onwheel=e=>{e.preventDefault();const r=canvas.getBoundingClientRect();const mx=(e.clientX-r.left)*W/r.width,my=(e.clientY-r.top)*H/r.height;const before={x:(mx-W/2-pan.x)/zoom,y:(my-H/2-pan.y)/zoom};const nz=Math.max(.6,Math.min(4,zoom*Math.exp(-e.deltaY*.0012)));pan={x:mx-W/2-before.x*nz,y:my-H/2-before.y*nz};zoom=nz;$('reset').textContent=Math.round(zoom*100)+'%';draw()};
function position(e){const r=canvas.getBoundingClientRect();return{x:((e.clientX-r.left)*W/r.width-W/2-pan.x)/zoom+W/2,y:((e.clientY-r.top)*H/r.height-H/2-pan.y)/zoom+H/2}}
function overlap(a,b,pad=3){return a.x<b.x+b.w+pad&&a.x+a.w+pad>b.x&&a.y<b.y+b.h+pad&&a.y+a.h+pad>b.y}
function stamp(e){const p=position(e);if(p.x<45||p.y<45||p.x>W-45||p.y>H-45)return;
  if(tool==='land'||tool==='sea'){if(pendingEdits.length&&Math.hypot(p.x-pendingEdits.at(-1).x,p.y-pendingEdits.at(-1).y)<14)return;pendingEdits.push({x:p.x,y:p.y,r:34,type:tool});
    // live preview of the brush
    ctx.save();camera(ctx);ctx.globalAlpha=.35;ctx.fillStyle=tool==='land'?palette().land:palette().water;ctx.beginPath();ctx.arc(p.x,p.y,34,0,Math.PI*2);ctx.fill();ctx.restore();return}
  if(current.length&&Math.hypot(p.x-current.at(-1).x,p.y-current.at(-1).y)<28)return;
  const s=tool==='mountain'?26:tool==='tree'?10:tool==='castle'?16:18;let b={x:p.x-s,y:p.y-s*1.2,w:s*2,h:s*1.6};if(tool==='castle')b={x:p.x-s*1.6,y:p.y-s*2.4,w:s*3.2,h:s*3};if(tool==='label')b={x:p.x-92,y:p.y-14,w:184,h:28};
  if(!model.onLand(p.x,p.y)){$('status').textContent='Choose a spot on land for this mark.';return}
  if(features.some(f=>f.bounds&&overlap(f.bounds,b))&&tool!=='label'||strokes.flat().some(f=>f.bounds&&overlap(f.bounds,b))){$('status').textContent='Choose an open area so this mark has room.';return}
  const cell=model.cellAt(p.x,p.y);const type=tool==='tree'?(model.temp[cell]<.42?'conifer':'broadleaf'):tool;
  current.push({x:p.x,y:p.y,type,s,v:Math.random(),bounds:b,name:['label','castle'].includes(tool)?$('placename').value:undefined});draw()}
canvas.onpointerdown=e=>{canvas.setPointerCapture(e.pointerId);if(mode==='draw'){if(tool==='land'||tool==='sea'){pendingEdits=[]}else{current=[];strokes.push(current);history.push({type:'stroke'})}stamp(e)}else drag={x:e.clientX,y:e.clientY,px:pan.x,py:pan.y}};
canvas.onpointermove=e=>{if(mode==='draw'&&(pendingEdits||current)&&tool!=='label'&&tool!=='castle'&&e.buttons)stamp(e);if(drag){const r=canvas.getBoundingClientRect();pan={x:drag.px+(e.clientX-drag.x)*W/r.width,y:drag.py+(e.clientY-drag.y)*H/r.height};draw()}};
canvas.onpointerup=canvas.onpointercancel=()=>{if(pendingEdits&&pendingEdits.length){edits.push(...pendingEdits);history.push({type:'edit',count:pendingEdits.length});$('status').textContent='Reshaping the coast…';const n=pendingEdits.length;pendingEdits=null;setTimeout(()=>{make();$('status').textContent=`Coast reshaped (${n} brush marks). Rivers and regions were redrawn to match.`},10)}pendingEdits=null;if(current&&!current.length){strokes.pop();history.pop()}current=null;drag=null};

/* ---------- Exports ---------- */
function download(blob,name){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),2000)}
const slug=()=>title.replace(/[^a-z0-9]/gi,'-').replace(/-+/g,'-').toLowerCase();
$('export').onclick=()=>{$('status').textContent='Rendering a 3200 × 2200 print…';setTimeout(()=>{const cv=document.createElement('canvas');cv.width=W*2;cv.height=H*2;const g=cv.getContext('2d');paintAll(g,1,{scale:2,zoom:1,pan:{x:0,y:0},rasterScale:2});cv.toBlob(b=>{download(b,slug()+'-'+view()+'.png');$('status').textContent='Map exported as a 3200 × 2200 PNG.'},'image/png')},30)};
$('assets').onclick=()=>{const pal=palette();const svg=AtlasRender.SvgContext();const size=AtlasRender.symbolSheet(svg,pal,true);download(new Blob([svg.toSVG(size.width,size.height,null)],{type:'image/svg+xml'}),'inkbound-symbols-'+$('palette').value+'.svg');
  const cv=document.createElement('canvas');cv.width=size.width*2;cv.height=size.height*2;const g=cv.getContext('2d');g.scale(2,2);AtlasRender.symbolSheet(g,pal,true);cv.toBlob(b=>download(b,'inkbound-symbols-'+$('palette').value+'.png'));$('status').textContent=`${AtlasRender.SHEET_TYPES.length*5} symbols exported as SVG (editable vectors) and transparent PNG.`};
$('save').onclick=()=>download(new Blob([JSON.stringify({version:2,seed,kind,title,traits,edits,strokes,detail:$('detail').value,palette:$('palette').value,studio:window.AtlasStudio?.settings()})],{type:'application/json'}),slug()+'-world.json');
$('load').onchange=async e=>{try{const d=JSON.parse(await e.target.files[0].text());if(![1,2].includes(d.version)||!Number.isFinite(d.seed)||!['kingdom','islands','desert','frozen'].includes(d.kind)||!Array.isArray(d.strokes)||d.strokes.length>10000||!AtlasRender.PALETTES[d.palette])throw Error();
    if(d.strokes.some(s=>!Array.isArray(s)||s.length>10000||s.some(f=>!Number.isFinite(f.x)||!Number.isFinite(f.y)||!Number.isFinite(f.s))))throw Error();
    seed=d.seed>>>0;kind=d.kind;title=String(d.title).slice(0,60);traits=d.traits&&typeof d.traits==='object'?d.traits:{};edits=Array.isArray(d.edits)?d.edits.filter(x=>Number.isFinite(x.x)&&Number.isFinite(x.y)&&['land','sea'].includes(x.type)).slice(0,5000):[];
    strokes=d.strokes.map(s=>s.filter(f=>f.type!=='land'&&f.type!=='sea').map(f=>({...f,type:f.type==='tree'?'broadleaf':f.type,name:f.name?String(f.name).slice(0,60):undefined})));history=strokes.map(()=>({type:'stroke'}));
    window.AtlasStudio?.restore(d.studio);$('detail').value=d.detail;$('palette').value=d.palette;make();$('status').textContent='World opened.'}catch{$('status').textContent='That file could not be opened. Choose an Inkbound world JSON file.'}e.target.value=''};

/* ---------- Reveal film (2D atlas) ---------- */
const FILM_DURATION=35.555556;let filmBusy=false,recorder=null,recordingChunks=[],filmSource=null,filmStream=null,restoreCamera=null;
function buildShots(){const regions=model.shots.slice(0,4);const shots=[{name:'I. A continent takes shape',technique:'INK TRACE · 12 FRAMES PER SECOND',from:[800,550,1],to:[790,540,1.06]}];const numerals=['II','III','IV','V'];
  regions.forEach((r,i)=>{const cx=Math.max(330,Math.min(W-330,r.x)),cy=Math.max(230,Math.min(H-230,r.y));shots.push({name:`${numerals[i]}. ${r.name.charAt(0)+r.name.slice(1).toLowerCase()}`,technique:['PAPER-CUT ASSEMBLY · STEPPED RISE','STAMP-BY-STAMP · LATERAL SCAN','CONTOUR ETCHING · VERTICAL SCAN','WATERCOLOR BLOOM · SETTLEMENT REVEAL'][i],from:[cx-60,cy+20,r.zoom-.25],to:[cx+30,cy-10,r.zoom]})});
  while(shots.length<5)shots.push({name:'Across the land',technique:'LATERAL SCAN',from:[600,500,1.8],to:[1000,600,1.9]});
  shots.push({name:'VI. An unwritten world',technique:'PULL BACK · THE COMPLETE ATLAS',from:[820,600,1.6],to:[800,550,1]});return shots}
function titles(shot,local,t){ctx.save();ctx.setTransform(1,0,0,1,0,0);const g=ctx.createLinearGradient(0,H*.7,0,H);g.addColorStop(0,'#11191400');g.addColorStop(1,'#111914ed');ctx.fillStyle=g;ctx.fillRect(0,0,W,H);ctx.fillStyle='#131a17';ctx.fillRect(0,0,W,38);ctx.fillRect(0,H-38,W,38);ctx.fillStyle='#f1e5c9';ctx.textAlign='center';ctx.globalAlpha=Math.min(1,local*7+.1);ctx.font='14px sans-serif';ctx.fillText(shot.technique,W/2,H-160);ctx.font=`500 39px ${AtlasRender.SERIF}`;ctx.fillText(shot.name,W/2,H-104);ctx.font=`15px ${AtlasRender.SERIF}`;ctx.fillText(title,W/2,H-68);ctx.globalAlpha=1;ctx.fillStyle='#d6b777';ctx.fillRect(0,H-5,W*t/FILM_DURATION,3);ctx.restore()}
async function startFilm(record=false){if(filmBusy||filmStart)return;if(record&&(!window.MediaRecorder||!canvas.captureStream)){$('status').textContent='This browser cannot record canvas video. You can still play the reveal.';return}filmBusy=true;$('cinema').disabled=true;$('record').disabled=true;$('status').textContent='Preparing the soundtrack…';let duration=FILM_DURATION;const shots=buildShots();
  try{if($('music').checked){audio=new(window.AudioContext||window.webkitAudioContext)();await audio.resume();const response=await fetch('piano-loop.wav');if(!response.ok)throw Error('Audio file');const buffer=await audio.decodeAudioData(await response.arrayBuffer());duration=buffer.duration;filmSource=audio.createBufferSource();filmSource.buffer=buffer;const gain=audio.createGain();gain.gain.setValueAtTime(.8,audio.currentTime);filmSource.connect(gain);gain.connect(audio.destination);if(record){filmStream=canvas.captureStream(30);const dest=audio.createMediaStreamDestination();gain.connect(dest);dest.stream.getAudioTracks().forEach(track=>filmStream.addTrack(track))}}else if(record)filmStream=canvas.captureStream(30);
    if(record){const mime=['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/mp4','video/webm'].find(x=>MediaRecorder.isTypeSupported(x));recorder=new MediaRecorder(filmStream,mime?{mimeType:mime,videoBitsPerSecond:7000000}:undefined);recordingChunks=[];recorder.ondataavailable=e=>{if(e.data.size)recordingChunks.push(e.data)};recorder.onstop=()=>{const type=recorder.mimeType;download(new Blob(recordingChunks,{type}),slug()+'-reveal.'+(type.includes('mp4')?'mp4':'webm'));filmStream?.getTracks().forEach(t=>t.stop());filmStream=null;recorder=null;$('status').textContent='Your film has been exported with the selected soundtrack.'};recorder.start(250)}
    restoreCamera={zoom,pan:{...pan}};$('mapwrap').classList.add('cinematic');$('stop').focus();filmStart=performance.now();if(filmSource)filmSource.start();filmBusy=false;let last=-1;
    function frame(t){if(!filmStart)return;const seconds=Math.min(duration,(t-filmStart)/1000),frameNumber=Math.floor(seconds*12);if(frameNumber!==last){last=frameNumber;const pct=seconds/duration,i=Math.min(5,Math.floor(pct*6)),local=pct*6-i,shot=shots[i],ease=local*local*(3-2*local);let cx=shot.from[0]+(shot.to[0]-shot.from[0])*ease,cy=shot.from[1]+(shot.to[1]-shot.from[1])*ease;zoom=shot.from[2]+(shot.to[2]-shot.from[2])*ease;const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;if(reduced){zoom=1;cx=800;cy=550}const jitter=reduced?0:Math.sin(frameNumber*4.2)*.38;pan={x:(W/2-cx)*zoom+jitter,y:(H/2-cy)*zoom};draw(Math.min(1,pct*1.12));titles(shot,local,seconds)}if(seconds<duration)filmRAF=requestAnimationFrame(frame);else stop()}filmRAF=requestAnimationFrame(frame);
  }catch(err){$('status').textContent='The film could not start. Try turning off music, then play again.';if(audio){audio.close();audio=null}filmSource=null;filmBusy=false;if(recorder&&recorder.state!=='inactive')recorder.stop();filmStream?.getTracks().forEach(t=>t.stop());$('cinema').disabled=false;$('record').disabled=false}}
function stop(){cancelAnimationFrame(filmRAF);filmStart=0;filmBusy=false;$('mapwrap').classList.remove('cinematic');if(recorder?.state==='recording')recorder.stop();if(filmSource){try{filmSource.stop()}catch{}filmSource=null}if(audio){audio.close();audio=null}if(restoreCamera){zoom=restoreCamera.zoom;pan=restoreCamera.pan;restoreCamera=null}$('cinema').disabled=false;$('record').disabled=false;draw();$('cinema').focus()}
$('stop').onclick=stop;document.addEventListener('keydown',e=>{if(e.key==='Escape'&&filmStart)stop()});
$('reveal').onclick=()=>startFilm();$('reveal-record').onclick=()=>startFilm(true);

/* ---------- Living parchment: WebGL paper-fibre / candlelight overlay ---------- */
const gl=$('shader').getContext('webgl',{alpha:true});if(gl){const vertex='attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}';const fragment='precision mediump float;uniform vec2 res;uniform float time;float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}void main(){vec2 uv=gl_FragCoord.xy/res;float grain=hash(floor(gl_FragCoord.xy*.8));float fibers=sin(uv.y*1300.+sin(uv.x*900.)*2.)*.025;float vignette=smoothstep(.15,.78,distance(uv,vec2(.5)));float light=sin(uv.x*5.+time*.22)*.022;vec3 paper=vec3(.94,.88,.72)*(1.-vignette*.22)+(grain-.5)*.15+fibers+light;gl_FragColor=vec4(paper,1.);}';function shader(type,source){const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s}
  try{const p=gl.createProgram();gl.attachShader(p,shader(gl.VERTEX_SHADER,vertex));gl.attachShader(p,shader(gl.FRAGMENT_SHADER,fragment));gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error('Shader link');gl.useProgram(p);const b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);const a=gl.getAttribLocation(p,'a');gl.enableVertexAttribArray(a);gl.vertexAttribPointer(a,2,gl.FLOAT,false,0,0);const res=gl.getUniformLocation(p,'res'),time=gl.getUniformLocation(p,'time');
    function render(t){if($('shading').checked&&!document.hidden){const c=$('shader');if(c.width!==c.clientWidth||c.height!==c.clientHeight){c.width=c.clientWidth;c.height=c.clientHeight;gl.viewport(0,0,c.width,c.height)}gl.uniform2f(res,c.width,c.height);gl.uniform1f(time,matchMedia('(prefers-reduced-motion: reduce)').matches?0:t*.001);gl.drawArrays(gl.TRIANGLES,0,6)}requestAnimationFrame(render)}requestAnimationFrame(render)}catch{$('shader').hidden=true}}else{$('shading').disabled=true}
$('shading').onchange=()=>{$('shader').hidden=!$('shading').checked};

/* ---------- Boot ---------- */
traits=detectTraits($('prompt').value);make();
if(document.fonts&&document.fonts.load){Promise.all([document.fonts.load(`600 16px ${AtlasRender.SERIF}`),document.fonts.load(`italic 500 16px ${AtlasRender.SERIF}`),document.fonts.load(`400 16px ${AtlasRender.SERIF}`)]).then(()=>draw()).catch(()=>{})}
