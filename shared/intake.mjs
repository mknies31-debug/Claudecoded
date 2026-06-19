// shared/intake.mjs — CLEAN API: guided customer intake (voice + photo).
//
// Pure helpers shared by the UI and the tests. No DOM. These define the
// question flow CARVIS walks through when Mick says "enter customer", and the
// parsing for spoken answers and for fields pulled out of a photo.

// The questions CARVIS asks, in order. `required` blocks "skip".
// Only name + phone are absolutes (per the data model).
export const INTAKE_STEPS = [
  { key: 'name', required: true, field: 'name',
    ask: "Let's add a customer. What's their name?",
    reAsk: "I need a name to start the profile. What's the customer's name?" },
  { key: 'phone', required: true, field: 'phone',
    ask: "Got it. What's their phone number?",
    reAsk: "I need a phone number — it's the one thing besides the name I can't skip. What is it?" },
  { key: 'vehicle', required: false, field: 'vehicle',
    ask: 'What car did they buy? Say skip if you don\'t have it yet.' },
  { key: 'email', required: false, field: 'email',
    ask: "What's their email address? Say skip if you don't have it." },
  { key: 'address', required: false, field: 'address',
    ask: "What's their address? Say skip if you don't have it." },
  { key: 'notes', required: false, field: 'notes',
    ask: 'Anything else worth noting — trade, family, how they found you? Say skip if not.' },
];

// Words that mean "I don't have this / move on".
const SKIP_RE = /^(skip|next|none|nope|no|n\/?a|pass|nothing|don'?t have( it| that)?|i don'?t have( it| that)?|leave (it )?blank|that'?s it|move on)\b/i;

/** True if a spoken/typed answer means "skip this field". */
export function isSkip(str) {
  const s = String(str || '').trim();
  return s === '' || SKIP_RE.test(s);
}

/** Split a spoken full name into { firstName, lastName }. */
export function parseFullName(str) {
  let cleaned = String(str || '').replace(/[.,]/g, '').trim();
  // Strip any run of leading filler words ("his name is ...", "it's ...").
  const FILLER = /^(his|her|their|the|a|customer'?s?|client'?s?|name|is|it'?s|this|that)\s+/i;
  let prev;
  do { prev = cleaned; cleaned = cleaned.replace(FILLER, ''); } while (cleaned !== prev);
  if (!cleaned) return { firstName: '', lastName: '' };
  const parts = cleaned.split(/\s+/);
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

/**
 * Pull a phone number out of a spoken/typed answer. Speech engines sometimes
 * return digits as numerals, sometimes spelled out; we also accept words.
 * Returns a tidy formatted string when it finds 10 digits, else the raw digits.
 */
export function extractPhone(str) {
  let s = String(str || '').toLowerCase();
  const WORDS = { zero: '0', oh: '0', o: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9' };
  s = s.replace(/\b(zero|oh|one|two|three|four|five|six|seven|eight|nine)\b/g, (w) => WORDS[w] || w);
  const d = s.replace(/\D+/g, '');
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  if (d.length === 11 && d[0] === '1') return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  return d;
}

/** Light cleanup for a spoken email ("dale at gmail dot com"). */
export function parseSpokenEmail(str) {
  return String(str || '')
    .trim()
    .replace(/\s+at\s+/gi, '@')
    .replace(/\s+dot\s+/gi, '.')
    .replace(/\s+underscore\s+/gi, '_')
    .replace(/\s+dash\s+/gi, '-')
    .replace(/\s+/g, '')
    .toLowerCase();
}

/** Apply the right parser for a given step to a raw answer, into a draft object. */
export function applyAnswer(draft, stepKey, raw) {
  const out = { ...draft };
  switch (stepKey) {
    case 'name': { const n = parseFullName(raw); out.firstName = n.firstName; out.lastName = n.lastName; break; }
    case 'phone': out.phone = extractPhone(raw); break;
    case 'email': out.email = parseSpokenEmail(raw); break;
    case 'vehicle': out.vehicle = String(raw || '').trim(); break;
    case 'address': out.address = String(raw || '').trim(); break;
    case 'notes': out.notes = String(raw || '').trim(); break;
    default: break;
  }
  return out;
}

// ── photo extraction ─────────────────────────────────────────────────────────
export const EXTRACTION_PROMPT = `Look at this image and pull out the customer's contact details. It might be a driver's license, a business card, a deal sheet, a buyer's order, an insurance card, or a handwritten note.

Return ONLY a JSON object, no prose, no markdown, with exactly these keys:
{"firstName":"","lastName":"","phone":"","email":"","address":"","vehicle":"","notes":""}

Rules: use an empty string for anything not clearly present. Do not guess. For "vehicle" use year make model if shown. Put anything useful that doesn't fit the other fields into "notes". Phone as digits with dashes.`;

/** Parse the model's reply (tolerating code fences / stray prose) into a draft. */
export function parseExtraction(text) {
  const s = String(text || '');
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : s;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  let obj;
  try { obj = JSON.parse(candidate.slice(start, end + 1)); } catch { return null; }
  if (!obj || typeof obj !== 'object') return null;
  const pick = (k) => (typeof obj[k] === 'string' ? obj[k].trim() : '');
  return {
    firstName: pick('firstName'), lastName: pick('lastName'),
    phone: pick('phone') ? extractPhone(pick('phone')) : '',
    email: pick('email'), address: pick('address'),
    vehicle: pick('vehicle'), notes: pick('notes'),
  };
}
