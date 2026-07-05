// Combat-math drift guard (design/21 P0a). The core formulas (pdps, effHP)
// necessarily exist in THREE places — combat-core.mjs (the sims), and inlined
// in the two offline single-file apps (prototype, game). This script proves the
// copies are behaviorally identical: it extracts each app's inline definitions,
// evaluates them, and asserts equal outputs across the full roster × every
// damage type × shield-break on/off. Exit 1 on any divergence.
//   node rts/scripts/drift-check.mjs
import fs from 'fs';
import { pdps as corePdps, effHP as coreEffHP } from './combat-core.mjs';

const FILES = {
  prototype: 'rts/prototype/index.html',
  game: 'rts/game/index.html',
};
const DMG_TYPES = ['smallArms','explosive','antiArmor','energy','air','siege'];

// pull the inline arrow-function definitions out of a single-file app
function extract(path){
  const src = fs.readFileSync(path,'utf8');
  const p = src.match(/const pdps = (u\s*=>[^;]+);/);
  const e = src.match(/const effHP = (\(def, atkType, atk\)\s*=>\s*\{[\s\S]*?\});/);
  if (!p || !e) throw new Error(`${path}: could not locate inline pdps/effHP definitions`);
  return { pdps: new Function('return ('+p[1]+')')(), effHP: new Function('return ('+e[1]+')')() };
}

const units = [];
for (const f of ['directorate','covenant','array'])
  units.push(...JSON.parse(fs.readFileSync(`rts/data/units/${f}.json`,'utf8')).units);

const same = (a,b) => (a===Infinity&&b===Infinity) || Math.abs(a-b)<1e-9;
let checks=0, drift=0;
for (const [name, path] of Object.entries(FILES)){
  const impl = extract(path);
  for (const u of units){
    checks++;
    if (!same(impl.pdps(u), corePdps(u))){ drift++; console.log(`  ✗ ${name}: pdps(${u.name}) = ${impl.pdps(u)} ≠ core ${corePdps(u)}`); }
    for (const t of DMG_TYPES) for (const atk of [{ignoreResist:false},{ignoreResist:true}]){
      checks++;
      if (!same(impl.effHP(u,t,atk), coreEffHP(u,t,atk))){ drift++;
        console.log(`  ✗ ${name}: effHP(${u.name}, ${t}, ir=${atk.ignoreResist}) = ${impl.effHP(u,t,atk)} ≠ core ${coreEffHP(u,t,atk)}`); }
    }
  }
  console.log(`  ✓ ${name}: pdps/effHP behaviorally identical to combat-core.mjs`);
}
console.log(`\n${drift===0 ? `✓ NO DRIFT — ${checks} checks across ${units.length} units × ${DMG_TYPES.length} damage types × 2 apps.`
  : `✗ ${drift} drifted value(s) — an inline combat-math copy has diverged from combat-core.mjs.`}`);
process.exit(drift?1:0);
