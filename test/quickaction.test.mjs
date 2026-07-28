// test/quickaction.test.mjs — natural-language quick capture (node --test).
//
// Run: `npm test` — node's built-in runner + assert, no installs.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseQuickAction, resolveDueDate, buildNextAction } from '../shared/quickaction.mjs';

// Anchor for all date math: 2026-07-28 is a Tuesday (UTC).
const TUE = '2026-07-28';

// ── verbs ────────────────────────────────────────────────────────────────────
test('every simple verb parses and lowercases', () => {
  for (const verb of ['call', 'text', 'email', 'see', 'visit', 'thank']) {
    const p = parseQuickAction(`${verb} John Friday`);
    assert.ok(p, `"${verb} John Friday" parses`);
    assert.equal(p.verb, verb);
    assert.equal(p.name, 'John');
    assert.equal(p.dayWord, 'friday');
  }
  assert.equal(parseQuickAction('CALL JOHN FRIDAY').verb, 'call'); // case-insensitive
});

test('"check on" normalizes to the two-word verb', () => {
  const p = parseQuickAction('check on Sam tomorrow');
  assert.equal(p.verb, 'check on');
  assert.equal(p.name, 'Sam');
  assert.equal(p.dayWord, 'tomorrow');
});

test('"follow up with" normalizes to "follow up"', () => {
  const p = parseQuickAction('follow up with Dale Carlson next week');
  assert.equal(p.verb, 'follow up');
  assert.equal(p.name, 'Dale Carlson');
  assert.equal(p.dayWord, 'next week');
});

test('"follow up on" also normalizes to "follow up"', () => {
  const p = parseQuickAction('follow up on Brenda monday');
  assert.equal(p.verb, 'follow up');
  assert.equal(p.name, 'Brenda');
  assert.equal(p.dayWord, 'monday');
});

// ── names: one word, two words, punctuation ──────────────────────────────────
test('one-word name, no day word → today', () => {
  const p = parseQuickAction('thank Sam');
  assert.deepEqual(p, { verb: 'thank', name: 'Sam', detail: '', dayWord: 'today' });
});

test('two-word name sticks together, lowercase included', () => {
  assert.equal(parseQuickAction('call Dale Carlson').name, 'Dale Carlson');
  assert.equal(parseQuickAction('call dale carlson friday').name, 'dale carlson');
});

test('trailing punctuation is trimmed off the name', () => {
  const p = parseQuickAction('call John.');
  assert.equal(p.name, 'John');
  assert.equal(p.dayWord, 'today');
});

// ── day words ────────────────────────────────────────────────────────────────
test('every weekday name and abbreviation is recognized at the end', () => {
  const pairs = [
    ['monday', 'monday'], ['tuesday', 'tuesday'], ['wednesday', 'wednesday'],
    ['thursday', 'thursday'], ['friday', 'friday'], ['saturday', 'saturday'],
    ['sunday', 'sunday'],
    ['mon', 'monday'], ['tue', 'tuesday'], ['tues', 'tuesday'], ['wed', 'wednesday'],
    ['thu', 'thursday'], ['thurs', 'thursday'], ['fri', 'friday'], ['sat', 'saturday'], ['sun', 'sunday'],
  ];
  for (const [raw, full] of pairs) {
    const p = parseQuickAction(`call John ${raw}`);
    assert.ok(p, `"call John ${raw}" parses`);
    assert.equal(p.dayWord, full);
    assert.equal(p.name, 'John'); // day word never leaks into the name
  }
});

test('missing day word defaults to today', () => {
  assert.equal(parseQuickAction('text Brenda').dayWord, 'today');
});

// ── resolveDueDate: pure UTC math off the anchor string ──────────────────────
test('today and tomorrow resolve off the anchor', () => {
  assert.equal(resolveDueDate('today', TUE), '2026-07-28');
  assert.equal(resolveDueDate('tomorrow', TUE), '2026-07-29');
});

