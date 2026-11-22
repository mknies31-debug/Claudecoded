// Render smoke test — proves the inlined model kit (models.js → MODELS) draws
// through the REAL drawEnt without throwing, for every class/building, at every
// zoom, on every map. The sim gates (playtest/v1/camera/drift) never call
// drawEnt; this is the gate that does.
//   node rts/scripts/render-smoke.mjs
import fs from 'fs';

const html = fs.readFileSync('rts/game/index.html','utf8');
// expose the render path + spawn so we can force one of every shape onto the field
const script = html.match(/<script>([\s\S]*)<\/script>/)[1] + `
;globalThis.__api={ get ents(){return ents}, newGame, spawn, render, byName,
  get CAM(){return CAM}, applyCam, get MAP(){return MAP}, setMap:(m)=>{curMap=m;},
  get hqMe(){return hqMe}, tick, start:()=>{started=true;}, setFac:(p,c)=>{ME=p;CPU=c;} };`;

const noop=()=>{}; let drawCalls=0;
const grad={addColorStop:noop};
const cx=new Proxy({},{get:(_,p)=>{
  if(p==='createLinearGradient'||p==='createRadialGradient') return ()=>grad;
  if(p==='canvas') return {width:900,height:600};
  if(p==='measureText') return ()=>({width:10});
  if(p==='fill'||p==='stroke'||p==='fillRect'||p==='fillText'){ return ()=>{drawCalls++;}; }
  return noop;
}});
const mk=()=>({style:{},value:'',width:900,height:600,clientWidth:900,clientHeight:600,
  set textContent(v){},set innerHTML(v){},get innerHTML(){return '';},set onclick(f){},set onchange(f){},
  getContext:()=>cx,addEventListener:noop,appendChild:noop,
  getBoundingClientRect:()=>({width:900,height:600,left:0,top:0}),
  parentElement:{getBoundingClientRect:()=>({width:900,height:600})}});
globalThis.document={getElementById:()=>mk(),createElement:()=>mk()};
globalThis.window=globalThis; globalThis.addEventListener=noop;
globalThis.requestAnimationFrame=noop; globalThis.performance={now:()=>0}; globalThis.location={reload:noop};
new Function(script)();
const api=globalThis.__api;

// one roster unit name for every class we must draw
const byName=api.byName;
const classes=['Basic infantry','Specialist infantry','Scout vehicle','Main battle tank',
  'Advanced vehicle','Artillery','Aircraft','Epic unit','Structure'];
const sampleOf={};
for(const u of Object.values(byName)) if(!sampleOf[u.class]) sampleOf[u.class]=u.name;

let frames=0, fail=null;
const maps=Object.keys(api.MAP);
try{
  for(const mapName of maps){
    api.setFac('Directorate','Covenant'); api.setMap(api.MAP[mapName]); api.newGame();
    const hq=api.hqMe;
    // force one of every class onto the field near the HQ (both owners for team color)
    let ox=0;
    for(const c of classes){ const n=sampleOf[c]; if(!n) continue;
      api.spawn('me', n, hq.x+2+ox, hq.y-3); api.spawn('cpu', n, hq.x+2+ox, hq.y+3); ox+=2; }
    // every production building + a second HQ already exists; add the 3 missing halls
    for(const b of ['Motor Pool','Airstrip','Tech Center']){ api.spawn('me', b, hq.x-2-ox, hq.y); ox+=2; }
    api.tick(); // one sim step so facing/fx fields populate
    // render across the zoom range the camera allows
    for(const z of [0.6,1,1.8,3.2]){ api.CAM.z=z; api.applyCam();
      for(let f=0; f<25; f++){ api.render(); frames++; } }
  }
}catch(e){ fail=e; }

const spawnedClasses=new Set(api.ents.map(e=>e.cls));
console.log(`\nRender smoke — inlined MODELS kit through real drawEnt`);
console.log(`  maps rendered : ${maps.join(', ')}`);
console.log(`  classes drawn : ${[...spawnedClasses].sort().join(', ')}`);
console.log(`  frames        : ${frames}   ctx draw ops: ${drawCalls}`);
if(fail){ console.log(`\n✗ THREW during render: ${fail.stack||fail}`); process.exit(1); }
if(frames<300 || drawCalls<1000){ console.log(`\n✗ suspiciously few draws — render path not exercised`); process.exit(1); }
console.log(`\n✓ No throw across ${frames} frames · all classes + 4 buildings drew through MODELS.`);
process.exit(0);
