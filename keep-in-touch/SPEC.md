# North Star Keep-In-Touch — Shared Build Spec (all agents read this first)

Source of truth for how the pieces fit. If you must deviate, write the deviation
in your deliverable's "Assumptions" section in one line each. Do NOT edit files
owned by another agent (ownership table below).

## 0. Ground rules (from Mick's build prompt — restated so nobody forgets)

- BRAND (changed by Mick 2026-09-15): the app and every customer-facing message
  are branded **North Star Car Guy**. Sign-off is **Mick / North Star Car Guy /
  phone**. Mosaic Autos appears only in the compliance footer as the physical
  location ("North Star Car Guy at Mosaic Autos · address"). Nothing may imply
  Mick owns Mosaic Autos.
- No dollar figures anywhere in templates. `[VERIFY NUMBER]` if a number is truly
  needed.
- Banned in copy: "just checking in", "touching base", "circling back",
  "reaching out", "I noticed you haven't", "valued customer", "at this time",
  "premier", any superlative (best, greatest, top, #1, lowest, highest,
  cheapest, fastest, most, biggest, finest, perfect), any exclamation point.
- Every message ends with exactly ONE question (the only `?` in the message),
  answerable in one word from a phone.
- Texts are never auto-sent. Ever. Email may be auto-sent only in Tier 2 with
  the toggle on and the customer's email consent recorded.
- One `index.html`, vanilla HTML/CSS/JS, **no CDN or external scripts of any kind**,
  no build step, no npm dependencies in functions (Node 18+ built-ins + `fetch` only).
- Dates for scheduling are `YYYY-MM-DD` strings computed in America/Chicago.
- App palette: black `#000`, white `#fff`, Mosaic magenta `#D60073`. System font stack.

## 1. Repo layout & file ownership

```
keep-in-touch/
  SPEC.md                         (lead)
  index.html                      Agent 7 Builder
  manifest.json                   Agent 7 Builder  (tiny second file — flagged in checklist)
  templates.json                  Agent 3 Copy
  firestore.rules                 Agent 1 Architect
  netlify.toml                    Agent 1 Architect
  netlify/functions/send.js       Agent 1 Architect
  netlify/functions/daily.js      Agent 1 Architect
  netlify/functions/inbound.js    Agent 5 Inbox
  netlify/functions/lib/engine.js Agent 2 Cadence   (shared, UMD — see §4)
  netlify/functions/lib/firestore.js  Agent 1 Architect (service-account REST client, see §6)
  netlify/functions/lib/stats.js  Agent 5 Inbox     (attribution math, UMD)
  netlify/functions/lib/compliance.js Agent 4 Compliance (footer/consent text + opt-out detection, UMD)
  test/engine.test.js             Agent 2
  test/stats.test.js              Agent 5
  test/lint-templates.js          Agent 3 (Agent 6 re-runs + writes its own checks in test/audit.js)
  test/functions.test.js          Agent 1 (send.js rejects w/o secret, etc.)
  docs/01-architect.md            Agent 1 (data model narrative, decisions, DEPLOY CHECKLIST)
  docs/02-cadence.md              Agent 2
  docs/03-copy-guide.md           Agent 3 (when to edit a template before sending)
  docs/04-compliance.md           Agent 4 (dealership approval one-pager + MN statutes to have a lawyer read)
  docs/05-inbox-attribution.md    Agent 5
  docs/06-audit.md                Agent 6 (pass/fail table)
  DEPLOY_CHECKLIST.md             Agent 1
```

The Builder inlines `engine.js`, `stats.js`, `compliance.js` and `templates.json`
into `index.html` between marker comments so they stay diff-able:

```
<!-- BEGIN engine.js --> ... <!-- END engine.js -->
```
The Auditor verifies the inlined copies are byte-identical to the lib files.

## 2. Product decisions already made (do not relitigate)

1. **Email provider: Resend.** Mick already has a Resend account (the sibling
   CARVIS app uses it). Free tier = 3,000 emails/month, 100/day. At Mick's volume
   (a few hundred customers × ~4 emails/yr ≈ 100–150/month) the cost is **$0/month**.
   Postmark would be $15/month for the same. Resend also has inbound email
   receiving (webhook `email.received`) for Tier 2 inbox.
