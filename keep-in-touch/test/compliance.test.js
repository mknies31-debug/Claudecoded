'use strict';
// node test/compliance.test.js — zero deps.
const assert = require('assert');
const path = require('path');
const C = require(path.join(__dirname, '..', 'netlify', 'functions', 'lib', 'compliance.js'));

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + (e && e.message)); }
}

const settings = {
  businessAddress: '[VERIFY] 123 Main St, Zumbrota, MN 55992',
  fromName: 'Mick at North Star Car Guy',
  mickPhoneDisplay: '(507) 555-0000'
};
const url = 'https://example.netlify.app/?u=abcdefghijklmnopqrstuvwxyz012345';

const base = () => ({
  name: 'Dan Halvorson', first: 'Dan', phone: '5075551234', email: 'dan@example.com',
  status: 'active',
  emailConsent: { given: true, at: '2026-09-15T14:03:00.000Z', how: 'in person at sale' },
  smsConsent: { given: false, at: '', how: '' },
  dnc: null
});

console.log('compliance.js v' + C.VERSION);

/* ---------------- exports ---------------- */
test('exports per SPEC §7', () => {
  ['emailFooter', 'canEmail', 'canText', 'consentSummary', 'isOptOutText', 'optOutReplyKind']
    .forEach(k => assert.strictEqual(typeof C[k], 'function', k));
  assert.strictEqual(C.smsOptOutLine, 'Reply STOP to opt out.');
  assert.deepStrictEqual(C.consentHowOptions, ['in person at sale', 'phone', 'text', 'email', 'web form']);
  assert.strictEqual(typeof C.OPT_OUT_RULE, 'string');
  assert.ok(C.OPT_OUT_RULE.length > 50);
  assert.ok(/^\d+\.\d+\.\d+$/.test(C.VERSION));
});

