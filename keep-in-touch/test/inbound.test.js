'use strict';
// node test/inbound.test.js — zero deps. Everything inbound.js needs is injected
// through makeHandler(deps), so this passes even before engine.js / compliance.js /
// firestore.js / templates.json exist.
const assert = require('assert');
const crypto = require('crypto');
const path = require('path');
const { makeHandler, _internal } = require(path.join(__dirname, '..', 'netlify', 'functions', 'inbound.js'));
const STATS = require(path.join(__dirname, '..', 'netlify', 'functions', 'lib', 'stats.js'));

let passed = 0;
const queue = [];
function test(name, fn) { queue.push({ name, fn }); }

// ---------------------------------------------------------------- mocks

const SECRET_BYTES = crypto.randomBytes(24);
const WEBHOOK_SECRET = 'whsec_' + SECRET_BYTES.toString('base64');
const KIT_SECRET = 'kit-test-secret-123';
const NOW = Date.parse('2026-09-15T15:30:00.000Z'); // 10:30 AM Chicago

function sign(rawBody, { secret = WEBHOOK_SECRET, id = 'msg_' + crypto.randomBytes(6).toString('hex'), ts = Math.floor(NOW / 1000) } = {}) {
  const key = Buffer.from(secret.slice('whsec_'.length), 'base64');
  const sig = crypto.createHmac('sha256', key).update(`${id}.${ts}.${rawBody}`).digest('base64');
  return { 'svix-id': id, 'svix-timestamp': String(ts), 'svix-signature': 'v1,' + sig };
}

const OPT_OUT_RE = /\b(stop|unsubscribe|opt[ -]?out|remove me|quit|cancel|end)\b/i;
const KIT = {
  todayChicago: () => '2026-09-15',
  isOptOutText: (s) => OPT_OUT_RE.test(String(s || '').slice(0, 80)),
  applyEvent(customer, ev) {
    const c = Object.assign({}, customer);
    if (ev.type === 'reply') { c.anchorDate = ev.date; c.anchorTouchN = Math.max(0, (c.nextTouchN || 0) - 1); c.snoozedUntil = ''; c.lastReplyDate = ev.date; }
    if (ev.type === 'optOut') { c.status = 'dnc'; c.dnc = { at: ev.at, reason: ev.reason, channel: ev.channel }; }
    return c;
  },
  templatePool: (library, overrides, slot) => library.filter((t) => t.slot === slot && !(overrides[t.id] && overrides[t.id].retired)),
  pickTemplate: (pool) => pool[0],
  render: (tpl, customer, settings, opts) => {
    const body = tpl.emailBody.replace('{first}', customer.first || customer.name);
    return { subject: tpl.subject, emailBody: body, textBody: tpl.textBody, emailFull: body + '\n\nMick\nMosaic Autos\n' + settings.mickPhoneDisplay + (opts.footer ? '\n\n' + opts.footer : ''), textFull: tpl.textBody };
  }
};
const COMPLIANCE = { emailFooter: (settings, url) => `You are getting this because you bought a vehicle from Mick, a salesperson at Mosaic Autos.\nUnsubscribe: ${url}\n${settings.businessAddress}` };
const templates = { templates: [
  { id: 'goodbye-01', slot: 'GOODBYE', season: 'any', subject: 'Got it', emailBody: 'Understood, {first}. If you ever need a hand with a vehicle, my number still works.', textBody: 'Got it. My number still works if you ever need it.' },
  { id: 'value-fall-01', slot: 'VALUE', season: 'fall', subject: 'Deer season', emailBody: 'x', textBody: 'x' }
] };

