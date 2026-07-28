# Foresight — Budgets, analyzed and projected

A standalone personal-finance app: **establish your accounts (organized by
type), track balances, see your money in charts, and get reminders for
upcoming recurring payments** — plus AI tools to read transactions from images
and generate a savings plan.

This is its own project — fully separate from CARVIS and VOLT. The files in
this folder are the entire site; it deploys as its own Netlify site. All of
your account and transaction data is stored **locally on your device**
(IndexedDB, with a localStorage fallback). The app's numbers, charts, budgets,
cards and goals all work **fully offline** — data is only sent out when you
choose to use an **AI feature** (see Privacy below).

## Tabs

- **Dashboard** — net worth; money in checking / savings / investments; total
  debt obligations; a review prompt; live alerts (card utilization, pay-in-full
  risk, budget drift, goals behind pace); budget-this-month; card health; goal
  progress; spending and cash-flow charts; and the next payments due.
- **Accounts** — create accounts grouped by type (Checking, Savings,
  Investment, Cash, Credit Card, Loan, Other); open one to see its
  transactions. Add a transaction and it can create the account on the spot.
- **Cards** — assign each credit card a **purpose** (Work / Personal / House),
  a credit limit, due date, and monthly cap. Tracks utilization with warning
  bands, spend-this-month vs. cap, available credit, and **recommends the best
  card for each purpose** to keep utilization low and cards payable in full.
- **Budget** — set monthly income and per-category budgets; see **budgeted vs.
  actual** for the month, cash-flow margin, over-budget categories, and a
  pay-all-cards-in-full check.
- **Goals** — short- (≤1yr), mid- (1–5yr), and long-term (5yr+) savings goals,
  auto-categorized by target date. Each tracks target, saved, progress,
  milestones on a timeline, months left, recommended monthly contribution, and
  an on-track / behind / ahead status.
- **Add** — log a transaction manually (Expense/Income), or import from images.
- **Charts** — current totals for **debt obligations, investments, savings, and
  checking**, plus account balances, spending by category, income vs. expenses
  by month, a net cash-flow trend, recurring monthly obligations, and top
  merchants. All rendered with dependency-free SVG.
- **Reminders** — upcoming and overdue recurring payments, projected from any
  transaction you mark as recurring. "Log payment" advances the schedule.
- **Advisor** — an AI review that reads a full snapshot (income, budgets, cards,
  goals) and returns behavior-focused guidance: which card to use for each
  purpose, whether you're on pace to pay cards in full, where you're drifting
  over budget, and how to keep each goal on track. Also includes weekly /
  monthly / quarterly review prompts and the deep BNPL/subscription
  optimization pass. (Needs the deployed function.)

Use **Accounts → Backup** to export/import your data as a JSON file.

## What it does

**Step 1 — Extract (multimodal ingestion).**
Drop in one or more images: bank-app screenshots, P2P payment history
(Venmo / PayPal / Apple Pay / Cash App), digital receipts, or photos of paper
receipts. Foresight reads them and builds a GitHub-flavored Markdown table:

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

**Easiest — drag & drop:**
1. Go to https://app.netlify.com/drop and drop this whole folder onto the page.
2. Open the new site → Site settings → Environment variables → add
   **`ANTHROPIC_API_KEY`**.
3. Trigger a redeploy (Deploys → Trigger deploy) so the function picks up the key.

**Or from Git:**
1. Create a new site from the repo.
2. Leave **Base directory** BLANK — these files are already at the root (do NOT
   set it to `ledger`).
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
netlify dev   # run from this folder
```

## Privacy

Your ledger lives only on your device. The **only** time data leaves your device
is when you actively trigger an AI feature, and each one sends different content
to Anthropic (via the Netlify function, which keeps your API key server-side):

- **Add → import from images** (`extract`): the image(s) you choose are sent so
  the model can read the transactions.
- **Add → snap your balances** (`balances`): the balance-screen photo(s) you
  choose are sent so the model can read account names, balances, and APRs.
  Foresight then reconciles each account to the photographed balance, records a
  daily snapshot for the total-debt trend, and fills in missing card/loan APRs
  to power the interest-cost tracker.
- **Advisor → deep optimization plan** (`analyze`): the selected transaction
  ledger (a Markdown table of the account or all accounts you pick) is sent.
- **Advisor → full financial review** (`advise`): a snapshot of your finances —
  income, budget vs. actual, cards (limits/utilization/purpose), and goals — is
  sent. You can preview the exact snapshot before sending with "Preview the data
  it sees."

None of this is persisted by the app, and the Anthropic API key is never exposed
to the browser. If you never use the AI tabs, nothing is ever uploaded.

### Locking the AI endpoint (recommended for public deploys)

The `/.netlify/functions/ledger` endpoint spends your Anthropic credits, so it
has two guards:

- **Same-origin check (automatic):** requests whose browser `Origin` isn't your
  site are rejected. Netlify's `URL` env var provides the allowed origin; set
  `ALLOWED_ORIGIN` to override.
- **Access code (optional but recommended):** set an `ACCESS_CODE` environment
  variable in Netlify. Then, once on your phone, open the browser console on the
  site and run
  `localStorage.setItem('foresight.accessCode','YOUR_CODE')`.
  The app will send it on every AI request; anyone without the code gets a 401.
