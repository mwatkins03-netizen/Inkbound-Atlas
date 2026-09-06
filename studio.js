/* Atlas settings + the shared elevation model handed to the 3D globe. */
(()=>{const $=id=>document.getElementById(id);let cached=null,key='';
function settings(){return{rough:Number($('terrain-rugged').value),relief:Number($('relief-gain').value),view:$('atlas-view').value,contours:$('layer-contours').checked,rivers:$('layer-rivers').checked,forest:$('layer-forest').checked,cities:$('layer-cities').checked}}
function globeModel(){const next=seed+'|'+kind+'|'+$('terrain-rugged').value+'|'+edits.length;if(next!==key||!cached){cached=TerrainAtlas.create(seed,model,{rugged:$('terrain-rugged').value});key=next}return cached}
function invalidate(){cached=null;key=''}
function refresh(){$('relief-value').textContent=Math.round(Number($('relief-gain').value)*100)+'%';draw()}
function restore(s){if(!s)return;for(const [k,id]of [['rough','terrain-rugged'],['relief','relief-gain'],['view','atlas-view']])if(s[k]!==undefined)$(id).value=s[k];for(const [k,id]of [['contours','layer-contours'],['rivers','layer-rivers'],['forest','layer-forest'],['cities','layer-cities']])if(typeof s[k]==='boolean')$(id).checked=s[k];invalidate()}
window.AtlasStudio={model:globeModel,settings,restore,invalidate};
['relief-gain','atlas-view','layer-contours','layer-rivers','layer-forest','layer-cities'].forEach(id=>$(id).addEventListener('change',refresh));
$('terrain-rugged').addEventListener('change',()=>{make()});
$('relief-value').textContent=Math.round(Number($('relief-gain').value)*100)+'%';})();
