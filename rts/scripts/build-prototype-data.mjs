// Inject a compact roster (the fields the battle sandbox needs) into
// prototype/index.html between the /*ROSTER_START*/ … /*ROSTER_END*/ markers,
// so the prototype stays in sync with data/units/*.json from one command:
//   node rts/scripts/build-prototype-data.mjs
import fs from 'fs';

const FIELDS = ['name','class','cost','hp','dmg','proj','reload','acc','dmgType','range','aoe','mobile','resist','ignoreResist','general','role'];
const out = {};
for (const f of ['directorate','covenant','array']) {
  const r = JSON.parse(fs.readFileSync(`rts/data/units/${f}.json`,'utf8'));
  out[r.faction] = r.units.map(u => Object.fromEntries(FIELDS.map(k => [k, u[k] ?? null])));
}

const path = 'rts/prototype/index.html';
const html = fs.readFileSync(path,'utf8');
const START = '/*ROSTER_START*/', END = '/*ROSTER_END*/';
const i = html.indexOf(START), j = html.indexOf(END);
if (i < 0 || j < 0) { console.error('markers not found in '+path); process.exit(1); }
const next = html.slice(0, i+START.length) + JSON.stringify(out) + html.slice(j);
fs.writeFileSync(path, next);
const n = Object.values(out).reduce((a,v)=>a+v.length,0);
console.log(`Injected ${n} units into ${path}.`);
