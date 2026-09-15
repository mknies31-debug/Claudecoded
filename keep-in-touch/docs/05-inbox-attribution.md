# 05 — Inbox & Attribution (Agent 5)

Files: `netlify/functions/inbound.js`, `netlify/functions/lib/stats.js`,
`test/inbound.test.js`, `test/stats.test.js`. Run `node test/stats.test.js` and
`node test/inbound.test.js` (no installs).

## Tier 1 — replies land in a Gmail inbox, Mick logs the good ones

Every email the app sends carries `Reply-To: <the dedicated Gmail address>`
(`MAIL_REPLY_TO`, also in Settings as `replyTo`). When a customer hits reply it
goes to that inbox, not to the sending domain. Nothing else is required.

Logging a reply from the app (Customer → Timeline → **Log a reply**):

1. Mick pastes the text (or just types "said yes, kid gets license in May").
2. The app writes `replies/{id}` with `channel: "email"` (or "sms" / "in person"),
   `source: "manual"`, `receivedDate` = today (editable), the pasted `snippet`
   (first 1000 chars, quoted lines stripped), and links it to the latest sent
   touch within 45 days (`STATS.attributeReply`), so the reply carries that
   touch's `slot` and `templateId`.
3. The app applies `KIT.applyEvent(customer, {type:"reply", date})` — the next
   touch moves to 90 days from the reply, snooze is cleared — and clears the
   badge for that customer.
4. If the pasted text starts with STOP / unsubscribe / etc.,
   `KIT.isOptOutText` fires: the app applies `optOut`, marks the reply
   `isOptOut: true`, and drafts the GOODBYE email for Mick to send (Tier 1 never
   sends on its own).

**Log a phone call** is one tap: writes `replies/{id}` with `channel: "phone"`,
`snippet: "Phone call"`, `source: "manual"`, `receivedDate: today`, attributes it
the same way, and resets the clock. A call counts as a reply for reply-rate math
because it is one: the customer engaged after a touch.

## Tier 2 — Resend delivers replies straight into the timeline

Resend setup (dashboard only, no terminal):

1. **Domains → your sending domain → Enable receiving.** Resend shows one MX
   record (`inbound.resend.com`, priority 10, or whatever the dashboard prints)
   to add at your DNS host. Wait for the domain to show *Receiving: Enabled*.
   Choose the inbox address, e.g. `replies@yourdomain.com`.
2. Set `MAIL_REPLY_TO` in Netlify to that inbox address (instead of Gmail) and
   put the same value in Settings → replyTo. From now on replies go to Resend.
   You can keep the Gmail address CC'd by adding a Resend forwarding rule if you
   want to read them there too; the app does not need it.
3. **Webhooks → Add webhook.** Endpoint URL:
   `https://<your-site>.netlify.app/.netlify/functions/inbound`. Tick only the
   event **`email.received`**. Save.
4. Open the webhook, click **Reveal signing secret** (it starts with `whsec_`),
   and paste it into Netlify → Site settings → Environment variables as
   `RESEND_WEBHOOK_SECRET`. Also required for this function:
   `RESEND_API_KEY` (to fetch the message body), `FIREBASE_PROJECT_ID`,
   `FIREBASE_SERVICE_ACCOUNT`, `MAIL_FROM`, `MAIL_REPLY_TO`, `SITE_URL`.
   Redeploy once so the function picks them up.
5. Test: send an email from a customer's address (or your own, after adding
   yourself as a customer) to the inbox address. Within a few seconds the app
   badge goes up by one.

