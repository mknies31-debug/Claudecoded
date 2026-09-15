'use strict';
// North Star Keep-In-Touch — engine tests (Agent 2). Run: node test/engine.test.js
// Zero dependencies. Prints one line per test and a final count; exits 1 on failure.

var assert = require('assert');
var path = require('path');
var fs = require('fs');

var ENGINE_PATH = path.join(__dirname, '..', 'netlify', 'functions', 'lib', 'engine.js');
var KIT = require(ENGINE_PATH);

var passed = 0, failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('ok   - ' + name);
  } catch (e) {
    failed++;
    console.log('FAIL - ' + name);
    console.log('       ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n       ') : e));
  }
}

function customer(over) {
  var base = {
    name: 'Dan Halvorson', first: 'Dan', phone: '5075551234', email: 'dan@example.com',
    vehicle: { year: 2019, make: 'Chevrolet', model: 'Silverado', trim: '' },
    vehicleLabel: '2019 Silverado', saleDate: '2026-09-15', birthday: '', referredBy: '',
    hook: '', notes: '', status: 'active', dnc: null,
    anchorDate: '2026-09-15', anchorTouchN: 0, nextTouchN: 0, slotOffset: 0,
    referralCredit: false, snoozedUntil: '', lastSentDate: '', firstTextSentAt: '',
    usedTemplateIds: [], purchases: [{ saleDate: '2026-09-15', vehicle: { year: 2019, model: 'Silverado' }, vehicleLabel: '2019 Silverado' }]
  };
  for (var k in over) base[k] = over[k];
  if (over && over.saleDate && !over.anchorDate) base.anchorDate = over.saleDate;
  return base;
}

function slotsOf(list) { return list.map(function (t) { return t.slot; }); }
function datesOf(list) { return list.map(function (t) { return t.dueDate; }); }

// A tiny deterministic PRNG so the simulation is reproducible.
function rng(seed) {
  var s = seed >>> 0;
  return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

// ------------------------------------------------------------ UMD loading

test('UMD: require() in Node returns the engine object', function () {
  assert.strictEqual(typeof KIT.nextTouch, 'function');
  assert.strictEqual(typeof KIT.VERSION, 'string');
  assert.ok(Array.isArray(KIT.SLOTS) && KIT.SLOTS.indexOf('ANNIVERSARY_REFERRAL') !== -1);
});

test('UMD: browser-style evaluation attaches window.KIT', function () {
  var src = fs.readFileSync(ENGINE_PATH, 'utf8');
  var w = {};
  new Function('window', 'module', 'exports', src)(w, undefined, undefined);
  assert.strictEqual(typeof w.KIT, 'object');
  assert.strictEqual(Object.keys(w.KIT).length, Object.keys(KIT).length);
  assert.strictEqual(w.KIT.addDays('2027-12-31', 3), '2028-01-03');
});

test('engine source has no ES module syntax and no Date.now()', function () {
  var src = fs.readFileSync(ENGINE_PATH, 'utf8');
  var code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/mg, ''); // strip comments
  assert.ok(!/^\s*(import|export)\s/m.test(code), 'no import/export');
  assert.ok(code.indexOf('Date.now') === -1, 'no Date.now');
  assert.ok(code.indexOf('require(') === -1, 'no require');
});

// ------------------------------------------------------------- date math

test('addDays crosses year end: 2027-12-31 + 3 = 2028-01-03', function () {
  assert.strictEqual(KIT.addDays('2027-12-31', 3), '2028-01-03');
});

test('addDays from leap day: 2028-02-29 + 90 = 2028-05-29', function () {
  assert.strictEqual(KIT.addDays('2028-02-29', 90), '2028-05-29');
});

test('diffDays 2028-02-29 -> 2029-02-28 = 365; negative direction works', function () {
  assert.strictEqual(KIT.diffDays('2028-02-29', '2029-02-28'), 365);
  assert.strictEqual(KIT.diffDays('2029-02-28', '2028-02-29'), -365);
  assert.strictEqual(KIT.diffDays('2026-03-08', '2026-03-09'), 1); // US DST day; pure calendar math
  assert.strictEqual(KIT.diffDays('2026-11-01', '2026-11-02'), 1);
});

test('addDays handles negative and zero', function () {
  assert.strictEqual(KIT.addDays('2028-03-01', -1), '2028-02-29');
  assert.strictEqual(KIT.addDays('2028-03-01', 0), '2028-03-01');
});

test('todayChicago returns YYYY-MM-DD and nowChicagoHour returns 0..23', function () {
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(KIT.todayChicago()));
  var h = KIT.nowChicagoHour();
  assert.ok(Number.isInteger(h) && h >= 0 && h <= 23);
});

test('seasonFor maps every month', function () {
  var want = { '01': 'winter', '02': 'winter', '03': 'spring', '04': 'spring', '05': 'spring',
    '06': 'summer', '07': 'summer', '08': 'summer', '09': 'fall', '10': 'fall', '11': 'fall', '12': 'winter' };
  Object.keys(want).forEach(function (mm) {
    assert.strictEqual(KIT.seasonFor('2026-' + mm + '-15'), want[mm], 'month ' + mm);
  });
});

// ---------------------------------------------------------------- slots

test('baseSlot: 0 THANKS, odd VALUE, 2/6 CHECKIN, 4/8 REFERRAL', function () {
  assert.strictEqual(KIT.baseSlot(0), 'THANKS');
  [1, 3, 5, 7, 9].forEach(function (n) { assert.strictEqual(KIT.baseSlot(n), 'VALUE', 'n=' + n); });
  [2, 6, 10].forEach(function (n) { assert.strictEqual(KIT.baseSlot(n), 'CHECKIN', 'n=' + n); });
  [4, 8, 12].forEach(function (n) { assert.strictEqual(KIT.baseSlot(n), 'REFERRAL', 'n=' + n); });
});

