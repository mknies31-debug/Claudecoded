#!/usr/bin/env node
// camera-tests.mjs — headless test suite for the RTS dynamic camera.
//
//   Target:  /home/user/Claudecoded/rts/game/index.html   (loaded READ-ONLY; never edited)
//   Run:     node camera-tests.mjs
//   Exit:    0 = all tests pass
//            1 = at least one test fails
//            2 = camera not integrated yet (contract symbols absent / file mid-edit)
//
// Written against the camera API CONTRACT (the integrator implements to the same
// contract simultaneously — this file codes to the contract, not to the current
// source):
//
//   CAM = {x, y, z}      camera center in WORLD tiles (map 128x128), zoom in [1,5]
//   FIT                  base fit scale (px/tile at z=1);  SCALE = FIT * CAM.z
//   applyCam()           sx(x) = (x - CAM.x)*SCALE + cv.width/2   (same for sy)
//   clampCam()           clamp z to [1,5]; keep view inside map; center any axis
//                        whose view is wider/taller than the map; calls applyCam()
//   zoomAt(px, py, f)    multiply z by f (clamped), keep world point under screen
//                        pixel (px,py) stationary
//   followSel            when true and sel non-empty, each render frame lerps
//                        CAM.x/y ~8% toward selection centroid (then clamps);
//                        turns itself off when sel is empty
//   sx/sy, wx/wy         world->screen / screen->world, exact inverses

import { readFileSync } from 'node:fs';

const HTML_PATH = '/home/user/Claudecoded/rts/game/index.html';
const HTML = readFileSync(HTML_PATH, 'utf8');

const CW = 900, CH = 600;   // shimmed canvas size
const MW = 128, MH = 128;   // map size in tiles (contract)
const FIT_EXPECT = Math.min(CW / MW, CH / MH); // 4.6875 px/tile at z=1

// ---- extract the game's single inline <script> body --------------------------
function extractScript(html) {
  const open = html.indexOf('<script>');
  const close = html.indexOf('</script>', open);
  if (open < 0 || close < 0) throw new Error('could not locate <script> block in index.html');
  return html.slice(open + '<script>'.length, close);
}

// ---- exposer appended to the game script --------------------------------------
// The bare identifiers (CAM, zoomAt, ...) in the object literal throw a
// ReferenceError at eval time if the camera is not integrated yet — that is the
// "not integrated" detector, handled in loadGame().
const EXPOSE = `;globalThis.__cam={CAM,zoomAt,clampCam,applyCam,S:()=>SCALE,sx:x=>sx(x),sy:y=>sy(y),wx:p=>wx(p),wy:p=>wy(p),get followSel(){return followSel},set followSel(v){followSel=v},get sel(){return sel},set sel(v){sel=v},get ents(){return ents},spawn,start:()=>{started=true},resize};`;

// ---- DOM / canvas shim ---------------------------------------------------------
function makeShim() {
  const noop = () => {};
  const gradient = { addColorStop() {} };
  const ctx = new Proxy({}, {
    get(_t, prop) {
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient' || prop === 'createPattern')
        return () => gradient;
      if (prop === 'measureText') return () => ({ width: 10 });
      if (prop === 'getImageData') return () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 });
      return noop;
    },
    set: () => true,
  });

  function makeEl(id) {
    const el = {
      id, style: {}, className: '', dataset: {},
      _text: '', _html: '', value: '', disabled: false, title: '', onclick: null, onchange: null,
      children: [],
      clientWidth: CW, clientHeight: CH, width: CW, height: CH,
      get textContent() { return this._text; }, set textContent(v) { this._text = String(v); },
      get innerHTML() { return this._html; }, set innerHTML(v) { this._html = String(v); if (v === '') this.children = []; },
      appendChild(c) { this.children.push(c); return c; },
      addEventListener() {}, removeEventListener() {},
      getContext() { return ctx; },
      getBoundingClientRect() { return { width: CW, height: CH, left: 0, top: 0, right: CW, bottom: CH }; },
    };
    el.parentElement = { getBoundingClientRect() { return { width: CW, height: CH, left: 0, top: 0, right: CW, bottom: CH }; } };
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
  const location = { reload() {}, href: '' };

  return { document, requestAnimationFrame, performance, addEventListener, location, rafState };
}

