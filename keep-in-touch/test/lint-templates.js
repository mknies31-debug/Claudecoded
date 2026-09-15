#!/usr/bin/env node
'use strict';
// Lint for templates.json — the mechanical half of Mick's ten Brand Rules plus SPEC §5.
// Zero deps. `node test/lint-templates.js` exits 1 on any failure. Warnings never fail.

const fs = require('fs');
const path = require('path');

const FILE = process.argv[2] || path.join(__dirname, '..', 'templates.json');

// ---------- rule tables ----------

const SLOTS = ['ASK', 'THANKS', 'THANKS_REPEAT', 'VALUE', 'CHECKIN', 'REFERRAL',
  'ANNIVERSARY_REFERRAL', 'BIRTHDAY', 'REFERRAL_THANKS', 'GOODBYE'];
const SEASONS = ['winter', 'spring', 'summer', 'fall', 'any'];
const TONES = ['direct', 'softer', 'nepq'];
const FIELDS = ['id', 'slot', 'season', 'tone', 'principle', 'subject', 'emailBody', 'textBody', 'editHint'];

// SPEC §5 minimums. VALUE is per season.
const MIN = {
  ASK: 4, THANKS: 4, THANKS_REPEAT: 2, CHECKIN: 6, REFERRAL: 6, ANNIVERSARY_REFERRAL: 3,
  BIRTHDAY: 3, REFERRAL_THANKS: 3, GOODBYE: 2,
  'VALUE/fall': 4, 'VALUE/winter': 4, 'VALUE/spring': 4, 'VALUE/summer': 4, 'VALUE/any': 2,
};

const ID_PREFIX = {
  ASK: 'ask', THANKS: 'thanks', THANKS_REPEAT: 'thanks-repeat', CHECKIN: 'checkin', REFERRAL: 'referral',
  ANNIVERSARY_REFERRAL: 'anniversary-referral', BIRTHDAY: 'birthday',
  REFERRAL_THANKS: 'referral-thanks', GOODBYE: 'goodbye',
};

const ALLOWED_PLACEHOLDERS = ['first', 'vehicle', 'year', 'make', 'model', 'hook', 'phone', 'sale_year', 'season', 'referred'];
const NEEDS_FALLBACK = ['hook', 'referred'];
const NHTSA = 'https://www.nhtsa.gov/recalls';

// Brand Rule 5 + the build prompt's extra list + AI-sounding filler. Case-insensitive, phrase match.
const BANNED_PHRASES = [
  'just checking in', 'checking in', 'check in', 'check-in', 'touching base', 'touch base',
  'circling back', 'circle back', 'reaching out', 'reach out', 'i noticed you', "i noticed you haven't",
  'valued customer', 'at this time', 'premier', "don't hesitate", 'do not hesitate',
  'hope this finds you', 'hope this email finds you', 'i wanted to', 'feel free',
  // fake urgency / scarcity / guilt
  'limited time', 'act now', 'hurry', 'last chance', 'today only', 'deadline', 'expires',
  'while supplies last', "haven't heard", 'have not heard', 'never heard back', "you haven't replied",
  'you have not replied', 'i noticed', 'no response',
  // money-shaped words (Brand Rule 4)
  'dollar', 'dollars', 'bucks', 'price', 'prices', 'pricing', 'payment', 'payments', 'cost', 'costs',
  'trade value', 'trade-in value', 'book value', 'appraisal', 'quote', 'cheap', 'afford', 'financing',
  'apr', 'percent', 'discount', 'coupon', 'rebate', 'incentive', 'promotion', 'gift card', 'special offer',
  // "swing by and I'll take a look" tacked on (Agent 3 brief)
  'swing by', 'stop by', 'stop in', 'come on in', 'come by', 'bring it in', 'bring it by', 'take a look',
  'let me look', "i'll look at it", 'i will look at it',
  // buy-side / generic referral ask (Brand Rule 8 + Agent 3 brief)
  'know anyone', 'know anybody', 'anyone looking', 'anybody looking', 'in the market', 'looking for a car',
  'looking to buy', 'thinking of selling', 'thinking about selling',
  // corporate / AI-sounding
  'delighted', 'thrilled', 'excited', 'journey', 'seamless', 'kindly', 'utilize', 'ensure', 'leverage',
  'elevate', 'unlock', 'furthermore', 'additionally', 'as always', 'dear customer', 'dear valued',
  'we appreciate your business', 'thank you for your business',
];