2. **No Firebase SDK.** Mick's constraint "no CDN libraries" conflicts with
   "Firestore persistence" (which needs the SDK). We keep the no-CDN rule: the
   browser talks to **Firebase Auth REST** and **Firestore REST** with `fetch`, and
   keeps a local cache of every collection in `localStorage` so the app renders
   instantly and reads offline. Writes queue in `localStorage` when offline and
   flush on reconnect. Say this plainly in docs; it is a real trade-off.
3. **Zero npm deps in functions.** Google service-account auth is done with a
   self-signed JWT via Node `crypto` (RS256) → OAuth token → Firestore REST. So
   drag-and-drop deploys stay viable and nothing needs `npm install`.
4. **Unsubscribe is a public page in index.html** (`/?u=TOKEN`). It writes a
   document to `optouts/{token}` with no auth. Firestore rules allow ONLY that
   one anonymous create, with strict shape validation. The app (on open) and
   `daily.js` (before sending) process `optouts` → flip the matching customer to
   `dnc`. This is the single exception to "deny everything but Mick's UID" and
   must be called out in the rules file and the compliance doc.
5. **Late-touch floor.** Mick asked that after a late send the next touch keep the
   original cadence. Taken literally, a customer 200 days overdue would get two
   notes a day apart. We keep original cadence **but never schedule the next
   touch sooner than `settings.minGapDays` (default 21) after an actual send**.
   Stated as a deliberate deviation in the summary. Skips do not apply the floor.
6. **Anniversary.** Touch 4 = sale + 360 days, not 365. Copy says "coming up on a
   year". Referral-slot touches whose due date falls within ±30 days of a sale
   anniversary pull from the ANNIVERSARY_REFERRAL pool.
7. **Sentence budgets.** Email template body ≤ 5 sentences; text ≤ 2 sentences
   (strict reading of "under 6 / under 3"). Sign-off block and compliance footer
   are outside the count. When Ella sends, the sign-off becomes
   "Ella, for Mick / North Star Car Guy / phone" — no extra sentence needed.
8. **Phone appears in every email sign-off** (assumption: Mick wants to be
   reachable; the prompt requires it on touch 0 and first text at minimum).
9. **Scheduled run time & DST.** Netlify cron is UTC and has no DST. `daily.js`
   is scheduled `0 14,15 * * *` and exits immediately unless the current hour in
   America/Chicago is 9. Net effect: runs once, at 9:00 AM Central, year-round.
10. **Netlify deploy path.** Recommended: connect the GitHub repo in the Netlify UI
    with base directory `keep-in-touch` (no terminal). Drag-and-drop of the
    `keep-in-touch` folder is the fallback and works for Tier 1. Architect must
    verify against Netlify docs whether drag-and-drop bundles functions that
    `require('./lib/x.js')`; if not, each function must inline what it needs.

## 3. Data model (Firestore, all under Mick's project)

All dates that drive scheduling are `YYYY-MM-DD` strings. Timestamps that are
just for the record are ISO-8601 strings (`2026-09-15T14:03:00.000Z`).

### customers/{customerId}   (customerId = 20-char random id, client generated)
```
name            string   "Dan Halvorson"
first           string   "Dan"            (derived at save; editable)
phone           string   "5075551234"     (digits only; display formats it)
email           string   "dan@example.com" (lowercased) | ""
vehicle         { year: 2019, make: "Chevrolet", model: "Silverado", trim: "" }
vehicleLabel    string   "2019 Silverado" (derived: year + model) — used by {vehicle}
saleDate        YYYY-MM-DD
birthday        "MM-DD" | ""             (year not needed)
referredBy      customerId | ""          (who referred THIS customer)
referredByName  string | ""              (denormalized for display)
attributedTouchId  string | ""           (last touch sent to the referrer in the 60 days before this customer was added; auto-filled)
hook            string | ""              ("the gravel road out by Goodhue") — one short phrase used by CHECK-IN copy via {hook|...}
notes           string
emailConsent    { given: bool, at: ISO|"", how: "in person at sale"|"phone"|"text"|"email"|"web form"|"" }
smsConsent      { given: bool, at: ISO|"", how: same }
status          "active" | "dnc"
dnc             { at: ISO, reason: "STOP reply"|"unsubscribe link"|"manual"|"", channel: "email"|"sms"|"both" } | null
anchorDate      YYYY-MM-DD   (= saleDate initially; = reply date after a reply)
anchorTouchN    int          (0 initially; = touch number that was replied to)
nextTouchN      int          (0 initially)
slotOffset      int          (0; incremented when a birthday note displaces a slot)
referralCredit  bool         (true after they send a referral; next REFERRAL slot → VALUE, then cleared)
snoozedUntil    YYYY-MM-DD | ""
lastSentAt      ISO | ""
lastSentDate    YYYY-MM-DD | ""
lastReplyAt     ISO | ""
lastReplyDate   YYYY-MM-DD | ""
firstTextSentAt ISO | ""     (STOP notice appended to a text only when this is empty)
usedTemplateIds string[]     (for no-repeat selection)
unreadReplies   int
unsubscribeToken string      (32+ chars, random, client generated)
purchases       [{ saleDate, vehicle, vehicleLabel }]   (repeat purchases; first sale included)
createdAt, updatedAt  ISO
```

