// Cost-efficiency auditor (§8). Measures a unit's efficiency SCORE
// (enemy value destroyed / own value lost) as a mono-spam against a *competent*
// best-response opponent — the fair test, not the naive even-split — and grades
// it against the balance-targets.json bands (problematic ≥ 1.6). This is the §8
// cost pass the composition sim's best-response flags call for: it separates
// "strong when massed vs a bad mix" (fine) from "genuinely under-priced" (fix).
//
// Reuses composition.mjs's battle() — the ONE combat model (kiting, first-
// strike, and the utility mechanics) — so there is no second copy to drift.
//   node rts/scripts/cost-efficiency.mjs
import fs from 'fs';
import { battle, army } from './composition.mjs';

const BANDS = JSON.parse(fs.readFileSync('rts/data/balance-targets.json','utf8')).unitEfficiencyScore;
const grade = s => s>=BANDS.problematic.min ? '⚠ PROBLEMATIC' : s>=BANDS.strong.min ? 'strong' : s>=BANDS.normal.min ? 'normal' : s<=BANDS.weak.max ? 'weak' : 'normal-';

// The units the composition best-response test flags, each with a competent
// response. `mech:true` where the response is Covenant utility anti-armor
// (hijack/mines/ambush) — otherwise those counters would score at zero and
// unfairly inflate the spam's efficiency.
const CASES = [
  { unit:'Nullifier',           response:['Prism Artillery','Nullifier','Arc Walker'], mech:false },
  { unit:'Marauder Scrap Tank', response:['Ambush Tank','Hijacker','Mine Layer','Rocket Technical'], mech:true },
  { unit:'Vanguard MBT',        response:['Missile Trooper','Lancer Tank Destroyer','Howitzer','Warden AA Halftrack'], mech:false },
  { unit:'Aegis Tank',          response:['Missile Trooper','Lancer Tank Destroyer','Howitzer'], mech:false },
];

console.log('\nCost-efficiency audit (§8) — mono-spam vs a competent best-response, equal 4000 cr');
console.log('efficiency = enemy value destroyed / own value lost.  bands: weak ≤0.7 · normal 0.8-1.2 · strong ≥1.3 · ⚠ problematic ≥1.6\n');
let flagged=0;
for (const c of CASES){
  // side A = the mono-spam under test; efficiency = what A destroyed / what A lost
  const r = battle(army(4000,[c.unit]), army(4000,c.response), c.mech);
  const destroyed = r.vB0 - r.vB, lost = r.vA0 - r.vA;
  const eff = lost>1 ? destroyed/lost : Infinity;
  if (eff>=BANDS.problematic.min) flagged++;
  const g = grade(eff), effStr = eff===Infinity ? '∞' : eff.toFixed(2);
  console.log(`  ${g.padEnd(14)} ${c.unit.padEnd(22)} spam — efficiency ${effStr}  (${r.win==='A'?'wins':'loses'} vs ${c.response.join('+')}${c.mech?' +mech':''})`);
}
console.log(`\n${flagged===0
  ? '✓ No mono-spam is problematically cost-efficient (§8) against a competent response.'
  : `⚠ ${flagged} unit(s) score ≥1.6 against a competent response — genuine §8 cost candidates (nudge cost/HP).`}`);
process.exit(0);
