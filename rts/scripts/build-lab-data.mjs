// Regenerate the Balance Lab's embedded unit presets from the roster JSON.
// Single source of truth = rts/data/units/*.json. Run after editing any roster:
//   node rts/scripts/build-lab-data.mjs
import fs from 'fs';

const ROSTERS = ['directorate', 'covenant', 'array'];
const LAB = 'rts/lab/index.html';

const samples = {
  "Blank / new unit": { faction:"Directorate", cls:"Main battle tank", cost:600, build:26, pop:3, hp:800,
    resist:{smallArms:0,explosive:0,antiArmor:0,energy:0,air:0,siege:0}, dmg:60, proj:1, reload:2, acc:80,
    general:"yes", weaks:[], destroyed:"" }
};

let count = 0;
for (const r of ROSTERS) {
  const roster = JSON.parse(fs.readFileSync(`rts/data/units/${r}.json`, 'utf8'));
  for (const u of roster.units) {
    samples[`${roster.faction} · ${u.name}`] = {
      faction: roster.faction, cls: u.class,
      cost: u.cost, build: u.build, pop: u.pop, hp: u.hp,
      resist: u.resist, dmg: u.dmg, proj: u.proj, reload: u.reload, acc: u.acc,
      general: u.general ? "yes" : "no",
      weaks: u.weaknesses || [],
      destroyed: ""
    };
    count++;
  }
}

const body = JSON.stringify(samples, null, 2);
let html = fs.readFileSync(LAB, 'utf8');
const re = /\/\*ROSTER_START\*\/[\s\S]*?\/\*ROSTER_END\*\//;
if (!re.test(html)) { console.error('markers /*ROSTER_START*/ … /*ROSTER_END*/ not found in', LAB); process.exit(1); }
// Use a replacer FUNCTION, not a string: a string replacement makes
// String.replace interpret `$&`, `` $` ``, `$'`, `$n`, `$$` inside `body`
// (e.g. a unit field containing `$`), which would splice document text into
// the output and corrupt the file. A function's return value is inserted verbatim.
html = html.replace(re, () => `/*ROSTER_START*/${body}/*ROSTER_END*/`);
fs.writeFileSync(LAB, html);
console.log(`Injected ${count} units (+ blank template) into ${LAB}.`);
