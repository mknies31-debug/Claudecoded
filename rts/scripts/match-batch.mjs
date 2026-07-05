// Match-batch telemetry (design/21 P0c — the §50 "measured gates" step).
// Runs headless CPU-vs-CPU matches of the actual game engine across every
// ordered faction pair, with BOTH sides driven by the same policy (the engine's
// cpuThink drives the 'cpu' side; this harness mirrors the identical 'hard'
// policy for the 'me' side). Outputs per-pair results, per-faction win rates,
// spawn/side bias, and match-length stats, compared against the
// balance-targets.json bands. Pre-alpha numbers, NOT ranked telemetry (§45) —
// this instruments the v1 skirmish, it does not check §50 boxes.
//   node rts/scripts/match-batch.mjs [matchesPerPair=4]
import fs from 'fs';

const N = Math.max(1, parseInt(process.argv[2] || '4', 10));
const FACTIONS = ['Directorate','Covenant','Array'];
const CAP_S = 900, DT = 1/30, CAP_TICKS = Math.round(CAP_S/DT);   // 15-min cap; mirrored competent play stalemates past 8
const bands = JSON.parse(fs.readFileSync('rts/data/balance-targets.json','utf8'));

const html = fs.readFileSync('rts/game/index.html','utf8');
const script = html.match(/<script>([\s\S]*)<\/script>/)[1] + `
;globalThis.__api={ get ents(){return ents}, get over(){return over}, get credits(){return credits},
  get oreUnlocked(){return oreUnlocked}, get hqMe(){return hqMe}, get hqCpu(){return hqCpu},
  get ME(){return ME}, get CPU(){return CPU}, byName, BUILDABLE, GATH, tier1, queueBuild, pdps, effHP, tick,
  setFac:(p,c)=>{ME=p;CPU=c;newGame();}, start:()=>{started=true;}, setDiff:d=>{DIFF=d} };`;

// deterministic RNG so batches are reproducible
function seedRandom(seed){ Math.random = () => { seed|=0; seed = seed + 0x6D2B79F5 | 0;
  let t = Math.imul(seed ^ seed>>>15, 1|seed); t = t + Math.imul(t ^ t>>>7, 61|t) ^ t;
  return ((t ^ t>>>14)>>>0)/4294967296; }; }

// minimal DOM/canvas shim — no rendering happens (we drive tick() directly)
function freshEngine(){
  const noop=()=>{}; const grad={addColorStop:noop};
  const cx=new Proxy({},{get:(_,p)=> p==='createLinearGradient'||p==='createRadialGradient' ? ()=>grad
    : p==='canvas' ? {width:900,height:600} : noop});
  const mk=()=>({style:{},value:'',width:900,height:600,clientWidth:900,clientHeight:600,
    set textContent(v){},set innerHTML(v){},get innerHTML(){return '';},set onclick(f){},set onchange(f){},
    getContext:()=>cx,addEventListener:noop,appendChild:noop,
    getBoundingClientRect:()=>({width:900,height:600,left:0,top:0}),
    parentElement:{getBoundingClientRect:()=>({width:900,height:600})}});
  globalThis.document={getElementById:()=>mk(),createElement:()=>mk()};
  globalThis.window=globalThis; globalThis.addEventListener=noop;
  globalThis.requestAnimationFrame=noop; globalThis.performance={now:()=>0}; globalThis.location={reload:noop};
  new Function(script)();
  return globalThis.__api;
}

// mirror of the engine's cpuThink at 'hard' (gather 3 → ore → best-counter,
// commit at 2600 army value) driving the 'me' side — SAME policy both sides.
function mirrorThink(api, st){
  const {byName,BUILDABLE,GATH,pdps,effHP} = api, ME=api.ME;
  const ents=api.ents, hqMe=api.hqMe, hqCpu=api.hqCpu;
  const gath = ents.filter(e=>e.owner==='me'&&pdps(e.u)<=0&&e.cls!=='HQ').length;
  const oreG = GATH[ME].ore;
  const oreComing = api.oreUnlocked.me || hqMe.queue.some(q=>q.name===oreG) || ents.some(e=>e.owner==='me'&&e.name===oreG);
  if(gath<3){ api.queueBuild('me',hqMe,GATH[ME].wood); }
  else if(!oreComing){ api.queueBuild('me',hqMe,oreG); }
  else {
    const foe = ents.filter(e=>e.owner==='cpu'&&pdps(e.u)>0);
    const enemy = foe.length?foe:[{u:byName[api.tier1(api.CPU)]}];
    let best=null,bs=-1;
    for(const c of BUILDABLE[ME].map(n=>byName[n]).filter(u=>pdps(u)>0&&u.mobile!==false)){
      if(c.tier>=2&&!api.oreUnlocked.me) continue;
      let s=0; for(const en of enemy){ const eff=effHP(en.u,c.dmgType,c); s+=pdps(c)/(isFinite(eff)?eff:1e9); }
      s/=Math.max(1,c.cost/400); if(s>bs){bs=s;best=c;}
    }
    if(best) api.queueBuild('me',hqMe,best.name);
  }
  const army = ents.filter(e=>e.owner==='me'&&pdps(e.u)>0&&e.cls!=='HQ');
  const val = army.reduce((a,e)=>a+e.u.cost,0);
  if(val>2600) st.attack=true; if(army.length<3) st.attack=false;
  if(st.attack) for(const e of army){ if(e.order==='idle'||!e.tgt){ e.order='attack'; e.tx=hqCpu.x; e.ty=hqCpu.y; e.tgt=null; } }
}

