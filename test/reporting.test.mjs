// test/reporting.test.mjs — referral / lead-source reporting (node --test).
//
// Run: `npm test` — node's built-in runner + assert, no installs.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { computeReferralStats, REFERRAL_SEQUENCE_KEY } from '../shared/reporting.mjs';
import { SEQUENCES } from '../shared/sequences.mjs';

// ── helpers ───────────────────────────────────────────────────────────────
const cust = (id, firstName, over = {}) => ({
  id, firstName, lastName: over.lastName ?? 'Test', category: 'sold',
  referredById: null, optedOut: false, ...over,
});
const log = (customerId, over = {}) => ({
  customerId, channel: 'email', sequenceKey: REFERRAL_SEQUENCE_KEY, status: 'sent',
  sentAt: '2026-07-01T00:00:00Z', ...over,
});

const ZERO = { asked: 0, received: 0, bought: 0, thankYouPending: 0, topSources: [], conversionPct: 0 };

// ── the sequence key really is the timeline's referral-ask window ───────────
test('REFERRAL_SEQUENCE_KEY matches the Referral Ask window in sequences.mjs', () => {
  const win = SEQUENCES.find((s) => s.key === REFERRAL_SEQUENCE_KEY);
  assert.ok(win, 'referral window exists in SEQUENCES');
  assert.equal(win.label, 'Referral Ask');
});

// ── empties + junk safety ────────────────────────────────────────────────────
test('empty inputs return zeroed stats', () => {
  assert.deepEqual(computeReferralStats([], []), ZERO);
});

test('junk inputs never throw and return zeroed stats', () => {
  assert.deepEqual(computeReferralStats(null, undefined), ZERO);
  assert.deepEqual(computeReferralStats('nope', 42), ZERO);
  assert.deepEqual(computeReferralStats({}, {}), ZERO);
  // sparse / malformed rows mixed in
  const s = computeReferralStats(
    [null, 'x', {}, cust('a', 'Al'), { id: 'b', referredById: 'a' }],
    [null, 'y', {}, { sequenceKey: REFERRAL_SEQUENCE_KEY }],
  );
  assert.equal(s.received, 1); // the b→a reference still counts
  assert.equal(s.asked, 0);    // log with no customerId doesn't
});

test('dangling and self references do not count as received', () => {
  const s = computeReferralStats([
    cust('a', 'Al', { referredById: 'ghost' }), // dangling
    cust('b', 'Bo', { referredById: 'b' }),     // self
  ], []);
  assert.equal(s.received, 0);
  assert.deepEqual(s.topSources, []);
});

// ── the referral chain: A referred B (bought) and C (not bought) ────────────
test('referral chain — received / bought / conversion / topSources', () => {
  const customers = [
    cust('a', 'Amy', { lastName: 'Anders' }),
    cust('b', 'Ben', { referredById: 'a', category: 'sold' }),
    cust('c', 'Cal', { referredById: 'a', category: 'hot' }),
  ];
  const s = computeReferralStats(customers, []);
  assert.equal(s.received, 2);
  assert.equal(s.bought, 1);
  assert.equal(s.conversionPct, 50);
  assert.deepEqual(s.topSources, [{ id: 'a', name: 'Amy Anders', count: 2, boughtCount: 1 }]);
});

// ── asked counts distinct customers, not logs ────────────────────────────────
test('asked counts distinct customers across channels and ignores non-sent / other keys', () => {
  const customers = [cust('a', 'Amy'), cust('b', 'Ben'), cust('c', 'Cal')];
  const logs = [
    log('a'),                                  // sent email
    log('a', { channel: 'text' }),             // same customer again — still 1
    log('b', { channel: 'text' }),             // second distinct customer
    log('c', { status: 'held' }),              // held doesn't count
    log('c', { sequenceKey: 'welcome' }),      // other window doesn't count
    log('c', { channel: 'task' }),             // non email/text doesn't count
  ];
  assert.equal(computeReferralStats(customers, logs).asked, 2);
});

// ── thank-you loop matches the dashboard card's logic ────────────────────────
test('thankYouPending — unthanked and not frozen, exactly like sectionReferral', () => {
  const customers = [
    cust('a', 'Amy'),
    cust('b', 'Ben', { referredById: 'a' }),                          // pending
    cust('c', 'Cal', { referredById: 'a', referrerThanked: true }),   // thanked
    cust('d', 'Dee', { referredById: 'a', optedOut: true }),          // frozen
  ];
  const s = computeReferralStats(customers, []);
  assert.equal(s.received, 3);
  assert.equal(s.thankYouPending, 1);
});

// ── topSources ordering + cap ────────────────────────────────────────────────
test('topSources sorts by count desc and caps at 5', () => {
  const customers = [];
  // 6 referrers: referrer r1 gets 1 referral, r2 gets 2, ... r6 gets 6.
  for (let r = 1; r <= 6; r++) {
    customers.push(cust(`r${r}`, `Ref${r}`, { lastName: '' }));
    for (let i = 0; i < r; i++) {
      customers.push(cust(`r${r}_kid${i}`, 'Kid', { referredById: `r${r}`, category: i === 0 ? 'sold' : 'cold' }));
    }
  }
  const s = computeReferralStats(customers, []);
  assert.equal(s.topSources.length, 5);
  assert.deepEqual(s.topSources.map((t) => t.id), ['r6', 'r5', 'r4', 'r3', 'r2']); // r1 squeezed out
  assert.deepEqual(s.topSources.map((t) => t.count), [6, 5, 4, 3, 2]);
  assert.equal(s.topSources[0].name, 'Ref6'); // trimmed — no trailing space from empty lastName
  assert.ok(s.topSources.every((t) => t.boughtCount === 1));
});

test('conversionPct rounds and is 0 when nothing received', () => {
  const customers = [
    cust('a', 'Amy'),
    cust('b', 'Ben', { referredById: 'a', category: 'sold' }),
    cust('c', 'Cal', { referredById: 'a', category: 'cold' }),
    cust('d', 'Dee', { referredById: 'a', category: 'hot' }),
  ];
  assert.equal(computeReferralStats(customers, []).conversionPct, 33); // 1/3
  assert.equal(computeReferralStats([cust('a', 'Amy')], []).conversionPct, 0);
});
