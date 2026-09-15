# 06 — Audit (Agent 6): pass/fail, fixes, what Mick still has to check

Audited 2026-09-15 against the code as it sits in this folder. Brand per
SPEC §0 (Mick's 2026-09-15 change): the customer-facing brand is **North Star
Car Guy**; Mosaic Autos appears only in the footer as the physical location.
The build prompt's original "sign off as Mick at Mosaic Autos / never say North
Star Car Guy" rule is therefore superseded and is audited in its new form.

How to re-run everything (from `keep-in-touch/`, Node 22):

```
node test/engine.test.js && node test/compliance.test.js && node test/stats.test.js \
 && node test/functions.test.js && node test/inbound.test.js && node test/lint-templates.js \
 && node test/build-check.js && node test/audit.js
python3 -m http.server 8787 --directory . &   # plain server for the smoke + flow checks
node test/serve.js 8788 &                     # gzip server for the throttle check
NODE_PATH=/opt/node22/lib/node_modules node test/smoke.playwright.js
NODE_PATH=/opt/node22/lib/node_modules node test/audit.playwright.js
NODE_PATH=/opt/node22/lib/node_modules node test/perf.playwright.js
```

Result on 2026-09-15: engine 59/59 · compliance 91/91 · stats 32/32 ·
functions 29/29 · inbound 23/23 · lint PASS · build-check OK · audit 31/31 ·
smoke OK (8 screenshots) · browser flow 20/20 · perf OK.

## 1. Pass/fail table

Rows 1–14 are the build prompt's Agent 6 list; the rest are the extra checks
requested for this audit. "audit A" means section A of `test/audit.js`.

| # | Item | Result | Evidence |
|---|---|---|---|
| 1 | Every touch reachable, none permanently skipped | PASS | audit A: 5 customers × 4 years with random misses (20 %), skips (15 %), snoozes (10 %), replies, referrals; touch numbers 0..N each acted on exactly once, in order, for all 5 (10–16 touches each). A never-actioned touch stays in `buildQueue` for 400 straight days, oldest due date first, `daysLate` climbing. Late send keeps the original ladder subject to the 21-day floor (touch 6 lands on sale+540 exactly). |
| 2 | Timezone: sale Dec 31 | PASS | audit B: sale 2027-12-31 → touch 0 due 2028-01-03, not due on 01-02. |
| 3 | Timezone: sale Feb 29 | PASS | audit B: sale 2028-02-29 → touch 1 2028-05-29, touch 4 2029-02-23 = `ANNIVERSARY_REFERRAL` (anniversary year 1); preview ladder 03-03 / 05-29 / 08-27 / 11-25 / 02-23. |
| 4 | Date math independent of process TZ | PASS | audit B: same 10 results from child processes under `TZ=Pacific/Kiritimati` (UTC+14, verified offset −840), `Pacific/Pago_Pago` (UTC−11), `America/Chicago`, `UTC`; `todayChicago()` equals an independent `Intl` en-CA computation in the parent and in each child. |
| 5 | Send function rejects requests without the secret | PASS | audit C + functions.test: no header → 401, wrong secret (same length / different length / empty) → 401, GET and PUT → 405, server with no `KIT_SECRET` → 500; Resend `fetch` never called in any refused case; the one 200 case sends plain text (`html` absent) with `List-Unsubscribe`. |
| 6 | Firestore rules deny an unauthenticated read | PASS (textual) | audit F parses `firestore.rules`: catch-all `match /{document=**}` grants `read, write` only `if isMick()`; `isMick()` = `request.auth != null && request.auth.uid == "PASTE_YOUR_UID_HERE"`; no `if true`, no "any signed-in user" grant; the only non-Mick allow is `create` under `match /optouts/{token}` with `hasOnly(['at','source'])`, `hasAll`, `at is string ≤ 40`, `source == 'link'`, token 20–64 chars; optouts read/update/delete stay Mick-only. **No emulator in this sandbox** — see §3 for the 5-minute console check. |
| 7 | Opt-out flips instantly and blocks drafting | PASS | audit G: `applyEvent optOut` → `nextTouch` null, `buildQueue`/`extraQueueItems`/`previewTouches` empty, `canEmail`/`canText` false, pending referral-thanks dropped, consent summary shows "Do not contact (STOP reply, date)". Browser: reply "STOP" on the timeline → confirm → `status: dnc`, reply logged with `isOptOut: true` and linked to the sent touch, goodbye drafted, queue card gone, badge drops, Reactivate restores (audit.playwright). Engine and compliance agree on a 40-case corpus and the two detector code blocks are byte-identical. |
| 8 | Every template under the sentence limits | PASS | audit H + lint: all 48 emails ≤ 5 sentences, all 48 texts ≤ 2 (GOODBYE email exactly 2). |
| 9 | Every template ends in exactly one one-word-answerable question | PASS | audit H: exactly one `?` in every email and text and it is the last character (GOODBYE: zero). Lint additionally rejects "let me know / thoughts / how is …" closers and > 2 options. Human read in §4. |
| 10 | No banned phrase, dollar figure, or brand-name violation | PASS | audit H over subject+email+text of all 48: none of "just checking in / checking in / touching base / circling back / reaching out / reach out / I noticed you haven't / valued customer / at this time / premier", no superlative from SPEC §0, no `!`, no `$`, no digit outside "Hwy NN". "North Star Car Guy" is allowed per SPEC §0 (it is the brand). |
| 11 | Every email signs off as Mick | PASS | audit H renders all 48 × {mick, ella} with a sample customer: `emailFull` contains `\n\nMick\nNorth Star Car Guy\n(507) 555-0000\n\n--\n` (Ella: `Ella, for Mick\n…`), `missing` empty, no `[placeholder]` or stray brace in any output. `daily.js` scheduled email carries the same block (audit D). |
| 12 | Nothing implies Mick owns Mosaic | PASS | audit H: regex `\bmy (dealership\|lot\|store)\b\|\bowner\b\|\bwe at mosaic\b\|\bour (dealership\|lot\|store)\b` on all rendered emails/texts, footer, consent labels → 0 hits (after fixing value-any-01, §2). Footer reads "…Mick Knies, North Star Car Guy, selling at Mosaic Autos…" and ends "North Star Car Guy at Mosaic Autos · <address>". |
| 13 | Gas station test + kill question on every template | PASS after 4 fixes | §4: all 48 read; 4 failed and were rewritten; 3 borderline noted. |
| 14 | Renders correctly at 375 px | PASS | audit.playwright: `scrollWidth` = 375 on queue (empty/with cards), add, people, referrals, templates (VALUE open + preview table), settings, timeline, unsubscribe; including a queue card for "Bartholomew Vandenbergh-Kristiansen III" / "2019 Silverado 2500HD High Country" with the footer expanded. Zero console/page errors on load and every tab. smoke.playwright: 8 screenshots in `docs/screens/`. |
| 15 | Queue loads in under one second on a throttled connection | PASS | perf.playwright, gzip server (`test/serve.js`), cache disabled, 40 customers (3 due) pre-seeded in localStorage, median of 3: **Fast 3G (1.6 Mbps / 750 Kbps / 150 ms): first queue card in DOM 477 ms, DOMContentLoaded 503 ms, load 503 ms, first-contentful-paint 188 ms.** Slow 3G (400 Kbps / 400 ms): first card 1640 ms, load 1664 ms, FCP 484 ms (reported, not a gate). Wire size 61,687 B gzipped (220,715 B raw). Note: Chrome's emulation shows up in the transfer time (450 ms to receive 61.7 KB) but reports TTFB ≈ 11 ms; the first-card number is the honest end-to-end figure. |
| 16 | `daily.js` rejects `?force=1` with a wrong secret and never sends SMS | PASS | audit D: wrong/missing secret → 401, no Firestore write (not even the heartbeat), no Resend call. Forced run with one email-consent customer and one text-only customer: sent 1, skipped 1, the only network call is `POST api.resend.com/emails`, touch doc `channels: ['email']`, `sentBy: scheduled`; `daily.js` source has no `sms`/`twilio` path. Outside 9 AM Central: heartbeat written with `ranSend: false`, nothing sent. |
| 17 | `inbound.js` rejects a bad Svix signature | PASS | audit E: wrong signing key → 401; tampered body, stale timestamp (10 min), missing headers, wrong `x-kit-secret`, GET → 401/405; Firestore client never constructed on any refusal; a correctly signed payload reaches Firestore (200). |
| 18 | Inlined copies byte-identical | PASS | audit I runs `build-check --check`: engine.js, compliance.js, stats.js, templates.json inlined byte-identical; every inline script parses; 215.5 KB < 400 KB. |
| 19 | No external resources / no eval / innerHTML only through `esc()` | PASS | audit J: no http(s) `src`/`href`/`action`/`@import`/`url()`; the only `<link href>` is `manifest.json`; `fetch()` targets are `/.netlify/functions/*` and `*.googleapis.com` only; no `eval(`, `new Function(`, `document.write`, `insertAdjacentHTML`, `outerHTML=`, `srcdoc`, string timers. Exactly one `innerHTML =` in the app (`setHtml`, which escapes anything not wrapped by `raw()`); every `raw()` call site takes a literal, a `part()`/`esc()`-built string, or the constant month/day/tab tables. No raw-string `innerHTML` takes user data. |
| 20 | `templates.json` meets SPEC §5 minimums with direct/softer/nepq in each pool | PASS | audit K: THANKS 4, THANKS_REPEAT 2, VALUE 4×4 seasons + 3 any, CHECKIN 6, REFERRAL 6, ANNIVERSARY_REFERRAL 3, BIRTHDAY 3, REFERRAL_THANKS 3, GOODBYE 2 = 48 unique ids; every pool of 3+ has all three tones; lint-templates PASS. |
| 21 | Tap flow (add → THANKS → Send as Text → Copy Text → STOP → DNC → Reactivate) | PASS | audit.playwright: `sms:+15075551234?&body=…`, body names Dan and "2019 Silverado", one `?`, no `!`, ends "Reply STOP to opt out."; email draft ends with the sign-off block and the footer (with `/?u=` link) is shown under it; Copy Text writes touch `{status: sent, channels: [sms], touchN: 0, slot: THANKS}`, `nextTouchN` → 1, `firstTextSentAt` stamped; then row 7. |
| 22 | Unsubscribe page `/?u=<32 chars>` renders without login | PASS | audit.playwright in a fresh context with no localStorage: "You're off the list." renders, no tab bar, no password field, no question, no `!`, scrollWidth 375. |
| 23 | Engine gaps closed (`{referred}` placeholder, `skippedExtra` event) | PASS | engine.test (4 new tests): `{referred|fallback}` fills from `opts.referred`/`opts.referredName`/`customer.pendingThanks.referredName`, fallback when unset, visible `[referred]` + `missing` when no fallback; `skippedExtra` clears `pendingThanks` only (no `lastSentDate`, no floor, `referralCredit` kept, cadence untouched) vs `sentExtra` which applies the floor. App now calls both (`index.html` §5). |

## 2. What was fixed

| File | Change |
|---|---|
| `netlify/functions/lib/engine.js` | `render()` fills `{referred}` / `{referred\|fallback}` (from `opts.referred`, `opts.referredName`, or `customer.pendingThanks.referredName`); new `applyEvent` type `skippedExtra`; placeholder docs added to the header comment; `VERSION` 1.1.0. |
| `test/engine.test.js` | 4 tests for the above (59 total). |
| `index.html` | Removed the `withReferred()` workaround; REFERRAL_THANKS cards call `KIT.render(..., {referred})`; Skip on a REFERRAL_THANKS card applies `{type:'skippedExtra'}` instead of clearing `pendingThanks` by hand. Re-inlined libs + templates via `build-check`. |
| `docs/07-builder.md`, `SPEC.md` | "Lib gaps" section now says the gaps are closed; §4 contract lists `{referred}` and the `sentExtra`/`skippedExtra` events. |
| `netlify/functions/lib/compliance.js` | Header comment only: it still described the pre-2026-09-15 brand rule ("brand name never appears"). No code change; re-inlined. |
| `templates.json` | 4 copy fixes from the human review (§4): value-any-01, checkin-05, goodbye-02, anniversary-referral-01. Lint clean, re-inlined. |
| `docs/03-copy-guide.md` | ANNIVERSARY_REFERRAL editing note updated to match the new anniversary-referral-01 wording. |
| new `test/audit.js` | 31 mechanical checks (sections A–K above); zero deps; exits 1 on failure. |
| new `test/serve.js` | Static server with gzip (what Netlify does) for the throttle measurement. |
| new `test/perf.playwright.js` | Fast 3G / Slow 3G measurement via CDP `Network.emulateNetworkConditions`; gate: Fast 3G first card and load < 1000 ms. |
| new `test/audit.playwright.js` | The 375 px / no-horizontal-scroll / tap-flow / STOP → DNC → Reactivate / unsubscribe checks (20 assertions). |

Nothing was committed.

## 3. What could NOT be verified here, and how Mick verifies each in five minutes

1. **Firestore rules actually deny a stranger** (no emulator in this sandbox;
   the check above is textual). Firebase console → Firestore → Rules →
   **Rules Playground** (right side): Simulation type *get*, Location
   `/databases/(default)/documents/customers/anything`, Authenticated *off* →
   Run → must say **Denied**. Then *create* on
   `/databases/(default)/documents/optouts/abcdefghijklmnopqrstuvwxyz123456`
   with body `{"at":"2026-09-15T14:00:00.000Z","source":"link"}`, unauthenticated
   → **Allowed**; change `source` to `"x"` → **Denied**. Finally *get* on
   `customers/anything` with Authenticated *on*, provider Firebase, UID = your
   UID → **Allowed**; any other UID → **Denied**. (Only works after you replace
   `PASTE_YOUR_UID_HERE`.)
2. **A real Resend send** (all Resend calls here were mocked). Settings →
   *Send a test email to myself* → it should land in your inbox from
   `MAIL_FROM` with Reply-To = your Gmail and an unsubscribe link in the
   footer; click the link on your phone → the page says "You're off the list."
   and, in Firestore, an `optouts/<token>` doc appears; open the app → it is
   gone and nothing was flipped (the test send uses a synthetic customer).
3. **Firebase Auth REST + Firestore REST from the app** (mode "firebase" was
   not exercised; local mode was). Settings → Firebase → enter Web API key,
   Project ID, email, password → *Connect & migrate local data* → header chip
   should change from "Local only" to synced; refresh the page on a second
   device and the customer is there.
4. **The scheduled function on real Netlify** (cron + 9 AM Central gate).
   After deploy: Netlify → Functions → `daily` → Logs; the next day after
   09:00 Central, Settings → Heartbeat should show "last run <today> 9:0x AM,
   ranSend true". To test right now without waiting: in a terminal-free way,
   open `https://<site>/.netlify/functions/daily?force=1` in a browser with a
   header-setting extension sending `x-kit-secret`, or ask a developer to run
   `curl -H "x-kit-secret: <secret>" "https://<site>/.netlify/functions/daily?force=1"`.
   Without the secret it must return 401 (that part is tested here).
5. **Inbound webhook with a real Svix signature from Resend.** Resend →
   Webhooks → Send test event `email.received` → Netlify function log shows
   200; a wrong secret in `RESEND_WEBHOOK_SECRET` must show 401.
6. **Drag-and-drop deploy bundling `require('./lib/x.js')`** (architect's
   assumption). After a drag-and-drop deploy, open
   `https://<site>/.netlify/functions/send` in a browser: 405 with the JSON
   error means the function loaded; a 500 mentioning `Cannot find module`
   means the lib folder was not bundled and the GitHub-connected deploy path
   in `DEPLOY_CHECKLIST.md` should be used instead.
7. **Real phone `sms:` behavior.** The href is right (`sms:+1…?&body=`), but
   iOS and Android differ on the `?&body` form; tap Send as Text once on your
   own phone and confirm Messages opens pre-filled.

## 4. Template review — gas station test and kill question

All 48 read out loud. Standard: would Mick say it to a neighbor at the gas
station, and could any dealership anywhere have sent it.

**Failed → fixed**

| Template | Offending line | Fix |
|---|---|---|
| value-any-01 | "since the owner's manual is buried in the glovebox" — tripped the ownership regex (`\bowner\b`) and is the one word in the library that could be misread in a footer-adjacent context | "since the book that came with it is buried in the glovebox" |
| checkin-05 | "this fall has been a good test for anything with four wheels … Has it been treating you right?" — the "hope you're enjoying your vehicle" family; any dealer could send it | "the roads around Zumbrota do not go easy on anything with four wheels, and {hook} has had a whole {season} to work on the {vehicle}. … Did the {vehicle} come through this {season} without a complaint?" (text matches) |
| goodbye-02 | "I hope the {vehicle} keeps treating you right." — generic well-wish, fails the kill question | "if a dash light ever comes on in the {vehicle} that you cannot read, my number still works." (still 2 sentences, no question) |
| anniversary-referral-01 | "I still remember the day it went home." — a claim any dealership makes and, unedited, untrue on the page | "and it does not feel like a year." + editHint tells Mick where to drop the real memory |

**Borderline, left as-is (with the reason)**

- birthday-01 "Hope the {vehicle} gets you somewhere good today." — a
  well-wish, but on a birthday note with "nothing attached, I just remembered"
  around it, it reads as Mick, not a mailer. Kept.
- birthday-03 "Another year older means another year of knowing more than you
  did, which in my experience is the whole point." — slightly greeting-card;
  passes the gas station test because of "in my experience". Kept.
- checkin-01 / checkin-02 close with "Still running good?" / "Any
  complaints?" — generic questions, but the first sentence names the vehicle
  and the hook road, which is what the kill question needs. Kept; the
  editHints already tell Mick to fill the hook.

**Passed cleanly (no notes):** thanks-01..04, thanks-repeat-01..02, all 16
seasonal VALUE (every one names Hwy 52/58, Zumbrota, the Zumbro valley,
Rochester, Lake Pepin, or "my own truck" and gives a real checklist),
value-any-02/03, checkin-03/04/06, referral-01..06 (each names one specific
person and says no is fine), anniversary-referral-02/03, referral-thanks-01..03
(thank-you with nothing attached, no second ask), goodbye-01.

## 5. Known limitations that stay

- Firestore rules are verified textually only; the console Rules Playground
  (§3.1) is the real gate before go-live.
- The throttle numbers are Chrome DevTools emulation on a fast machine, not a
  real phone on a real tower; Slow 3G is over one second (1.6 s) and stays so
  because 61.7 KB gzipped at 400 Kbps is 1.2 s of transfer alone. Trimming
  would mean shipping templates.json separately, which breaks the one-file
  deploy; not worth it for a case the prompt does not gate on.
- `isOptOutText` is deliberately strict (see engine.js comment): "please take
  me off your list" matches, "no thanks" does not, so a soft opt-out still
  needs Mick's tap on Do not contact.
- Local (localStorage) mode is what the browser checks exercised; Firebase
  mode shares every render path but its network layer was not run here.
- The `[VERIFY]` address placeholder in Settings prints into the footer until
  Mick replaces it; the queue card highlights it and Approve All refuses that
  card, but a hand send is still possible.
- Two devices editing the same customer offline resolve last-write-wins
  (documented in 07-builder.md).

## 6. Post-audit change (2026-09-15): the one-time ask

Mick decided after the audit that the first message for everyone, including
past customers he has not asked yet, is a thank-you note that ends by asking
whether it is okay to keep sending seasonal notes. Before this change the app
drafted a THANKS card for an unconsented customer and greyed out both send
buttons, a dead end. What changed: engine 1.2.0 (`consentState`, slot ASK,
events `sentAsk` / `consentGiven` / `consentDeclined` / `askSkipped`,
`isYesText`), compliance 1.1.0 (`canAskByEmail`, `canAskByText`, `ASK_RULE`,
"Not asked yet" / "Asked … · waiting" in the summary, two new how options),
four ASK templates (lint minimum 4, tone mix checked), the queue card, the
timeline "Waiting on their answer" panel, the People chips, the CSV columns,
an explicit `slot !== 'ASK'` guard in `daily.js`, and yes-reply handling in
`inbound.js`. The opt-out detector block was not touched; the byte-identical
check still passes.

| Check | Result |
|---|---|
| `node test/engine.test.js` | 69 passed, 0 failed (was 59; +10: ask due date old/new, asked → null, consentGiven → touch 1 at +90, consentDeclined → dnc, sentAsk fields, previewTouches, buildQueue include/exclude, isYesText, askSkipped, legacy THANKS-before-ask) |
| `node test/compliance.test.js` | 94 passed, 0 failed (was 91; +3: canAskBy*, summary strings, ASK_RULE) |
| `node test/stats.test.js` | 32 passed |
| `node test/functions.test.js` | 30 passed (was 29; +1: daily never sends an ASK, even with consent on file) |
| `node test/inbound.test.js` | 28 passed (was 23; +5: yes → consentGiven, non-yes, "yes unsubscribe me" → opt-out, yes from a consented customer, yes from a never-asked customer) |
| `node test/lint-templates.js` | PASS, 52 templates, ASK 4 (min 4) |
| `node test/build-check.js` | OK, 238.0 KB |
| `node test/audit.js` | 32 passed (was 31; +1: ASK pool + gates; detector byte-identical check still passes) |
| `test/smoke.playwright.js` | OK, 13 screenshots: add customer with both boxes unticked → "Ask to keep in touch" card with Send Email enabled → Copy Text logs an ASK touch → People shows "waiting" → They said yes (Email) → next is touch 1 VALUE in 90 days |
| `test/audit.playwright.js` | OK, 20 checks |

Still for Mick and the lawyer: the hand-sent text version of the ask is a
judgment call (docs/04-compliance.md, "The one-time ask to past customers").
