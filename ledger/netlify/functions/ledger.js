// Foresight → Anthropic proxy (Netlify Function).
//
// The browser never holds the Anthropic API key (and can't call the API
// directly anyway — CORS). This function runs server-side, owns the three
// system prompts, and is the single place the key lives. The client sends only
// { mode, messages }:
//   • extract  — image(s) → a clean Markdown transaction table
//   • analyze  — a transaction table → a savings/optimization plan
//   • advise   — a financial snapshot → behavior-focused guidance
//
// Two optional guards protect your Anthropic credits on a public deploy:
//   • Same-origin: if ALLOWED_ORIGIN (or Netlify's URL) is set, a request whose
//     browser Origin doesn't match is rejected.
//   • Access code: if ACCESS_CODE is set, the client must send a matching
//     x-access-code header (localStorage 'foresight.accessCode').
//
// Deploy: drop this folder on Netlify, set ANTHROPIC_API_KEY. No build step.

// Current Claude API model ids, best reasoning → cheapest. The winning model is
// the first the account accepts; override the top pick with LEDGER_MODEL.
const MODEL_CHAIN = [
  process.env.LEDGER_MODEL,
  'claude-opus-4-8',
  'claude-sonnet-5',
  'claude-sonnet-4-6',
  'claude-haiku-4-5-20251001',
].filter((m, i, a) => m && a.indexOf(m) === i);

// Netlify/Lambda caps the request body around 6 MB; reject oversized payloads
// (usually too many/too-large base64 images) before spending an upstream call.
const MAX_BODY_BYTES = 4_500_000;

const CATEGORIES = 'Groceries, Apparel, Electronics, Housing & Utilities, Software & Subscriptions, Transportation, Meals & Dining, Professional Services, Medical, Other, or Income';

// PROMPT 1 — Multimodal ingestion. Must match the client's 8-column HEADERS.
const EXTRACT_SYSTEM = `You are a highly specialized visual financial parsing agent optimized for zero-trust consumer ledgering. Analyze the uploaded image(s) — mobile screenshots of a bank app, a peer-to-peer payment platform, a digital receipt, or a physical receipt photo — and extract the transactions.

Map ALL transactions into a clean, GitHub-flavored Markdown table with exactly these headers, in this order:

| Date | Merchant/Payee | Amount | Currency | Payment Method | Category | Recurring Status | BNPL Provider |

Guidelines:
- Date: ISO-8601 YYYY-MM-DD. If the year is omitted, infer from context or use the current year.
- Merchant/Payee: the specific entity receiving the funds (e.g., "Venmo to John Doe" → "John Doe").
- Amount: the exact figure. Outflows NEGATIVE (e.g., -45.00), inflows POSITIVE (e.g., 1500.00). No currency symbols in this column.
- Currency: ISO-4217 three-letter code (USD, CAD, EUR, GBP, ...).
- Payment Method: the bank, card, e-wallet, or P2P tool shown (e.g., Checking, Chase Visa, Apple Pay, Cash App).
- Category: exactly one of — ${CATEGORIES}.
- Recurring Status: "Recurring" (subscription, rent, utility, salary, membership, insurance) or "One-Time".
- BNPL Provider: name Klarna, Sezzle, Afterpay, or Affirm if involved; otherwise leave blank.

Output ONLY the Markdown table — no preamble, no summary. If a field is unreadable or missing, put "null" in that cell. Never guess or hallucinate data points.`;