What happens on each inbound (see the comment block at the top of `inbound.js`
for what was verified against Resend's docs and SDK, with URLs):

1. Non-POST → 405. The Svix signature (`svix-id`, `svix-timestamp`,
   `svix-signature`; HMAC-SHA256 of `id.timestamp.rawBody` with the base64 key
   after `whsec_`, compared with `crypto.timingSafeEqual`, timestamp within 5
   minutes) is checked → 401 on failure. A request carrying a matching
   `x-kit-secret` header is also accepted (the app's "forward this into the
   timeline" path and manual tests).
2. If a lib or env var is missing the function returns **500 with the exact
   name** so Resend keeps retrying until the deploy is fixed. After that, it
   always returns 200 so Resend never retries a message forever.
3. The `email.received` payload is metadata only, so the function calls
   `GET https://api.resend.com/emails/receiving/{email_id}` for `text` (or
   `html`, stripped to text). Quoted lines (`> ...`) and everything after
   `On ... wrote:` / `-----Original Message-----` are dropped; first 1000 chars
   become the `snippet`.
4. Sender address is lowercased and looked up: `customers` where `email ==`
   that address. **Unknown sender:** a `replies/` doc is written anyway with
   `customerId: ""` so nothing is lost (the app lists these under "Unmatched"
   so Mick can attach them to a customer or ignore them).
5. **Matched:** the reply is linked to the customer's latest *sent* touch with
   `sentDate <= receivedDate` and no more than 45 days earlier;
   `unreadReplies + 1`; `applyEvent reply` (clock reset).
6. If the subject or the first line of the snippet contains an opt-out word
   (`KIT.isOptOutText`: stop / unsubscribe / opt out / remove me / quit /
   cancel / end, whole word, first 80 chars), the customer is flipped to `dnc`
   (`reason: "STOP reply"`, `channel: "email"`) and **one** GOODBYE email is
   sent through Resend (template from the GOODBYE pool, rendered with the
   compliance footer, `List-Unsubscribe` headers, plain text). The goodbye is
   logged as a `touches/` doc with `slot: "GOODBYE"`, `touchN: -1` so it shows
   on the timeline without consuming a cadence number.
7. Duplicate deliveries (Resend retries with the same `email_id`; the reply doc
   id is `in_<email_id>`) are acknowledged with 200 and not re-applied, so a
   retry can never double-count `unreadReplies` or send two goodbyes.
8. Any error along the way is written into the reply doc's `error` field and
   logged to the Netlify function log; only a failure to write the reply doc
   itself returns 500 (so Resend retries instead of losing the message).

## Referral tracking

**Referred by** (Add Customer) is a picker over existing customers; it stores
`referredBy` (the referrer's id) and `referredByName` for display. When it is
set, the app auto-fills `attributedTouchId` with
`STATS.suggestAttributedTouch(referrerId, touches, today)`: the most recent
touch *sent* to the referrer in the 60 days before today, or `""` if there is
none. Mick can clear or change it. The moment a referral is saved the app also
applies `applyEvent referralReceived` to the referrer (immediate REFERRAL_THANKS
in the queue; their next REFERRAL slot becomes VALUE).

**Referrals tab** (all from `stats.js`, over the local cache):

- **Network list** — `referralsByCustomer`: each referrer with the people they
  sent, newest first, sorted by count. Tap a name to open the timeline.
- **Monthly table** — `monthly`: last 12 months, oldest to newest, columns
  *referrals* (referred customers by the month they were added), *repeats*
  (second and later `purchases[]` by sale month), *sent* (touches by sent month).
- **Referrals by slot** — `referralsBySlot`: `attributedTouchId → touch.slot`;
  anything unknown is "unattributed". This is the "which slot type actually
  produces referrals" view.
- **Reply rate by slot** — `replyRateBySlot`: sent touches vs. distinct touches
  that got at least one reply (email, text, phone or in person). A reply with no
  `touchId` is attributed to the latest sent touch on or before it within 45
  days; later than that it counts as nobody's.
- **Reply rate by template** — `replyRateByTemplate`: same, per template id,
  with `retire: true` when a template has been sent **8 or more times** and
  fewer than **5%** replied. The tab shows a "retire?" chip; retiring is still a
  manual toggle on the Templates tab, because Mick may know why a template
  underperformed (wrong season, one bad batch).

The dashboard strip on the Queue screen uses `summary(customers, touches,
replies, today, {engine: KIT})` → active, dnc, dueToday, sentLast30,
repliesLast30, referralsLast90, repeatsLast365.

## What "which slot produces referrals" means, and its limits

`attributedTouchId` says: *the last thing Mick sent this referrer, within 60
days before the new customer walked in, was a REFERRAL / VALUE / CHECKIN
note*. That is a last-touch, time-window attribution. It is correlation, not
proof:

- A referral often comes from a conversation that has nothing to do with the
  latest email. The touch gets credit for being nearby in time.
- If Mick sent nothing to the referrer in 60 days the referral is
  "unattributed" — which is itself useful: it tells him referrals happen even
  without a recent nudge.
- With a few hundred customers and ~4 touches a year, counts per slot will be
  small for a long time. Treat a slot as "working" only when it wins over
  several months, not one.
- Reply rate is a cleaner signal than referrals-by-slot because a reply is
  directly caused by the touch. Use reply rate to retire copy; use
  referrals-by-slot to decide whether the REFERRAL ask is worth its 25%.

## Assumptions

- resend.com and docs.svix.com were blocked from the build sandbox; the event
  name, metadata-only payload, `GET /emails/receiving/{id}` response shape and
  the Svix/Standard-Webhooks signature scheme were verified from the official
  `resend/resend-node` SDK source and `resend/resend-skills` doc mirror (URLs in
  `inbound.js`). Dashboard click paths above are from the same sources and
  general Resend UI; button labels may differ slightly.
- `lib/firestore.js` `runQuery`/`list` return `{ id, data }` rows and `get`
  returns `null` on 404 (checked against Agent 1's file); `inbound.js` flattens
  rows to `{ id, ...data }` and also accepts flat docs, so either shape works.
- The reply doc id is `in_<email_id>` for webhook mail (idempotent retries) and
  a 20-char random id for manual forwards.
- Missing lib/env → 500 (retry) is a deliberate deviation from "always 200
  after signature passes"; it only applies to deploy misconfiguration.
- GOODBYE send is logged as a `touches/` doc with `touchN: -1`, `sentBy:
  "scheduled"`. The engine ignores touches when computing the queue, so this
  cannot disturb the cadence.
- Reply attribution window is 45 days; referral attribution window is 60 days
  (`STATS.REPLY_WINDOW_DAYS`, `STATS.REFERRAL_WINDOW_DAYS`).
- `monthly` uses the referred customer's `createdAt` (converted to a Chicago
  calendar date) as the referral month, falling back to `saleDate`.
- `summary.dueToday` needs the engine; when neither `opts.engine` nor
  `opts.dueToday` is supplied and no `KIT` is reachable it reports 0.
- The GOODBYE email goes to the address that replied (the customer's stored
  email); only email is sent — a text STOP is handled by Mick in Messages and
  logged as an opt-out from the timeline.
- Opt-out detection scans the subject and the first line of the de-quoted body
  only, so "reply STOP to opt out" in quoted text never trips it.
