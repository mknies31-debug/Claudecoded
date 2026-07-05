// Economy verification (§11). Turns the two-resource model from "provable on
// paper" into script-backed data: reads data/resources.json + data/economy.json
// (+ timings.json and the faction rosters) and asserts the invariants that make
// the wood-floor / ore-ceiling economy real and internally consistent.
//   node rts/scripts/economy-check.mjs      # exits 0 if every assertion holds, 1 otherwise
import fs from 'fs';

const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const resources = read('rts/data/resources.json');
const economy   = read('rts/data/economy.json');
const timings   = read('rts/data/timings.json');
const FACTIONS  = ['directorate', 'covenant', 'array'];
const rosters   = Object.fromEntries(FACTIONS.map(f => [f, read(`rts/data/units/${f}.json`)]));

let pass = 0, fail = 0;
const log = [];
const ok  = (label, detail = '') => { log.push(['✓', label, detail]); pass++; };
const bad = (label, detail = '') => { log.push(['✗', label, detail]); fail++; };
const assert = (cond, label, detail = '') => (cond ? ok : bad)(label, detail);
const eqArr = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i]);

// ---------------------------------------------------------------------------
console.log('\n' + '='.repeat(64));
console.log('  ECONOMY VERIFICATION (§11 — two-resource model)');
console.log('='.repeat(64));

// § 1 — Harvester payback band. cost / cr-s must sit inside economy.json's band.
const band = economy.payback.harvesterSec;
console.log(`\n[1] Harvester payback inside §11 band ${band[0]}-${band[1]} s\n`);
for (const key of ['wood', 'ore']) {
  const r = resources[key];
  const cost = r.gatherer.cost, crs = r.effectiveCreditsPerSec;
  const payback = cost / crs;
  const p = payback.toFixed(1);
  assert(payback >= band[0] && payback <= band[1],
    `${key} gatherer payback in band`,
    `${r.gatherer.name}: ${cost} cr / ${crs} cr·s⁻¹ = ${p} s`);
  // stored paybackSec must agree with the computed value (catch stale hand-entered numbers)
  assert(Math.abs(r.paybackSec - payback) <= 1,
    `${key} stored paybackSec matches computed`,
    `stored ${r.paybackSec} s vs computed ${p} s`);
}

// § 2 — Resource role / renewable / finite invariants.
console.log(`\n[2] Resource role invariants (wood = renewable floor, ore = finite contested ceiling)\n`);
const w = resources.wood, o = resources.ore;
assert(w.node.renewable === true,  'wood is renewable',            `renewable=${w.node.renewable}`);
assert(/near.?base/i.test(w.node.location), 'wood node is near-base', w.node.location);
assert(/floor/i.test(w.role),      'wood framed as economic floor');
assert(o.node.renewable === false, 'ore is finite (non-renewable)', `renewable=${o.node.renewable}`);
assert(/finite/i.test(o.node.totalCapacity), 'ore node is finite',  o.node.totalCapacity);
assert(/contested|expansion|central/i.test(o.node.location), 'ore node is contested/expansion', o.node.location);
assert(/ceiling/i.test(o.role),    'ore framed as economic ceiling');
// tempo/value ordering: ore is the pricier, richer, slower resource.
assert(o.gatherer.cost > w.gatherer.cost, 'ore gatherer pricier than wood', `${o.gatherer.cost} > ${w.gatherer.cost}`);
assert(o.effectiveCreditsPerSec > w.effectiveCreditsPerSec, 'ore cr·s⁻¹ higher than wood', `${o.effectiveCreditsPerSec} > ${w.effectiveCreditsPerSec}`);
assert(o.valuePerLoad > w.valuePerLoad, 'ore value/load higher than wood', `${o.valuePerLoad} > ${w.valuePerLoad}`);

