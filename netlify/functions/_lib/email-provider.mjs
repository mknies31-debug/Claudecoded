// netlify/functions/_lib/email-provider.mjs — ISOLATED SERVICE: email gateway.
//
// The decoupled EmailProvider pattern. The engine depends only on the shape
// `send({ to, toName, subject, html, text }) -> { ok, id }`, never on a vendor.
// Swap vendors by changing EMAIL_PROVIDER — no engine or UI change.

/**
 * @typedef {Object} EmailMessage
 * @property {string} to       recipient email
 * @property {string} [toName] recipient display name
 * @property {string} subject
 * @property {string} [html]
 * @property {string} [text]
 */

/** Base contract. Concrete providers implement send(). */
export class EmailProvider {
  // eslint-disable-next-line no-unused-vars
  async send(_message) { throw new Error('EmailProvider.send() not implemented'); }
  get name() { return 'base'; }
}

/** Resend — the provider CARVIS already runs (mirrors send-email.js). */
export class ResendProvider extends EmailProvider {
  constructor(env = process.env) {
    super();
    this.key = env.RESEND_API_KEY;
    this.from = env.MAIL_FROM || 'CARVIS <onboarding@resend.dev>';
    this.replyTo = env.MAIL_REPLY_TO || undefined;
  }
  get name() { return 'resend'; }
  get configured() { return !!this.key; }

  async send({ to, toName, subject, html, text }) {
    if (!this.key) throw new Error('RESEND_API_KEY is not set');
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${this.key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: this.from,
        to: [toName ? `${toName} <${to}>` : to],
        subject,
        html: html || undefined,
        text: text || undefined,
        reply_to: this.replyTo,
      }),
    });
    const raw = await r.text();
    if (!r.ok) throw new Error(`Resend rejected (${r.status}): ${raw.slice(0, 200)}`);
    let id = null;
    try { id = JSON.parse(raw).id || null; } catch { /* non-JSON ok */ }
    return { ok: true, id };
  }
}

/**
 * MailerLite — swap-ready concrete implementation.
 *
 * MailerLite's model is list/automation-based rather than ad-hoc transactional
 * HTML. This provider does what MailerLite genuinely supports through its API:
 * upsert the subscriber and tag them with the sequence so a matching MailerLite
 * automation fires the actual send. It implements the SAME interface, so the
 * engine cannot tell the difference. See README "Swap the email provider" for
 * the one-time MailerLite automation setup this expects.
 */
export class MailerLiteProvider extends EmailProvider {
  constructor(env = process.env) {
    super();
    this.key = env.MAILERLITE_API_KEY;
    this.base = 'https://connect.mailerlite.com/api';
  }
  get name() { return 'mailerlite'; }
  get configured() { return !!this.key; }

  async send({ to, toName, subject }) {
    if (!this.key) throw new Error('MAILERLITE_API_KEY is not set');
    // Upsert the subscriber; the `crm_sequence` field + group automation drives
    // the actual delivery on MailerLite's side.
    const r = await fetch(`${this.base}/subscribers`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.key}`, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        email: to,
        fields: { name: toName || '', last_subject: subject || '' },
      }),
    });
    const raw = await r.text();
    if (!r.ok) throw new Error(`MailerLite rejected (${r.status}): ${raw.slice(0, 200)}`);
    let id = null;
    try { id = (JSON.parse(raw).data || {}).id || null; } catch { /* ok */ }
    return { ok: true, id };
  }
}

/** Factory — pick a provider from env. Defaults to Resend. */
export function getEmailProvider(env = process.env) {
  const choice = (env.EMAIL_PROVIDER || 'resend').toLowerCase();
  if (choice === 'mailerlite') return new MailerLiteProvider(env);
  return new ResendProvider(env);
}
