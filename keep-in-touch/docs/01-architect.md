# 01 — Architect: data model, provider, security, and the honest trade-offs

Files I own: `firestore.rules`, `netlify.toml`, `netlify/functions/send.js`,
`netlify/functions/daily.js`, `netlify/functions/lib/firestore.js`,
`test/functions.test.js`, `DEPLOY_CHECKLIST.md`, this doc.

## A. Data model — the short version and the why

Full field lists are in `SPEC.md §3`. What matters for a maintainer:

**customers** is the only thing that has to be right. Everything else can be
rebuilt from it. A customer carries its own scheduling state: `anchorDate`,
`anchorTouchN`, `nextTouchN`, `slotOffset`, `referralCredit`, `snoozedUntil`,
`usedTemplateIds`. Given a customer and today's date, the engine can tell you
the next touch number, its due date and its slot with no other lookups.

**touches are computed, not stored.** The queue you see on the Today screen is
not a collection of "pending touch" documents. It is `KIT.buildQueue(customers,
today)` run live over the customer list. A touch document is written only when
something *happened* — sent or skipped. Why: a stored queue can get out of sync
(a job dies half-way, a phone goes offline mid-write, a rule changes) and then
touches quietly vanish. A computed queue cannot lose anything: if a customer's
`nextTouchN` says 3 and touch 3 hasn't been recorded, touch 3 is due, today,
until you deal with it. That is the "never silently skipped" guarantee, and it
falls out of the model rather than needing code to police it.

**replies** are the log of every human response (typed in by Mick, or written
by the inbound webhook in Tier 2). A reply resets a customer's clock via
`applyEvent({type:'reply'})`, which rewrites `anchorDate` on the customer. The
reply doc itself is history.

**templates** holds *only overrides* (edited copy, `retired: true`). The library
ships in `templates.json` inside the app. So updating copy is a redeploy, and
retiring a bad one is a click. Overrides are keyed by the library id.

**settings/main** is one doc. **heartbeat/daily** is one doc the daily job
rewrites every run so the app can show the red "job hasn't run" banner.

**optouts/{token}** exists because of a rules problem. Every email has an
unsubscribe link (`/?u=TOKEN`) that a customer clicks without an account. Our
rules deny everything to anyone but Mick — so the click can't touch
`customers`. Instead, the public page writes one tiny document to
`optouts/<token>` and that is the *only* write a stranger can make. The shape is
locked (exactly `{at, source:"link"}`, token 20–64 chars). Both the app (on
open) and `daily.js` (before sending) sweep `optouts`, flip the matching
customer to `dnc`, and delete the doc. A stranger who guesses random tokens
just creates junk that gets deleted; they can't read, list, or undo anything.

