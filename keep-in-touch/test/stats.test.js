'use strict';
// node test/stats.test.js — zero deps.
const assert = require('assert');
const path = require('path');
const STATS = require(path.join(__dirname, '..', 'netlify', 'functions', 'lib', 'stats.js'));

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { console.log('  FAIL ' + name + '\n       ' + (e && e.message)); process.exitCode = 1; }
}

const TODAY = '2026-09-15';

// ---------- fixtures ----------
const customers = [
  { id: 'c_dan', name: 'Dan Halvorson', status: 'active', saleDate: '2025-06-10', createdAt: '2025-06-10T15:00:00.000Z',
    referredBy: '', purchases: [{ saleDate: '2025-06-10', vehicleLabel: '2019 Silverado' }] },
  { id: 'c_amy', name: 'Amy Lund', status: 'active', saleDate: '2026-08-20', createdAt: '2026-08-20T20:00:00.000Z',
    referredBy: 'c_dan', referredByName: 'Dan Halvorson', attributedTouchId: 't_dan_4',
    purchases: [{ saleDate: '2026-08-20' }] },
  { id: 'c_bo', name: 'Bo Tran', status: 'active', saleDate: '2026-09-02', createdAt: '2026-09-03T01:30:00.000Z', // 8:30pm Chicago Sep 2
    referredBy: 'c_dan', referredByName: 'Dan Halvorson', attributedTouchId: '',
    purchases: [{ saleDate: '2026-09-02' }] },
  { id: 'c_kay', name: 'Kay Olsen', status: 'dnc', saleDate: '2024-03-01', createdAt: '2024-03-01T15:00:00.000Z',
    referredBy: '', purchases: [{ saleDate: '2024-03-01' }, { saleDate: '2026-07-14' }, { saleDate: '2023-01-05' }] },
  { id: 'c_liz', name: 'Liz Berg', status: 'active', saleDate: '2026-05-01', createdAt: '2026-05-01T15:00:00.000Z',
    referredBy: 'c_kay', referredByName: 'Kay Olsen', attributedTouchId: 't_missing',
    purchases: [{ saleDate: '2026-05-01' }] },
];

const touches = [
  { id: 't_dan_0', customerId: 'c_dan', touchN: 0, slot: 'THANKS',   templateId: 'thanks-01', status: 'sent', sentDate: '2025-06-13', sentAt: '2025-06-13T14:00:00.000Z' },
  { id: 't_dan_1', customerId: 'c_dan', touchN: 1, slot: 'VALUE',    templateId: 'value-fall-01', status: 'sent', sentDate: '2025-09-08', sentAt: '2025-09-08T14:00:00.000Z' },
  { id: 't_dan_2', customerId: 'c_dan', touchN: 2, slot: 'CHECKIN',  templateId: 'checkin-01', status: 'skipped', sentDate: '' },
  { id: 't_dan_3', customerId: 'c_dan', touchN: 3, slot: 'VALUE',    templateId: 'value-spring-01', status: 'sent', sentDate: '2026-03-07', sentAt: '2026-03-07T14:00:00.000Z' },
  { id: 't_dan_4', customerId: 'c_dan', touchN: 4, slot: 'REFERRAL', templateId: 'referral-01', status: 'sent', sentDate: '2026-08-01', sentAt: '2026-08-01T14:00:00.000Z' },
  { id: 't_dan_5', customerId: 'c_dan', touchN: 5, slot: 'VALUE',    templateId: 'value-fall-01', status: 'sent', sentDate: '2026-09-10', sentAt: '2026-09-10T14:00:00.000Z' },
  { id: 't_kay_0', customerId: 'c_kay', touchN: 0, slot: 'THANKS',   templateId: 'thanks-01', status: 'sent', sentDate: '2024-03-04', sentAt: '2024-03-04T14:00:00.000Z' },
  { id: 't_kay_1', customerId: 'c_kay', touchN: 1, slot: 'VALUE',    templateId: 'value-any-01', status: 'sent', sentDate: '2024-06-02', sentAt: '2024-06-02T14:00:00.000Z' },
  { id: 't_amy_0', customerId: 'c_amy', touchN: 0, slot: 'THANKS',   templateId: 'thanks-02', status: 'sent', sentDate: '2026-08-23', sentAt: '2026-08-23T14:00:00.000Z' },
];

