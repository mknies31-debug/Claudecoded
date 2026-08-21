// CARVIS outreach email sender (Netlify Function, modern API).
//
// Sends 1:1 follow-up / referral / review-request emails on Mick's behalf. It
// routes through the SAME provider layer as the nightly engine
// (_lib/email-provider.mjs), so EMAIL_PROVIDER=gmail|resend|mailerlite applies
// everywhere — one setting, no drift between hand-sent and automated email.
// The browser only sends { to, toName, subject, html, text }; every secret and
// sender identity stays server-side.

import { getEmailProvider, headerSafe } from './_lib/email-provider.mjs';

export default async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'Method Not Allowed' });

  let body;
  try { body = await req.json(); } catch { return json(400, { error: 'Invalid JSON body.' }); }

  const to = String(body.to || '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return json(400, { error: 'A valid recipient email (to) is required.' });

  // Body: use the plain text (or strip tags from any html the client sent) and
  // rebuild the HTML server-side. Never forward raw browser HTML — that's the
  // injection surface (script tags, event handlers, tracking pixels, etc.).
  const bodyText = (String(body.text || '') || stripTags(String(body.html || ''))).trim();
  const subject = headerSafe(body.subject, 200);
  if (!subject || !bodyText) return json(400, { error: 'subject and a message body are required.' });

  const provider = getEmailProvider(process.env);
  try {
    const r = await provider.send({
      to,
      toName: headerSafe(body.toName, 120).replace(/[<>"]/g, ''),
      subject,
      html: buildHtml(bodyText),
      text: bodyText,
    });
    return json(200, { ok: true, id: r && r.id ? r.id : null, provider: provider.name });
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    // Unconfigured provider → a setup hint instead of a bare stack line.
    if (/is not set/.test(msg)) return json(500, { error: msg + ' — set it in Netlify: Site settings → Environment variables (see GO-LIVE.md step 2), then redeploy.' });
    return json(502, { error: 'Send failed: ' + msg });
  }
};

function json(status, obj) { return new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } }); }
function stripTags(s) { return String(s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(); }
function escapeHtml(s) { return String(s || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
// Build the HTML body server-side from trusted plain text (escape, then <br>).
function buildHtml(text) {
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.55;color:#1a1a1a">${escapeHtml(text).replace(/\n/g, '<br>')}</div>`;
}