// Superlatives (Brand Rule 5) — whole word, case-insensitive.
const SUPERLATIVES = ['best', 'greatest', 'top', '#1', 'lowest', 'highest', 'cheapest', 'fastest', 'most',
  'biggest', 'finest', 'perfect', 'amazing', 'incredible', 'unbeatable', 'guaranteed', 'guarantee', 'number one'];

// Nothing may imply Mick owns Mosaic.
const OWNERSHIP = ['my dealership', 'my lot', 'my store', 'my shop', 'my business', 'my company',
  'my inventory', 'my team', 'my staff', 'my place', 'my showroom', 'we at mosaic', 'our dealership',
  'our lot', 'our store', 'our shop', 'our inventory', 'our team', 'our staff', 'our showroom',
  'own mosaic', 'owner of mosaic', 'my mosaic', 'owner here', 'as the owner'];

// Final-sentence phrases that are not one-word answerable (Brand Rule 6).
const NOT_ONE_WORD = ['let me know', 'thoughts', 'what do you think', 'tell me', 'when can', 'when would',
  'what time', 'how about', 'why ', 'explain', 'describe', 'what would you', 'how are', 'how is', "how's",
  'how did', 'how has', 'how was', 'how do', 'how does', 'how come', 'which day', 'what day'];

// principle must honestly name one of these.
const PRINCIPLE_KEYWORDS = ['reciprocity', 'ask-after-giving', 'ask after giving', 'after giving', 'consistency',
  'identity', 'peak-end', 'mere exposure', 'mere-exposure', 'low-friction', 'low friction',
  'specific-person', 'specific person', 'autonomy'];

const BIRTHDAY_BANNED = ['gift', 'coupon', 'present', 'free', 'offer', 'deal', 'discount', 'treat you'];
const REFERRAL_PERSON_WORDS = ['co-worker', 'coworker', 'neighbor', 'brother-in-law', 'sister', 'uncle', 'kid',
  'farmer', 'friend', 'church', 'work', 'family', 'parents'];
const DOUBLE_ASK = ['anybody else', 'anyone else', 'keep them coming', 'the next one', 'send more', 'another one'];

const MAX_EMAIL_SENTENCES = 5;
const MAX_TEXT_SENTENCES = 2;
const MAX_QUESTION_WORDS = 20;
const MAX_SENTENCE_WORDS = 45;
const MAX_TEXT_CHARS = 300;
const MAX_SUBJECT_WORDS = 7; // "under 8"
const MAX_SUBJECT_CHARS = 60;
const MAX_EDITHINT_CHARS = 160;

// ---------- helpers ----------

const errors = [];
const warnings = [];
const fail = (id, msg) => errors.push(`${id}: ${msg}`);
const warn = (id, msg) => warnings.push(`${id}: ${msg}`);

// Replace every placeholder with a single opaque token so `|`, `.` and `_` inside never confuse the splitter.
function neutralize(s) { return s.replace(/\{[a-z_]+(\|[^{}]*)?\}/g, 'PLACEHOLDER'); }

