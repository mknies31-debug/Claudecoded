// shared/reporting.mjs — CLEAN API: referral / lead-source reporting.
//
// Isomorphic, dependency-free (imports only sibling shared modules). Pure math
// over the customer list + touch-log audit trail — no DOM, no I/O, no Date.now.
// The dashboard reads these numbers; nothing here mutates its inputs, and junk
// input (missing fields, non-arrays, dangling ids) degrades to zeros, never a
// throw — the report must render even over half-migrated data.

import { SEQUENCES } from './sequences.mjs';
import { isFrozen } from './compliance.mjs';

// The referral-ask window (day 45, "Referral Ask") as defined in sequences.mjs.
// Derived from SEQUENCES so this module can never drift from the timeline; the
// string fallback only guards against the window being renamed out from under us.
export const REFERRAL_SEQUENCE_KEY =
  (SEQUENCES.find((s) => s.key === 'referral') || {}).key || 'referral';

/** The zeroed report — also what any junk input collapses to. */
function emptyStats() {
  return { asked: 0, received: 0, bought: 0, thankYouPending: 0, topSources: [], conversionPct: 0 };
}

/**
 * Referral funnel + lead-source report. Pure, side-effect free.
 *
 *   asked           — DISTINCT customers with at least one 'sent' touch log on
 *                     the referral-ask window (email or text channel)
 *   received        — customers whose referredById resolves to ANOTHER customer
 *                     on file (dangling / self references don't count)
 *   bought          — of those received, how many are category 'sold'
 *   thankYouPending — received where the thank-you loop is still open — same
 *                     test the dashboard's ⚑ Referral Loop card uses:
 *                     !referrerThanked and the record isn't frozen (opted out)
 *   topSources      — up to 5 referrers as {id, name, count, boughtCount},
 *                     sorted by count desc; name is the referrer's "First Last"
 *   conversionPct   — bought / received as a rounded percent (0 when none)
 */
export function computeReferralStats(customers, touchLogs) {
  const list = Array.isArray(customers) ? customers.filter((c) => c && typeof c === 'object') : [];
  const logs = Array.isArray(touchLogs) ? touchLogs.filter((l) => l && typeof l === 'object') : [];
  if (!list.length) return emptyStats();

  const byId = new Map(list.filter((c) => c.id).map((c) => [c.id, c]));

  // asked — distinct customers, not distinct logs.
  const askedIds = new Set();
  for (const l of logs) {
    if (l.sequenceKey === REFERRAL_SEQUENCE_KEY && l.status === 'sent' &&
        (l.channel === 'email' || l.channel === 'text') && l.customerId) {
      askedIds.add(l.customerId);
    }
  }

  // received / bought / thank-you loop / per-referrer tallies in one pass.
  let received = 0, bought = 0, thankYouPending = 0;
  const sources = new Map(); // referrerId -> {id, name, count, boughtCount}
  for (const c of list) {
    const refId = c.referredById;
    if (!refId || refId === c.id || !byId.has(refId)) continue; // only valid references
    received += 1;
    const soldHere = c.category === 'sold';
    if (soldHere) bought += 1;
    if (!c.referrerThanked && !isFrozen(c)) thankYouPending += 1;
    const ref = byId.get(refId);
    const row = sources.get(refId) ||
      { id: refId, name: `${ref.firstName || ''} ${ref.lastName || ''}`.trim(), count: 0, boughtCount: 0 };
    row.count += 1;
    if (soldHere) row.boughtCount += 1;
    sources.set(refId, row);
  }

  const topSources = [...sources.values()]
    .sort((a, b) => b.count - a.count || b.boughtCount - a.boughtCount || a.name.localeCompare(b.name))
    .slice(0, 5);

  return {
    asked: askedIds.size,
    received,
    bought,
    thankYouPending,
    topSources,
    conversionPct: received ? Math.round((bought / received) * 100) : 0,
  };
}
