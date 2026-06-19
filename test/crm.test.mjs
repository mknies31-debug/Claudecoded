// test/crm.test.mjs — dependency-free regression suite (node --test).
//
// Run: `npm test`  (uses node's built-in test runner + assert — no installs).
//
// These tests lock the guardrails the blueprint treats as law and prove that
// swapping the EmailProvider does not regress the core loop.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { newCustomer, validateCustomer, KEYS } from '../shared/schema.mjs';
import { SEQUENCES, nextDueSequence, daysSincePurchase, isStagnant, isComplete } from '../shared/sequences.mjs';
import { hydrate, tokensIn } from '../shared/hydrate.mjs';
import { lintCopy, countSentences, valueViolations, isFrozen } from '../shared/compliance.mjs';
import { TEMPLATES, VARIANTS, getText, getEmail } from '../shared/templates.mjs';
import { runDailyCycle } from '../shared/engine.mjs';

// ── helpers ───────────────────────────────────────────────────────────────
function daysAgo(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/** A mock provider that records every send — the heart of the swap test. */
class MockProvider {
  constructor(name = 'mock') { this.name = name; this.sent = []; this.fail = false; }
  async send(msg) {
    if (this.fail) throw new Error('simulated provider failure');
    this.sent.push(msg);
    return { ok: true, id: 'mock_' + this.sent.length };
  }
}

// ── schema ──────────────────────────────────────────────────────────────────
test('newCustomer fills safe defaults', () => {
  const c = newCustomer({ firstName: 'Dale', vehicle: 'F-150', phone: '5075551212' });
  assert.equal(c.stage, 0);
  assert.equal(c.optedOut, false);
  assert.deepEqual(c.pendingTexts, []);
  assert.match(c.purchaseDate, /^\d{4}-\d{2}-\d{2}$/);
});

test('validateCustomer requires name, vehicle, and a contact method', () => {
  assert.equal(validateCustomer({}).ok, false);
  assert.equal(validateCustomer({ firstName: 'A', vehicle: 'B', purchaseDate: '2025-01-01' }).ok, false); // no contact
  assert.equal(validateCustomer({ firstName: 'A', vehicle: 'B', purchaseDate: '2025-01-01', email: 'x@y.com' }).ok, true);
  assert.equal(validateCustomer({ firstName: 'A', vehicle: 'B', purchaseDate: '2025-01-01', phone: '5075551212' }).ok, true);
  assert.equal(validateCustomer({ firstName: 'A', vehicle: 'B', purchaseDate: '2025-01-01', email: 'bad' }).ok, false);
});

test('CRM owns its own namespaced keys', () => {
  assert.ok(KEYS.customers.startsWith('carvis_referral_'));
  assert.ok(KEYS.touchLogs.startsWith('carvis_referral_'));
});

// ── sequences ─────────────────────────────────────────────────────────────
test('daysSincePurchase computes whole days', () => {
  assert.equal(daysSincePurchase({ purchaseDate: daysAgo(10) }, new Date()), 10);
});

test('nextDueSequence respects stage order and day thresholds', () => {
  const c = newCustomer({ firstName: 'A', vehicle: 'B', email: 'a@b.com', purchaseDate: daysAgo(0) });
  assert.equal(nextDueSequence(c, new Date()), null); // day 0, welcome needs day 1
  const c2 = { ...c, purchaseDate: daysAgo(2) };
  assert.equal(nextDueSequence(c2, new Date()).seq.key, 'welcome');
  const c3 = { ...c, purchaseDate: daysAgo(50), stage: 2 };
  assert.equal(nextDueSequence(c3, new Date()).seq.key, 'referral');
});

test('opted-out and completed customers are never due', () => {
  const base = newCustomer({ firstName: 'A', vehicle: 'B', email: 'a@b.com', purchaseDate: daysAgo(400) });
  assert.equal(nextDueSequence({ ...base, optedOut: true }, new Date()), null);
  assert.equal(isComplete({ ...base, stage: SEQUENCES.length }), true);
  assert.equal(nextDueSequence({ ...base, stage: SEQUENCES.length }, new Date()), null);
});

test('isStagnant flags a due record that has not advanced in >7 days', () => {
  const stale = newCustomer({ firstName: 'A', vehicle: 'B', email: 'a@b.com', purchaseDate: daysAgo(30) });
  stale.updatedAt = new Date(Date.now() - 9 * 86400000).toISOString();
  assert.equal(isStagnant(stale, new Date()), true);
  const fresh = { ...stale, updatedAt: new Date().toISOString() };
  assert.equal(isStagnant(fresh, new Date()), false);
});

// ── hydrate ─────────────────────────────────────────────────────────────────
test('hydrate replaces only supported tokens', () => {
  const out = hydrate('Hi {{first_name}}, the {{vehicle}} {{unknown}}', { firstName: 'Dale', vehicle: 'F-150' });
  assert.equal(out, 'Hi Dale, the F-150 {{unknown}}'); // unknown stays literal
});

// ── compliance: every template must pass, on every variant ──────────────────
test('countSentences basics', () => {
  assert.equal(countSentences('One. Two. Three.'), 3);
  assert.equal(countSentences('Just one'), 1);
});

test('ALL text templates obey size + zero-value + tone rules', () => {
  for (const key of Object.keys(TEMPLATES)) {
    for (const v of VARIANTS) {
      const txt = getText(key, v);
      const res = lintCopy(txt, 'text');
      assert.ok(res.ok, `text ${key}/${v} violates: ${res.problems.join('; ')} :: "${txt}"`);
      // tokens must be in the supported set
      tokensIn(txt).forEach((t) => assert.ok(['first_name', 'vehicle'].includes(t), `bad token ${t} in ${key}/${v}`));
    }
  }
});

test('ALL email templates obey size + zero-value + tone rules', () => {
  for (const key of Object.keys(TEMPLATES)) {
    for (const v of VARIANTS) {
      const { subject, body } = getEmail(key, v);
      const res = lintCopy(body, 'email');
      assert.ok(res.ok, `email ${key}/${v} body violates: ${res.problems.join('; ')}`);
      assert.equal(valueViolations(subject).length, 0, `subject ${key}/${v} has value language`);
      assert.ok(!/!/.test(subject), `subject ${key}/${v} has an exclamation mark`);
    }
  }
});

test('isFrozen tracks optedOut', () => {
  assert.equal(isFrozen({ optedOut: true }), true);
  assert.equal(isFrozen({ optedOut: false }), false);
});

// ── engine ──────────────────────────────────────────────────────────────────
test('engine holds emails when copy is not approved, but still queues texts', async () => {
  const c = newCustomer({ firstName: 'Dale', vehicle: 'F-150', email: 'd@x.com', phone: '5075551212', purchaseDate: daysAgo(2) });
  const mock = new MockProvider();
  const { customers, touchLogs, report } = await runDailyCycle({ customers: [c], touchLogs: [], provider: mock, approved: false });
  assert.equal(mock.sent.length, 0, 'nothing sent while unapproved');
  assert.equal(report.emailsHeld, 1);
  assert.equal(report.textsQueued, 1);
  assert.equal(customers[0].stage, 1, 'stage advanced');
  assert.ok(touchLogs.some((l) => l.channel === 'email' && l.status === 'held'));
  assert.equal(customers[0].pendingTexts.length, 1);
});

test('engine sends via the injected provider when approved', async () => {
  const c = newCustomer({ firstName: 'Dale', vehicle: 'F-150', email: 'd@x.com', purchaseDate: daysAgo(2) });
  const mock = new MockProvider();
  const { report } = await runDailyCycle({ customers: [c], touchLogs: [], provider: mock, approved: true });
  assert.equal(mock.sent.length, 1);
  assert.equal(report.emailsSent, 1);
  assert.equal(mock.sent[0].to, 'd@x.com');
  assert.ok(mock.sent[0].subject.includes('F-150'));
});

test('engine skips opted-out customers entirely', async () => {
  const c = newCustomer({ firstName: 'Dale', vehicle: 'F-150', email: 'd@x.com', purchaseDate: daysAgo(2), optedOut: true });
  const mock = new MockProvider();
  const { customers, report } = await runDailyCycle({ customers: [c], touchLogs: [], provider: mock, approved: true });
  assert.equal(mock.sent.length, 0);
  assert.equal(report.skippedOptedOut, 1);
  assert.equal(customers[0].stage, 0);
});

test('provider swap does not regress the loop (mock A vs mock B identical)', async () => {
  const make = () => newCustomer({ firstName: 'Dale', vehicle: 'F-150', email: 'd@x.com', purchaseDate: daysAgo(2) });
  const a = new MockProvider('A');
  const b = new MockProvider('B');
  const ra = await runDailyCycle({ customers: [make()], touchLogs: [], provider: a, approved: true });
  const rb = await runDailyCycle({ customers: [make()], touchLogs: [], provider: b, approved: true });
  assert.deepEqual(
    { sent: a.sent.length, ...strip(ra.report) },
    { sent: b.sent.length, ...strip(rb.report) },
  );
});

test('a failing provider is logged, not thrown', async () => {
  const c = newCustomer({ firstName: 'Dale', vehicle: 'F-150', email: 'd@x.com', purchaseDate: daysAgo(2) });
  const mock = new MockProvider(); mock.fail = true;
  const { touchLogs, report } = await runDailyCycle({ customers: [c], touchLogs: [], provider: mock, approved: true });
  assert.equal(report.emailsFailed, 1);
  assert.ok(touchLogs.some((l) => l.status === 'failed'));
});

function strip(report) { const { date, ...rest } = report; return rest; }
