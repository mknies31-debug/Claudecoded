// shared/schema.mjs — CLEAN API: customer + touch_log shapes and factories.
//
// Isomorphic: no DOM, no Node built-ins, no I/O. The browser (crm/) and the
// cron (netlify/functions/daily-runner) both import this so a customer means
// exactly the same thing on every surface.

import { localDateStr } from './sequences.mjs';

/** localStorage / blob keys the CRM owns (auto-synced by CARVIS snapshotStore). */
export const KEYS = {
  customers: 'carvis_referral_customers',
  touchLogs: 'carvis_referral_touchlogs',
  meta: 'carvis_referral_meta',
};

/** A short, sortable, collision-resistant id without any dependency. */
export function makeId(prefix = 'c') {
  return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/** Normalize a date-ish value to a YYYY-MM-DD string (local-agnostic, UTC date). */
export function toDateStr(d) {
  if (!d) return '';
  if (typeof d === 'string') {
    // already YYYY-MM-DD or ISO — keep just the date part
    const m = d.match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1];
  }
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt.getTime())) return '';
  return dt.toISOString().slice(0, 10);
}

/**
 * Build a customer from raw form input, filling safe defaults.
 * Only the fields in the CRM data model — nothing pricing-related ever lives here.
 */
export function newCustomer(input = {}) {
  const now = new Date().toISOString();
  return {
    id: input.id || makeId('cust'),
    firstName: (input.firstName || '').trim(),
    lastName: (input.lastName || '').trim(),
    vehicle: (input.vehicle || '').trim(),
    phone: (input.phone || '').trim(),
    email: (input.email || '').trim(),
    address: (input.address || '').trim(),
    notes: (input.notes || '').trim(),
    // purchaseDate default uses the Central-time calendar date, not UTC, so an
    // evening entry isn't dated to tomorrow (see localDateStr).
    purchaseDate: toDateStr(input.purchaseDate) || localDateStr(),
    stage: Number.isInteger(input.stage) ? input.stage : 0,
    optedOut: input.optedOut === true,
    referredById: input.referredById || null,
    pendingTexts: Array.isArray(input.pendingTexts) ? input.pendingTexts : [],
    createdAt: input.createdAt || now,
    updatedAt: input.updatedAt || now,
  };
}

/** A logged touch (the audit trail). channel: 'email' | 'text'. */
export function newTouchLog(input = {}) {
  return {
    id: input.id || makeId('log'),
    customerId: input.customerId || '',
    channel: input.channel || 'email',
    sequenceKey: input.sequenceKey || '',
    variant: input.variant || null,
    subject: input.subject || '',
    body: input.body || '',
    // 'sent' (delivered), 'held' (engine ran but copy not approved), 'queued',
    // 'failed' (provider rejected).
    status: input.status || 'sent',
    sentAt: input.sentAt || new Date().toISOString(),
  };
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
// Accepts US-style phone input; we only need enough digits to build an sms: link.
const PHONE_DIGITS_MIN = 10;

/**
 * Validate a customer for the capture form. Returns { ok, errors:{field:msg} }.
 * The only absolutes are NAME and PHONE — everything else (vehicle, email,
 * address, notes, purchase date) is optional and can be filled in later.
 */
export function validateCustomer(c = {}) {
  const errors = {};
  if (!c.firstName || !c.firstName.trim()) errors.firstName = 'Customer name is required.';
  if (!c.phone || !c.phone.trim()) errors.phone = 'Phone number is required.';
  else if (digits(c.phone).length < PHONE_DIGITS_MIN) errors.phone = 'That phone number looks too short.';
  if (c.email && c.email.trim() && !EMAIL_RE.test(c.email.trim())) errors.email = 'That email looks off.';
  return { ok: Object.keys(errors).length === 0, errors };
}

export function digits(s) {
  return String(s || '').replace(/\D+/g, '');
}

export function isValidEmail(s) {
  return EMAIL_RE.test(String(s || '').trim());
}