### touches/{touchId}
```
customerId, customerName, touchN (int), slot (see §4 slot names), templateId,
season ("winter"|"spring"|"summer"|"fall"|"any"),
dueDate YYYY-MM-DD, status "queued"|"sent"|"skipped",
sentAt ISO|"", sentDate YYYY-MM-DD|"", channels ["email"] | ["sms"] | ["email","sms"] | [],
sentBy "mick"|"ella"|"scheduled",
subject, emailBody, textBody (rendered, as actually sent; edits preserved),
providerId string|"" (Resend id), late bool, daysLate int,
createdAt, updatedAt
```
Touches are written when acted on (sent/skipped). The queue itself is computed
live by the engine from customers — it is NOT stored — so nothing can be lost.

### replies/{replyId}
```
customerId, customerName, touchId|"", slot|"", templateId|"",
receivedAt ISO, receivedDate YYYY-MM-DD, channel "email"|"sms"|"phone"|"in person",
source "manual"|"webhook", from string, subject string, snippet string (≤ 1000 chars),
isOptOut bool, processed bool (clock reset applied), createdAt
```

### templates/{templateId}  — only OVERRIDES. Library ships in templates.json.
```
{ subject, emailBody, textBody, retired: bool, updatedAt }
```

### settings/main  (single doc)
```
mickPhone "5075550000", mickPhoneDisplay "(507) 555-0000",
fromName "Mick at North Star Car Guy", fromEmail "mick@…", replyTo "…@gmail.com",
businessAddress "[VERIFY] 123 Main St, Zumbrota, MN 55992",
siteUrl "https://….netlify.app", sendSecret "…" (the x-kit-secret value),
autoSendEmail bool (Tier 2 toggle, default false), autoSendSms false (hard-coded false, UI shows it disabled with the TCPA reason),
sendHour 9, minGapDays 21, senderMode "mick"|"ella" (default for hand sends),
firebase { apiKey, projectId } (also cached in localStorage for pre-login boot),
updatedAt
```

### heartbeat/daily
```
lastRunAt ISO, lastRunDate YYYY-MM-DD, ranSend bool, sent int, skipped int, errors string[], durationMs
```

### optouts/{token}   — anonymous create allowed (see §2.4)
```
{ at: ISO string, source: "link" }      — exactly these two keys
```
Processed by app/daily.js: find customer with unsubscribeToken == token → status dnc,
dnc {reason:"unsubscribe link", channel:"email"}; then delete the optout doc.

## 4. Engine contract — `netlify/functions/lib/engine.js` (Agent 2)

UMD: works as `const KIT = require('./lib/engine.js')` in Node AND as a browser
global `window.KIT` when inlined. Pure functions, no I/O, no Date.now() except in
`todayChicago()`.

Slot names: `THANKS` (touch 0), `THANKS_REPEAT` (touch 0 of a repeat purchase),
`VALUE`, `CHECKIN`, `REFERRAL`, `ANNIVERSARY_REFERRAL`, `BIRTHDAY`,
`REFERRAL_THANKS` (immediate, out-of-cadence), `GOODBYE` (opt-out confirmation).