test('50/25/25 ratio holds over touches 1..12', function () {
  var counts = { VALUE: 0, CHECKIN: 0, REFERRAL: 0 };
  for (var n = 1; n <= 12; n++) counts[KIT.baseSlot(n)]++;
  assert.deepStrictEqual(counts, { VALUE: 6, CHECKIN: 3, REFERRAL: 3 });
});

// ------------------------------------------------------- sale on Dec 31

test('sale 2027-12-31: touch0 2028-01-03, touch1 2028-03-30, touch4 2028-12-25 ANNIVERSARY_REFERRAL', function () {
  var c = customer({ saleDate: '2027-12-31' });
  assert.strictEqual(KIT.touchDate(c, 0), '2028-01-03');
  assert.strictEqual(KIT.touchDate(c, 1), '2028-03-30');
  assert.strictEqual(KIT.touchDate(c, 4), '2028-12-25');
  var p = KIT.previewTouches(c, 6, '2027-12-31');
  assert.deepStrictEqual(datesOf(p), ['2028-01-03', '2028-03-30', '2028-06-28', '2028-09-26', '2028-12-25', '2029-03-25']);
  assert.deepStrictEqual(slotsOf(p), ['THANKS', 'VALUE', 'CHECKIN', 'VALUE', 'ANNIVERSARY_REFERRAL', 'VALUE']);
});

// ------------------------------------------------------- sale on Feb 29

test('sale 2028-02-29: touch1 2028-05-29, touch4 2029-02-23 ANNIVERSARY_REFERRAL (anniv falls on Feb 28)', function () {
  var c = customer({ saleDate: '2028-02-29' });
  assert.strictEqual(KIT.touchDate(c, 0), '2028-03-03');
  assert.strictEqual(KIT.touchDate(c, 1), '2028-05-29');
  assert.strictEqual(KIT.touchDate(c, 4), '2029-02-23');
  var r = KIT.resolveSlot(c, 4, '2029-02-23');
  assert.strictEqual(r.slot, 'ANNIVERSARY_REFERRAL');
  assert.strictEqual(r.anniversaryYear, 1);
  assert.deepStrictEqual(KIT.nearestAnniversary('2028-02-29', '2029-02-23'), { days: 5, year: 1 });
});

test('90-day ladder: touch n = saleDate + 90n for n >= 1', function () {
  var c = customer({ saleDate: '2026-09-15' });
  for (var n = 1; n <= 12; n++) {
    assert.strictEqual(KIT.touchDate(c, n), KIT.addDays('2026-09-15', 90 * n), 'n=' + n);
  }
});

test('touch 4 = sale + 360 days lands in the anniversary window; touch 8 too; touch 5 does not', function () {
  var c = customer({ saleDate: '2026-09-15' });
  assert.strictEqual(KIT.resolveSlot(c, 4, KIT.touchDate(c, 4)).slot, 'ANNIVERSARY_REFERRAL');
  assert.strictEqual(KIT.resolveSlot(c, 8, KIT.touchDate(c, 8)).slot, 'ANNIVERSARY_REFERRAL');
  assert.strictEqual(KIT.resolveSlot(c, 5, KIT.touchDate(c, 5)).slot, 'VALUE');
  // a plain REFERRAL well outside the window stays REFERRAL
  assert.strictEqual(KIT.resolveSlot(c, 4, '2027-06-01').slot, 'REFERRAL');
  assert.strictEqual(KIT.resolveSlot(c, 4, '2027-08-16').slot, 'ANNIVERSARY_REFERRAL'); // exactly 30 days before
  assert.strictEqual(KIT.resolveSlot(c, 4, '2027-08-15').slot, 'REFERRAL');              // 31 days before
});

// ------------------------------------------------------------- birthday

test('birthday within 14 days shifts to BIRTHDAY and the displaced slot appears next (worked example)', function () {
  var c = customer({ saleDate: '2026-09-15', birthday: '12-20' });
  var p = KIT.previewTouches(c, 8, '2026-09-15');
  assert.deepStrictEqual(datesOf(p), ['2026-09-18', '2026-12-14', '2027-03-14', '2027-06-12', '2027-09-10', '2027-12-09', '2028-03-08', '2028-06-06']);
  assert.deepStrictEqual(slotsOf(p), ['THANKS', 'BIRTHDAY', 'VALUE', 'CHECKIN', 'VALUE', 'BIRTHDAY', 'REFERRAL', 'VALUE']);
  assert.strictEqual(p[1].carried, true);
  assert.strictEqual(p[5].carried, true);
});

test('birthday carry via applyEvent sent: slotOffset increments and the next touch gets the displaced slot', function () {
  var c = customer({ saleDate: '2026-09-15', birthday: '12-20', nextTouchN: 1 });
  var nt = KIT.nextTouch(c, '2026-12-14');
  assert.strictEqual(nt.slot, 'BIRTHDAY');
  assert.strictEqual(nt.carried, true);
  var after = KIT.applyEvent(c, { type: 'sent', n: 1, dueDate: nt.dueDate, sentDate: '2026-12-14', channels: ['email'], templateId: 'birthday-01' }, '2026-12-14');
  assert.strictEqual(after.slotOffset, 1);
  assert.strictEqual(after.nextTouchN, 2);
  assert.strictEqual(KIT.nextTouch(after, '2027-03-14').slot, 'VALUE');
  assert.strictEqual(c.slotOffset, 0, 'input not mutated');
});

test('birthday carry via skipped also bumps slotOffset', function () {
  var c = customer({ saleDate: '2026-09-15', birthday: '12-20', nextTouchN: 1 });
  var after = KIT.applyEvent(c, { type: 'skipped', n: 1 }, '2026-12-14');
  assert.strictEqual(after.slotOffset, 1);
  assert.strictEqual(after.floorDate, '');
});

test('birthday never displaces touch 0', function () {
  var c = customer({ saleDate: '2026-09-15', birthday: '09-18' });
  assert.strictEqual(KIT.resolveSlot(c, 0, '2026-09-18').slot, 'THANKS');
});

