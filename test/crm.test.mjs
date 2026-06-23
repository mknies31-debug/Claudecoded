// test/crm.test.mjs — dependency-free regression suite (node --test).
//
// Run: `npm test`  (uses node's built-in test runner + assert — no installs).
//
// These tests lock the guardrails the blueprint treats as law and prove that
// swapping the EmailProvider does not regress the core loop.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { newCustomer, validateCustomer, KEYS } from '../shared/schema.mjs';
import { SEQUENCES, nextDueSequence, daysSincePurchase, isStagnant, isThroughFixedSequence, followupForStage, stageForElapsedDays, localDateStr } from '../shared/sequences.mjs';
import { parseCSV, planImport } from '../shared/import.mjs';
import { hydrate, tokensIn } from '../shared/hydrate.mjs';
import { lintCopy, countSentences, valueViolations, isFrozen } from '../shared/compliance.mjs';
import { TEMPLATES, VARIANTS, getText, getEmail } from '../shared/templates.mjs';
import { runDailyCycle } from '../shared/engine.mjs';
import { INTAKE_STEPS, isSkip, parseFullName, extractPhone, parseSpokenEmail, applyAnswer, parseExtraction } from '../shared/intake.mjs';

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
  assert.deepEqual(c.pendingTasks, []);
  assert.equal(c.photo, ''); // optional profile picture defaults empty
  assert.match(c.purchaseDate, /^\d{4}-\d{2}-\d{2}$/);
});

test('newCustomer keeps a provided profile photo data URL', () => {
  const url = 'data:image/jpeg;base64,abc123';
  assert.equal(newCustomer({ firstName: 'A', phone: '5075551212', photo: url }).photo, url);
  assert.equal(newCustomer({ firstName: 'A', phone: '5075551212', photo: 42 }).photo, ''); // non-string ignored
});

test('validateCustomer requires only name + phone (everything else optional)', () => {
  assert.equal(validateCustomer({}).ok, false);
  assert.equal(validateCustomer({ firstName: 'A' }).ok, false); // no phone
  assert.equal(validateCustomer({ phone: '5075551212' }).ok, false); // no name
  assert.equal(validateCustomer({ firstName: 'A', phone: '5075551212' }).ok, true); // name + phone is enough
  assert.equal(validateCustomer({ firstName: 'A', phone: '123' }).ok, false); // too short
  assert.equal(validateCustomer({ firstName: 'A', phone: '5075551212', email: 'bad' }).ok, false); // bad email
  assert.equal(validateCustomer({ firstName: 'A', phone: '5075551212', email: 'a@b.com', vehicle: '', address: '' }).ok, true);
});