function makeDb(seed) {
  const docs = Object.assign({}, seed);
  const calls = [];
  const db = {
    docs, calls,
    async get(p) { calls.push(['get', p]); if (!(p in docs)) throw new Error('not found: ' + p); return Object.assign({}, docs[p]); },
    async set(p, d) { calls.push(['set', p]); docs[p] = Object.assign({}, d); },
    async update(p, d) { calls.push(['update', p]); docs[p] = Object.assign({}, docs[p] || {}, d); },
    async delete(p) { calls.push(['delete', p]); delete docs[p]; },
    async list(col) { calls.push(['list', col]); return Object.keys(docs).filter((k) => k.startsWith(col + '/') && k.split('/').length === 2).map((k) => Object.assign({ id: k.split('/')[1] }, docs[k])); },
    async runQuery(col, where) {
      calls.push(['runQuery', col, where]);
      return Object.keys(docs).filter((k) => k.startsWith(col + '/'))
        .map((k) => Object.assign({ id: k.split('/')[1] }, docs[k]))
        .filter((d) => where.every(([f, op, v]) => op === 'EQUAL' && d[f] === v));
    }
  };
  return db;
}

function makeFetch(received) {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({ url, opts: opts || {} });
    if (/\/emails\/receiving\//.test(url)) {
      const id = decodeURIComponent(url.split('/emails/receiving/')[1]);
      const r = received[id];
      if (!r) return { ok: false, status: 404, json: async () => ({ message: 'not found' }) };
      return { ok: true, status: 200, json: async () => r };
    }
    if (/\/emails$/.test(url) && opts.method === 'POST') return { ok: true, status: 200, json: async () => ({ id: 're_goodbye_1' }) };
    return { ok: false, status: 500, json: async () => ({}) };
  };
  fn.calls = calls;
  return fn;
}

const DAN = { name: 'Dan Halvorson', first: 'Dan', email: 'dan@example.com', phone: '5075551234', status: 'active', nextTouchN: 5, anchorDate: '2025-06-10', anchorTouchN: 0, unreadReplies: 2, usedTemplateIds: [], unsubscribeToken: 'tok_abc', emailConsent: { given: true, at: '2025-06-10T00:00:00.000Z', how: 'in person at sale' } };
const SEED = {
  'settings/main': { mickPhoneDisplay: '(507) 555-0000', businessAddress: '123 Main St, Zumbrota, MN 55992', siteUrl: 'https://kit.example.netlify.app', fromEmail: 'mick@example.com', fromName: 'Mick at Mosaic Autos', replyTo: 'nsreplies@gmail.com' },
  'customers/c_dan': DAN,
  'touches/t_dan_3': { customerId: 'c_dan', touchN: 3, slot: 'VALUE', templateId: 'value-spring-01', status: 'sent', sentDate: '2026-03-07' },
  'touches/t_dan_4': { customerId: 'c_dan', touchN: 4, slot: 'REFERRAL', templateId: 'referral-01', status: 'sent', sentDate: '2026-09-01' },
  'touches/t_kay_9': { customerId: 'c_kay', touchN: 9, slot: 'VALUE', templateId: 'value-fall-01', status: 'sent', sentDate: '2026-09-14' }
};

function envelope(over = {}) {
  return JSON.stringify({
    type: 'email.received', created_at: '2026-09-15T15:29:00.000Z',
    data: Object.assign({ email_id: 'em_001', created_at: '2026-09-15T15:29:00.000Z', from: 'Dan Halvorson <Dan@Example.com>', to: ['inbox@kit.example.com'], subject: 'Re: Deer season and your headlights', message_id: '<abc@example.com>', attachments: [] }, over)
  });
}

function setup({ received, seed, env } = {}) {
  const db = makeDb(seed || SEED);
  const fetchFn = makeFetch(received || { em_001: { id: 'em_001', from: 'Dan Halvorson <Dan@Example.com>', subject: 'Re: Deer season and your headlights', text: 'Yep, deer are thick out here.\n\nOn Mon, Sep 14, 2026 Mick wrote:\n> Deer season is close.', html: null } });
  const logs = { warn: [], error: [] };
  const handler = makeHandler({
    env: Object.assign({ KIT_SECRET, RESEND_WEBHOOK_SECRET: WEBHOOK_SECRET, RESEND_API_KEY: 're_test', FIREBASE_PROJECT_ID: 'proj', FIREBASE_SERVICE_ACCOUNT: 'e30=', MAIL_FROM: 'Mick at Mosaic Autos <mick@example.com>', MAIL_REPLY_TO: 'nsreplies@gmail.com', SITE_URL: 'https://kit.example.netlify.app' }, env || {}),
    fetch: fetchFn, now: () => NOW, KIT, COMPLIANCE, STATS, templates,
    makeClient: () => db,
    console: { log() {}, warn: (m) => logs.warn.push(m), error: (m) => logs.error.push(m) }
  });
  return { handler, db, fetchFn, logs };
}

