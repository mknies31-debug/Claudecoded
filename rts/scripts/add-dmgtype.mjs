// Add a `dmgType` (damage category dealt) to each unit, so matchup.mjs can
// apply the target's resistance. Heuristic; only fills units missing the field
// (hand-edits persist). Re-run after adding units:
//   node rts/scripts/add-dmgtype.mjs
import fs from 'fs';
const FILES = ['directorate','covenant','array'].map(f=>`rts/data/units/${f}.json`);

function infer(u){
  const t = `${u.name} ${u.role}`.toLowerCase();
  if (!(u.dmg > 0)) return 'none';                                   // support / economy / superweapon
  if (u.class === 'Artillery') return 'siege';
  if (u.class === 'Aircraft') return 'air';
  if (/energy|arc|prism|phase|pylon|disrupt|null|aegis|sentinel|shield/.test(t)) return 'energy'; // Array energy weapons
  if (/anti-armor|tank destroyer|missile|lance|demolition|ambush|anti-vehicle/.test(t)) return 'antiArmor';
  if (u.class === 'Epic unit') return 'siege';
  if (/rocket|flak|anti-air/.test(t)) return 'explosive';
  if (u.class === 'Main battle tank') return 'antiArmor';
  return 'smallArms';
}

for (const file of FILES){
  const r = JSON.parse(fs.readFileSync(file,'utf8'));
  let n = 0;
  for (const u of r.units){ if (typeof u.dmgType !== 'string'){ u.dmgType = infer(u); n++; } }
  fs.writeFileSync(file, JSON.stringify(r,null,2)+'\n');
  console.log(`${r.faction}: set dmgType on ${n} unit(s).`);
}
