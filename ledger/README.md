# Ledger Lens

**Snap → Extract → Optimize.** A standalone, single-file web tool that turns
photos and screenshots of your financial activity into a clean transaction
ledger, then into a personalized savings and budget plan.

This is its own project — fully separate from CARVIS and VOLT. It lives in
`ledger/` and deploys as its own Netlify site.

## What it does

**Step 1 — Extract (multimodal ingestion).**
Drop in one or more images: bank-app screenshots, P2P payment history
(Venmo / PayPal / Apple Pay / Cash App), digital receipts, or photos of paper
receipts. Ledger Lens reads them and builds a GitHub-flavored Markdown table:

| Date | Merchant/Payee | Amount | Currency | Payment Method | Category | Recurring Status | BNPL Provider |

- Dates normalized to ISO-8601 (`YYYY-MM-DD`).
- Outflows negative, inflows positive; no currency symbols in the Amount column.
- Categories constrained to a fixed domain list; recurring vs. one-time flagged.
- Buy-Now-Pay-Later transactions (Klarna, Sezzle, Afterpay, Affirm) tagged.
- Unreadable fields become `null` — no guessing.

Each extraction **appends** to a running ledger. Copy it as **Markdown** or as
**TSV for Sheets/Excel** (paste straight into a spreadsheet).

**Step 2 — Optimize (analysis & savings plan).**
Hand the ledger to a financial-forensics pass that:
- amortizes BNPL "Pay in 4" commitments and projects the next 2 months of outflows,
- audits recurring subscriptions/bills and flags subscription creep,
- recommends targeted spending reductions and an "Escrow Sinking Fund" strategy.

Output is a structured plan with five sections (Executive Summary, BNPL
Liabilities, Recurring Bill Audit, Budgeting Strategy, Targeted Expense
Optimization).

## Architecture

- `index.html` — the entire front end. No build, no external JS/CSS
  dependencies (includes its own small Markdown renderer).
- `netlify/functions/ledger.js` — server-side Anthropic proxy. Holds both
  system prompts and the API key. The browser only sends `mode`
  (`extract` | `analyze`) and the conversation `messages` (including base64
  image blocks). The key is **never** exposed to the page.
- `netlify.toml` — deploy config.

## Deploy (Netlify)

1. Create a new site from this repo.
2. Set **Base directory** = `ledger`.
3. Site settings → Environment variables → add **`ANTHROPIC_API_KEY`**.
4. Deploy. Netlify serves `index.html` at the root and bundles the function at
   `/.netlify/functions/ledger`.

Optional: set `LEDGER_MODEL` to pin a specific model; otherwise the function
walks a fallback chain and uses the first model your key accepts.

## Local development

Because the app calls a serverless function, open it through the Netlify dev
server rather than the bare file:

```bash
npm i -g netlify-cli
cd ledger
netlify dev
```

## Privacy

The API key lives only in the Netlify environment. Images are sent to Anthropic
to read the transactions and are not persisted by this app.
