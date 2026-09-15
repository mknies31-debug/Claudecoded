#!/usr/bin/env node
'use strict';
// test/audit.js — Agent 6 (Auditor). Every mechanical check from the build
// prompt's Agent 6 list plus the extras in docs/06-audit.md, against the real
// code. Zero dependencies.  `node test/audit.js`  exits 1 on any failure.
//
// Sections:
//   A  every touch reachable, none permanently skipped (5 customers x 4 years)
//   B  timezone: Dec 31 / Feb 29 sales, todayChicago, addDays under odd TZs
//   C  send.js refuses without / with wrong secret and on GET
//   D  daily.js refuses ?force=1 with a wrong secret; never sends SMS
//   E  inbound.js refuses a bad Svix signature
//   F  firestore.rules deny-by-default shape (textual; no emulator here)
//   G  opt-out flips instantly and blocks drafting; engine == compliance
//   H  templates: sentence limits, one trailing question, banned words,
//      rendered sign-off / footer / ownership language
//   I  inlined libs + templates.json byte-identical to disk
//   J  index.html: no external resources, no eval, innerHTML only via esc()
//   K  templates.json pool minimums and tone mix (SPEC §5)

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const LIB = path.join(ROOT, 'netlify', 'functions', 'lib');
const FN = path.join(ROOT, 'netlify', 'functions');

const KIT = require(path.join(LIB, 'engine.js'));
const COMPLIANCE = require(path.join(LIB, 'compliance.js'));
const LIBRARY = JSON.parse(fs.readFileSync(path.join(ROOT, 'templates.json'), 'utf8'));

let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log('ok    ' + name); }
  catch (e) { failed++; failures.push(name); console.log('FAIL  ' + name + '\n      ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n      ') : e)); }
}
async function testAsync(name, fn) {
  try { await fn(); passed++; console.log('ok    ' + name); }
  catch (e) { failed++; failures.push(name); console.log('FAIL  ' + name + '\n      ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n      ') : e)); }
}
function section(t) { console.log('\n== ' + t); }

// Deterministic PRNG so a failure reproduces.
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

function customer(over) {
  const base = {
    id: 'c' + Math.floor(Math.random() * 1e9), name: 'Dan Halvorson', first: 'Dan', phone: '5075551234', email: 'dan@example.com',
    vehicle: { year: 2019, make: 'Chevrolet', model: 'Silverado', trim: '' }, vehicleLabel: '2019 Silverado',
    saleDate: '2026-09-15', birthday: '', referredBy: '', hook: 'the gravel road out by Goodhue', notes: '',
    status: 'active', dnc: null, anchorDate: '2026-09-15', anchorTouchN: 0, nextTouchN: 0, slotOffset: 0,
    referralCredit: false, snoozedUntil: '', lastSentDate: '', firstTextSentAt: '', usedTemplateIds: [],
    emailConsent: { given: true, at: '2026-09-15T15:00:00.000Z', how: 'in person at sale' },
    smsConsent: { given: true, at: '2026-09-15T15:00:00.000Z', how: 'in person at sale' },
    unsubscribeToken: 'tok_' + 'a'.repeat(28), pendingThanks: null,
    purchases: [{ saleDate: '2026-09-15', vehicle: { year: 2019, model: 'Silverado' }, vehicleLabel: '2019 Silverado' }]
  };
  Object.assign(base, over || {});
  if (over && over.saleDate && !over.anchorDate) base.anchorDate = over.saleDate;
  return base;
}

// ------------------------------------------------------------------ A

section('A. every touch reachable, none permanently skipped');

test('5 customers x 4 years with random misses/skips/snoozes/replies/referrals: touch numbers 0..N each acted on exactly once, in order', () => {
  const rand = rng(20260915);
  const profiles = [
    { saleDate: '2026-09-15', birthday: '02-14' },
    { saleDate: '2027-12-31', birthday: '' },
    { saleDate: '2028-02-29', birthday: '03-05' },
    { saleDate: '2026-11-02', birthday: '11-20' },
    { saleDate: '2027-06-30', birthday: '07-04' }
  ];
  profiles.forEach((p, idx) => {
    let c = customer(Object.assign({ id: 'sim' + idx }, p));
    const acted = [];      // touch numbers in the order they were sent or skipped
    let extrasPending = 0, extrasCleared = 0;
    const start = p.saleDate;
    for (let d = 0; d < 365 * 4; d++) {
      const day = KIT.addDays(start, d);
      // random life events
      if (rand() < 0.004) c = KIT.applyEvent(c, { type: 'reply', date: day, at: day + 'T15:00:00.000Z' }, day);
      if (rand() < 0.002) { c = KIT.applyEvent(c, { type: 'referralReceived', date: day, referredName: 'Kari' }, day); extrasPending++; }
      const extras = KIT.extraQueueItems([c], day);
      if (extras.length && rand() < 0.5) {
        c = KIT.applyEvent(c, rand() < 0.5
          ? { type: 'sentExtra', sentDate: day, templateId: 'referral-thanks-01', channels: ['email'], minGapDays: 21 }
          : { type: 'skippedExtra' }, day);
        extrasCleared++;
      }
      const q = KIT.buildQueue([c], day);
      assert.ok(q.length <= 1, 'one item per customer');
      if (!q.length) continue;
      const it = q[0];
      assert.strictEqual(it.n, c.nextTouchN, 'queue always offers the next touch number');
      const r = rand();
      if (r < 0.55) {
        c = KIT.applyEvent(c, { type: 'sent', n: it.n, dueDate: it.dueDate, slot: it.slot, carried: it.carried, sentDate: day, channels: ['email'], templateId: 't', minGapDays: 21 }, day);
        acted.push(it.n);
      } else if (r < 0.70) {
        c = KIT.applyEvent(c, { type: 'skipped', n: it.n, dueDate: it.dueDate, slot: it.slot }, day);
        acted.push(it.n);
      } else if (r < 0.80) {
        c = KIT.applyEvent(c, { type: 'snoozed', days: 7, today: day }, day);
      } // else: Mick did nothing today; the item must still be there tomorrow
    }
    assert.ok(acted.length >= 10, 'profile ' + idx + ' acted on ' + acted.length + ' touches in 4 years');
    for (let i = 0; i < acted.length; i++) assert.strictEqual(acted[i], i, 'profile ' + idx + ': touch ' + i + ' acted exactly once in order (got ' + acted[i] + ')');
    assert.strictEqual(c.nextTouchN, acted.length, 'nextTouchN only moves through sent/skipped');
    assert.ok(extrasCleared <= extrasPending, 'extras never cleared more than pending');
  });
});

