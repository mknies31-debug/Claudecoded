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

  const key = process.env.RESEND_API_KEY;
  if (!key) return resp(500, { error: 'RESEND_API_KEY is not set. Add it in Netlify → Site settings → Environment variables.' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return resp(400, { error: 'Invalid JSON body.' }); }

  const to = String(body.to || '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return resp(400, { error: 'A valid recipient email (to) is required.' });

  // Body: use the plain text (or strip tags from any html the client sent) and
  // rebuild the HTML server-side. Never forward raw browser HTML — that's the
  // injection surface (script tags, event handlers, tracking pixels, etc.).
  const bodyText = (String(body.text || '') || stripTags(String(body.html || ''))).trim();
  const subject = headerSafe(body.subject, 200);           // strip CR/LF → no header injection
  if (!subject || !bodyText) return resp(400, { error: 'subject and a message body are required.' });

  const toName = headerSafe(body.toName, 120).replace(/[<>"]/g, ''); // keep the "Name <email>" header well-formed
  const from = process.env.MAIL_FROM || FROM_FALLBACK;
  const replyTo = headerSafe(process.env.MAIL_REPLY_TO, 200) || undefined;

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'authorization': `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [toName ? `${toName} <${to}>` : to],
        subject,
        html: buildHtml(bodyText),
        text: bodyText,
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

// ── mail-safety helpers ──────────────────────────────────────────────────────
// Collapse CR/LF/tabs to a space and cap length — blocks header injection in
// subject / display-name / reply-to.
function headerSafe(s, max) { return String(s || '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, max || 200); }
function stripTags(s) { return String(s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(); }
function escapeHtml(s) { return String(s || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
// Build the HTML body server-side from trusted plain text (escape, then <br>).
function buildHtml(text) {
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.55;color:#1a1a1a">${escapeHtml(text).replace(/\n/g, '<br>')}</div>`;
}
