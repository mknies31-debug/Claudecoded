#!/usr/bin/env node
// Permanent playtest gate for the single-file RTS (rts/game/index.html).
// Named regression scenarios distilled from adversarial playtesting — each one
// encodes a bug that WAS in the build (rush difficulty inversion, turret
// target-lock, stealth assassin, gatherer stacking, free tech via wood-on-ore,
// water/off-map orders, relay capture rules) plus a cross-faction match sweep.
//
//   node rts/scripts/playtest-check.mjs             # run every scenario
//   node rts/scripts/playtest-check.mjs rush-defense  # run one
//
// Exit 0 when every scenario passes, 1 otherwise. Harness pattern follows
// match-batch.mjs: extract the game's <script>, evaluate it under a DOM/canvas
// shim, drive tick() directly (30 ticks = 1 s), seeded RNG for reproducibility.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HTML_PATH = path.resolve(HERE, '../game/index.html');
const html = fs.readFileSync(HTML_PATH, 'utf8');

// ---- exposer: surfaces engine internals; appended to the game script -------
const EXPOSE = `
;globalThis.__api={get ents(){return ents},get credits(){return credits},get over(){return over},
get oreUnlocked(){return oreUnlocked},get hqMe(){return hqMe},get hqCpu(){return hqCpu},
get nodes(){return nodes},get relays(){return relays},byName,BUILDABLE,GATH,queueBuild,pdps,effHP,
acquire,revealed,spawn,tick,setFac:(p,c)=>{ME=p;CPU=c;newGame();},setMap:n=>{MAP=MAPS[n];newGame();},
get MAPS(){return MAPS},start:()=>{started=true},setDiff:d=>{DIFF=d},setSpeed:m=>{BUILDMULT=m},
tier1,passable,sx,sy,get ME(){return ME},get CPU(){return CPU},get simSecs(){return simSecs},
get sel(){return sel},select:a=>{sel=a},clear:()=>{ents=[]}};`;
const script = html.match(/<script>([\s\S]*)<\/script>/)[1] + EXPOSE;

// deterministic RNG (same generator as match-batch.mjs)
function seedRandom(seed){ Math.random = () => { seed|=0; seed = seed + 0x6D2B79F5 | 0;
  let t = Math.imul(seed ^ seed>>>15, 1|seed); t = t + Math.imul(t ^ t>>>7, 61|t) ^ t;
  return ((t ^ t>>>14)>>>0)/4294967296; }; }

// ---- DOM/canvas shim; canvas event listeners are captured so scenarios can
// drive the REAL input handlers (right-click orders) instead of reimplementing them
function freshEngine(){
  const noop=()=>{}; const grad={addColorStop:noop};
  const cx=new Proxy({},{get:(_,p)=> p==='createLinearGradient'||p==='createRadialGradient' ? ()=>grad
    : p==='canvas' ? {width:900,height:600} : noop, set:()=>true});
  const els={};
  const mk=id=>{ if(els[id]) return els[id];
    const el={_ls:{},style:{},value:'',disabled:false,title:'',width:900,height:600,
      clientWidth:900,clientHeight:600,textContent:'',innerHTML:'',
      getContext:()=>cx, appendChild:noop,
      addEventListener(t,f){(this._ls[t]??=[]).push(f);},
      getBoundingClientRect:()=>({width:900,height:600,left:0,top:0}),
      parentElement:{getBoundingClientRect:()=>({width:900,height:600})}};
    return els[id]=el; };
  globalThis.document={getElementById:mk,createElement:()=>({...mk('_tmp'),_ls:{}})};
  globalThis.window=globalThis; globalThis.addEventListener=noop;
  globalThis.requestAnimationFrame=noop; globalThis.performance={now:()=>0}; globalThis.location={reload:noop};
  delete globalThis.__api;
  new Function(script)();
  const api=globalThis.__api;
  api.fire=(id,type,ev)=>{ for(const f of (els[id]?._ls[type]||[])) f(ev); }; // real handlers
  return api;
}

const secs=t=>(t/30).toFixed(1)+'s';
const armyOf=(api,side)=>api.ents.filter(e=>e.owner===side&&api.pdps(e.u)>0&&e.cls!=='HQ');