function playMatch(facMe, facCpu, seed){
  seedRandom(seed);
  const api = freshEngine();
  api.setFac(facMe, facCpu); api.setDiff('hard'); api.start();
  const st={attack:false};
  for(let k=0;k<CAP_TICKS;k++){
    api.tick();
    if(k%150===0) mirrorThink(api, st);          // same 5s cadence as DIFFS.hard.think
    if(api.over) return { winner: api.over==='me'?facMe:facCpu, side: api.over, secs: k*DT };
  }
  return { winner: null, side: null, secs: CAP_S };   // timeout → draw
}

console.log(`\nMatch batch — ${FACTIONS.length*FACTIONS.length} ordered pairs × ${N} = ${FACTIONS.length*FACTIONS.length*N} headless matches, both sides 'hard', seeded\n`);
const wins={}, games={}, lengths=[], sideWins={me:0,cpu:0}; let draws=0, mirrorP1=0, mirrorGames=0;
for (const f of FACTIONS){ wins[f]=0; games[f]=0; }
let m=0;
for (const A of FACTIONS) for (const B of FACTIONS){
  let aw=0,bw=0,dr=0, tsum=0;
  for (let i=0;i<N;i++){
    const r = playMatch(A,B, 1000 + m*97 + i);
    tsum += r.secs;
    if(!r.winner){ dr++; draws++; }
    else { lengths.push(r.secs); sideWins[r.side]++;
      if(r.winner===A&&r.side==='me') aw++; else bw++;
      if(A!==B){ games[A]++; games[B]++; wins[r.winner]++; }
      else { mirrorGames++; if(r.side==='me') mirrorP1++; } }
  }
  console.log(`  ${(A+' vs '+B).padEnd(26)} ${aw}-${bw}${dr?` (${dr} draw)`:''}  avg ${(tsum/N/60).toFixed(1)} min`);
  m++;
}

const pct=(a,b)=> b?Math.round(100*a/b):0;
const avg = lengths.length ? lengths.reduce((a,b)=>a+b,0)/lengths.length : 0;
console.log('\n— Faction win rates (cross-faction, decisive games) vs 48–52% band —');
for (const f of FACTIONS){ const p=pct(wins[f],games[f]);
  console.log(`  ${f.padEnd(12)} ${p}%  (${wins[f]}/${games[f]})  ${p>=48&&p<=52?'✓ in band':'◻ outside band (pre-alpha, low N)'}`); }
console.log('\n— Side/spawn bias —');
console.log(`  p1-side wins ${pct(sideWins.me, sideWins.me+sideWins.cpu)}% of decisive games (target 49–51%)`
  + (mirrorGames?`; mirror-matchup p1 rate ${pct(mirrorP1,mirrorGames)}% (${mirrorP1}/${mirrorGames})`:''));
console.log('\n— Match length —');
console.log(`  avg ${(avg/60).toFixed(1)} min · min ${(Math.min(...lengths)/60).toFixed(1)} · max ${(Math.max(...lengths)/60).toFixed(1)} · draws ${draws}`);
console.log(`  (target band ${bands.launchTargets?.matchLengthMin?JSON.stringify(bands.launchTargets.matchLengthMin):'18–25 min'} is for the FULL game with base-building; the v1 skirmish is expected shorter — reported, not gated.)`);
console.log('\nPre-alpha instrumentation of the v1 engine — real §50 telemetry (§45) still requires the shipped game. Reproducible: seeds are fixed.');
process.exit(0);
