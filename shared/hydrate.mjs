// shared/hydrate.mjs — CLEAN API: template token engine.
//
// Strict, tiny token set by design: {{first_name}} and {{vehicle}} only. Any
// other {{token}} is left visible on purpose so a bad merge is obvious rather
// than silently shipping an empty greeting.

const TOKENS = {
  // Name is required at capture, but a blank can slip through on a thin import
  // row. Fall back to "there" so "Hey {{first_name}}" reads "Hey there" instead
  // of "Hey  — Mick here." with a naked double-space.
  first_name: (c) => (c.firstName || '').trim() || 'there',
  // Vehicle is optional (only name + phone are required at capture). Fall back
  // to the bare word so "the {{vehicle}}" reads "the vehicle" instead of leaving
  // a stray double-space — graceful, never an empty gap or raw brackets.
  vehicle: (c) => (c.vehicle || '').trim() || 'vehicle',
};

/** Replace supported tokens in `tpl` using the customer. */
export function hydrate(tpl, customer = {}) {
  if (!tpl) return '';
  const merged = String(tpl).replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (whole, name) => {
    const fn = TOKENS[name.toLowerCase()];
    if (!fn) return whole; // unknown token stays literal — loud, not silent
    return fn(customer);
  });
  // Tidy any double-spaces a fallback could leave (never touches line breaks).
  return merged.replace(/ {2,}/g, ' ');
}

/** List of {{tokens}} present in a string (handy for tests/linting). */
export function tokensIn(tpl) {
  const out = [];
  String(tpl || '').replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_, n) => (out.push(n.toLowerCase()), ''));
  return out;
}
