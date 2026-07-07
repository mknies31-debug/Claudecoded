// CARVIS outreach email sender (Netlify Function).
//
// Sends 1:1 follow-up / referral / review-request emails on Mick's behalf via
// Resend (https://resend.com). The API key and sender identity live server-side;
// the browser only sends { to, toName, subject, html, text }. Replies route to
// Mick's inbox via reply-to, so he reads responses where he always does.
//
// ── Setup (one time) ──────────────────────────────────────────────────────
//  1. Create a Resend account and verify a sending domain (e.g. northstarcarguy.com).
//  2. In Netlify → Site settings → Environment variables, add:
//       RESEND_API_KEY   your Resend API key
//       MAIL_FROM        e.g. "Mick Knies <mick@northstarcarguy.com>"
//       MAIL_REPLY_TO    e.g. "mick@northstarcarguy.com"
//  Until a domain is verified, Resend only delivers to your own account email
//  (good enough to test the wiring). No local build step — Netlify bundles it.

const FROM_FALLBACK = 'CARVIS <onboarding@resend.dev>'; // test-only sender

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return resp(405, { error: 'Method Not Allowed' });

  // Optional shared secret — without it this is an open relay from Mick's
  // verified domain for anyone who finds the URL. Enforced when CARVIS_TOKEN
  // is set in Netlify env vars; the client sends it from ⇅ SYNC → Access token.
  const expected = process.env.CARVIS_TOKEN;
  if (expected) {
    const got = (event.headers && (event.headers['x-carvis-token'] || event.headers['X-Carvis-Token'])) || '';
    if (got !== expected) return resp(401, { error: 'This CARVIS is locked. Enter the access token in ⇅ SYNC → Access token (same value as the CARVIS_TOKEN env var on Netlify).' });
  }

  const key = process.env.RESEND_API_KEY;
  if (!key) return resp(500, { error: 'RESEND_API_KEY is not set. Add it in Netlify → Site settings → Environment variables.' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return resp(400, { error: 'Invalid JSON body.' }); }

  const { to, toName, subject, html, text } = body;
  if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return resp(400, { error: 'A valid recipient email (to) is required.' });
  if (!subject || !(html || text)) return resp(400, { error: 'subject and a body (html or text) are required.' });

  const from = process.env.MAIL_FROM || FROM_FALLBACK;
  const replyTo = process.env.MAIL_REPLY_TO || undefined;

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'authorization': `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [toName ? `${toName} <${to}>` : to],
        subject,
        html: html || undefined,
        text: text || undefined,
        reply_to: replyTo,
      }),
    });
    const raw = await r.text();
    if (!r.ok) return resp(r.status, { error: 'Email service rejected the send', detail: raw.slice(0, 300) });
    return resp(200, { ok: true, id: safeId(raw) });
  } catch (err) {
    return resp(502, { error: 'Send failed: ' + (err && err.message ? err.message : String(err)) });
  }
};

function resp(statusCode, obj) { return { statusCode, headers: { 'content-type': 'application/json' }, body: JSON.stringify(obj) }; }
function safeId(t) { try { return JSON.parse(t).id || null; } catch { return null; } }
