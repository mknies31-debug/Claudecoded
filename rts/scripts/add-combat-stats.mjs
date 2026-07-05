// Add `range`, `aoe` (targets hit per shot), and `mobile` to each unit so the
// v2 simulator can model first-strike, splash, kiting and retreat (§15-C).
// Only fills missing fields (hand-edits persist). Run:
//   node rts/scripts/add-combat-stats.mjs
import fs from 'fs';

function rangeOf(u){
  const t = `${u.name} ${u.role}`.toLowerCase();
  if (u.class === 'Artillery') return 9;
  if (u.class === 'Aircraft') return 8;
  if (/destroyer|lancer|nullifier|ambush/.test(t)) return 7;
  if (u.class === 'Structure') return 6;
  if (u.class === 'Epic unit') return 6;
  if (/infantry/i.test(u.class)) return /missile|rocket|disrupt|sabot/.test(t) ? 5 : 4;
  return 5; // scouts, MBTs, advanced vehicles
}
function aoeOf(u){
  if (!(u.dmg>0)) return 0;
  const t = `${u.name} ${u.role}`.toLowerCase();
  switch (u.dmgType){
    case 'siege': return 6;
    case 'explosive': return 3;
    case 'air': return 3;
    case 'antiArmor': return 2;
    case 'energy': return /arc|prism/.test(t) ? 3 : 1;
    default: return 1; // smallArms
  }
}

for (const f of ['directorate','covenant','array']){
  const file = `rts/data/units/${f}.json`;
  const r = JSON.parse(fs.readFileSync(file,'utf8'));
  for (const u of r.units){
    if (typeof u.range !== 'number') u.range = rangeOf(u);
    if (typeof u.aoe !== 'number') u.aoe = aoeOf(u);
    if (typeof u.mobile !== 'boolean') u.mobile = u.class !== 'Structure';
  }
  fs.writeFileSync(file, JSON.stringify(r,null,2)+'\n');
  console.log(`${r.faction}: range/aoe/mobile set.`);
}