// PROMPT 2 — Analysis & savings optimization planner.
const ANALYZE_SYSTEM = `You are an elite personal finance strategist and financial forensic analyst. You are given a manual ledger of transactions (a Markdown table). Perform a comprehensive audit, evaluate monthly cash flow, and generate an actionable optimization and savings plan.

Objectives:
1. Identify & amortize BNPL commitments (Klarna, Sezzle, Afterpay, Affirm). Assume interest-free "Pay in 4" (six weeks, four bi-weekly payments) unless the ledger says otherwise. If a purchase was C_total over N installments, each installment is C_total / N — project the exact dates and amounts of outflows over the next 2 months.
2. Audit recurring subscriptions & bills; flag "subscription creep", redundancies, forgotten trials, and high utility spend.
3. Outline a savings plan: analyze variable spending (Groceries, Apparel, Meals & Dining, ...), recommend realistic targeted reductions, and suggest an "Escrow Sinking Fund" to pre-fund upcoming BNPL installments and fixed bills so they never cause a checking-account crunch.

Structure the response with these Markdown ## sections, in order:
## Executive Summary
## BNPL Liabilities & Future Outflow Schedule
## Recurring Bill Audit
## Budgeting Strategy Recommendations
## Targeted Expense Optimization Plan

Be specific and numerical — show dates and dollar amounts. Base every figure on the ledger provided; do not invent transactions.`;

// PROMPT 4 — Balance-screen reading: the daily "snap your bank app" update.
const BALANCES_SYSTEM = `You are a precise visual financial parsing agent. The uploaded image(s) are screenshots of banking/credit-card/loan app screens showing ACCOUNT BALANCES (an accounts overview, a card summary, a loan payoff screen, etc.).

Extract every account balance visible into a GitHub-flavored Markdown table with exactly these headers, in this order:

| Account Name | Account Type | Balance | APR | As-of Date |

Rules:
- Account Name: exactly as shown, INCLUDING any masked digits (e.g. "Everyday Checking ...1234") — the digits help match accounts.
- Account Type: exactly one of — Checking, Savings, Investment, Cash, Credit Card, Loan, or Other. Infer from context (a card's "current balance" → Credit Card; "available balance" on a checking screen → Checking).
- Balance: the number shown, digits and decimal point only (no currency symbols, no commas). For credit cards and loans report the amount OWED as a POSITIVE number. Use the CURRENT/statement balance, not "available credit".
- APR: the interest rate as a plain number (e.g. 24.99) if visible on the screen; otherwise "null".
- As-of Date: ISO YYYY-MM-DD if a date is shown on screen; otherwise "null".

Output ONLY the Markdown table — no preamble, no commentary. Use "null" for anything unreadable. NEVER guess a balance; if a number is cut off or blurred, put "null".`;

// PROMPT 3 — Behavior-focused advisor over a full snapshot.
const ADVISE_SYSTEM = `You are a sharp, plain-spoken personal financial advisor. You are given a SNAPSHOT of someone's finances: monthly income, budget vs. actual by category, credit cards (limit, current balance/utilization, assigned purpose such as Work/Personal/House, statement due date, monthly cap), savings goals (target, saved, target date, pace), and account balances by type.

Give behavior-focused guidance — what to DO, not a lecture. Cover:
1. Card strategy: for each purpose (Work / Personal / House), recommend which card to put spend on to keep utilization low (ideally under 30%, better under 10%) and every card payable IN FULL by its due date. Call out any card trending toward a balance that can't be paid off.
2. Pay-in-full pace: are they on track to pay every card in full this month given income and current spend? If not, name the shortfall and the concrete fix.
3. Budget drift: which categories are over budget this month, by how much, and the one or two changes with the biggest impact.
4. Goal pacing: for each goal, whether they're on track / behind / ahead, the monthly contribution needed to hit it on time, and where that money can come from.

Rules: use the numbers in the snapshot — never invent balances, limits, or transactions. Be concrete and prioritized (lead with the highest-impact move). Use short Markdown ## sections and plain language. If the snapshot is missing something you'd need, say so briefly rather than guessing.`;

const MODE_CONFIG = {
  extract:  { system: EXTRACT_SYSTEM,  max_tokens: 4096 },
  balances: { system: BALANCES_SYSTEM, max_tokens: 2048 },
  analyze:  { system: ANALYZE_SYSTEM,  max_tokens: 4096 },
  advise:   { system: ADVISE_SYSTEM,   max_tokens: 4096 },
};