test('a due touch that is never actioned stays in buildQueue for 400 days, oldest first', () => {
  const a = customer({ id: 'a', name: 'Zed Ames', saleDate: '2026-01-01' });    // touch 0 due 2026-01-04
  const b = customer({ id: 'b', name: 'Amy Bell', saleDate: '2026-01-10' });    // touch 0 due 2026-01-13
  for (let d = 0; d < 400; d++) {
    const day = KIT.addDays('2026-01-13', d);
    const q = KIT.buildQueue([b, a], day);
    assert.strictEqual(q.length, 2, 'both still due on ' + day);
    assert.strictEqual(q[0].customer.id, 'a', 'oldest due date first on ' + day);
    assert.strictEqual(q[0].n, 0);
    assert.strictEqual(q[0].daysLate, d + 9);
    assert.strictEqual(q[1].customer.id, 'b');
  }
  // and a late send keeps the original cadence (subject to the 21-day floor)
  const sent = KIT.applyEvent(a, { type: 'sent', n: 0, dueDate: '2026-01-04', sentDate: '2027-02-16', channels: ['email'], minGapDays: 21 }, '2027-02-16');
  const nt = KIT.nextTouch(sent, '2027-02-16');
  assert.strictEqual(nt.n, 1);
  assert.strictEqual(nt.dueDate, '2027-03-09', 'touch 1 = max(sale+90, sentDate+21) = Feb 16 + 21');
  const sent2 = KIT.applyEvent(sent, { type: 'sent', n: 1, dueDate: nt.dueDate, sentDate: '2027-03-09', channels: [], minGapDays: 21 }, '2027-03-09');
  assert.strictEqual(KIT.nextTouch(sent2, '2027-03-09').dueDate, '2027-03-30', 'touch 2 = original sale+180 (2026-06-30) floored to Mar 9 + 21');
  const sent3 = KIT.applyEvent(sent2, { type: 'sent', n: 2, dueDate: '2027-03-30', sentDate: '2027-03-30', channels: [], minGapDays: 21 }, '2027-03-30');
  assert.strictEqual(KIT.nextTouch(sent3, '2027-03-30').dueDate, '2027-04-20');
  // once caught up, back on the original ladder:
  let c = sent3;
  for (let n = 3; n < 6; n++) { const t = KIT.nextTouch(c, '2027-04-20'); c = KIT.applyEvent(c, { type: 'sent', n: t.n, dueDate: t.dueDate, sentDate: t.dueDate, channels: [], minGapDays: 21 }, t.dueDate); }
  assert.strictEqual(KIT.nextTouch(c, '2027-04-20').dueDate, KIT.addDays('2026-01-01', 90 * 6), 'touch 6 lands on sale + 540 exactly');
});

// ------------------------------------------------------------------ B

section('B. timezone and calendar math');

test('sale 2027-12-31 -> touch 0 on 2028-01-03', () => {
  const c = customer({ saleDate: '2027-12-31' });
  assert.strictEqual(KIT.touchDate(c, 0), '2028-01-03');
  assert.strictEqual(KIT.nextTouch(c, '2028-01-02').isDue, false);
  assert.strictEqual(KIT.nextTouch(c, '2028-01-03').isDue, true);
  assert.strictEqual(KIT.nextTouch(c, '2028-01-03').slot, 'THANKS');
});

test('sale 2028-02-29 -> touch 1 on 2028-05-29, touch 4 on 2029-02-23 flagged ANNIVERSARY_REFERRAL', () => {
  const c = customer({ saleDate: '2028-02-29' });
  assert.strictEqual(KIT.touchDate(c, 1), '2028-05-29');
  assert.strictEqual(KIT.touchDate(c, 4), '2029-02-23');
  const r = KIT.resolveSlot(c, 4, '2029-02-23');
  assert.strictEqual(r.slot, 'ANNIVERSARY_REFERRAL');
  assert.strictEqual(r.anniversaryYear, 1);
  const prev = KIT.previewTouches(c, 5, '2028-03-03');
  assert.deepStrictEqual(prev.map((t) => t.dueDate), ['2028-03-03', '2028-05-29', '2028-08-27', '2028-11-25', '2029-02-23']);
  assert.strictEqual(prev[4].slot, 'ANNIVERSARY_REFERRAL');
});

function chicagoTodayIndependent() {
  // en-CA gives ISO order; computed separately from the engine's formatToParts path.
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

test('todayChicago() equals an independent Intl computation at the current instant', () => {
  let a = KIT.todayChicago(), b = chicagoTodayIndependent();
  if (a !== b) { a = KIT.todayChicago(); b = chicagoTodayIndependent(); } // midnight race
  assert.strictEqual(a, b);
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(a));
  const h = KIT.nowChicagoHour();
  assert.ok(h >= 0 && h <= 23 && Number.isInteger(h));
});

const TZ_PROBE = `
  const KIT = require(${JSON.stringify(path.join(LIB, 'engine.js'))});
  const c = { saleDate: '2028-02-29', anchorDate: '2028-02-29', anchorTouchN: 0, nextTouchN: 0, status: 'active' };
  const out = {
    tz: process.env.TZ,
    localOffset: new Date('2028-02-29T00:00:00Z').getTimezoneOffset(),
    a: KIT.addDays('2027-12-31', 3), b: KIT.addDays('2028-02-29', 90), c: KIT.addDays('2028-02-29', 360),
    d: KIT.addDays('2026-03-08', 1), e: KIT.addDays('2026-11-01', 1), f: KIT.addDays('2026-01-01', -1),
    g: KIT.diffDays('2026-03-07', '2026-03-09'), h: KIT.diffDays('2026-10-31', '2026-11-02'),
    i: KIT.touchDate(c, 4), j: KIT.seasonFor('2026-12-01'),
    today: KIT.todayChicago(), hour: KIT.nowChicagoHour(),
    independent: new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  };
  process.stdout.write(JSON.stringify(out));
`;
const expectedTz = { a: '2028-01-03', b: '2028-05-29', c: '2029-02-23', d: '2026-03-09', e: '2026-11-02', f: '2025-12-31', g: 2, h: 2, i: '2029-02-23', j: 'winter' };

