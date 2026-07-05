// Inject the roster and map into game/index.html between markers, so the
// playable skirmish stays in sync with data/units/*.json and data/maps/*.json:
//   node rts/scripts/build-game-data.mjs
import fs from 'fs';

const FIELDS = ['name','tier','class','role','cost','build','hp','dmg','proj','reload','acc','dmgType','range','aoe','mobile','general','resist','ignoreResist','stealth','flank','mine','convert','detector'];
const roster = {};
for (const f of ['directorate','covenant','array']) {
  const r = JSON.parse(fs.readFileSync(`rts/data/units/${f}.json`,'utf8'));
  roster[r.faction] = r.units.map(u => Object.fromEntries(FIELDS.map(k => [k, u[k] ?? null])));
}
const map = JSON.parse(fs.readFileSync('rts/data/maps/twin-ridge.json','utf8'));

const path = 'rts/game/index.html';
let html = fs.readFileSync(path,'utf8');
const inject = (tag, obj) => {
  const S = `/*${tag}_START*/`, E = `/*${tag}_END*/`;
  const i = html.indexOf(S), j = html.indexOf(E);
  if (i<0 || j<0) throw new Error(`markers ${tag} not found`);
  html = html.slice(0, i+S.length) + JSON.stringify(obj) + html.slice(j);
};
inject('ROSTER', roster);
inject('MAP', map);
fs.writeFileSync(path, html);
console.log(`Injected ${Object.values(roster).reduce((a,v)=>a+v.length,0)} units + map "${map.name}" into ${path}.`);
