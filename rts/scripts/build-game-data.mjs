// Inject the roster and map into game/index.html between markers, so the
// playable skirmish stays in sync with data/units/*.json and data/maps/*.json:
//   node rts/scripts/build-game-data.mjs
import fs from 'fs';

const FIELDS = ['name','tier','class','role','cost','build','hp','dmg','proj','reload','acc','dmgType','range','aoe','mobile','general','resist','ignoreResist','stealth','flank','mine','convert','detector','answers','counteredBy','weaknesses'];
const roster = {};
for (const f of ['directorate','covenant','array']) {
  const r = JSON.parse(fs.readFileSync(`rts/data/units/${f}.json`,'utf8'));
  roster[r.faction] = r.units.map(u => Object.fromEntries(FIELDS.map(k => [k, u[k] ?? null])));
}
// ALL maps in data/maps/ are injected as a name-keyed object (map selector in-game)
const maps = {};
for (const f of fs.readdirSync('rts/data/maps').filter(f=>f.endsWith('.json')).sort()){
  const m = JSON.parse(fs.readFileSync(`rts/data/maps/${f}`,'utf8'));
  maps[m.name] = m;
}

const path = 'rts/game/index.html';
let html = fs.readFileSync(path,'utf8');
const inject = (tag, obj) => {
  const S = `/*${tag}_START*/`, E = `/*${tag}_END*/`;
  const i = html.indexOf(S), j = html.indexOf(E);
  if (i<0 || j<0) throw new Error(`markers ${tag} not found`);
  html = html.slice(0, i+S.length) + JSON.stringify(obj) + html.slice(j);
};
// Raw-text injection (not JSON): inline the authored model kit so the game stays
// a single offline file while models.js remains a reviewable, separately-verified
// module (design/22 P1 "assembled source" seam — the model kit is the first module).
const injectRaw = (tag, text) => {
  const S = `/*${tag}_START*/`, E = `/*${tag}_END*/`;
  const i = html.indexOf(S), j = html.indexOf(E);
  if (i<0 || j<0) throw new Error(`markers ${tag} not found`);
  html = html.slice(0, i+S.length) + '\n' + text.trim() + '\n' + html.slice(j);
};
inject('ROSTER', roster);
inject('MAP', maps);
const models = fs.readFileSync('rts/game/models.js','utf8');
injectRaw('MODELS', models);
fs.writeFileSync(path, html);
const mLines = models.split('\n').length;
console.log(`Injected ${Object.values(roster).reduce((a,v)=>a+v.length,0)} units + ${Object.keys(maps).length} map(s) [${Object.keys(maps).join(', ')}] + model kit (${mLines} lines) into ${path}.`);