// Sentences: split after . ? ! when followed by whitespace or end. URLs (dots not followed by space) survive.
function sentences(body) {
  return neutralize(body).split(/(?<=[.?!])(?:\s+|$)/).map(s => s.trim()).filter(Boolean);
}
function words(s) { return neutralize(s).trim().split(/\s+/).filter(Boolean); }
function has(hay, needle) { return hay.toLowerCase().includes(needle.toLowerCase()); }
function hasWord(hay, w) {
  const esc = w.replace(/[.*+?^${}()|[\]\\#]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${esc}(?=$|[^a-z0-9])`, 'i').test(hay);
}
function firstThreeWords(body) { return words(body).slice(0, 3).join(' ').toLowerCase().replace(/[,.:;]/g, ''); }

// ---------- shared text checks (bodies and subjects) ----------

function checkText(id, label, text, opts = {}) {
  if (typeof text !== 'string' || !text.trim()) { fail(id, `${label} is empty`); return; }
  if (text !== text.trim()) fail(id, `${label} has leading/trailing whitespace`);
  if (/\n|\r|\t/.test(text)) fail(id, `${label} contains a line break or tab (bodies are one paragraph)`);
  if (/ {2,}/.test(text)) fail(id, `${label} has a double space`);
  if (/[^\x20-\x7E]/.test(text)) fail(id, `${label} contains a non-ASCII character (use straight quotes, no em dash)`);
  if (text.includes('!')) fail(id, `${label} contains an exclamation point`);
  if (text.includes('$')) fail(id, `${label} contains a dollar sign`);
  if (/^dear\b/i.test(text)) fail(id, `${label} starts with "Dear"`);

  // digits: only "Hwy NN" survives; everything else can read as a price, a year, or a payment.
  const noHwy = text.replace(/\bHwy \d{2,3}\b/g, 'HWY');
  if (/\d/.test(noHwy)) fail(id, `${label} contains a digit outside "Hwy NN" (write numbers as words)`);

  for (const p of BANNED_PHRASES) if (hasWord(text, p)) fail(id, `${label} contains banned phrase "${p}"`);
  for (const s of SUPERLATIVES) if (hasWord(text, s)) fail(id, `${label} contains superlative "${s}"`);
  for (const o of OWNERSHIP) if (has(text, o)) fail(id, `${label} implies ownership: "${o}"`);

  // placeholders
  const braces = text.match(/[{}]/g) || [];
  const phs = [...text.matchAll(/\{([a-z_]+)(\|([^{}]*))?\}/g)];
  if (braces.length !== phs.length * 2) fail(id, `${label} has a stray or malformed brace`);
  for (const m of phs) {
    const key = m[1];
    if (!ALLOWED_PLACEHOLDERS.includes(key)) fail(id, `${label} uses unknown placeholder {${key}}`);
    if (NEEDS_FALLBACK.includes(key) && (m[2] === undefined || !m[3] || !m[3].trim())) {
      fail(id, `${label} uses {${key}} without a |fallback`);
    }
    if (!NEEDS_FALLBACK.includes(key) && m[2] !== undefined) fail(id, `${label}: {${key}} should not carry a fallback`);
  }

  // links: only the NHTSA lookup, and never as the opening of a message
  const links = text.match(/https?:\/\/\S+|www\.\S+|\b[a-z0-9-]+\.(com|gov|net|org)\b\S*/gi) || [];
  for (const l of links) {
    if (l.replace(/[.,;:]+$/, '') !== NHTSA) fail(id, `${label} contains a link other than the NHTSA lookup: ${l}`);
  }
  if (opts.link === 'forbid' && links.length) fail(id, `${label} must not contain a link`);
  return links;
}

// ---------- body checks ----------

function checkBody(t, label, body, maxSentences, wantsQuestion) {
  const id = t.id;
  const links = checkText(id, label, body) || [];
  if (typeof body !== 'string' || !body.trim()) return null;

  const sents = sentences(body);
  if (sents.length > maxSentences) fail(id, `${label} has ${sents.length} sentences (max ${maxSentences})`);
  if (sents.length === 0) fail(id, `${label} has no sentences`);
  for (const s of sents) {
    if (!/[.?!]$/.test(s)) fail(id, `${label} sentence does not end with punctuation: "${s.slice(0, 40)}..."`);
    const n = words(s).length;
    if (n > MAX_SENTENCE_WORDS) fail(id, `${label} has a ${n}-word sentence (max ${MAX_SENTENCE_WORDS}): "${s.slice(0, 40)}..."`);
  }
  if (/\.\.\./.test(body)) fail(id, `${label} uses an ellipsis`);
  if (/\b(st|mr|mrs|dr|vs|etc|e\.g|i\.e|a\.m|p\.m)\./i.test(body)) fail(id, `${label} uses an abbreviation with a period (breaks sentence count)`);

  const qCount = (body.match(/\?/g) || []).length;
  const last = sents[sents.length - 1] || '';
  if (wantsQuestion) {
    if (qCount !== 1) fail(id, `${label} has ${qCount} question marks (need exactly 1)`);
    if (!body.endsWith('?')) fail(id, `${label} does not end with the question mark`);
    const qWords = words(last).length;
    if (qWords > MAX_QUESTION_WORDS) fail(id, `${label} closing question is ${qWords} words (max ${MAX_QUESTION_WORDS})`);
    for (const p of NOT_ONE_WORD) if (has(last, p)) fail(id, `${label} closing question is not one-word answerable: "${p}"`);
    if ((last.match(/\bor\b/gi) || []).length > 1) fail(id, `${label} closing question offers more than two options`);
    // a sentence that reads as a question but ends with a period is a tell for a hidden second question
    for (const s of sents.slice(0, -1)) {
      if (/^(is|are|do|does|did|has|have|can|could|would|will|what|when|where|who|why|how)\b/i.test(s) && s.endsWith('.')) {
        warn(id, `${label} sentence reads like a question but ends with a period: "${s.slice(0, 50)}"`);
      }
    }
  } else {
    if (qCount !== 0) fail(id, `${label} (GOODBYE) must contain no question mark`);
    if (!body.endsWith('.')) fail(id, `${label} must end with a period`);
  }

  // link placement: emailBody never in sentence 1; textBody never as the opening words
  for (const l of links) {
    const idx = sents.findIndex(s => s.includes(l.replace(/[.,;:]+$/, '')));
    if (label === 'emailBody' && idx === 0) fail(id, `${label} puts the link in the first sentence`);
    if (label === 'textBody') {
      const before = neutralize(body.slice(0, body.indexOf(NHTSA))).trim().split(/\s+/).filter(Boolean).length;
      if (before < 5) fail(id, `${label} opens with the link (needs at least five words before it)`);
    }
  }
  return { sents, last };
}

// ---------- main ----------

let lib;
try {
  lib = JSON.parse(fs.readFileSync(FILE, 'utf8'));
} catch (e) {
  console.error(`FAIL: cannot read/parse ${FILE}: ${e.message}`);
  process.exit(1);
}

if (lib.version !== 1) fail('root', 'version must be 1');
if (!/^\d{4}-\d{2}-\d{2}$/.test(lib.generated || '')) fail('root', 'generated must be YYYY-MM-DD');
if (!Array.isArray(lib.placeholders)) fail('root', 'placeholders must be an array');
else {
  for (const p of ['{first}', '{vehicle}', '{year}', '{make}', '{model}', '{phone}', '{sale_year}', '{season}']) {
    if (!lib.placeholders.includes(p)) fail('root', `placeholders list missing ${p}`);
  }
  if (!lib.placeholders.some(p => p.startsWith('{hook|'))) fail('root', 'placeholders list missing {hook|…}');
  if (!lib.placeholders.some(p => p.startsWith('{referred|'))) fail('root', 'placeholders list missing {referred|…}');
}
if (!Array.isArray(lib.templates) || !lib.templates.length) { fail('root', 'templates must be a non-empty array'); }

const templates = Array.isArray(lib.templates) ? lib.templates : [];
const ids = new Set();
const pools = {}; // poolKey -> [template]
const poolKey = t => (t.slot === 'VALUE' ? `VALUE/${t.season}` : t.slot);

templates.forEach((t, i) => {
  const id = (t && typeof t.id === 'string' && t.id) || `#${i}`;

  // shape
  if (!t || typeof t !== 'object') { fail(id, 'not an object'); return; }
  for (const f of FIELDS) if (typeof t[f] !== 'string' || !t[f].trim()) fail(id, `missing or empty field "${f}"`);
  for (const k of Object.keys(t)) if (!FIELDS.includes(k)) fail(id, `unexpected field "${k}"`);
  if (ids.has(id)) fail(id, 'duplicate id'); ids.add(id);

  if (!SLOTS.includes(t.slot)) { fail(id, `invalid slot "${t.slot}"`); return; }
  if (!SEASONS.includes(t.season)) fail(id, `invalid season "${t.season}"`);
  if (t.slot !== 'VALUE' && t.season !== 'any') fail(id, `season must be "any" for ${t.slot}`);
  if (!TONES.includes(t.tone)) fail(id, `invalid tone "${t.tone}"`);

  const prefix = t.slot === 'VALUE' ? `value-${t.season}` : ID_PREFIX[t.slot];
  if (!new RegExp(`^${prefix}-\\d{2}$`).test(id)) fail(id, `id must look like ${prefix}-NN`);

  if (!PRINCIPLE_KEYWORDS.some(k => has(t.principle || '', k))) fail(id, 'principle does not name a known behavioral principle');
  if (/\n/.test(t.editHint || '') || (t.editHint || '').length > MAX_EDITHINT_CHARS) fail(id, `editHint must be one line under ${MAX_EDITHINT_CHARS} chars`);
  if (/[^\x20-\x7E]/.test(t.editHint || '')) fail(id, 'editHint contains a non-ASCII character');

  // subject
  const subj = t.subject || '';
  checkText(id, 'subject', subj, { link: 'forbid' });
  if (subj.includes('?')) fail(id, 'subject must not contain a question mark');
  if (words(subj).length > MAX_SUBJECT_WORDS) fail(id, `subject is over ${MAX_SUBJECT_WORDS} words`);
  if (subj.length > MAX_SUBJECT_CHARS) fail(id, `subject is over ${MAX_SUBJECT_CHARS} chars`);
  if (/^[A-Z]/.test(subj)) fail(id, 'subject should start lowercase (plain, not a headline)');
  if (subj === subj.toUpperCase() && /[a-z]/i.test(subj)) fail(id, 'subject is all caps');
  if (/\{hook|\{referred/.test(subj)) fail(id, 'subject should not use a fallback placeholder');

  // bodies
  const isGoodbye = t.slot === 'GOODBYE';
  const email = checkBody(t, 'emailBody', t.emailBody, MAX_EMAIL_SENTENCES, !isGoodbye);
  const text = checkBody(t, 'textBody', t.textBody, MAX_TEXT_SENTENCES, !isGoodbye);
  if (typeof t.textBody === 'string' && t.textBody.length > MAX_TEXT_CHARS) fail(id, `textBody is over ${MAX_TEXT_CHARS} chars (SMS)`);
  if (email && text && !isGoodbye && email.last !== text.last) fail(id, 'email and text must end with the same closing question');
  if (typeof t.emailBody === 'string' && !t.emailBody.includes('{first}')) warn(id, 'emailBody never uses {first}');

  // per-slot rules
  const eb = t.emailBody || '';
  const tb = t.textBody || '';
  const lastQ = email ? email.last : '';
  switch (t.slot) {
    case 'ASK':
      // The one-time ask to a past buyer: thanks for the {vehicle} they bought in {sale_year},
      // the number, a plain reason the notes exist, and the one-word consent question.
      if (!eb.includes('{phone}')) fail(id, 'ASK emailBody must include {phone}');
      if (!eb.includes('{sale_year}')) fail(id, 'ASK emailBody must say when they bought it ({sale_year})');
      if (!tb.includes('{sale_year}')) fail(id, 'ASK textBody must say when they bought it ({sale_year})');
      if (!/\bthank/i.test(eb)) fail(id, 'ASK emailBody must actually say thank you');
      if (!/{vehicle}/.test(eb)) fail(id, 'ASK emailBody must name the {vehicle}');
      if (!/\b(okay|ok|good|fine|all right|alright)\b.*\bnote\b/i.test(lastQ)) fail(id, 'ASK closing question must be the consent question ("Okay if I send you a note...")');
      if (!/\bseasonal\b/i.test(lastQ)) fail(id, 'ASK closing question must say what the notes are (seasonal stuff)');
      if (/\b(trade|upgrade|new one|newer|inventory|on the lot|selling|for sale)\b/i.test(eb + ' ' + tb)) fail(id, 'ASK must not pitch (no trade / upgrade / inventory talk)');
      break;
    case 'THANKS':
    case 'THANKS_REPEAT':
      if (!eb.includes('{phone}')) fail(id, 'THANKS emailBody must include {phone}');
      if (!/\b(okay|ok|good|fine|all right|alright)\b.*\bnote\b/i.test(lastQ)) fail(id, 'THANKS closing question must be the email-consent confirmation ("Okay if I send you a note...")');
      if (!/{vehicle}/.test(eb)) fail(id, 'THANKS emailBody must name the {vehicle}');
      break;
    case 'VALUE':
      if (email && email.sents.length < 4) fail(id, 'VALUE emailBody needs at least four sentences of substance');
      if (/\bmosaic\b/i.test(eb) && !/mick at mosaic/i.test(eb)) warn(id, 'VALUE mentions Mosaic; make sure it is not a pitch');
      break;
    case 'CHECKIN':
      if (!eb.includes('{hook|')) fail(id, 'CHECKIN emailBody must use {hook|fallback}');
      if (!tb.includes('{hook|')) fail(id, 'CHECKIN textBody must use {hook|fallback}');
      if (!/\{vehicle\}|\{model\}/.test(eb)) fail(id, 'CHECKIN emailBody must reference {vehicle} or {model}');
      if (!/\{vehicle\}|\{model\}/.test(tb)) fail(id, 'CHECKIN textBody must reference {vehicle} or {model}');
      break;
    case 'REFERRAL':
    case 'ANNIVERSARY_REFERRAL':
      if (!REFERRAL_PERSON_WORDS.some(w => hasWord(eb, w))) fail(id, 'referral ask must name a specific, easy-to-picture person');
      if (!REFERRAL_PERSON_WORDS.some(w => hasWord(lastQ, w)) && !/somebody|someone/i.test(lastQ)) fail(id, 'referral closing question must point at the specific person');
      if (t.slot === 'ANNIVERSARY_REFERRAL') {
        if (!has(eb, 'coming up on a year')) fail(id, 'ANNIVERSARY_REFERRAL must say "coming up on a year"');
        if (!has(tb, 'coming up on a year')) fail(id, 'ANNIVERSARY_REFERRAL text must say "coming up on a year"');
        if (/year today|a year ago|one year|first anniversary/i.test(eb + ' ' + tb)) fail(id, 'anniversary is 360 days, never "one year today"');
      }
      break;
    case 'BIRTHDAY':
      for (const w of BIRTHDAY_BANNED) if (hasWord(eb + ' ' + tb, w)) fail(id, `BIRTHDAY must not mention "${w}"`);
      if (email && email.sents.length > 4) fail(id, 'BIRTHDAY email should be short (max 4 sentences)');
      if (!/birthday/i.test(eb)) fail(id, 'BIRTHDAY email must say birthday');
      break;
    case 'REFERRAL_THANKS':
      if (!eb.includes('{referred|')) fail(id, 'REFERRAL_THANKS emailBody must use {referred|fallback}');
      if (!tb.includes('{referred|')) fail(id, 'REFERRAL_THANKS textBody must use {referred|fallback}');
      if (!/thank/i.test(eb)) fail(id, 'REFERRAL_THANKS must actually say thank you');
      for (const p of DOUBLE_ASK) if (has(eb + ' ' + tb, p)) fail(id, `REFERRAL_THANKS must not double-ask: "${p}"`);
      if (/reward|bonus|referral fee|kickback|finder/i.test(eb + ' ' + tb)) fail(id, 'REFERRAL_THANKS must not promise a reward');
      break;
    case 'GOODBYE':
      if (email && email.sents.length !== 2) fail(id, 'GOODBYE email must be exactly two sentences');
      if (/sorry to see|why|what did|let me know/i.test(eb + ' ' + tb)) fail(id, 'GOODBYE must not fish for a reason');
      break;
  }

  (pools[poolKey(t)] = pools[poolKey(t)] || []).push(t);
});

// ---------- pool-level rules ----------

for (const [key, min] of Object.entries(MIN)) {
  const n = (pools[key] || []).length;
  if (n < min) fail(key, `pool has ${n} templates, minimum is ${min}`);
}
for (const [key, list] of Object.entries(pools)) {
  if (!Object.prototype.hasOwnProperty.call(MIN, key)) fail(key, 'unexpected pool');
  const tones = new Set(list.map(t => t.tone));
  if (list.length >= 3) {
    for (const tone of TONES) if (!tones.has(tone)) fail(key, `pool is missing a "${tone}" template`);
  } else if (tones.size < 2) {
    fail(key, 'a two-template pool needs two different tones');
  }
  // vary openings: first three words unique, and at least one email that does not open with {first}
  const seen = new Map();
  for (const t of list) {
    const k = firstThreeWords(t.emailBody || '');
    if (seen.has(k)) fail(t.id, `email opens the same way as ${seen.get(k)} ("${k}")`);
    seen.set(k, t.id);
  }
  if (list.length > 1 && list.every(t => (t.emailBody || '').startsWith('{first}'))) fail(key, 'every email in the pool opens with {first}; vary it');
  const subjects = new Set(list.map(t => (t.subject || '').toLowerCase()));
  if (subjects.size !== list.length) fail(key, 'duplicate subject inside the pool');
}

// ---------- report ----------

const counts = {};
for (const [k, v] of Object.entries(pools)) counts[k] = v.length;
console.log(`lint-templates: ${FILE}`);
console.log(`templates: ${templates.length}`);
for (const k of Object.keys(MIN)) console.log(`  ${k.padEnd(22)} ${String(counts[k] || 0).padStart(2)}  (min ${MIN[k]})`);
if (warnings.length) {
  console.log(`\nwarnings (${warnings.length}):`);
  for (const w of warnings) console.log('  ~ ' + w);
}
if (errors.length) {
  console.log(`\nerrors (${errors.length}):`);
  for (const e of errors) console.log('  x ' + e);
  console.log(`\nFAIL: ${errors.length} error(s)`);
  process.exit(1);
}
console.log('\nPASS: all templates clean');