test('birthday nearest occurrence handles year boundary and Feb 29', function () {
  assert.strictEqual(KIT.daysToBirthday('01-05', '2026-12-28'), 8);   // next year's occurrence
  assert.strictEqual(KIT.daysToBirthday('12-28', '2027-01-05'), 8);   // last year's occurrence
  assert.strictEqual(KIT.daysToBirthday('02-29', '2027-02-28'), 0);   // non-leap year -> Feb 28
  assert.strictEqual(KIT.daysToBirthday('02-29', '2028-02-29'), 0);
  assert.strictEqual(KIT.daysToBirthday('', '2028-02-29'), null);
  var c = customer({ saleDate: '2026-10-01', birthday: '01-05' });
  assert.strictEqual(KIT.resolveSlot(c, 1, '2026-12-30').slot, 'BIRTHDAY'); // 6 days before Jan 5
  assert.strictEqual(KIT.resolveSlot(c, 1, '2026-12-22').slot, 'BIRTHDAY'); // exactly 14 days
  assert.strictEqual(KIT.resolveSlot(c, 1, '2026-12-21').slot, 'VALUE');    // 15 days
});

// ------------------------------------------------------ referral credit

test('referralCredit converts the next REFERRAL to VALUE once, then clears', function () {
  var c = customer({ saleDate: '2026-09-15', nextTouchN: 3 });
  c = KIT.applyEvent(c, { type: 'referralReceived', date: '2027-05-01', referredName: 'Sue' }, '2027-05-01');
  assert.strictEqual(c.referralCredit, true);
  assert.deepStrictEqual(c.pendingThanks, { date: '2027-05-01', referredName: 'Sue' });
  // touch 3 is VALUE regardless
  var t3 = KIT.nextTouch(c, '2027-06-12');
  assert.strictEqual(t3.slot, 'VALUE');
  assert.strictEqual(t3.viaCredit, false);
  c = KIT.applyEvent(c, { type: 'sent', n: 3, dueDate: t3.dueDate, sentDate: '2027-06-12', channels: ['email'] }, '2027-06-12');
  assert.strictEqual(c.referralCredit, true, 'credit survives a VALUE send');
  // touch 4 would be ANNIVERSARY_REFERRAL; credit turns it into VALUE
  var t4 = KIT.nextTouch(c, '2027-09-10');
  assert.strictEqual(t4.slot, 'VALUE');
  assert.strictEqual(t4.viaCredit, true);
  c = KIT.applyEvent(c, { type: 'sent', n: 4, dueDate: t4.dueDate, sentDate: '2027-09-10', channels: ['email'] }, '2027-09-10');
  assert.strictEqual(c.referralCredit, false, 'credit consumed');
  // touch 8 is a normal referral again
  assert.strictEqual(KIT.resolveSlot(c, 8, KIT.touchDate(c, 8)).slot, 'ANNIVERSARY_REFERRAL');
});

test('referralCredit is not consumed by a skip', function () {
  var c = customer({ saleDate: '2026-09-15', nextTouchN: 4, referralCredit: true });
  c = KIT.applyEvent(c, { type: 'skipped', n: 4 }, '2027-09-10');
  assert.strictEqual(c.referralCredit, true);
});

test('extraQueueItems lists pending REFERRAL_THANKS; sentExtra clears it without consuming a touch number', function () {
  var c = customer({ saleDate: '2026-09-15', nextTouchN: 2 });
  c = KIT.applyEvent(c, { type: 'referralReceived', date: '2027-01-10', referredName: 'Sue' }, '2027-01-10');
  var extra = KIT.extraQueueItems([c], '2027-01-10');
  assert.strictEqual(extra.length, 1);
  assert.strictEqual(extra[0].slot, 'REFERRAL_THANKS');
  assert.strictEqual(extra[0].extra, true);
  assert.strictEqual(extra[0].referredName, 'Sue');
  assert.strictEqual(extra[0].dueDate, '2027-01-10');
  var after = KIT.applyEvent(c, { type: 'sentExtra', sentDate: '2027-01-10', templateId: 'referral-thanks-01', channels: ['sms'], sentAt: '2027-01-10T15:00:00.000Z' }, '2027-01-10');
  assert.strictEqual(after.pendingThanks, null);
  assert.strictEqual(after.nextTouchN, 2, 'no touch number consumed');
  assert.deepStrictEqual(after.usedTemplateIds, ['referral-thanks-01']);
  assert.strictEqual(after.firstTextSentAt, '2027-01-10T15:00:00.000Z');
  assert.strictEqual(KIT.extraQueueItems([after], '2027-01-10').length, 0);
  assert.strictEqual(KIT.extraQueueItems([KIT.applyEvent(c, { type: 'optOut', reason: 'manual', channel: 'both', at: 'x' })], '2027-01-10').length, 0, 'dnc excluded');
});

// ----------------------------------------------------------- reply reset

test('reply at touch 2 on date R -> touch 3 due R + 90', function () {
  var c = customer({ saleDate: '2026-09-15', nextTouchN: 2 });
  c = KIT.applyEvent(c, { type: 'sent', n: 2, dueDate: '2027-03-14', sentDate: '2027-03-14', channels: ['email'] }, '2027-03-14');
  assert.strictEqual(c.nextTouchN, 3);
  c = KIT.applyEvent(c, { type: 'reply', date: '2027-03-20', at: '2027-03-20T12:00:00.000Z' }, '2027-03-20');
  assert.strictEqual(c.anchorDate, '2027-03-20');
  assert.strictEqual(c.anchorTouchN, 2);
  assert.strictEqual(c.lastReplyDate, '2027-03-20');
  assert.strictEqual(KIT.touchDate(c, 3), '2027-06-18');
  assert.strictEqual(KIT.touchDate(c, 4), '2027-09-16');
  assert.strictEqual(KIT.nextTouch(c, '2027-06-18').isDue, true);
  assert.strictEqual(KIT.nextTouch(c, '2027-06-17').isDue, false);
});

