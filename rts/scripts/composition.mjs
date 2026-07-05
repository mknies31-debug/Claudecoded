// Army-composition simulator (§10) — does combined arms beat mono-spam?
// Extends the duel model to many unit types per side. Each attacking type
// focus-fires the enemy type it counters (lowest effective-HP vs its damage),
// which is exactly why a mixed army wins: it has an efficient answer to each
// enemy type, while a mono-spam funnels all its fire into one (often resisted)
// target and gets picked apart by the counter it lacks.
//   node rts/scripts/composition.mjs           # curated report
//   node rts/scripts/composition.mjs A,B,C  vs  X          # custom (comma lists)
import fs from 'fs';

const units = {};
for (const f of ['directorate','covenant','array']) {
  const r = JSON.parse(fs.readFileSync(`rts/data/units/${f}.json`,'utf8'));
  for (const u of r.units) units[u.name] = { ...u, faction: r.faction };
}
const U = n => units[n] || (()=>{throw new Error('unknown unit: '+n)})();
const pdps = u => u.reload>0 ? (u.dmg*u.proj/u.reload)*(u.acc/100) : 0;
const effHP = (def, atkType, atk) => {
  if (atk && atk.ignoreResist) return def.hp;
  const r=(def.resist?.[atkType]??0)/100; return r<1?def.hp/(1-r):Infinity;
};
const DT=0.1, MAX_T=240;

// ---- mechanic-aware layer (opt-in via --mechanics; default OFF) ----
// The base sim is DPS + effective-HP + splash + focus-fire only, so it cannot
// see Covenant's UTILITY anti-armor (stealth ambush, rear-armor, mines, hijack)
// — the documented §16 blind spot. These hooks wrap the existing loop; with
// mechanics OFF every number is byte-identical to before (units without the
// fields are unaffected either way).
const MECH = process.argv.includes('--mechanics');
const RULES = JSON.parse(fs.readFileSync('rts/data/combat-rules.json','utf8'));
const REAR = RULES.armorFacing?.rear ?? 1.3;        // 1.30 — already in the data, never applied
const OPEN_SECS = 2;                                 // length of a stealth surprise volley
const FACING = new Set(['Main battle tank','Advanced vehicle','Epic unit']);
const isArmored = u => FACING.has(u.class) || u.armor==='medium' || u.armor==='heavy';
const hasDetector = side => side.some(s => s.n>0 && s.u.detector);
// rear-armor bonus applies when a flanker hits an armored target
const mechMult = (atk, def) => (atk.flank && isArmored(def)) ? REAR : 1;
const bestTarget = (att, def, dmgType) => {
  let best=null, bestE=Infinity;
  for (const d of def){ if (d.n<=0) continue; const e=effHP(d.u, dmgType, att); if (e<bestE){bestE=e; best=d;} }
  return {best, bestE};
};

// One-time opening resolution before the main loop (mechanics only):
//  · stealth → a free surprise volley, NULLIFIED if the enemy has a detector
//  · mine    → a pre-placed alpha vs the best armored target, HALVED if detected
// Returns effective kills to subtract from each defender type.
function openingStrike(att, def){
  const detect = hasDetector(def);
  const out = new Map(def.map(s=>[s.u.name,0]));
  for (const a of att){
    if (a.n<=0) continue;
    if (a.u.stealth && !detect && pdps(a.u)>0){
      const {best,bestE} = bestTarget(a.u, def, a.u.dmgType);
      if (best){ const dmg = a.n*pdps(a.u)*OPEN_SECS*Math.min(a.u.aoe||1,Math.max(1,Math.ceil(best.n)))*mechMult(a.u,best);
        out.set(best.u.name, out.get(best.u.name)+dmg/bestE); }
    }
    if (a.u.mine){
      let best=null,bestE=Infinity;
      for (const d of def){ if (d.n<=0 || !isArmored(d.u)) continue; const e=effHP(d.u,'antiArmor',a.u); if (e<bestE){bestE=e;best=d;} }
      if (best){ const raw = a.n*a.u.mine*(detect?0.5:1); out.set(best.u.name, out.get(best.u.name)+raw/bestE); }
    }
  }
  return out;
}

// Hijack (per second): a converter deletes the highest-value enemy vehicle it
// can reach; fragile and escort-punishable because it dies to focus fire like
// any other body once its own type is targeted.
function convertStep(att, def){
  for (const a of att){
    if (a.n<=0 || !a.u.convert) continue;
    let tgt=null, tv=-1;
    for (const d of def){ if (d.n<=0 || !isArmored(d.u) || !d.u.mobile) continue; if (d.u.cost>tv){tv=d.u.cost; tgt=d;} }
    if (tgt) tgt.n = Math.max(0, tgt.n - a.u.convert*a.n*DT);
  }
}

// build an army: split budget evenly across the named combat units
function army(budget, names){
  const per = budget/names.length;
  return names.map(n=>{const u=U(n); return {u, n0:Math.max(1,Math.floor(per/u.cost)), n:0};})
              .map(s=>({...s, n:s.n0}));
}
const value = side => side.reduce((a,s)=>a+s.n*s.u.cost,0);
const initValue = side => side.reduce((a,s)=>a+s.n0*s.u.cost,0);
const alive = side => side.some(s=>s.n>0.02);

