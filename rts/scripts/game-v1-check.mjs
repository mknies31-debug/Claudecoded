#!/usr/bin/env node
// V1 MVP headless test harness for the single-file browser RTS.
//   Target: rts/game/index.html  (do NOT edit it — this harness loads it read-only)
//   Run:    node v1-tests.mjs
//
// It extracts the game's inline <script>, evaluates it under a DOM/canvas shim,
// and exercises the REAL engine functions (spawn / acquire / applyDamage /
// updateEnt / queueBuild / harvest) to verify the six V1 features. Where a rule
// must be reconstructed (the impassable grid), the harness mirrors the map's own
// barrier geometry rather than reimplementing engine internals.
//
// Every check is defensive: if a global/field/function required by a feature is
// absent, the test reports FAIL/SKIP with a clear "not integrated yet" note and
// never crashes the run.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
// index.html lives at <repo>/rts/game/index.html
const GAME_PATH = resolve(__dirname, '../../../../../../home/user/Claudecoded/rts/game/index.html');
// Fall back to an absolute path if the relative resolution above is off.
const HTML_PATH = tryPaths([
  GAME_PATH,
  '/home/user/Claudecoded/rts/game/index.html',
]);

function tryPaths(paths) {
  for (const p of paths) {
    try { readFileSync(p, 'utf8'); return p; } catch { /* next */ }
  }
  return paths[paths.length - 1];
}

const HTML = readFileSync(HTML_PATH, 'utf8');

// ---- extract the single inline <script> body --------------------------------
function extractScript(html) {
  const open = html.indexOf('<script>');
  const close = html.indexOf('</script>', open);
  if (open < 0 || close < 0) throw new Error('could not locate <script> block in index.html');
  return html.slice(open + '<script>'.length, close);
}

// ---- code appended to the game body to surface internals for testing --------
// Referenced identifiers must exist in the game scope. Optional/future features
// (newGame, a pathfinding predicate) are probed with `typeof` so an absent name
// yields null instead of a ReferenceError.
const EXPOSE = `
;globalThis.__api = (function(){
  return {
    get ents(){ return ents; },            set ents(v){ ents = v; },
    get credits(){ return credits; },      set credits(v){ credits = v; },
    get oreUnlocked(){ return oreUnlocked; },
    get over(){ return over; },
    get hqMe(){ return hqMe; },            get hqCpu(){ return hqCpu; },
    get ME(){ return ME; },                set ME(v){ ME = v; },
    get CPU(){ return CPU; },              set CPU(v){ CPU = v; },
    get DIFF(){ return DIFF; },            set DIFF(v){ DIFF = v; },
    get BUILDMULT(){ return BUILDMULT; },  set BUILDMULT(v){ BUILDMULT = v; },
    byName: byName, ROSTER: ROSTER, MAP: MAP, BUILDABLE: BUILDABLE, GATH: GATH,
    nodes: nodes, DET_R: DET_R,
    spawn: spawn, spawnHQ: spawnHQ, acquire: acquire, applyDamage: applyDamage,
    combat: combat, updateEnt: updateEnt, tick: tick, cpuThink: cpuThink,
    queueBuild: queueBuild, harvest: harvest, moveToward: moveToward, separate: separate,
    pdps: pdps, effHP: effHP, SPEED: SPEED, RAD: RAD, onHigh: onHigh, bt: bt,
    // optional future hooks (null when the feature is not integrated yet):
    newGame: (typeof newGame !== 'undefined') ? newGame : null,
    pathBlocked: (typeof isBlocked !== 'undefined') ? isBlocked
               : (typeof blockedAt !== 'undefined') ? blockedAt
               : (typeof passable  !== 'undefined') ? function(x,y){ return !passable(x,y); }
               : (typeof BLOCKED   !== 'undefined') ? function(x,y){ return !!(BLOCKED[Math.floor(y)]&&BLOCKED[Math.floor(y)][Math.floor(x)]); }
               : null,
    loopCb: (typeof loop !== 'undefined') ? loop : null,
  };
})();
`;