for (const tz of ['Pacific/Kiritimati', 'Pacific/Pago_Pago', 'America/Chicago', 'UTC']) {
  test('addDays / diffDays / touchDate / todayChicago unchanged under TZ=' + tz, () => {
    const raw = execFileSync(process.execPath, ['-e', TZ_PROBE], { env: Object.assign({}, process.env, { TZ: tz }), encoding: 'utf8' });
    const o = JSON.parse(raw);
    assert.strictEqual(o.tz, tz);
    if (tz === 'Pacific/Kiritimati') assert.strictEqual(o.localOffset, -840, 'child really ran at UTC+14');
    if (tz === 'Pacific/Pago_Pago') assert.strictEqual(o.localOffset, 660, 'child really ran at UTC-11');
    for (const k of Object.keys(expectedTz)) assert.strictEqual(o[k], expectedTz[k], k + ' under ' + tz);
    assert.strictEqual(o.today, o.independent, 'todayChicago in the child matches Intl in the child');
    assert.ok(Math.abs(KIT.diffDays(o.today, KIT.todayChicago())) <= 1);
  });
}

// ------------------------------------------------------------------ C

section('C. send.js authentication');

process.env.KIT_SECRET = 'audit-secret-value-9876';
process.env.RESEND_API_KEY = 're_audit_key';
process.env.MAIL_FROM = 'Mick at North Star Car Guy <mick@example.com>';
const fetchCalls = [];
let fetchResponder = () => ({ status: 200, body: JSON.stringify({ id: 're_1' }) });
globalThis.fetch = async (url, init) => {
  fetchCalls.push({ url: String(url), init: init || {} });
  const r = fetchResponder(String(url), init || {});
  return { ok: r.status < 300, status: r.status, text: async () => r.body || '', json: async () => JSON.parse(r.body || 'null') };
};
const send = require(path.join(FN, 'send.js'));
const daily = require(path.join(FN, 'daily.js'));
const inbound = require(path.join(FN, 'inbound.js'));
const STATS = require(path.join(LIB, 'stats.js'));

const goodBody = { to: 'dan@example.com', toName: 'Dan Halvorson', subject: 'deer on Hwy 52 at dusk', text: 'Dan, deer are moving. Do you drive that stretch after dark much?\n\nMick\nNorth Star Car Guy\n(507) 555-0000', customerId: 'abc', touchId: 'xyz', unsubscribeUrl: 'https://kit.example.netlify.app/?u=' + 'a'.repeat(32) };
const post = (body, headers) => ({ httpMethod: 'POST', headers: headers || {}, body: JSON.stringify(body) });