function post(body, headers) { return { httpMethod: 'POST', headers: Object.assign({ 'content-type': 'application/json' }, headers), body, isBase64Encoded: false }; }

// ---------------------------------------------------------------- tests

test('405 on GET', async () => {
  const { handler } = setup();
  const r = await handler({ httpMethod: 'GET', headers: {}, body: '' });
  assert.strictEqual(r.statusCode, 405);
});

test('401 with no signature and no secret', async () => {
  const { handler, db } = setup();
  const r = await handler(post(envelope(), {}));
  assert.strictEqual(r.statusCode, 401);
  assert.strictEqual(db.calls.length, 0);
});

test('401 with a bad Svix signature (wrong key)', async () => {
  const { handler } = setup();
  const body = envelope();
  const r = await handler(post(body, sign(body, { secret: 'whsec_' + crypto.randomBytes(24).toString('base64') })));
  assert.strictEqual(r.statusCode, 401);
});

test('401 when the signed body differs from the delivered body', async () => {
  const { handler } = setup();
  const r = await handler(post(envelope({ subject: 'tampered' }), sign(envelope())));
  assert.strictEqual(r.statusCode, 401);
});

test('401 when the Svix timestamp is more than 5 minutes off', async () => {
  const { handler } = setup();
  const body = envelope();
  const r = await handler(post(body, sign(body, { ts: Math.floor(NOW / 1000) - 301 })));
  assert.strictEqual(r.statusCode, 401);
  const r2 = await handler(post(body, sign(body, { ts: Math.floor(NOW / 1000) + 299 })));
  assert.strictEqual(r2.statusCode, 200);
});

test('401 with a wrong x-kit-secret and no svix headers', async () => {
  const { handler } = setup();
  const r = await handler(post(envelope(), { 'x-kit-secret': 'nope' }));
  assert.strictEqual(r.statusCode, 401);
});

test('200 with a valid Svix signature; accepts multiple v1 entries and base64 bodies', async () => {
  const { handler } = setup();
  const body = envelope();
  const h = sign(body);
  h['svix-signature'] = 'v1,AAAA ' + h['svix-signature'] + ' v1,BBBB';
  const r = await handler({ httpMethod: 'POST', headers: h, body: Buffer.from(body).toString('base64'), isBase64Encoded: true });
  assert.strictEqual(r.statusCode, 200);
  assert.strictEqual(JSON.parse(r.body).ok, true);
});

test('matched customer: body fetched from Resend, reply doc written, linked to latest touch <=45d, unreadReplies+1, clock reset', async () => {
  const { handler, db, fetchFn } = setup();
  const body = envelope();
  const r = await handler(post(body, sign(body)));
  assert.strictEqual(r.statusCode, 200);
  const res = JSON.parse(r.body);
  assert.strictEqual(res.matched, true);
  assert.strictEqual(res.optOut, false);
  assert.strictEqual(res.goodbyeSent, false);
  // fetched the body with the API key
  const get = fetchFn.calls.find((c) => /\/emails\/receiving\/em_001$/.test(c.url));
  assert.ok(get, 'retrieve endpoint called');
  assert.strictEqual(get.opts.headers.Authorization, 'Bearer re_test');
  // no goodbye
  assert.ok(!fetchFn.calls.some((c) => c.opts.method === 'POST'));
  // reply doc
  const reply = db.docs['replies/in_em_001'];
  assert.ok(reply, 'reply doc written');
  assert.strictEqual(reply.customerId, 'c_dan');
  assert.strictEqual(reply.customerName, 'Dan Halvorson');
  assert.strictEqual(reply.touchId, 't_dan_4');
  assert.strictEqual(reply.slot, 'REFERRAL');
  assert.strictEqual(reply.templateId, 'referral-01');
  assert.strictEqual(reply.channel, 'email');
  assert.strictEqual(reply.source, 'webhook');
  assert.strictEqual(reply.receivedDate, '2026-09-15');
  assert.strictEqual(reply.snippet, 'Yep, deer are thick out here.');
  assert.strictEqual(reply.isOptOut, false);
  assert.strictEqual(reply.processed, true);
  assert.strictEqual(reply.error, '');
  // customer
  const c = db.docs['customers/c_dan'];
  assert.strictEqual(c.unreadReplies, 3);
  assert.strictEqual(c.anchorDate, '2026-09-15');
  assert.strictEqual(c.anchorTouchN, 4);
  assert.strictEqual(c.lastReplyAt, '2026-09-15T15:29:00.000Z');
  assert.strictEqual(c.status, 'active');
  assert.ok(!('id' in c), 'id not written into the doc');
});

