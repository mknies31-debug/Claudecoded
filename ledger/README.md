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

## The AI import & advice flows

**Snap your balances (`balances`)** — the daily phone update. Photograph your
bank/card/loan app's balance screen; Foresight reads every account on it
(name with masked digits, type, balance, visible APR, as-of date — never
guessing a blurred number), auto-matches each to your accounts, and reconciles
them with a tagged "Balance update (photo)" entry. Snapshots power the
total-debt trend line, and photographed APRs fill in missing rates (never
overwriting one you typed). Adjustment entries are excluded from income,
budgets, spending charts, and card caps, so reconciling never distorts your
analytics.

**Import transactions (`extract`)** — drop bank/P2P screenshots or receipt
photos; Foresight reads them into a review table (ISO dates, signed amounts,
fixed category list, recurring + BNPL flags, `null` for unreadable cells) that
you confirm and import into an account.

**Deep optimization plan (`analyze`)** — the Advisor runs a financial-forensics
pass over your stored transactions: BNPL "Pay in 4" amortization with projected
outflows, a recurring-bill/subscription-creep audit, and an "Escrow Sinking
Fund" savings strategy, in five structured sections.

**Full financial review (`advise`)** — the Advisor reads a snapshot of income,
budget vs. actual, cards (limits/utilization/purpose/APR + interest cost), and
goals, and returns behavior-focused guidance.

## Architecture

- `index.html` — the entire front end. No build, no external JS/CSS
  dependencies (includes its own small Markdown renderer).
- `netlify/functions/ledger.mjs` — server-side Anthropic proxy. Holds all four
  system prompts and the API key. The browser only sends `mode`
  (`extract` | `balances` | `analyze` | `advise`) and the conversation
  `messages` (including base64 image blocks). The key is **never** exposed to
  the page. The response is **streamed** through as plain text so long
  analyze/advise generations aren't killed by Netlify's synchronous-function
  time limit.
- `netlify.toml` — deploy config. `sw.js`/`manifest.json`/`icon.svg` — PWA
  shell (offline support + install).

## Deploy (Netlify)

**Easiest — drag & drop:**
1. Go to https://app.netlify.com/drop and drop this whole folder onto the page.
   ⚠️ If you drop a **zip** instead, `index.html` and `netlify.toml` must be at
   the **root of the zip** — a zip containing a `ledger/` folder deploys the
   folder itself, leaving the site root a 404 and the AI function undeployed.
2. Open the new site → Site settings → Environment variables → add
   **`ANTHROPIC_API_KEY`**.
3. Trigger a redeploy (Deploys → Trigger deploy) so the function picks up the key.

**Or from Git (the Claudecoded repo):**
1. Create a new site from the repo.
2. Set **Base directory** = `ledger` — in that repo this app lives in the
   `ledger/` subfolder. (Only leave it blank when deploying an unzipped folder
   where these files sit at the root.)
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
  site are rejected. Netlify's `URL`/deploy-preview env vars provide the allowed
  origins; set `ALLOWED_ORIGIN` to allow an extra one. Note this only stops
  *other websites* — a script with no `Origin` header (curl, bots) passes, so
  the access code below is the real protection for a public URL.
- **Access code (recommended):** set an `ACCESS_CODE` environment
  variable in Netlify. Then, once on your phone, open the browser console on the
  site and run
  `localStorage.setItem('foresight.accessCode','YOUR_CODE')`.
  The app will send it on every AI request; anyone without the code gets a 401.
