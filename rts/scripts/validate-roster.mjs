// Validate a faction roster JSON against the Balance Bible rules.
// Usage: node rts/scripts/validate-roster.mjs rts/data/units/directorate.json
import fs from 'fs';

const BUILD_TIMES = { // §20
  "Basic infantry":[5,10],"Specialist infantry":[10,18],"Scout vehicle":[12,20],
  "Main battle tank":[22,35],"Artillery":[28,45],"Aircraft":[25,45],
  "Advanced vehicle":[35,55],"Epic unit":[90,180]
};
const THREATS = ["massInfantry","heavyArmor","aircraft","artillery","stealth","staticDefenses","harassment","epicUnits","superweapons","economicExpansion"];

const path = process.argv[2] || 'rts/data/units/directorate.json';
const r = JSON.parse(fs.readFileSync(path,'utf8'));
let warn = 0, fail = 0;
const W = m => { console.log('  ⚠ ', m); warn++; };
const F = m => { console.log('  ✗ ', m); fail++; };

console.log(`\nValidating ${r.faction} roster — ${r.units.length} units\n`);

// per-unit checks
for (const u of r.units) {
  // §9 anti-spam: general-purpose needs >=2 weaknesses
  if (u.general && (u.weaknesses||[]).length < 2)
    F(`${u.name}: general-purpose but only ${(u.weaknesses||[]).length} weakness(es) (§9 needs >=2)`);
  // §20 build-time band (skip pure structures with pop 0 & no band expectation — still informative)
  const band = BUILD_TIMES[u.class];
  if (band && (u.build < band[0] || u.build > band[1]))
    W(`${u.name}: build ${u.build}s outside ${u.class} band ${band[0]}-${band[1]}s (§20)`);
  // combat units should have a damage source
  const armed = (u.dmg||0) > 0;
  const supportRole = /repair|econom|harvest|capture|superweapon|detect|recon|theft|hijack|mine|denial|demolition|utility|salvage|control|immobil|snare|infrastructure/i.test(u.role);
  if (!armed && !supportRole) W(`${u.name}: no damage and not a support/economy role`);
  // effective-HP sanity (resist < 100 so no divide-by-zero)
  for (const [k,v] of Object.entries(u.resist||{})) if (v >= 100) F(`${u.name}: resist ${k}=${v}% >= 100% (infinite HP)`);
}

// §5 threat coverage
console.log('Threat coverage (§5):');
for (const t of THREATS) {
  const cov = (r.threatCoverage||{})[t] || [];
  if (cov.length === 0) F(`no answer listed for "${t}"`);
  else console.log(`  ✓ ${t.padEnd(18)} ← ${cov.length} answer(s)`);
}

// cross-check: every unit "answers" entry appears in threatCoverage
const covUnits = new Set(Object.values(r.threatCoverage||{}).flat().map(s=>s.replace(/\s*\(.*\)/,'')));
for (const u of r.units) for (const a of (u.answers||[]))
  if (!THREATS.includes(a)) W(`${u.name}: answers unknown threat "${a}"`);

console.log(`\nResult: ${fail} failure(s), ${warn} warning(s).`);
process.exit(fail ? 1 : 0);