// ---- DOM / canvas shim ------------------------------------------------------
function makeShim() {
  const noop = () => {};
  const ctx = new Proxy({}, { get: () => noop, set: () => true, apply: () => undefined });

  function makeEl(id) {
    const el = {
      id, style: {}, className: '', dataset: {},
      _text: '', _html: '', value: '', disabled: false, title: '', onclick: null, onchange: null,
      children: [],
      clientWidth: 900, clientHeight: 600, width: 900, height: 600,
      get textContent() { return this._text; }, set textContent(v) { this._text = String(v); },
      get innerHTML() { return this._html; }, set innerHTML(v) { this._html = String(v); if (v === '') this.children = []; },
      appendChild(c) { this.children.push(c); return c; },
      addEventListener() {}, removeEventListener() {},
      getContext() { return ctx; },
      getBoundingClientRect() { return { width: 900, height: 600, left: 0, top: 0, right: 900, bottom: 600 }; },
    };
    el.parentElement = { getBoundingClientRect() { return { width: 900, height: 600, left: 0, top: 0, right: 900, bottom: 600 }; } };
    return el;
  }

  const els = {};
  const document = {
    getElementById(id) { return els[id] || (els[id] = makeEl(id)); },
    createElement(tag) { return makeEl('_' + tag); },
  };

  const rafState = { cb: null };
  const requestAnimationFrame = (cb) => { rafState.cb = cb; return 1; };

  let t = 0;
  const performance = { now() { t += 16.7; return t; } };

  const addEventListener = () => {}; // window-level listeners: capture-and-ignore

  return { document, requestAnimationFrame, performance, addEventListener, rafState };
}

