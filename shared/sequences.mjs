// shared/sequences.mjs — CLEAN API: the timeline.
//
// Five windows, fired in order. A customer has a `stage` (index of the NEXT
// window to fire). The cron fires window[stage] once the delta between
// purchaseDate and today reaches that window's `day`, then advances stage.
// One window per customer per day — steady progression, never a burst.
//
// `channels` declares which branches run for a window: 'email' auto-sends,
// 'text' is queued for the user to fire by hand.

export const SEQUENCES = [
  {
    key: 'welcome',
    label: 'Welcome / Delivery',
    day: 1,
    channels: ['email', 'text'],
    blurb: 'Day after delivery — make sure they got home happy.',
  },
  {
    key: 'checkin',
    label: 'Two-Week Check-In',
    day: 14,
    channels: ['text'],
    blurb: 'Settling in — anything come up with the vehicle?',
  },
  {
    key: 'referral',
    label: 'Referral Ask',
    day: 45,
    channels: ['email', 'text'],
    blurb: 'They love it by now — open the door to a referral.',
  },
  {
    key: 'service',
    label: 'Service Reminder',
    day: 180,
    channels: ['email'],
    blurb: 'Half-year nudge to keep it running right.',
  },
  {
    key: 'anniversary',
    label: 'One-Year Anniversary',
    day: 365,
    channels: ['email', 'text'],
    blurb: 'A year in — check in, leave the door open.',
  },
];

/** Look up a window by key (handles the fixed windows AND recurring follow-ups). */
export function sequenceByKey(key) {
  const fixed = SEQUENCES.find((s) => s.key === key);
  if (fixed) return fixed;
  if (typeof key === 'string' && key.startsWith('followup_')) {
    const type = key.slice('followup_'.length);
    const meta = FOLLOWUP_TYPES[type];
    if (meta) return { key, label: meta.label, channels: [meta.channel], type, recurring: true };
  }
  return null;
}

// ── Recurring 90-day follow-ups (after the structured first year) ───────────
// Once a customer clears the five fixed windows, the relationship doesn't end —
// it settles into an ongoing touch every 90 days that ROTATES the type, so each
// contact feels different. Email auto-sends; text queues a draft; call / video /
// gift queue a reminder + script for the user to do by hand (the app can't place
// a call or mail a gift). Rotation order is the user's: Call → Text → Email →
// Video → Gift/Card, then repeat forever.
const FOLLOWUP_TYPES = {
  call: { label: '90-Day Call', channel: 'task', verb: 'Call' },
  text: { label: '90-Day Text', channel: 'text', verb: 'Text' },
  email: { label: '90-Day Email', channel: 'email', verb: 'Email' },
  video: { label: '90-Day Video', channel: 'task', verb: 'Record a video' },
  gift: { label: '90-Day Gift / Card', channel: 'task', verb: 'Send a gift or card' },
};
const FOLLOWUP_ROTATION = ['call', 'text', 'email', 'video', 'gift'];
const FOLLOWUP = { startDay: 365, everyDays: 90 };

/** The recurring follow-up window for a stage past the fixed sequence, or null. */
export function followupForStage(stage) {
  const i = (stage || 0) - SEQUENCES.length; // 0-based recurring index
  if (i < 0) return null;
  const type = FOLLOWUP_ROTATION[i % FOLLOWUP_ROTATION.length];
  const meta = FOLLOWUP_TYPES[type];
  return {
    key: `followup_${type}`,
    label: meta.label,
    blurb: `Every-90-day touch — ${meta.verb.toLowerCase()} to stay top of mind.`,
    day: FOLLOWUP.startDay + FOLLOWUP.everyDays * (i + 1),
    channels: [meta.channel],
    type,
    recurring: true,
  };
}

// ── Prospect keep-warm cadence (hot / cold leads, not buyers) ────────────────
// Prospects don't run the post-purchase timeline. Instead the daily loop queues
// a "reach out" reminder when they've gone untouched this many days.
export const PROSPECT_INTERVAL = { hot: 2, cold: 14 };

