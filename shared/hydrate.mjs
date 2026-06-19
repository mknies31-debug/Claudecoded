// shared/hydrate.mjs — CLEAN API: template token engine.
//
// Strict, tiny token set by design: {{first_name}} and {{vehicle}} only. Any
// other {{token}} is left visible on purpose so a bad merge is obvious rather
// than silently shipping an empty greeting.

const TOKENS = {
  first_name: (c) => (c.firstName || '').trim(),
  vehicle: (c) => (c.vehicle || '').trim(),
};

/** Replace supported tokens in `tpl` using the customer. */
export function hydrate(tpl, customer = {}) {
  if (!tpl) return '';
  return String(tpl).replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (whole, name) => {
    const fn = TOKENS[name.toLowerCase()];
    if (!fn) return whole; // unknown token stays literal — loud, not silent
    return fn(customer);
  });
}

/** List of {{tokens}} present in a string (handy for tests/linting). */
export function tokensIn(tpl) {
  const out = [];
  String(tpl || '').replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_, n) => (out.push(n.toLowerCase()), ''));
  return out;
}

export const SUPPORTED_TOKENS = Object.keys(TOKENS);
