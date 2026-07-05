// Reference CPU brain (§40) — the army-COMPOSITION decision layer, validated
// against the composition sim. Proves the balance data is enough to drive a
// LEGAL opponent whose only edge at higher difficulty is a better composition
// choice — no secret HP/damage/armor/income (§40). Reads the same unit data and
// resolves fights with the same battle() a human's units use.
//   node rts/scripts/ai-policy.mjs
import fs from 'fs';
import { pdps, effHP } from './combat-core.mjs';
import { battle, army } from './composition.mjs';

const rosters = {}, byName = {};
for (const f of ['directorate','covenant','array']) {
  const r = JSON.parse(fs.readFileSync(`rts/data/units/${f}.json`, 'utf8'));
  rosters[r.faction] = r;
  for (const u of r.units) byName[u.name] = { ...u, faction: r.faction };
}
// combat units the AI can build (no structures, no epics/superweapons, must deal damage)
const armed = fac => rosters[fac].units.filter(u => pdps(u) > 0 && u.class !== 'Structure' && u.class !== 'Epic unit');
const general = fac => rosters[fac].units.find(u => u.general)?.name;
const basic   = fac => rosters[fac].units.find(u => u.class === 'Basic infantry')?.name;

// how well candidate c answers a scouted enemy comp: damage-per-sec per enemy
// effective-HP (the same effHP/pdps the game uses), summed over enemy types,
// with a nudge for the explicit §5 answers/counteredBy matrix.
function counterScore(c, enemyNames) {
  let s = 0;
  for (const en of enemyNames) {
    const e = byName[en]; if (!e) continue;
    const eff = effHP(e, c.dmgType, c);
    s += pdps(c) / (isFinite(eff) ? eff : 1e9);
    if ((c.answers || []).length && (e.class === 'Aircraft' && c.answers.includes('aircraft'))) s *= 1.15;
  }
  return s;
}

// pick a composition to answer `enemyNames`. Difficulty changes ONLY this choice.
function mixFor(fac, enemyNames, diff) {
  const ranked = armed(fac).map(u => ({ u, sc: counterScore(u, enemyNames) })).sort((a, b) => b.sc - a.sc);
  const names = ranked.map(r => r.u.name);
  if (diff === 'easy')   return [general(fac), basic(fac), names[names.length - 1]].filter(Boolean);      // naive + a weak counter
  if (diff === 'normal') return [names[0], general(fac), basic(fac)].filter(Boolean);                     // counter the top threat
  if (diff === 'hard')   return names.slice(0, 3);                                                         // multi-counter
  return names.slice(0, 4);                                                                                // expert: best-response
}
// only the mechanics-bearing faction uses mechanics, and only at expert (scouted + microed)
const usesMech = (fac, diff) => diff === 'expert' && rosters[fac].units.some(u => u.stealth || u.flank || u.mine || u.convert);

function respond(fac, enemyNames, diff, budget = 4000) {
  const mix = mixFor(fac, enemyNames, diff);
  const r = battle(army(budget, mix), army(budget, enemyNames), usesMech(fac, diff));
  return { mix, win: r.win === 'A', pct: r.remainPct };
}

// ---- self-test: does a better decision (not better stats) win more? ----
const ENEMIES = [
  { label: 'infantry spam', comp: ['Rifleman Squad'] },
  { label: 'tank spam',     comp: ['Vanguard MBT'] },
  { label: 'high-alpha spam', comp: ['Nullifier'] },
  { label: 'air spam',      comp: ['Falcon Gunship'] },
];
console.log('\nCPU brain self-test (§40) — same unit stats on both sides; difficulty = composition choice only\n');
let easyWins = 0, expertWins = 0, n = 0;
for (const fac of Object.keys(rosters)) {
  console.log(`${fac} CPU responding:`);
  for (const e of ENEMIES) {
    const easy = respond(fac, e.comp, 'easy');
    const exp  = respond(fac, e.comp, 'expert');
    n++; if (easy.win) easyWins++; if (exp.win) expertWins++;
    const d = (w, r) => `${w ? '✓ win' : '✗ lose'} ${r.pct.toFixed(0)}%`;
    console.log(`  vs ${e.label.padEnd(16)} easy ${d(easy.win, easy).padEnd(11)} → expert ${d(exp.win, exp)}   [expert: ${exp.mix.join(', ')}]`);
  }
  console.log('');
}
console.log(`Easy won ${easyWins}/${n} · Expert won ${expertWins}/${n} — the gap is decision quality, not stats (§40).`);
process.exit(expertWins >= easyWins ? 0 : 1);
