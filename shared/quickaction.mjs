// shared/quickaction.mjs — CLEAN API: Fantastical-style quick capture.
//
// "call John Friday" / "text Brenda the RAV4 pics tomorrow" / "follow up with
// Dale Carlson next week" — typed OR spoken into the CARVIS command bar — turns
// into a contact's nextAction + nextActionDue (see schema.mjs) without opening
// the CRM. This module is only the language half: parse the phrase, resolve the
// day word to a real YYYY-MM-DD, build the short action text. Matching the name
// to a customer and saving is the view's job (crm/crm.js) — nothing about the
// DOM, storage, or Date.now lives in this file.
//
// Grammar (case-insensitive, tolerant of a "hey carvis," prefix):
//   <verb> <name (1–2 words)> [detail…] [day word]
//   verbs:    call | text | email | see | visit | thank | check on |
//             follow up with | follow up on   ("follow up …" → 'follow up')
//   day word: today | tomorrow | monday..sunday (or mon..sun) | next week
//             — always LAST; missing → 'today'
// Anything that doesn't start with a verb, or whose "name" is obviously not a
// name (a stopword, a day word, digits), parses to null so normal CARVIS
// commands fall through untouched.

// Optional spoken prefix — the mic transcript often arrives as "hey carvis, …".
const PREFIX_RE = /^\s*(?:hey\s+carvis[,:]?\s*)?/i;

// Longest verbs first so "follow up with" never half-matches as a name.
const VERB_RE = /^(follow\s+up\s+(?:with|on)|check\s+on|call|text|email|see|visit|thank)\s+/i;

// Day word at the very END of the phrase (trailing punctuation stripped first).
// Full names before abbreviations so "monday" isn't eaten by "mon".
const DAY_RE = /\s+(today|tomorrow|next\s+week|monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tues?|weds?|thu(?:rs?)?|fri|sat|sun)$/i;

const DAY_ALIASES = {
  mon: 'monday', tue: 'tuesday', tues: 'tuesday', wed: 'wednesday',
  weds: 'wednesday', thu: 'thursday', thur: 'thursday', thurs: 'thursday',
  fri: 'friday', sat: 'saturday', sun: 'sunday',
};
const WEEKDAY_INDEX = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };

// Words that can trail a verb but are never someone's first name. If the first
// word after the verb is one of these (or a day word), the phrase isn't a quick
// action — "call the guy back" should fall through, not save a next step.
const NON_NAME = new Set([
  'the', 'a', 'an', 'my', 'our', 'your', 'his', 'her', 'their', 'this', 'that',
  'some', 'about', 'on', 'in', 'at', 'for', 'with', 'to', 'and', 'or', 're',
  'regarding', 'him', 'them', 'it', 'me', 'up', 'back', 'next', 'week',
]);

function normalizeVerb(raw) {
  const v = raw.toLowerCase().replace(/\s+/g, ' ');
  if (v.startsWith('follow')) return 'follow up';   // with/on both collapse
  if (v.startsWith('check')) return 'check on';
  return v;
}

function normalizeDay(raw) {
  const d = String(raw).toLowerCase().replace(/\s+/g, ' ');
  return DAY_ALIASES[d] || d;
}

function isDayWord(w) {
  const d = normalizeDay(w);
  return d === 'today' || d === 'tomorrow' || d === 'next week' || (d in WEEKDAY_INDEX);
}

const stripPunct = (w) => String(w).replace(/^[^\w'’-]+|[^\w'’-]+$/g, '');

// A plausible name word: letters (apostrophe/hyphen ok), no digits, and not a
// stopword or day word. Capitalized-or-not on purpose — voice transcripts and
// hurried typing both arrive lowercase.
function nameLike(w) {
  if (!/^[a-z][a-z'’-]*$/i.test(w)) return false;
  const lower = w.toLowerCase();
  return !NON_NAME.has(lower) && !isDayWord(lower);
}

/**
 * Parse a quick-capture phrase → { verb, name, detail, dayWord } or null.
 *
 * Name is kept simple by design: the FIRST word after the verb, plus the second
 * word when it also reads as a name ("Dale Carlson") — for longer phrases the
 * second word must be Capitalized to join, so "text Brenda the RAV4 pics"
 * keeps the name at "Brenda" and everything between name and day word lands in
 * `detail` (may be ''). No match → null, so callers can fall through.
 */
export function parseQuickAction(text) {
  if (typeof text !== 'string') return null;
  const s = text.trim().replace(PREFIX_RE, '');
  const vm = VERB_RE.exec(s);
  if (!vm) return null;
  const verb = normalizeVerb(vm[1]);

  // Tail = everything after the verb; peel trailing punctuation, then the
  // (optional) day word off the end. A tail that IS just a day word has no
  // name ("call friday") — that rejects below via nameLike.
  let tail = s.slice(vm[0].length).trim().replace(/[.!?,;:]+$/, '').trim();
  let dayWord = 'today';
  const dm = DAY_RE.exec(tail);
  if (dm) { dayWord = normalizeDay(dm[1]); tail = tail.slice(0, dm.index).trim(); }

  const words = tail.split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  const w1 = stripPunct(words[0]);
  if (!nameLike(w1)) return null;

  let name = w1;
  let rest = words.slice(1);
  if (rest.length) {
    const w2 = stripPunct(rest[0]);
    // Second word joins the name when it's the whole remainder ("dale carlson")
    // or, mid-phrase, when it's Capitalized ("Dale Carlson about the tires").
    if (nameLike(w2) && (rest.length === 1 || /^[A-Z]/.test(w2))) {
      name += ' ' + w2;
      rest = rest.slice(1);
    }
  }
  return { verb, name, detail: rest.join(' ').trim(), dayWord };
}

const MS_PER_DAY = 86400000;

/**
 * Resolve a day word against an anchor date (YYYY-MM-DD) → YYYY-MM-DD.
 * Pure string/UTC math — same trick as sequences.mjs — so no timezone can
 * shift the calendar date. Weekday names mean the NEXT occurrence strictly
 * after today: "friday" said on a Friday lands a week out, never today.
 */
export function resolveDueDate(dayWord, todayStr) {
  const anchor = String(todayStr || '').slice(0, 10);
  const base = Date.parse(anchor + 'T00:00:00Z');
  if (Number.isNaN(base)) return anchor;
  const d = normalizeDay(dayWord == null || dayWord === '' ? 'today' : dayWord);
  let add = 0;
  if (d === 'tomorrow') add = 1;
  else if (d === 'next week') add = 7;
  else if (d in WEEKDAY_INDEX) add = ((WEEKDAY_INDEX[d] - new Date(base).getUTCDay() + 7) % 7) || 7;
  return new Date(base + add * MS_PER_DAY).toISOString().slice(0, 10);
}

/**
 * The human next-action text for the customer card: the verb, plus the free
 * detail when there was one — "call", "text — the RAV4 pics". Kept short; the
 * due date lives in its own field.
 */
export function buildNextAction(parsed) {
  if (!parsed || !parsed.verb) return '';
  return parsed.verb + (parsed.detail ? ' — ' + parsed.detail : '');
}
