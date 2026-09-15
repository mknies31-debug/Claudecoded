// Keep-In-Touch email sender (Netlify Function). POST only.
// Sends ONE plain-text email through Resend on Mick's behalf. Every call must
// carry the shared secret in the "x-kit-secret" header or it is refused (401).
// Never touches Firestore; the browser logs the touch itself.
// Env vars: KIT_SECRET (required), RESEND_API_KEY (required), MAIL_FROM,
// MAIL_REPLY_TO. Optional: SITE_URL (fallback for the unsubscribe link).

'use strict';

const crypto = require('crypto');

const RESEND_URL = 'https://api.resend.com/emails';
const MAX_BODY_BYTES = 20 * 1024; // 20 KB — a five-sentence email is ~1 KB
const FROM_FALLBACK = 'Mick at Mosaic Autos <onboarding@resend.dev>'; // Resend test sender; delivers only to your own inbox
const ENV_PATH = 'Netlify → Site configuration → Environment variables → Add a variable';

exports.handler = async (event) => {
  if (!event || event.httpMethod !== 'POST') {
    return resp(405, { error: 'Method Not Allowed. This endpoint only accepts POST.' });
  }

  // 1. Secret. Checked before anything else so an unauthenticated caller learns
  //    nothing — not even whether the API key is configured.
  const auth = checkSecret(event.headers, process.env.KIT_SECRET);
  if (!auth.ok) return resp(auth.status, { error: auth.error });

  // 2. Provider configured?
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return resp(500, { error: 'RESEND_API_KEY is not set. Fix: ' + ENV_PATH + ' → key RESEND_API_KEY, value = your Resend API key → Save → then trigger a new deploy.' });
  }

  // 3. Body size, then JSON.
  if (Buffer.byteLength(event.body || '', event.isBase64Encoded ? 'base64' : 'utf8') > MAX_BODY_BYTES) {
    return resp(413, { error: 'Request body is larger than 20 KB.' });
  }
  let body;
  try {
    const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : (event.body || '{}');
    body = JSON.parse(raw);
  } catch (e) {
    return resp(400, { error: 'Body must be valid JSON.' });
  }

  // 4. Validate fields.
  const v = validate(body);
  if (v.error) return resp(400, { error: v.error });

  // 5. Send.
  try {
    const result = await sendViaResend({
      apiKey,
      from: process.env.MAIL_FROM || FROM_FALLBACK,
      replyTo: process.env.MAIL_REPLY_TO || '',
      to: v.to,
      toName: v.toName,
      subject: v.subject,
      text: v.text,
      unsubscribeUrl: v.unsubscribeUrl,
      tags: { customerId: v.customerId, touchId: v.touchId },
    });
    if (!result.ok) return resp(result.status || 502, { error: result.error });
    const out = { ok: true, id: result.id };
    if (!process.env.MAIL_FROM) out.warning = 'MAIL_FROM is not set; sent from the Resend test address, which only delivers to your own inbox.';
    return resp(200, out);
  } catch (err) {
    return resp(502, { error: 'Send failed: ' + (err && err.message ? err.message : String(err)) });
  }
};

// ---------------------------------------------------------------------------
// Helpers (exported so daily.js and the tests can reuse them)
// ---------------------------------------------------------------------------

// Constant-time compare of the header against the configured secret. We hash
// both sides first so lengths always match and no timing leaks the length.
function checkSecret(headers, expected) {
  if (!expected || String(expected).length < 8) {
    return { ok: false, status: 500, error: 'KIT_SECRET is not set (or is shorter than 8 characters). Fix: ' + ENV_PATH + ' → key KIT_SECRET → Save → redeploy. Use the same value in the app Settings screen.' };
  }
  const given = headerValue(headers, 'x-kit-secret');
  if (!given) return { ok: false, status: 401, error: 'Missing x-kit-secret header.' };
  const a = crypto.createHash('sha256').update(String(given)).digest();
  const b = crypto.createHash('sha256').update(String(expected)).digest();
  if (!crypto.timingSafeEqual(a, b)) return { ok: false, status: 401, error: 'Wrong x-kit-secret.' };
  return { ok: true };
}