test('reply older than 45 days since the last touch is unattributed but still logged', async () => {
  const seed = Object.assign({}, SEED); delete seed['touches/t_dan_4'];
  const { handler, db } = setup({ seed });
  const body = envelope();
  await handler(post(body, sign(body)));
  const reply = db.docs['replies/in_em_001'];
  assert.strictEqual(reply.customerId, 'c_dan');
  assert.strictEqual(reply.touchId, '');
  assert.strictEqual(db.docs['customers/c_dan'].unreadReplies, 3);
});

test('opt-out subject "STOP" flips status to dnc and sends exactly one GOODBYE', async () => {
  const { handler, db, fetchFn } = setup({ received: { em_001: { text: 'STOP', html: null } } });
  const body = envelope({ subject: 'STOP' });
  const r = await handler(post(body, sign(body)));
  assert.strictEqual(r.statusCode, 200);
  const res = JSON.parse(r.body);
  assert.strictEqual(res.ok, true, r.body);
  assert.strictEqual(res.optOut, true);
  assert.strictEqual(res.goodbyeSent, true);
  const c = db.docs['customers/c_dan'];
  assert.strictEqual(c.status, 'dnc');
  assert.deepStrictEqual(c.dnc, { at: '2026-09-15T15:30:00.000Z', reason: 'STOP reply', channel: 'email' });
  assert.strictEqual(c.unreadReplies, 3);
  const sends = fetchFn.calls.filter((x) => x.opts.method === 'POST');
  assert.strictEqual(sends.length, 1);
  const sent = JSON.parse(sends[0].opts.body);
  assert.deepStrictEqual(sent.to, ['dan@example.com']);
  assert.strictEqual(sent.from, 'Mick at Mosaic Autos <mick@example.com>');
  assert.strictEqual(sent.reply_to, 'nsreplies@gmail.com');
  assert.strictEqual(sent.subject, 'Got it');
  assert.ok(sent.text.startsWith('Understood, Dan.'));
  assert.ok(sent.text.includes('Unsubscribe: https://kit.example.netlify.app/?u=tok_abc'));
  assert.ok(sent.text.includes('salesperson at Mosaic Autos'));
  assert.ok(!sent.html);
  assert.strictEqual(sent.headers['List-Unsubscribe'], '<https://kit.example.netlify.app/?u=tok_abc>');
  const reply = db.docs['replies/in_em_001'];
  assert.strictEqual(reply.isOptOut, true);
  assert.strictEqual(reply.processed, true);
  // goodbye logged on the timeline as a touch
  const goodbye = Object.keys(db.docs).filter((k) => k.startsWith('touches/')).map((k) => db.docs[k]).find((t) => t.slot === 'GOODBYE');
  assert.ok(goodbye, 'GOODBYE touch logged');
  assert.strictEqual(goodbye.providerId, 're_goodbye_1');
  assert.strictEqual(goodbye.customerId, 'c_dan');
});

