/* Inkbound — the terrestrial globe.
   A c. 1750 English table globe: the stand (brass meridian ring, hour circle, mahogany horizon ring with
   its paper calendar band, turned legs, compass box) is modelled in Blender (blender/globe_stand.py) and
   loaded as glTF. The ball wears a whole-world engraving generated from the seed by globe-world.js, revealed
   stroke by stroke during the film. three.js is loaded on demand from jsDelivr via the page's import map. */
(()=>{
const $=id=>document.getElementById(id),DURATION=64,TAU=Math.PI*2;
const stage=[['I · THE PAPER GLOBE','Twelve gores, pasted and varnished'],['II · THE KNOWN WORLD','Where the surveyors have walked'],['III · BEYOND THE MERIDIAN','Ships, monsters and margins'],['IV · TERRA INCOGNITA','What no captain has seen'],['V · THE CARTOUCHE','Londini, Anno MDCCLII']];
const CHAPTERS=[0,13,27,40,53];
let running=false,raf=0,ac=null,rec=null,stream=null,savedFocus=null,player=null,audioTracks=[],sessionId=0,recordCanvas=null,recordCtx=null;
let THREE=null,GLTFLoader=null,RoomEnvironment=null,three=null;// {renderer,scene,camera,...}
const cacheWorld={key:'',data:null};
const SERIF='"Cormorant Garamond","Cormorant",Georgia,serif';

/* ---------------- camera choreography ---------------- */
// az: azimuth around the globe (0 = looking at the flat face of the meridian ring), el: elevation, d: distance,
// lon: longitude of the world that should face the camera, ty: look-at height.
const TILT=38.5*Math.PI/180;// axis rotation about z: the pole is raised to the latitude of London, leaning away from the viewer
// Each key aims the camera at a point (lon,lat) of the world: 'atlas', 'voyage', 'incognita', 'cartouche' resolve at runtime.
const KEYS=[{t:0,az:1.05,d:7.4,ty:-.5,at:'atlas'},{t:7,az:.92,d:5.0,ty:-.3,at:'atlas'},{t:13,az:.72,d:3.05,ty:0,at:'atlas',dlon:.05},{t:21,az:.55,d:2.7,ty:.05,at:'atlas',dlon:-.35},
  {t:27,az:.55,d:2.9,ty:0,at:'voyage'},{t:38,az:.7,d:2.8,ty:0,at:'voyage',dlon:1.5},{t:40,az:.8,d:3.0,ty:-.05,at:'incognita'},{t:50,az:.9,d:2.7,ty:-.05,at:'incognita',dlon:.8},
  {t:53,az:.8,d:2.15,ty:0,at:'cartouche'},{t:59,az:.95,d:2.35,ty:0,at:'cartouche',dlon:.15},{t:64,az:1.2,d:7.2,ty:-.5,at:'atlas'}];
function resolve(key,foci){const f=foci[key.at]||foci.atlas;return{...key,lon:f.lon+(key.dlon||0),lat:f.lat}}
function keyAt(t,foci){let k=0;while(k<KEYS.length-2&&t>KEYS[k+1].t)k++;const a=resolve(KEYS[k],foci),b=resolve(KEYS[k+1],foci);const f=Math.max(0,Math.min(1,(t-a.t)/(b.t-a.t))),u=f*f*(3-2*f);const o={};for(const key of ['az','d','ty','lon','lat'])o[key]=a[key]+(b[key]-a[key])*u;return o}
/* Given a world point and a camera azimuth, find the camera elevation and ball spin that bring it dead centre.
   Ball point P (three.js sphere UVs): P=(cos lon cos lat, sin lat, -sin lon cos lat). The axis group applies Rz(TILT).
   We need Ry(spin)·P ∥ Rz(-TILT)·C where C is the camera direction. */
function aim(lon,lat,az){const A=Math.cos(TILT),B=-Math.sin(TILT)*Math.sin(az);const s=Math.sin(lat)/Math.hypot(A,B);const want=Math.asin(Math.max(-1,Math.min(1,s)))-Math.atan2(B,A);const el=Math.max(.09,Math.min(.72,want));const tyAdj=(want-el)*.75;
  const C=[Math.sin(az)*Math.cos(el),Math.sin(el),Math.cos(az)*Math.cos(el)];const ct=Math.cos(-TILT),st=Math.sin(-TILT);const D=[C[0]*ct-C[1]*st,C[0]*st+C[1]*ct,C[2]];
  const spin=Math.atan2(D[0],D[2])-Math.atan2(Math.cos(lon),-Math.sin(lon));return{el,spin,tyAdj}}

/* ---------------- canvas textures for the brass and paper parts ---------------- */
function stripCanvas(w,h){const c=document.createElement('canvas');c.width=w;c.height=h;return[c,c.getContext('2d')]}
function meridianTexture(){const [c,g]=stripCanvas(4096,128);const grad=g.createLinearGradient(0,0,0,128);grad.addColorStop(0,'#c9a25a');grad.addColorStop(.5,'#e2c07a');grad.addColorStop(1,'#b98f48');g.fillStyle=grad;g.fillRect(0,0,4096,128);
  g.strokeStyle='#4a3414';g.fillStyle='#4a3414';g.textAlign='center';g.textBaseline='middle';const perDeg=4096/360;
  for(let d=0;d<360;d++){const x=d*perDeg;const l=d%10===0?40:d%5===0?26:14;g.lineWidth=d%10===0?2:1.2;g.beginPath();g.moveTo(x,128);g.lineTo(x,128-l);g.stroke();
    if(d%10===0){const lat=d<=90?d:d<=180?180-d:d<=270?d-180:360-d;g.font=`600 26px ${SERIF}`;g.fillText(String(lat),x+perDeg*5,58)}}
  g.lineWidth=1.5;g.beginPath();g.moveTo(0,84);g.lineTo(4096,84);g.moveTo(0,20);g.lineTo(4096,20);g.stroke();
  return c}
function hourTexture(){const [c,g]=stripCanvas(2048,64);g.fillStyle='#d9b96c';g.fillRect(0,0,2048,64);g.strokeStyle='#4a3414';g.fillStyle='#4a3414';g.textAlign='center';g.textBaseline='middle';const R=['XII','I','II','III','IV','V','VI','VII','VIII','IX','X','XI'];
  for(let k=0;k<24;k++){const x=k/24*2048;g.lineWidth=2;g.beginPath();g.moveTo(x,64);g.lineTo(x,40);g.stroke();g.font=`600 22px ${SERIF}`;g.fillText(R[k%12],x+2048/48,22)}for(let k=0;k<96;k++){const x=k/96*2048;g.lineWidth=1;g.beginPath();g.moveTo(x,64);g.lineTo(x,52);g.stroke()}return c}
function horizonTexture(){const [c,g]=stripCanvas(4096,256);g.fillStyle='#e7dab4';g.fillRect(0,0,4096,256);g.strokeStyle='#3a2a18';g.fillStyle='#3a2a18';g.textAlign='center';g.textBaseline='middle';
  // v runs 0.06 (inner edge) → 1 (outer edge); rows: winds (outer), degrees, zodiac, months (inner)
  const rows=[[236,256],[190,236],[132,190],[70,132],[16,70]];g.lineWidth=1.2;for(const [a,b] of rows){g.beginPath();g.moveTo(0,a);g.lineTo(4096,a);g.stroke()}
  const winds=['SEPTENTRIO','','ORIENS','','MERIDIES','','OCCIDENS',''];const w32=['N','NbE','NNE','NEbN','NE','NEbE','ENE','EbN','E','EbS','ESE','SEbE','SE','SEbS','SSE','SbE','S','SbW','SSW','SWbS','SW','SWbW','WSW','WbS','W','WbN','WNW','NWbW','NW','NWbN','NNW','NbW'];
  for(let k=0;k<32;k++){const x=k/32*4096;g.lineWidth=k%8===0?2.4:k%4===0?1.6:1;g.beginPath();g.moveTo(x,190);g.lineTo(x,236);g.stroke();g.font=`${k%8===0?'600 26':'500 15'}px ${SERIF}`;g.fillText(w32[k],x+4096/64,213);if(k%8===0){g.font=`italic 500 18px ${SERIF}`;g.fillText(winds[k/4],x+4096/64,246)}}
  for(let d=0;d<360;d++){const x=d*4096/360;g.lineWidth=d%10===0?1.8:.8;g.beginPath();g.moveTo(x,132);g.lineTo(x,d%10===0?160:145);g.stroke();if(d%30===0){g.font=`500 20px ${SERIF}`;g.fillText(String(d%90||(d?90:0)),x+22,176)}}
  const zod=['ARIES','TAURUS','GEMINI','CANCER','LEO','VIRGO','LIBRA','SCORPIO','SAGITTARIUS','CAPRICORNUS','AQUARIUS','PISCES'],glyph='♈♉♊♋♌♍♎♏♐♑♒♓';
  const months=['MARTIUS','APRILIS','MAIUS','JUNIUS','JULIUS','AUGUSTUS','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER','JANUARIUS','FEBRUARIUS'];
  for(let k=0;k<12;k++){const x0=k/12*4096,x1=(k+1)/12*4096;g.fillStyle=k%2?'#e0cf9f':'#e7dab4';g.fillRect(x0,70,x1-x0,62);g.fillStyle='#3a2a18';g.lineWidth=1.4;g.beginPath();g.moveTo(x0,70);g.lineTo(x0,132);g.moveTo(x0,16);g.lineTo(x0,70);g.stroke();
    g.font=`600 30px "Apple Symbols","Segoe UI Symbol","Noto Sans Symbols",${SERIF}`;g.fillText(glyph[k]+'\uFE0E',x0+40,100);g.font=`600 20px ${SERIF}`;g.fillText(zod[k],(x0+x1)/2+16,100);
    g.font=`italic 500 20px ${SERIF}`;g.fillText(months[k],(x0+x1)/2,36);for(let d=0;d<30;d++){const x=x0+d/30*(x1-x0);g.lineWidth=d%5===0?1.4:.7;g.beginPath();g.moveTo(x,70);g.lineTo(x,d%5===0?56:62);g.stroke()}}
  return c}
function compassCardTexture(){const [c,g]=stripCanvas(2048,128);g.fillStyle='#ece0c0';g.fillRect(0,0,2048,128);g.strokeStyle='#3a2a18';g.fillStyle='#3a2a18';g.textAlign='center';g.textBaseline='middle';
  for(let k=0;k<32;k++){const x=k/32*2048;g.lineWidth=k%8===0?3:k%4===0?1.6:.8;g.beginPath();g.moveTo(x,128);g.lineTo(x,k%8===0?60:k%4===0?84:104);g.stroke();
    // wedge shading between points
    if(k%2){g.fillStyle='rgba(58,42,24,.35)';g.fillRect(x-14,96,28,32);g.fillStyle='#3a2a18'}}
  for(const [k,t] of [[0,'N'],[8,'E'],[16,'S'],[24,'W']]){g.font=`600 42px ${SERIF}`;g.fillText(t,k/32*2048+2048/64,38)}g.font=`600 30px ${SERIF}`;g.fillText('✦',2048/64,86);
  g.lineWidth=2;g.beginPath();g.moveTo(0,20);g.lineTo(2048,20);g.stroke();return c}

/* ---------------- world texture ---------------- */
function worldData(){const key=[seed,kind,$('terrain-rugged').value,edits.length,title].join('|');if(cacheWorld.key===key&&cacheWorld.data)return cacheWorld.data;const world=GlobeWorld.buildWorld(model);const painted=GlobeWorld.paint(world,{title});cacheWorld.key=key;cacheWorld.data={world,painted};return cacheWorld.data}

/* ---------------- scene ---------------- */
async function loadThree(){if(THREE)return;THREE=await import('three');({GLTFLoader}=await import('three/addons/loaders/GLTFLoader.js'));({RoomEnvironment}=await import('three/addons/environments/RoomEnvironment.js'))}
function fallbackStand(){const g=new THREE.Group();const brass=new THREE.MeshStandardMaterial({color:0xc9a25a,metalness:1,roughness:.32}),wood=new THREE.MeshStandardMaterial({color:0x4a2412,roughness:.45});
  const ring=new THREE.Mesh(new THREE.TorusGeometry(1.075,.02,8,200),brass);ring.name='MeridianRing';g.add(ring);
  const hz=new THREE.Mesh(new THREE.RingGeometry(1.15,1.5,200),wood);hz.rotation.x=-Math.PI/2;g.add(hz);const hz2=hz.clone();hz2.rotation.x=Math.PI/2;hz2.position.y=-.05;g.add(hz2);
  for(let k=0;k<4;k++){const a=Math.PI/4+k*Math.PI/2;const leg=new THREE.Mesh(new THREE.CylinderGeometry(.06,.09,1.3,16),wood);leg.position.set(Math.cos(a)*1.33,-.7,Math.sin(a)*1.33);g.add(leg)}
  const table=new THREE.Mesh(new THREE.CylinderGeometry(2.4,2.4,.08,64),new THREE.MeshStandardMaterial({color:0x3a2312,roughness:.5}));table.position.y=-1.38;g.add(table);return g}
async function buildScene(canvas,session){await loadThree();const renderer=new THREE.WebGLRenderer({canvas,antialias:true,preserveDrawingBuffer:true,alpha:true});renderer.setPixelRatio(Math.min(2,devicePixelRatio||1));renderer.setSize(canvas.clientWidth||1920,canvas.clientHeight||1080,false);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  const scene=new THREE.Scene();const camera=new THREE.PerspectiveCamera(34,(canvas.clientWidth||1920)/(canvas.clientHeight||1080),.05,60);
  const pmrem=new THREE.PMREMGenerator(renderer);scene.environment=pmrem.fromScene(new RoomEnvironment(),.04).texture;
  // lights: a candle-warm key, cool window fill, faint rim
  const key=new THREE.SpotLight(0xffd6a2,140,20,.55,.6,1.6);key.position.set(3.2,4.2,3.4);key.castShadow=true;key.shadow.mapSize.set(2048,2048);key.shadow.bias=-.0004;key.shadow.radius=4;scene.add(key);
  const fill=new THREE.DirectionalLight(0x9fb4d6,.9);fill.position.set(-4,2,-1);scene.add(fill);
  const rim=new THREE.DirectionalLight(0xffe7c4,.7);rim.position.set(-1,3,-4);scene.add(rim);
  scene.add(new THREE.AmbientLight(0x3a2c22,1.2));
  // stand
  const stand=new THREE.Group();scene.add(stand);const axis=new THREE.Group();axis.rotation.z=TILT;stand.add(axis);const spin=new THREE.Group();axis.add(spin);
  let gltfOK=false;try{const gltf=await new Promise((res,rej)=>new GLTFLoader().load('assets/globe-stand.glb',res,undefined,rej));const root=gltf.scene;stand.add(root);gltfOK=true;
    const tex={MeridianRing:meridianTexture(),HourCircle:hourTexture(),HorizonBand:horizonTexture(),CompassCard:compassCardTexture()};const reparent=[];
    root.traverse(o=>{if(!o.isMesh)return;o.castShadow=true;o.receiveShadow=true;if(o.name==='GlobeBall'){o.visible=false}if(o.material&&o.material.map&&!tex[o.name]&&/Mahogany|TableOak/i.test(o.material.name||'')){o.material.color.setHex(0x9a7a5a);o.material.roughness=Math.max(o.material.roughness,.45)}
      if(tex[o.name]){const t=new THREE.CanvasTexture(tex[o.name]);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=renderer.capabilities.getMaxAnisotropy();t.wrapS=THREE.RepeatWrapping;const brassy=o.name==='MeridianRing'||o.name==='HourCircle';o.material=brassy?new THREE.MeshStandardMaterial({map:t,metalness:1,roughness:.3,envMapIntensity:1}):new THREE.MeshStandardMaterial({map:t,roughness:.85,metalness:0});}
      if(o.material&&o.material.name&&/glass/i.test(o.material.name)){o.material.transparent=true;o.material.opacity=.25;o.material.depthWrite=false}
      if(['AxisPinN','AxisPinS','HourCircle','HourHand'].includes(o.name))reparent.push(o)});
    reparent.forEach(o=>axis.attach(o));
  }catch(e){console.warn('Globe stand glTF unavailable, using fallback',e);stand.add(fallbackStand())}
  // the ball
  const {world,painted}=worldData();const map=new THREE.CanvasTexture(painted.canvas);map.colorSpace=THREE.SRGBColorSpace;map.anisotropy=renderer.capabilities.getMaxAnisotropy();map.generateMipmaps=true;map.minFilter=THREE.LinearMipmapLinearFilter;
  const birth=new THREE.CanvasTexture(painted.birth);birth.minFilter=THREE.LinearFilter;birth.magFilter=THREE.LinearFilter;birth.generateMipmaps=false;
  const ballMat=new THREE.MeshPhysicalMaterial({map,roughness:.62,metalness:0,clearcoat:.28,clearcoatRoughness:.5,bumpMap:map,bumpScale:-.0012,envMapIntensity:.35});
  ballMat.userData.uniforms={uBirth:{value:birth},uProgress:{value:0},uPaper:{value:new THREE.Color('#e3d3aa')}};
  ballMat.onBeforeCompile=sh=>{Object.assign(sh.uniforms,ballMat.userData.uniforms);sh.fragmentShader=sh.fragmentShader.replace('#include <map_fragment>',`#include <map_fragment>
    float birthAt=texture2D(uBirth,vMapUv).r;float inkOn=smoothstep(birthAt,birthAt+.07,uProgress);diffuseColor.rgb=mix(uPaper,diffuseColor.rgb,inkOn);`).replace('uniform float opacity;','uniform float opacity;uniform sampler2D uBirth;uniform float uProgress;uniform vec3 uPaper;')};
  const ball=new THREE.Mesh(new THREE.SphereGeometry(1,192,128),ballMat);ball.castShadow=true;ball.receiveShadow=false;spin.add(ball);
  // gore seams as faint raised lines? — kept in the texture. A thin varnish highlight sphere:
  const varnish=new THREE.Mesh(new THREE.SphereGeometry(1.0025,96,64),new THREE.MeshPhysicalMaterial({color:0xffffff,transparent:true,opacity:.08,roughness:.15,metalness:0,clearcoat:1,clearcoatRoughness:.15,depthWrite:false}));spin.add(varnish);
  // dust motes
  const dustGeo=new THREE.BufferGeometry();const dn=260,dp=new Float32Array(dn*3);for(let i=0;i<dn;i++){dp[i*3]=(Math.random()-.5)*7;dp[i*3+1]=Math.random()*4-1.4;dp[i*3+2]=(Math.random()-.5)*7}dustGeo.setAttribute('position',new THREE.BufferAttribute(dp,3));const dust=new THREE.Points(dustGeo,new THREE.PointsMaterial({color:0xffe2b0,size:.014,transparent:true,opacity:.55,depthWrite:false}));scene.add(dust);
  const foci={atlas:{lon:-.25,lat:0},voyage:{lon:.9,lat:.1},incognita:{lon:2.6,lat:0},cartouche:{lon:0,lat:0}};
  if(painted.cartouche)foci.cartouche=painted.cartouche;if(painted.roses&&painted.roses.length){const r=painted.roses[0];foci.voyage={lon:r.x/GlobeWorld.TW*TAU-Math.PI,lat:Math.PI/2-r.y/GlobeWorld.TH*Math.PI}}
  const inc=world.contInfo.filter(c=>!c.known&&!c.southern).sort((a,b)=>b.size-a.size)[0];if(inc){let sx=0,sy=0,cx=0;const x0=inc.cells[0]%GlobeWorld.GW;for(const c of inc.cells){let x=c%GlobeWorld.GW;const dx=x-x0;x=x0+((dx+GlobeWorld.GW/2)%GlobeWorld.GW+GlobeWorld.GW)%GlobeWorld.GW-GlobeWorld.GW/2;sx+=x;sy+=(c/GlobeWorld.GW|0);cx++}foci.incognita={lon:((sx/cx+.5)/GlobeWorld.GW*TAU-Math.PI),lat:Math.PI/2-(sy/cx+.5)/GlobeWorld.GH*Math.PI}}
  return{renderer,scene,camera,stand,axis,spin,ball,ballMat,dust,world,painted,foci,gltfOK}}

function placeCamera(t3,k){const {camera}=t3;const {el,spin,tyAdj}=aim(k.lon,k.lat||0,k.az);const ty=k.ty+(k.d<4?tyAdj:0);camera.position.set(Math.sin(k.az)*Math.cos(el)*k.d,Math.sin(el)*k.d+k.ty*.4,Math.cos(k.az)*Math.cos(el)*k.d);camera.lookAt(0,ty,0);camera.updateProjectionMatrix();t3.spin.rotation.y=spin}

/* ---------------- UI + film loop ---------------- */
function notice(m){const n=$('globe-notice');if(n)n.textContent=m}
function release(){cancelAnimationFrame(raf);if(rec?.state==='recording')rec.stop();stream?.getTracks().forEach(t=>t.stop());stream=null;rec=null;recordCanvas=null;recordCtx=null;if(player){player.pause();player.removeAttribute('src');player.load();player=null}if(ac){ac.close().catch(()=>{});ac=null}
  if(three){three.renderer.dispose();three.scene.traverse(o=>{if(o.geometry)o.geometry.dispose();if(o.material){[].concat(o.material).forEach(m=>{for(const k in m)if(m[k]&&m[k].isTexture)m[k].dispose();m.dispose()})}});three.renderer.forceContextLoss?.();three=null}}
function start(record=false){if(running)return;running=true;const session=++sessionId;savedFocus=document.activeElement;const wrap=document.createElement('div');wrap.id='globe-film';
  wrap.innerHTML='<canvas id="globe3d" width="1920" height="1080"></canvas><div class="globe-heading"><small id="globe-stage"></small><h2 id="globe-title">Engraving the gores…</h2></div><div class="globe-audio"><audio id="globe-audio" controls preload="auto"></audio><p id="globe-notice" role="status"></p></div><div class="globe-footer"><span>AS THE STARS FALL · LOGICMOON</span><span id="globe-time"></span></div><button id="globe-close">End reveal</button><button id="globe-retry" hidden>Try again</button><div class="director"><div class="director-buttons"><button id="film-pause">Pause</button><button id="film-explore">Explore globe</button><button data-chapter="0">Paper</button><button data-chapter="13">Known world</button><button data-chapter="27">Voyages</button><button data-chapter="40">Incognita</button><button data-chapter="53">Cartouche</button></div><label for="film-seek">Film position</label><input id="film-seek" type="range" min="0" max="64" step="0.1" value="0"><small id="globe-stats">Drag to orbit, scroll to zoom in Explore mode. Drag the globe itself to spin it.</small></div><div class="globe-progress"><i id="globe-progress"></i></div>';
  document.body.append(wrap);$('globe-close').onclick=stop;$('globe-close').focus();$('globe-retry').onclick=()=>{stop();start(record)};
  player=$('globe-audio');player.src=new URL('stars-score.mp3',document.baseURI).href;player.volume=.8;
  if(record&&$('music').checked){try{ac=new(window.AudioContext||window.webkitAudioContext)();ac.resume().catch(()=>notice('Use the audio Play control to enable the soundtrack.'));const media=ac.createMediaElementSource(player);media.connect(ac.destination);const dest=ac.createMediaStreamDestination();media.connect(dest);audioTracks=dest.stream.getAudioTracks()}catch(e){audioTracks=[];notice('Audio capture is unavailable. The globe can still play.')}}else audioTracks=[];
  player.addEventListener('error',()=>{if(session===sessionId)notice('The soundtrack could not load. The globe will continue; use Play to retry the sound.')});
  if($('music').checked){const play=player.play();if(play)play.catch(()=>{if(session===sessionId)notice('Press Play in the audio controls to enable the soundtrack.')})}else notice('Music is off. Press Play below to listen.');
  const canvas=$('globe3d');
  (async()=>{try{await new Promise(r=>requestAnimationFrame(r));if(!running||session!==sessionId)return;const t0=performance.now();three=await buildScene(canvas,session);if(!running||session!==sessionId){release();return}
    const st=three.painted.stats;$('globe-stats').textContent=`${st.continents} continents · ${st.known} charted · ${st.towns+model.towns.filter(t=>t.type!=='ruin').length} ports · ${st.hachures.toLocaleString()} hachure strokes · ${st.trees.toLocaleString()} trees · ${st.ships} vessels · engraved in ${((performance.now()-t0)/1000).toFixed(1)} s`;
    if(!three.gltfOK)notice('The Blender stand could not load; a plain stand is shown.');
    if(record){if(!canvas.captureStream||!window.MediaRecorder)throw Error('This browser does not support video recording. Use Build a 3D globe to play it.');recordCanvas=document.createElement('canvas');recordCanvas.width=1920;recordCanvas.height=1080;recordCtx=recordCanvas.getContext('2d');stream=recordCanvas.captureStream(30);audioTracks.forEach(t=>stream.addTrack(t));const mime=['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/mp4'].find(m=>MediaRecorder.isTypeSupported(m));rec=new MediaRecorder(stream,mime?{mimeType:mime,videoBitsPerSecond:9000000}:undefined);let chunks=[],r=rec;r.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};r.onstop=()=>{if(!chunks.length)return;const blob=new Blob(chunks,{type:r.mimeType}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='inkbound-globe.'+(r.mimeType.includes('mp4')?'mp4':'webm');a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)};rec.start(200)}
    run(session,record)}catch(err){console.error(err);notice((err&&err.message)||'The globe could not start.');$('globe-title').textContent='The globe could not be built';$('globe-retry').hidden=false}})()}
function run(session,record){let filmT=0,paused=false,explore=false,last=performance.now(),orbit={az:.9,el:.15,d:2.8},dragging=null,spinVel=0,userSpin=0;const canvas=$('globe3d'),seek=$('film-seek');
  let lastW=0,lastH=0;const fit=()=>{const w=canvas.clientWidth||1920,h=canvas.clientHeight||1080;if(w!==lastW||h!==lastH){lastW=w;lastH=h;three.renderer.setPixelRatio(Math.min(2,devicePixelRatio||1));three.renderer.setSize(w,h,false);three.camera.aspect=w/h;three.camera.updateProjectionMatrix()}};
  $('film-pause').onclick=()=>{paused=!paused;$('film-pause').textContent=paused?'Play':'Pause';if(player){paused?player.pause():player.play().catch(()=>{})}};
  $('film-explore').onclick=()=>{explore=!explore;$('film-explore').textContent=explore?'Return to film':'Explore globe';if(explore){const k=keyAt(filmT,three.foci);orbit={az:k.az,el:aim(k.lon,k.lat,k.az).el,d:k.d};userSpin=three.spin.rotation.y;player?.pause()}else if(!paused)player?.play().catch(()=>{})};
  document.querySelectorAll('[data-chapter]').forEach(b=>b.onclick=()=>{filmT=+b.dataset.chapter;explore=false;$('film-explore').textContent='Explore globe';if(player){player.currentTime=filmT;if(!paused)player.play().catch(()=>{})}});
  seek.oninput=()=>{filmT=+seek.value;if(player)player.currentTime=filmT};
  canvas.onpointerdown=e=>{canvas.setPointerCapture(e.pointerId);dragging={x:e.clientX,y:e.clientY,az:orbit.az,el:orbit.el,spin:userSpin,onBall:onBall(e)}};
  canvas.onpointermove=e=>{if(!dragging||!explore)return;const dx=(e.clientX-dragging.x)/canvas.clientWidth,dy=(e.clientY-dragging.y)/canvas.clientHeight;if(dragging.onBall){userSpin=dragging.spin+dx*4;spinVel=0}else{orbit.az=dragging.az-dx*3.2;orbit.el=Math.max(-1.2,Math.min(1.2,dragging.el+dy*2.2))}};
  canvas.onpointerup=canvas.onpointercancel=()=>{dragging=null};
  canvas.onwheel=e=>{if(!explore)return;e.preventDefault();orbit.d=Math.max(1.25,Math.min(7,orbit.d*Math.exp(e.deltaY*.0012)))};
  function onBall(e){const r=canvas.getBoundingClientRect();const m=new THREE.Vector2(((e.clientX-r.left)/r.width)*2-1,-((e.clientY-r.top)/r.height)*2+1);const rc=new THREE.Raycaster();rc.setFromCamera(m,three.camera);return rc.intersectObject(three.ball,false).length>0}
  const audioDuration=()=>player&&isFinite(player.duration)&&player.duration>10?Math.min(DURATION,player.duration):DURATION;
  function frame(now){if(!running||session!==sessionId)return;const dt=Math.max(0,Math.min(.1,(now-last)/1000));last=now;fit();
    if(!paused&&!explore){if(player&&!player.paused&&isFinite(player.currentTime)&&Math.abs(player.currentTime-filmT)>.5)filmT=player.currentTime;else filmT+=dt;if(filmT>=audioDuration()){filmT=audioDuration();if(record){stop();return}paused=true;$('film-pause').textContent='Replay';$('film-pause').onclick=()=>{filmT=0;paused=false;$('film-pause').textContent='Pause';if(player){player.currentTime=0;player.play().catch(()=>{})}}}}
    seek.value=String(filmT);const pct=filmT/DURATION;$('globe-progress').style.width=(pct*100)+'%';$('globe-time').textContent=`${Math.floor(filmT)} / ${DURATION} SEC`;
    const si=Math.max(0,Math.min(stage.length-1,CHAPTERS.findLastIndex(c=>filmT>=c)));$('globe-stage').textContent=stage[si][0];$('globe-title').textContent=explore?'Explore the globe':stage[si][1];
    three.ballMat.userData.uniforms.uProgress.value=explore?1:Math.min(1,pct*1.3+.02);
    if(explore){const {camera}=three;camera.position.set(Math.sin(orbit.az)*Math.cos(orbit.el)*orbit.d,Math.sin(orbit.el)*orbit.d,Math.cos(orbit.az)*Math.cos(orbit.el)*orbit.d);camera.lookAt(0,0,0);userSpin+=dt*.05;three.spin.rotation.y=userSpin}else placeCamera(three,keyAt(filmT,three.foci));
    // dust drifts
    const p=three.dust.geometry.attributes.position;for(let i=0;i<p.count;i++){p.array[i*3+1]+=Math.sin(now*.0004+i)*.0006;p.array[i*3]+=Math.cos(now*.0003+i*.7)*.0004}p.needsUpdate=true;
    three.renderer.render(three.scene,three.camera);
    if(record&&recordCtx){recordCtx.drawImage(canvas,0,0,1920,1080)}
    raf=requestAnimationFrame(frame)}
  raf=requestAnimationFrame(frame)}
function stop(){if(!running)return;running=false;sessionId++;release();$('globe-film')?.remove();if(savedFocus&&savedFocus.focus)savedFocus.focus()}
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&running)stop()});
$('cinema').onclick=()=>start(false);$('record').onclick=()=>start(true);
window.InkboundGlobe={start,stop,worldData};
})();
