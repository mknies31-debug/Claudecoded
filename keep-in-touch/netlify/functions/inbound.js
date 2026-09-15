'use strict';
/*
 * inbound.js — Resend inbound-email webhook for North Star Keep-In-Touch (Agent 5).
 * POST only. Node 18+ built-ins + fetch. Zero npm deps.
 *
 * WHAT WAS VERIFIED (2026-09-15) vs ASSUMED
 * resend.com and docs.svix.com were unreachable from the build sandbox (egress
 * proxy), so verification came from the official Resend SDK source and third-party
 * mirrors of the docs:
 *
 *  VERIFIED — event type is `email.received`
 *    github.com/resend/resend-node  src/webhooks/interfaces/webhook-event.interface.ts
 *    (`export interface EmailReceivedEvent { type: 'email.received'; created_at; data }`).
 *  VERIFIED — the webhook payload is METADATA ONLY. `data` carries
 *    email_id, created_at, from, to, cc, bcc, message_id, subject, attachments[].
 *    No `text`/`html`. (resend.com/blog/inbound-emails, mirrored at
 *    github.com/resend/resend-skills skills/resend/references/webhooks.md:
 *    "metadata only (sender, recipient, subject, attachment list) — not the email body").
 *  VERIFIED — the body is fetched with GET https://api.resend.com/emails/receiving/{email_id}
 *    (resend-node src/emails/receiving/receiving.ts builds `/emails/receiving/${id}`),
 *    response fields: object, id, to[], from, created_at, subject, bcc, cc, reply_to,
 *    received_for[], html|null, text|null, headers, message_id, raw{download_url}, attachments[]
 *    (resend-node src/emails/receiving/interfaces/get-receiving-email.interface.ts).
 *    Docs page for this: resend.com/docs/api-reference/emails/retrieve-received-email.
 *  VERIFIED — signature scheme. Resend's SDK (src/webhooks/webhooks.ts) maps the
 *    `svix-id`/`svix-timestamp`/`svix-signature` headers onto the Standard Webhooks
 *    verifier, which is the Svix scheme: HMAC-SHA256 over `${id}.${timestamp}.${rawBody}`
 *    keyed with base64-decode(secret after "whsec_"), result base64; the header holds
 *    space-separated `v1,<base64>` entries; reject if |now - timestamp| > 5 minutes.
 *    (docs.svix.com/receiving/verifying-payloads/how-manual, standardwebhooks.com/verify/svix,
 *    resend.com/docs/dashboard/webhooks/verify-webhooks-requests.)
 *  ASSUMED — `data.from` is a single string that may be `Name <addr>` or a bare address
 *    (matches the SDK response type `from: string`). We parse both.
 *  ASSUMED — Netlify hands us the raw body in event.body (base64 when isBase64Encoded).
 *    The signature is computed over the raw bytes exactly as received.
 *  DEFENSIVE — if a payload ever does include `data.text` / `data.html` we use it and
 *    skip the retrieve call.
 *
 * FLOW
 *   405 non-POST → auth (x-kit-secret constant-time OR Svix) → 401 on failure
 *   → load libs/config (500 with a clear message if a lib or env is missing, so Resend
 *     retries once Mick fixes the deploy) → parse → normalize message (fetch body if
 *     needed) → find customer by lowercased email → write replies/{id}
 *   → if matched: link to latest sent touch ≤45 days (STATS.attributeReply),
 *     unreadReplies+1, applyEvent reply; if opt-out text → applyEvent optOut + ONE
 *     GOODBYE email via Resend → 200.
 *   Duplicate deliveries (same email_id) are acknowledged with 200 and not re-applied.
 *   Errors after auth are captured into the reply doc's `error` field and console.
 */

const crypto = require('crypto');

const RESEND_API = 'https://api.resend.com';
const TIMESTAMP_TOLERANCE_SEC = 300;
const SNIPPET_MAX = 1000;

// ---------------------------------------------------------------- helpers