// § 3 — Ore soft-tech-gate: tier-1 ore-free, tier-2/3 ore-gated, windows match timings.json.
console.log(`\n[3] Ore soft-tech-gate consistent (tier-1 ore-free · tier-2/3 ore-gated)\n`);
const g = resources.oreTechGate;
assert(!!g, 'oreTechGate block present');
if (g) {
  assert(g.tiers.tier1.requiresOre === false, 'tier-1 needs no ore (wood floor)', 'requiresOre=false');
  assert(g.tiers.tier2.requiresOre === true,  'tier-2 requires ore');
  assert(g.tiers.tier3.requiresOre === true,  'tier-3 requires ore');
  // gate windows must mirror timings.json (gating must not silently move the tech clock)
  assert(eqArr(g.tiers.tier2.techWindowMin, [timings.techWindows.tier2.minMin, timings.techWindows.tier2.maxMin]),
    'tier-2 window matches timings.json', JSON.stringify(g.tiers.tier2.techWindowMin));
  assert(eqArr(g.tiers.tier3.techWindowMin, [timings.techWindows.tier3.minMin, timings.techWindows.tier3.maxMin]),
    'tier-3 window matches timings.json', JSON.stringify(g.tiers.tier3.techWindowMin));
  // the floor must stay a floor: economy + tier-1 explicitly ore-exempt.
  const exempt = (g.gatedItems.exempt || []).join(' ').toLowerCase();
  assert(/econom|gatherer/.test(exempt) && /tier-1/.test(exempt),
    'economy + tier-1 explicitly ore-exempt', g.gatedItems.exempt.join(', '));
  const gated = (g.gatedItems.requiresOre || []).join(' ').toLowerCase();
  assert(/tier-2/.test(gated) && /tier-3/.test(gated),
    'tier-2 & tier-3 structures ore-gated', g.gatedItems.requiresOre.join(', '));
}

// § 4 — Rosters make the economy real: every faction fields a wood + an ore gatherer
//        at the canonical cost/cr-s, unarmed, tagged as economy support.
console.log(`\n[4] Rosters field both gatherers at canonical economics\n`);
const SUPPORT = /repair|econom|harvest|capture|superweapon|detect|recon|theft|hijack|mine|denial|demolition|utility|salvage|control|immobil|snare|infrastructure|sensor/i;
const canon = resources.rosterGatherers;
for (const f of FACTIONS) {
  const roster = rosters[f];
  const name = roster.faction;
  for (const res of ['wood', 'ore']) {
    const found = roster.units.filter(u => u.resource === res);
    if (found.length !== 1) {
      bad(`${name}: exactly one ${res} gatherer`, `found ${found.length}`);
      continue;
    }
    const u = found[0];
    const cCost = canon[res].cost, cCrs = canon[res].effectiveCreditsPerSec;
    const payback = u.cost / u.creditsPerSec;
    assert(u.cost === cCost, `${name} ${res} gatherer cost = ${cCost}`, `${u.name}: ${u.cost}`);
    assert(u.creditsPerSec === cCrs, `${name} ${res} gatherer cr·s⁻¹ = ${cCrs}`, `${u.name}: ${u.creditsPerSec}`);
    assert(payback >= band[0] && payback <= band[1], `${name} ${res} gatherer payback in band`, `${u.name}: ${payback.toFixed(1)} s`);
    assert((u.dmg || 0) === 0, `${name} ${res} gatherer is unarmed (economy unit)`, `${u.name}: dmg ${u.dmg}`);
    assert(SUPPORT.test(u.role || ''), `${name} ${res} gatherer role reads as economy support`, `${u.name}: "${u.role}"`);
    assert((u.renewable === true) === (res === 'wood'), `${name} ${res} gatherer renewable flag matches resource`, `${u.name}: renewable=${u.renewable}`);
  }
}

// ---- report ----
console.log('\n' + '-'.repeat(64) + '\n');
for (const [mark, label, detail] of log) console.log(`  ${mark} ${label}${detail ? `  — ${detail}` : ''}`);
console.log('\n' + '='.repeat(64));
console.log(fail === 0
  ? `  ✓ ECONOMY VERIFIED — ${pass}/${pass} assertions pass.`
  : `  ✗ ${fail} of ${pass + fail} assertions FAIL — economy data is inconsistent.`);
console.log('='.repeat(64) + '\n');
process.exit(fail ? 1 : 0);