test('reply clears snooze and floor; reply before any touch keeps touch 0 at sale + 3', function () {
  var c = customer({ saleDate: '2026-09-15', nextTouchN: 0, snoozedUntil: '2026-10-01', floorDate: '2026-10-05' });
  c = KIT.applyEvent(c, { type: 'reply', date: '2026-09-16' }, '2026-09-16');
  assert.strictEqual(c.snoozedUntil, '');
  assert.strictEqual(c.floorDate, '');
  assert.strictEqual(c.anchorTouchN, 0);
  assert.strictEqual(KIT.touchDate(c, 0), '2026-09-18');
  assert.strictEqual(KIT.touchDate(c, 1), '2026-12-15');
});

// ---------------------------------------------------- late touch + floor

test('late touch: a customer 200 days overdue has exactly one item in the queue', function () {
  var c = customer({ saleDate: '2026-09-15', nextTouchN: 1 }); // touch 1 due 2026-12-14
  var today = KIT.addDays('2026-12-14', 200);
  var q = KIT.buildQueue([c], today);
  assert.strictEqual(q.length, 1);
  assert.strictEqual(q[0].n, 1);
  assert.strictEqual(q[0].isLate, true);
  assert.strictEqual(q[0].daysLate, 200);
  assert.strictEqual(q[0].dueDate, '2026-12-14');
});

test('after a late "sent" the next touch is floored to sentDate + 21; the floor applies to that touch only', function () {
  var c = customer({ saleDate: '2026-09-15', nextTouchN: 1 });
  var today = KIT.addDays('2026-12-14', 200); // 2027-07-02
  c = KIT.applyEvent(c, { type: 'sent', n: 1, dueDate: '2026-12-14', sentDate: today, channels: ['email'] }, today);
  assert.strictEqual(c.nextTouchN, 2);
  assert.strictEqual(c.lastSentDate, today);
  assert.strictEqual(c.floorDate, KIT.addDays(today, 21));
  var nt = KIT.nextTouch(c, today);
  assert.strictEqual(nt.dueDate, KIT.addDays(today, 21));
  assert.strictEqual(nt.isDue, false);
  assert.strictEqual(KIT.nextTouch(c, KIT.addDays(today, 21)).isDue, true);
  // the floor never reaches touch 3, whose date is still on the original cadence
  assert.strictEqual(KIT.touchDate(c, 3), KIT.addDays('2026-09-15', 270));
  // send touch 2 on the floored date -> touch 3 (original 2027-06-12) is before sent+21 -> floored again
  var d2 = KIT.addDays(today, 21);
  c = KIT.applyEvent(c, { type: 'sent', n: 2, dueDate: d2, sentDate: d2, channels: ['email'] }, d2);
  assert.strictEqual(c.floorDate, KIT.addDays(d2, 21));
  assert.strictEqual(KIT.touchDate(c, 3), KIT.addDays(d2, 21));
});

test('floor is not stored when the next touch is already far enough out', function () {
  var c = customer({ saleDate: '2026-09-15', nextTouchN: 1 });
  c = KIT.applyEvent(c, { type: 'sent', n: 1, dueDate: '2026-12-14', sentDate: '2026-12-14', channels: ['email'] }, '2026-12-14');
  assert.strictEqual(c.floorDate, '');
  assert.strictEqual(KIT.touchDate(c, 2), '2027-03-14');
});

test('event.minGapDays overrides the default 21', function () {
  var c = customer({ saleDate: '2026-09-15', nextTouchN: 1 });
  var today = KIT.addDays('2026-12-14', 200);
  c = KIT.applyEvent(c, { type: 'sent', n: 1, dueDate: '2026-12-14', sentDate: today, channels: [], minGapDays: 10 }, today);
  assert.strictEqual(c.floorDate, KIT.addDays(today, 10));
});

test('after "skipped" there is no floor: next touch keeps the original cadence (and may be due immediately)', function () {
  var c = customer({ saleDate: '2026-09-15', nextTouchN: 1 });
  var today = KIT.addDays('2026-12-14', 200);
  c = KIT.applyEvent(c, { type: 'skipped', n: 1 }, today);
  assert.strictEqual(c.nextTouchN, 2);
  assert.strictEqual(c.floorDate, '');
  var nt = KIT.nextTouch(c, today);
  assert.strictEqual(nt.dueDate, '2027-03-14');
  assert.strictEqual(nt.isDue, true);
});

test('previewTouches on a late customer shows the catch-up with floors applied', function () {
  var c = customer({ saleDate: '2026-09-15', nextTouchN: 1 });
  var today = KIT.addDays('2026-12-14', 200); // 2027-07-02
  var p = KIT.previewTouches(c, 4, today);
  assert.strictEqual(p[0].dueDate, '2026-12-14');
  assert.strictEqual(p[1].dueDate, KIT.addDays(today, 21));
  assert.strictEqual(p[2].dueDate, KIT.addDays(today, 42)); // original 2027-06-12 is still in the past
  assert.strictEqual(p[3].dueDate, '2027-09-10');            // original cadence resumes
});

// ------------------------------------------------------------ DNC / queue

test('DNC customer: nextTouch null and buildQueue excludes; dncClear reactivates', function () {
  var c = customer({ saleDate: '2026-09-15' });
  var out = KIT.applyEvent(c, { type: 'optOut', reason: 'STOP reply', channel: 'sms', at: '2026-09-20T00:00:00.000Z' }, '2026-09-20');
  assert.strictEqual(out.status, 'dnc');
  assert.deepStrictEqual(out.dnc, { at: '2026-09-20T00:00:00.000Z', reason: 'STOP reply', channel: 'sms' });
  assert.strictEqual(KIT.nextTouch(out, '2026-09-20'), null);
  assert.strictEqual(KIT.buildQueue([out], '2026-09-20').length, 0);
  assert.strictEqual(c.status, 'active', 'input not mutated');
  var back = KIT.applyEvent(out, { type: 'dncClear' }, '2026-09-21');
  assert.strictEqual(back.status, 'active');
  assert.strictEqual(back.dnc, null);
  assert.strictEqual(KIT.buildQueue([back], '2026-09-21').length, 1);
});

