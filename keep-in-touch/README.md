# North Star Car Guy · Keep In Touch

Post-sale referral and repeat engine for Mick Knies (North Star Car Guy, selling
at Mosaic Autos, Zumbrota MN). Enter a customer once; the app drafts a note in
Mick's voice every 90 days, picks the right message for the season and the
touch number, logs replies, and tracks referrals and repeat purchases.

**Brand:** everything customer-facing signs off *Mick / North Star Car Guy /
phone*. Mosaic Autos appears only in the email footer as the physical location,
worded so it is clear Mick sells there and does not own it.

## The deliverables, in the order the build prompt asked for

| # | Agent | Deliverable | Where |
|---|---|---|---|
| 1 | Architect | Data model, provider choice and cost, security model, straight talk on constraints | `docs/01-architect.md` |
| 2 | Cadence engine | The rule that picks each message, worked example, tests | `docs/02-cadence.md`, `netlify/functions/lib/engine.js`, `test/engine.test.js` |
| 3 | Copy | 52 email/text template pairs (incl. 4 one-time asks), edit guide | `templates.json`, `docs/03-copy-guide.md`, `test/lint-templates.js` |
| 4 | Compliance | Consent model, footer, opt-out rule, dealership approval one-pager (launch gate) | `docs/04-compliance.md`, `netlify/functions/lib/compliance.js` |
| 5 | Inbox and attribution | Reply capture (two tiers), referral tracking, reply rate by slot and template | `docs/05-inbox-attribution.md`, `netlify/functions/inbound.js`, `netlify/functions/lib/stats.js` |
| 6 | Auditor | Pass/fail table, fixes, what could not be verified | `docs/06-audit.md`, `test/audit.js` |
| 7 | Builder | How the single-file app is put together | `docs/07-builder.md`, screenshots in `docs/screens/` |

## The files

```
index.html                    the whole app (one file, no build step, no CDN)
manifest.json                 tiny second file so the app installs on a phone (flagged: it is a second file)
templates.json                the message library (also inlined inside index.html)
firestore.rules               paste into Firebase console; only Mick's UID can read or write
netlify.toml                  Netlify config: functions, daily schedule, security headers
netlify/functions/send.js     sends one email through Resend; requires the x-kit-secret header
netlify/functions/daily.js    Tier 2: 9:00 AM Central auto-send with heartbeat
netlify/functions/inbound.js  Tier 2: Resend inbound webhook, logs replies, honors STOP
netlify/functions/lib/        engine.js, compliance.js, stats.js, firestore.js (shared code)
DEPLOY_CHECKLIST.md           click-by-click deploy, no terminal
SPEC.md                       the shared spec the agents built against
test/                         every check, runnable with plain `node`
```

## Run the checks

```
node test/engine.test.js
node test/compliance.test.js
node test/stats.test.js
node test/functions.test.js
node test/inbound.test.js
node test/lint-templates.js
node test/build-check.js
node test/audit.js
```

## Two tiers

- **Tier 1 (day one):** open the app, Today's Queue has everything due,
  drafted. Approve All sends the emails. Send as Text opens Messages on your
  phone with the short version. Nothing sends without a tap.
- **Tier 2 (opt-in):** the daily function sends due emails at 9:00 AM Central
  and writes a heartbeat; the app shows a red banner if it has not run in 36
  hours. Texts are never automated.

### First message for everyone

The first note anyone gets is a thank-you that ends by asking whether it is
okay to keep sending seasonal notes. If a customer ticked a consent box at
the sale, that is the THANKS note three days later. If they have **no consent
on file**, including past customers you have not asked yet, leave both boxes
unticked and the queue drafts a one-time **Ask to keep in touch** instead:
thanks for the vehicle they bought back in that year, your number, one plain
reason the notes exist, and a question they can answer with one word. Send
Email works (CAN-SPAM opt-out model, full footer and unsubscribe; never
auto-sent), Send as Text is your call from your own phone (it carries the STOP
line). After that nothing else drafts until you tap **They said yes** on their
timeline (or paste a yes into Log a reply, or the inbox sees a plain yes by
email), which starts the normal cadence 90 days later. **They said no** or a
STOP marks them do-not-contact. "Not now" hides the ask for 90 days.

## Launch gate

`docs/04-compliance.md` is the one-page summary for Mosaic Autos' manager.
Nothing goes live to real customers until it is signed.

## The five lines

1. **Placeholder:** the Mosaic Autos street address in Settings starts as `[VERIFY]`, the UID in `firestore.rules` is `PASTE_YOUR_UID_HERE`, and the `<meta name="kit-firebase">` tag at the top of `index.html` is empty until you paste your Firebase project ID and web API key (the customer-facing unsubscribe page needs it).
2. **Needs your eyes:** the dealership approval one-pager in `docs/04-compliance.md` (launch gate), the Minnesota statute list in it (have a lawyer read it), and every THANKS template before it goes out, since touch 0 is the one you personalize.
3. **Deliberate deviation:** after a late send the next touch keeps the original 90-day cadence but never lands sooner than 21 days later (Settings → minGapDays), so nobody gets two notes in one week after a long gap.
4. **Not verifiable without your accounts:** a real Resend send, Firebase sync, the 9 AM scheduled run, the inbound webhook, and drag-and-drop bundling of the functions folder. `docs/06-audit.md` §3 gives a five-minute check for each. Git-connect deploy is the safe path.
5. **Most likely to break first:** Resend's unverified sending domain. Until `northstarcarguy.com` shows Verified in Resend, email only delivers to your own Resend login address, and the Netlify build log is where you'll see it.