```
KIT.todayChicago()                       -> "YYYY-MM-DD" (Intl, America/Chicago)
KIT.nowChicagoHour()                     -> 0..23
KIT.addDays(ymd, n) / KIT.diffDays(a, b) -> b - a in days (pure calendar math via Date.UTC)
KIT.seasonFor(ymd)                       -> Dec–Feb winter, Mar–May spring, Jun–Aug summer, Sep–Nov fall
KIT.baseSlot(n)                          -> 0 THANKS, odd VALUE, n%4==2 CHECKIN, n%4==0 REFERRAL
KIT.touchDate(customer, n)               -> n==0: saleDate+3; else anchorDate + 90*(n - anchorTouchN)
                                            (with anchorTouchN==0 that is saleDate + 90n)
KIT.resolveSlot(customer, n, dueDate)    -> { slot, carried: bool }
     order: effective = baseSlot(n - slotOffset) (n - slotOffset ≥ 1; if it computes to 0 treat as 1)
            if effective REFERRAL and referralCredit -> VALUE
            if effective REFERRAL and dueDate within ±30 days of a saleDate anniversary -> ANNIVERSARY_REFERRAL
            if birthday set and dueDate within ±14 days of the birthday (nearest occurrence) and n ≥ 1 -> BIRTHDAY, carried=true
KIT.nextTouch(customer, today)           -> null if status dnc; else
     { n, dueDate, slot, carried, isDue, isLate, daysLate, snoozed }
     isDue = dueDate <= today && (!snoozedUntil || snoozedUntil <= today)
KIT.previewTouches(customer, count=8, today) -> simulated list applying carries
KIT.buildQueue(customers, today)         -> due items sorted oldest dueDate first, then name; one per customer
KIT.pickTemplate(pool, usedTemplateIds, seed) -> least-recently-used template (unused first, then oldest use), deterministic tiebreak
KIT.templatePool(library, overrides, slot, season) -> array of live templates (retired removed, overrides merged); VALUE pulls season pool + "any"
KIT.render(template, customer, settings, opts) -> { subject, emailBody, textBody, emailFull, textFull }
     placeholders: {first} {name} {vehicle} {year} {make} {model} {hook|fallback text} {phone} {sale_year} {season}
                   {referred|fallback} (from opts.referred or customer.pendingThanks.referredName; REFERRAL_THANKS)
     emailFull = body + signoff (+ footer from compliance.js if opts.footer provided)
     textFull  = textBody (+ " Reply STOP to opt out." when opts.firstText)
     opts.sender "mick"|"ella" picks the sign-off block
KIT.applyEvent(customer, event, today)   -> NEW customer object (pure). Events:
     {type:"sent", n, dueDate, channels, sentDate, templateId}   → nextTouchN = n+1; lastSentDate; usedTemplateIds push;
                                                                   if slot was BIRTHDAY (carried) → slotOffset+1;
                                                                   if slot was VALUE via referralCredit → referralCredit=false;
                                                                   next date floor: if touchDate(n+1) < sentDate + minGapDays → store customer.floorDate (engine honors floorDate in touchDate for n+1 only)
     {type:"skipped", n}                 → nextTouchN = n+1 (no floor), carried birthday still bumps slotOffset
     {type:"snoozed", days:7, today}     → snoozedUntil = today+7
     {type:"reply", date}                → anchorDate = date; anchorTouchN = nextTouchN-1 (the touch replied to; min 0); snoozedUntil="" ; lastReplyDate
     {type:"referralReceived", date}     → referralCredit = true  (the immediate REFERRAL_THANKS is an out-of-cadence touch: queue shows it as an "extra" item; it does not consume a touch number)
     {type:"optOut", reason, channel, at} → status dnc, dnc {...}
     {type:"repeatPurchase", saleDate, vehicle} → purchases push, saleDate/anchor reset, nextTouchN 0, slotOffset 0, vehicle updated, status active
KIT.isOptOutText(str)                    -> true for stop/unsubscribe/opt out/remove me/quit/cancel/end (whole word, any case, anywhere in the first 80 chars)
     {type:"sentExtra", sentDate, channels, templateId} → REFERRAL_THANKS went out: pendingThanks=null, lastSentDate, min-gap floor applies
     {type:"skippedExtra"}               → REFERRAL_THANKS skipped: pendingThanks=null, nothing else changes
KIT.extraQueueItems(customers, today)    -> pending REFERRAL_THANKS items (customer.pendingThanks = {date, referredName}) — set by applyEvent referralReceived, cleared by sentExtra / skippedExtra
```
Tests (Agent 2, `node test/engine.test.js`, zero deps, `assert`): sale Dec 31,
Feb 29 (2028-02-29), 90-day ladder, birthday carry, referral credit, reply reset,
late touch + min gap floor, anniversary window, DNC returns null, season map,
never-skipped invariant (simulate 3 years of a customer with random misses; every
touch number 0..N appears exactly once as sent/skipped).

## 5. Templates contract — `templates.json` (Agent 3)

