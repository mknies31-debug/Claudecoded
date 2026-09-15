// Tests for the Netlify functions: send.js, daily.js and lib/firestore.js.
// Run with:  node test/functions.test.js   (from the keep-in-touch folder)
// Zero dependencies. Network is mocked: global fetch is replaced before any
// function runs, so nothing here ever reaches Resend or Google.
// No env vars needed; the test sets its own.

'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const FN = path.join(ROOT, 'netlify', 'functions');

// ---------------------------------------------------------------------------
// Test env + fetch mock. Installed before requiring the functions.
// ---------------------------------------------------------------------------
process.env.KIT_SECRET = 'test-secret-value-1234';
process.env.RESEND_API_KEY = 're_test_key';
process.env.MAIL_FROM = 'Mick at Mosaic Autos <mick@example.com>';
process.env.MAIL_REPLY_TO = 'mick.replies@example.com';
process.env.SITE_URL = 'https://kit.example.netlify.app';

const fetchLog = [];
let fetchResponder = () => ({ status: 200, body: JSON.stringify({ id: 'resend_123' }) });
globalThis.fetch = async (url, init) => {
  fetchLog.push({ url: String(url), init: init || {} });
  const r = fetchResponder(String(url), init || {});
  return {
    ok: r.status >= 200 && r.status < 300,
    status: r.status,
    text: async () => r.body || '',
    json: async () => JSON.parse(r.body || 'null'),
  };
};

const send = require(path.join(FN, 'send.js'));
const daily = require(path.join(FN, 'daily.js'));
const fsx = require(path.join(FN, 'lib', 'firestore.js'));

// Tiny runner.
const results = [];
async function test(name, fn) {
  try { await fn(); results.push({ name, ok: true }); console.log('  ok   ' + name); }
  catch (e) { results.push({ name, ok: false, err: e }); console.log('  FAIL ' + name + '\n       ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n       ') : e)); }
}
const json = (r) => JSON.parse(r.body);
const post = (body, headers) => ({ httpMethod: 'POST', headers: headers || {}, body: body == null ? '' : (typeof body === 'string' ? body : JSON.stringify(body)) });
const GOOD = { 'x-kit-secret': process.env.KIT_SECRET };
const goodBody = { to: 'dan@example.com', toName: 'Dan Halvorson', subject: 'Deer season and your headlights', text: 'Hi Dan,\n\nQuick one. Are your headlights clear?\n\nMick\nMosaic Autos\n(507) 555-0000', customerId: 'abc123', touchId: 'touch456', unsubscribeUrl: 'https://kit.example.netlify.app/?u=tokentokentokentokentokentoken12' };

// ---------------------------------------------------------------------------
// Mocks for daily.js: an in-memory Firestore, a minimal engine, and the real
// compliance.js when present (else a stub). engine.js may not exist yet when
// this test is written; the mock implements just the contract surface used.
// ---------------------------------------------------------------------------
function memoryDb(seed) {
  const docs = new Map(Object.entries(seed || {}));
  const log = [];
  return {
    docs, log,
    async get(p) { return docs.has(p) ? JSON.parse(JSON.stringify(docs.get(p))) : null; },
    async set(p, d) { log.push(['set', p]); docs.set(p, JSON.parse(JSON.stringify(d))); return d; },
    async update(p, d) { log.push(['update', p]); docs.set(p, Object.assign({}, docs.get(p) || {}, d)); return docs.get(p); },
    async delete(p) { log.push(['delete', p]); docs.delete(p); return true; },
    async list(col) {
      const out = [];
      for (const [p, d] of docs) { const [c, id] = p.split('/'); if (c === col && id) out.push({ id, data: JSON.parse(JSON.stringify(d)) }); }
      return out;
    },
    async runQuery(col) { return this.list(col); },
  };
}