function lowerHeaders(h) {
  const out = {};
  if (h && typeof h === 'object') {
    for (const k of Object.keys(h)) out[k.toLowerCase()] = h[k];
  }
  return out;
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a || ''), 'utf8');
  const bb = Buffer.from(String(b || ''), 'utf8');
  if (ba.length !== bb.length || ba.length === 0) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function verifySvix(headers, rawBody, secret, nowSec) {
  const id = headers['svix-id'];
  const ts = headers['svix-timestamp'];
  const sigHeader = headers['svix-signature'];
  if (!id || !ts || !sigHeader) return { ok: false, reason: 'missing svix headers' };
  if (!/^\d+$/.test(String(ts))) return { ok: false, reason: 'bad timestamp' };
  const tsNum = parseInt(ts, 10);
  if (Math.abs(nowSec - tsNum) > TIMESTAMP_TOLERANCE_SEC) return { ok: false, reason: 'timestamp outside tolerance' };
  const secretB64 = String(secret).startsWith('whsec_') ? String(secret).slice(6) : String(secret);
  let key;
  try { key = Buffer.from(secretB64, 'base64'); } catch (e) { return { ok: false, reason: 'bad secret' }; }
  if (!key.length) return { ok: false, reason: 'bad secret' };
  const expected = crypto.createHmac('sha256', key).update(`${id}.${ts}.${rawBody}`, 'utf8').digest();
  const entries = String(sigHeader).split(/\s+/).filter(Boolean);
  for (const entry of entries) {
    const idx = entry.indexOf(',');
    if (idx < 0) continue;
    if (entry.slice(0, idx) !== 'v1') continue;
    let got;
    try { got = Buffer.from(entry.slice(idx + 1), 'base64'); } catch (e) { continue; }
    if (got.length === expected.length && crypto.timingSafeEqual(got, expected)) return { ok: true };
  }
  return { ok: false, reason: 'signature mismatch' };
}

// "Dan Halvorson <Dan@Example.com>" -> "dan@example.com"
function parseAddress(from) {
  if (Array.isArray(from)) from = from[0];
  if (from && typeof from === 'object') from = from.email || from.address || '';
  const s = String(from || '').trim();
  const m = s.match(/<([^>]+)>/);
  const addr = (m ? m[1] : s).trim().replace(/^mailto:/i, '');
  const m2 = addr.match(/[^\s"'<>,;]+@[^\s"'<>,;]+/);
  return m2 ? m2[0].toLowerCase() : '';
}

function htmlToText(html) {
  return String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h\d|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\r/g, '');
}

// Drop quoted-reply lines (`> ...`) and everything from the "On ... wrote:" /
// "-----Original Message-----" line onward. Returns at most SNIPPET_MAX chars.
function stripQuoted(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  const kept = [];
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (/^On .* wrote:$/.test(line.trim())) break;
    if (/^-{2,}\s*Original Message\s*-{2,}$/i.test(line.trim())) break;
    if (/^\s*>/.test(line)) continue;
    kept.push(line);
  }
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, SNIPPET_MAX);
}

function firstLine(text) {
  const lines = String(text || '').split('\n').map((l) => l.trim()).filter(Boolean);
  return lines[0] || '';
}

function chicagoDate(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
  const o = {};
  for (const p of parts) o[p.type] = p.value;
  return `${o.year}-${o.month}-${o.day}`;
}

function randomId(n = 20) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.randomBytes(n);
  let s = '';
  for (let i = 0; i < n; i++) s += chars[bytes[i] % chars.length];
  return s;
}

function docIdOf(doc) {
  if (!doc) return '';
  if (doc.id) return String(doc.id);
  if (doc._id) return String(doc._id);
  if (doc.name && typeof doc.name === 'string' && doc.name.includes('/documents/')) return doc.name.split('/').pop();
  return '';
}

// lib/firestore.js list()/runQuery() return { id, data } rows; also accept flat docs.
function flattenRow(row) {
  if (!row || typeof row !== 'object') return null;
  if (row.data && typeof row.data === 'object' && !Array.isArray(row.data)) return Object.assign({ id: row.id || docIdOf(row) }, row.data);
  return row.id ? row : Object.assign({ id: docIdOf(row) }, row);
}

