// Equal-cost duel simulator — stress-tests counters against the §8 table.
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
const effHP = (def, atkType) => {
  const r = (def.resist?.[atkType] ?? 0)/100;
  return r < 1 ? def.hp/(1-r) : Infinity;
};

// simultaneous-fire attrition at equal budget
function fight(aName, bName, budget=3000){
  const A=U(aName), B=U(bName);
  const nA=Math.max(1,Math.floor(budget/A.cost)), nB=Math.max(1,Math.floor(budget/B.cost));
  const dA=nA*pdps(A), dB=nB*pdps(B);
  const hA=nA*effHP(A, B.dmgType), hB=nB*effHP(B, A.dmgType);
  if (dA<=0 && dB<=0) return {draw:true, note:'neither can attack'};
  const tA = dA>0 ? hB/dA : Infinity;   // time for A to kill all B
  const tB = dB>0 ? hA/dB : Infinity;   // time for B to kill all A
  let winner, loser, tWin, winnerH, loserD;
  if (tA <= tB){ winner=aName; loser=bName; tWin=tA; winnerH=hA; loserD=dB; }
  else { winner=bName; loser=aName; tWin=tB; winnerH=hB; loserD=dA; }
  const remain = Math.max(0, 1 - (loserD*tWin)/winnerH);   // winner's EHP fraction left
  return { A:aName,B:bName,budget,nA,nB,winner,loser,remainPct:remain*100,
           dmgTypeA:A.dmgType, dmgTypeB:B.dmgType,
           resistOfBvsA:(B.resist?.[A.dmgType]??0), resistOfAvsB:(A.resist?.[B.dmgType]??0) };
}

// classify winner remaining% into a §8-style band
function band(remainPct){
  if (remainPct>45) return 'dominant (>45%)';
  if (remainPct>=25) return 'strong counter (25–45%)';
  if (remainPct>=10) return 'moderate advantage (10–25%)';
  return 'close / neutral (<10%)';
}

function printFight(r){
  if (r.draw){ console.log('  draw —', r.note); return; }
  console.log(`  ${r.A} (${r.nA}) vs ${r.B} (${r.nB})  @${r.budget}cr`);
  console.log(`    ${r.A} deals ${r.dmgTypeA} → ${r.B} resist ${r.resistOfBvsA}%   |   ${r.B} deals ${r.dmgTypeB} → ${r.A} resist ${r.resistOfAvsB}%`);
  console.log(`    → ${r.winner} WINS with ${r.remainPct.toFixed(0)}% left  [${band(r.remainPct)}]`);
}

// ---- curated report ----
const CURATED = [
  ['Missile Trooper','Vanguard MBT','strongCounter'],
  ['Lancer Tank Destroyer','Vanguard MBT','strongCounter'],
  ['Vanguard MBT','Vanguard MBT','neutral'],
  ['Vanguard MBT','Marauder Scrap Tank','moderateAdvantage'],
  ['Marauder Scrap Tank','Vanguard MBT','loses'],
  ['Warden AA Halftrack','Falcon Gunship','strongCounter'],
  ['Missile Trooper','Falcon Gunship','strongCounter'],
  ['Rifleman Squad','Vanguard MBT','loses'],
  ['Nullifier','Aegis Tank','strongCounter'],
  ['Disruptor','Aegis Tank','strongCounter'],
  ['Lancer Tank Destroyer','Bastion Land Battleship','loses'],
  ['Howitzer','Sentry Turret','strongCounter'],
];
const bandKey = r => r.remainPct>45?'dominant':r.remainPct>=25?'strongCounter':r.remainPct>=10?'moderateAdvantage':'neutral';

if (process.argv[2]==='--report'){
  console.log('\nMatchup report (equal 3000 cr, §8 expectations)\n');
  let flags=0;
  for (const [a,b,exp] of CURATED){
    const r=fight(a,b);
    const wonByA = r.winner===a;
    let verdict='ok', why='';
    if (exp==='loses'){
      if (wonByA){ verdict='FLAG'; why=`expected ${a} to lose, but it won (${r.remainPct.toFixed(0)}%)`; }
      else why=`${a} loses as intended (${r.winner} keeps ${r.remainPct.toFixed(0)}%)`;
    } else {
      if (!wonByA){ verdict='FLAG'; why=`expected ${a} to win (${exp}), but ${r.winner} won`; }
      else {
        const got=bandKey(r);
        if (got!==exp){ verdict='FLAG'; why=`expected ${exp}, got ${got} (${r.remainPct.toFixed(0)}%)`; }
        else why=`${got} (${r.remainPct.toFixed(0)}%) as expected`;
      }
    }
    if (verdict==='FLAG') flags++;
    console.log(`  [${verdict==='ok'?'✓':'⚠'}] ${a}  vs  ${b}`);
    console.log(`        ${why}`);
  }
  console.log(`\n${flags} matchup(s) flagged for review.`);
  process.exit(0);
}

// single duel
const [,, a, b, budget] = process.argv;
if (!a || !b){ console.log('usage: matchup.mjs "Unit A" "Unit B" [budget]   |   matchup.mjs --report'); process.exit(1); }
console.log();
printFight(fight(a, b, budget?+budget:3000));