test('newCustomer carries address + notes', () => {
  const c = newCustomer({ firstName: 'A', phone: '5075551212', address: '123 Main', notes: 'trade-in' });
  assert.equal(c.address, '123 Main');
  assert.equal(c.notes, 'trade-in');
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

test('opted-out never due; the sequence rolls into recurring follow-ups', () => {
  const base = newCustomer({ firstName: 'A', vehicle: 'B', email: 'a@b.com', purchaseDate: daysAgo(400) });
  assert.equal(nextDueSequence({ ...base, optedOut: true }, new Date()), null);
  assert.equal(isThroughFixedSequence({ ...base, stage: SEQUENCES.length }), true);
  // stage 5, day 400 < first recurring touch (455) → not due yet
  assert.equal(nextDueSequence({ ...base, stage: SEQUENCES.length }, new Date()), null);
});

test('recurring 90-day follow-ups rotate Call → Text → Email → Video → Gift', () => {
  const base = newCustomer({ firstName: 'A', vehicle: 'B', email: 'a@b.com', purchaseDate: daysAgo(1000) });
  const types = [0, 1, 2, 3, 4, 5].map((k) => nextDueSequence({ ...base, stage: SEQUENCES.length + k }, new Date()).seq.type);
  assert.deepEqual(types, ['call', 'text', 'email', 'video', 'gift', 'call']);
  assert.equal(followupForStage(SEQUENCES.length).day, 455); // 90 days after the anniversary
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
  assert.equal(customers[0].stage, 0, 'a held window does NOT advance — it waits (C1)');
  assert.ok(touchLogs.some((l) => l.channel === 'email' && l.status === 'held'));
  assert.equal(customers[0].pendingTexts.length, 1);
});

test('a held email actually sends once approved (pause, not skip) — C1', async () => {
  let c = newCustomer({ firstName: 'Dale', vehicle: 'F-150', email: 'd@x.com', phone: '5075551212', purchaseDate: daysAgo(2) });
  // Day 1: copy held → window waits, no send, stage stays put.
  let r1 = await runDailyCycle({ customers: [c], touchLogs: [], provider: new MockProvider(), approved: false });
  assert.equal(r1.customers[0].stage, 0);
  // Day 2: still held → don't re-log the hold (no audit-trail bloat).
  let r2 = await runDailyCycle({ customers: r1.customers, touchLogs: r1.touchLogs, provider: new MockProvider(), approved: false });
  assert.equal(r2.report.emailsHeld, 0, 'held window is not re-logged every day');
  // Day 3: approved → the previously-held welcome email finally goes out.
  const mock = new MockProvider();
  let r3 = await runDailyCycle({ customers: r2.customers, touchLogs: r2.touchLogs, provider: mock, approved: true });
  assert.equal(mock.sent.length, 1, 'the held email sends after approval');
  assert.equal(r3.customers[0].stage, 1, 'and only now does it advance');
});

test('engine prunes touch logs past the retention window (H3)', async () => {
  const c = newCustomer({ firstName: 'Dale', vehicle: 'F-150', email: 'd@x.com', purchaseDate: daysAgo(2) });
  const old = { customerId: 'old', sequenceKey: 'welcome', channel: 'email', status: 'sent', sentAt: daysAgo(500) + 'T12:00:00Z' };
  const recent = { customerId: 'rec', sequenceKey: 'welcome', channel: 'email', status: 'sent', sentAt: daysAgo(30) + 'T12:00:00Z' };
  const { touchLogs, report } = await runDailyCycle({ customers: [c], touchLogs: [old, recent], today: daysAgo(0), provider: new MockProvider(), approved: true });
  assert.equal(report.logsPruned, 1, 'the 500-day-old log is pruned');
  assert.ok(!touchLogs.some((l) => l.customerId === 'old'), 'old log gone');
  assert.ok(touchLogs.some((l) => l.customerId === 'rec'), 'recent log kept');
});

test('localDateStr returns the calendar date in the business timezone (H1)', () => {
  // 02:30 UTC on Jun 22 is still 21:30 (9:30pm) on Jun 21 in Central time.
  assert.equal(localDateStr(new Date('2026-06-22T02:30:00Z')), '2026-06-21');
  assert.equal(localDateStr(new Date('2026-06-22T18:00:00Z')), '2026-06-22');
});

test('engine queues a task (not an email) for a call follow-up', async () => {
  // stage = SEQUENCES.length → first recurring touch is "call", due at day 455
  const c = newCustomer({ firstName: 'Dale', vehicle: 'F-150', email: 'd@x.com', purchaseDate: daysAgo(500), stage: SEQUENCES.length });
  const mock = new MockProvider();
  const { customers, report } = await runDailyCycle({ customers: [c], touchLogs: [], today: daysAgo(0), provider: mock, approved: true });
  assert.equal(mock.sent.length, 0, 'a call is never auto-emailed');
  assert.equal(report.tasksQueued, 1);
  assert.equal(customers[0].pendingTasks[0].type, 'call');
  assert.ok(customers[0].pendingTasks[0].script.includes('F-150'), 'script is hydrated');
  assert.equal(customers[0].stage, SEQUENCES.length + 1, 'advances to the next recurring touch');
});

test('engine auto-sends the recurring email touch', async () => {
  // stage = SEQUENCES.length + 2 → "email" recurring touch, due at day 635
  const c = newCustomer({ firstName: 'Dale', vehicle: 'F-150', email: 'd@x.com', purchaseDate: daysAgo(700), stage: SEQUENCES.length + 2 });
  const mock = new MockProvider();
  const { report } = await runDailyCycle({ customers: [c], touchLogs: [], today: daysAgo(0), provider: mock, approved: true });
  assert.equal(mock.sent.length, 1);
  assert.equal(report.tasksQueued, 0);
  assert.ok(mock.sent[0].subject.length > 0);
});

test('recurring follow-up copy obeys the compliance rules', () => {
  for (const v of VARIANTS) {
    assert.ok(lintCopy(getText('followup_text', v), 'text').ok, `followup text/${v}`);
    assert.ok(lintCopy(getEmail('followup_email', v).body, 'email').ok, `followup email/${v}`);
  }
});

// ── bulk CSV import ───────────────────────────────────────────────────────────
test('parseCSV handles quoted fields with commas and newlines', () => {
  const rows = parseCSV('a,b\n"x,y","line1\nline2"');
  assert.deepEqual(rows[0], ['a', 'b']);
  assert.equal(rows[1][0], 'x,y');
  assert.ok(rows[1][1].includes('\n'));
});

test('planImport maps flexible headers, dedupes, validates, and stages by date', () => {
  const existing = [newCustomer({ firstName: 'Existing', phone: '5075550000' })];
  const csv = [
    'First Name,Last Name,Cell,Email,Vehicle,Purchase Date',
    'Dale,Carlson,507-555-0101,dale@x.com,2019 F-150,2026-06-01',
    'Brenda,Smith,(507) 555-0102,,2020 RAV4,2024-01-01',
    'NoPhone,Person,,,,',
    'Dup,Again,5075550000,,,',
  ].join('\n');
  const p = planImport(csv, existing, '2026-06-22');
  assert.equal(p.counts.total, 4);
  assert.equal(p.counts.ready, 2);
  assert.equal(p.counts.invalid, 1);
  assert.equal(p.counts.duplicate, 1);
  // Dale bought 21 days ago → welcome(1) + checkin(14) passed, next is referral → stage 2
  assert.equal(p.items[0].input.stage, 2);
  // Brenda bought ~2.4 years ago → past all five fixed windows
  assert.ok(p.items[1].input.stage >= SEQUENCES.length);
});

test('planImport falls back to positional columns with no header', () => {
  const p = planImport('Dale,Carlson,5075550101', [], '2026-06-22');
  assert.equal(p.counts.ready, 1);
  assert.equal(p.items[0].input.firstName, 'Dale');
  assert.equal(p.items[0].input.lastName, 'Carlson');
});

test('stageForElapsedDays slots elapsed customers to the next due window', () => {
  assert.equal(stageForElapsedDays(0), 0);
  assert.equal(stageForElapsedDays(21), 2);   // past welcome + checkin
  assert.equal(stageForElapsedDays(200), 4);  // past welcome/checkin/referral/service
  assert.ok(stageForElapsedDays(1000) >= SEQUENCES.length);
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

test('a failed email leaves the stage put so it retries tomorrow', async () => {
  const c = newCustomer({ firstName: 'Dale', vehicle: 'F-150', email: 'd@x.com', purchaseDate: daysAgo(2) });
  const mock = new MockProvider(); mock.fail = true;
  const { customers, report } = await runDailyCycle({ customers: [c], touchLogs: [], provider: mock, approved: true });
  assert.equal(customers[0].stage, 0, 'stage NOT advanced on a transient failure');
  assert.equal(report.advanced, 0);
  assert.equal(report.emailsRetrying, 1);
});

test('after the retry cap, the engine gives up and lets the timeline advance', async () => {
  const c = newCustomer({ firstName: 'Dale', vehicle: 'F-150', email: 'd@x.com', purchaseDate: daysAgo(2) });
  // two prior failures already logged for this window → today's is the 3rd
  const priorFails = [
    { customerId: c.id, sequenceKey: 'welcome', channel: 'email', status: 'failed' },
    { customerId: c.id, sequenceKey: 'welcome', channel: 'email', status: 'failed' },
  ];
  const mock = new MockProvider(); mock.fail = true;
  const { customers, report } = await runDailyCycle({ customers: [c], touchLogs: priorFails, provider: mock, approved: true });
  assert.equal(customers[0].stage, 1, 'gives up and advances after the cap');
  assert.equal(report.emailsRetrying, 0);
  assert.ok(report.notes.some((n) => /giving up/.test(n)));
});

test('engine never re-sends a window already marked sent (idempotent)', async () => {
  const c = newCustomer({ firstName: 'Dale', vehicle: 'F-150', email: 'd@x.com', purchaseDate: daysAgo(2) });
  const priorSent = [{ customerId: c.id, sequenceKey: 'welcome', channel: 'email', status: 'sent' }];
  const mock = new MockProvider();
  const { customers, report } = await runDailyCycle({ customers: [c], touchLogs: priorSent, provider: mock, approved: true });
  assert.equal(mock.sent.length, 0, 'no duplicate send');
  assert.equal(report.emailsSent, 0);
  assert.equal(customers[0].stage, 1, 'still advances past the already-sent window');
});

test('hydrate falls back gracefully when vehicle is missing', () => {
  assert.equal(hydrate('hope the {{vehicle}} is good', { firstName: 'Dale' }), 'hope the vehicle is good');
  assert.equal(hydrate('the {{vehicle}}', { firstName: 'A', vehicle: '  ' }), 'the vehicle');
});

function strip(report) { const { date, ...rest } = report; return rest; }

// ── intake (voice + photo) ───────────────────────────────────────────────────
test('intake steps: only name + phone are required', () => {
  const req = INTAKE_STEPS.filter((s) => s.required).map((s) => s.key);
  assert.deepEqual(req, ['name', 'phone']);
});

test('isSkip recognizes skip words and blanks', () => {
  ['skip', 'none', 'no', 'n/a', "I don't have it", 'nothing', '', '  '].forEach((w) => assert.equal(isSkip(w), true, w));
  ['Dale', '5075551212', 'F-150'].forEach((w) => assert.equal(isSkip(w), false, w));
});

test('parseFullName splits first/last and strips filler', () => {
  assert.deepEqual(parseFullName('Dale Carlson'), { firstName: 'Dale', lastName: 'Carlson' });
  assert.deepEqual(parseFullName('his name is Mary Jo Smith'), { firstName: 'Mary', lastName: 'Jo Smith' });
  assert.deepEqual(parseFullName('Dale'), { firstName: 'Dale', lastName: '' });
});

test('extractPhone handles digits and spoken numbers', () => {
  assert.equal(extractPhone('507-555-0101'), '(507) 555-0101');
  assert.equal(extractPhone('1 507 555 0101'), '(507) 555-0101');
  assert.equal(extractPhone('five oh seven five five five oh one oh one'), '(507) 555-0101');
});

test('parseSpokenEmail rebuilds an address', () => {
  assert.equal(parseSpokenEmail('dale at gmail dot com'), 'dale@gmail.com');
});

test('applyAnswer routes each field to the right parser', () => {
  let d = {};
  d = applyAnswer(d, 'name', 'Dale Carlson');
  d = applyAnswer(d, 'phone', '507 555 0101');
  d = applyAnswer(d, 'vehicle', '2019 F-150');
  assert.equal(d.firstName, 'Dale'); assert.equal(d.lastName, 'Carlson');
  assert.equal(d.phone, '(507) 555-0101'); assert.equal(d.vehicle, '2019 F-150');
});

test('parseExtraction reads JSON from a photo reply (even fenced/with prose)', () => {
  const reply = 'Here you go:\n```json\n{"firstName":"Dale","lastName":"Carlson","phone":"507-555-0101","email":"d@x.com","address":"123 Main","vehicle":"F-150","notes":""}\n```';
  const d = parseExtraction(reply);
  assert.equal(d.firstName, 'Dale');
  assert.equal(d.phone, '(507) 555-0101');
  assert.equal(d.vehicle, 'F-150');
  assert.equal(parseExtraction('no json here'), null);
});