// deterministic RNG so spawn jitter never perturbs assertions
function seedRandom(seed) {
  let s = seed >>> 0;
  Math.random = function () {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function notIntegrated(what) {
  console.log('CAMERA NOT INTEGRATED YET: ' + what);
  process.exit(2);
}

// ---- load a fresh copy of the game ---------------------------------------------
function loadGame() {
  seedRandom(424242);
  const shim = makeShim();
  const body = extractScript(HTML) + EXPOSE;
  delete globalThis.__cam;

  let fn;
  try {
    fn = new Function('document', 'addEventListener', 'requestAnimationFrame', 'performance', 'location', body);
  } catch (e) {
    // SyntaxError => the integrator's edit is mid-flight; treat as not-ready.
    notIntegrated('(script does not parse: ' + e.message + ')');
  }

  try {
    fn(shim.document, shim.addEventListener, shim.requestAnimationFrame, shim.performance, shim.location);
  } catch (e) {
    if (e instanceof ReferenceError) {
      const m = /^(\w+) is not defined/.exec(e.message || '');
      notIntegrated(m ? m[1] : e.message);
    }
    throw e; // anything else is a real crash — surface it
  }

  const api = globalThis.__cam;
  if (!api || typeof api !== 'object') notIntegrated('__cam');

  // Contract probe: symbols may exist (declared) but be unassigned/wrong-typed.
  const missing = [];
  if (!api.CAM || typeof api.CAM !== 'object') missing.push('CAM');
  else for (const k of ['x', 'y', 'z']) if (typeof api.CAM[k] !== 'number') missing.push('CAM.' + k);
  for (const k of ['zoomAt', 'clampCam', 'applyCam', 'spawn', 'resize', 'S', 'sx', 'sy', 'wx', 'wy']) {
    if (typeof api[k] !== 'function') missing.push(k);
  }
  try { if (typeof api.followSel !== 'boolean') missing.push('followSel (not boolean)'); }
  catch { missing.push('followSel'); }
  try { if (!Array.isArray(api.sel)) missing.push('sel (not array)'); } catch { missing.push('sel'); }
  try { if (!Array.isArray(api.ents)) missing.push('ents (not array)'); } catch { missing.push('ents'); }
  if (missing.length) notIntegrated(missing.join(', '));

  api.__raf = shim.rafState;
  api.__now = () => shim.performance.now();
  return api;
}

// drive N render frames via the captured requestAnimationFrame callback
function frames(api, n) {
  for (let i = 0; i < n; i++) {
    const cb = api.__raf.cb;
    if (typeof cb !== 'function') throw new Error('no requestAnimationFrame callback captured — render loop never started');
    cb(api.__now()); // monotonically increasing timestamp (+16.7 per call)
  }
}

// ---- tiny test framework --------------------------------------------------------
const results = [];
function test(name, fn) {
  try {
    const note = fn() || '';
    results.push({ name, pass: true, note });
    console.log('PASS  ' + name + (note ? '  — ' + note : ''));
  } catch (e) {
    results.push({ name, pass: false, note: e.message });
    console.log('FAIL  ' + name + '  — ' + e.message);
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }
function approx(got, want, eps, msg) {
  if (!(Math.abs(got - want) <= eps)) throw new Error(`${msg} (got ${got}, want ${want} ±${eps})`);
}

// One probe load up front: exits 2 with a clear message if the camera contract
// is not integrated yet. Every test then uses its own fresh instance.
loadGame();

// =================================================================================
// TEST 1 — Baseline equivalence: CAM={64,64,1} reproduces the old letterboxed view
// =================================================================================
test('1. Baseline equivalence (z=1 centered == old letterbox)', () => {
  const api = loadGame();
  api.resize();
  api.CAM.x = 64; api.CAM.y = 64; api.CAM.z = 1;
  api.applyCam();
  const S = api.S();
  approx(api.sx(64), CW / 2, 1e-6, 'sx(64) must be canvas center x (450)');
  approx(api.sy(64), CH / 2, 1e-6, 'sy(64) must be canvas center y (300)');
  assert(MW * S <= CW + 1e-6, `map width in px must fit canvas: ${MW}*${S}=${MW * S} > ${CW}`);
  assert(MH * S <= CH + 1e-6, `map height in px must fit canvas: ${MH}*${S}=${MH * S} > ${CH}`);
  approx(S, FIT_EXPECT, 1e-6, 'SCALE at z=1 must equal the fit scale min(900/128,600/128)');
  // old letterbox origin: OX=(cv.width-W*S)/2, OY=(cv.height-H*S)/2
  approx(api.sx(0), (CW - MW * S) / 2, 1e-6, 'sx(0) must equal old letterbox OX');
  approx(api.sy(0), (CH - MH * S) / 2, 1e-6, 'sy(0) must equal old letterbox OY');
  return `SCALE=${S}, sx(0)=${api.sx(0)}, sy(0)=${api.sy(0)}`;
});

// =================================================================================
// TEST 2 — Round-trip: wx(sx(p))≈p and wy(sy(p))≈p under many camera states
// =================================================================================
test('2. Round-trip world<->screen exact inverses', () => {
  const api = loadGame();
  api.resize();
  const states = [
    { x: 64, y: 64, z: 1 },
    { x: 30, y: 40, z: 2.5 },
    { x: 100, y: 20, z: 5 },
    { x: 64, y: 64, z: 3.3 },
    { x: 10, y: 120, z: 1.7 },
    { x: 48.25, y: 96.5, z: 4.01 },
  ];
  const pts = [0, 0.5, 1, 16, 32, 63.7, 64, 96, 127.99, 128];
  let checks = 0;
  for (const st of states) {
    api.CAM.x = st.x; api.CAM.y = st.y; api.CAM.z = st.z;
    api.applyCam();
    for (const p of pts) {
      approx(api.wx(api.sx(p)), p, 1e-9, `wx(sx(${p})) at CAM=(${st.x},${st.y},z${st.z})`);
      approx(api.wy(api.sy(p)), p, 1e-9, `wy(sy(${p})) at CAM=(${st.x},${st.y},z${st.z})`);
      checks += 2;
    }
  }
  return `${checks} round-trips across ${states.length} camera states, all within 1e-9`;
});

// =================================================================================
// TEST 3 — Zoom anchor: world point under the cursor stays fixed (in and out)
// =================================================================================
test('3. zoomAt keeps cursor world point stationary (in and out)', () => {
  const api = loadGame();
  api.resize();
  api.CAM.x = 64; api.CAM.y = 64; api.CAM.z = 2;
  api.clampCam();
  const PX = 300, PY = 200;

  // zoom IN 1.5x anchored at (300,200)
  let w0x = api.wx(PX), w0y = api.wy(PY);
  api.zoomAt(PX, PY, 1.5);
  approx(api.CAM.z, 3, 1e-9, 'z after zoomAt(...,1.5) from 2');
  approx(api.wx(PX), w0x, 1e-6, 'zoom-in: wx(300) anchor drifted');
  approx(api.wy(PY), w0y, 1e-6, 'zoom-in: wy(200) anchor drifted');

  // zoom OUT back to 2x, same cursor, fresh anchor
  w0x = api.wx(PX); w0y = api.wy(PY);
  api.zoomAt(PX, PY, 1 / 1.5);
  approx(api.CAM.z, 2, 1e-9, 'z after zoomAt(...,1/1.5) from 3');
  approx(api.wx(PX), w0x, 1e-6, 'zoom-out: wx(300) anchor drifted');
  approx(api.wy(PY), w0y, 1e-6, 'zoom-out: wy(200) anchor drifted');
  return 'anchor at screen (300,200) held through 2->3->2 zoom within 1e-6';
});

// =================================================================================
// TEST 4 — Clamp: view stays inside map; oversized axes centered; z into [1,5]
// =================================================================================
test('4. clampCam keeps view in map, centers oversized axes, clamps z', () => {
  const api = loadGame();
  api.resize();

  // (a) zoomed in, camera shoved to the NW corner -> view pulled inside the map
  api.CAM.z = 3; api.CAM.x = 0; api.CAM.y = 0;
  api.clampCam();
  assert(api.wx(0) >= -1e-6, `left view edge outside map: wx(0)=${api.wx(0)}`);
  assert(api.wy(0) >= -1e-6, `top view edge outside map: wy(0)=${api.wy(0)}`);
  assert(api.wx(CW) <= MW + 1e-6, `right view edge outside map: wx(900)=${api.wx(CW)}`);
  assert(api.wy(CH) <= MH + 1e-6, `bottom view edge outside map: wy(600)=${api.wy(CH)}`);

  // (b) z=1: view >= map on both axes (900>600px, 600==600px) -> centered baseline
  api.CAM.z = 1;
  api.clampCam();
  approx(api.CAM.x, 64, 1e-9, 'z=1: x axis (view wider than map) must center CAM.x=64');
  approx(api.CAM.y, 64, 1e-9, 'z=1: y axis (view == map) must center CAM.y=64');
  approx(api.sx(64), CW / 2, 1e-6, 'z=1 after clamp must reproduce letterbox baseline');

  // (c) z clamped to [1,5]
  api.CAM.z = 99; api.clampCam();
  assert(api.CAM.z <= 5 + 1e-9, `z=99 not clamped down: ${api.CAM.z}`);
  approx(api.CAM.z, 5, 1e-9, 'z=99 should clamp to exactly 5');
  api.CAM.z = 0.2; api.clampCam();
  assert(api.CAM.z >= 1 - 1e-9, `z=0.2 not clamped up: ${api.CAM.z}`);
  approx(api.CAM.z, 1, 1e-9, 'z=0.2 should clamp to exactly 1');
  return 'corner shove contained; z=1 recenters to (64,64); z 99->5, 0.2->1';
});

// =================================================================================
// TEST 5 — Follow: camera lerps toward the selection; auto-off when sel empties
// =================================================================================
test('5. followSel lerps toward selection and auto-disables on empty sel', () => {
  const api = loadGame();
  api.resize();

  const u = api.spawn('me', 'Vanguard MBT', 100, 100);
  assert(u && typeof u.x === 'number', 'spawn returned no usable unit');
  api.sel = [u];
  api.followSel = true;

  // start the sim (spec: drive render frames after start()) at a zoom where the
  // camera is free to move (at z=1 both axes clamp-center to 64 and cannot follow)
  api.start();
  api.CAM.x = 40; api.CAM.y = 40; api.CAM.z = 3;
  api.clampCam();

  const dist = () => Math.hypot(api.CAM.x - u.x, api.CAM.y - u.y);
  const d0 = dist();
  let prev = d0, regressions = 0, maxRegress = 0;
  for (let i = 0; i < 60; i++) {
    frames(api, 1);
    const d = dist();
    if (d > prev + 1e-9) { regressions++; maxRegress = Math.max(maxRegress, d - prev); }
    prev = d;
  }
  const d60 = dist();
  // clampCam limits CAM.x to ~96 at z=3, so the floor distance to (100,100) is ~4
  assert(d60 <= 8, `after 60 frames camera still ${d60.toFixed(2)} world units from selection (started at ${d0.toFixed(2)})`);
  assert(d60 < d0 * 0.25, `camera barely moved: ${d0.toFixed(2)} -> ${d60.toFixed(2)}`);
  assert(regressions <= 6, `approach not monotonic-ish: distance increased on ${regressions}/60 frames (max +${maxRegress.toFixed(3)})`);
  assert(api.followSel === true, 'followSel turned off while sel was still non-empty');

  // empty the selection -> follow must turn itself off within a frame
  api.sel = [];
  frames(api, 1);
  assert(api.followSel === false, 'followSel did not auto-disable after sel emptied');
  return `distance ${d0.toFixed(1)} -> ${d60.toFixed(2)} over 60 frames (${regressions} regressions); auto-off OK`;
});

// =================================================================================
// TEST 6 — Sim isolation: camera manipulation never touches simulation state
// =================================================================================
test('6. camera changes do not affect the simulation', () => {
  const api = loadGame();
  api.resize();

  const u = api.spawn('me', 'Vanguard MBT', 50, 50);
  const before = { x: u.x, y: u.y, hp: u.hp };
  const entCount = api.ents.length;

  // thrash the camera WITHOUT driving any frames
  api.CAM.x = 3; api.CAM.y = 125; api.CAM.z = 4.7; api.clampCam();
  api.zoomAt(100, 100, 2);
  api.zoomAt(800, 550, 0.4);
  api.zoomAt(450, 300, 3);
  api.zoomAt(0, 0, 0.01);
  api.CAM.x = -50; api.CAM.y = 500; api.clampCam();
  api.applyCam();

  assert(u.x === before.x && u.y === before.y, `unit moved: (${before.x},${before.y}) -> (${u.x},${u.y})`);
  assert(u.hp === before.hp, `unit hp changed: ${before.hp} -> ${u.hp}`);
  assert(api.ents.length === entCount, `ents count changed: ${entCount} -> ${api.ents.length}`);

  // then run the live sim at deep zoom: must not throw
  api.CAM.z = 4; api.CAM.x = 50; api.CAM.y = 50; api.clampCam();
  api.start();
  frames(api, 30); // any exception here fails the test via the framework
  return 'unit (x,y,hp) bit-identical through camera thrash; 30 frames at z=4 ran clean';
});

// ---- summary --------------------------------------------------------------------
const line = '─'.repeat(78);
const pass = results.filter(r => r.pass).length;
const fail = results.length - pass;
console.log(line);
console.log(`CAMERA TEST SUITE — ${HTML_PATH}`);
console.log(`Totals: ${pass} PASS, ${fail} FAIL of ${results.length}`);
console.log(line);
process.exit(fail ? 1 : 0);
