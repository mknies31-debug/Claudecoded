# CLAUDE.md — North Star Referral CRM (inside CARVIS)

Operational + architectural guide for the referral engine that lives **inside**
the existing CARVIS PWA. Read this before touching the CRM code.

## What this is
A single-user, high-reliability **referral follow-up engine** for a solo
automotive sales pro in Zumbrota, MN. It tracks customers after purchase,
auto-sends a timed email sequence, and hands the user one-tap **text** drafts to
fire manually. It is bolted onto CARVIS (the Jarvis-style command center) as a
new `⇄ REFERRALS` overlay — same shell, same theme, same sync.

## CARVIS architecture pattern (the rule we follow)
- **C**lean **A**PI — pure, isomorphic logic in `shared/*.mjs`. No DOM, no Node
  built-ins, no provider calls. Imported by **both** the browser and the cron so
  the rules can never drift between them.
- **R**obust **V**iews — `crm/*` renders the dashboard into the CARVIS shell.
  Views only read/write through the shared schema + the client store helpers.
- **I**solated **S**ervices — `netlify/functions/*` hold every secret and every
  third-party call (email provider, blob store, cron). The client never sees a key.

```
shared/            CLEAN API — isomorphic, dependency-free, browser + node
  schema.mjs         customer + touch_log shapes, factories, validation
  sequences.mjs      5 fixed windows + recurring 90-day follow-ups (rotating
                     call/text/email/video/gift) + day-delta → "what's due" logic
  hydrate.mjs        {{first_name}} / {{vehicle}} token engine
  compliance.mjs     optedOut guard + copy size/zero-value rules
  templates.mjs      5 sequences x 3 variants (Direct|Softer|NEPQ). LIVE (Mick's voice).
  engine.mjs         runDailyCycle() — the pure daily loop (provider injected)
  intake.mjs         guided "enter customer" steps + voice/photo answer parsing
                     (parseFullName, extractPhone, photo-extraction prompt+parser)
  import.mjs         bulk CSV import — parseCSV, flexible header mapping, dedupe
                     by phone, stage-by-purchase-date planning (planImport)
  goals.mjs          Goals & Rewards engine (the Level-Up layer) — seed list from
                     Mick's working file, editable objectives + rewards, progress
                     math (computeGoalStats). One rule: no reward until checked.
  reporting.mjs      referral scorecard math — computeReferralStats(customers,
                     touchLogs): asked / received / bought / thank-you pending /
                     top sources / conversion %.

crm/               ROBUST VIEWS — runs in the CARVIS shell (ES module)
  crm.js             mounts the overlay, capture form, dashboard, text queue,
                     voice intake ("enter customer") + photo capture, and the
                     ◎ Goals tab (edit objectives/rewards, check the box to earn)
  crm.css            CRM-scoped styling on the CARVIS theme tokens

netlify/functions/ ISOLATED SERVICES — secrets + I/O only
  daily-runner.mjs   scheduled cron; loads blob -> runDailyCycle -> saves blob
  _lib/
    email-provider.mjs  EmailProvider interface + ResendProvider + MailerLiteProvider
    store.mjs           Blob-backed Store gateway (shares keying with sync.mjs)
  carvis.js sync.mjs send-email.js   (pre-existing CARVIS functions — untouched)

test/
  crm.test.mjs       dependency-free regression runner (node --test style, no deps)
```

## Data model (stored as JSON in the existing Blob snapshot)
The CRM does **not** add a database. It reuses CARVIS's sync: the browser keeps
state in `localStorage` under `carvis_referral_*`, which `snapshotStore()`
already pushes to Netlify Blobs (store `carvis-sync`, key `sha256(syncKey)`). The
cron opens the **same** blob using `CRM_SYNC_KEY`.

- `carvis_referral_customers` — array of customers (**the single contact store**;
  the dashboard Hot Prospects panel and the Outreach recipient list both derive
  from it — the legacy `carvis_hot` / `carvis_contacts` silos were merged in via
  a one-time queue, raw backup kept under `carvis_silo_backup`)