const replies = [
  // explicit touchId
  { id: 'r1', customerId: 'c_dan', touchId: 't_dan_1', receivedDate: '2025-09-10', receivedAt: '2025-09-10T16:00:00.000Z' },
  // no touchId -> should land on t_dan_4 (sent 2026-08-01, 5 days before)
  { id: 'r2', customerId: 'c_dan', touchId: '', receivedDate: '2026-08-06', receivedAt: '2026-08-06T16:00:00.000Z' },
  // second reply to the same touch (counts once)
  { id: 'r3', customerId: 'c_dan', touchId: 't_dan_4', receivedDate: '2026-08-07' },
  // 50 days after t_kay_1 -> unattributed
  { id: 'r4', customerId: 'c_kay', touchId: '', receivedDate: '2024-07-22' },
  // phone call logged for Amy, no touchId -> t_amy_0
  { id: 'r5', customerId: 'c_amy', touchId: '', channel: 'phone', receivedAt: '2026-08-25T20:00:00.000Z' },
];

console.log('stats.test.js');

// ---------- attributeReply ----------
test('attributeReply: explicit touchId wins', () => {
  assert.strictEqual(STATS.attributeReply(replies[0], touches).id, 't_dan_1');
});
test('attributeReply: no touchId -> latest sent touch on/before receivedDate within 45 days', () => {
  assert.strictEqual(STATS.attributeReply(replies[1], touches).id, 't_dan_4');
});
test('attributeReply: 50 days after the last touch -> null', () => {
  assert.strictEqual(STATS.attributeReply(replies[3], touches), null);
});
test('attributeReply: exactly 45 days is still attributed, 46 is not', () => {
  const r45 = { customerId: 'c_kay', receivedDate: '2024-07-17' };
  const r46 = { customerId: 'c_kay', receivedDate: '2024-07-18' };
  assert.strictEqual(STATS.attributeReply(r45, touches).id, 't_kay_1');
  assert.strictEqual(STATS.attributeReply(r46, touches), null);
});
test('attributeReply: never attributes to a touch sent after the reply', () => {
  const r = { customerId: 'c_dan', receivedDate: '2026-09-09' };
  assert.strictEqual(STATS.attributeReply(r, touches).id, 't_dan_4'); // not t_dan_5 (sent 09-10)
});
test('attributeReply: ignores other customers\' touches and skipped touches', () => {
  const r = { customerId: 'c_bo', receivedDate: '2026-09-11' };
  assert.strictEqual(STATS.attributeReply(r, touches), null);
});
test('attributeReply: uses receivedAt (ISO -> Chicago date) when receivedDate missing', () => {
  assert.strictEqual(STATS.attributeReply(replies[4], touches).id, 't_amy_0');
});
test('attributeReply: unknown touchId falls back to date attribution', () => {
  const r = { customerId: 'c_dan', touchId: 'nope', receivedDate: '2026-08-06' };
  assert.strictEqual(STATS.attributeReply(r, touches).id, 't_dan_4');
});
test('attributeReply: garbage in -> null', () => {
  assert.strictEqual(STATS.attributeReply(null, touches), null);
  assert.strictEqual(STATS.attributeReply({ customerId: 'c_dan' }, touches), null);
  assert.strictEqual(STATS.attributeReply({ customerId: 'c_dan', receivedDate: '2026-08-06' }, undefined), null);
});