test('buildQueue: one item per due customer, oldest dueDate first then by name', function () {
  var a = customer({ name: 'Zed Olson', saleDate: '2026-09-01' });   // due 09-04
  var b = customer({ name: 'Amy Berg', saleDate: '2026-09-01' });    // due 09-04
  var d = customer({ name: 'Bo Lund', saleDate: '2026-08-01' });     // due 08-04
  var e = customer({ name: 'Future Person', saleDate: '2026-09-15' }); // due 09-18, not yet
  var q = KIT.buildQueue([a, b, d, e], '2026-09-15');
  assert.deepStrictEqual(q.map(function (i) { return i.customer.name; }), ['Bo Lund', 'Amy Berg', 'Zed Olson']);
  assert.deepStrictEqual(Object.keys(q[0]).sort(), ['carried', 'customer', 'daysLate', 'dueDate', 'isLate', 'n', 'season', 'slot']);
  assert.strictEqual(q[0].daysLate, KIT.diffDays('2026-08-04', '2026-09-15'));
  assert.strictEqual(q[0].season, 'fall');
});

test('snooze: snoozed item leaves the queue until snoozedUntil, then returns', function () {
  var c = customer({ saleDate: '2026-09-01' }); // due 09-04
  var s = KIT.applyEvent(c, { type: 'snoozed', days: 7 }, '2026-09-10');
  assert.strictEqual(s.snoozedUntil, '2026-09-17');
  assert.strictEqual(KIT.nextTouch(s, '2026-09-16').isDue, false);
  assert.strictEqual(KIT.nextTouch(s, '2026-09-16').snoozed, true);
  assert.strictEqual(KIT.nextTouch(s, '2026-09-17').isDue, true);
  assert.strictEqual(KIT.buildQueue([s], '2026-09-16').length, 0);
  assert.strictEqual(KIT.buildQueue([s], '2026-09-17').length, 1);
});

test('queue season follows the send day for late touches (no ice-scraper tip in July)', function () {
  var c = customer({ saleDate: '2026-09-15', nextTouchN: 1 }); // due 2026-12-14 (winter)
  assert.strictEqual(KIT.buildQueue([c], '2027-07-02')[0].season, 'summer');
  assert.strictEqual(KIT.nextTouch(c, '2026-12-14').season, 'winter');
  assert.strictEqual(KIT.nextTouch(c, '2026-10-01').season, 'winter', 'future touch previews its own season');
});

test('nextTouch returns null for a customer with no saleDate', function () {
  assert.strictEqual(KIT.nextTouch(customer({ saleDate: '' }), '2026-09-15'), null);
});

// ------------------------------------------------------- repeat purchase

test('repeatPurchase resets the ladder, records the purchase, and touch 0 becomes THANKS_REPEAT', function () {
  var c = customer({ saleDate: '2024-03-01', nextTouchN: 7, slotOffset: 1, anchorDate: '2025-01-01', anchorTouchN: 3, floorDate: '2026-01-01' });
  var r = KIT.applyEvent(c, { type: 'repeatPurchase', saleDate: '2026-09-15', vehicle: { year: 2023, make: 'Ford', model: 'F-150' } }, '2026-09-15');
  assert.strictEqual(r.saleDate, '2026-09-15');
  assert.strictEqual(r.anchorDate, '2026-09-15');
  assert.strictEqual(r.anchorTouchN, 0);
  assert.strictEqual(r.nextTouchN, 0);
  assert.strictEqual(r.slotOffset, 0);
  assert.strictEqual(r.floorDate, '');
  assert.strictEqual(r.vehicleLabel, '2023 F-150');
  assert.strictEqual(r.purchases.length, 2);
  assert.strictEqual(r.purchases[1].saleDate, '2026-09-15');
  var nt = KIT.nextTouch(r, '2026-09-18');
  assert.strictEqual(nt.slot, 'THANKS_REPEAT');
  assert.strictEqual(nt.dueDate, '2026-09-18');
  assert.strictEqual(c.nextTouchN, 7, 'input not mutated');
});

test('applyEvent never mutates its input (deep)', function () {
  var c = customer({ saleDate: '2026-09-15', usedTemplateIds: ['a'] });
  var snapshot = JSON.stringify(c);
  KIT.applyEvent(c, { type: 'sent', n: 0, sentDate: '2026-09-18', channels: ['sms'], templateId: 'thanks-01', sentAt: 'T' }, '2026-09-18');
  KIT.applyEvent(c, { type: 'reply', date: '2026-09-19' }, '2026-09-19');
  KIT.applyEvent(c, { type: 'repeatPurchase', saleDate: '2026-10-01', vehicle: { year: 1, model: 'x' } }, '2026-10-01');
  assert.strictEqual(JSON.stringify(c), snapshot);
});

test('applyEvent sent records usedTemplateIds, firstTextSentAt (only once), and clears snooze', function () {
  var c = customer({ saleDate: '2026-09-15', snoozedUntil: '2026-09-25' });
  c = KIT.applyEvent(c, { type: 'sent', n: 0, sentDate: '2026-09-18', channels: ['email', 'sms'], templateId: 'thanks-01', sentAt: '2026-09-18T14:00:00.000Z' }, '2026-09-18');
  assert.deepStrictEqual(c.usedTemplateIds, ['thanks-01']);
  assert.strictEqual(c.firstTextSentAt, '2026-09-18T14:00:00.000Z');
  assert.strictEqual(c.snoozedUntil, '');
  assert.strictEqual(c.lastSentAt, '2026-09-18T14:00:00.000Z');
  c = KIT.applyEvent(c, { type: 'sent', n: 1, sentDate: '2026-12-14', channels: ['sms'], templateId: 'value-winter-01', sentAt: 'later' }, '2026-12-14');
  assert.strictEqual(c.firstTextSentAt, '2026-09-18T14:00:00.000Z', 'first text stamp is kept');
  assert.deepStrictEqual(c.usedTemplateIds, ['thanks-01', 'value-winter-01']);
});

