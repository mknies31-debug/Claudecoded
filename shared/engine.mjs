// shared/engine.mjs — CLEAN API: the daily loop, as a pure function.
//
// runDailyCycle() takes data + an injected EmailProvider and returns the next
// state plus a report. It performs NO I/O of its own — the cron wraps it with
// blob load/save, the test suite wraps it with a mock provider. That injection
// is what makes "swap the provider" and "prove no regression" both trivial.

import { nextDueSequence } from './sequences.mjs';
import { hydrate } from './hydrate.mjs';
import { getText, getEmail, APPROVED as TEMPLATES_APPROVED } from './templates.mjs';
import { newTouchLog } from './schema.mjs';
import { isFrozen, lintCopy } from './compliance.mjs';
import { sequenceByKey } from './sequences.mjs';

const isSameDay = (a, b) => String(a).slice(0, 10) === String(b).slice(0, 10);

// How many days in a row an auto-email may fail before we give up on that
// window and let the timeline move on. Without a cap, one permanently-bad
// address (Resend keeps 4xx-rejecting it) would freeze a customer at that
// stage forever and block every later window. 3 ≈ retry today + 2 more days.
const MAX_EMAIL_RETRIES = 3;

// Touch logs are an audit trail, not permanent storage — they ride the synced
// blob (which has a size ceiling) and the dashboard re-scans them every render.
// Drop routine logs older than this so history stays useful without growing
// forever. ~13 months keeps a full year-long sequence plus a margin.
const LOG_RETENTION_DAYS = 400;

/**
 * @param {object}   o
 * @param {array}    o.customers   - customer records (not mutated; copies returned)
 * @param {array}    o.touchLogs   - existing touch logs
 * @param {Date|string} o.today    - the cycle date
 * @param {object}   o.provider    - EmailProvider with async send({to,toName,subject,html,text})
 * @param {boolean} [o.approved]   - override templates APPROVED flag (tests/dry-run)
 * @param {boolean} [o.dryRun]     - if true, never call provider.send
 * @returns {Promise<{customers, touchLogs, report}>}
 */