```
{
  "version": 1,
  "generated": "2026-09-15",
  "placeholders": ["{first}", "{vehicle}", "{year}", "{make}", "{model}", "{hook|…}", "{phone}", "{sale_year}", "{season}"],
  "templates": [
    {
      "id": "value-fall-01",         // slug: slot-season-nn (season only for VALUE)
      "slot": "VALUE",               // see §4 slot names
      "season": "fall",              // VALUE only: winter|spring|summer|fall|any. Others: "any"
      "tone": "direct"|"softer"|"nepq",
      "principle": "Reciprocity — a real checklist, no pitch",
      "subject": "Deer season and your headlights",
      "emailBody": "…≤5 sentences, ends with the one question…",
      "textBody": "…≤2 sentences, same idea, same closing question…",
      "editHint": "Swap the road name for one they actually drive."
    }
  ]
}
```
Minimums: THANKS 4, THANKS_REPEAT 2, VALUE 4 per season (16) + 2 any, CHECKIN 6,
REFERRAL 6, ANNIVERSARY_REFERRAL 3, BIRTHDAY 3, REFERRAL_THANKS 3, GOODBYE 2
(GOODBYE = two-sentence goodbye that leaves the door open, one channel each: email + text; the
"exactly one question" rule does NOT apply to GOODBYE — it must contain no question).
Bodies do NOT include the sign-off or footer — the engine appends those.
Use `{hook|the roads out your way}` style fallbacks in CHECKIN.
No links except the NHTSA recall lookup `https://www.nhtsa.gov/recalls` and it
must not be in the first sentence.

## 6. Functions contract (Agent 1 / Agent 5)

Env vars (Netlify → Site settings → Environment variables):
```
KIT_SECRET                 shared secret; every HTTP function requires header  x-kit-secret: <value>
RESEND_API_KEY
MAIL_FROM                  "Mick at North Star Car Guy <mick@northstarcarguy.com>"
MAIL_REPLY_TO              the dedicated Gmail address
FIREBASE_PROJECT_ID
FIREBASE_SERVICE_ACCOUNT   base64 of the service-account JSON (Tier 2 + inbound only)
RESEND_WEBHOOK_SECRET      Svix signing secret for inbound (Tier 2 inbound only)
SITE_URL                   https://….netlify.app (for unsubscribe links)
```