function headerValue(headers, name) {
  if (!headers) return '';
  const want = name.toLowerCase();
  for (const k of Object.keys(headers)) {
    if (k.toLowerCase() === want) return headers[k] == null ? '' : String(headers[k]);
  }
  return '';
}

// Remove anything that looks like an HTML tag, then collapse the entity forms
// a tag stripper can leave behind. We send plain text only, so a stray "<b>"
// would just look wrong to the customer; this keeps it honest.
function stripTags(s) {
  return String(s == null ? '' : s)
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

const EMAIL_RE = /^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/;

function validate(body) {
  body = body && typeof body === 'object' ? body : {};
  const to = String(body.to || '').trim().toLowerCase();
  if (!to) return { error: 'Missing "to" (recipient email).' };
  if (!EMAIL_RE.test(to)) return { error: '"to" is not a valid email address.' };

  const subject = stripTags(body.subject || '').replace(/[\r\n]+/g, ' ').trim();
  if (!subject) return { error: 'Missing "subject".' };
  if (subject.length > 200) return { error: '"subject" is longer than 200 characters.' };

  const text = stripTags(body.text || '').replace(/\r\n/g, '\n').trim();
  if (!text) return { error: 'Missing "text" (plain-text body).' };

  const toName = String(body.toName || '').replace(/[<>"\r\n]/g, '').trim().slice(0, 100);

  let unsubscribeUrl = String(body.unsubscribeUrl || '').trim();
  if (!unsubscribeUrl && process.env.SITE_URL && body.unsubscribeToken) {
    unsubscribeUrl = String(process.env.SITE_URL).replace(/\/+$/, '') + '/?u=' + encodeURIComponent(body.unsubscribeToken);
  }
  if (unsubscribeUrl && !/^https?:\/\/[^\s<>]+$/.test(unsubscribeUrl)) {
    return { error: '"unsubscribeUrl" must be an http(s) URL.' };
  }

  return {
    to,
    toName,
    subject,
    text,
    unsubscribeUrl,
    customerId: safeTag(body.customerId),
    touchId: safeTag(body.touchId),
  };
}

// Resend tag values allow only letters, numbers, underscores and dashes.
function safeTag(v) {
  return String(v || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
}

// The one place in the codebase that talks to Resend. Plain text only — the
// payload deliberately has no "html" field.
async function sendViaResend(o) {
  const payload = {
    from: o.from,
    to: [o.toName ? o.toName + ' <' + o.to + '>' : o.to],
    subject: o.subject,
    text: o.text,
  };
  if (o.replyTo) payload.reply_to = o.replyTo;
  if (o.unsubscribeUrl) {
    payload.headers = {
      'List-Unsubscribe': '<' + o.unsubscribeUrl + '>',
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    };
  }
  const tags = [];
  for (const name of Object.keys(o.tags || {})) {
    if (o.tags[name]) tags.push({ name, value: o.tags[name] });
  }
  if (tags.length) payload.tags = tags;

  const fetchImpl = o.fetch || globalThis.fetch;
  const r = await fetchImpl(RESEND_URL, {
    method: 'POST',
    headers: { authorization: 'Bearer ' + o.apiKey, 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const raw = await r.text();
  if (!r.ok) {
    return { ok: false, status: r.status === 429 ? 429 : 502, error: 'Resend rejected the send (' + r.status + '): ' + raw.slice(0, 300) };
  }
  let id = null;
  try { id = JSON.parse(raw).id || null; } catch (e) { id = null; }
  return { ok: true, id };
}

function resp(statusCode, obj) {
  return {
    statusCode,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    body: JSON.stringify(obj),
  };
}

exports.checkSecret = checkSecret;
exports.stripTags = stripTags;
exports.validate = validate;
exports.sendViaResend = sendViaResend;
exports.headerValue = headerValue;
