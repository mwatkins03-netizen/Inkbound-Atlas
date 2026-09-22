/* Inkbound — Read tab. A passage of prose goes to Jev (TypeSafe AI's System One model), which answers
   eight fixed questions about the place in the text as probabilities. The confident answers become
   the seed, shape, ruggedness, moisture and settlement density of the world. Where the text is silent,
   the map fogs. Jev never writes; every number shown is one the model returned.
   Depends on app.js globals: seed, kind, traits, title, edits, strokes, history, zoom, pan, make, hash, $, W, H, model, view, palette. */
(()=>{
'use strict';
const DEFAULT_ENDPOINT='https://jev-sandbox-proxy.watkins-um.workers.dev';
const LS='inkbound.jev.v1';
const store={get(){try{return JSON.parse(localStorage.getItem(LS))||{}}catch{return{}}},set(o){try{localStorage.setItem(LS,JSON.stringify(o))}catch{}}};
const endpoint=()=>store.get().endpoint||DEFAULT_ENDPOINT;
let reading=null; // {passage, answers, derived, at}

/* Public-domain passages. Each is a real page a class might read. */
const PRESETS=[
 {name:'Melville · Nantucket',title:'Nantucket',text:`Nantucket! Take out your map and look at it. See what a real corner of the world it occupies; how it stands there, away off shore, more lonely than the Eddystone lighthouse. Look at it—a mere hillock, and elbow of sand; all beach, without a background. There is more sand there than you would use in twenty years as a substitute for blotting paper. Some gamesome wights will tell you that they have to plant weeds there, they don't grow naturally; that they import Canada thistles; that they have to send beyond seas for a spile to stop a leak in an oil cask; that pieces of wood in Nantucket are carried about like bits of the true cross in Rome; that people there plant toadstools before their houses, to get under the shade in summer time; that one blade of grass makes an oasis, three blades in a day's walk a prairie; that they wear quicksand shoes, something like Laplander snow-shoes; that they are so shut up, belted about, every way inclosed, surrounded, and made an utter island of by the ocean, that to their very chairs and tables small clams will sometimes be found adhering, as to the backs of sea turtles.`},
 {name:'Hardy · Egdon Heath',title:'Egdon Heath',text:`A Saturday afternoon in November was approaching the time of twilight, and the vast tract of unenclosed wild known as Egdon Heath embrowned itself moment by moment. Overhead the hollow stretch of whitish cloud shutting out the sky was as a tent which had the whole heath for its floor. The heaven being spread with this pallid screen and the earth with the darkest vegetation, their meeting-line at the horizon was clearly marked. In such contrast the heath wore the appearance of an instalment of night which had taken up its place before its astronomical hour was come: darkness had to a great extent arrived hereon, while day stood distinct in the sky. The face of the heath by its mere complexion added half an hour to evening; it could in like manner retard the dawn, sadden noon, anticipate the frowning of storms scarcely generated, and intensify the opacity of a moonless midnight to a cause of shaking and dread.`},
 {name:'Brontë · Wuthering Heights',title:'Wuthering Heights',text:`Wuthering Heights is the name of Mr. Heathcliff's dwelling. "Wuthering" being a significant provincial adjective, descriptive of the atmospheric tumult to which its station is exposed in stormy weather. Pure, bracing ventilation they must have up there at all times, indeed: one may guess the power of the north wind blowing over the edge, by the excessive slant of a few stunted firs at the end of the house; and by a range of gaunt thorns all stretching their limbs one way, as if craving alms of the sun. Happily, the architect had foresight to build it strong: the narrow windows are deeply set in the wall, and the corners defended with large jutting stones.`},
 {name:'Stevenson · The island',title:'Skeleton Island',text:`The appearance of the island when I came on deck next morning was altogether changed. Although the breeze had now utterly ceased, we had made a great deal of way during the night and were now lying becalmed about half a mile to the south-east of the low eastern coast. Grey-coloured woods covered a large part of the surface. This even tint was indeed broken up by streaks of yellow sand-break in the lower lands, and by many tall trees of the pine family, out-topping the others—some singly, some in clumps; but the general colouring was uniform and sad. The hills ran up clear above the vegetation in spires of naked rock. All were strangely shaped, and the Spy-glass, which was by three or four hundred feet the tallest on the island, was likewise the strangest in configuration, running up sheer from almost every side and then suddenly cut off at the top like a pedestal to put a statue on.`},
 {name:'London · The Yukon',title:'The Yukon Trail',text:`Day had broken cold and grey, exceedingly cold and grey, when the man turned aside from the main Yukon trail and climbed the high earth-bank, where a dim and little-travelled trail led eastward through the fat spruce timberland. It was a steep bank, and he paused for breath at the top, excusing the act to himself by looking at his watch. It was nine o'clock. There was no sun nor hint of sun, though there was not a cloud in the sky. It was a clear day, and yet there seemed an intangible pall over the face of things, a subtle gloom that made the day dark, and that was due to the absence of sun. The Yukon lay a mile wide and hidden under three feet of ice. On top of this ice were as many feet of snow. It was all pure white, rolling in gentle undulations where the ice-jams of the freeze-up had formed. North and south, as far as his eye could see, it was unbroken white.`}
];

const QUESTIONS={
 shape:{type:'choice',instructions:'Judging only from this passage, which shape of land best describes the place?',criteria:{kingdom:'A broad continental mainland: plains, hills, inland distances.',islands:'An island or archipelago, small land surrounded by sea.',desert:'An arid land: sand, dunes, dry heat, scarce water.',frozen:'A cold northern land: snow, ice, tundra, dark conifers.'}},
 coast:{type:'noul',instructions:'Is the sea, a coast, a harbour, or the shore prominent in this passage?'},
 mountains:{type:'noul',instructions:'Are mountains, peaks, cliffs, or steep high ground prominent in this passage?'},
 forest:{type:'noul',instructions:'Are forests, woods, or dense trees prominent in this passage?'},
 river:{type:'noul',instructions:'Is a river, stream, or flowing fresh water prominent in this passage?'},
 settle:{type:'score',instructions:'How settled by people is the place described, from empty wilderness to a great city?',criteria:['Empty wilderness with no sign of people.','A lone dwelling, a trail, or a ruin.','A village or a few scattered farms and holds.','Towns, roads, and regular traffic.','A great city or a densely settled country.']},
 mood:{type:'choice',instructions:'What is the dominant mood of the place as the passage describes it?',criteria:{bleak:'Bleak, barren, sad, desolate.',serene:'Calm, pastoral, gentle, orderly.',menacing:'Threatening, stormy, dangerous, dreadful.',prosperous:'Rich, busy, abundant, thriving.'}},
 rift:{type:'noul',instructions:'Is a gorge, canyon, ravine, deep valley cleft, or rift prominent in this passage?'}
};
const LABEL={shape:'Land shape',coast:'Coast',mountains:'Mountains',forest:'Forest',river:'River',settle:'Settlement',mood:'Mood',rift:'Rift or gorge'};
const RUGGED={low:'0.65',mid:'1',high:'1.3'};

async function jev(state,questions){
  const r=await fetch(endpoint(),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({state,model:'jev-latest',questions})});
  const data=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(data.error||(data.detail&&JSON.stringify(data.detail))||('HTTP '+r.status));
  return data;
}
async function checkConn(){const el=$('jev-status');try{const r=await fetch(endpoint(),{method:'GET'});if(!r.ok)throw 0;el.textContent='connected';el.style.color='#8fd19a'}catch{el.textContent='unreachable';el.style.color='#d98a7a'}}

/* confidence of a typed answer: how far it is from a shrug */
const conf=(q,a)=>{if(!a)return 0;if(q.type==='noul')return Math.abs(a.noul-.5)*2;const P=Object.values(a.probabilities||{});return P.length?Math.max(...P):0};
function derive(answers,passage,presetTitle){
  const a=answers;const p=k=>a[k]?.noul??.5;
  const shapeP=a.shape?.probabilities||{};const kind=a.shape?.choice&&['kingdom','islands','desert','frozen'].includes(a.shape.choice)?a.shape.choice:'kingdom';
  const settleProbs=a.settle?.probabilities||{};const settle=Object.entries(settleProbs).reduce((s,[k,v])=>s+(+k)*v,0);
  const detail=settle<1.2?1:settle<2.6?2:3;
  const rugged=p('mountains')>.66?RUGGED.high:p('mountains')<.33?RUGGED.low:RUGGED.mid;
  const traits={rift:p('rift')>.55,wet:p('forest')>.62,dry:p('forest')<.3&&kind!=='frozen',rivers:p('river')>.62,dryland:p('river')<.25};
  const mood=a.mood?.choice||'serene';const pal={bleak:'ivory',menacing:'night',serene:'parchment',prosperous:'parchment'}[mood]||'parchment';
  const quoted=passage.match(/["“]([^"”]{2,40})["”]/)?.[1];
  const title=presetTitle||quoted||'A Reading';
  const silent=Object.keys(QUESTIONS).filter(k=>conf(QUESTIONS[k],a[k])<.35);
  const unsure=Object.keys(QUESTIONS).filter(k=>{const c=conf(QUESTIONS[k],a[k]);return c>=.35&&c<.65});
  const doubt=Object.keys(QUESTIONS).reduce((s,k)=>s+(1-conf(QUESTIONS[k],a[k])),0)/Object.keys(QUESTIONS).length;
  return{kind,detail,rugged,traits,mood,pal,title,settle,silent,unsure,doubt,shapeP};
}

function renderReading(){
  const box=$('reading');if(!reading){box.hidden=true;return}box.hidden=false;
  const a=reading.answers,d=reading.derived;const pct=v=>Math.round(v*100)+'%';
  const row=(k)=>{const q=QUESTIONS[k],ans=a[k];const c=conf(q,ans);const cls=c<.35?'silent':'';
    if(q.type==='noul'){const v=ans?.noul??0;return `<div class="q ${cls}"><b>${LABEL[k]}</b><div class="bar"><i class="${c<.35?'split':''}" data-w="${pct(v)}"></i></div><span class="p">${pct(v)}</span></div>`}
    if(q.type==='score'){const P=ans?.probabilities||{};const keys=Object.keys(P).sort();return `<div class="q ${cls}"><b>${LABEL[k]}<span class="cut">${d.settle.toFixed(1)} of 4</span></b><div><div class="sp">${keys.map(kk=>`<i class="${kk==String(Math.round(d.settle))?'win':''}" style="--w:${pct(P[kk])}"></i>`).join('')}</div><div class="spl">${keys.map(kk=>`<span>L${kk}</span>`).join('')}</div></div><span class="p">${pct(c)}</span></div>`}
    const P=ans?.probabilities||{};const keys=Object.keys(q.criteria);return `<div class="q ${cls}"><b>${LABEL[k]}<span class="cut">${ans?.choice||'?'}</span></b><div><div class="sp">${keys.map(kk=>`<i class="${kk===ans?.choice?'win':''}" style="--w:${pct(P[kk]||0)}" title="${kk} ${pct(P[kk]||0)}"></i>`).join('')}</div><div class="spl">${keys.map(kk=>`<span>${kk}</span>`).join('')}</div></div><span class="p">${pct(c)}</span></div>`};
  const silentNames=d.silent.map(k=>LABEL[k].toLowerCase());
  box.innerHTML=`<h4>WHAT THE TEXT SAID · ${reading.model||'jev-latest'}</h4>${Object.keys(QUESTIONS).map(row).join('')}
  <p class="silentline">${silentNames.length?`The passage is <b>silent</b> on ${silentNames.join(', ')}. Those parts of the map are fogged and drawn from the seed alone.`:'The passage speaks to every question. No fog.'} ${d.unsure.length?`It is <b>unsure</b> about ${d.unsure.map(k=>LABEL[k].toLowerCase()).join(', ')}.`:''} Overall doubt ${pct(d.doubt)}.</p>`;
  requestAnimationFrame(()=>setTimeout(()=>box.querySelectorAll('[data-w]').forEach(i=>i.style.width=i.dataset.w),60));
}

/* Fog overlay drawn on the atlas after the map: a vellum ring whose weight is the model's doubt,
   plus a cartouche listing what the text did not say. */
function overlay(g){
  if(!reading||!$('fog').checked)return;const d=reading.derived;if(!d.silent.length&&!d.unsure.length)return;
  const pal=palette();const v=view();
  g.save();g.setTransform(1,0,0,1,0,0);
  const strength=Math.min(.85,.18+d.doubt*1.1+(d.silent.length*.08));
  const grad=g.createRadialGradient(W/2,H/2,Math.min(W,H)*.28,W/2,H/2,Math.max(W,H)*.62);
  grad.addColorStop(0,'rgba(0,0,0,0)');grad.addColorStop(.55,'rgba(0,0,0,0)');grad.addColorStop(1,(v==='relief'?pal.reliefPaper:pal.paper));
  g.globalAlpha=strength;g.fillStyle=grad;g.fillRect(0,0,W,H);
  // stippled edge
  g.globalAlpha=Math.min(.6,strength*.8);g.fillStyle=pal.ink||'#4a3a22';const rs=rng(seed^0xf06);
  for(let i=0;i<2600*strength;i++){const ang=rs()*Math.PI*2,rad=Math.min(W,H)*.34+rs()*Math.min(W,H)*.16;const x=W/2+Math.cos(ang)*rad*(W/H),y=H/2+Math.sin(ang)*rad;if(x>40&&x<W-40&&y>40&&y<H-40){g.globalAlpha=Math.min(.5,strength*(.15+rs()*.5));g.fillRect(x,y,1.4,1.4)}}
  // cartouche
  const lines=['TERRA INCOGNITA',d.silent.length?'The text is silent on':'The text is unsure of',(d.silent.length?d.silent:d.unsure).map(k=>LABEL[k].toLowerCase()).join(' · ')||'little',`doubt ${Math.round(d.doubt*100)}%`];
  g.globalAlpha=.92;const bw=380,bh=112,bx=W-bw-70,by=70;g.fillStyle=v==='relief'?pal.reliefPaper:pal.paper;g.fillRect(bx,by,bw,bh);g.globalAlpha=1;g.strokeStyle=pal.ink||'#4a3a22';g.lineWidth=1.2;g.strokeRect(bx+5,by+5,bw-10,bh-10);g.setLineDash([2,3]);g.strokeRect(bx+11,by+11,bw-22,bh-22);g.setLineDash([]);
  g.fillStyle=pal.ink||'#4a3a22';g.textAlign='center';g.font=`600 20px ${AtlasRender.SERIF}`;g.fillText(lines[0],bx+bw/2,by+38);g.font=`13px ${AtlasRender.SERIF}`;g.fillText(lines[1],bx+bw/2,by+60);g.font=`600 14px ${AtlasRender.SERIF}`;g.fillText(lines[2].slice(0,56),bx+bw/2,by+80);g.font=`11px sans-serif`;g.globalAlpha=.75;g.fillText(lines[3]+' · read by Jev',bx+bw/2,by+98);
  g.restore();
}
function rng(s){let x=(s>>>0)||1;return()=>{x|=0;x=x+0x6D2B79F5|0;let t=Math.imul(x^x>>>15,1|x);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}

async function read(){
  const text=$('passage-text').value.trim();if(text.length<80){$('status').textContent='Give the atlas at least a few sentences to read.';return}
  const btn=$('read-jev');btn.disabled=true;$('status').textContent='Jev is reading the passage…';
  try{
    const res=await jev(text,QUESTIONS);const answers=res.answers||{};
    const preset=PRESETS.find(p=>p.text===text);
    const derived=derive(answers,text,preset?.title);
    reading={passage:text,answers,derived,model:res.model,at:Date.now()};
    // apply to the world
    seed=hash(text);kind=derived.kind;traits=derived.traits;title=derived.title;edits=[];strokes=[];history=[];zoom=1;pan={x:0,y:0};
    $('terrain-rugged').value=derived.rugged;$('detail').value=String(derived.detail);$('detailout').textContent=['Sparse','Balanced','Abundant'][derived.detail-1];$('palette').value=derived.pal;$('mapwrap').style.background=palette().paper;
    window.AtlasStudio?.invalidate();make();renderReading();
    $('status').textContent=`Drawn from the reading: ${derived.kind}, ${['sparse','balanced','abundant'][derived.detail-1]} settlement, ${derived.mood} mood. ${derived.silent.length?derived.silent.length+' question'+(derived.silent.length>1?'s':'')+' left in fog.':derived.unsure.length?'Light fog: unsure about '+derived.unsure.map(k=>LABEL[k].toLowerCase()).join(', ')+'.':'No fog.'}`;
  }catch(err){$('status').textContent='Jev did not answer: '+err.message+' Check the Jev connection under the passage.';}
  finally{btn.disabled=false}
}

/* wiring */
const presets=$('passage-presets');PRESETS.forEach(p=>{const b=document.createElement('button');b.textContent=p.name;b.onclick=()=>{$('passage-text').value=p.text;read()};presets.append(b)});
$('read-jev').onclick=read;$('fog').onchange=()=>draw();
$('passage-text').addEventListener('keydown',e=>{if(e.key==='Enter'&&(e.metaKey||e.ctrlKey))read()});
// connection dialog
const dlg=document.createElement('dialog');dlg.className='jevdlg';dlg.innerHTML=`<h3>Jev connection</h3><p>The atlas posts the passage and eight questions to a proxy that holds the API key and stores nothing. Leave blank for the University of Mississippi Worker, or paste your own Worker or local proxy URL.</p><input id="jev-ep" type="url" placeholder="${DEFAULT_ENDPOINT}"><div class="row"><button id="jev-ep-reset">Use default</button><button class="gold" id="jev-ep-save">Save</button></div>`;document.body.append(dlg);
$('jev-conn').onclick=()=>{dlg.querySelector('#jev-ep').value=store.get().endpoint||'';dlg.showModal()};
dlg.querySelector('#jev-ep-save').onclick=()=>{const v=dlg.querySelector('#jev-ep').value.trim();store.set({...store.get(),endpoint:v||null});dlg.close();checkConn()};
dlg.querySelector('#jev-ep-reset').onclick=()=>{store.set({...store.get(),endpoint:null});dlg.close();checkConn()};
checkConn();

window.AtlasReader={overlay,state:()=>reading?{passage:reading.passage,answers:reading.answers,model:reading.model,at:reading.at}:null,
  restore(r){if(!r||!r.answers)return;reading={...r,derived:derive(r.answers,r.passage||'',null)};$('passage-text').value=r.passage||'';renderReading();
    document.querySelector('[data-mode="passage"]')?.click()}};
})();