/* ---------------- footer ---------------- */
test('footer: starts with -- separator, ≤ 5 lines, plain text', () => {
  const f = C.emailFooter(settings, url);
  const lines = f.split('\n');
  assert.strictEqual(lines[0], '--');
  assert.ok(lines.length <= 5, 'lines=' + lines.length);
  assert.ok(!/<[a-z]+>/i.test(f), 'no html tags');
});
test('footer: salesperson wording, not owner', () => {
  const f = C.emailFooter(settings, url);
  assert.ok(f.includes('Mick Knies, North Star Car Guy, selling at Mosaic Autos'));
  assert.ok(!/\bowner\b|\bmy dealership\b|\bmy lot\b/i.test(f));
});
test('footer: says why they are getting it and that it is scheduled pre-approved words', () => {
  const f = C.emailFooter(settings, url);
  assert.ok(f.includes('because you bought a vehicle from me'));
  assert.ok(f.includes('said it was okay for me to keep in touch'));
  assert.ok(f.includes('my own words'));
  assert.ok(f.includes('sent on a schedule'));
});
test('footer: unsubscribe URL on its own line', () => {
  const f = C.emailFooter(settings, url);
  const line = f.split('\n').find(l => l.includes(url));
  assert.ok(line, 'url present');
  assert.strictEqual(line, "Don't want these? One tap and you're off: " + url);
});
test('footer: ends with the physical address line', () => {
  const lines = C.emailFooter(settings, url).split('\n');
  assert.strictEqual(lines[lines.length - 1], 'North Star Car Guy at Mosaic Autos · [VERIFY] 123 Main St, Zumbrota, MN 55992');
});
test('footer: address line still printed when address is empty or missing (never silently dropped)', () => {
  const a = C.emailFooter({ businessAddress: '' }, url).split('\n').pop();
  assert.strictEqual(a, 'North Star Car Guy at Mosaic Autos · ');
  const b = C.emailFooter({}, url).split('\n').pop();
  assert.strictEqual(b, 'North Star Car Guy at Mosaic Autos · ');
  const c = C.emailFooter(undefined, undefined).split('\n');
  assert.strictEqual(c[0], '--');
  assert.strictEqual(c.pop(), 'North Star Car Guy at Mosaic Autos · ');
});
test('footer: no exclamation points, no superlatives, no banned phrases', () => {
  const f = C.emailFooter(settings, url);
  assert.ok(!f.includes('!'));
  assert.ok(!/\b(best|greatest|top|#1|lowest|highest|cheapest|fastest|most|biggest|finest|perfect|premier)\b/i.test(f));
  assert.ok(!/just checking in|touching base|circling back|reaching out|i noticed you haven't|valued customer|at this time/i.test(f));
});
test('footer: names the brand and never implies ownership', () => {
  const f = C.emailFooter(settings, url).toLowerCase();
  assert.ok(f.includes('north star car guy'));
  assert.ok(!f.includes('my dealership'));
  assert.ok(!f.includes('i own'));
});
test('footer: only ? characters are the deliberate unsubscribe prompt and the URL query', () => {
  const f = C.emailFooter(settings, 'https://x.test/?u=T');
  const count = (f.match(/\?/g) || []).length;
  assert.strictEqual(count, 2);
});

/* ---------------- consent labels ---------------- */
test('consent checkbox labels: ≤ 25 words each, plain, no !', () => {
  ['email', 'sms'].forEach(k => {
    const s = C.consentLabels[k];
    assert.ok(typeof s === 'string' && s.length > 0, k);
    assert.ok(s.trim().split(/\s+/).length <= 25, k + ' word count');
    assert.ok(!s.includes('!'), k);
  });
  assert.ok(/STOP/.test(C.consentLabels.sms));
});

/* ---------------- canEmail / canText matrix ---------------- */
test('canEmail: happy path true', () => {
  assert.strictEqual(C.canEmail(base()), true);
});
test('canEmail: dnc → false', () => {
  const c = base(); c.status = 'dnc'; c.dnc = { at: '2026-09-20T00:00:00.000Z', reason: 'STOP reply', channel: 'both' };
  assert.strictEqual(C.canEmail(c), false);
});
test('canEmail: consent false → false', () => {
  const c = base(); c.emailConsent = { given: false, at: '', how: '' };
  assert.strictEqual(C.canEmail(c), false);
});
test('canEmail: consent missing / truthy-but-not-true → false', () => {
  const c = base(); delete c.emailConsent;
  assert.strictEqual(C.canEmail(c), false);
  const d = base(); d.emailConsent = { given: 'yes', at: '', how: '' };
  assert.strictEqual(C.canEmail(d), false);
});
test('canEmail: missing or malformed email → false', () => {
  const c = base(); c.email = '';
  assert.strictEqual(C.canEmail(c), false);
  const d = base(); delete d.email;
  assert.strictEqual(C.canEmail(d), false);
  const e = base(); e.email = 'not-an-email';
  assert.strictEqual(C.canEmail(e), false);
});
test('canEmail: missing status → false (status must be "active")', () => {
  const c = base(); delete c.status;
  assert.strictEqual(C.canEmail(c), false);
});
test('canEmail/canText: null or undefined customer → false, never throws', () => {
  assert.strictEqual(C.canEmail(null), false);
  assert.strictEqual(C.canEmail(undefined), false);
  assert.strictEqual(C.canText(null), false);
  assert.strictEqual(C.canText({}), false);
});
test('canText: happy path true', () => {
  const c = base(); c.smsConsent = { given: true, at: '2026-09-15T14:03:00.000Z', how: 'in person at sale' };
  assert.strictEqual(C.canText(c), true);
});
test('canText: dnc → false', () => {
  const c = base(); c.smsConsent = { given: true, at: '2026-09-15T14:03:00.000Z', how: 'text' }; c.status = 'dnc';
  assert.strictEqual(C.canText(c), false);
});
test('canText: consent false → false', () => {
  assert.strictEqual(C.canText(base()), false);
});
test('canText: missing or short phone → false', () => {
  const c = base(); c.smsConsent = { given: true, at: '', how: 'phone' }; c.phone = '';
  assert.strictEqual(C.canText(c), false);
  const d = base(); d.smsConsent = { given: true, at: '', how: 'phone' }; d.phone = '5551234';
  assert.strictEqual(C.canText(d), false);
  const e = base(); e.smsConsent = { given: true, at: '', how: 'phone' }; e.phone = '(507) 555-1234';
  assert.strictEqual(C.canText(e), true, 'formatted phone with 10 digits is fine');
});
test('email consent does not grant text, and vice versa', () => {
  const c = base(); // email yes, sms no
  assert.strictEqual(C.canEmail(c), true);
  assert.strictEqual(C.canText(c), false);
  const d = base(); d.emailConsent = { given: false, at: '', how: '' }; d.smsConsent = { given: true, at: '', how: 'phone' };
  assert.strictEqual(C.canEmail(d), false);
  assert.strictEqual(C.canText(d), true);
});

/* ---------------- consentSummary ---------------- */
test('consentSummary: SPEC format', () => {
  assert.strictEqual(C.consentSummary(base()), 'Email: yes (in person at sale, 2026-09-15) · SMS: no');
});
test('consentSummary: both yes', () => {
  const c = base(); c.smsConsent = { given: true, at: '2026-10-01T09:00:00.000Z', how: 'text' };
  assert.strictEqual(C.consentSummary(c), 'Email: yes (in person at sale, 2026-09-15) · SMS: yes (text, 2026-10-01)');
});
test('consentSummary: yes with missing how/at degrades gracefully', () => {
  const c = base(); c.emailConsent = { given: true, at: '', how: '' };
  assert.strictEqual(C.consentSummary(c), 'Email: yes · SMS: no');
  const d = base(); d.emailConsent = { given: true, at: '', how: 'phone' };
  assert.strictEqual(C.consentSummary(d), 'Email: yes (phone) · SMS: no');
});
test('consentSummary: dnc customer gets a Do not contact segment', () => {
  const c = base(); c.status = 'dnc'; c.dnc = { at: '2026-09-20T15:00:00.000Z', reason: 'STOP reply', channel: 'both' };
  assert.strictEqual(C.consentSummary(c),
    'Email: yes (in person at sale, 2026-09-15) · SMS: no · Do not contact (STOP reply, 2026-09-20)');
});
test('consentSummary: empty customer', () => {
  assert.strictEqual(C.consentSummary({}), 'Email: no · SMS: no');
  assert.strictEqual(C.consentSummary(null), 'Email: no · SMS: no');
});

/* ---------------- isOptOutText ---------------- */
const OPT_OUT_TRUE = [
  'STOP', 'stop', 'Stop.', 'STOP!', ' stop ', 'Quit', 'END', 'end', 'cancel', 'CANCEL',
  'unsubscribe', 'Unsubscribe', 'UNSUBSCRIBE ME',
  'please unsubscribe me from this',
  'opt out', 'opt-out', 'I want to opt-out of these emails',
  'remove me', 'Remove me from your list please',
  'do not contact me', "Don't contact me again", 'Dont contact me',
  'stop texting me', 'Please stop emailing me, thanks',
  'take me off the list', 'Take me off',
  'stop please', 'Stop it', 'stop, thanks',
  'Quit sending these', 'End these emails now please',
  'Cancel this', 'STOP ALL', 'stop\n', 'Stop!!!', '“Stop”'
];
const OPT_OUT_FALSE = [
  '', null, undefined, '   ', 'yes', 'No', 'Sure',
  'I stopped by the lot', 'the stop sign', 'Stop by the lot Friday', 'Cancel that, I will come Tuesday',
  'Can you stop by Tuesday? I have questions about the truck',
  'The truck is running great, thanks for the tip',
  'Not yet, but my nephew is looking this spring',
  'Sounds good, I will end up needing tires before winter',
  'We had to cancel our trip but the Silverado is fine',
  'No, the weekend is quit busy for us', // typo of "quite"; 8 words, not first word → false
  'Do you have that in a different color', // no opt-out words
  'Tell them I sent you and they can quit looking', // 9 words, quit not first
  'Ended up going with the blue one, love it',
  'Stopping by tomorrow to grab the plates',
  'Unstoppable, that thing is a tank',
  'Contact me next week about the trade',
  'Please opt me out' // known miss: "opt me out" is not in the agreed shared rule; Mick handles by hand (documented)
];
OPT_OUT_TRUE.forEach(s => test('isOptOutText true: ' + JSON.stringify(s), () => assert.strictEqual(C.isOptOutText(s), true)));
OPT_OUT_FALSE.forEach(s => test('isOptOutText false: ' + JSON.stringify(s), () => assert.strictEqual(C.isOptOutText(s), false)));

test('isOptOutText: non-string input coerces safely', () => {
  assert.strictEqual(C.isOptOutText(0), false);
  assert.strictEqual(C.isOptOutText({}), false);
  assert.strictEqual(C.isOptOutText(['stop']), false); // non-strings are never opt-outs (engine rule)
});

/* ---------------- optOutReplyKind ---------------- */
test('optOutReplyKind hints', () => {
  assert.strictEqual(C.optOutReplyKind('STOP'), 'sms');
  assert.strictEqual(C.optOutReplyKind('stop texting me'), 'sms');
  assert.strictEqual(C.optOutReplyKind('please unsubscribe me from this'), 'email');
  assert.strictEqual(C.optOutReplyKind('stop emailing me'), 'email');
  assert.strictEqual(C.optOutReplyKind('remove me'), '');
  assert.strictEqual(C.optOutReplyKind('sounds good'), '');
});

/* ---------------- UMD ---------------- */
test('UMD: file has no ES module syntax and evaluates as a browser global', () => {
  const fs = require('fs');
  const src = fs.readFileSync(path.join(__dirname, '..', 'netlify', 'functions', 'lib', 'compliance.js'), 'utf8');
  assert.ok(!/^\s*(import|export)\s/m.test(src), 'no import/export');
  const fakeWindow = {};
  new Function('self', 'module', 'window', src).call(fakeWindow, fakeWindow, undefined, fakeWindow);
  assert.strictEqual(typeof fakeWindow.COMPLIANCE.isOptOutText, 'function');
  assert.strictEqual(fakeWindow.COMPLIANCE.VERSION, C.VERSION);
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