/** The window at a given stage — fixed window or the recurring follow-up. */
function windowForStage(stage) {
  const idx = stage || 0;
  return idx < SEQUENCES.length ? SEQUENCES[idx] : followupForStage(idx);
}

/**
 * The stage an already-elapsed customer should start at, given how many days
 * since purchase. Used by bulk import so importing an old customer doesn't blast
 * them through the welcome/check-in messages — they slot in at the NEXT window
 * that hasn't come due yet (fixed windows first, then the recurring cadence).
 */
export function stageForElapsedDays(days) {
  let stage = 0;
  for (const s of SEQUENCES) { if (days >= s.day) stage++; else return stage; }
  let i = 0;
  while (days >= FOLLOWUP.startDay + FOLLOWUP.everyDays * (i + 1)) i++;
  return SEQUENCES.length + i;
}

const MS_PER_DAY = 86400000;

// The business runs on Central time (Zumbrota, MN). Stamping and comparing
// dates in UTC mis-dates any evening entry (after ~7pm CT it rolls to tomorrow)
// and fires the day-1/14/45 windows off by a day. localDateStr() returns the
// calendar date *in the given zone* as YYYY-MM-DD so capture and the cron agree.
const BUSINESS_TZ = 'America/Chicago';
export function localDateStr(date = new Date(), tz = BUSINESS_TZ) {
  try {
    // en-CA formats as YYYY-MM-DD, which is exactly the shape we store.
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date instanceof Date ? date : new Date(date));
  } catch {
    return new Date(date).toISOString().slice(0, 10);
  }
}

/** Whole calendar days from purchaseDate to `today` (both date-only). */
export function daysSincePurchase(customer, today = new Date()) {
  if (!customer || !customer.purchaseDate) return 0;
  const p = Date.parse(customer.purchaseDate + 'T00:00:00Z');
  const t = typeof today === 'string'
    ? Date.parse(today.slice(0, 10) + 'T00:00:00Z')
    : Date.parse(toUTCDate(today));
  if (isNaN(p) || isNaN(t)) return 0;
  return Math.floor((t - p) / MS_PER_DAY);
}

function toUTCDate(d) {
  const dt = d instanceof Date ? d : new Date(d);
  return dt.toISOString().slice(0, 10) + 'T00:00:00Z';
}

/**
 * The follow-up never truly "completes" now — after the five fixed windows it
 * rolls into the recurring 90-day cadence forever. This helper answers "has the
 * customer finished the structured first year?", NOT "no more touches ever".
 */
export function isThroughFixedSequence(customer) {
  return (customer.stage || 0) >= SEQUENCES.length;
}

/**
 * The next window that is DUE for this customer, or null.
 * Due = the window at `stage` (fixed or recurring) exists and enough days passed.
 */
export function nextDueSequence(customer, today = new Date()) {
  if (!customer || customer.optedOut) return null;
  const idx = customer.stage || 0;
  const seq = windowForStage(idx);
  if (!seq) return null;
  if (daysSincePurchase(customer, today) >= seq.day) return { index: idx, seq };
  return null;
}

/** The window a customer is currently sitting in (for display), due or not. */
export function currentSequence(customer) {
  return windowForStage(customer.stage || 0);
}

/**
 * Stagnant = not opted out and the record hasn't advanced a stage in more than
 * `thresholdDays` while a window is already due to fire. That means the cron
 * should have moved it but the user-side state is stuck — worth surfacing.
 */
export function isStagnant(customer, today = new Date(), thresholdDays = 7) {
  if (!customer || customer.optedOut) return false;
  if (!nextDueSequence(customer, today)) return false;
  const updated = Date.parse(customer.updatedAt || customer.createdAt || '');
  if (isNaN(updated)) return false;
  const t = typeof today === 'string' ? Date.parse(today.slice(0, 10) + 'T00:00:00Z') : (today instanceof Date ? today.getTime() : Date.parse(today));
  return (t - updated) / MS_PER_DAY > thresholdDays;
}