- `carvis_referral_touchlogs` — array of touch logs (the audit trail)
- `carvis_referral_meta`      — `{ lastRun, lastReport }` (the cron's health report)
- `carvis_referral_goals`     — the Goals & Rewards (Level-Up) list

See `shared/schema.mjs` for field-by-field shapes.

## Capture (voice + photo + file/PDF)
Four ways in, all funneling to one review form before save:
- **Voice** — "enter customer" (mic or command bar) walks four fields only —
  first name, last name, phone, stock number (`INTAKE_STEPS`). Each answer is
  spoken then locked in with the keyword **"complete"** (continuous recognition
  watches for it), parsed by `shared/intake.mjs` (name clean, phone digits, stock
  tidy). Questions are read in a warmer, slower picked voice with short spoken
  acks. A typed fallback (type + Enter / "✓ Complete") always works.
- **Photo** — a driver's license / card / paperwork image (camera capture) is sent
  as a base64 image block to the existing `carvis.js` Anthropic proxy with
  `EXTRACTION_PROMPT`; `parseExtraction()` turns the JSON reply into a draft.
- **File / PDF** — same flow via `extractFromFile()` for an existing image OR a
  **PDF** chosen from storage; PDFs go up as a base64 `document` block (multi-page
  read). Capped ~4.5MB (Netlify body limit). The proxy forwards content blocks
  as-is, so no server change was needed.
- **Bulk import** — "⇪ Import list (CSV)" parses a whole spreadsheet (exported to
  CSV) via `shared/import.mjs`: flexible headers, dedupe by phone, and a
  `Purchase Date` column slots older customers into the right stage
  (`stageForElapsedDays`) so they don't get the welcome sequence. Shows a
  reviewable plan (ready / duplicate / invalid) before anything is saved.
- **The only required fields are NAME and PHONE** (`validateCustomer`). Everything
  else is optional and editable on the review form.

## Categories: Hot / Cold / Sold
Each contact has a `category` (`schema.mjs`): **sold** (a buyer — runs the
post-purchase referral timeline), **hot** (engaged prospect), or **cold**
(nurture lead). Defaults to `sold` so an imported book and old records are
buyers. Prospects (hot/cold) do NOT run the buyer sequence — the engine works
them on a **keep-warm cadence** (`PROSPECT_INTERVAL` = hot 2 days / cold 14):
if untouched past the interval it queues a `reachout` task with a NEPQ script
(`PROSPECT_SCRIPTS`) for the user to fire by text. The Pipeline filters by
category (chips + counts); the dashboard To-Do surfaces the reach-outs.

## The daily loop (cron)
Once a day the scheduled function:
1. Loads the blob (no `CRM_SYNC_KEY` → it no-ops and logs how to set it).
2. Runs `runDailyCycle()` over every customer where `optedOut === false`.
3. **Prospects (hot/cold)** get a keep-warm reach-out task if overdue; **buyers
   (sold)** run the timed window below (delta between `purchaseDate` and today):
   - **Email branch** — render the variant, send via the injected `EmailProvider`,
     append a `touch_log`, advance the customer's `stage`.
     *Held* (not sent) until `APPROVED === true` in `shared/templates.mjs`.
   - **Text branch** — queue a compliant pending text on the customer. It is
     **never** sent programmatically; the user fires it from the dashboard.
4. Saves the mutated arrays back to the same blob → the browser pulls them.

## Provider swap (Resend now, MailerLite ready)
`_lib/email-provider.mjs` exposes `getEmailProvider()`. Default is
`ResendProvider` (already deployed). Set `EMAIL_PROVIDER=gmail` (+ `GMAIL_USER` /
`GMAIL_APP_PASSWORD`) to send straight from a Gmail inbox via SMTP, or
`EMAIL_PROVIDER=mailerlite` (+ `MAILERLITE_API_KEY`) — no engine changes. Adding a
new provider = one class implementing `send({to,toName,subject,html,text})`. See
README "Swap the email provider".

## Build / run / deploy
- **No build step.** Static files + auto-bundled functions (esbuild). Deploy =
  drag the folder to Netlify or connect the repo. See `DEPLOY.md`.
- **Run the tests:** `npm test` (pure node, no install needed beyond deps).
- **Local cron dry-run:** `npm run crm:dry` prints the cycle against sample data
  without sending or writing anything.

## Environment variables
| Var | Powers | Required for |
| --- | --- | --- |
| `RESEND_API_KEY` | outbound email | auto-emails to actually send |
| `MAIL_FROM` / `MAIL_REPLY_TO` | sender identity | email |
| `CRM_SYNC_KEY` | lets the cron find the user's blob | the daily loop |
| `CRON_SECRET` | `x-cron-key` header required for manual cron triggers (scheduled run exempt) | keeping the send loop private |
| `EMAIL_PROVIDER` | `resend` (default), `gmail`, or `mailerlite` | provider swap |
| `GMAIL_USER` / `GMAIL_APP_PASSWORD` | send from a Gmail inbox via SMTP app password | only if `EMAIL_PROVIDER=gmail` |
| `MAILERLITE_API_KEY` | MailerLite send | only if `EMAIL_PROVIDER=mailerlite` |
| `ANTHROPIC_API_KEY` | (CARVIS, pre-existing) | the Ask CARVIS brain |

## Guardrails (do not regress)
- **Compliance is law.** Texts ≤ 3 sentences, emails ≤ 6 sentences, **zero**
  dollar/trade/credit/financing/price language in any template. `compliance.mjs`
  enforces it and `crm.test.mjs` fails the build if a template violates it.
- **optedOut freezes everything** for that record — no auto-email, no text UI.
- **Tone:** plain-text, conversational, small-town MN. No exclamation marks, no
  corporate jargon, no AI formatting tells.
- **Never** send a text from a server. The text branch only ever *queues*.
- **Copy is the user's.** The auto-email gate is `APPROVED` in
  `shared/templates.mjs` — currently `true` because Mick's real wording is in.
  If templates ever revert to placeholders, flip it back to `false`.