test('applyEvent throws on an unknown event type', function () {
  assert.throws(function () { KIT.applyEvent(customer(), { type: 'bogus' }, '2026-09-15'); }, /unknown event type/);
});

// -------------------------------------------------------------- opt-out

test('isOptOutText: positives', function () {
  ['STOP', 'stop', 'Stop!!', 'Stop.', ' stop ', 'Please unsubscribe me', 'remove me', 'Remove me from your list',
    'please stop', 'stop it', 'stop sending texts', 'Stop, I don\'t want these', 'unsubscribe', 'UNSUBSCRIBE',
    'opt out', 'Opt-out please', 'Quit', 'cancel', 'END', 'Cancel.', 'Do not contact me again',
    'don\'t text me', 'stop texting me please', 'take me off your list', 'No more emails thanks',
    'STOP\nsent from my iPhone'].forEach(function (s) {
    assert.strictEqual(KIT.isOptOutText(s), true, JSON.stringify(s));
  });
});

test('isOptOutText: negatives', function () {
  ['I stopped by the lot', 'the stop sign', 'Stop by the lot Friday', 'End of the month works for me',
    'Cancel that, I\'ll come Tuesday', 'Yes', 'Sure, the Silverado is doing great', 'Can you quit the paperwork by Friday',
    'Nonstop rain out here', 'Yes I know a guy who might want to unsub... never mind', '', null, undefined, 42,
    'We had to stop for gas twice on the way to Duluth',
    'Sounds good. Talk soon. Sent from my phone. STOP is not what I mean here but this is past 80 characters so ignore this'].forEach(function (s) {
    assert.strictEqual(KIT.isOptOutText(s), false, JSON.stringify(s));
  });
});

test('isOptOutText looks only at the first 80 characters', function () {
  var pad = new Array(81).join('a') + ' ';
  assert.strictEqual(KIT.isOptOutText(pad + 'unsubscribe'), false);
  assert.strictEqual(KIT.isOptOutText('unsubscribe ' + pad), true);
});

// ------------------------------------------------------------- templates

var LIB = {
  templates: [
    { id: 'value-fall-01', slot: 'VALUE', season: 'fall', subject: 'Deer', emailBody: 'a', textBody: 'a' },
    { id: 'value-fall-02', slot: 'VALUE', season: 'fall', subject: 'Battery', emailBody: 'b', textBody: 'b' },
    { id: 'value-winter-01', slot: 'VALUE', season: 'winter', subject: 'Cold', emailBody: 'c', textBody: 'c' },
    { id: 'value-any-01', slot: 'VALUE', season: 'any', subject: 'Recall', emailBody: 'd', textBody: 'd' },
    { id: 'checkin-01', slot: 'CHECKIN', season: 'any', subject: 'x', emailBody: 'x', textBody: 'x' },
    { id: 'checkin-02', slot: 'CHECKIN', season: 'any', subject: 'y', emailBody: 'y', textBody: 'y' },
    { id: 'checkin-03', slot: 'CHECKIN', season: 'any', subject: 'z', emailBody: 'z', textBody: 'z' },
    { id: 'goodbye-01', slot: 'GOODBYE', season: 'any', subject: 'Bye', emailBody: 'Door is open.', textBody: 'Door is open.' }
  ]
};

test('templatePool: VALUE returns season pool + any; other slots ignore season', function () {
  assert.deepStrictEqual(KIT.templatePool(LIB, {}, 'VALUE', 'fall').map(function (t) { return t.id; }), ['value-fall-01', 'value-fall-02', 'value-any-01']);
  assert.deepStrictEqual(KIT.templatePool(LIB, {}, 'VALUE', 'winter').map(function (t) { return t.id; }), ['value-winter-01', 'value-any-01']);
  assert.deepStrictEqual(KIT.templatePool(LIB, {}, 'CHECKIN', 'summer').map(function (t) { return t.id; }), ['checkin-01', 'checkin-02', 'checkin-03']);
  assert.deepStrictEqual(KIT.templatePool(LIB, null, 'REFERRAL', 'fall'), []);
});

test('templatePool: empty VALUE season falls back to any, then to all VALUE', function () {
  assert.deepStrictEqual(KIT.templatePool(LIB, {}, 'VALUE', 'summer').map(function (t) { return t.id; }), ['value-any-01']);
  var retiredAny = { 'value-any-01': { retired: true } };
  assert.deepStrictEqual(KIT.templatePool(LIB, retiredAny, 'VALUE', 'summer').map(function (t) { return t.id; }), ['value-fall-01', 'value-fall-02', 'value-winter-01']);
});

test('templatePool: overrides merge subject/bodies and retired removes', function () {
  var ov = { 'checkin-02': { retired: true }, 'checkin-01': { subject: 'Edited', textBody: 'short' } };
  var pool = KIT.templatePool(LIB, ov, 'CHECKIN', 'any');
  assert.deepStrictEqual(pool.map(function (t) { return t.id; }), ['checkin-01', 'checkin-03']);
  assert.strictEqual(pool[0].subject, 'Edited');
  assert.strictEqual(pool[0].textBody, 'short');
  assert.strictEqual(pool[0].emailBody, 'x', 'unspecified fields keep library value');
  assert.strictEqual(LIB.templates[4].subject, 'x', 'library not mutated');
});

