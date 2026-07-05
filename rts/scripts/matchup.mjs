// Equal-cost duel simulator v2 — stress-tests counters against the §8 table.
// Models: per-damage-type resistance, shield-break, splash/AoE, range &
// first-strike, kiting (out-ranged units return less fire; immobile worse),
// and retreat (a side flees at 30% force instead of being annihilated, §27).
// Usage:
//   node rts/scripts/matchup.mjs "Missile Trooper" "Vanguard MBT" [budget]
//   node rts/scripts/matchup.mjs --report
import fs from 'fs';

const units = {};
for (const f of ['directorate','covenant','array']) {
  const r = JSON.parse(fs.readFileSync(`rts/data/units/${f}.json`,'utf8'));
  for (const u of r.units) units[u.name] = { ...u, faction: r.faction };
}
const U = n => units[n] || (()=>{throw new Error('unknown unit: '+n)})();

const pdps = u => u.reload>0 ? (u.dmg*u.proj/u.reload)*(u.acc/100) : 0;
const effHP = (def, atkType, atk) => {
  if (atk && atk.ignoreResist) return def.hp;            // shield-break bypasses resist (§15-B)
  const r = (def.resist?.[atkType] ?? 0)/100;
  return r < 1 ? def.hp/(1-r) : Infinity;
};
// out-ranged side returns less fire; immobile (structures) can't reposition → worse
function kiteFactor(myRange, foeRange, mobile){
  const gap = foeRange - myRange;                        // >0 means I'm out-ranged
  if (gap <= 0) return 1;
  // mobile units can partly close the gap; immobile (structures) get kited hard
  return mobile ? Math.max(0.5, 1 - 0.10*gap) : Math.max(0.05, 1 - 0.30*gap);
}

const DT = 0.05, MAX_T = 180;                            // §8 strength is judged to-death;
const RETREAT = 0.30;                                    // retreat is reported separately, not scored

function fight(aName, bName, budget=3000){
  const A=U(aName), B=U(bName);
  const nA0=Math.max(1,Math.floor(budget/A.cost)), nB0=Math.max(1,Math.floor(budget/B.cost));
  const ehpA=effHP(A, B.dmgType, B), ehpB=effHP(B, A.dmgType, A);
  const canA=pdps(A)>0, canB=pdps(B)>0;
  if (!canA && !canB) return {draw:true, note:'neither can attack'};

  let poolA=nA0*ehpA, poolB=nB0*ehpB;
  const kA=kiteFactor(A.range,B.range,A.mobile), kB=kiteFactor(B.range,A.range,B.mobile);
  // pooled damage/sec that side X deals right now (splash scales with living targets)
  const dmgA = ()=>{const nA=poolA/ehpA, nB=poolB/ehpB; return canA? nA*pdps(A)*Math.min(A.aoe||1, Math.max(1,Math.ceil(nB)))*kA : 0;};
  const dmgB = ()=>{const nA=poolA/ehpA, nB=poolB/ehpB; return canB? nB*pdps(B)*Math.min(B.aoe||1, Math.max(1,Math.ceil(nA)))*kB : 0;};

  // first-strike: longer-range side fires alone for a window
  const fs = Math.min(8, Math.abs(A.range-B.range)*1.0);
  if (fs>0 && A.range!==B.range){
    const longerA = A.range>B.range;
    for (let t=0;t<fs && poolA>0 && poolB>0;t+=DT){
      if (longerA) poolB=Math.max(0,poolB-dmgA()*DT); else poolA=Math.max(0,poolA-dmgB()*DT);
    }
  }

  // fight to death for §8 strength; note when the loser first hit the retreat line
  let winner=null, loserRetreatEHP=null;
  for (let t=0;t<MAX_T;t+=DT){
    const nA=poolA/ehpA, nB=poolB/ehpB;
    if (loserRetreatEHP===null){
      if (nB<=nB0*RETREAT && (dmgB()>=dmgA())===false) loserRetreatEHP={side:bName};
      else if (nA<=nA0*RETREAT && (dmgA()>=dmgB())===false) loserRetreatEHP={side:aName};
    }
    if (nB<=nB0*0.02){ winner=aName; break; }
    if (nA<=nA0*0.02){ winner=bName; break; }
    const dA=dmgA()*DT, dB=dmgB()*DT;
    poolA=Math.max(0,poolA-dB); poolB=Math.max(0,poolB-dA);
  }
  if (!winner) winner = poolA>=poolB ? aName : bName;
  const winPool = winner===aName?poolA:poolB, winInit = winner===aName?nA0*ehpA:nB0*ehpB;
  // A fully-resistant winner (effHP=Infinity) leaves winPool/winInit = Inf/Inf = NaN;
  // it took no losses, so that's 100% remaining. Guard so we never print NaN%/>100%.
  let frac = winInit>0 ? winPool/winInit : 1;
  if (!isFinite(frac)) frac = 1;
  const retreated = !!loserRetreatEHP && loserRetreatEHP.side===(winner===aName?bName:aName);
  return { A:aName,B:bName,budget,nA:nA0,nB:nB0,winner,loser:winner===aName?bName:aName,
           remainPct:Math.max(0,Math.min(1,frac))*100, retreated,
           dmgTypeA:A.dmgType,dmgTypeB:B.dmgType,
           resistOfBvsA:(B.resist?.[A.dmgType]??0), resistOfAvsB:(A.resist?.[B.dmgType]??0),
           rangeA:A.range,rangeB:B.range,aoeA:A.aoe,aoeB:B.aoe };
}