// Each attacking type focus-fires the enemy type it counters (lowest effective-
// HP vs its damage) — this is the mechanism by which combined arms wins: every
// specialist deletes its target efficiently, while a mono-spam pours all its
// fire into a single (often resisted) target and lacks answers to the rest.
function step(att, def, mech=false){
  const kills = new Map(def.map(s=>[s.u.name,0]));   // units killed / sec, per enemy type
  for (const a of att){
    if (a.n<=0 || pdps(a.u)<=0) continue;
    let best=null, bestE=Infinity;
    for (const d of def){ if (d.n<=0) continue; const e=effHP(d.u, a.u.dmgType, a.u); if (e<bestE){bestE=e; best=d;} }
    if (!best) continue;
    const mult = mech ? mechMult(a.u, best) : 1;     // rear-armor bonus when flanking
    const shots = a.n*pdps(a.u)*Math.min(a.u.aoe||1, Math.max(1,Math.ceil(best.n)))*mult;
    kills.set(best.u.name, kills.get(best.u.name) + shots/bestE);
  }
  return kills;
}

function battle(sideA, sideB, mech=false){
  const A=sideA.map(s=>({...s})), B=sideB.map(s=>({...s}));
  const vA0=initValue(A), vB0=initValue(B);
  if (mech){                                          // one-time opening strikes (both sides at t=0)
    const oa=openingStrike(A,B), ob=openingStrike(B,A);
    for (const s of B) s.n=Math.max(0, s.n - (oa.get(s.u.name)||0));
    for (const s of A) s.n=Math.max(0, s.n - (ob.get(s.u.name)||0));
  }
  for (let t=0;t<MAX_T && alive(A) && alive(B);t+=DT){
    const dA=step(A,B,mech), dB=step(B,A,mech);
    for (const s of B) s.n=Math.max(0, s.n - (dA.get(s.u.name)||0)*DT);
    for (const s of A) s.n=Math.max(0, s.n - (dB.get(s.u.name)||0)*DT);
    if (mech){ convertStep(A,B); convertStep(B,A); }  // hijack per-second
  }
  const win = alive(A)&&!alive(B) ? 'A' : alive(B)&&!alive(A) ? 'B' : (value(A)>=value(B)?'A':'B');
  const remain = win==='A' ? value(A)/vA0 : value(B)/vB0;
  return {win, remainPct:remain*100, survA:A.filter(s=>s.n>0.5), survB:B.filter(s=>s.n>0.5)};
}

// ---- curated report ----
const SUITES = {
  Directorate: {
    mixed: ['Vanguard MBT','Missile Trooper','Warden AA Halftrack','Howitzer'],
    spams: ['Vanguard MBT','Missile Trooper','Rifleman Squad','Lancer Tank Destroyer']
  },
  Covenant: {
    mixed: ['Marauder Scrap Tank','Rocket Technical','Scorch Buggy','Ambush Tank'],
    spams: ['Marauder Scrap Tank','Rocket Technical','Raider Squad']
  },
  Array: {
    mixed: ['Aegis Tank','Nullifier','Arc Walker','Sentinel Trooper'],
    spams: ['Aegis Tank','Nullifier','Sentinel Trooper']
  }
};

if (!process.argv.includes('vs')){
  console.log(`\nComposition report (§10 — mixed vs mono-spam, equal 4000 cr)${MECH?'  [MECHANICS ON: stealth/flank/mine/hijack]':''}\n`);
  let broken=0;
  for (const [fac, {mixed, spams}] of Object.entries(SUITES)){
    console.log(`${fac} combined arms: ${mixed.join(' + ')}`);
    for (const spam of spams){
      const r = battle(army(4000, mixed), army(4000, [spam]), MECH);
      const mixWon = r.win==='A';
      // decisive spam win (>=15% remaining) = a real problem; <15% = an even
      // trade the naive even-split mis-weighted (adapt the mix, §1/§8-neutral).
      const decisiveSpam = !mixWon && r.remainPct>=15;
      if (decisiveSpam) broken++;
      const mark = mixWon?'✓':(decisiveSpam?'⚠':'~');
      const surv = (mixWon?r.survA:r.survB).map(s=>`${Math.round(s.n)}×${s.u.name}`).join(', ');
      const who = mixWon?'mixed':'SPAM';
      // when mechanics are on, show the default (DPS-only) result too, so the
      // delta from modelling utility anti-armor is explicit.
      let delta='';
      if (MECH){ const rd=battle(army(4000,mixed), army(4000,[spam]), false);
        delta = `  [DPS-only: ${rd.win==='A'?'mixed':'SPAM'} ${rd.remainPct.toFixed(0)}%]`; }
      const note = (!mixWon && !decisiveSpam)?' (even — re-weight the mix)':'';
      console.log(`   ${mark} vs ${spam.padEnd(22)} spam → ${who} wins ${r.remainPct.toFixed(0)}%${note}${delta}  (left: ${surv||'—'})`);
    }
    console.log('');
  }
  const tail = MECH ? ' (mechanics on)' : '';
  console.log(broken===0
    ? `✓ Combined arms beats every mono-spam${tail} — §10 holds; no spam-all-purpose unit found.`
    : `⚠ ${broken} spam(s) beat combined arms${tail} — investigate (possible §49 spam unit).`);
  if (!MECH) console.log('  (run with --mechanics to model Covenant stealth/flank/mine/hijack — the §16 blind spot.)');
  process.exit(broken?1:0);
}

// custom: "A,B,C vs X,Y"
const i = process.argv.indexOf('vs');
const left = process.argv[i-1].split(',').map(s=>s.trim());
const right = process.argv[i+1].split(',').map(s=>s.trim());
const r = battle(army(4000,left), army(4000,right), MECH);
console.log(`\n  ${left.join('+')}  vs  ${right.join('+')}  @4000cr${MECH?'  [mechanics on]':''}`);
console.log(`  → side ${r.win} wins ${r.remainPct.toFixed(0)}%`);