**Why no Firebase SDK.** Mick's rule is "no CDN, no external scripts, one
file." The Firebase SDK is ~300 KB of external script and is the only thing that
provides Firestore's built-in offline persistence. We chose the rule and lost the
SDK: the browser talks to Firebase Auth REST and Firestore REST with `fetch`,
and keeps every collection cached in `localStorage` so the app renders instantly
and reads offline. Writes made offline queue in `localStorage` and flush on
reconnect. On the server side, `lib/firestore.js` does the same job for the
functions with a service account and zero npm packages (RS256 JWT signed by
Node's `crypto`, exchanged for an OAuth token). See section E for the cost.

## B. Provider: Resend. Monthly cost: $0.

- Mick already has a Resend account (CARVIS uses it), so no new vendor.
- Free tier: **3,000 emails/month, 100/day**, one verified domain. Mick's volume:
  a few hundred customers × ~4 emails/year ≈ **100–150 emails/month**. That is
  5% of the free tier. Postmark would be $15/month for the same.
- Resend also receives inbound email (`email.received` webhook) which is what the
  Tier 2 inbox uses. One vendor for both directions.
- **The 100/day cap.** `daily.js` stops at 90 sends per run and writes the
  remainder into `heartbeat.errors` ("N customers still due; they stay in the
  queue for tomorrow"). Nothing is lost — the queue is computed, so they're due
  again tomorrow. Hand sends from the app count against the same 100. If Mick
  ever sends more than 100 in a day, Resend returns a 429 and the app shows the
  error; nothing is silently dropped. If he outgrows 3,000/month (that would be
  ~750 customers), Resend's next tier is $20/month.
- Emails are **plain text only**. `send.js` never sends an `html` field, and
  strips any tags that sneak into the body. Plain text reads like a note from a
  person, lands in Primary tabs more often, and matches the brand.

## C. Security model

1. **HTTP functions require a shared secret.** `send.js` refuses anything
   without `x-kit-secret` matching `KIT_SECRET` (401), compared in constant time
   on SHA-256 hashes so length and timing leak nothing. There is no
   unauthenticated URL that sends mail. The secret lives in Netlify env vars and
   in the app's Settings screen (stored in Firestore, which only Mick can read).
2. **Firestore rules deny everything except Mick's UID**, with the single
   `optouts` create exception described above. Rules are pasted into the
   Firebase console; no CLI.
3. **Service account (Tier 2 only)** is a Google key that bypasses rules. It is
   stored only in the Netlify env var `FIREBASE_SERVICE_ACCOUNT` (raw JSON or
   base64 — `firestore.js` accepts either). Scope requested is just
   `https://www.googleapis.com/auth/datastore`. The OAuth token is cached in
   memory until 5 minutes before expiry and never written anywhere.
4. **daily.js over HTTP** only does anything with `?force=1` plus the secret.
   Without those, an HTTP hit behaves like a scheduled tick (hour gate).
5. **Browser headers** (`netlify.toml`): `X-Frame-Options: DENY`,
   `Referrer-Policy: no-referrer`, `nosniff`, and a CSP whose `connect-src`
   allows only the site itself plus the three Google endpoints the app needs.
   Inline script/style are allowed because the whole app is one file.
6. **Input hygiene.** `send.js` caps bodies at 20 KB, validates the address,
   strips HTML and newlines from the subject, and sanitizes tag values.

## D. Assumptions

- `KIT.nextTouch()` returns `{n, dueDate, slot, carried, isDue, isLate, daysLate, snoozed}` per SPEC §4; `daily.js` builds its own due list from it rather than depending on `buildQueue()`'s item shape.
- `KIT.applyEvent(customer, {type:'sent', ...})` returns a new customer with `nextTouchN`, `lastSentDate`, `usedTemplateIds` updated; `daily.js` additionally stamps `lastSentAt` and `updatedAt`.
- Season for a late touch is the season of the *send* day, not the original due date (no ice-scraper tips in July).
- `heartbeat/daily` carries one extra field beyond SPEC §3, `note` (a plain-English reason when nothing was sent).
- The Resend free tier rate limit is ~2 requests/second; `daily.js` waits 550 ms between sends.
- Netlify synchronous functions time out at 10 s by default, so `daily.js` stops sending after 8 s (`KIT_TIME_BUDGET_MS` to change) and reports the remainder; at Mick's volume (~3 due/day) this never triggers.
- `MAIL_FROM` env var is the sender; if unset, `daily.js` falls back to Settings `fromName <fromEmail>`, and `send.js` falls back to Resend's test sender (delivers only to Mick's own inbox).
- Firestore `integerValue` is decoded to a JS number; nothing in this app stores integers beyond 2^53.
- `list()` pages 300 docs at a time; a few hundred customers is one page.
- Netlify reads `netlify.toml` from the base directory (`keep-in-touch`), so `included_files = ["templates.json"]` is relative to that folder.
- The daily job treats an unsubscribe token that matches no customer as junk and deletes it.

## E. If a constraint hurts the product — straight talk

**No SDK vs. offline.** You asked for "no CDN libraries" and "works offline
(Firestore persistence)." Those two can't both be fully true, because offline
persistence *is* the SDK. We kept your no-CDN rule. What you get: the app
caches everything in `localStorage`, so it opens instantly and you can read any
customer, any timeline, offline. Writes you make offline are queued and sent
when you're back online. What you lose: the SDK's live sync between two open
tabs/devices — if Ella edits a customer on her phone while yours is open, you
see it on your next refresh, not instantly. For one salesperson and one
assistant, that's fine. If it ever isn't, the fix is one line (a `<script>` tag
for the Firebase SDK) and about a day of work, not a rewrite.

**Drag-and-drop vs. Git-connect.** Tier 1 (the queue, hand sends via
`send.js`) works either way. Tier 2 (the 9 AM scheduled job) is where it gets
sticky — see the next point. My recommendation: connect the GitHub repo in the
Netlify UI once (it's all clicking, no terminal), set base directory to
`keep-in-touch`, and every push deploys. You never run a build; Netlify bundles
the functions for you. Drag-and-drop stays as the fallback and I've kept the
functions dependency-free so it has the best possible chance of working there.

**Scheduled functions and the Netlify docs.** I tried to verify three things
against Netlify's docs during the build and **the fetch was blocked by this
environment's network proxy** (both
`https://docs.netlify.com/site-deploys/create-deploys/` and
`https://docs.netlify.com/functions/scheduled-functions/` returned
`EGRESS_BLOCKED`). So what follows is my best understanding, stated as
assumptions, and step C.7 of the checklist tells you how to confirm in five
minutes:

1. *Does drag-and-drop bundle functions with relative `require` and
   `included_files`?* My understanding: a drag-and-drop deploy runs no build
   command but Netlify still packages whatever is in the functions folder
   named in `netlify.toml`. Because our functions are zero-dependency and the
   `lib/` files and `templates.json` are inside the uploaded folder, relative
   requires should resolve. `included_files` is a bundler setting and I believe
   it is honored. **Confidence: medium.** If a drag-and-drop deploy logs
   "module not found," switch to Git-connect; that path is certain.
2. *Are scheduled functions supported on manual deploys?* My understanding:
   the schedule is read from `netlify.toml` / the function's exported `config`
   at deploy time, and scheduled functions run only on the **production**
   deploy (not previews or branch deploys). I believe a manual deploy that
   becomes the production deploy does register the schedule. **Confidence:
   medium.** Git-connect is the documented, well-trodden path and is what I
   recommend for Tier 2.
3. *Can scheduled functions be invoked over public HTTP?* My understanding:
   **no** — Netlify does not expose scheduled functions at a public URL
   (visiting `/.netlify/functions/daily` returns a 404 or similar). That is
   good for security. It means the `?force=1` manual-test path may not be
   reachable from a browser in production. The daily job therefore also
   reports itself through `heartbeat/daily`, which the Settings screen shows,
   and the honest way to test Tier 2 is: turn auto-send on, add yourself as a
   customer with a touch due, wait for 9 AM, check heartbeat. If you ever need
   a manual run, temporarily rename the schedule off in `netlify.toml`, deploy,
   call it with the secret, and put it back.

**Time budget.** Netlify's default function timeout is 10 seconds. At your
volume the job finishes in about 2 seconds. If you ever have 30+ emails due
the same morning (say auto-send was off for a month and you flip it on),
`daily.js` sends what it can in 8 seconds, writes "N still due, tomorrow" into
the heartbeat, and catches up over a few days. Nobody is dropped. If that
bothers you, the Approve All button on the queue does the same work by hand in
one tap.

**The one thing most likely to break first:** the Resend sending domain. Until
you verify a domain in Resend, mail only delivers to your own address. Step B
of the checklist. Second most likely: forgetting to paste your UID into
`firestore.rules` — the app will sign you in and then show "permission denied"
on every screen.
