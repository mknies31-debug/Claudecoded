// Case Lab logic tests. Run from case-lab/:  node tests/logic.test.mjs
// Pulls the pure sections (SCHEMA → REPORT) straight out of index.html so the
// tests exercise the exact code the app runs. No dependencies.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const start = html.indexOf('// SCHEMA\n');
const end = html.indexOf('// UI\n');
assert.ok(start > 0 && end > start, 'section markers not found in index.html');
const src = html.slice(start, end).replace(/^\/\/ =+$/gm, '');
const names = ['validateBible', 'simulate', 'criticalPath', 'runLogicLab', 'scoreBlindRun', 'blindFinalRight', 'playerView',
  'mergeHunterIssues', 'runConsistency', 'puzzleStats', 'newLiveSession', 'liveScore', 'aiScore', 'buildReport',
  'buildFixPrompt', 'compareVersions', 'parseJSON', 'norm', 'summarizeSessions'];
const lib = new Function('DEMO', 'S', 'newId', `${src}\nreturn { ${names.join(', ')} };`)(true, {}, () => Math.random().toString(36).slice(2));

const load = f => JSON.parse(readFileSync(new URL(`../samples/${f}`, import.meta.url), 'utf8'));
const snow = load('snowed-in-broken.json');
const supper = load('supper-club-ambiguous.json');
let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log('ok  ', name); } catch (e) { console.error('FAIL', name, '\n    ', e.message); process.exitCode = 1; } };

test('both samples pass the schema', () => {
  for (const b of [snow, supper]) { const v = lib.validateBible(b); assert.ok(v.ok, v.errors.join('; ')); }
});

test('schema catches missing fields, bad type, duplicate ids, bad hints', () => {
  const b = structuredClone(supper);
  delete b.final; b.type = 'heist'; b.items[1].id = b.items[0].id; b.puzzles[0].hints.pop(); delete b.puzzles[1].text.mastermind;
  const { ok, errors } = lib.validateBible(b);
  assert.equal(ok, false);
  const all = errors.join('\n');
  for (const s of ['"final"', '"type"', 'Duplicate id', '3 hints', 'text.mastermind']) assert.ok(all.includes(s), `expected error mentioning ${s}\n${all}`);
});

const L = lib.runLogicLab(snow);
const has = (pred, msg) => assert.ok(L.issues.some(pred), msg + '\n' + L.issues.map(i => `${i.severity} ${i.check} ${i.target}: ${i.message}`).join('\n'));

test('snowed-in: unreachable clue c7', () => has(i => i.check === 'checkUnreachable' && i.target === 'c7', 'c7 not flagged'));
test('snowed-in: duplicate answer p3/p5', () => has(i => i.check === 'checkDuplicateAnswers' && i.target === 'p3,p5', 'dup not flagged'));
test('snowed-in: s3 is a second killer (critical)', () => has(i => i.check === 'checkSecondKiller' && i.target === 's3' && i.severity === 'critical', 's3 not flagged'));
test('snowed-in: s3 has no alibi', () => has(i => i.check === 'checkUnclearedSuspects' && i.target === 's3', 's3 alibi not flagged'));
test('snowed-in: logic score is 0 because of a critical', () => assert.equal(L.score, 0));
test('snowed-in: no false alarms on the culprit or final', () => {
  assert.ok(!L.issues.some(i => i.check === 'checkCulpritMMO'), 'culprit flagged');
  assert.ok(!L.issues.some(i => i.check === 'checkFinalReachable'), 'final flagged');
  assert.ok(!L.issues.some(i => i.check === 'checkSecondKiller' && i.target !== 's3'), 'other second killer');
});
test('snowed-in: detective steps and critical path', () => {
  assert.deepEqual(L.sims.detective.steps, [['p1', 'p2'], ['p3', 'p4'], ['p5'], ['p6']]);
  const cp = L.paths.find(p => p.level === 'detective');
  assert.deepEqual(cp.path, ['p1', 'p3', 'p5', 'p6']);
  assert.equal(cp.minutes, 16 + 18 + 16 + 20);
});
test('level-restricted item c8 only exists above rookie', () => {
  assert.ok(!L.sims.rookie.itemIds.has('c8'));
  assert.ok(L.sims.detective.have.has('c8'));
});

