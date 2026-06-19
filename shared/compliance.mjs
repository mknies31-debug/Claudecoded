// shared/compliance.mjs — CLEAN API: the guardrails.
//
// Hard rules from the blueprint, enforced in code (and in the test suite, which
// fails the build on a violation):
//   - texts  <= 3 sentences
//   - emails <= 6 sentences
//   - ZERO currency / trade / credit / financing / price language, anywhere
//   - tone: no exclamation marks, no obvious corporate jargon
//   - optedOut freezes a record completely

export const TEXT_MAX_SENTENCES = 3;
export const EMAIL_MAX_SENTENCES = 6;

/** Count sentences by terminal punctuation, tolerant of trailing whitespace. */
export function countSentences(str) {
  const s = String(str || '').trim();
  if (!s) return 0;
  const parts = s.split(/[.!?]+(?:\s|$)/).filter((p) => p.trim().length > 0);
  return parts.length;
}

export function withinTextLimit(str) {
  return countSentences(str) <= TEXT_MAX_SENTENCES;
}
export function withinEmailLimit(str) {
  return countSentences(str) <= EMAIL_MAX_SENTENCES;
}

// Zero-value principle: nothing that smells like money, trade, or financing.
const VALUE_PATTERNS = [
  /\$/,
  /\b\d+\s?k\b/i,
  /\bdollars?\b/i,
  /\bprice[ds]?\b/i, /\bpricing\b/i,
  /\bpayments?\b/i,
  /\btrade[- ]?in\b/i, /\btrade\b/i,
  /\bcredit\b/i,
  /\bfinanc(?:e|ing|ed)\b/i,
  /\bloan\b/i,
  /\bapr\b/i, /\binterest\s+rate\b/i,
  /\brebate\b/i, /\bdiscount\b/i, /\bdeal\s+price\b/i,
  /\bappraisal\b/i, /\bequity\b/i,
];

/** Returns the list of offending value-talk matches (empty = clean). */
export function valueViolations(str) {
  const s = String(str || '');
  const hits = [];
  for (const re of VALUE_PATTERNS) {
    const m = s.match(re);
    if (m) hits.push(m[0]);
  }
  return hits;
}

// Tone tells we never want in outbound copy.
const TONE_PATTERNS = [
  { re: /!/, msg: 'no exclamation marks' },
  { re: /\b(synergy|leverage|circle back|touch base|cutting[- ]edge|world[- ]class|best[- ]in[- ]class|reach out at your earliest convenience)\b/i, msg: 'corporate jargon' },
];

export function toneViolations(str) {
  const s = String(str || '');
  return TONE_PATTERNS.filter((p) => p.re.test(s)).map((p) => p.msg);
}

/**
 * Full lint of one piece of copy. `kind` is 'text' | 'email'.
 * Returns { ok, problems:[...] }.
 */
export function lintCopy(str, kind = 'text') {
  const problems = [];
  const limitOk = kind === 'email' ? withinEmailLimit(str) : withinTextLimit(str);
  const max = kind === 'email' ? EMAIL_MAX_SENTENCES : TEXT_MAX_SENTENCES;
  if (!limitOk) problems.push(`over ${max} sentences (${countSentences(str)})`);
  const vv = valueViolations(str);
  if (vv.length) problems.push('value/price language: ' + vv.join(', '));
  const tv = toneViolations(str);
  if (tv.length) problems.push(...tv);
  return { ok: problems.length === 0, problems };
}

/** A record is frozen when opted out — no auto-email, no text UI. */
export function isFrozen(customer) {
  return !!(customer && customer.optedOut === true);
}