test('pickTemplate: null on empty pool; rotates by seed; no repeat until pool exhausted; then least-recently-used', function () {
  assert.strictEqual(KIT.pickTemplate([], [], 0), null);
  var pool = KIT.templatePool(LIB, {}, 'CHECKIN', 'any');
  assert.strictEqual(KIT.pickTemplate(pool, [], 0).id, 'checkin-01');
  assert.strictEqual(KIT.pickTemplate(pool, [], 1).id, 'checkin-02');
  assert.strictEqual(KIT.pickTemplate(pool, [], 2).id, 'checkin-03');
  assert.strictEqual(KIT.pickTemplate(pool, [], 3).id, 'checkin-01');
  assert.strictEqual(KIT.pickTemplate(pool, [], 'Dan').id, KIT.pickTemplate(pool, [], 'Dan').id, 'string seed is deterministic');
  // walk: never repeat until all three are used
  var used = [];
  var seen = [];
  for (var i = 0; i < 3; i++) {
    var t = KIT.pickTemplate(pool, used, 7);
    assert.strictEqual(seen.indexOf(t.id), -1, 'no repeat before exhaustion');
    seen.push(t.id);
    used.push(t.id);
  }
  // pool exhausted: the oldest use comes back first, regardless of seed
  assert.strictEqual(KIT.pickTemplate(pool, used, 0).id, used[0]);
  assert.strictEqual(KIT.pickTemplate(pool, used, 5).id, used[0]);
  used.push(used[0]);
  assert.strictEqual(KIT.pickTemplate(pool, used, 0).id, used[1]);
  // ids from other slots in the history are ignored
  assert.strictEqual(KIT.pickTemplate(pool, ['value-fall-01', 'thanks-01'], 0).id, 'checkin-01');
});

// ---------------------------------------------------------------- render

var SETTINGS = { mickPhone: '5075550000', mickPhoneDisplay: '(507) 555-0000', senderMode: 'mick' };

test('render fills placeholders, appends the exact Mick sign-off, footer and STOP line', function () {
  var tpl = { slot: 'CHECKIN', subject: 'How is the {vehicle}', emailBody: 'Hi {first}, how is the {year} {make} {model} on {hook|the roads out your way}?', textBody: '{first}, {vehicle} still good on {hook|the gravel}?' };
  var c = customer({ hook: 'the gravel out by Goodhue', saleDate: '2026-09-15' });
  var r = KIT.render(tpl, c, SETTINGS, { sender: 'mick', footer: 'FOOTER LINE', firstText: true, season: 'fall' });
  assert.strictEqual(r.subject, 'How is the 2019 Silverado');
  assert.strictEqual(r.emailBody, 'Hi Dan, how is the 2019 Chevrolet Silverado on the gravel out by Goodhue?');
  assert.strictEqual(r.emailFull, r.emailBody + '\n\nMick\nMosaic Autos\n(507) 555-0000\n\nFOOTER LINE');
  assert.strictEqual(r.textBody, 'Dan, 2019 Silverado still good on the gravel out by Goodhue?');
  assert.strictEqual(r.textFull, r.textBody + ' Reply STOP to opt out.');
  assert.deepStrictEqual(r.missing, []);
  assert.strictEqual(r.sender, 'mick');
});

test('render: Ella sign-off, no footer, no STOP line when not first text', function () {
  var r = KIT.render({ slot: 'VALUE', subject: 's', emailBody: 'Body.', textBody: 'Text.' }, customer(), SETTINGS, { sender: 'ella' });
  assert.strictEqual(r.emailFull, 'Body.\n\nElla, for Mick\nMosaic Autos\n(507) 555-0000');
  assert.strictEqual(r.textFull, 'Text.');
  assert.strictEqual(r.sender, 'ella');
});

test('render: sender defaults to settings.senderMode, then mick; phone falls back to mickPhone', function () {
  var r = KIT.render({ subject: 's', emailBody: 'B', textBody: 'T' }, customer(), { mickPhone: '5075550000', senderMode: 'ella' }, {});
  assert.ok(r.emailFull.indexOf('Ella, for Mick') !== -1);
  assert.ok(r.emailFull.indexOf('5075550000') !== -1);
  var r2 = KIT.render({ subject: 's', emailBody: 'B', textBody: 'T' }, customer(), {}, {});
  assert.strictEqual(r2.emailFull, 'B\n\nMick\nMosaic Autos\n[phone]');
  assert.deepStrictEqual(r2.missing, ['phone']);
});

test('render: fallbacks, unknown placeholders visible as [name], sale_year and season', function () {
  var tpl = { subject: '{season} {sale_year}', emailBody: 'Hook: {hook|the roads}. {nope}. {hook}', textBody: '{first}' };
  var r = KIT.render(tpl, customer({ hook: '', saleDate: '2026-09-15' }), SETTINGS, { season: 'winter' });
  assert.strictEqual(r.subject, 'winter 2026');
  assert.strictEqual(r.emailBody, 'Hook: the roads. [nope]. [hook]');
  assert.deepStrictEqual(r.missing, ['nope', 'hook']);
  var r2 = KIT.render({ subject: '{season}', emailBody: '', textBody: '' }, customer(), SETTINGS, { date: '2027-01-10' });
  assert.strictEqual(r2.subject, 'winter');
});

test('render: {vehicle} derives from year + model when vehicleLabel is empty; {first} from name', function () {
  var c = customer({ vehicleLabel: '', first: '', name: 'Sue Ann Berg', vehicle: { year: 2021, make: 'Toyota', model: 'RAV4' } });
  var r = KIT.render({ subject: '', emailBody: '{first} {vehicle}', textBody: '' }, c, SETTINGS, {});
  assert.strictEqual(r.emailBody, 'Sue 2021 RAV4');
});

test('render: GOODBYE never gets the STOP line, even on a first text', function () {
  var r = KIT.render(LIB.templates[7], customer(), SETTINGS, { firstText: true });
  assert.strictEqual(r.textFull, 'Door is open.');
});