test('supper club: logic is clean of criticals', () => {
  const s = lib.runLogicLab(supper);
  assert.equal(s.issues.filter(i => i.severity === 'critical').length, 0, JSON.stringify(s.issues, null, 1));
  assert.ok(s.score > 0);
});

test('cycle detection', () => {
  const b = structuredClone(supper);
  b.items.find(i => i.id === 'm1').start = false;
  b.puzzles.find(p => p.id === 'p4').unlocks.push('m1');
  const r = lib.runLogicLab(b);
  assert.ok(r.issues.some(i => i.check === 'checkCycles'), 'cycle missed');
  assert.ok(r.issues.some(i => i.check === 'checkFinalReachable'), 'final should be blocked');
});

test('bottleneck: 3+ single-puzzle steps', () => {
  const b = structuredClone(supper);
  b.puzzles.find(p => p.id === 'p2').needs = ['m2', 'p3'];  // steps: [p1] [p3] [p2] [p4]
  const r = lib.runLogicLab(b);
  assert.ok(r.issues.some(i => i.check === 'checkBottleneck'), 'bottleneck missed');
});

test('phone fallback missing is critical', () => {
  const b = structuredClone(snow); delete b.items.find(i => i.id === 'c6').phone.fallback;
  assert.ok(lib.runLogicLab(b).issues.some(i => i.check === 'checkPhoneFallback' && i.severity === 'critical'));
});

test('player view never leaks answers or solution', () => {
  for (const lvl of ['rookie', 'detective', 'mastermind']) {
    const txt = JSON.stringify(lib.playerView(snow, lvl));
    for (const bad of ['"answer"', 'culprit', 'tags', 'WHITEOUT', 'insurance fraud', 'redHerring']) assert.ok(!txt.includes(bad), `${lvl} leaks ${bad}`);
  }
  assert.ok(!JSON.stringify(lib.playerView(snow, 'rookie')).includes('Weather Station'), 'rookie sees a detective-only item');
});

// The AI half of the supper-club test: a solver that reports BUG alongside HAM.
const fakeRun = (puzzles, extra = {}) => ({ kind: 'blind', persona: 'puzzle_nerds', level: 'detective', provider: 'claude', result: { puzzles, ...extra } });
test('supper club: alternate cipher answer flags possible_second_answer', () => {
  const run = fakeRun([{ id: 'p1', answer: 'HAM', confidence: 0.6, alternateAnswers: ['BUG', 'ham'], hintsNeeded: 0, estMinutes: 4 }], { finalAnswer: 'nutmeg' });
  const [p1] = lib.scoreBlindRun(supper, run);
  assert.ok(p1.right);
  assert.deepEqual(p1.flags, ['possible_second_answer']);
  assert.ok(lib.blindFinalRight(supper, run));
});
test('scoreBlindRun flags wrong, hint-heavy and low-confidence answers', () => {
  const [p1] = lib.scoreBlindRun(supper, fakeRun([{ id: 'p1', answer: 'BUG', confidence: 30, hintsNeeded: 2 }]));
  assert.deepEqual(p1.flags, ['ambiguous_or_too_hard', 'hint_heavy', 'low_confidence']);
});
test('blind accusation matches culprit by first name', () => {
  assert.ok(lib.blindFinalRight(snow, fakeRun([], { accusation: 'Victor' })));
  assert.ok(!lib.blindFinalRight(snow, fakeRun([], { accusation: 'Dot Lindqvist' })));
});
test('run consistency catches answers that differ between runs', () => {
  const a = fakeRun([{ id: 'p1', answer: 'HAM' }]), b = fakeRun([{ id: 'p1', answer: 'BUG' }]);
  const out = lib.runConsistency([a, b]);
  assert.equal(out.length, 1); assert.equal(out[0].id, 'p1');
});

test('hunter merge: the same contradiction from both models is confirmed and sorted first', () => {
  const claude = [
    { severity: 'warning', target: 'c3', problem: 'Kitchen note signature M is never explained', fix: 'Name who M is' },
    { severity: 'critical', target: 'c6', problem: 'Voicemail timestamp 11:52 contradicts the weather log alarm reset at 11:58 from the front desk', fix: 'Move the reset to 12:05' }
  ];
  const gemini = [
    { severity: 'critical', target: 'c6', problem: 'The voicemail at 11:52 contradicts the weather station log: alarm reset from the front desk at 11:58', fix: 'Shift one of the timestamps' },
    { severity: 'info', target: 'p2', problem: 'Padlock code could be read as 4120', fix: 'Say pad each number' }
  ];
  const m = lib.mergeHunterIssues(claude, gemini);
  assert.equal(m.length, 3);
  assert.ok(m[0].confirmed && m[0].target === 'c6' && m[0].sources.join() === 'claude,gemini');
  assert.equal(m.filter(x => x.confirmed).length, 1);
});