function mockKit(opts) {
  opts = opts || {};
  return {
    todayChicago: () => opts.today || '2026-09-15',
    nowChicagoHour: () => (opts.hour == null ? 9 : opts.hour),
    seasonFor: () => 'fall',
    nextTouch: (c, today) => {
      if (c.status === 'dnc') return null;
      const dueDate = c._due || today;
      return { n: c.nextTouchN || 0, dueDate, slot: c._slot || 'VALUE', carried: false, isDue: dueDate <= today && (!c.snoozedUntil || c.snoozedUntil <= today), isLate: dueDate < today, daysLate: 0, snoozed: !!c.snoozedUntil };
    },
    templatePool: (lib, overrides, slot, season) => (lib.templates || []).filter((t) => t.slot === slot && !((overrides || {})[t.id] || {}).retired),
    pickTemplate: (pool, used) => pool.find((t) => !(used || []).includes(t.id)) || pool[0],
    render: (tpl, c, settings, o) => ({ subject: tpl.subject, emailBody: tpl.emailBody, textBody: tpl.textBody, emailFull: tpl.emailBody + '\n\nMick\nMosaic Autos\n' + (settings.mickPhoneDisplay || '') + (o && o.footer ? '\n\n' + o.footer : ''), textFull: tpl.textBody }),
    applyEvent: (c, ev) => {
      const n = Object.assign({}, c);
      if (ev.type === 'sent') { n.nextTouchN = (ev.n || 0) + 1; n.lastSentDate = ev.sentDate; n.usedTemplateIds = (c.usedTemplateIds || []).concat([ev.templateId]); }
      if (ev.type === 'optOut') { n.status = 'dnc'; n.dnc = { at: ev.at, reason: ev.reason, channel: ev.channel }; }
      return n;
    },
  };
}

let COMPLIANCE;
try { COMPLIANCE = require(path.join(FN, 'lib', 'compliance.js')); }
catch (e) { COMPLIANCE = { emailFooter: (s, u) => '--\nMick, salesperson at Mosaic Autos. Unsubscribe: ' + u + '\n' + (s.businessAddress || ''), canEmail: (c) => c.status === 'active' && !!(c.emailConsent && c.emailConsent.given) && !!c.email }; }

const LIBRARY = { version: 1, templates: [
  { id: 'value-fall-01', slot: 'VALUE', season: 'fall', subject: 'Deer season and your headlights', emailBody: 'Deer are moving. Are your headlights clear?', textBody: 'Deer are moving. Headlights clear?' },
  { id: 'value-fall-02', slot: 'VALUE', season: 'fall', subject: 'Battery before the cold', emailBody: 'Cold is coming. Has the battery been tested?', textBody: 'Battery tested?' },
] };

const customer = (over) => Object.assign({
  name: 'Dan Halvorson', first: 'Dan', phone: '5075551234', email: 'dan@example.com',
  vehicle: { year: 2019, make: 'Chevrolet', model: 'Silverado', trim: '' }, vehicleLabel: '2019 Silverado',
  saleDate: '2026-06-01', status: 'active', emailConsent: { given: true, at: '2026-06-01T15:00:00.000Z', how: 'in person at sale' },
  smsConsent: { given: false, at: '', how: '' }, anchorDate: '2026-06-01', anchorTouchN: 0, nextTouchN: 1, slotOffset: 0,
  usedTemplateIds: [], unsubscribeToken: 'tok_' + 'a'.repeat(32), snoozedUntil: '', createdAt: '2026-06-01T15:00:00.000Z', updatedAt: '2026-06-01T15:00:00.000Z',
}, over || {});

const settingsDoc = { autoSendEmail: true, siteUrl: 'https://kit.example.netlify.app', businessAddress: '123 Main St, Zumbrota, MN 55992', mickPhoneDisplay: '(507) 555-0000', fromName: 'Mick at Mosaic Autos', fromEmail: 'mick@example.com', replyTo: 'mick.replies@example.com', minGapDays: 21 };

function dailyDeps(db, kitOpts, envExtra) {
  return {
    db, KIT: mockKit(kitOpts), COMPLIANCE, LIBRARY, fetch: globalThis.fetch, sleep: async () => {}, newId: () => 'touch_' + Math.random().toString(36).slice(2, 12),
    env: Object.assign({}, process.env, envExtra || {}),
  };
}