function json(statusCode, body) {
  return { statusCode, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

// Accept the Resend envelope, or a bare message (manual forward from the app).
function normalizePayload(payload) {
  if (!payload || typeof payload !== 'object') return null;
  if (payload.type && payload.data && typeof payload.data === 'object') {
    if (payload.type !== 'email.received') return { ignored: payload.type };
    const d = payload.data;
    return {
      emailId: d.email_id || d.id || '',
      from: d.from || '',
      to: d.to || [],
      subject: d.subject || '',
      text: typeof d.text === 'string' ? d.text : '',
      html: typeof d.html === 'string' ? d.html : '',
      receivedAt: d.created_at || payload.created_at || ''
    };
  }
  if (payload.from) {
    return {
      emailId: payload.email_id || payload.id || '',
      from: payload.from,
      to: payload.to || [],
      subject: payload.subject || '',
      text: typeof payload.text === 'string' ? payload.text : '',
      html: typeof payload.html === 'string' ? payload.html : '',
      receivedAt: payload.created_at || payload.receivedAt || ''
    };
  }
  return null;
}

// ---------------------------------------------------------------- factory

function makeHandler(deps = {}) {
  const env = deps.env || process.env;
  const log = deps.console || console;
  const fetchFn = deps.fetch || (typeof fetch === 'function' ? fetch : null);
  const nowMs = deps.now || (() => Date.now());

  function loadLibs() {
    const libs = { KIT: deps.KIT, COMPLIANCE: deps.COMPLIANCE, STATS: deps.STATS, makeClient: deps.makeClient, templates: deps.templates };
    const missing = [];
    const tryReq = (name, rel, pick) => {
      if (libs[name]) return;
      try { libs[name] = pick ? pick(require(rel)) : require(rel); }
      catch (e) { missing.push(`${name} (${rel}): ${e && e.message}`); }
    };
    tryReq('KIT', './lib/engine.js');
    tryReq('COMPLIANCE', './lib/compliance.js');
    tryReq('STATS', './lib/stats.js');
    tryReq('makeClient', './lib/firestore.js', (m) => m.makeClient || (m.default && m.default.makeClient));
    if (!libs.templates) {
      try { libs.templates = require('../../templates.json'); }
      catch (e1) {
        try { libs.templates = require('./templates.json'); }
        catch (e2) { missing.push(`templates (../../templates.json): ${e1 && e1.message}`); }
      }
    }
    return { libs, missing };
  }

  async function resendGet(path) {
    const res = await fetchFn(`${RESEND_API}${path}`, { method: 'GET', headers: { Authorization: `Bearer ${env.RESEND_API_KEY}` } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Resend GET ${path} -> ${res.status}: ${body && (body.message || body.error || '')}`);
    return body;
  }

  async function resendSend(msg) {
    const res = await fetchFn(`${RESEND_API}/emails`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify(msg)
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Resend send -> ${res.status}: ${body && (body.message || body.error || '')}`);
    return body;
  }

  async function sendGoodbye({ libs, db, customer, settings, log: l }) {
    const { KIT, COMPLIANCE, templates } = libs;
    const library = templates && Array.isArray(templates.templates) ? templates.templates : (Array.isArray(templates) ? templates : []);
    let overrides = {};
    try {
      const list = await db.list('templates');
      if (Array.isArray(list)) for (const row of list) { const t = flattenRow(row); if (t && t.id) overrides[t.id] = t; }
      else if (list && typeof list === 'object') overrides = list;
    } catch (e) { l.warn('inbound: could not load template overrides: ' + e.message); }
    let pool;
    try { pool = KIT.templatePool(library, overrides, 'GOODBYE', 'any'); }
    catch (e) { pool = null; }
    if (!Array.isArray(pool) || !pool.length) pool = library.filter((t) => t && t.slot === 'GOODBYE' && !t.retired);
    if (!pool.length) throw new Error('no GOODBYE template in templates.json');
    let tpl;
    try { tpl = KIT.pickTemplate(pool, customer.usedTemplateIds || [], customer.id); } catch (e) { tpl = null; }
    if (!tpl) tpl = pool[0];
    const unsubscribeUrl = `${(settings.siteUrl || env.SITE_URL || '').replace(/\/$/, '')}/?u=${customer.unsubscribeToken || ''}`;
    const footer = COMPLIANCE.emailFooter(settings, unsubscribeUrl);
    const r = KIT.render(tpl, customer, settings, { sender: 'mick', footer });
    const from = env.MAIL_FROM || (settings.fromName && settings.fromEmail ? `${settings.fromName} <${settings.fromEmail}>` : settings.fromEmail);
    const msg = {
      from,
      to: [customer.email],
      subject: r.subject || tpl.subject || 'Got it',
      text: r.emailFull || r.emailBody,
      headers: { 'List-Unsubscribe': `<${unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' }
    };
    const replyTo = env.MAIL_REPLY_TO || settings.replyTo;
    if (replyTo) msg.reply_to = replyTo;
    const sent = await resendSend(msg);
    return { id: (sent && sent.id) || '', templateId: tpl.id || '', subject: msg.subject, emailBody: msg.text };
  }

  return async function handler(event) {
    if (!event || (event.httpMethod || '').toUpperCase() !== 'POST') return json(405, { ok: false, error: 'POST only' });

    const headers = lowerHeaders(event.headers);
    const rawBody = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : (event.body || '');

    // ---- auth
    let source = '';
    if (headers['x-kit-secret'] && env.KIT_SECRET && safeEqual(headers['x-kit-secret'], env.KIT_SECRET)) {
      source = 'manual';
    } else if (env.RESEND_WEBHOOK_SECRET) {
      const v = verifySvix(headers, rawBody, env.RESEND_WEBHOOK_SECRET, Math.floor(nowMs() / 1000));
      if (!v.ok) { log.warn('inbound: rejected (' + v.reason + ')'); return json(401, { ok: false, error: 'unauthorized' }); }
      source = 'webhook';
    } else {
      log.warn('inbound: rejected (no x-kit-secret match and RESEND_WEBHOOK_SECRET not set)');
      return json(401, { ok: false, error: 'unauthorized' });
    }

    // ---- libs + config (deploy problems -> 500 so Resend retries after the fix)
    const { libs, missing } = loadLibs();
    if (missing.length) { log.error('inbound: missing lib(s): ' + missing.join('; ')); return json(500, { ok: false, error: 'missing lib: ' + missing.join('; ') }); }
    if (!fetchFn) return json(500, { ok: false, error: 'fetch unavailable (Node 18+ required)' });
    if (!env.FIREBASE_PROJECT_ID || !env.FIREBASE_SERVICE_ACCOUNT) {
      return json(500, { ok: false, error: 'FIREBASE_PROJECT_ID / FIREBASE_SERVICE_ACCOUNT not set' });
    }
    let db;
    try { db = libs.makeClient({ projectId: env.FIREBASE_PROJECT_ID, serviceAccountB64: env.FIREBASE_SERVICE_ACCOUNT }); }
    catch (e) { log.error('inbound: makeClient failed: ' + e.message); return json(500, { ok: false, error: 'firestore client: ' + e.message }); }

    // ---- parse (after auth: always 200 from here on)
    let payload;
    try { payload = JSON.parse(rawBody || '{}'); } catch (e) { log.error('inbound: bad JSON'); return json(200, { ok: false, error: 'bad json' }); }
    const msg = normalizePayload(payload);
    if (!msg) return json(200, { ok: false, error: 'unrecognized payload' });
    if (msg.ignored) return json(200, { ok: true, ignored: msg.ignored });

    const { KIT, STATS } = libs;
    const nowIso = new Date(nowMs()).toISOString();
    const today = KIT.todayChicago();
    const receivedAt = msg.receivedAt && !isNaN(new Date(msg.receivedAt).getTime()) ? new Date(msg.receivedAt).toISOString() : nowIso;
    const receivedDate = chicagoDate(receivedAt) || today;
    const replyId = msg.emailId ? 'in_' + String(msg.emailId).replace(/[^A-Za-z0-9_-]/g, '') : randomId();
    const errors = [];

    // ---- idempotency: Resend/Svix retry deliveries; never double-apply
    if (msg.emailId) {
      try {
        const existing = await db.get('replies/' + replyId);
        if (existing && (existing.customerId !== undefined || existing.from !== undefined)) {
          return json(200, { ok: true, duplicate: true, replyId });
        }
      } catch (e) { /* not found (or transient) -> proceed */ }
    }

    // ---- body
    let text = msg.text;
    let html = msg.html;
    if (!text && !html && msg.emailId) {
      if (!env.RESEND_API_KEY) errors.push('RESEND_API_KEY not set; could not fetch body');
      else {
        try {
          const full = await resendGet(`/emails/receiving/${encodeURIComponent(msg.emailId)}`);
          text = typeof full.text === 'string' ? full.text : '';
          html = typeof full.html === 'string' ? full.html : '';
          if (!msg.from && full.from) msg.from = full.from;
          if (!msg.subject && full.subject) msg.subject = full.subject;
        } catch (e) { errors.push('fetch body: ' + e.message); }
      }
    }
    if (!text && html) text = htmlToText(html);
    const snippet = stripQuoted(text);
    const subject = String(msg.subject || '').slice(0, 500);
    const addr = parseAddress(msg.from);

    const reply = {
      customerId: '', customerName: '', touchId: '', slot: '', templateId: '',
      receivedAt, receivedDate, channel: 'email', source,
      from: String(msg.from || '').slice(0, 300), subject, snippet,
      isOptOut: false, processed: false, createdAt: nowIso, error: ''
    };
    const result = { ok: true, replyId, matched: false, optOut: false, goodbyeSent: false };

    // ---- match customer
    let customer = null;
    try {
      if (addr) {
        const rows = await db.runQuery('customers', [['email', 'EQUAL', addr]]);
        if (Array.isArray(rows) && rows.length) customer = flattenRow(rows[0]);
      } else errors.push('no sender address in payload');
    } catch (e) { errors.push('customer lookup: ' + e.message); }

    if (customer && customer.id) {
      result.matched = true;
      reply.customerId = customer.id;
      reply.customerName = customer.name || '';
      // link to the latest sent touch within 45 days
      try {
        const touches = await db.runQuery('touches', [['customerId', 'EQUAL', customer.id]]);
        const t = STATS.attributeReply({ customerId: customer.id, receivedDate }, Array.isArray(touches) ? touches.map(flattenRow).filter(Boolean) : []);
        if (t) { reply.touchId = t.id || ''; reply.slot = t.slot || ''; reply.templateId = t.templateId || ''; }
      } catch (e) { errors.push('touch lookup: ' + e.message); }

      reply.isOptOut = !!(KIT.isOptOutText(subject) || KIT.isOptOutText(firstLine(snippet)));
      result.optOut = reply.isOptOut;

      try {
        let updated = KIT.applyEvent(customer, { type: 'reply', date: receivedDate }, today);
        updated.unreadReplies = (Number(customer.unreadReplies) || 0) + 1;
        updated.lastReplyAt = receivedAt;
        if (reply.isOptOut) {
          updated = KIT.applyEvent(updated, { type: 'optOut', reason: 'STOP reply', channel: 'email', at: nowIso }, today);
        }
        updated.updatedAt = nowIso;
        const fields = Object.assign({}, updated);
        delete fields.id; delete fields._id; delete fields.name_; delete fields.__name;
        await db.update('customers/' + customer.id, fields);
        reply.processed = true;
        customer = updated;
      } catch (e) { errors.push('customer update: ' + e.message); }

      if (reply.isOptOut && customer.email) {
        try {
          let settings = {};
          try { settings = (await db.get('settings/main')) || {}; } catch (e) { errors.push('settings: ' + e.message); }
          const g = await sendGoodbye({ libs, db, customer, settings, log });
          result.goodbyeSent = true;
          result.goodbyeId = g.id;
          try {
            await db.set('touches/' + randomId(), {
              customerId: customer.id, customerName: customer.name || '', touchN: -1, slot: 'GOODBYE',
              templateId: g.templateId, season: 'any', dueDate: today, status: 'sent', sentAt: nowIso, sentDate: today,
              channels: ['email'], sentBy: 'scheduled', subject: g.subject, emailBody: g.emailBody, textBody: '',
              providerId: g.id, late: false, daysLate: 0, createdAt: nowIso, updatedAt: nowIso
            });
          } catch (e) { errors.push('goodbye touch log: ' + e.message); }
        } catch (e) { errors.push('goodbye send: ' + e.message); }
      }
    }

    if (errors.length) { reply.error = errors.join(' | ').slice(0, 2000); log.error('inbound ' + replyId + ': ' + reply.error); }
    try {
      await db.set('replies/' + replyId, reply);
    } catch (e) {
      // Nothing was recorded; ask Resend to retry rather than lose the message.
      log.error('inbound: could not write reply doc: ' + e.message);
      return json(500, { ok: false, error: 'write reply: ' + e.message });
    }
    if (errors.length) { result.ok = false; result.error = reply.error; }
    return json(200, result);
  };
}

exports.makeHandler = makeHandler;
exports.handler = makeHandler();
exports._internal = { verifySvix, parseAddress, stripQuoted, htmlToText, normalizePayload, chicagoDate, safeEqual, flattenRow };