`send.js` (POST): requires `x-kit-secret` (constant-time compare) → 401 otherwise.
Body `{ to, toName, subject, text, customerId, touchId, unsubscribeUrl }`. Sends via
Resend REST with `reply_to` = MAIL_REPLY_TO and headers
`List-Unsubscribe: <unsubscribeUrl>` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click`.
Plain text only (no HTML). Returns `{ ok, id }`. Never touches Firestore (Tier 1 has
no service account). Also rejects GET, missing fields, and bodies > 20 KB.

`daily.js` (scheduled `0 14,15 * * *`): exit unless `KIT.nowChicagoHour() === 9`
(or `event.headers['x-kit-secret']` matches AND `?force=1` for manual test).
Steps: load settings, process optouts, load active customers, buildQueue, for each
due item where settings.autoSendEmail && customer.emailConsent.given && email
present: pick template, render with footer, send via Resend, write touch (status
sent, sentBy scheduled), applyEvent sent, save customer. Never sends SMS. Writes
heartbeat/daily always (even on early exit, with ranSend=false). Wraps every
customer in try/catch so one failure doesn't stop the run.

`inbound.js` (POST, Resend webhook): verify Svix signature (`svix-id`,
`svix-timestamp`, `svix-signature`, HMAC-SHA256 over `${id}.${ts}.${body}` with the
base64 secret after `whsec_`; reject if timestamp older than 5 min) OR accept
`x-kit-secret` header (manual forward/test). Handle `email.received`: fetch the
message from Resend if the payload lacks the body, match `from` to a customer by
email (lowercased), write a reply doc linked to that customer's most recent sent
touch within 45 days, `unreadReplies++`, `applyEvent reply`. If
`KIT.isOptOutText(subject or first line)` → `applyEvent optOut` (channel email) and
send the GOODBYE template once via Resend. Unknown senders are logged to
`replies/` with `customerId: ""` so nothing is lost. Always 200 to Resend after
signature passes (so it doesn't retry forever); errors go in the doc.

`lib/firestore.js` (Agent 1): `makeClient({projectId, serviceAccountB64})` →
`{ get(path), set(path, data), update(path, data), delete(path), list(collection),
runQuery(collection, where[]) }` with `encode(obj)`/`decode(doc)` helpers exported
for the browser to reuse (the Builder copies the codec). RS256 JWT via `crypto.sign`.

## 7. Compliance contract — `lib/compliance.js` (Agent 4)

UMD exporting:
```
COMPLIANCE.emailFooter(settings, unsubscribeUrl) -> string (plain text, ≤ 5 lines)
COMPLIANCE.smsOptOutLine -> "Reply STOP to opt out."
COMPLIANCE.consentHowOptions -> ["in person at sale", "phone", "text", "email", "web form"]
COMPLIANCE.canEmail(customer)  -> bool (active && emailConsent.given && email)
COMPLIANCE.canText(customer)   -> bool (active && smsConsent.given && phone)
COMPLIANCE.consentSummary(customer) -> "Email: yes (in person at sale, 2026-09-15) · SMS: no"
COMPLIANCE.isOptOutText(str)   -> same regex as engine (single source: compliance may just re-export)
```
Footer must: identify Mick as North Star Car Guy, selling at Mosaic Autos (not owner), say why
they're receiving it, include the unsubscribe URL, include the physical address
placeholder `settings.businessAddress`, and be plain text.

## 8. Stats contract — `lib/stats.js` (Agent 5)

UMD exporting pure functions over arrays:
```
STATS.replyRateBySlot(touches, replies)          -> [{slot, sent, replied, rate}]
STATS.replyRateByTemplate(touches, replies)      -> [{templateId, slot, sent, replied, rate}] (flag rate<0.05 with sent≥8 as "retire?")
STATS.referralsByCustomer(customers)             -> [{customerId, name, referred:[{id,name,saleDate}]}] sorted desc
STATS.monthly(customers, touches)                -> [{month:"2026-09", referrals, repeats, sent}] last 12 months
STATS.referralsBySlot(customers, touches)        -> [{slot, referrals}] using attributedTouchId
STATS.suggestAttributedTouch(referrerId, touches, today) -> touchId|"" (most recent sent to referrer within 60 days)
```

## 9. UI contract (Agent 7 Builder) — screens in priority order

Bottom tab bar (mobile): Queue · Add · Customers · Referrals · Templates · Settings
(Customers list opens a customer's Timeline).

1. **Today's Queue** — list of `buildQueue()` + `extraQueueItems()`; badge shows
   count; each card: name, vehicle, slot chip, "late N days" chip, subject + email
   preview (expand to edit both email and text), buttons: **Send Email** ·
   **Send as Text** (`sms:+1NNN?&body=…`) · **Copy Text** · Skip · Snooze 7d ·
   sender toggle Mick/Ella. Approve All = sends email to everyone in queue with
   canEmail (confirm dialog shows count). Red banner if heartbeat older than 36h
   AND autoSendEmail is on. Amber banner when offline. Every send/text/copy logs
   a touch with the channels used; the second channel on the same touch updates
   the same touch doc.
2. **Add Customer** — one screen; saleDate defaults today; consent checkboxes
   auto-stamp `at` and require `how`; "Repeat buyer?" toggle picks an existing
   customer; "Referred by" picker with search. Save < 60s.
3. **Customer timeline** — header, next touch (date + slot + preview), consent
   summary, buttons: Log a phone call (one tap, writes replies doc channel phone,
   resets clock), Log a reply (paste), Mark do-not-contact, Edit. Timeline shows
   touches + replies newest first. Preview next 8 touches.
4. **Referrals** — network list, per-customer counts, monthly table (referrals,
   repeats), reply rate by slot and by template (with "retire?" flag).
5. **Templates** — library grouped by slot/season, edit → saved as override,
   retire toggle, "preview next 8 touches for customer X".
6. **Settings** — Firebase config, sign-in, sender identity, phone, address,
   send secret, auto-send email toggle (SMS shown locked with the TCPA reason),
   heartbeat status, minGapDays, Export CSV (customers with VinSolutions-friendly
   columns: First, Last, Phone, Email, Year, Make, Model, Trim, Sale Date, Referred By,
   Email Consent, Email Consent Date, SMS Consent, SMS Consent Date, Status, Notes),
   and a second CSV of touches+replies.

Public route: `/?u=TOKEN` → unsubscribe page (no login); writes optouts doc;
shows a two-sentence goodbye.

Performance: render from localStorage cache before any network call; total HTML
under 400 KB; no web fonts; no images beyond inline SVG.
