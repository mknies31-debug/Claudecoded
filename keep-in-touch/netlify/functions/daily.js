// Keep-In-Touch daily auto-send (Netlify Scheduled Function) — Tier 2 only.
// Runs at 14:00 and 15:00 UTC; does real work only when it is 9 AM in
// America/Chicago (so it runs once a day, year-round, through DST changes).
// Processes unsubscribe opt-outs, then emails every customer whose touch is
// due — only if Settings → Auto-send email is ON and the customer gave email
// consent. Never sends a text, and never sends the one-time consent ASK. Always writes heartbeat/daily so the app can
// show a red banner when this job stops running.
// Env vars: FIREBASE_PROJECT_ID, FIREBASE_SERVICE_ACCOUNT (raw JSON or base64),
// RESEND_API_KEY, MAIL_FROM, MAIL_REPLY_TO, SITE_URL, KIT_SECRET (for ?force=1).
// Optional: KIT_FORCE_HOUR (tests), KIT_TIME_BUDGET_MS, KIT_MAX_SENDS.

'use strict';

const { checkSecret, headerValue, sendViaResend } = require('./send.js');

// Netlify reads this to know the cron schedule (also set in netlify.toml).
exports.config = { schedule: '0 14,15 * * *' };

const SEND_HOUR = 9;            // 9 AM Central
const MAX_SENDS_DEFAULT = 90;   // Resend free tier is 100/day; leave room for hand sends
const TIME_BUDGET_MS_DEFAULT = 8000; // Netlify's default function timeout is 10 s
const SEND_GAP_MS = 550;        // Resend free tier allows ~2 requests/second

// ---------------------------------------------------------------------------
// Dependencies are loaded lazily and can be injected (third argument) so the
// tests can run with mocks and without any network. In production Netlify
// calls handler(event, context) and the defaults kick in.
// ---------------------------------------------------------------------------
function defaultDeps(env) {
  const deps = { env };
  deps.KIT = require('./lib/engine.js');
  deps.COMPLIANCE = require('./lib/compliance.js');
  deps.LIBRARY = require('../../templates.json');
  deps.fetch = globalThis.fetch;
  deps.makeDb = () => {
    const { makeClient } = require('./lib/firestore.js');
    return makeClient({ projectId: env.FIREBASE_PROJECT_ID, serviceAccount: env.FIREBASE_SERVICE_ACCOUNT, fetch: deps.fetch });
  };
  deps.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  deps.newId = require('./lib/firestore.js').newId;
  return deps;
}

exports.handler = async (event, context, injected) => {
  const env = (injected && injected.env) || process.env;
  const started = Date.now();
  const heartbeat = { ranSend: false, sent: 0, skipped: 0, errors: [], note: '' };
  let deps;
  let db = null;

  // ---- Gate 1: manual test via HTTP needs ?force=1 AND the secret. ----
  // (Without force, an HTTP hit is treated exactly like a scheduled tick.)
  const qs = (event && event.queryStringParameters) || {};
  const forced = String(qs.force || '') === '1';
  if (forced) {
    const auth = checkSecret((event && event.headers) || {}, env.KIT_SECRET);
    if (!auth.ok) return resp(auth.status, { error: auth.error });
  } else if (headerValue((event && event.headers) || {}, 'x-kit-secret')) {
    // Someone sent a secret but no force=1: reject rather than silently run.
    return resp(400, { error: 'Add ?force=1 to run outside the 9 AM window.' });
  }

  try {
    deps = injected ? Object.assign(defaultDepsSafe(env), injected) : defaultDeps(env);
  } catch (e) {
    return resp(500, { error: 'daily.js could not load its libraries: ' + e.message });
  }

  // ---- Gate 2: Firestore access (Tier 2 needs the service account). ----
  try {
    db = deps.db || deps.makeDb();
  } catch (e) {
    return resp(500, { ok: false, ranSend: false, error: 'Tier 2 is not configured: ' + e.message });
  }

  const today = deps.KIT.todayChicago();
  const nowIso = new Date().toISOString();

  // ---- Gate 3: the clock. ----
  const hour = currentChicagoHour(env, deps.KIT);
  if (!forced && hour !== SEND_HOUR) {
    heartbeat.note = 'Not 9 AM Central (hour was ' + hour + '); nothing sent.';
    await writeHeartbeat(db, heartbeat, today, nowIso, started);
    return resp(200, { ok: true, ranSend: false, reason: heartbeat.note });
  }

  try {
    await run({ db, deps, env, today, nowIso, started, heartbeat, forced });
  } catch (e) {
    heartbeat.errors.push('Run aborted: ' + (e && e.message ? e.message : String(e)));
  } finally {
    await writeHeartbeat(db, heartbeat, today, nowIso, started);
  }
  return resp(200, {
    ok: heartbeat.errors.length === 0,
    ranSend: heartbeat.ranSend,
    sent: heartbeat.sent,
    skipped: heartbeat.skipped,
    errors: heartbeat.errors,
    note: heartbeat.note,
  });
};