// =============================================================================
// SCENARIOS
// =============================================================================
const SCENARIOS = {

  // 1 — a 5-Rifleman instant-build rush must NOT beat expert (defend trigger).
  'rush-defense'(){
    seedRandom(11);
    const api=freshEngine();
    api.setMap('Twin Ridge'); api.setFac('Directorate','Covenant');
    api.setDiff('expert'); api.setSpeed(0.02); api.start();
    let queued=0, t=0; const CAP=420*30;
    for(t=0;t<CAP && !api.over;t++){
      if(queued<5 && api.credits.me>=300){ api.queueBuild('me',api.hqMe,'Rifleman Squad'); queued++; }
      if(t%30===0) for(const e of api.ents)
        if(e.owner==='me'&&e.name==='Rifleman Squad'&&e.order!=='attack'){
          e.order='attack'; e.tx=api.hqCpu.x; e.ty=api.hqCpu.y; e.tgt=null; }
      api.tick();
    }
    const alive=api.ents.filter(e=>e.owner==='me'&&e.name==='Rifleman Squad').length;
    const pass = api.over!=='me';
    return {pass, detail:`outcome=${api.over??'undecided'} @${secs(t)} · rush queued ${queued}, riflemen alive ${alive}/5 · `
      +`CPU HQ ${api.hqCpu.hp.toFixed(0)}/6000 hp · CPU army ${armyOf(api,'cpu').length} — expert must repel a tier-1 rush`};
  },

  // 2 — turret ignores out-of-range bait (range+0.5 lock), kills the in-range raider, survives.
  'turret-duty'(){
    seedRandom(22);
    const api=freshEngine();
    api.setMap('Twin Ridge'); api.setFac('Directorate','Covenant'); api.setDiff('normal'); api.start();
    api.clear();
    const tur =api.spawn('me','Sentry Turret',24,80);       // range 6 → lock radius 6.5
    const bait=api.spawn('cpu','Hijacker',31.5,80);         // unarmed bait at 7.5 (outside lock)
    const raid=api.spawn('cpu','Raider Squad',28.5,80);     // at 4.5 (inside range)
    let baitLocked=false, killT=-1;
    for(let i=0;i<45*30;i++){ api.tick();
      if(tur.tgt===bait) baitLocked=true;
      if(killT<0 && !api.ents.includes(raid)) killT=i; }
    const moved=Math.hypot(tur.x-24,tur.y-80);
    const pass = killT>=0 && killT<=40*30 && api.ents.includes(tur) && tur.hp>tur.maxHp*0.6
              && !baitLocked && bait.hp===bait.maxHp && moved<1e-9;
    return {pass, detail:`raider killed ${killT>=0?'@'+secs(killT):'NEVER'} · turret hp ${tur.hp.toFixed(0)}/${tur.maxHp} `
      +`· bait at 7.5 locked=${baitLocked}, bait hp ${bait.hp}/${bait.maxHp} · turret drift ${moved.toExponential(1)} tiles`};
  },

  // 3 — 8-Saboteur assassin squad vs expert: must not win losslessly (scaled detectors answer stealth).
  'stealth-answer'(){
    seedRandom(33);
    const api=freshEngine();
    api.setMap('Twin Ridge'); api.setFac('Covenant','Directorate');
    api.setDiff('expert'); api.setSpeed(0.02); api.start();
    let queued=0, t=0; const CAP=420*30; const sabs=new Set();
    for(t=0;t<CAP && !api.over;t++){
      if(queued<8 && api.credits.me>=400){ api.queueBuild('me',api.hqMe,'Saboteur'); queued++; }
      for(const e of api.ents) if(e.owner==='me'&&e.name==='Saboteur') sabs.add(e);
      const mine=[...sabs].filter(e=>api.ents.includes(e));
      if(t%30===0 && mine.length>=Math.min(8,queued) && queued>=8)
        for(const e of mine) if(e.order!=='attack'){ e.order='attack'; e.tx=api.hqCpu.x; e.ty=api.hqCpu.y; e.tgt=null; }
      api.tick();
    }
    const alive=[...sabs].filter(e=>api.ents.includes(e)).length;
    const losses=sabs.size-alive;
    const cpuDet=api.ents.filter(e=>e.owner==='cpu'&&e.u.detector).length;
    const pass = !(api.over==='me' && losses===0);           // lossless assassin win = regression
    return {pass, detail:`outcome=${api.over??'undecided'} @${secs(t)} · saboteurs built ${sabs.size}, lost ${losses}, alive ${alive} `
      +`· CPU detectors ${cpuDet} · CPU HQ ${Math.max(0,api.hqCpu.hp).toFixed(0)}/6000 hp`};
  },

  // 4 — node yield caps at ~4 workers; a wood harvester parked on ore does NOT unlock tier-2.
  'node-economics'(){
    seedRandom(44);
    const yieldOf=(count)=>{ const api=freshEngine();
      api.setMap('Twin Ridge'); api.setFac('Directorate','Covenant'); api.start(); api.clear();
      const n=api.nodes.find(n=>n.type==='wood'&&n.x===18);
      for(let i=0;i<count;i++){ const g=api.spawn('me','Lumber Harvester',18+Math.cos(i)*0.4,32+Math.sin(i)*0.4);
        g.order='harvest'; g.node=n; }
      const c0=api.credits.me;
      for(let i=0;i<30*30;i++) api.tick();
      return api.credits.me-c0; };
    const g1=yieldOf(1), g15=yieldOf(15), ratio=g15/g1;
    // tech gate: wood harvester aimed at ore must not unlock; a real miner must.
    seedRandom(45);
    const api=freshEngine();
    api.setMap('Twin Ridge'); api.setFac('Directorate','Covenant'); api.start(); api.clear();
    const ore=api.nodes.find(n=>n.type==='ore'&&n.x===36);
    const w=api.spawn('me','Lumber Harvester',36.5,18); w.order='harvest'; w.node=ore;
    for(let i=0;i<60*30;i++) api.tick();
    const woodUnlocked=api.oreUnlocked.me;
    const m=api.spawn('me','Mining Vehicle',36.5,18.5); m.order='harvest'; m.node=ore;
    for(let i=0;i<10*30;i++) api.tick();
    const minerUnlocked=api.oreUnlocked.me;
    const pass = ratio<=4.5 && ratio>=3.2 && !woodUnlocked && minerUnlocked;
    return {pass, detail:`30s wood yield: 1 worker ${g1.toFixed(0)}cr, 15 workers ${g15.toFixed(0)}cr → ratio ${ratio.toFixed(2)}× (cap ~4×) `
      +`· wood-rig-on-ore 60s → oreUnlocked=${woodUnlocked} (want false) · real miner 10s → oreUnlocked=${minerUnlocked} (want true)`};
  },

  // 5 — real right-click handler: water order snaps to shore, off-map order clamps inside.
  'order-sanity'(){
    seedRandom(55);
    const api=freshEngine();
    api.setMap('Twin Ridge'); api.setFac('Directorate','Covenant'); api.start(); api.clear();
    const u=api.spawn('me','Vanguard MBT',30,50);
    api.select([u]);
    // right-click INTO the NW water pool (segment (20,60)-(40,60)) via the real handler
    api.fire('cv','contextmenu',{preventDefault(){}, offsetX:api.sx(30), offsetY:api.sy(61)});
    const goalPassable=api.passable(u.tx,u.ty);
    let wet=0, maxWet=0, t1=0;
    for(t1=0;t1<60*30;t1++){ api.tick();
      if(!api.passable(u.x,u.y)){ wet++; maxWet=Math.max(maxWet,wet); } else wet=0;
      if(u.order==='idle') break; }
    const shoreOk = u.order==='idle' && api.passable(u.x,u.y) && Math.hypot(u.x-30,u.y-61)<8;
    const shorePos=`(${u.x.toFixed(1)},${u.y.toFixed(1)})`;
    // right-click OFF the map
    api.select([u]);
    api.fire('cv','contextmenu',{preventDefault(){}, offsetX:api.sx(-15), offsetY:api.sy(50)});
    const clamped = u.tx>=0&&u.tx<=128&&u.ty>=0&&u.ty<=128;
    let out=false, t2=0;
    for(t2=0;t2<60*30;t2++){ api.tick();
      if(u.x<0||u.x>128||u.y<0||u.y>128) out=true;
      if(u.order==='idle') break; }
    const pass = goalPassable && shoreOk && maxWet<=60 && clamped && !out && u.order==='idle';
    return {pass, detail:`water click → goal passable=${goalPassable}, ended idle@${shorePos} in ${secs(t1)}, `
      +`max ticks-in-water ${maxWet} (≤60=2s) · off-map click → goal clamped=${clamped}, left map=${out}, idle in ${secs(t2)}`};
  },

  // 6 — relay: ~8s capture, captured relay reveals stealth in DET_R, cloaked-alone cannot capture.
  'relay-loop'(){
    seedRandom(66);
    const api=freshEngine();
    api.setMap('Twin Ridge'); api.setFac('Directorate','Covenant'); api.start(); api.clear();
    const relay=api.relays.find(r=>r.y===40);               // relay-south (64,40)
    api.spawn('me','Rifleman Squad',64,39);
    let capT=-1;
    for(let i=0;i<15*30;i++){ api.tick(); if(capT<0 && relay.owner==='me') capT=i; }
    const capOk = capT>=0 && capT>=7.5*30 && capT<=9.5*30;
    // detection through the captured relay (no mobile detectors anywhere)
    const sabNear=api.spawn('cpu','Saboteur',64,45);        // 5 tiles from relay < DET_R 11
    const sabFar =api.spawn('cpu','Saboteur',100,100);
    const revealNear=api.revealed(sabNear,'me'), revealFar=api.revealed(sabFar,'me');
    // cloaked unit alone must NOT capture
    seedRandom(67);
    const api2=freshEngine();
    api2.setMap('Twin Ridge'); api2.setFac('Directorate','Covenant'); api2.start(); api2.clear();
    const relay2=api2.relays.find(r=>r.y===40);
    api2.spawn('cpu','Saboteur',64,39);
    for(let i=0;i<15*30;i++) api2.tick();
    const cloakBlocked = relay2.owner===null && relay2.prog===0;
    const pass = capOk && revealNear && !revealFar && cloakBlocked;
    return {pass, detail:`capture ${capT>=0?'@'+secs(capT):'NEVER'} (want ~8s) · owned relay reveals stealth@5 tiles=${revealNear}, `
      +`@50 tiles=${revealFar} (want true/false) · cloaked-alone 15s → owner=${relay2.owner} prog=${relay2.prog.toFixed(1)} (want null/0)`};
  },

  // 8 — REAL browser events must never freeze the sim. Encodes the P0 where the
  // mousemove handler wrote hover coords into `over` (the game-over flag): one
  // hover froze tick() forever and made endGame a no-op. Drives the actual
  // captured canvas handlers, not tick()-only.
  'hover-freeze'(){
    seedRandom(80);
    const api=freshEngine();
    api.setMap('Twin Ridge'); api.setFac('Directorate','Covenant'); api.start();
    for(let k=0;k<90;k++) api.tick();
    const t0=api.simSecs;
    // fire real mouse events across the canvas mid-game
    for(let i=0;i<10;i++){ api.fire('cv','mousemove',{offsetX:100+i*60,offsetY:80+i*40}); api.tick(); }
    for(let k=0;k<90;k++) api.tick();
    const advanced = api.simSecs > t0+2.9;                 // sim kept running through hover
    const notOver = !api.over;                             // hover must not fake a game-over
    // and the game can still END after hovering: overwhelm the CPU HQ
    for(let i=0;i<10;i++) api.spawn('me','Howitzer', api.hqCpu.x+6, api.hqCpu.y+6);
    let ended=false; for(let k=0;k<120*30 && !ended;k++){ api.tick(); if(api.over) ended=true;
      if(k%30===0) for(const e of api.ents) if(e.owner==='me'&&e.name==='Howitzer'&&e.order!=='attack'){ e.order='attack'; e.tx=api.hqCpu.x; e.ty=api.hqCpu.y; } }
    const pass = advanced && notOver && ended && api.over==='me';
    return {pass, detail:`sim advanced through 10 real mousemoves (${t0.toFixed(1)}s → ${api.simSecs.toFixed(1)}s, want +3s) · `
      +`over-flag clean=${notOver} · endGame still fires after hover=${ended} (outcome=${api.over})`};
  },

  // 7 — 6 cross-faction both-sides-driven matches across the 3 maps all conclude, no draws.
  'match-sweep'(){
    const CAP_TICKS=900*30;
    const kiteF=(a,b)=>{ const gap=(b.range||5)-(a.range||5);
      return gap<=0?1:(a.mobile!==false?Math.max(0.5,1-0.10*gap):Math.max(0.05,1-0.30*gap)); };
    // mirror of the engine's 'hard' policy driving the 'me' side (match-batch pattern),
    // incl. the P7 commit rule with the 480s stalemate breaker
    function mirrorThink(api, st, s){
      const {byName,BUILDABLE,GATH,pdps,effHP}=api, ME=api.ME;
      const ents=api.ents, hqMe=api.hqMe, hqCpu=api.hqCpu;
      const gath=ents.filter(e=>e.owner==='me'&&pdps(e.u)<=0&&e.cls!=='HQ').length;
      const oreG=GATH[ME].ore;
      const oreComing=api.oreUnlocked.me||hqMe.queue.some(q=>q.name===oreG)||ents.some(e=>e.owner==='me'&&e.name===oreG);
      if(gath<3){ api.queueBuild('me',hqMe,GATH[ME].wood); }
      else if(!oreComing){ api.queueBuild('me',hqMe,oreG); }
      else { const foe=ents.filter(e=>e.owner==='cpu'&&pdps(e.u)>0);
        const enemy=foe.length?foe:[{u:byName[api.tier1(api.CPU)]}];
        let best=null,bs=-1;
        for(const c of BUILDABLE[ME].map(n=>byName[n]).filter(u=>pdps(u)>0&&u.mobile!==false)){
          if(c.tier>=2&&!api.oreUnlocked.me) continue;
          let sc=0; for(const e of enemy){ const en=e.u||e;
            const kill=pdps(c)*kiteF(c,en)/Math.max(1,effHP(en,c.dmgType,c));
            const die =pdps(en)*((en.aoe||1)>1?1.4:1)*kiteF(en,c)/Math.max(1,effHP(c,en.dmgType,en));
            sc+=kill/Math.max(0.02,die); }
          sc/=Math.max(1,c.cost/400); if(sc>bs){bs=sc;best=c;} }
        if(best) api.queueBuild('me',hqMe,best.name); }
      const army=ents.filter(e=>e.owner==='me'&&pdps(e.u)>0&&e.cls!=='HQ');
      const val=army.reduce((a,e)=>a+e.u.cost,0);
      const foeVal=ents.filter(e=>e.owner==='cpu'&&pdps(e.u)>0&&e.cls!=='HQ').reduce((a,e)=>a+e.u.cost,0);
      const gate=s<240?Infinity:s>480?1200:Math.max(1200,1.1*foeVal);   // P7 + 480s breaker
      if(val>gate) st.attack=true; if(army.length<3) st.attack=false;
      if(st.attack) for(const e of army) if(e.order==='idle'||!e.tgt){ e.order='attack'; e.tx=hqCpu.x; e.ty=hqCpu.y; e.tgt=null; }
    }
    const MATCHES=[ ['Twin Ridge','Directorate','Covenant',101], ['Twin Ridge','Array','Directorate',102],
      ['Open Steppe','Covenant','Array',103], ['Open Steppe','Directorate','Array',104],
      ['Scrapline','Covenant','Directorate',105], ['Scrapline','Array','Covenant',106] ];
    const rows=[]; let ok=true;
    for(const [map,A,B,seed] of MATCHES){
      let r;
      try{
        seedRandom(seed);
        const api=freshEngine();
        api.setMap(map); api.setFac(A,B); api.setDiff('hard'); api.start();
        const st={attack:false}; r={winner:null,secs:900};
        for(let k=0;k<CAP_TICKS;k++){ api.tick();
          if(k%150===0) mirrorThink(api,st,k/30);
          if(api.over){ r={winner:api.over==='me'?A:B, side:api.over, secs:k/30}; break; } }
      }catch(e){ r={winner:null,secs:0,err:String(e&&e.message||e)}; }
      if(!r.winner) ok=false;
      rows.push(`${map} ${A} v ${B}: ${r.err?'EXCEPTION '+r.err : r.winner?`${r.winner} (${r.side}) in ${(r.secs/60).toFixed(1)}min`:'DRAW @15min'}`);
    }
    return {pass:ok, detail:rows.join(' · ')};
  },
};

// =============================================================================
// runner
// =============================================================================
const only=process.argv[2];
if(only && !SCENARIOS[only]){
  console.error(`unknown scenario '${only}' — available: ${Object.keys(SCENARIOS).join(', ')}`);
  process.exit(1);
}
const names=only?[only]:Object.keys(SCENARIOS);
const line='─'.repeat(100);
console.log(line);
console.log('PLAYTEST GATE — '+HTML_PATH);
console.log(line);
let fails=0;
for(const n of names){
  let r;
  const t0=Date.now();
  try{ r=SCENARIOS[n](); }
  catch(e){ r={pass:false, detail:'scenario threw: '+(e&&e.stack?e.stack.split('\n').slice(0,2).join(' | '):e)}; }
  if(!r.pass) fails++;
  console.log(`[${r.pass?'PASS':'FAIL'}] ${n.padEnd(15)} (${((Date.now()-t0)/1000).toFixed(1)}s)`);
  console.log(`       ${r.detail}`);
}
console.log(line);
console.log(`${names.length-fails}/${names.length} scenarios pass`);
process.exit(fails?1:0);