(async () => {
  await testAsync('send.js: 401 without the secret, and Resend is never called', async () => {
    fetchCalls.length = 0;
    const r = await send.handler(post(goodBody, {}));
    assert.strictEqual(r.statusCode, 401);
    assert.strictEqual(fetchCalls.length, 0);
  });
  await testAsync('send.js: 401 with a wrong secret (same length and different length), never called', async () => {
    fetchCalls.length = 0;
    assert.strictEqual((await send.handler(post(goodBody, { 'x-kit-secret': 'audit-secret-value-9875' }))).statusCode, 401);
    assert.strictEqual((await send.handler(post(goodBody, { 'X-KIT-SECRET': 'nope' }))).statusCode, 401);
    assert.strictEqual((await send.handler(post(goodBody, { 'x-kit-secret': '' }))).statusCode, 401);
    assert.strictEqual(fetchCalls.length, 0);
  });
  await testAsync('send.js: 405 on GET even with the right secret; 200 only with POST + secret', async () => {
    fetchCalls.length = 0;
    assert.strictEqual((await send.handler({ httpMethod: 'GET', headers: { 'x-kit-secret': process.env.KIT_SECRET } })).statusCode, 405);
    assert.strictEqual((await send.handler({ httpMethod: 'PUT', headers: { 'x-kit-secret': process.env.KIT_SECRET }, body: JSON.stringify(goodBody) })).statusCode, 405);
    assert.strictEqual(fetchCalls.length, 0);
    const ok = await send.handler(post(goodBody, { 'x-kit-secret': process.env.KIT_SECRET }));
    assert.strictEqual(ok.statusCode, 200);
    assert.strictEqual(fetchCalls.length, 1);
    assert.strictEqual(fetchCalls[0].url, 'https://api.resend.com/emails');
    const payload = JSON.parse(fetchCalls[0].init.body);
    assert.ok(!('html' in payload), 'plain text only');
  });
  await testAsync('send.js: 500 (not a send) when KIT_SECRET is unset on the server', async () => {
    const saved = process.env.KIT_SECRET; delete process.env.KIT_SECRET;
    fetchCalls.length = 0;
    const r = await send.handler(post(goodBody, { 'x-kit-secret': 'anything' }));
    process.env.KIT_SECRET = saved;
    assert.strictEqual(r.statusCode, 500);
    assert.strictEqual(fetchCalls.length, 0);
  });

  // ---------------------------------------------------------------- D

  section('D. daily.js');

  function memoryDb(seed) {
    const docs = new Map(Object.entries(seed || {}));
    const log = [];
    return {
      docs, log,
      async get(p) { return docs.has(p) ? JSON.parse(JSON.stringify(docs.get(p))) : null; },
      async set(p, d) { log.push(['set', p]); docs.set(p, JSON.parse(JSON.stringify(d))); },
      async update(p, d) { log.push(['update', p]); docs.set(p, Object.assign({}, docs.get(p) || {}, d)); },
      async delete(p) { log.push(['delete', p]); docs.delete(p); },
      async list(col) { const out = []; for (const [p, d] of docs) { const [c, id] = p.split('/'); if (c === col && id) out.push({ id, data: JSON.parse(JSON.stringify(d)) }); } return out; },
      async runQuery(col) { return this.list(col); }
    };
  }
  const settingsDoc = { autoSendEmail: true, siteUrl: 'https://kit.example.netlify.app', businessAddress: '123 Main St, Zumbrota, MN 55992', mickPhoneDisplay: '(507) 555-0000', fromName: 'Mick at North Star Car Guy', fromEmail: 'mick@example.com', minGapDays: 21 };
  const dailyEnv = Object.assign({}, process.env, { FIREBASE_PROJECT_ID: 'p', KIT_FORCE_HOUR: '9' });
  const dailyDeps = (db) => ({ db, KIT, COMPLIANCE, LIBRARY, fetch: globalThis.fetch, sleep: async () => {}, newId: () => 'touch_' + Math.random().toString(36).slice(2, 12), env: dailyEnv });

  await testAsync('daily.js: ?force=1 with a wrong secret -> 401, no Firestore write, no Resend call', async () => {
    fetchCalls.length = 0;
    const db = memoryDb({ 'settings/main': settingsDoc, 'customers/c1': customer({ saleDate: '2026-06-01' }) });
    const r = await daily.handler({ httpMethod: 'GET', queryStringParameters: { force: '1' }, headers: { 'x-kit-secret': 'wrong-secret-value' } }, {}, dailyDeps(db));
    assert.strictEqual(r.statusCode, 401);
    assert.strictEqual(fetchCalls.length, 0);
    assert.strictEqual(db.log.length, 0, 'not even a heartbeat for an unauthenticated forced run');
    const r2 = await daily.handler({ httpMethod: 'GET', queryStringParameters: { force: '1' }, headers: {} }, {}, dailyDeps(db));
    assert.strictEqual(r2.statusCode, 401, 'force without any secret');
    assert.strictEqual(fetchCalls.length, 0);
  });

  await testAsync('daily.js: never sends SMS — a text-only customer is skipped, emails go only to api.resend.com, source has no SMS path', async () => {
    fetchCalls.length = 0;
    const emailOnly = customer({ id: 'e', name: 'Dan Halvorson', saleDate: '2026-06-01', nextTouchN: 1, smsConsent: { given: false, at: '', how: '' } });
    const textOnly = customer({ id: 't', name: 'Tia Ruud', email: 'tia@example.com', saleDate: '2026-06-01', nextTouchN: 1, emailConsent: { given: false, at: '', how: '' }, smsConsent: { given: true, at: '2026-06-01T00:00:00Z', how: 'text' } });
    const db = memoryDb({ 'settings/main': settingsDoc, 'customers/e': emailOnly, 'customers/t': textOnly });
    const r = await daily.handler({ httpMethod: 'GET', queryStringParameters: { force: '1' }, headers: { 'x-kit-secret': process.env.KIT_SECRET } }, {}, dailyDeps(db));
    assert.strictEqual(r.statusCode, 200, r.body);
    const out = JSON.parse(r.body);
    assert.strictEqual(out.ranSend, true);
    assert.strictEqual(out.sent, 1, JSON.stringify(out));
    assert.strictEqual(out.skipped, 1, 'text-only customer skipped, not texted');
    assert.strictEqual(fetchCalls.length, 1);
    assert.strictEqual(fetchCalls[0].url, 'https://api.resend.com/emails');
    const payload = JSON.parse(fetchCalls[0].init.body);
    assert.deepStrictEqual(payload.to, ['Dan Halvorson <dan@example.com>']);
    assert.ok(/\n\nMick\nNorth Star Car Guy\n\(507\) 555-0000\n\n--\n/.test(payload.text), 'sign-off + footer in the scheduled email');
    assert.ok(payload.text.includes('/?u=' + emailOnly.unsubscribeToken), 'unsubscribe link in the footer');
    const touches = await db.list('touches');
    assert.strictEqual(touches.length, 1);
    assert.deepStrictEqual(touches[0].data.channels, ['email']);
    assert.strictEqual(touches[0].data.sentBy, 'scheduled');
    const hb = await db.get('heartbeat/daily');
    assert.ok(hb && hb.ranSend === true && hb.sent === 1);
    const src = fs.readFileSync(path.join(FN, 'daily.js'), 'utf8');
    assert.ok(!/twilio|['"]sms['"]|sms:/i.test(src), 'daily.js has no SMS code path at all');
  });

  await testAsync('daily.js: outside the 9 AM window it writes the heartbeat and sends nothing', async () => {
    fetchCalls.length = 0;
    const db = memoryDb({ 'settings/main': settingsDoc, 'customers/e': customer({ saleDate: '2026-06-01', nextTouchN: 1 }) });
    const deps = dailyDeps(db); deps.env = Object.assign({}, dailyEnv, { KIT_FORCE_HOUR: '14' });
    const r = await daily.handler({ httpMethod: 'GET', queryStringParameters: {}, headers: {} }, {}, deps);
    assert.strictEqual(JSON.parse(r.body).ranSend, false);
    assert.strictEqual(fetchCalls.length, 0);
    assert.ok((await db.get('heartbeat/daily')).ranSend === false);
  });

  // ---------------------------------------------------------------- E

  section('E. inbound.js');

  const crypto = require('crypto');
  const WEBHOOK_SECRET = 'whsec_' + crypto.randomBytes(24).toString('base64');
  const NOW = Date.now();
  function sign(rawBody, secret, ts) {
    const key = Buffer.from(secret.slice('whsec_'.length), 'base64');
    const id = 'msg_audit';
    const sig = crypto.createHmac('sha256', key).update(`${id}.${ts}.${rawBody}`).digest('base64');
    return { 'svix-id': id, 'svix-timestamp': String(ts), 'svix-signature': 'v1,' + sig };
  }
  let makeClientCalls = 0;
  const inboundHandler = inbound.makeHandler({
    env: { RESEND_WEBHOOK_SECRET: WEBHOOK_SECRET, KIT_SECRET: 'inbound-kit-secret-1', FIREBASE_PROJECT_ID: 'p', FIREBASE_SERVICE_ACCOUNT: 'e30=', RESEND_API_KEY: 'k', MAIL_FROM: 'm@example.com' },
    fetch: async () => { throw new Error('network'); }, now: () => NOW, console: { log() {}, warn() {}, error() {} },
    KIT, COMPLIANCE, STATS, templates: LIBRARY,
    makeClient: () => { makeClientCalls++; return { async list() { return []; }, async get() { return null; }, async set() {}, async update() {}, async delete() {}, async runQuery() { return []; } }; }
  });
  const body = JSON.stringify({ type: 'email.received', created_at: new Date(NOW).toISOString(), data: { email_id: 'em_1', from: 'dan@example.com', to: ['replies@example.com'], subject: 'STOP', text: 'STOP' } });

  await testAsync('inbound.js: bad Svix signature (wrong key) -> 401, Firestore never touched', async () => {
    const other = 'whsec_' + crypto.randomBytes(24).toString('base64');
    const r = await inboundHandler({ httpMethod: 'POST', headers: sign(body, other, Math.floor(NOW / 1000)), body, isBase64Encoded: false });
    assert.strictEqual(r.statusCode, 401);
    assert.strictEqual(makeClientCalls, 0);
  });
  await testAsync('inbound.js: tampered body, stale timestamp, missing headers, wrong x-kit-secret, GET -> all refused', async () => {
    const ts = Math.floor(NOW / 1000);
    assert.strictEqual((await inboundHandler({ httpMethod: 'POST', headers: sign(body, WEBHOOK_SECRET, ts), body: body.replace('STOP', 'STOP '), isBase64Encoded: false })).statusCode, 401);
    assert.strictEqual((await inboundHandler({ httpMethod: 'POST', headers: sign(body, WEBHOOK_SECRET, ts - 600), body, isBase64Encoded: false })).statusCode, 401);
    assert.strictEqual((await inboundHandler({ httpMethod: 'POST', headers: {}, body, isBase64Encoded: false })).statusCode, 401);
    assert.strictEqual((await inboundHandler({ httpMethod: 'POST', headers: { 'x-kit-secret': 'inbound-kit-secret-2' }, body, isBase64Encoded: false })).statusCode, 401);
    assert.strictEqual((await inboundHandler({ httpMethod: 'GET', headers: sign(body, WEBHOOK_SECRET, ts), body, isBase64Encoded: false })).statusCode, 405);
    assert.strictEqual(makeClientCalls, 0);
    // and a correctly signed request gets past auth (it reaches Firestore):
    const ok = await inboundHandler({ httpMethod: 'POST', headers: sign(body, WEBHOOK_SECRET, ts), body, isBase64Encoded: false });
    assert.strictEqual(ok.statusCode, 200);
    assert.strictEqual(makeClientCalls, 1);
  });

  // ---------------------------------------------------------------- F

  section('F. firestore.rules (textual — no emulator in this sandbox)');

  test('rules: isMick() compares request.auth.uid to the placeholder; every allow is isMick() except the fenced optouts create', () => {
    const rules = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');
    const stripped = rules.replace(/\/\/[^\n]*/g, '');
    assert.ok(/rules_version\s*=\s*'2'/.test(stripped));
    const fn = stripped.match(/function isMick\(\)\s*\{([\s\S]*?)\}/);
    assert.ok(fn, 'isMick() defined');
    assert.ok(/request\.auth\s*!=\s*null/.test(fn[1]), 'isMick checks auth != null');
    assert.ok(/request\.auth\.uid\s*==\s*"PASTE_YOUR_UID_HERE"/.test(fn[1]), 'isMick compares uid to the placeholder constant');
    assert.ok(!/allow[^;]*if\s+true\b/.test(stripped), 'no "allow ... if true"');
    assert.ok(!/allow[^;]*request\.auth\s*!=\s*null\s*;/.test(stripped), 'no "any signed-in user" grant');

    // Walk match blocks with a brace stack and record every allow with its path.
    const allows = [];
    const stack = [];
    let i = 0;
    while (i < stripped.length) {
      const rest = stripped.slice(i);
      const m = rest.match(/^match\s+(\S+)\s*\{/);
      if (m) { stack.push(m[1]); i += m[0].length; continue; }
      const a = rest.match(/^allow\s+([a-z, ]+?)\s*:\s*if\s+([\s\S]*?);/);
      if (a) { allows.push({ path: stack.join(' > '), ops: a[1].split(',').map((s) => s.trim()), cond: a[2].replace(/\s+/g, ' ') }); i += a[0].length; continue; }
      if (rest[0] === '{') { stack.push('{'); i++; continue; }
      if (rest[0] === '}') { stack.pop(); i++; continue; }
      i++;
    }
    assert.ok(allows.length >= 3, 'found allow statements: ' + allows.length);
    const catchAll = allows.find((x) => x.path.endsWith('/{document=**}'));
    assert.ok(catchAll, 'catch-all match /{document=**} present');
    assert.deepStrictEqual(catchAll.ops.sort(), ['read', 'write']);
    assert.strictEqual(catchAll.cond, 'isMick()', 'deny-by-default: the catch-all grants only Mick');
    for (const x of allows) {
      if (/\bisMick\(\)/.test(x.cond)) continue;
      assert.ok(x.path.endsWith('/optouts/{token}'), 'non-Mick allow only under optouts: ' + JSON.stringify(x));
      assert.deepStrictEqual(x.ops, ['create'], 'anonymous optouts access is create only');
      assert.ok(/keys\(\)\.hasOnly\(\['at', 'source'\]\)/.test(x.cond), 'hasOnly shape');
      assert.ok(/keys\(\)\.hasAll\(\['at', 'source'\]\)/.test(x.cond), 'hasAll shape');
      assert.ok(/token\.size\(\) >= 20/.test(x.cond) && /token\.size\(\) <= 64/.test(x.cond), 'token length fenced');
      assert.ok(/data\.at is string/.test(x.cond) && /data\.at\.size\(\) <= 40/.test(x.cond), 'at is a bounded string');
      assert.ok(/data\.source == 'link'/.test(x.cond), 'source pinned to "link"');
    }
    const optRead = allows.find((x) => x.path.endsWith('/optouts/{token}') && x.ops.includes('read'));
    assert.ok(optRead && optRead.cond === 'isMick()', 'optouts read/update/delete stay Mick-only');
  });

  // ---------------------------------------------------------------- G

  section('G. opt-out flips instantly and blocks drafting');

  test('applyEvent optOut: nextTouch null, buildQueue + extraQueueItems exclude, canEmail/canText false, pending thanks dropped', () => {
    let c = customer({ saleDate: '2026-01-01' });
    c = KIT.applyEvent(c, { type: 'referralReceived', date: '2026-03-01', referredName: 'Kari' }, '2026-03-01');
    assert.ok(KIT.nextTouch(c, '2026-06-01').isDue);
    assert.strictEqual(KIT.buildQueue([c], '2026-06-01').length, 1);
    assert.strictEqual(KIT.extraQueueItems([c], '2026-06-01').length, 1);
    assert.strictEqual(COMPLIANCE.canEmail(c), true);
    assert.strictEqual(COMPLIANCE.canText(c), true);
    const d = KIT.applyEvent(c, { type: 'optOut', reason: 'STOP reply', channel: 'sms', at: '2026-06-01T15:00:00.000Z' }, '2026-06-01');
    assert.strictEqual(d.status, 'dnc');
    assert.strictEqual(KIT.nextTouch(d, '2026-06-01'), null);
    assert.strictEqual(KIT.buildQueue([d], '2026-06-01').length, 0);
    assert.strictEqual(KIT.extraQueueItems([d], '2026-06-01').length, 0);
    assert.strictEqual(KIT.previewTouches(d, 8, '2026-06-01').length, 0);
    assert.strictEqual(COMPLIANCE.canEmail(d), false);
    assert.strictEqual(COMPLIANCE.canText(d), false);
    assert.ok(/Do not contact \(STOP reply, 2026-06-01\)/.test(COMPLIANCE.consentSummary(d)));
    assert.strictEqual(c.status, 'active', 'input not mutated');
    const back = KIT.applyEvent(d, { type: 'dncClear' }, '2026-06-02');
    assert.strictEqual(back.status, 'active');
    assert.ok(KIT.nextTouch(back, '2026-06-02').isDue, 'reactivate restores the queue');
  });

  test('isOptOutText: engine and compliance agree on a 40-case corpus and match the intended truth', () => {
    const corpus = [
      ['STOP', true], ['stop', true], ['Stop.', true], ['STOP!!', true], ['Stop, I do not want these', true],
      ['unsubscribe', true], ['UNSUBSCRIBE ME', true], ['Please unsubscribe me from this list', true], ['opt out', true], ['Opt-out please', true],
      ['remove me', true], ['Take me off your list', true], ['do not contact me', true], ["Don't text me", true], ['no more emails', true],
      ['quit sending me these', true], ['cancel', true], ['END', true], ['stop texting me', true], ['leave me alone', true],
      ['please stop', true], ['stop it', true], ['Stop\nthanks', true], ['Stop these texts', true], ['STOP ALL', true],
      ['Stop by the lot Friday', false], ['End of the month works for me', false], ['I stopped by the lot yesterday', false], ['Can you cancel my Tuesday appointment and do Wednesday?', false], ['the stop sign by Goodhue is down', false],
      ['Thanks Mick, the truck is great', false], ['Yes', false], ['No', false], ['Sure, send it', false], ['Quit smoking, bought a boat', false],
      ['Nonstop rain out here', false], ['We will stop in Rochester on the way', false], ['', false], ['   ', false], ['Endless potholes on 52', false]
    ];
    assert.strictEqual(corpus.length, 40);
    for (const [s, want] of corpus) {
      assert.strictEqual(KIT.isOptOutText(s), want, 'engine: ' + JSON.stringify(s));
      assert.strictEqual(COMPLIANCE.isOptOutText(s), want, 'compliance: ' + JSON.stringify(s));
    }
    assert.strictEqual(KIT.isOptOutText(null), false);
    assert.strictEqual(COMPLIANCE.isOptOutText(undefined), false);
  });

  test('isOptOutText: the code blocks in engine.js and compliance.js are byte-identical', () => {
    const slice = (file) => {
      const src = fs.readFileSync(file, 'utf8');
      const a = src.indexOf('var OPTOUT_PHRASES');
      const f = src.indexOf('function isOptOutText', a);
      const endMarker = '\n    return false;\n  }\n';
      const b = src.indexOf(endMarker, f);
      assert.ok(a > 0 && f > a && b > f, 'markers found in ' + file);
      return src.slice(a, b + endMarker.length);
    };
    const e = slice(path.join(LIB, 'engine.js'));
    const c = slice(path.join(LIB, 'compliance.js'));
    assert.ok(e.length > 1500, 'slice is the whole detector (' + e.length + ' chars)');
    assert.strictEqual(c, e);
  });

  // ---------------------------------------------------------------- H

  section('H. templates.json — brand rules on every template and on rendered output');

  const BANNED = ['just checking in', 'checking in', 'touching base', 'circling back', 'reaching out', 'reach out', "i noticed you haven't", 'i noticed you havent', 'i noticed you have not', 'valued customer', 'at this time', 'premier'];
  const SUPERLATIVES = ['best', 'greatest', 'top', '#1', 'lowest', 'highest', 'cheapest', 'fastest', 'most', 'biggest', 'finest', 'perfect'];
  const OWNERSHIP_PHRASES = ['my dealership', 'my lot', 'we at mosaic', 'our dealership', 'my store', 'our lot', 'our store'];
  const hasWord = (hay, w) => new RegExp('(^|[^a-z0-9])' + w.replace(/[.*+?^${}()|[\]\\#]/g, '\\$&') + '(?=$|[^a-z0-9])', 'i').test(hay);
  const neutralize = (s) => s.replace(/\{[a-z_]+(\|[^{}]*)?\}/g, 'X');
  const sentences = (s) => neutralize(s).split(/(?<=[.?!])(?:\s+|$)/).map((x) => x.trim()).filter(Boolean);

  test('every template: email <= 5 sentences, text <= 2, exactly one "?" and it is last (GOODBYE: none), no "!", no "$", no digits except Hwy NN, no banned phrase / superlative / ownership wording', () => {
    const problems = [];
    for (const t of LIBRARY.templates) {
      const goodbye = t.slot === 'GOODBYE';
      const es = sentences(t.emailBody), ts = sentences(t.textBody);
      if (es.length > 5) problems.push(t.id + ': email has ' + es.length + ' sentences');
      if (ts.length > 2) problems.push(t.id + ': text has ' + ts.length + ' sentences');
      for (const [label, body] of [['email', t.emailBody], ['text', t.textBody]]) {
        const q = (body.match(/\?/g) || []).length;
        if (goodbye) { if (q !== 0) problems.push(t.id + ': GOODBYE ' + label + ' has a question mark'); }
        else {
          if (q !== 1) problems.push(t.id + ': ' + label + ' has ' + q + ' question marks');
          if (!body.endsWith('?')) problems.push(t.id + ': ' + label + ' does not end with the question');
        }
      }
      for (const [label, text] of [['subject', t.subject], ['email', t.emailBody], ['text', t.textBody]]) {
        if (text.includes('!')) problems.push(t.id + ': ' + label + ' has "!"');
        if (text.includes('$')) problems.push(t.id + ': ' + label + ' has "$"');
        if (/\d/.test(text.replace(/\bHwy \d{1,3}\b/g, ''))) problems.push(t.id + ': ' + label + ' has a digit outside "Hwy NN"');
        for (const p of BANNED) if (hasWord(text, p)) problems.push(t.id + ': ' + label + ' banned phrase "' + p + '"');
        for (const p of SUPERLATIVES) if (hasWord(text, p)) problems.push(t.id + ': ' + label + ' superlative "' + p + '"');
        for (const p of OWNERSHIP_PHRASES) if (text.toLowerCase().includes(p)) problems.push(t.id + ': ' + label + ' ownership wording "' + p + '"');
        if (/\bowner\b/i.test(text)) problems.push(t.id + ': ' + label + ' says "owner"');
      }
    }
    assert.strictEqual(problems.length, 0, '\n' + problems.join('\n'));
  });

  const sampleSettings = { mickPhone: '5075550000', mickPhoneDisplay: '(507) 555-0000', businessAddress: '123 Main St, Zumbrota, MN 55992', siteUrl: 'https://kit.example.netlify.app', senderMode: 'mick' };
  const sample = customer({ name: 'Dan Halvorson', first: 'Dan', saleDate: '2026-09-15', birthday: '02-14', hook: 'the gravel road out by Goodhue', pendingThanks: { date: '2026-10-01', referredName: 'Kari' } });
  const unsubscribeUrl = sampleSettings.siteUrl + '/?u=' + sample.unsubscribeToken;
  const footer = COMPLIANCE.emailFooter(sampleSettings, unsubscribeUrl);

  test('rendered emails sign off "Mick / North Star Car Guy / (507) 555-0000", carry the footer with "North Star Car Guy at Mosaic Autos ·" + unsubscribe URL, nothing unfilled, nothing implying ownership', () => {
    const problems = [];
    const OWN = /\bmy (dealership|lot|store)\b|\bowner\b|\bwe at mosaic\b|\bour (dealership|lot|store)\b/i;
    assert.ok(footer.includes('North Star Car Guy at Mosaic Autos · 123 Main St, Zumbrota, MN 55992'), footer);
    assert.ok(footer.includes(unsubscribeUrl), 'unsubscribe URL in footer');
    assert.ok(/selling at Mosaic Autos/.test(footer), 'footer says Mick sells at Mosaic (not owns)');
    assert.ok(footer.split('\n').length <= 5, 'footer <= 5 lines');
    for (const t of LIBRARY.templates) {
      for (const sender of ['mick', 'ella']) {
        const r = KIT.render(t, sample, sampleSettings, { sender, footer, firstText: true, date: '2026-10-05', season: 'fall' });
        const sig = sender === 'mick' ? '\n\nMick\nNorth Star Car Guy\n(507) 555-0000\n\n--\n' : '\n\nElla, for Mick\nNorth Star Car Guy\n(507) 555-0000\n\n--\n';
        if (!r.emailFull.includes(sig)) problems.push(t.id + ' (' + sender + '): sign-off block missing');
        if (!r.emailFull.endsWith(footer)) problems.push(t.id + ': footer not appended');
        if (r.missing.length) problems.push(t.id + ': unfilled ' + r.missing.join(','));
        if (/\[[a-z_]+\]/.test(r.emailFull + r.textFull)) problems.push(t.id + ': visible [placeholder]');
        if (/[{}]/.test(r.emailFull + r.textFull + r.subject)) problems.push(t.id + ': stray brace');
        if (OWN.test(r.emailFull) || OWN.test(r.textFull)) problems.push(t.id + ': implies ownership: ' + (r.emailFull.match(OWN) || r.textFull.match(OWN))[0]);
        if (/!/.test(r.emailFull) || /!/.test(r.textFull)) problems.push(t.id + ': "!" in rendered output');
        if (t.slot === 'GOODBYE') {
          if (r.textFull.includes('Reply STOP')) problems.push(t.id + ': GOODBYE text carries the STOP line');
          if (/\?/.test(r.emailBody) || /\?/.test(r.textFull)) problems.push(t.id + ': GOODBYE has a question');
        } else if (!r.textFull.endsWith(' Reply STOP to opt out.')) problems.push(t.id + ': first text must end with "Reply STOP to opt out."');
        if (t.slot === 'REFERRAL_THANKS' && !/Kari/.test(r.emailBody)) problems.push(t.id + ': {referred} not filled from pendingThanks');
      }
      const r2 = KIT.render(t, sample, sampleSettings, { sender: 'mick', firstText: false });
      if (r2.textFull.includes('Reply STOP')) problems.push(t.id + ': STOP line on a non-first text');
      if (t.slot !== 'GOODBYE' && !r2.textFull.endsWith('?')) problems.push(t.id + ': later text does not end with the question');
    }
    assert.strictEqual(problems.length, 0, '\n' + problems.join('\n'));
  });

  test('no customer-facing string says "my dealership" / "my lot" / "we at Mosaic" / "our dealership" (templates, sign-off, footer, consent labels)', () => {
    const OWN = /\bmy (dealership|lot|store|showroom)\b|\bwe at mosaic\b|\bour (dealership|lot|store)\b|\bowner\b/i;
    const strings = [footer, COMPLIANCE.consentLabels.email, COMPLIANCE.consentLabels.sms, COMPLIANCE.smsOptOutLine];
    for (const t of LIBRARY.templates) strings.push(t.subject, t.emailBody, t.textBody);
    for (const s of strings) assert.ok(!OWN.test(s), s);
  });

  // ---------------------------------------------------------------- I

  section('I. inlined copies');

  test('build-check --check: engine.js, compliance.js, stats.js, templates.json inlined byte-identical; scripts parse; size < 400 KB', () => {
    const out = execFileSync(process.execPath, [path.join(__dirname, 'build-check.js'), '--check'], { encoding: 'utf8' });
    assert.ok(/BUILD-CHECK OK/.test(out), out);
    for (const p of ['engine.js', 'compliance.js', 'stats.js', 'templates.json']) assert.ok(new RegExp('ok\\s+' + p.replace('.', '\\.') + ' inlined byte-identical').test(out), p + ': ' + out);
  });

  // ---------------------------------------------------------------- J

  section('J. index.html static safety');

  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const appStart = html.lastIndexOf('<!-- END templates.json -->');
  const app = html.slice(appStart);

  test('no external http(s) src/href/url(); only sms:/mailto:/tel:/data:/relative; manifest is the one file link', () => {
    const refs = [...html.matchAll(/\b(src|href|action)\s*=\s*["']([^"']*)["']/gi)].map((m) => m[2]);
    const bad = refs.filter((u) => /^(https?:)?\/\//i.test(u) || /^javascript:/i.test(u));
    assert.deepStrictEqual(bad, [], 'external or javascript: references');
    assert.ok(!/@import|url\(\s*["']?https?:/i.test(html), 'CSS pulls nothing external');
    assert.ok(!/<script[^>]*\ssrc=/i.test(html), 'no <script src>');
    const linkHrefs = [...html.matchAll(/<link[^>]*href=["']([^"']+)["']/gi)].map((m) => m[1]);
    assert.deepStrictEqual(linkHrefs.filter((h) => !h.startsWith('data:')), ['manifest.json']);
    // dynamic fetch() targets: only Google identity/Firestore, Resend never from the browser, and same-origin functions
    const fetched = [...app.matchAll(/fetch\(\s*(['"`])([^'"`]+)\1/g)].map((m) => m[2]);
    for (const u of fetched) assert.ok(/^\/\.netlify\/functions\//.test(u) || /^https:\/\/(identitytoolkit|securetoken|firestore)\.googleapis\.com/.test(u), 'fetch target: ' + u);
    const literalHosts = [...app.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map((m) => m[1].toLowerCase());
    for (const h of new Set(literalHosts)) assert.ok(/googleapis\.com$|^www\.nhtsa\.gov$|netlify\.app$|firebase\.google\.com$|console\.firebase\.google\.com$|resend\.com$|app\.netlify\.com$/.test(h), 'unexpected host in app script: ' + h);
  });

  test('no eval(, new Function(, document.write, insertAdjacentHTML, outerHTML=, srcdoc, string setTimeout', () => {
    for (const re of [/\beval\s*\(/, /\bnew Function\s*\(/, /document\.write/, /insertAdjacentHTML/, /\.outerHTML\s*=/, /srcdoc/, /setTimeout\s*\(\s*['"`]/, /setInterval\s*\(\s*['"`]/]) {
      assert.ok(!re.test(html), 'found ' + re);
    }
  });

  test('innerHTML is assigned in exactly one place (setHtml) and it escapes non-raw values; html`` escapes every interpolation', () => {
    const sites = [...app.matchAll(/[^\n]*\.innerHTML\s*[+]?=[^\n]*/g)].map((m) => m[0].trim());
    assert.deepStrictEqual(sites, ['function setHtml(el, r) { el.innerHTML = isRaw(r) ? r.__raw : esc(r); }']);
    assert.ok(!/\.innerHTML\s*\+=/.test(app), 'no innerHTML +=');
    assert.ok(/function esc\(s\) \{\s*return String\(s == null \? '' : s\)\.replace\(\/\[&<>"'\]\/g/.test(app), 'esc() escapes & < > " \'');
    assert.ok(/function part\(v\) \{[\s\S]*?return esc\(v\);\s*\}/.test(app), 'part() escapes by default');
    assert.ok(/function html\(strings\) \{[\s\S]*?part\(arguments\[i\]\)/.test(app), 'html`` routes every interpolation through part()');
    // raw() is only ever applied to: a string literal, an array already passed through part()/esc(),
    // or the constant month/day <option> lists in monthDayOptions (no user data in that function).
    const rawLines = app.split('\n').filter((l) => /\braw\(/.test(l) && !/function raw\(/.test(l) && !/^\s*\/\//.test(l));
    assert.ok(rawLines.length >= 8, 'raw() call sites found: ' + rawLines.length);
    for (const l of rawLines) {
      const ok = /raw\('[^']*'\)/.test(l) || /\.map\(part\)/.test(l) || /esc\(/.test(l) || /raw\((m|d)\.join\(''\)\)/.test(l) || /^\s*return raw\(out\);\s*$/.test(l) // html``'s own return (out is built by part())
        || /raw\(TABS\.map\(/.test(l); // tab bar: built only from the constant TABS/TAB_ICONS tables and a count
      assert.ok(ok, 'raw() on unescaped data: ' + l.trim());
    }
    const tabs = app.match(/setHtml\(\$\('#tabs'\), raw\(TABS\.map\([\s\S]*?\.join\(''\)\)\);/);
    assert.ok(tabs && !/dataset|customer|db\.|\$\{|c\.name/.test(tabs[0]), 'tab bar builder uses only constants');
    assert.ok(/var TABS = \[\s*\['queue'/.test(app) && /var TAB_ICONS = \{/.test(app), 'TABS and TAB_ICONS are literal tables');
    const mdo = app.match(/function monthDayOptions\([\s\S]*?\n\}/);
    assert.ok(mdo && !/dataset|customer|db\.|\$\{/.test(mdo[0]), 'monthDayOptions builds only from constants');
  });

  // ---------------------------------------------------------------- K

  section('K. templates.json counts and tone mix (SPEC §5)');

  test('pool minimums met and every pool of 3+ has direct/softer/nepq', () => {
    const MIN = { THANKS: 4, THANKS_REPEAT: 2, CHECKIN: 6, REFERRAL: 6, ANNIVERSARY_REFERRAL: 3, BIRTHDAY: 3, REFERRAL_THANKS: 3, GOODBYE: 2, 'VALUE/fall': 4, 'VALUE/winter': 4, 'VALUE/spring': 4, 'VALUE/summer': 4, 'VALUE/any': 2 };
    const pools = {};
    for (const t of LIBRARY.templates) { const k = t.slot === 'VALUE' ? 'VALUE/' + t.season : t.slot; (pools[k] = pools[k] || []).push(t); }
    for (const [k, min] of Object.entries(MIN)) assert.ok((pools[k] || []).length >= min, k + ' has ' + (pools[k] || []).length + ' (min ' + min + ')');
    for (const [k, list] of Object.entries(pools)) {
      assert.ok(k in MIN, 'unexpected pool ' + k);
      const tones = new Set(list.map((t) => t.tone));
      if (['GOODBYE', 'THANKS_REPEAT'].includes(k)) assert.ok(tones.size >= 2, k + ' has two tones');
      else for (const tone of ['direct', 'softer', 'nepq']) assert.ok(tones.has(tone), k + ' missing ' + tone);
    }
    assert.strictEqual(LIBRARY.templates.length, 48);
    assert.strictEqual(new Set(LIBRARY.templates.map((t) => t.id)).size, 48, 'ids unique');
  });

  test('lint-templates.js passes (Agent 3 lint re-run)', () => {
    const out = execFileSync(process.execPath, [path.join(__dirname, 'lint-templates.js')], { encoding: 'utf8' });
    assert.ok(/PASS: all templates clean/.test(out), out.slice(-600));
  });

  console.log('\n' + passed + ' passed, ' + failed + ' failed, ' + (passed + failed) + ' total');
  if (failed) { console.log('FAILED:\n  ' + failures.join('\n  ')); process.exit(1); }
  console.log('AUDIT OK');
})().catch((e) => { console.error('AUDIT CRASHED: ' + (e && e.stack || e)); process.exit(1); });