export async function runDailyCycle({ customers = [], touchLogs = [], today = new Date(), provider, approved, dryRun = false }) {
  const approveSend = approved === undefined ? TEMPLATES_APPROVED : approved;
  const todayStr = (typeof today === 'string' ? today : today.toISOString()).slice(0, 10);

  const nextCustomers = customers.map((c) => ({ ...c, pendingTexts: [...(c.pendingTexts || [])] }));
  const logs = [...touchLogs];
  const report = {
    date: todayStr,
    scanned: nextCustomers.length,
    skippedOptedOut: 0,
    emailsSent: 0,
    emailsHeld: 0,
    emailsFailed: 0,
    emailsRetrying: 0,
    textsQueued: 0,
    advanced: 0,
    logsPruned: 0,
    notes: [],
  };

  for (const c of nextCustomers) {
    if (isFrozen(c)) { report.skippedOptedOut++; continue; }

    const due = nextDueSequence(c, today);
    if (!due) continue;
    const seq = due.seq;

    // Whether this window is "done" for good. A transient email failure flips
    // this false so the stage is NOT advanced and the window retries tomorrow.
    let windowResolved = true;

    // ── Email branch ────────────────────────────────────────────────────────
    if (seq.channels.includes('email')) {
      const variant = 'direct'; // auto-emails use the steady Direct variant
      const tpl = getEmail(seq.key, variant);
      const subject = hydrate(tpl.subject, c);
      const body = hydrate(tpl.body, c);
      const lint = lintCopy(body, 'email');

      // Idempotency: if a prior cycle already logged a successful send for this
      // exact window, never send again — at-least-once without double-sending.
      const alreadySent = logs.some((l) => l.customerId === c.id && l.sequenceKey === seq.key && l.channel === 'email' && l.status === 'sent');
      // A window already logged as held just stays held — don't re-log it every
      // day while we wait, or a long pause would bloat the audit trail.
      const alreadyHeld = logs.some((l) => l.customerId === c.id && l.sequenceKey === seq.key && l.channel === 'email' && l.status === 'held');
      const logHeld = () => { if (!alreadyHeld) { logs.push(newTouchLog({ customerId: c.id, channel: 'email', sequenceKey: seq.key, variant, subject, body, status: 'held', sentAt: new Date().toISOString() })); report.emailsHeld++; } };

      if (alreadySent) {
        // nothing to do — this window's email is already out
      } else if (!lint.ok) {
        // Hydrated copy broke a guardrail (usually odd customer data). Hold and
        // flag, and DON'T advance — a held window must wait, never skip ahead.
        logHeld();
        if (!alreadyHeld) report.notes.push(`held ${c.id}/${seq.key}: ${lint.problems.join('; ')}`);
        windowResolved = false;
      } else if (!approveSend) {
        // Copy not approved yet = a genuine pause. Hold WITHOUT advancing so the
        // email actually goes out once approved, instead of marching past it.
        logHeld();
        windowResolved = false;
      } else if (!c.email) {
        report.notes.push(`no email on file for ${c.id}, skipped email branch`);
      } else if (dryRun || !provider) {
        report.emailsSent++; // counted for dry-run visibility; nothing sent
      } else {
        try {
          await provider.send({ to: c.email, toName: c.firstName, subject, text: body, html: toHtml(body) });
          logs.push(newTouchLog({ customerId: c.id, channel: 'email', sequenceKey: seq.key, variant, subject, body, status: 'sent', sentAt: new Date().toISOString() }));
          report.emailsSent++;
        } catch (err) {
          logs.push(newTouchLog({ customerId: c.id, channel: 'email', sequenceKey: seq.key, variant, subject, body, status: 'failed', sentAt: new Date().toISOString() }));
          report.emailsFailed++;
          report.notes.push(`email failed ${c.id}/${seq.key}: ${err && err.message ? err.message : err}`);
          // Count failures for THIS window (incl. the one just pushed). Under the
          // cap → leave the stage so tomorrow retries. At the cap → give up and
          // let the timeline advance so later windows aren't blocked forever.
          const failures = logs.filter((l) => l.customerId === c.id && l.sequenceKey === seq.key && l.channel === 'email' && l.status === 'failed').length;
          if (failures < MAX_EMAIL_RETRIES) {
            windowResolved = false;
            report.emailsRetrying++;
          } else {
            report.notes.push(`giving up on ${c.id}/${seq.key} after ${failures} attempts`);
          }
        }
      }
    }

    // ── Text branch (NEVER sent programmatically — only queued) ──────────────
    if (seq.channels.includes('text')) {
      const already = c.pendingTexts.some((p) => p.sequenceKey === seq.key);
      if (!already) {
        c.pendingTexts.push({ sequenceKey: seq.key, createdAt: new Date().toISOString() });
        report.textsQueued++;
      }
    }

    // ── Advance state forward (only if the window is resolved) ───────────────
    // The text branch above is idempotent (guards on sequenceKey), so a retry
    // tomorrow re-runs this window without re-queuing the text.
    if (windowResolved) {
      c.stage = (c.stage || 0) + 1;
      c.updatedAt = new Date().toISOString();
      report.advanced++;
    }
  }

  // ── Prune the audit trail (retention window) ────────────────────────────────
  const cutoff = Date.parse(todayStr + 'T00:00:00Z') - LOG_RETENTION_DAYS * 86400000;
  const keptLogs = logs.filter((l) => {
    const t = Date.parse(l.sentAt || '');
    return isNaN(t) || t >= cutoff; // keep anything undated or inside the window
  });
  report.logsPruned = logs.length - keptLogs.length;

  return { customers: nextCustomers, touchLogs: keptLogs, report };
}

/** Minimal, safe plain-text → HTML for the email body (keeps line breaks). */
export function toHtml(text) {
  const esc = String(text || '').replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]));
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.55;color:#1a1a1a">${esc.replace(/\n/g, '<br>')}</div>`;
}

export { isSameDay, sequenceByKey };