test('opt-out detected from the first line of the body (subject is normal)', async () => {
  const { handler, db, fetchFn } = setup({ received: { em_001: { text: 'Please unsubscribe me\n\nthanks though', html: null } } });
  const body = envelope();
  await handler(post(body, sign(body)));
  assert.strictEqual(db.docs['customers/c_dan'].status, 'dnc');
  assert.strictEqual(fetchFn.calls.filter((x) => x.opts.method === 'POST').length, 1);
});

test('the word "stop" only in a quoted line does not opt out', async () => {
  const { handler, db } = setup({ received: { em_001: { text: 'Sounds good\n> reply STOP to opt out', html: null } } });
  const body = envelope();
  await handler(post(body, sign(body)));
  assert.strictEqual(db.docs['customers/c_dan'].status, 'active');
});

test('duplicate delivery of the same email_id is acknowledged and not re-applied', async () => {
  const { handler, db, fetchFn } = setup({ received: { em_001: { text: 'STOP', html: null } } });
  const body = envelope({ subject: 'STOP' });
  await handler(post(body, sign(body)));
  const r2 = await handler(post(body, sign(body)));
  assert.strictEqual(r2.statusCode, 200);
  assert.strictEqual(JSON.parse(r2.body).duplicate, true);
  assert.strictEqual(db.docs['customers/c_dan'].unreadReplies, 3);
  assert.strictEqual(fetchFn.calls.filter((x) => x.opts.method === 'POST').length, 1);
});

test('unknown sender writes a reply with empty customerId; no customer touched', async () => {
  const { handler, db, fetchFn } = setup({ received: { em_001: { text: 'Hi, wrong number', html: null } } });
  const body = envelope({ from: 'stranger@nowhere.org' });
  const r = await handler(post(body, sign(body)));
  assert.strictEqual(r.statusCode, 200);
  assert.strictEqual(JSON.parse(r.body).matched, false);
  const reply = db.docs['replies/in_em_001'];
  assert.strictEqual(reply.customerId, '');
  assert.strictEqual(reply.from, 'stranger@nowhere.org');
  assert.strictEqual(reply.snippet, 'Hi, wrong number');
  assert.strictEqual(reply.processed, false);
  assert.strictEqual(db.docs['customers/c_dan'].unreadReplies, 2);
  assert.ok(!fetchFn.calls.some((c) => c.opts.method === 'POST'));
});

test('x-kit-secret manual forward with a bare {from, subject, text} body (no Resend fetch)', async () => {
  const { handler, db, fetchFn } = setup();
  const r = await handler(post(JSON.stringify({ from: 'dan@example.com', subject: 'Re: Deer', text: 'Sure thing\n\n-----Original Message-----\nFrom: Mick' }), { 'x-kit-secret': KIT_SECRET }));
  assert.strictEqual(r.statusCode, 200);
  assert.strictEqual(fetchFn.calls.length, 0);
  const key = Object.keys(db.docs).find((k) => k.startsWith('replies/'));
  assert.ok(key);
  assert.strictEqual(db.docs[key].source, 'manual');
  assert.strictEqual(db.docs[key].snippet, 'Sure thing');
  assert.strictEqual(db.docs[key].receivedDate, '2026-09-15');
  assert.strictEqual(db.docs['customers/c_dan'].unreadReplies, 3);
});

test('non email.received events are acknowledged and ignored', async () => {
  const { handler, db } = setup();
  const body = JSON.stringify({ type: 'email.delivered', created_at: '2026-09-15T15:00:00.000Z', data: { email_id: 'x' } });
  const r = await handler(post(body, sign(body)));
  assert.strictEqual(r.statusCode, 200);
  assert.strictEqual(JSON.parse(r.body).ignored, 'email.delivered');
  assert.ok(!Object.keys(db.docs).some((k) => k.startsWith('replies/')));
});