// deterministic RNG so spawn jitter / cd don't perturb assertions
function seedRandom(seed) {
  let s = seed >>> 0;
  Math.random = function () {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// ---- load a fresh copy of the game (optionally transforming the source) -----
function loadGame(transform) {
  seedRandom(12345);
  const shim = makeShim();
  const body = (transform ? transform(extractScript(HTML)) : extractScript(HTML)) + EXPOSE;
  delete globalThis.__api;
  const fn = new Function('document', 'addEventListener', 'requestAnimationFrame', 'performance', body);
  fn(shim.document, shim.addEventListener, shim.requestAnimationFrame, shim.performance);
  const api = globalThis.__api;
  api.__rafState = shim.rafState;
  return api;
}

// ---- reconstruction of the impassable grid from MAP.barriers ----------------
// Mirrors the map's own barrier geometry (same segments the renderer draws):
//   cliff  -> thin wall  (renderer lineWidth ~1.1 tile  -> half-width ~0.6)
//   water  -> wider band (renderer lineWidth ~3.2 tile  -> half-width ~1.8);
//             "water blocks a wider band" per the barrier notes.
// Ground units must never occupy these; Aircraft may (they fly over).
function segDist(px, py, a, b) {
  const vx = b.x - a.x, vy = b.y - a.y;
  const wx = px - a.x, wy = py - a.y;
  const L = vx * vx + vy * vy;
  let t = L ? (wx * vx + wy * vy) / L : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (a.x + t * vx), py - (a.y + t * vy));
}
function makeBlocked(MAP) {
  return function (x, y) {
    for (const bar of MAP.barriers) {
      const half = bar.type === 'water' ? 1.8 : 0.6;
      if (segDist(x, y, bar.from, bar.to) <= half) return bar.type; // 'water' | 'cliff'
    }
    return false;
  };
}

// ---- tiny test framework ----------------------------------------------------
const results = [];
function record(name, status, detail, integrated) {
  results.push({ name, status, detail, integrated });
}
function run(name, fn) {
  try {
    const r = fn(); // { status, detail, integrated }
    record(name, r.status, r.detail, r.integrated);
  } catch (e) {
    record(name, 'FAIL', 'harness/engine threw: ' + (e && e.stack ? e.stack.split('\n')[0] : e), false);
  }
}

// =============================================================================
// TEST 1 — Pathfinding / collision (+ aircraft may cross)
// =============================================================================
run('1. Pathfinding / collision (water pool)', () => {
  const api = loadGame();
  const blocked = api.pathBlocked || makeBlocked(api.MAP);
  const usingEngineGrid = !!api.pathBlocked;

  // NW water pool: segment (20,60)->(40,60). Cross from north side to south side.
  const START = { x: 30, y: 54 }, GOAL = { x: 30, y: 66 };

  function driveGround(unitName) {
    api.ents = [];
    const u = api.spawn('me', unitName, START.x, START.y);
    u.order = 'move'; u.tx = GOAL.x; u.ty = GOAL.y; u.tgt = null;
    let entered = null;
    const d0 = Math.hypot(GOAL.x - u.x, GOAL.y - u.y);
    for (let i = 0; i < 3000; i++) {
      api.updateEnt(u);
      const b = blocked(u.x, u.y);
      if (b && !entered) entered = { b, x: +u.x.toFixed(2), y: +u.y.toFixed(2), step: i };
      if (Math.hypot(GOAL.x - u.x, GOAL.y - u.y) < 0.6) break;
    }
    const dEnd = Math.hypot(GOAL.x - u.x, GOAL.y - u.y);
    return { entered, progressed: dEnd < d0 - 1, reached: dEnd < 1.0, x: u.x, y: u.y, d0, dEnd };
  }

  const ground = driveGround('Vanguard MBT');   // Directorate MBT (ground)

  // Aircraft: allowed to cross straight over the water.
  api.ents = [];
  const air = api.spawn('me', 'Falcon Gunship', START.x, START.y);
  air.order = 'move'; air.tx = GOAL.x; air.ty = GOAL.y; air.tgt = null;
  for (let i = 0; i < 3000; i++) {
    api.updateEnt(air);
    if (Math.hypot(GOAL.x - air.x, GOAL.y - air.y) < 0.6) break;
  }
  const airReached = Math.hypot(GOAL.x - air.x, GOAL.y - air.y) < 1.0;

  const groundOk = !ground.entered && ground.progressed;
  const integrated = !!api.pathBlocked || groundOk; // engine grid exposed OR ground actually avoided water
  const gridSrc = usingEngineGrid ? 'engine grid' : 'reconstructed grid';

  if (groundOk && airReached) {
    return { status: 'PASS', integrated: true,
      detail: `ground avoided all impassable tiles (${gridSrc}) and reached goal (d ${ground.d0.toFixed(0)}->${ground.dEnd.toFixed(1)}); Aircraft crossed straight over water.` };
  }
  const parts = [];
  if (ground.entered) parts.push(`ground unit occupied '${ground.entered.b}' tile at (${ground.entered.x},${ground.entered.y}) step ${ground.entered.step} — walks straight through the pool`);
  else if (!ground.progressed) parts.push(`ground unit made no progress toward goal (d ${ground.d0.toFixed(0)}->${ground.dEnd.toFixed(1)})`);
  if (!airReached) parts.push(`Aircraft did NOT reach goal (d->${Math.hypot(GOAL.x - air.x, GOAL.y - air.y).toFixed(1)}) — real bug: air should fly over`);
  const airNote = airReached ? ' (Aircraft crossing: OK)' : '';
  return { status: 'FAIL', integrated,
    detail: parts.join('; ') + airNote + (api.pathBlocked ? '' : ' [no engine path predicate exposed -> collision not integrated]') };
});

// =============================================================================
// TEST 2 — Immobile structures never move
// =============================================================================
run('2. Immobile structure ignores move orders', () => {
  const api = loadGame();
  const spec = api.byName['Sentry Turret'];
  if (!spec) return { status: 'SKIP', integrated: false, detail: "roster lacks 'Sentry Turret'" };

  api.ents = [];
  const turret = api.spawn('me', 'Sentry Turret', 24, 30);
  const enemy = api.spawn('cpu', 'Raider Squad', 110, 110); // far outside range (range+3=9)
  turret.order = 'move'; turret.tx = enemy.x; turret.ty = enemy.y; turret.tgt = null;

  const x0 = turret.x, y0 = turret.y;
  for (let i = 0; i < 400; i++) api.updateEnt(turret);
  const moved = Math.hypot(turret.x - x0, turret.y - y0);

  if (moved < 1e-6) {
    return { status: 'PASS', integrated: true, detail: `mobile:${spec.mobile} structure held position (moved ${moved.toExponential(1)} tiles).` };
  }
  return { status: 'FAIL', integrated: false,
    detail: `structure moved ${moved.toFixed(2)} tiles from (${x0},${y0}) to (${turret.x.toFixed(1)},${turret.y.toFixed(1)}) — engine does not honor mobile:false [not integrated]` };
});

// =============================================================================
// TEST 3 — Shields (Array): shield absorbs first; ignoreResist bypasses
// =============================================================================
run('3. Shields (Array unit)', () => {
  const api = loadGame();
  const spec = api.byName['Aegis Tank'];
  if (!spec) return { status: 'SKIP', integrated: false, detail: "roster lacks 'Aegis Tank'" };

  api.ents = [];
  const aegis = api.spawn('me', 'Aegis Tank', 60, 60);
  const hasShield = typeof aegis.shield === 'number';
  if (!hasShield) {
    return { status: 'FAIL', integrated: false,
      detail: `spawned Aegis Tank has no numeric 'shield' field (shield=${aegis.shield}); maxHp=${aegis.maxHp} — shields not integrated` };
  }

  const shieldFull = aegis.shield > 0 && Math.abs(aegis.shield - aegis.maxHp) <= aegis.maxHp * 0.6;

  // (a) non-ignoreResist attacker: shield should drop before hp.
  api.ents = [aegis];
  const grunt = api.spawn('cpu', 'Rifleman Squad', 61, 60); // smallArms, ignoreResist:null
  const s0 = aegis.shield, h0 = aegis.hp;
  api.applyDamage(aegis, 120, grunt);
  const shieldAbsorbed = aegis.shield < s0 - 1e-6 && aegis.hp >= h0 - 1e-6;

  // (b) ignoreResist attacker on a FRESH shielded tank: hp should drop even at full shield.
  const aegis2 = api.spawn('me', 'Aegis Tank', 62, 60);
  const breaker = api.byName['Nullifier'] ? 'Nullifier' : (api.byName['Disruptor'] ? 'Disruptor' : null);
  if (!breaker) return { status: 'SKIP', integrated: hasShield, detail: 'no ignoreResist unit (Nullifier/Disruptor) in roster' };
  const brk = api.spawn('cpu', breaker, 63, 60);
  const h2 = aegis2.hp;
  api.applyDamage(aegis2, 120, brk);
  const hpBypassed = aegis2.hp < h2 - 1e-6;

  const ok = shieldFull && shieldAbsorbed && hpBypassed;
  const detail = `shield present (${s0.toFixed(0)}~maxHp ${aegis.maxHp}: ${shieldFull ? 'ok' : 'off'}); ` +
    `smallArms hit -> shield ${shieldAbsorbed ? 'absorbed (hp intact)' : 'NOT absorbed (hp dropped)'}; ` +
    `${breaker} (ignoreResist) -> hp ${hpBypassed ? 'dropped through shield' : 'did NOT drop'}`;
  return { status: ok ? 'PASS' : 'FAIL', integrated: hasShield, detail };
});

// =============================================================================
// TEST 4 — Stealth / detection
// =============================================================================
run('4. Stealth acquisition requires a detector', () => {
  const api = loadGame();
  const stealthName = api.byName['Ambush Tank'] ? 'Ambush Tank' : (api.byName['Saboteur'] ? 'Saboteur' : null);
  if (!stealthName) return { status: 'SKIP', integrated: false, detail: 'no stealth unit in roster' };
  const detName = api.byName['Recon Spotter'] ? 'Recon Spotter' : (api.byName['Probe Skimmer'] ? 'Probe Skimmer' : null);

  // (a) NO detector: my combat unit should NOT be able to acquire the cloaked enemy.
  api.ents = [];
  const shooter = api.spawn('me', 'Vanguard MBT', 60, 60);
  const cloaked = api.spawn('cpu', stealthName, 63, 60); // within acquire range (range+3)
  const t1 = api.acquire(shooter);
  const hiddenOk = t1 !== cloaked; // ideally null

  // (b) friendly detector within DET_R: cloaked enemy becomes targetable.
  let revealedOk = false, detNote = 'no detector unit available';
  if (detName) {
    api.ents = [];
    const shooter2 = api.spawn('me', 'Vanguard MBT', 60, 60);
    const cloaked2 = api.spawn('cpu', stealthName, 63, 60);
    api.spawn('me', detName, 61, 60); // detector:true, well within DET_R
    const t2 = api.acquire(shooter2);
    revealedOk = t2 === cloaked2;
    detNote = `with ${detName}: acquire -> ${t2 ? t2.name : 'null'}`;
  }

  const integrated = hiddenOk; // if the cloaked unit is hidden without a detector, stealth logic exists
  const ok = hiddenOk && (detName ? revealedOk : true);
  const detail = `no-detector: acquire(myUnit) -> ${t1 ? t1.name : 'null'} (${hiddenOk ? 'stealth hidden, ok' : 'FAIL: cloaked unit was acquired'}); ${detNote}${revealedOk ? ' (revealed, ok)' : (detName ? ' (NOT revealed)' : '')}`;
  if (!hiddenOk) return { status: 'FAIL', integrated: false, detail: detail + ' [acquire ignores stealth -> not integrated]' };
  return { status: ok ? 'PASS' : 'FAIL', integrated, detail };
});

// =============================================================================
// TEST 5 — Faction selection: Array selectable & playable
// =============================================================================
run('5. Array faction selectable & playable', () => {
  const api = loadGame();
  const notes = [];

  const inRoster = !!(api.ROSTER && api.ROSTER['Array']);
  const gath = api.GATH && api.GATH['Array'];
  const gathOk = gath && gath.wood === 'Harvest Drone';
  const inBuildMenu = !!(api.BUILDABLE && api.BUILDABLE['Array']);
  const hasNewGame = typeof api.newGame === 'function';

  notes.push(`Array in roster: ${inRoster}`);
  notes.push(`Array gatherers defined (wood='Harvest Drone'): ${!!gathOk}`);
  notes.push(`Array in player BUILDABLE menu: ${inBuildMenu}`);
  notes.push(`newGame()/faction control present: ${hasNewGame}`);

  // Try to actually drive the player faction to Array and observe gatherers.
  let playedOk = false, playedNote = '';
  if (hasNewGame) {
    try {
      api.ME = 'Array';
      api.newGame();
      const mine = api.ents.filter(e => e.owner === 'me' && e.name === 'Harvest Drone');
      playedOk = mine.length > 0 && inBuildMenu;
      playedNote = `newGame(ME=Array) -> ${mine.length} Harvest Drone gatherers`;
    } catch (e) {
      playedNote = 'newGame(ME=Array) threw: ' + e.message;
    }
  } else {
    // No faction control exists. Prove data-playability by loading with ME preset
    // to 'Array' (source-level swap of the default, engine untouched) and checking
    // the setup spawns Array gatherers without crashing.
    try {
      const api2 = loadGame(src => src.replace("let ME='Directorate'", "let ME='Array'"));
      const mine = api2.ents.filter(e => e.owner === 'me' && e.name === 'Harvest Drone');
      playedOk = false; // not selectable via UI, so not "integrated" as a feature
      playedNote = `data-playable check (ME preset to Array): setup spawned ${mine.length} 'Harvest Drone' gatherer(s), no crash — but Array is NOT wired to a UI selector and is absent from the build menu`;
    } catch (e) {
      playedNote = 'ME-preset load threw: ' + e.message;
    }
  }
  notes.push(playedNote);

  const integrated = inBuildMenu && (hasNewGame ? playedOk : false);
  if (integrated) {
    return { status: 'PASS', integrated: true, detail: notes.join(' | ') };
  }
  return { status: 'FAIL', integrated: false,
    detail: notes.join(' | ') + ' [Array not wired as a selectable/playable player faction]' };
});

// =============================================================================
// TEST 6 — Build queue + economy
// =============================================================================
run('6. Build queue + economy', () => {
  const api = loadGame();
  api.DIFF = 'normal'; api.BUILDMULT = 1;

  const buildName = 'Rifleman Squad';
  const spec = api.byName[buildName];
  if (!spec) return { status: 'SKIP', integrated: false, detail: "roster lacks '" + buildName + "'" };

  const creditsBefore = api.credits.me;
  const countBefore = api.ents.filter(e => e.owner === 'me' && e.name === buildName).length;

  api.queueBuild('me', api.hqMe, buildName);
  const deducted = creditsBefore - api.credits.me;
  const creditsAfterQueue = api.credits.me;

  // Step the full sim. Build time = spec.build * BUILDMULT seconds; DT = 1/30 s.
  const seconds = (spec.build || 20) + 2;
  const ticks = Math.ceil(seconds * 30);
  let spawnedAtTick = -1;
  for (let i = 0; i < ticks; i++) {
    api.tick();
    const c = api.ents.filter(e => e.owner === 'me' && e.name === buildName).length;
    if (c > countBefore && spawnedAtTick < 0) spawnedAtTick = i;
  }
  const countAfter = api.ents.filter(e => e.owner === 'me' && e.name === buildName).length;
  const spawned = countAfter > countBefore;
  const income = api.credits.me - creditsAfterQueue; // gatherers should have added credits

  const costOk = Math.abs(deducted - spec.cost) < 1e-6;
  const timeOk = spawnedAtTick >= (spec.build * 30 * 0.8); // spawned no earlier than ~80% of build time
  const incomeOk = income > 0;

  const ok = costOk && spawned && timeOk && incomeOk;
  const detail =
    `queue deducted ${deducted} (cost ${spec.cost}: ${costOk ? 'ok' : 'MISMATCH'}); ` +
    `unit ${spawned ? `spawned at t=${(spawnedAtTick / 30).toFixed(1)}s (build ${spec.build}s: ${timeOk ? 'ok' : 'too early/late'})` : 'did NOT spawn'}; ` +
    `gatherer income over run: +${income.toFixed(0)} credits (${incomeOk ? 'ok' : 'no income'})`;
  return { status: ok ? 'PASS' : 'FAIL', integrated: true, detail };
});

// ---- report -----------------------------------------------------------------
const line = '─'.repeat(78);
console.log(line);
console.log('V1 MVP TEST HARNESS  —  ' + HTML_PATH);
console.log(line);
let pass = 0, fail = 0, skip = 0;
for (const r of results) {
  if (r.status === 'PASS') pass++; else if (r.status === 'SKIP') skip++; else fail++;
  const tag = r.status === 'PASS' ? 'PASS' : r.status === 'SKIP' ? 'SKIP' : 'FAIL';
  const cls = r.status === 'FAIL'
    ? (r.integrated ? '  (REAL FAILURE — feature present but incorrect)' : '  (feature not integrated yet)')
    : '';
  console.log(`[${tag}] ${r.name}${cls}`);
  console.log(`       ${r.detail}`);
}
console.log(line);
console.log(`Totals: ${pass} PASS, ${fail} FAIL, ${skip} SKIP  of ${results.length}`);
console.log('Legend: FAIL "(not integrated yet)" = engine hook absent (expected pre-integration);');
console.log('        FAIL "(REAL FAILURE)" = feature is wired up but behaves incorrectly.');
console.log(line);

process.exit(0);