test('live: session order, stats and scores', () => {
  const s = lib.newLiveSession(supper, 'supper-club', 1, { level: 'detective', size: 4 });
  assert.deepEqual(s.puzzles.map(p => p.id), ['p1', 'p2', 'p3', 'p4']);
  const mk = (gave, fun) => ({ ...structuredClone(s), state: 'saved',
    puzzles: s.puzzles.map((p, i) => ({ ...p, seconds: [700, 480, 840, 1080][i], result: gave && i === 0 ? 'gaveup' : 'solved', hints: i === 0 ? [{ n: 1 }] : [], tags: i === 0 ? ['confusing wording'] : [] })),
    survey: { fun, clarity: 4, difficulty: 3, wouldPay: true } });
  const sessions = [mk(false, 5), mk(false, 4), mk(true, 3)];
  const st = lib.puzzleStats(supper, sessions, 'detective');
  const p1 = st.find(x => x.id === 'p1');
  assert.equal(p1.n, 3); assert.equal(p1.status, 'red');   // 33% gave up
  assert.equal(st.find(x => x.id === 'p2').status, 'green');
  const live = lib.liveScore(sessions, supper);
  assert.equal(live.parts.solve, Math.round(15 * Math.min(1, (2 / 3) / 0.7)));
  assert.equal(live.parts.fun, 10);
  assert.equal(live.parts.time, 10);                        // 51.7 min vs 45 target is within 25%
});

test('report: draft → ready path with gates', () => {
  const logic = lib.runLogicLab(supper);
  const r0 = lib.buildReport(supper, logic, [], []);
  assert.equal(r0.pill, 'draft');
  assert.equal(r0.gate.length, 6);
  const runs = ['rookie', 'detective', 'mastermind'].map(level => ({ ...fakeRun([{ id: 'p1', answer: 'HAM', confidence: 0.9, hintsNeeded: 0 }], { finalAnswer: 'NUTMEG' }), level }));
  runs.push({ kind: 'hunter', provider: 'claude', result: { issues: [] } }, { kind: 'hunter', provider: 'gemini', result: { issues: [] } });
  const sess = Array.from({ length: 3 }, () => ({ level: 'detective', state: 'saved', puzzles: supper.puzzles.map(p => ({ id: p.id, result: 'solved', seconds: p.minutes.detective * 60, hints: [], tags: [] })), survey: { fun: 5, wouldPay: true } }));
  const r1 = lib.buildReport(supper, logic, runs, sess);
  assert.equal(r1.ai.score, 25);
  assert.equal(r1.live.score, 35);
  const fails = r1.gate.filter(g => !g.pass).map(g => g.label);
  assert.deepEqual(fails, [], fails.join('; '));
  assert.equal(r1.pill, logic.score + 60 >= 85 ? 'ready' : 'testing');
});

test('fix prompt and version compare', () => {
  const logic = lib.runLogicLab(snow);
  const p = lib.buildFixPrompt(snow, logic, [], []);
  assert.ok(p.includes('version 2') && p.includes('LOGIC ISSUES') && p.includes('"changelog"'));
  const fixed = structuredClone(snow); fixed.version = 2;
  Object.assign(fixed.puzzles.find(x => x.id === 'p5'), { answer: '1152', hints: ['Check the voicemail time.', 'It was left at 11:52.', 'The code is 1152.'] });
  fixed.items.find(i => i.id === 'c3').tags.push({ suspect: 's3', type: 'alibi' });
  const c = lib.compareVersions(snow, fixed);
  assert.ok(c.fixed.some(i => i.check === 'checkDuplicateAnswers'));
  assert.ok(c.fixed.some(i => i.check === 'checkSecondKiller'));
  assert.equal(c.added.length, 0, JSON.stringify(c.added));
});

test('parseJSON strips fences and prose', () => {
  assert.deepEqual(lib.parseJSON('Sure!\n```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(lib.parseJSON('Here you go: {"a":2} hope that helps'), { a: 2 });
  assert.equal(lib.parseJSON('nope'), null);
});

console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
