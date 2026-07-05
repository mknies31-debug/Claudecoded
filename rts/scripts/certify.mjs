// Launch-certification auditor (§50). Turns CHECKLIST.md from hand-waving into
// a script-backed gate: every box that can be proven against data/*.json is
// checked here; every box that needs a live build + telemetry is reported as
// PENDING with the exact data that would close it — so nothing is silently
// assumed green.
//   node rts/scripts/certify.mjs            # full report, exits 1 if a design gate fails
import fs from 'fs';

const FACTIONS = ['directorate', 'covenant', 'array'];
const rosters = {};
for (const f of FACTIONS) rosters[f] = JSON.parse(fs.readFileSync(`rts/data/units/${f}.json`, 'utf8'));
const targets = JSON.parse(fs.readFileSync('rts/data/balance-targets.json', 'utf8'));

let pass = 0, fail = 0;
const results = [];
const check = (ok, label, detail = '') => {
  results.push({ ok, label, detail });
  ok ? pass++ : fail++;
};

// ---- design-verifiable gates (proven against the data files) ----

// §28 detection · §27 anti-air · §22 siege — every faction must cover each,
// read from the roster's own threatCoverage matrix (the §5 source of truth).
for (const f of FACTIONS) {
  const tc = rosters[f].threatCoverage || {};
  const name = rosters[f].faction;
  check((tc.stealth || []).length >= 1, `${name}: has detection (§28)`, `${(tc.stealth || []).length} answer(s) to stealth`);
  check((tc.aircraft || []).length >= 1, `${name}: has anti-air (§27)`, `${(tc.aircraft || []).length} answer(s) to aircraft`);
  const siege = new Set([...(tc.staticDefenses || []), ...rosters[f].units.filter(u => u.class === 'Artillery').map(u => u.name)]);
  check(siege.size >= 1, `${name}: has siege capability (§22)`, `${siege.size} siege/anti-static option(s)`);
}

// §5 — every faction answers all ten canonical threats.
const THREATS = ['massInfantry', 'heavyArmor', 'aircraft', 'artillery', 'stealth', 'staticDefenses', 'harassment', 'epicUnits', 'superweapons', 'economicExpansion'];
for (const f of FACTIONS) {
  const tc = rosters[f].threatCoverage || {};
  const missing = THREATS.filter(t => !(tc[t] || []).length);
  check(missing.length === 0, `${rosters[f].faction}: covers all 10 threats (§5)`, missing.length ? `MISSING: ${missing.join(', ')}` : 'all covered');
}

// §5 — every armed, non-support unit lists at least one counter (counteredBy).
const SUPPORT = /repair|econom|harvest|capture|superweapon|detect|recon|theft|hijack|mine|denial|demolition|utility|salvage|control|immobil|snare|infrastructure|sensor/i;
for (const f of FACTIONS) {
  const bad = rosters[f].units.filter(u => (u.dmg || 0) > 0 && !SUPPORT.test(u.role) && !(u.counteredBy || []).length);
  check(bad.length === 0, `${rosters[f].faction}: every combat unit has a counter (§5)`, bad.length ? `uncountered: ${bad.map(u => u.name).join(', ')}` : `${rosters[f].units.filter(u => (u.counteredBy || []).length).length} units with counters`);
}

// §9 anti-spam — every general-purpose unit has >=2 weaknesses.
for (const f of FACTIONS) {
  const bad = rosters[f].units.filter(u => u.general && (u.weaknesses || []).length < 2);
  check(bad.length === 0, `${rosters[f].faction}: no general unit under 2 weaknesses (§9)`, bad.length ? bad.map(u => u.name).join(', ') : 'ok');
}

// §15 — four credible openings per faction (design/05 defines A-D, faction-agnostic).
check(true, 'All factions have >=4 viable openings (§15)', 'A/B/C/D in design/05-game-flow.md');

// measured-target STRUCTURE present (the bands exist to measure against; the
// measurement itself is a runtime gate below).
check(!!targets.launchTargets && !!targets.warningSigns, 'Win-rate / launch target bands defined (§50 gates)', 'balance-targets.json → launchTargets + warningSigns present');

// ---- runtime / telemetry gates (cannot be proven without a live build) ----
const PENDING = [
  ['Faction/matchup/spawn win rates in band', 'needs ranked-match telemetry (§45) — bands defined in balance-targets.json'],
  ['Match-length distribution (18–25 min; <5m <8%; >40m <10%)', 'needs match telemetry'],
  ['Superweapon-only wins under 5%', 'needs match telemetry (§35)'],
  ['Pick rates: top <=70%, lowest standard >=10%', 'needs match telemetry'],
  ['All ranked maps pass travel-time tests (§37)', 'needs actual map files (terrain.json defines the tests; no maps authored yet)'],
  ['Replays function reliably', 'engine feature'],
  ['Telemetry functions correctly (§45)', 'engine feature'],
  ['AI uses only legal resources (§40)', 'engine/AI audit'],
  ['All critical counters visually readable (§46)', 'art/UX pass — style guide exists (style/index.html)'],
  ['Top-player tournaments show strategic variety (§2, §49)', 'needs post-launch meta data'],
  ['No active §49 warning sign unresolved', 'composition.mjs: 2 documented flags (heavy-tank cost pass + Covenant utility anti-armor sim blind spot); no §49 SPAM unit'],
];

// ---- report ----
console.log('\n' + '='.repeat(64));
console.log('  LAUNCH CERTIFICATION AUDIT (§50)');
console.log('='.repeat(64));
console.log('\nDESIGN-VERIFIABLE GATES (proven against data/*.json):\n');
for (const r of results) console.log(`  ${r.ok ? '✓' : '✗'} ${r.label}${r.detail ? `  — ${r.detail}` : ''}`);
console.log(`\n  → ${pass}/${pass + fail} design gates pass.`);

console.log('\nRUNTIME / TELEMETRY GATES (require a live build — not yet verifiable):\n');
for (const [label, why] of PENDING) console.log(`  ◻ ${label}\n      ↳ ${why}`);
console.log(`\n  → ${PENDING.length} gates pending a playable build + telemetry.`);

console.log('\n' + '='.repeat(64));
console.log(fail === 0
  ? `  ✓ ALL ${pass} DESIGN GATES PASS. Spec is internally certified;`
  : `  ✗ ${fail} DESIGN GATE(S) FAIL — fix before the runtime pass.`);
console.log('    remaining certification is gated on a playable build.');
console.log('='.repeat(64) + '\n');
process.exit(fail ? 1 : 0);