(async () => {
  console.log('send.js');

  await test('(a) 405 on GET', async () => {
    const r = await send.handler({ httpMethod: 'GET', headers: GOOD });
    assert.strictEqual(r.statusCode, 405);
  });
  await test('(a) 401 without secret', async () => {
    const r = await send.handler(post(goodBody, {}));
    assert.strictEqual(r.statusCode, 401);
    assert.ok(/secret/i.test(json(r).error));
  });
  await test('(a) 401 with wrong secret (same length)', async () => {
    const r = await send.handler(post(goodBody, { 'x-kit-secret': 'test-secret-value-1235' }));
    assert.strictEqual(r.statusCode, 401);
  });
  await test('(a) 401 with wrong secret (different length) and header case-insensitive', async () => {
    const r = await send.handler(post(goodBody, { 'X-Kit-Secret': 'nope' }));
    assert.strictEqual(r.statusCode, 401);
  });
  await test('(b) 400 on missing to', async () => {
    const b = Object.assign({}, goodBody); delete b.to;
    const r = await send.handler(post(b, GOOD));
    assert.strictEqual(r.statusCode, 400);
    assert.ok(/"to"/.test(json(r).error));
  });
  await test('(b) 400 on bad JSON and on missing text', async () => {
    assert.strictEqual((await send.handler(post('{not json', GOOD))).statusCode, 400);
    const b = Object.assign({}, goodBody, { text: '' });
    assert.strictEqual((await send.handler(post(b, GOOD))).statusCode, 400);
  });
  await test('(b) 413 on body over 20 KB', async () => {
    const b = Object.assign({}, goodBody, { text: 'x'.repeat(21 * 1024) });
    assert.strictEqual((await send.handler(post(b, GOOD))).statusCode, 413);
  });
  await test('(c) good request -> 200; payload has reply_to, List-Unsubscribe, no html', async () => {
    fetchLog.length = 0;
    const r = await send.handler(post(goodBody, GOOD));
    assert.strictEqual(r.statusCode, 200, r.body);
    assert.deepStrictEqual(json(r), { ok: true, id: 'resend_123' });
    assert.strictEqual(fetchLog.length, 1);
    assert.strictEqual(fetchLog[0].url, 'https://api.resend.com/emails');
    assert.strictEqual(fetchLog[0].init.headers.authorization, 'Bearer re_test_key');
    const p = JSON.parse(fetchLog[0].init.body);
    assert.strictEqual(p.reply_to, 'mick.replies@example.com');
    assert.strictEqual(p.headers['List-Unsubscribe'], '<' + goodBody.unsubscribeUrl + '>');
    assert.strictEqual(p.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
    assert.ok(!('html' in p), 'payload must not contain html');
    assert.strictEqual(p.text, goodBody.text);
    assert.deepStrictEqual(p.to, ['Dan Halvorson <dan@example.com>']);
    assert.deepStrictEqual(p.tags, [{ name: 'customerId', value: 'abc123' }, { name: 'touchId', value: 'touch456' }]);
  });
  await test('(c) HTML tags are stripped from text and subject', async () => {
    fetchLog.length = 0;
    const b = Object.assign({}, goodBody, { text: 'Hi <b>Dan</b>,<br>Are you set?', subject: '<i>Deer</i>\nseason' });
    const r = await send.handler(post(b, GOOD));
    assert.strictEqual(r.statusCode, 200);
    const p = JSON.parse(fetchLog[0].init.body);
    assert.strictEqual(p.text, 'Hi Dan,Are you set?');
    assert.strictEqual(p.subject, 'Deer season');
  });
  await test('500 with the Netlify menu path when RESEND_API_KEY is missing', async () => {
    const saved = process.env.RESEND_API_KEY; delete process.env.RESEND_API_KEY;
    const r = await send.handler(post(goodBody, GOOD));
    process.env.RESEND_API_KEY = saved;
    assert.strictEqual(r.statusCode, 500);
    assert.ok(/Environment variables/.test(json(r).error));
  });
  await test('502 when Resend rejects', async () => {
    fetchResponder = () => ({ status: 422, body: '{"message":"bad from"}' });
    const r = await send.handler(post(goodBody, GOOD));
    fetchResponder = () => ({ status: 200, body: JSON.stringify({ id: 'resend_123' }) });
    assert.strictEqual(r.statusCode, 502);
  });

  console.log('lib/firestore.js');

  await test('(d) encode/decode round-trips a nested object', async () => {
    const obj = {
      name: 'Dan', n: 3, negative: -7, big: 1234567890123, f: 1.5, tiny: 0.001, yes: true, no: false, nothing: null, empty: '',
      list: [1, 'two', 2.5, false, null, { deep: ['x', { deeper: 9 }] }],
      map: { a: 1, b: { c: 'see', d: [true] } },
      emptyList: [], emptyMap: {},
    };
    const enc = fsx.encode(obj);
    assert.strictEqual(enc.fields.n.integerValue, '3');
    assert.strictEqual(enc.fields.f.doubleValue, 1.5);
    assert.strictEqual(enc.fields.yes.booleanValue, true);
    assert.strictEqual(enc.fields.nothing.nullValue, null);
    assert.strictEqual(enc.fields.list.arrayValue.values[1].stringValue, 'two');
    assert.strictEqual(enc.fields.map.mapValue.fields.b.mapValue.fields.c.stringValue, 'see');
    const dec = fsx.decode({ name: 'projects/p/databases/(default)/documents/customers/abc', fields: enc.fields });
    assert.deepStrictEqual(dec, obj);
    // Survives a JSON round-trip (what actually goes over the wire).
    assert.deepStrictEqual(fsx.decode(JSON.parse(JSON.stringify(enc))), obj);
    assert.strictEqual(fsx.docId({ name: 'projects/p/databases/(default)/documents/customers/abc' }), 'abc');
    assert.deepStrictEqual(fsx.decode({ fields: { t: { timestampValue: '2026-09-15T14:03:00.000Z' } } }), { t: '2026-09-15T14:03:00.000Z' });
  });
  await test('(d) undefined values are dropped, Dates become ISO strings', async () => {
    const enc = fsx.encode({ a: undefined, d: new Date('2026-01-02T03:04:05.000Z') });
    assert.ok(!('a' in enc.fields));
    assert.strictEqual(enc.fields.d.stringValue, '2026-01-02T03:04:05.000Z');
  });
  await test('parseServiceAccount accepts raw JSON and base64', async () => {
    const sa = { client_email: 'x@y.iam.gserviceaccount.com', private_key: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n' };
    const raw = JSON.stringify(sa);
    assert.deepStrictEqual(fsx.parseServiceAccount(raw), sa);
    assert.deepStrictEqual(fsx.parseServiceAccount('  ' + raw + '\n'), sa);
    assert.deepStrictEqual(fsx.parseServiceAccount(Buffer.from(raw).toString('base64')), sa);
    assert.throws(() => fsx.parseServiceAccount('not json at all'), /neither valid JSON nor base64/);
    assert.throws(() => fsx.parseServiceAccount(''), /FIREBASE_SERVICE_ACCOUNT is not set/);
  });
  await test('client signs an RS256 JWT, caches the token, and encodes a runQuery', async () => {
    const { generateKeyPairSync, createVerify } = require('crypto');
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
    const sa = { client_email: 'svc@proj.iam.gserviceaccount.com', private_key: pem };
    const jwt = fsx.buildJwt(sa, 1700000000);
    const [h, c, s] = jwt.split('.');
    assert.deepStrictEqual(JSON.parse(Buffer.from(h, 'base64url')), { alg: 'RS256', typ: 'JWT' });
    const claims = JSON.parse(Buffer.from(c, 'base64url'));
    assert.strictEqual(claims.iss, sa.client_email);
    assert.strictEqual(claims.aud, 'https://oauth2.googleapis.com/token');
    assert.strictEqual(claims.exp - claims.iat, 3600);
    const v = createVerify('RSA-SHA256'); v.update(h + '.' + c);
    assert.ok(v.verify(publicKey, Buffer.from(s, 'base64url')));

    fetchLog.length = 0;
    fetchResponder = (url) => {
      if (url.startsWith('https://oauth2.googleapis.com/token')) return { status: 200, body: JSON.stringify({ access_token: 'ya29.test', expires_in: 3600 }) };
      if (url.endsWith(':runQuery')) return { status: 200, body: JSON.stringify([{ document: { name: 'projects/p/databases/(default)/documents/customers/c1', fields: { name: { stringValue: 'Dan' } } } }, { readTime: 'x' }]) };
      if (url.includes('/settings/main')) return { status: 200, body: JSON.stringify({ name: '.../settings/main', fields: { sendHour: { integerValue: '9' } } }) };
      if (url.includes('/missing/doc')) return { status: 404, body: '{"error":{"message":"not found"}}' };
      return { status: 200, body: '{}' };
    };
    const db = fsx.makeClient({ projectId: 'proj', serviceAccountB64: Buffer.from(JSON.stringify(sa)).toString('base64') });
    const rows = await db.runQuery('customers', [['status', 'EQUAL', 'active'], ['nextDue', 'LESS_THAN_OR_EQUAL', '2026-09-15']], { limit: 5 });
    assert.deepStrictEqual(rows, [{ id: 'c1', data: { name: 'Dan' } }]);
    const q = JSON.parse(fetchLog[fetchLog.length - 1].init.body).structuredQuery;
    assert.strictEqual(q.where.compositeFilter.filters.length, 2);
    assert.strictEqual(q.where.compositeFilter.filters[1].fieldFilter.op, 'LESS_THAN_OR_EQUAL');
    assert.strictEqual(q.limit, 5);
    assert.strictEqual(fetchLog[fetchLog.length - 1].init.headers.authorization, 'Bearer ya29.test');
    assert.deepStrictEqual(await db.get('settings/main'), { sendHour: 9 });
    assert.strictEqual(await db.get('missing/doc'), null);
    const tokenCalls = fetchLog.filter((f) => f.url.startsWith('https://oauth2.googleapis.com')).length;
    assert.strictEqual(tokenCalls, 1, 'token should be fetched once and cached');
    await db.update('customers/c1', { unreadReplies: 2, 'weird key': 1 });
    const upd = fetchLog[fetchLog.length - 1];
    assert.strictEqual(upd.init.method, 'PATCH');
    assert.ok(upd.url.includes('updateMask.fieldPaths=unreadReplies'));
    assert.ok(upd.url.includes(encodeURIComponent('`weird key`')));
    fetchResponder = () => ({ status: 200, body: JSON.stringify({ id: 'resend_123' }) });
  });

  console.log('daily.js');

  await test('exports the schedule', async () => {
    assert.deepStrictEqual(daily.config, { schedule: '0 14,15 * * *' });
  });
  await test('(e) early-exits at hour != 9 and still writes heartbeat (KIT.nowChicagoHour)', async () => {
    const db = memoryDb({ 'settings/main': settingsDoc, 'customers/c1': customer() });
    fetchLog.length = 0;
    const r = await daily.handler({ httpMethod: 'POST', headers: {}, body: '{"next_run":"2026-09-16T14:00:00Z"}' }, {}, dailyDeps(db, { hour: 10 }));
    assert.strictEqual(r.statusCode, 200);
    assert.strictEqual(json(r).ranSend, false);
    const hb = db.docs.get('heartbeat/daily');
    assert.ok(hb, 'heartbeat written');
    assert.strictEqual(hb.ranSend, false);
    assert.strictEqual(hb.lastRunDate, '2026-09-15');
    assert.strictEqual(fetchLog.length, 0, 'no email sent');
    assert.ok(!db.log.some(([, p]) => p.startsWith('touches/')));
  });
  await test('(e) KIT_FORCE_HOUR env override wins over the engine clock', async () => {
    const db = memoryDb({ 'settings/main': settingsDoc });
    const r = await daily.handler({ httpMethod: 'POST', headers: {}, body: '' }, {}, dailyDeps(db, { hour: 9 }, { KIT_FORCE_HOUR: '3' }));
    assert.strictEqual(json(r).ranSend, false);
    assert.ok(/hour was 3/.test(json(r).reason));
    assert.ok(db.docs.get('heartbeat/daily'));
  });
  await test('(f) ?force=1 with wrong secret -> 401, nothing written', async () => {
    const db = memoryDb({ 'settings/main': settingsDoc });
    const r = await daily.handler({ httpMethod: 'POST', headers: { 'x-kit-secret': 'wrong' }, queryStringParameters: { force: '1' }, body: '' }, {}, dailyDeps(db, { hour: 9 }));
    assert.strictEqual(r.statusCode, 401);
    assert.strictEqual(db.log.length, 0);
    const r2 = await daily.handler({ httpMethod: 'POST', headers: {}, queryStringParameters: { force: '1' }, body: '' }, {}, dailyDeps(db, { hour: 9 }));
    assert.strictEqual(r2.statusCode, 401);
  });
  await test('?force=1 with the right secret runs even at the wrong hour', async () => {
    const db = memoryDb({ 'settings/main': settingsDoc, 'customers/c1': customer() });
    fetchLog.length = 0;
    const r = await daily.handler({ httpMethod: 'POST', headers: GOOD, queryStringParameters: { force: '1' }, body: '' }, {}, dailyDeps(db, { hour: 2 }));
    assert.strictEqual(r.statusCode, 200, r.body);
    assert.strictEqual(json(r).sent, 1);
    assert.strictEqual(fetchLog.length, 1);
  });
  await test('full run: sends due customer, writes touch + customer + heartbeat, honors consent and dnc and snooze', async () => {
    const db = memoryDb({
      'settings/main': settingsDoc,
      'customers/due': customer(),
      'customers/noconsent': customer({ name: 'No Consent', emailConsent: { given: false, at: '', how: '' } }),
      'customers/noemail': customer({ name: 'No Email', email: '' }),
      'customers/dnc': customer({ name: 'Do Not', status: 'dnc' }),
      'customers/snoozed': customer({ name: 'Snoozed', snoozedUntil: '2026-09-20' }),
      'customers/future': customer({ name: 'Future', _due: '2026-10-01' }),
      'templates/value-fall-01': { retired: true },
    });
    fetchLog.length = 0;
    const r = await daily.handler({ httpMethod: 'POST', headers: {}, body: '' }, {}, dailyDeps(db, { hour: 9 }));
    assert.strictEqual(r.statusCode, 200, r.body);
    const out = json(r);
    assert.deepStrictEqual(out.errors, []);
    assert.strictEqual(out.sent, 1);
    assert.strictEqual(out.skipped, 2, 'no-consent and no-email are skipped');
    assert.strictEqual(fetchLog.length, 1);
    const p = JSON.parse(fetchLog[0].init.body);
    assert.deepStrictEqual(p.to, ['Dan Halvorson <dan@example.com>']);
    assert.strictEqual(p.subject, 'Battery before the cold', 'retired override respected');
    assert.ok(!('html' in p));
    assert.ok(p.text.includes('Mosaic Autos'));
    assert.ok(p.text.includes('/?u=tok_' + 'a'.repeat(32)), 'unsubscribe url in footer');
    assert.ok(!/North Star/i.test(p.text));
    assert.strictEqual(p.headers['List-Unsubscribe'], '<https://kit.example.netlify.app/?u=tok_' + 'a'.repeat(32) + '>');
    const touches = [...db.docs.entries()].filter(([k]) => k.startsWith('touches/'));
    assert.strictEqual(touches.length, 1);
    const t = touches[0][1];
    assert.strictEqual(t.status, 'sent');
    assert.strictEqual(t.sentBy, 'scheduled');
    assert.deepStrictEqual(t.channels, ['email']);
    assert.strictEqual(t.customerId, 'due');
    assert.strictEqual(t.templateId, 'value-fall-02');
    assert.strictEqual(t.providerId, 'resend_123');
    const c = db.docs.get('customers/due');
    assert.strictEqual(c.nextTouchN, 2);
    assert.deepStrictEqual(c.usedTemplateIds, ['value-fall-02']);
    assert.strictEqual(c.lastSentDate, '2026-09-15');
    const hb = db.docs.get('heartbeat/daily');
    assert.strictEqual(hb.ranSend, true);
    assert.strictEqual(hb.sent, 1);
    assert.ok(typeof hb.durationMs === 'number');
  });
  await test('opt-outs are processed before sending: customer flipped to dnc, optout deleted, no email', async () => {
    const db = memoryDb({
      'settings/main': settingsDoc,
      'customers/due': customer(),
      ['optouts/tok_' + 'a'.repeat(32)]: { at: '2026-09-15T03:00:00.000Z', source: 'link' },
      'optouts/junktokenjunktokenjunk': { at: 'x', source: 'link' },
    });
    fetchLog.length = 0;
    const r = await daily.handler({ httpMethod: 'POST', headers: {}, body: '' }, {}, dailyDeps(db, { hour: 9 }));
    assert.strictEqual(r.statusCode, 200);
    assert.strictEqual(fetchLog.length, 0, 'no email to someone who just unsubscribed');
    const c = db.docs.get('customers/due');
    assert.strictEqual(c.status, 'dnc');
    assert.deepStrictEqual(c.dnc, { at: '2026-09-15T03:00:00.000Z', reason: 'unsubscribe link', channel: 'email' });
    assert.ok(![...db.docs.keys()].some((k) => k.startsWith('optouts/')), 'both optout docs deleted');
  });
  await test('autoSendEmail off: no sends, heartbeat still written', async () => {
    const db = memoryDb({ 'settings/main': Object.assign({}, settingsDoc, { autoSendEmail: false }), 'customers/due': customer() });
    fetchLog.length = 0;
    const r = await daily.handler({ httpMethod: 'POST', headers: {}, body: '' }, {}, dailyDeps(db, { hour: 9 }));
    assert.strictEqual(json(r).ranSend, false);
    assert.strictEqual(fetchLog.length, 0);
    assert.ok(/off in Settings/.test(db.docs.get('heartbeat/daily').note));
  });
  await test('per-customer failure does not stop the run', async () => {
    const db = memoryDb({ 'settings/main': settingsDoc, 'customers/a': customer({ name: 'Aaron' }), 'customers/b': customer({ name: 'Bea', email: 'bea@example.com' }) });
    let n = 0;
    fetchResponder = () => (++n === 1 ? { status: 500, body: 'boom' } : { status: 200, body: JSON.stringify({ id: 'ok2' }) });
    const r = await daily.handler({ httpMethod: 'POST', headers: {}, body: '' }, {}, dailyDeps(db, { hour: 9 }));
    fetchResponder = () => ({ status: 200, body: JSON.stringify({ id: 'resend_123' }) });
    const out = json(r);
    assert.strictEqual(out.sent, 1);
    assert.strictEqual(out.errors.length, 1);
    assert.ok(/Aaron/.test(out.errors[0]));
  });
  await test('send cap: stops at KIT_MAX_SENDS and records it in heartbeat.errors', async () => {
    const seed = { 'settings/main': settingsDoc };
    for (let i = 0; i < 5; i++) seed['customers/c' + i] = customer({ name: 'Cust ' + i, email: 'c' + i + '@example.com' });
    const db = memoryDb(seed);
    fetchLog.length = 0;
    const r = await daily.handler({ httpMethod: 'POST', headers: {}, body: '' }, {}, dailyDeps(db, { hour: 9 }, { KIT_MAX_SENDS: '3' }));
    const out = json(r);
    assert.strictEqual(out.sent, 3);
    assert.strictEqual(fetchLog.length, 3);
    assert.ok(out.errors.some((e) => /send cap of 3 reached; 2 customers still due/.test(e)), out.errors.join(' | '));
    assert.ok(db.docs.get('heartbeat/daily').errors.some((e) => /send cap/.test(e)));
  });
  await test('never sends SMS: no sms in channels, no phone touched', async () => {
    const db = memoryDb({ 'settings/main': Object.assign({}, settingsDoc, { autoSendSms: true }), 'customers/due': customer({ smsConsent: { given: true, at: 'x', how: 'text' } }) });
    fetchLog.length = 0;
    await daily.handler({ httpMethod: 'POST', headers: {}, body: '' }, {}, dailyDeps(db, { hour: 9 }));
    const touches = [...db.docs.entries()].filter(([k]) => k.startsWith('touches/'));
    assert.strictEqual(touches.length, 1);
    assert.deepStrictEqual(touches[0][1].channels, ['email']);
    assert.strictEqual(fetchLog.length, 1);
    assert.ok(fetchLog.every((f) => f.url === 'https://api.resend.com/emails'));
  });
  await test('missing service account: clear 500, nothing sent', async () => {
    const deps = dailyDeps(null, { hour: 9 }, { FIREBASE_SERVICE_ACCOUNT: '', FIREBASE_PROJECT_ID: '' });
    delete deps.db;
    deps.makeDb = () => { throw new Error('FIREBASE_PROJECT_ID is not set. Netlify → Site configuration → Environment variables.'); };
    const r = await daily.handler({ httpMethod: 'POST', headers: {}, body: '' }, {}, deps);
    assert.strictEqual(r.statusCode, 500);
    assert.ok(/Tier 2 is not configured/.test(json(r).error));
  });

  console.log('static checks');

  await test('netlify.toml has the schedule, esbuild, included_files and headers', async () => {
    const toml = fs.readFileSync(path.join(ROOT, 'netlify.toml'), 'utf8');
    assert.ok(/schedule\s*=\s*"0 14,15 \* \* \*"/.test(toml));
    assert.ok(/node_bundler\s*=\s*"esbuild"/.test(toml));
    assert.ok(/included_files\s*=\s*\["templates\.json"\]/.test(toml));
    assert.ok(/X-Frame-Options\s*=\s*"DENY"/.test(toml));
    assert.ok(/Referrer-Policy\s*=\s*"no-referrer"/.test(toml));
    assert.ok(/connect-src 'self' https:\/\/identitytoolkit\.googleapis\.com https:\/\/securetoken\.googleapis\.com https:\/\/firestore\.googleapis\.com/.test(toml));
  });
  await test('firestore.rules: isMick gate, optouts exception with strict shape, UID placeholder', async () => {
    const rules = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');
    assert.ok(/function isMick\(\)/.test(rules));
    assert.ok(/request\.auth\.uid == "PASTE_YOUR_UID_HERE"/.test(rules));
    assert.ok(/match \/optouts\/\{token\}/.test(rules));
    assert.ok(/hasOnly\(\['at', 'source'\]\)/.test(rules));
    assert.ok(/source == 'link'/.test(rules));
    assert.ok(/token\.size\(\) >= 20/.test(rules) && /token\.size\(\) <= 64/.test(rules));
    assert.ok(/match \/\{document=\*\*\}[\s\S]*allow read, write: if isMick\(\);/.test(rules));
    // No other "allow ... if true" anywhere.
    assert.ok(!/allow [a-z, ]+: if true/.test(rules));
  });

  const failed = results.filter((r) => !r.ok).length;
  console.log('\n' + (results.length - failed) + ' passed, ' + failed + ' failed, ' + results.length + ' total');
  process.exit(failed ? 1 : 0);
})();