const json = (statusCode, obj, extra) => ({
  statusCode,
  headers: Object.assign({ 'content-type': 'application/json' }, extra || {}),
  body: JSON.stringify(obj),
});

// Compare only the origin (scheme://host:port) of two URLs.
function originOf(u) { try { return new URL(u).origin; } catch { return ''; } }

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method Not Allowed' });

  const headers = event.headers || {};
  const h = (name) => headers[name] || headers[name.toLowerCase()] || headers[name.toUpperCase()] || '';

  // Guard 1 — same-origin. Only enforced when we know our own origin AND the
  // request carries an Origin header (native/curl requests have none).
  const allowed = originOf(process.env.ALLOWED_ORIGIN || process.env.URL || '');
  const reqOrigin = h('origin');
  if (allowed && reqOrigin && originOf(reqOrigin) !== allowed) {
    return json(403, { error: 'Blocked: this request came from a different site.' });
  }

  // Guard 2 — access code (optional).
  const code = process.env.ACCESS_CODE;
  if (code && h('x-access-code') !== code) {
    return json(401, { error: 'This Foresight is locked. Set the access code in the app: open the site, then in the browser console run  localStorage.setItem(\'foresight.accessCode\',\'YOUR_CODE\')  using the same value as the ACCESS_CODE env var.' });
  }

  // Validate the REQUEST before checking server config, so a bad request gets a
  // clear 400/413 instead of being masked by a missing-key 500.
  const raw = event.body || '';
  const bodyBytes = event.isBase64Encoded ? Math.floor(raw.length * 3 / 4) : Buffer.byteLength(raw, 'utf8');
  if (bodyBytes > MAX_BODY_BYTES) {
    return json(413, { error: 'Request is too large. Try fewer images or smaller screenshots.' });
  }

  let mode, messages;
  try { ({ mode, messages } = JSON.parse(raw || '{}')); }
  catch { return json(400, { error: 'Invalid JSON body.' }); }

  const cfg = MODE_CONFIG[mode];
  if (!cfg) return json(400, { error: 'mode must be "extract", "balances", "analyze", or "advise".' });
  if (!Array.isArray(messages) || messages.length === 0) {
    return json(400, { error: 'messages must be a non-empty array.' });
  }

  // Server config check comes last — the request itself is valid at this point.
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return json(500, { error: 'ANTHROPIC_API_KEY is not set on the server. In Netlify: Site settings → Environment variables → add ANTHROPIC_API_KEY, then redeploy (Deploys → Trigger deploy → Clear cache and deploy).' });
  }

  // "Model isn't available on your key" → try the next candidate; auth/credit
  // errors fail on every model, so stop and surface them.
  const isModelError = (status, text) => {
    if (status !== 400 && status !== 403 && status !== 404) return false;
    return /model/i.test(text) && /(not[_ ]?found|not.*exist|invalid|unknown|permission|access|do(es)? not have)/i.test(text);
  };

  let lastStatus = 502, lastText = '{"error":"No model could be reached."}';
  for (const model of MODEL_CHAIN) {
    let upstream;
    try {
      upstream = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model, max_tokens: cfg.max_tokens, system: cfg.system, messages }),
      });
    } catch (err) {
      lastStatus = 502;
      lastText = JSON.stringify({ error: 'Upstream request to Anthropic failed: ' + String(err && err.message ? err.message : err) });
      break;
    }
    const text = await upstream.text();
    if (upstream.ok) {
      return { statusCode: 200, headers: { 'content-type': 'application/json', 'x-ledger-model': model }, body: text };
    }
    lastStatus = upstream.status; lastText = text;
    if (!isModelError(upstream.status, text)) break;
  }
  return { statusCode: lastStatus, headers: { 'content-type': 'application/json' }, body: lastText };
};
