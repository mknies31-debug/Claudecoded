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

/** Look up a window by key. */
export function sequenceByKey(key) {
  return SEQUENCES.find((s) => s.key === key) || null;
}

const MS_PER_DAY = 86400000;

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

/** Has the customer finished every window? */
export function isComplete(customer) {
  return (customer.stage || 0) >= SEQUENCES.length;
}

/**
 * The next window that is DUE for this customer, or null.
 * Due = the window at `stage` exists and enough days have passed.
 */
export function nextDueSequence(customer, today = new Date()) {
  if (!customer || customer.optedOut || isComplete(customer)) return null;
  const idx = customer.stage || 0;
  const seq = SEQUENCES[idx];
  if (!seq) return null;
  if (daysSincePurchase(customer, today) >= seq.day) return { index: idx, seq };
  return null;
}

/** The window a customer is currently sitting in (for display), due or not. */
export function currentSequence(customer) {
  const idx = Math.min(customer.stage || 0, SEQUENCES.length - 1);
  return SEQUENCES[idx];
}

/**
 * Stagnant = not opted out, not complete, and the record hasn't advanced a
 * stage in more than `thresholdDays` while a window is already due to fire.
 * That means the cron should have moved it but the user-side state is stuck —
 * worth surfacing.
 */
export function isStagnant(customer, today = new Date(), thresholdDays = 7) {
  if (!customer || customer.optedOut || isComplete(customer)) return false;
  if (!nextDueSequence(customer, today)) return false;
  const updated = Date.parse(customer.updatedAt || customer.createdAt || '');
  if (isNaN(updated)) return false;
  const t = typeof today === 'string' ? Date.parse(today.slice(0, 10) + 'T00:00:00Z') : (today instanceof Date ? today.getTime() : Date.parse(today));
  return (t - updated) / MS_PER_DAY > thresholdDays;
}