// ---------- replyRateBySlot ----------
test('replyRateBySlot: counts sent touches and distinct replied touches', () => {
  const rows = STATS.replyRateBySlot(touches, replies);
  const by = {}; rows.forEach(r => { by[r.slot] = r; });
  assert.deepStrictEqual(Object.keys(by).sort(), ['REFERRAL', 'THANKS', 'VALUE']);
  assert.strictEqual(by.THANKS.sent, 3);
  assert.strictEqual(by.THANKS.replied, 1); // Amy's phone call
  assert.strictEqual(by.VALUE.sent, 4);
  assert.strictEqual(by.VALUE.replied, 1); // r1 only; r4 unattributed
  assert.strictEqual(by.REFERRAL.sent, 1);
  assert.strictEqual(by.REFERRAL.replied, 1); // r2 + r3 -> same touch, counted once
  assert.strictEqual(by.REFERRAL.rate, 1);
  assert.ok(Math.abs(by.VALUE.rate - 0.25) < 1e-9);
});
test('replyRateBySlot: ordered by slot order (THANKS before VALUE before REFERRAL)', () => {
  const slots = STATS.replyRateBySlot(touches, replies).map(r => r.slot);
  assert.deepStrictEqual(slots, ['THANKS', 'VALUE', 'REFERRAL']);
});
test('replyRateBySlot: skipped touches are not "sent"', () => {
  const rows = STATS.replyRateBySlot(touches, replies);
  assert.ok(!rows.some(r => r.slot === 'CHECKIN'));
});
test('replyRateBySlot: no data -> empty array', () => {
  assert.deepStrictEqual(STATS.replyRateBySlot([], []), []);
  assert.deepStrictEqual(STATS.replyRateBySlot(undefined, null), []);
});

// ---------- replyRateByTemplate ----------
function mkSent(n, templateId, slot, replyEvery) {
  const ts = [], rs = [];
  for (let i = 0; i < n; i++) {
    const d = '2026-0' + (1 + (i % 8)) + '-' + (10 + (i % 15));
    const id = templateId + '_' + i;
    ts.push({ id, customerId: 'x' + i, slot, templateId, status: 'sent', sentDate: d });
    if (replyEvery && i % replyEvery === 0) rs.push({ customerId: 'x' + i, touchId: id, receivedDate: d });
  }
  return { ts, rs };
}
test('replyRateByTemplate: retire flag when sent >= 8 and rate < 0.05', () => {
  const a = mkSent(8, 'weak-01', 'VALUE', 0);      // 0 replies of 8 -> 0.0 -> retire
  const b = mkSent(7, 'young-01', 'VALUE', 0);     // 0 of 7 -> not enough sends
  const c = mkSent(20, 'ok-01', 'VALUE', 20);      // 1 of 20 -> 0.05 exactly -> keep
  const d = mkSent(21, 'meh-01', 'VALUE', 21);     // 1 of 21 -> 0.0476 -> retire
  const rows = STATS.replyRateByTemplate([...a.ts, ...b.ts, ...c.ts, ...d.ts], [...a.rs, ...b.rs, ...c.rs, ...d.rs]);
  const by = {}; rows.forEach(r => { by[r.templateId] = r; });
  assert.strictEqual(by['weak-01'].retire, true);
  assert.strictEqual(by['young-01'].retire, false);
  assert.strictEqual(by['ok-01'].retire, false);
  assert.strictEqual(by['meh-01'].retire, true);
  assert.strictEqual(by['weak-01'].slot, 'VALUE');
});
test('replyRateByTemplate: fixture rates and slot carried through', () => {
  const rows = STATS.replyRateByTemplate(touches, replies);
  const by = {}; rows.forEach(r => { by[r.templateId] = r; });
  assert.strictEqual(by['value-fall-01'].sent, 2);
  assert.strictEqual(by['value-fall-01'].replied, 1);
  assert.strictEqual(by['referral-01'].slot, 'REFERRAL');
  assert.strictEqual(by['referral-01'].retire, false);
  assert.ok(!by['checkin-01']);
  // sorted by sent desc
  assert.ok(rows[0].sent >= rows[rows.length - 1].sent);
});
test('replyRateByTemplate: no data -> []', () => {
  assert.deepStrictEqual(STATS.replyRateByTemplate([], []), []);
});