// ---------------------------------------------------------------------------
// The actual run. Split out so errors funnel into the heartbeat.
// ---------------------------------------------------------------------------
async function run(ctx) {
  const { db, deps, env, today, nowIso, heartbeat } = ctx;
  const { KIT, COMPLIANCE } = deps;

  const settings = (await db.get('settings/main')) || {};
  const customerRows = await db.list('customers'); // [{ id, data }]
  const customers = new Map(customerRows.map((r) => [r.id, r.data]));

  // 1. Opt-outs first, so nobody who unsubscribed overnight gets an email.
  await processOptouts({ db, KIT, customers, today, nowIso, heartbeat });

  // 2. Is auto-send even on?
  if (!settings.autoSendEmail) {
    heartbeat.note = 'Auto-send email is off in Settings; nothing sent.';
    return;
  }
  if (!env.RESEND_API_KEY) {
    heartbeat.errors.push('RESEND_API_KEY is not set. Netlify → Site configuration → Environment variables.');
    return;
  }

  // 3. Build today's queue: one due touch per active customer, oldest first.
  //    Uses KIT.nextTouch per customer (its shape is fixed by the contract).
  const due = [];
  for (const [id, c] of customers) {
    if (!c || c.status !== 'active') continue;
    let nt;
    try { nt = KIT.nextTouch(c, today); } catch (e) { heartbeat.errors.push((c.name || id) + ': nextTouch failed: ' + e.message); continue; }
    if (!nt || !nt.isDue) continue;
    if (c.snoozedUntil && c.snoozedUntil > today) continue;
    if (!(nt.dueDate <= today)) continue;
    due.push({ id, customer: c, touch: nt });
  }
  due.sort((a, b) => (a.touch.dueDate < b.touch.dueDate ? -1 : a.touch.dueDate > b.touch.dueDate ? 1 : String(a.customer.name || '').localeCompare(String(b.customer.name || ''))));

  if (!due.length) {
    heartbeat.ranSend = true;
    heartbeat.note = 'Nothing due today.';
    return;
  }

  // 4. Template overrides (Templates screen edits / retirements).
  const overrides = {};
  try {
    for (const row of await db.list('templates')) overrides[row.id] = row.data;
  } catch (e) {
    heartbeat.errors.push('Could not load template overrides (using library as shipped): ' + e.message);
  }

  const season = KIT.seasonFor(today);
  const siteUrl = String(settings.siteUrl || env.SITE_URL || '').replace(/\/+$/, '');
  const maxSends = Number(env.KIT_MAX_SENDS) > 0 ? Number(env.KIT_MAX_SENDS) : MAX_SENDS_DEFAULT;
  const timeBudget = Number(env.KIT_TIME_BUDGET_MS) > 0 ? Number(env.KIT_TIME_BUDGET_MS) : TIME_BUDGET_MS_DEFAULT;
  const from = env.MAIL_FROM || (settings.fromName && settings.fromEmail ? settings.fromName + ' <' + settings.fromEmail + '>' : '');
  if (!from) {
    heartbeat.errors.push('MAIL_FROM is not set and Settings has no fromName/fromEmail; nothing sent.');
    return;
  }

  heartbeat.ranSend = true;
  let attempted = 0;

  // 5. Send, one customer at a time, each wrapped so one failure can't stop the rest.
  for (let i = 0; i < due.length; i++) {
    const { id, customer, touch } = due[i];

    if (heartbeat.sent >= maxSends) {
      heartbeat.errors.push('Daily send cap of ' + maxSends + ' reached; ' + (due.length - i) + ' customers still due. They stay in the queue for tomorrow.');
      break;
    }
    if (Date.now() - ctx.started > timeBudget) {
      heartbeat.errors.push('Time budget reached after ' + heartbeat.sent + ' sends; ' + (due.length - i) + ' customers still due. They stay in the queue for tomorrow.');
      break;
    }

    try {
      // The one-time consent ASK is never auto-sent: a person taps it. (An ASK
      // customer has no consent, so canEmail would refuse anyway; this guard
      // makes the rule explicit and survives any future change to canEmail.)
      if (touch.slot === 'ASK') { heartbeat.skipped++; continue; }
      // Consent + channel gate. Texts are never sent here, full stop.
      const canEmail = COMPLIANCE && typeof COMPLIANCE.canEmail === 'function'
        ? COMPLIANCE.canEmail(customer)
        : !!(customer.emailConsent && customer.emailConsent.given && customer.email);
      if (!canEmail || !customer.email) { heartbeat.skipped++; continue; }
      if (!customer.unsubscribeToken) {
        heartbeat.errors.push((customer.name || id) + ': no unsubscribeToken; open them in the app once to fix, then they will send.');
        heartbeat.skipped++;
        continue;
      }

      // Pick words.
      const pool = KIT.templatePool(deps.LIBRARY, overrides, touch.slot, season);
      if (!pool || !pool.length) {
        heartbeat.errors.push((customer.name || id) + ': no live template for slot ' + touch.slot + ' (' + season + '); left in queue.');
        continue;
      }
      const tpl = KIT.pickTemplate(pool, customer.usedTemplateIds || [], id + ':' + touch.dueDate);
      const unsubscribeUrl = siteUrl + '/?u=' + encodeURIComponent(customer.unsubscribeToken);
      const footer = COMPLIANCE.emailFooter(settings, unsubscribeUrl);
      const rendered = KIT.render(tpl, customer, settings, { sender: 'mick', footer });

      // Send (rate-limited so Resend doesn't 429 us).
      if (attempted > 0) await deps.sleep(SEND_GAP_MS);
      attempted++;
      const touchId = deps.newId(20);
      const result = await sendViaResend({
        apiKey: env.RESEND_API_KEY,
        from,
        replyTo: env.MAIL_REPLY_TO || settings.replyTo || '',
        to: String(customer.email).trim().toLowerCase(),
        toName: customer.name || '',
        subject: rendered.subject,
        text: rendered.emailFull,
        unsubscribeUrl,
        tags: { customerId: id, touchId },
        fetch: deps.fetch,
      });
      if (!result.ok) {
        heartbeat.errors.push((customer.name || id) + ': ' + result.error);
        if (result.status === 429) { heartbeat.errors.push('Resend rate limit hit; stopping this run.'); break; }
        continue;
      }

      // Record it. Touch doc first, then the customer's new state.
      const touchDoc = {
        customerId: id,
        customerName: customer.name || '',
        touchN: touch.n,
        slot: touch.slot,
        templateId: tpl.id,
        season,
        dueDate: touch.dueDate,
        status: 'sent',
        sentAt: nowIso,
        sentDate: today,
        channels: ['email'],
        sentBy: 'scheduled',
        subject: rendered.subject,
        emailBody: rendered.emailFull,
        textBody: '',
        providerId: result.id || '',
        late: !!touch.isLate,
        daysLate: Number(touch.daysLate) || 0,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      await db.set('touches/' + touchId, touchDoc);

      let updated = KIT.applyEvent(customer, {
        type: 'sent',
        n: touch.n,
        dueDate: touch.dueDate,
        slot: touch.slot,
        carried: !!touch.carried,
        channels: ['email'],
        sentDate: today,
        templateId: tpl.id,
        touchId,
      }, today);
      updated = Object.assign({}, updated, { lastSentAt: nowIso, lastSentDate: today, updatedAt: nowIso });
      await db.set('customers/' + id, updated);
      customers.set(id, updated);
      heartbeat.sent++;
    } catch (e) {
      heartbeat.errors.push((customer.name || id) + ': ' + (e && e.message ? e.message : String(e)));
    }
  }
}

// Flip customers who clicked unsubscribe to do-not-contact, then delete the
// optout doc. A token that matches nobody is junk (anyone can create one) and
// is deleted too.
async function processOptouts({ db, KIT, customers, today, nowIso, heartbeat }) {
  let optouts = [];
  try { optouts = await db.list('optouts'); } catch (e) {
    heartbeat.errors.push('Could not read optouts: ' + e.message);
    return;
  }
  for (const row of optouts) {
    const token = row.id;
    try {
      let matchId = '';
      for (const [id, c] of customers) {
        if (c && c.unsubscribeToken && c.unsubscribeToken === token) { matchId = id; break; }
      }
      if (matchId) {
        const c = customers.get(matchId);
        if (c.status !== 'dnc') {
          const at = (row.data && typeof row.data.at === 'string' && row.data.at) || nowIso;
          let updated = KIT.applyEvent(c, { type: 'optOut', reason: 'unsubscribe link', channel: 'email', at }, today);
          updated = Object.assign({}, updated, { updatedAt: nowIso });
          await db.set('customers/' + matchId, updated);
          customers.set(matchId, updated);
        }
      }
      await db.delete('optouts/' + token);
    } catch (e) {
      heartbeat.errors.push('optout ' + token.slice(0, 6) + '…: ' + (e && e.message ? e.message : String(e)));
    }
  }
}

async function writeHeartbeat(db, hb, today, nowIso, started) {
  if (!db) return;
  const doc = {
    lastRunAt: nowIso,
    lastRunDate: today,
    ranSend: !!hb.ranSend,
    sent: hb.sent,
    skipped: hb.skipped,
    errors: hb.errors.slice(0, 50),
    note: hb.note || '',
    durationMs: Date.now() - started,
  };
  try { await db.set('heartbeat/daily', doc); } catch (e) {
    // Nothing left to record it in; log for Netlify's function log.
    console.error('heartbeat write failed:', e && e.message ? e.message : e);
  }
}

// KIT_FORCE_HOUR (tests) wins; otherwise the engine's Chicago clock; otherwise
// a local Intl fallback so this file still works if the engine is missing it.
function currentChicagoHour(env, KIT) {
  if (env.KIT_FORCE_HOUR !== undefined && env.KIT_FORCE_HOUR !== '') return Number(env.KIT_FORCE_HOUR);
  if (KIT && typeof KIT.nowChicagoHour === 'function') return Number(KIT.nowChicagoHour());
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hour12: false }).formatToParts(new Date());
  const h = Number((parts.find((p) => p.type === 'hour') || {}).value);
  return h === 24 ? 0 : h;
}

// Like defaultDeps but never throws on a missing library: the injected deps
// (tests) fill the gaps. Production always goes through defaultDeps.
function defaultDepsSafe(env) {
  const deps = { env, fetch: globalThis.fetch, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) };
  try { deps.KIT = require('./lib/engine.js'); } catch (e) { /* injected */ }
  try { deps.COMPLIANCE = require('./lib/compliance.js'); } catch (e) { /* injected */ }
  try { deps.LIBRARY = require('../../templates.json'); } catch (e) { /* injected */ }
  try { deps.newId = require('./lib/firestore.js').newId; } catch (e) { /* injected */ }
  deps.makeDb = () => {
    const { makeClient } = require('./lib/firestore.js');
    return makeClient({ projectId: env.FIREBASE_PROJECT_ID, serviceAccount: env.FIREBASE_SERVICE_ACCOUNT, fetch: deps.fetch });
  };
  return deps;
}

function resp(statusCode, obj) {
  return { statusCode, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }, body: JSON.stringify(obj) };
}

exports.run = run;
exports.processOptouts = processOptouts;
exports.currentChicagoHour = currentChicagoHour;
