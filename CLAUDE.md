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
  sequences.mjs      the 5 timeline windows + day-delta → "what's due" logic
  hydrate.mjs        {{first_name}} / {{vehicle}} token engine
  compliance.mjs     optedOut guard + copy size/zero-value rules
  templates.mjs      5 sequences x 3 variants (Direct|Softer|NEPQ). LIVE (Mick's voice).
  engine.mjs         runDailyCycle() — the pure daily loop (provider injected)
  intake.mjs         guided "enter customer" steps + voice/photo answer parsing
                     (parseFullName, extractPhone, photo-extraction prompt+parser)

crm/               ROBUST VIEWS — runs in the CARVIS shell (ES module)
  crm.js             mounts the overlay, capture form, dashboard, text queue,
                     voice intake ("enter customer") + photo capture
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

- `carvis_referral_customers` — array of customers
- `carvis_referral_touchlogs` — array of touch logs (the audit trail)
- `carvis_referral_meta`      — `{ lastRun, templatesApproved }`

See `shared/schema.mjs` for field-by-field shapes.

## Capture (voice + photo)
Three ways in, all funneling to one review form before save:
- **Voice** — "enter customer" (mic or command bar) is caught by wrapping
  CARVIS's global `openAI()`; `startVoiceIntake()` walks `INTAKE_STEPS`, speaking
  each question via CARVIS's `speak()` and listening with the Web Speech API.
  Spoken answers are parsed by `shared/intake.mjs` (name split, phone digits,
  email "at/dot"). A typed fallback always works (no mic / unsupported browser).
- **Photo** — a driver's license / card / paperwork image is sent as a base64
  vision block to the existing `carvis.js` Anthropic proxy with `EXTRACTION_PROMPT`;
  `parseExtraction()` turns the JSON reply into a draft.
- **The only required fields are NAME and PHONE** (`validateCustomer`). Everything
  else is optional and editable on the review form.

## The daily loop (cron)
Once a day the scheduled function:
1. Loads the blob (no `CRM_SYNC_KEY` → it no-ops and logs how to set it).
2. Runs `runDailyCycle()` over every customer where `optedOut === false`.
3. For each customer's next-due window (delta between `purchaseDate` and today):
   - **Email branch** — render the variant, send via the injected `EmailProvider`,
     append a `touch_log`, advance the customer's `stage`.
     *Held* (not sent) until `meta.templatesApproved === true`.
   - **Text branch** — queue a compliant pending text on the customer. It is
     **never** sent programmatically; the user fires it from the dashboard.
4. Saves the mutated arrays back to the same blob → the browser pulls them.

## Provider swap (Resend now, MailerLite ready)
`_lib/email-provider.mjs` exposes `getEmailProvider()`. Default is
`ResendProvider` (already deployed). Set `EMAIL_PROVIDER=mailerlite` +
`MAILERLITE_API_KEY` to switch — no engine changes. Adding a new provider = one
class implementing `send({to,toName,subject,html,text})`. See README "Swap the
email provider".

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
| `EMAIL_PROVIDER` | `resend` (default) or `mailerlite` | provider swap |
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
- **Copy is the user's.** Ship placeholder copy with `templatesApproved=false`;
  do not flip it to true until the user supplies real wording.