// ---------- referralsByCustomer ----------
test('referralsByCustomer: groups referred customers under the referrer, sorted desc', () => {
  const rows = STATS.referralsByCustomer(customers);
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0].customerId, 'c_dan');
  assert.strictEqual(rows[0].name, 'Dan Halvorson');
  assert.deepStrictEqual(rows[0].referred.map(r => r.id), ['c_bo', 'c_amy']); // newest saleDate first
  assert.deepStrictEqual(rows[0].referred[1], { id: 'c_amy', name: 'Amy Lund', saleDate: '2026-08-20' });
  assert.strictEqual(rows[1].customerId, 'c_kay');
  assert.strictEqual(rows[1].referred.length, 1);
});
test('referralsByCustomer: referrer not in list uses denormalized referredByName', () => {
  const rows = STATS.referralsByCustomer([{ id: 'z', name: 'Zed', referredBy: 'ghost', referredByName: 'Ghost Person', saleDate: '2026-01-01' }]);
  assert.strictEqual(rows[0].name, 'Ghost Person');
});
test('referralsByCustomer: no referrals -> []', () => {
  assert.deepStrictEqual(STATS.referralsByCustomer([customers[0]]), []);
  assert.deepStrictEqual(STATS.referralsByCustomer([]), []);
});

// ---------- monthly ----------
test('monthly: 12 months oldest -> newest ending on today\'s month', () => {
  const rows = STATS.monthly(customers, touches, TODAY);
  assert.strictEqual(rows.length, 12);
  assert.strictEqual(rows[0].month, '2025-10');
  assert.strictEqual(rows[11].month, '2026-09');
  const by = {}; rows.forEach(r => { by[r.month] = r; });
  assert.strictEqual(by['2026-08'].referrals, 1); // Amy
  assert.strictEqual(by['2026-09'].referrals, 1); // Bo (created 2026-09-03T01:30Z = Sep 2 Chicago -> still Sep)
  assert.strictEqual(by['2026-05'].referrals, 1); // Liz
  assert.strictEqual(by['2026-07'].repeats, 1);   // Kay's second purchase
  assert.strictEqual(by['2026-08'].sent, 2);      // t_dan_4, t_amy_0
  assert.strictEqual(by['2026-09'].sent, 1);      // t_dan_5
  assert.strictEqual(by['2026-03'].sent, 1);
  assert.strictEqual(by['2025-10'].sent, 0);      // 2025-09 falls off the window
});
test('monthly: purchases[0] never counts as a repeat; out-of-window purchases ignored', () => {
  const rows = STATS.monthly(customers, [], TODAY);
  const total = rows.reduce((n, r) => n + r.repeats, 0);
  assert.strictEqual(total, 1);
});
test('monthly: year boundary', () => {
  const rows = STATS.monthly([], [], '2026-01-15');
  assert.strictEqual(rows[0].month, '2025-02');
  assert.strictEqual(rows[11].month, '2026-01');
});
test('monthly: no data -> 12 rows of zeros', () => {
  const rows = STATS.monthly([], [], TODAY);
  assert.strictEqual(rows.length, 12);
  rows.forEach(r => assert.deepStrictEqual([r.referrals, r.repeats, r.sent], [0, 0, 0]));
});

// ---------- referralsBySlot ----------
test('referralsBySlot: maps attributedTouchId -> slot; unknown/missing -> unattributed (last)', () => {
  const rows = STATS.referralsBySlot(customers, touches);
  const by = {}; rows.forEach(r => { by[r.slot] = r.referrals; });
  assert.deepStrictEqual(by, { REFERRAL: 1, unattributed: 2 });
  assert.strictEqual(rows[rows.length - 1].slot, 'unattributed');
});
test('referralsBySlot: no data -> []', () => {
  assert.deepStrictEqual(STATS.referralsBySlot([], []), []);
});

