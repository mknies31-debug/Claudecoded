// Map auditor (§37 + terrain.json perMapTestHooks). Proves a competitive map
// satisfies the per-map tests: rotational symmetry (→ exact travel-time and
// resource equality), a flank around every narrow choke, a ramp onto every
// plateau, spawns at equal elevation, and elevated artillery that cannot shell
// a base from safety.
//   node rts/scripts/map-check.mjs                       # default map
//   node rts/scripts/map-check.mjs rts/data/maps/foo.json
import fs from 'fs';

const path = process.argv[2] || 'rts/data/maps/twin-ridge.json';
const m = JSON.parse(fs.readFileSync(path, 'utf8'));
const units = JSON.parse(fs.readFileSync('rts/data/units/directorate.json', 'utf8')).units;
const maxArtRange = Math.max(...units.filter(u => u.class === 'Artillery').map(u => u.range || 0), 9);

let fail = 0, pass = 0;
const ok = (c, label, detail = '') => { console.log(`  ${c ? '✓' : '✗'} ${label}${detail ? `  — ${detail}` : ''}`); c ? pass++ : (fail++); };

const { w, h } = m.size;
const rot = p => ({ x: w - p.x, y: h - p.y });
const eq = (a, b) => a.x === b.x && a.y === b.y;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// generic 180° symmetry check for a point list ({x,y}), matching on a key
// function. Owner p1↔p2 swap under rotation, so keys must be owner-agnostic
// (use `player` vs `contested`), not literal owner ids.
function symmetric(list, key, label) {
  let good = true, why = '';
  for (const e of list) {
    const r = rot(e);
    const match = list.find(o => eq(o, r) && key(o) === key(e));
    if (!match) { good = false; why = `${label} at (${e.x},${e.y}) [${key(e)}] has no counterpart at (${r.x},${r.y})`; break; }
  }
  ok(good, `${label}: 180° symmetric`, why || `${list.length} element(s) mirror-matched`);
}
// symmetry for segment lists ({from,to}): the rotated segment must exist (either endpoint order)
function symmetricSegments(list, key, label) {
  let good = true, why = '';
  for (const e of list) {
    const rf = rot(e.from), rt = rot(e.to);
    const match = list.find(o => key(o) === key(e) &&
      ((eq(o.from, rf) && eq(o.to, rt)) || (eq(o.from, rt) && eq(o.to, rf))));
    if (!match) { good = false; why = `${label} ${e.type} (${e.from.x},${e.from.y})→(${e.to.x},${e.to.y}) has no rotated counterpart`; break; }
  }
  ok(good, `${label}: 180° symmetric`, why || `${list.length} segment(s) mirror-matched`);
}
const ownerKind = o => o === 'contested' ? 'contested' : 'player';

console.log(`\nMap audit — ${m.name}  (${w}×${h}, ${m.players}p, ${m.symmetry})\n`);

// 1. symmetry of every layer → travel-time + resource equality fall out of this
symmetric(m.spawns, s => `spawn e${s.elevation}`, 'Spawns');
symmetric(m.resources, r => `${r.type}:${ownerKind(r.owner)}:${r.richness}`, 'Resources');
symmetric(m.highGround, g => `hg e${g.elevation}`, 'High ground');
symmetric(m.chokes, c => `choke:${c.width}`, 'Chokes');
symmetric(m.forests || [], () => 'forest', 'Forests');
symmetric(m.neutralObjectives || [], n => n.type, 'Neutral objectives');
symmetricSegments(m.barriers || [], b => b.type, 'Barriers');

// 2. resource equality per player (explicit, beyond symmetry)
const per = owner => m.resources.filter(r => r.owner === owner);
const countByType = rs => rs.reduce((a, r) => (a[r.type] = (a[r.type] || 0) + 1, a), {});
const p1 = JSON.stringify(countByType(per('p1'))), p2 = JSON.stringify(countByType(per('p2')));
ok(p1 === p2, 'Resource equality (per player)', `p1 ${p1} = p2 ${p2}`);
ok(per('contested').length > 0 && per('contested').length % 2 === 0, 'Contested resources exist and are paired', `${per('contested').length} contested node(s)`);

// 3. travel-time equality: each spawn's distance to a self-symmetric feature is equal
const centerPt = m.center;
const dCenter = m.spawns.map(s => dist(s, centerPt));
ok(Math.abs(dCenter[0] - dCenter[1]) < 1e-6, 'Travel-time to center equal (§37 tol 0s)', `${dCenter[0].toFixed(1)} = ${dCenter[1].toFixed(1)} tiles`);

// 4. a flank around every narrow choke
const narrows = m.chokes.filter(c => c.width === 'narrow');
const widths = new Set(m.chokes.map(c => c.width));
const flanked = narrows.every(c => (c.flankedBy || []).length > 0);
ok(narrows.length === 0 || (flanked && (widths.has('wide') || widths.has('medium'))),
  'Flank around every narrow choke (§37)', `${narrows.length} narrow, ${m.chokes.length - narrows.length} wider route(s)`);

// 5. multi-route (pool diversity §38): >1 lane between the mains
ok((m.lanes || []).length >= 2, 'Multiple routes between spawns (§38)', `${(m.lanes || []).length} lanes`);

// 6. every plateau reachable by a ground ramp
const allRamped = m.highGround.every(g => (g.ramps || []).length >= 1);
ok(allRamped, 'Every plateau has a ground ramp (no air-only high ground)', `${m.highGround.length} plateau(s)`);

// 7. spawns at equal elevation (mirror the high ground)
ok(new Set(m.spawns.map(s => s.elevation)).size === 1, 'Spawns share equal elevation', `all e${m.spawns[0].elevation}`);

// 8. elevated artillery cannot shell a base from full safety
let minRidgeToBase = Infinity;
for (const g of m.highGround) for (const s of m.spawns) minRidgeToBase = Math.min(minRidgeToBase, dist(g, s));
ok(minRidgeToBase > maxArtRange * 1.5, 'Elevated artillery cannot bombard a base from safety',
  `min ridge→base ${minRidgeToBase.toFixed(1)} tiles > artillery range ${maxArtRange} ×1.5`);

// 9. bases have buildable room and detection is reachable (relay towers)
ok(m.spawns.every(s => (s.buildRadius || 0) >= 8), 'Each main has buildable area', `buildRadius ≥ 8`);
ok((m.neutralObjectives || []).some(n => /detect|vision/i.test(n.grants || '')), 'Detection objective present (§28)', 'relay tower grants detection');

console.log(`\n${fail === 0 ? `✓ ${m.name} passes all ${pass} §37 map tests.` : `✗ ${fail} test(s) failed.`}`);
process.exit(fail ? 1 : 0);
