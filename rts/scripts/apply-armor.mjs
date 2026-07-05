// Apply the armor-archetype resistance table to every unit (fix §15-A/B).
// Overwrites each unit's `resist` from its class→archetype, adds Array's energy
// shield bonus, and sets `ignoreResist` on shield-break units. Re-run anytime:
//   node rts/scripts/apply-armor.mjs
import fs from 'fs';
const A = JSON.parse(fs.readFileSync('rts/data/armor-table.json','utf8'));
const shieldBreak = new Set(A.shieldBreakUnits);

for (const f of ['directorate','covenant','array']) {
  const file = `rts/data/units/${f}.json`;
  const r = JSON.parse(fs.readFileSync(file,'utf8'));
  for (const u of r.units) {
    const arch = A.classToArchetype[u.class] || 'medium';
    u.armor = arch;
    u.resist = { ...A.table[arch] };
    // Array shields: extra energy resist on armed units (dropped by EMP; bypassed by shield-break)
    if (r.faction === 'Array' && u.dmg > 0) u.resist.energy = (u.resist.energy||0) + A.arrayShieldEnergyBonus;
    if (shieldBreak.has(u.name)) u.ignoreResist = true;
  }
  fs.writeFileSync(file, JSON.stringify(r,null,2)+'\n');
  console.log(`${r.faction}: armor applied to ${r.units.length} units.`);
}