// ---------- suggestAttributedTouch ----------
test('suggestAttributedTouch: latest sent touch to the referrer within 60 days', () => {
  assert.strictEqual(STATS.suggestAttributedTouch('c_dan', touches, TODAY), 't_dan_5');
  assert.strictEqual(STATS.suggestAttributedTouch('c_dan', touches, '2026-09-05'), 't_dan_4');
  assert.strictEqual(STATS.suggestAttributedTouch('c_dan', touches, '2026-09-30'), 't_dan_5'); // t_dan_4 is 60 days old, t_dan_5 newer
  assert.strictEqual(STATS.suggestAttributedTouch('c_dan', touches, '2026-07-01'), ''); // t_dan_3 was 116 days ago
  assert.strictEqual(STATS.suggestAttributedTouch('c_kay', touches, TODAY), '');
  assert.strictEqual(STATS.suggestAttributedTouch('', touches, TODAY), '');
  assert.strictEqual(STATS.suggestAttributedTouch('c_dan', [], TODAY), '');
});
test('suggestAttributedTouch: exactly 60 days still counts, 61 does not', () => {
  assert.strictEqual(STATS.suggestAttributedTouch('c_dan', touches.filter(t => t.id !== 't_dan_5'), '2026-09-30'), 't_dan_4');
  assert.strictEqual(STATS.suggestAttributedTouch('c_dan', touches.filter(t => t.id !== 't_dan_5'), '2026-10-01'), '');
});

// ---------- summary ----------
test('summary: dashboard strip numbers', () => {
  const s = STATS.summary(customers, touches, replies, TODAY, { dueToday: 3 });
  assert.deepStrictEqual(s, {
    active: 4, dnc: 1, dueToday: 3,
    sentLast30: 2,        // t_dan_5 (09-10), t_amy_0 (08-23)
    repliesLast30: 1,     // r5 (08-25)
    referralsLast90: 2,   // Amy (08-20), Bo (09-02); Liz (05-01) is 137 days old
    repeatsLast365: 1     // Kay 2026-07-14
  });
});
test('summary: engine injection is used for dueToday', () => {
  const engine = { buildQueue: () => [1, 2], extraQueueItems: () => [3] };
  assert.strictEqual(STATS.summary(customers, touches, replies, TODAY, { engine }).dueToday, 3);
});
test('summary: no data -> zeros', () => {
  const s = STATS.summary([], [], [], TODAY, { dueToday: 0 });
  assert.deepStrictEqual(s, { active: 0, dnc: 0, dueToday: 0, sentLast30: 0, repliesLast30: 0, referralsLast90: 0, repeatsLast365: 0 });
});

// ---------- helpers ----------
test('chicagoDate: ISO -> Chicago calendar date; YMD passthrough', () => {
  assert.strictEqual(STATS.chicagoDate('2026-09-03T01:30:00.000Z'), '2026-09-02');
  assert.strictEqual(STATS.chicagoDate('2026-09-03T14:30:00.000Z'), '2026-09-03');
  assert.strictEqual(STATS.chicagoDate('2026-01-01T05:59:00.000Z'), '2025-12-31');
  assert.strictEqual(STATS.chicagoDate('2026-09-15'), '2026-09-15');
  assert.strictEqual(STATS.chicagoDate(''), '');
});
test('diffDays: pure calendar math across DST', () => {
  assert.strictEqual(STATS.diffDays('2026-03-07', '2026-03-09'), 2);
  assert.strictEqual(STATS.diffDays('2028-02-28', '2028-03-01'), 2);
});

console.log(process.exitCode ? 'SOME TESTS FAILED' : 'all ' + passed + ' passed');