test('each weekday resolves to the NEXT occurrence strictly after today', () => {
  // Anchored on a Tuesday: same-day "tuesday" jumps a full week.
  assert.equal(resolveDueDate('wednesday', TUE), '2026-07-29');
  assert.equal(resolveDueDate('thursday', TUE), '2026-07-30');
  assert.equal(resolveDueDate('friday', TUE), '2026-07-31');
  assert.equal(resolveDueDate('saturday', TUE), '2026-08-01');
  assert.equal(resolveDueDate('sunday', TUE), '2026-08-02');
  assert.equal(resolveDueDate('monday', TUE), '2026-08-03');
  assert.equal(resolveDueDate('tuesday', TUE), '2026-08-04'); // same day → +7
});

test('a "friday" said on a Friday lands a week out', () => {
  assert.equal(resolveDueDate('friday', '2026-07-31'), '2026-08-07'); // 07-31 is a Friday
});

test('abbreviations resolve like the full weekday', () => {
  assert.equal(resolveDueDate('fri', TUE), resolveDueDate('friday', TUE));
});

test('tomorrow rolls across a month end and a year end', () => {
  assert.equal(resolveDueDate('tomorrow', '2026-07-31'), '2026-08-01');
  assert.equal(resolveDueDate('tomorrow', '2026-12-31'), '2027-01-01');
});

test('"next week" is a flat +7', () => {
  assert.equal(resolveDueDate('next week', TUE), '2026-08-04');
  assert.equal(resolveDueDate('next week', '2026-07-30'), '2026-08-06');
});

// ── detail: the free text between name and day word ──────────────────────────
test('middle free text becomes detail — "text Brenda the RAV4 pics tomorrow"', () => {
  const p = parseQuickAction('text Brenda the RAV4 pics tomorrow');
  assert.equal(p.name, 'Brenda');       // stays one word — "the" is no name
  assert.equal(p.detail, 'the RAV4 pics');
  assert.equal(p.dayWord, 'tomorrow');
});

test('a Capitalized second word joins the name even with detail after it', () => {
  const p = parseQuickAction('call Dale Carlson about the tires friday');
  assert.equal(p.name, 'Dale Carlson');
  assert.equal(p.detail, 'about the tires');
  assert.equal(p.dayWord, 'friday');
});

test('detail is the empty string when there is none', () => {
  assert.equal(parseQuickAction('call John Friday').detail, '');
});

// ── buildNextAction ──────────────────────────────────────────────────────────
test('buildNextAction is verb plus optional detail', () => {
  assert.equal(buildNextAction(parseQuickAction('call John Friday')), 'call');
  assert.equal(buildNextAction(parseQuickAction('text Brenda the RAV4 pics tomorrow')), 'text — the RAV4 pics');
  assert.equal(buildNextAction(null), '');
});

// ── rejection: normal commands must fall through ─────────────────────────────
test('no verb, no parse — "hello", questions, junk', () => {
  assert.equal(parseQuickAction('hello'), null);
  assert.equal(parseQuickAction('what is a Friday'), null);
  assert.equal(parseQuickAction(''), null);
  assert.equal(parseQuickAction(null), null);
});

test('a bare verb has no name — reject', () => {
  assert.equal(parseQuickAction('call'), null);
  assert.equal(parseQuickAction('call '), null);
});

test('obviously-non-name tails reject', () => {
  assert.equal(parseQuickAction('call the guy back'), null);   // stopword "name"
  assert.equal(parseQuickAction('call friday'), null);         // day word is no name
  assert.equal(parseQuickAction('text 5551234567 tomorrow'), null); // digits
});

// ── the spoken prefix ────────────────────────────────────────────────────────
test('"hey carvis," prefix is tolerated, with or without the comma', () => {
  const p = parseQuickAction('hey carvis, call John Friday');
  assert.deepEqual(p, { verb: 'call', name: 'John', detail: '', dayWord: 'friday' });
  assert.equal(parseQuickAction('Hey Carvis text Brenda tomorrow').name, 'Brenda');
});