// ------------------------------------------------- never-skipped invariant

test('3-year simulation with random misses: every touch number appears exactly once as sent or skipped; nothing silently skipped', function () {
  var seeds = [1, 7, 42, 2026];
  seeds.forEach(function (seed) {
    var rand = rng(seed);
    var c = customer({ saleDate: '2026-09-15', birthday: '12-20' });
    var acted = [];               // touch numbers acted on, in order
    var day = '2026-09-15';
    var end = KIT.addDays(day, 365 * 3);
    var pendingSince = null;      // dueDate of the item currently sitting in the queue
    var lastQueuedN = null;
    while (day <= end) {
      var q = KIT.buildQueue([c], day);
      assert.ok(q.length <= 1, 'at most one item per customer per day');
      if (q.length === 1) {
        var item = q[0];
        assert.strictEqual(item.n, c.nextTouchN, 'queue item is always the next touch');
        // an item that was due yesterday and not acted on is still here today, unchanged
        if (lastQueuedN !== null && lastQueuedN === item.n) {
          assert.strictEqual(item.dueDate, pendingSince, 'due date never drifts while waiting');
        }
        lastQueuedN = item.n; pendingSince = item.dueDate;
        var roll = rand();
        if (roll < 0.5) {
          c = KIT.applyEvent(c, { type: 'sent', n: item.n, dueDate: item.dueDate, sentDate: day, channels: ['email'], templateId: 't' + item.n }, day);
          acted.push({ n: item.n, how: 'sent', day: day });
          lastQueuedN = null;
          // replies sometimes follow a send
          if (rand() < 0.2) c = KIT.applyEvent(c, { type: 'reply', date: KIT.addDays(day, 1 + Math.floor(rand() * 10)) }, day);
        } else if (roll < 0.7) {
          c = KIT.applyEvent(c, { type: 'skipped', n: item.n }, day);
          acted.push({ n: item.n, how: 'skipped', day: day });
          lastQueuedN = null;
        } else if (roll < 0.75) {
          c = KIT.applyEvent(c, { type: 'snoozed', days: 7 }, day);
        }
        // else: Mick did nothing today; the item must still be there tomorrow
      } else if (lastQueuedN !== null && !(c.snoozedUntil && c.snoozedUntil > day)) {
        assert.fail('touch ' + lastQueuedN + ' vanished from the queue on ' + day + ' without being sent or skipped');
      }
      if (rand() < 0.002) c = KIT.applyEvent(c, { type: 'referralReceived', date: day, referredName: 'x' }, day);
      day = KIT.addDays(day, 1);
    }
    var ns = acted.map(function (a) { return a.n; });
    assert.ok(ns.length >= 6, 'seed ' + seed + ': at least 6 touches acted on in 3 years, got ' + ns.length);
    for (var i = 0; i < ns.length; i++) assert.strictEqual(ns[i], i, 'seed ' + seed + ': touch numbers are 0,1,2,... in order with no gaps or repeats');
    assert.strictEqual(c.nextTouchN, ns.length, 'nextTouchN equals number of touches acted on');
    // min-gap invariant: two actual sends are never closer than 21 days
    var sends = acted.filter(function (a) { return a.how === 'sent'; });
    for (var s = 1; s < sends.length; s++) {
      assert.ok(KIT.diffDays(sends[s - 1].day, sends[s].day) >= 21, 'seed ' + seed + ': sends ' + sends[s - 1].day + ' and ' + sends[s].day + ' are closer than 21 days');
    }
  });
});

test('every touch 0..20 is reachable in order when acted on promptly', function () {
  var c = customer({ saleDate: '2026-09-15', birthday: '02-14' });
  var seen = [];
  for (var i = 0; i < 21; i++) {
    var nt = KIT.nextTouch(c, '2032-01-01');
    assert.strictEqual(nt.n, i);
    assert.ok(KIT.SLOTS.indexOf(nt.slot) !== -1, 'known slot ' + nt.slot);
    seen.push(nt.slot);
    c = KIT.applyEvent(c, { type: i % 3 === 0 ? 'skipped' : 'sent', n: nt.n, dueDate: nt.dueDate, sentDate: nt.dueDate, channels: [] }, nt.dueDate);
  }
  // The 90-day ladder drifts 5 days a year against the calendar, so a touch
  // lands inside the ±14-day birthday window only in some years (not every
  // year). Birthday 02-14 vs a 09-15 sale: touches 14 (Feb 24) and 18 (Feb 18).
  var birthdays = seen.filter(function (s) { return s === 'BIRTHDAY'; }).length;
  assert.strictEqual(birthdays, 2);
  assert.strictEqual(seen[14], 'BIRTHDAY');
  assert.strictEqual(seen[18], 'BIRTHDAY');
  assert.strictEqual(c.slotOffset, birthdays, 'slotOffset counts every birthday displacement');
  // after each displacement the displaced slot appears on the very next touch:
  // touch 14 displaced CHECKIN (14 % 4 == 2) -> touch 15 is CHECKIN;
  // touch 18 (offset 1 -> effective 17) displaced VALUE -> touch 19 is VALUE.
  assert.strictEqual(seen[15], 'CHECKIN');
  assert.strictEqual(seen[19], 'VALUE');
  // 21 touches = THANKS + 2 birthdays + effective ladder slots 1..18
  var counts = {};
  seen.forEach(function (s) { counts[s] = (counts[s] || 0) + 1; });
  assert.strictEqual(counts.THANKS, 1);
  assert.strictEqual(counts.VALUE, 9);
  assert.strictEqual(counts.CHECKIN, 5);
  assert.strictEqual((counts.REFERRAL || 0) + (counts.ANNIVERSARY_REFERRAL || 0), 4);
});

// ----------------------------------------------------------------- done

console.log('');
console.log(passed + ' passed, ' + failed + ' failed, ' + (passed + failed) + ' total');
if (failed) process.exit(1);