test('body fetch failure is captured in the reply doc error, still 200, still logged', async () => {
  const { handler, db, logs } = setup({ received: {} });
  const body = envelope();
  const r = await handler(post(body, sign(body)));
  assert.strictEqual(r.statusCode, 200);
  const reply = db.docs['replies/in_em_001'];
  assert.strictEqual(reply.customerId, 'c_dan');
  assert.ok(/fetch body/.test(reply.error));
  assert.ok(logs.error.length >= 1);
  assert.strictEqual(db.docs['customers/c_dan'].unreadReplies, 3);
});

test('payload that already carries data.text is used without a fetch; html-only falls back to stripped html', async () => {
  const a = setup();
  const body = envelope({ text: 'Inline text here' });
  await a.handler(post(body, sign(body)));
  assert.strictEqual(a.fetchFn.calls.length, 0);
  assert.strictEqual(a.db.docs['replies/in_em_001'].snippet, 'Inline text here');
  const b = setup({ received: { em_001: { text: null, html: '<div>Yes<br>we are</div><blockquote>old</blockquote>' } } });
  const body2 = envelope();
  await b.handler(post(body2, sign(body2)));
  assert.strictEqual(b.db.docs['replies/in_em_001'].snippet, 'Yes\nwe are\nold');
});

test('500 with a clear message when a lib is missing (after auth passes)', async () => {
  const db = makeDb(SEED);
  const handler = makeHandler({ env: { KIT_SECRET, FIREBASE_PROJECT_ID: 'p', FIREBASE_SERVICE_ACCOUNT: 'x' }, fetch: async () => ({}), KIT, COMPLIANCE: null, STATS, templates, makeClient: () => db, console: { log() {}, warn() {}, error() {} } });
  const r = await handler(post(envelope(), { 'x-kit-secret': KIT_SECRET }));
  if (r.statusCode === 500) assert.ok(/missing lib/.test(JSON.parse(r.body).error));
  else assert.strictEqual(r.statusCode, 200); // real compliance.js was present on disk and loaded lazily
});

test('500 when Firebase env is missing (after auth passes)', async () => {
  const { handler } = setup({ env: { FIREBASE_SERVICE_ACCOUNT: '' } });
  const body = envelope();
  const r = await handler(post(body, sign(body)));
  assert.strictEqual(r.statusCode, 500);
  assert.ok(/FIREBASE/.test(JSON.parse(r.body).error));
});

test('stripQuoted: drops > lines, cuts at "On ... wrote:" and Original Message, caps at 1000', () => {
  const s = _internal.stripQuoted;
  assert.strictEqual(s('Yes\r\n\r\n> a\r\n> b\r\nOn Tue, Sep 1, 2026 at 9:00 AM Mick <m@x.com> wrote:\r\n> hi'), 'Yes');
  assert.strictEqual(s('Sure\n-----Original Message-----\nFrom: x'), 'Sure');
  assert.strictEqual(s('line one\n> quoted\nline two'), 'line one\nline two');
  assert.strictEqual(s('x'.repeat(1500)).length, 1000);
  assert.strictEqual(s(''), '');
  assert.strictEqual(s(null), '');
});

test('parseAddress: display names, angle brackets, arrays, objects, case', () => {
  const p = _internal.parseAddress;
  assert.strictEqual(p('Dan Halvorson <Dan@Example.com>'), 'dan@example.com');
  assert.strictEqual(p('"Halvorson, Dan" <dan@example.com>'), 'dan@example.com');
  assert.strictEqual(p('DAN@EXAMPLE.COM'), 'dan@example.com');
  assert.strictEqual(p(['a@b.co']), 'a@b.co');
  assert.strictEqual(p({ email: 'a@b.co' }), 'a@b.co');
  assert.strictEqual(p(''), '');
  assert.strictEqual(p('no address here'), '');
});

// ---------------------------------------------------------------- runner
(async () => {
  console.log('inbound.test.js');
  for (const t of queue) {
    try { await t.fn(); passed++; console.log('  ok   ' + t.name); }
    catch (e) { console.log('  FAIL ' + t.name + '\n       ' + (e && e.stack || e)); process.exitCode = 1; }
  }
  console.log(process.exitCode ? 'SOME TESTS FAILED' : 'all ' + passed + ' passed');
})();
