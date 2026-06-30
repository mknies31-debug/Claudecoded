// Ledger Lens → Anthropic proxy (Netlify Function).
//
// Why this exists: the browser must NOT hold the Anthropic API key, and
// browsers can't call api.anthropic.com directly anyway (CORS). This function
// runs server-side, reads the key from ANTHROPIC_API_KEY, and owns the two
// system prompts (extraction + analysis) so they can't be tampered with from
// the client. The browser sends only `mode` and the rolling `messages`
// (including base64 image blocks for extraction).
//
// Deploy: in Netlify create a site with Base directory = ledger, then set
//         ANTHROPIC_API_KEY in Site settings → Environment variables. No build.

// Model preference, best → most-available. We try them in order and use the
// first one this Anthropic account accepts, so the app works even if a newer
// model isn't enabled on the key. Override the top pick with LEDGER_MODEL.
const MODEL_CHAIN = [
  process.env.LEDGER_MODEL,
  'claude-opus-4-8',
  'claude-sonnet-4-6',
  'claude-3-5-sonnet-latest',
  'claude-3-5-haiku-latest',
].filter((m, i, a) => m && a.indexOf(m) === i);

// PROMPT 1 — Multimodal ingestion & categorization. Verbatim operational spec.
const EXTRACT_SYSTEM = `You are a highly specialized visual financial parsing agent optimized for zero-trust consumer ledgering. Your operational objective is to analyze the uploaded image(s)—which are mobile screenshots of a bank application, a peer-to-peer payment platform, a digital receipt, or a physical receipt photo—and extract the transactions.

Analyze the image systematically. Identify and map ALL transactions into a clean, GitHub-flavored Markdown table with exactly these headers, in this order:

| Date | Merchant/Payee | Amount | Currency | Payment Method | Category | Recurring Status | BNPL Provider |

Operational Guidelines for Data Mapping:
- Date: ISO-8601 format YYYY-MM-DD. If the year is omitted, infer from context or use the current year.
- Merchant/Payee: the specific entity receiving the funds (e.g., "Venmo to John Doe" → "John Doe").
- Amount: the exact monetary figure. Outflows are NEGATIVE (e.g., -45.00), inflows are POSITIVE (e.g., 1500.00). Do NOT include currency symbols in this column.
- Currency: ISO-4217 three-letter code (USD, CAD, EUR, GBP, ...).
- Payment Method: the bank, credit card, e-wallet, or P2P tool shown (e.g., Checking, Chase Visa, Apple Pay, Cash App).
- Category: one of — Groceries, Apparel, Electronics, Housing & Utilities, Software & Subscriptions, Transportation, Meals & Dining, Professional Services, Medical, or Income.
- Recurring Status: "Recurring" or "One-Time". Be proactive about catching recurring charges. Mark "Recurring" when the line is rent/mortgage, a utility (electric, gas, water, internet, phone), insurance, a salary/payroll deposit, a gym/membership, OR a recognizable subscription service — e.g. Netflix, Hulu, Disney+, Max, Spotify, Apple (iCloud/Music/TV+), YouTube Premium, Amazon Prime, Adobe, Microsoft 365, Google One, Dropbox, Notion, ChatGPT/OpenAI, Patreon, Substack, news/media memberships, SaaS tools, and similar. Also treat any charge whose description contains cues like "subscription", "monthly", "annual", "membership", "renewal", "autopay", or "recurring" as "Recurring". When the merchant is clearly a one-off purchase, use "One-Time".
- BNPL Provider: if the transaction involves Klarna, Sezzle, Afterpay, or Affirm, name the provider. Otherwise leave blank.

Output Constraints:
- Provide ONLY the Markdown table. No conversational preamble, no introductory sentences, no summary text.
- If any field is blurred, unreadable, or missing, put "null" in that cell. Do NOT guess or hallucinate data points.`;

// PROMPT 2 — Financial analysis & savings optimization planner. Verbatim spec.
const ANALYZE_SYSTEM = `You are an elite personal finance strategist and financial forensic analyst. You have been provided with a manual ledger of transaction history (a Markdown table). Perform a comprehensive financial audit, evaluate monthly cash flow, and generate an actionable financial optimization and savings plan.

Objectives:
1. Identify & Amortize BNPL Commitments
   - Locate active BNPL plans from Klarna, Sezzle, Afterpay, or Affirm.
   - Assume standard interest-free "Pay in 4" structures (six-week duration, four bi-weekly payments) unless the ledger specifies otherwise.
   - Map out the amortization schedule. If the total purchase was C_total over N installments, each installment is C_total / N. Project the exact dates and amounts of future cash outflows over the next 2 months.
2. Audit Recurring Subscriptions & Bills
   - Isolate recurring software subscriptions, utility bills, insurance payments, and memberships.
   - Highlight "subscription creep" or redundancies (multiple entertainment platforms, forgotten SaaS trials, high utility spending).
3. Outline a Savings Plan
   - Analyze variable spending across Groceries, Apparel, Meals & Dining, etc.
   - Recommend realistic, targeted spending reductions based on the trends.
   - Suggest a structural cash budgeting strategy — an "Escrow Sinking Fund" — to isolate cash for upcoming BNPL installments and fixed bills so they never cause a checking-account cash crunch.

Structure your response with these clearly defined Markdown sections (use ## headings):
## Executive Summary
## BNPL Liabilities & Future Outflow Schedule
## Recurring Bill Audit
## Budgeting Strategy Recommendations
## Targeted Expense Optimization Plan

Be specific and numerical. Show payment dates and dollar amounts. Base every figure on the ledger provided — do not invent transactions.`;

const MODE_CONFIG = {
  extract: { system: EXTRACT_SYSTEM, max_tokens: 4096 },
  analyze: { system: ANALYZE_SYSTEM, max_tokens: 4096 },
};

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return {
      statusCode: 500,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ error: 'ANTHROPIC_API_KEY is not set on the server. In Netlify: Site settings → Environment variables → add ANTHROPIC_API_KEY, then redeploy (Deploys → Trigger deploy → Clear cache and deploy).' }),
    };
  }

  let mode, messages;
  try {
    ({ mode, messages } = JSON.parse(event.body || '{}'));
  } catch {
    return { statusCode: 400, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ error: 'Invalid JSON body.' }) };
  }

  const cfg = MODE_CONFIG[mode];
  if (!cfg) {
    return { statusCode: 400, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ error: 'mode must be "extract" or "analyze".' }) };
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    return { statusCode: 400, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ error: 'messages must be a non-empty array.' }) };
  }

  // Detects "this model isn't available on your key" so we can fall back to the
  // next candidate (vs. an auth/credit error, which would fail on every model).
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
        headers: {
          'content-type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({ model, max_tokens: cfg.max_tokens, system: cfg.system, messages }),
      });
    } catch (err) {
      lastStatus = 502;
      lastText = JSON.stringify({ error: 'Upstream request to Anthropic failed: ' + String(err && err.message ? err.message : err) });
      break; // network failure — retrying other models won't help
    }

    const text = await upstream.text();
    if (upstream.ok) {
      // Success — pass Anthropic's body through verbatim (client reads .content).
      return { statusCode: 200, headers: { 'content-type': 'application/json', 'x-ledger-model': model }, body: text };
    }
    lastStatus = upstream.status; lastText = text;
    if (!isModelError(upstream.status, text)) break; // auth/credit/other — surface it
    // else: try the next model in the chain
  }

  return { statusCode: lastStatus, headers: { 'content-type': 'application/json' }, body: lastText };
};