function band(p){ return p>45?'dominant (>45%)':p>=25?'strong counter (25–45%)':p>=10?'moderate advantage (10–25%)':'close / neutral (<10%)'; }
const bandKey = r => r.remainPct>45?'dominant':r.remainPct>=25?'strongCounter':r.remainPct>=10?'moderateAdvantage':'neutral';

function printFight(r){
  if (r.draw){ console.log('  draw —', r.note); return; }
  console.log(`  ${r.A} (${r.nA}, rng ${r.rangeA}/aoe ${r.aoeA}) vs ${r.B} (${r.nB}, rng ${r.rangeB}/aoe ${r.aoeB})  @${r.budget}cr`);
  console.log(`    ${r.A} deals ${r.dmgTypeA} → ${r.B} resist ${r.resistOfBvsA}%   |   ${r.B} deals ${r.dmgTypeB} → ${r.A} resist ${r.resistOfAvsB}%`);
  console.log(`    → ${r.winner} WINS with ${r.remainPct.toFixed(0)}% left  [${band(r.remainPct)}]${r.retreated?'  (loser retreated, not annihilated)':''}`);
}

const CURATED = [
  ['Missile Trooper','Vanguard MBT','strongCounter'],
  ['Nullifier','Aegis Tank','strongCounter'],
  ['Disruptor','Aegis Tank','strongCounter'],
  ['Vanguard MBT','Vanguard MBT','neutral'],
  ['Vanguard MBT','Marauder Scrap Tank','strongCounter'],
  ['Marauder Scrap Tank','Vanguard MBT','loses'],
  ['Lancer Tank Destroyer','Bastion Land Battleship','loses'],
  ['Lancer Tank Destroyer','Vanguard MBT','strongCounter'],
  ['Rifleman Squad','Vanguard MBT','loses'],
  ['Warden AA Halftrack','Falcon Gunship','strongCounter'],
  ['Missile Trooper','Falcon Gunship','strongCounter'],
  ['Howitzer','Sentry Turret','strongCounter'],
];

if (process.argv[2]==='--report'){
  console.log('\nMatchup report v2 (equal 3000 cr, §8 expectations)\n');
  let flags=0;
  // A hard FLAG (⚠) = wrong DIRECTION (the counter relationship is broken).
  // A soft note (~) = right winner but off the ideal band — fine-tuning, not a bug,
  // since a first-order pooled sim can't nail exact remaining%.
  for (const [a,b,exp] of CURATED){
    const r=fight(a,b); const wonByA=r.winner===a; let mark='✓', why='';
    const retreatNote = r.retreated?', loser retreated (§27)':'';
    if (exp==='loses'){
      if (wonByA){ mark='⚠'; flags++; why=`DIRECTION WRONG — expected ${a} to lose, but it won (${r.remainPct.toFixed(0)}%)`; }
      else why=`${a} loses as intended (${r.winner} keeps ${r.remainPct.toFixed(0)}%${retreatNote})`;
    } else if (!wonByA){
      mark='⚠'; flags++; why=`DIRECTION WRONG — expected ${a} to win (${exp}), but ${r.winner} won`;
    } else {
      const got=bandKey(r);
      if (got===exp) why=`${got} (${r.remainPct.toFixed(0)}%)${retreatNote} — as expected`;
      else { mark='~'; why=`counter works; strength ${got} (${r.remainPct.toFixed(0)}%) vs ideal ${exp} — tune later`; }
    }
    console.log(`  [${mark}] ${a}  vs  ${b}\n        ${why}`);
  }
  console.log(`\n${flags} broken counter(s) (wrong direction). '~' = works, band not yet tuned.`);
  process.exit(flags?1:0);
}

const [,, a, b, budget] = process.argv;
if (!a || !b){ console.log('usage: matchup.mjs "Unit A" "Unit B" [budget]   |   matchup.mjs --report'); process.exit(1); }
console.log(); printFight(fight(a, b, budget?+budget:3000));
