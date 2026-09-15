# 07 — Builder notes (Agent 7): `index.html`, `manifest.json`

Files owned: `index.html`, `manifest.json`, `test/build-check.js`,
`test/smoke.playwright.js`, `docs/screens/*.png`, this file.

## How the file is organized

`index.html` is one file, no build step, no external resources (no CDN, no
web fonts, no images beyond inline SVG data URIs). Top to bottom:

| Section | What |
|---|---|
| `<head>` | viewport, `theme-color`, manifest link, inline SVG favicon + apple-touch-icon, the `kit-firebase` meta tag (see below), all CSS. |
| `<body>` shell | header (title + sync chip), banner strips, `<main id="view">`, bottom tab bar, toast. |
| `<script>/* <!-- BEGIN engine.js --> */ … /* <!-- END engine.js --> */</script>` | `netlify/functions/lib/engine.js`, verbatim → `window.KIT` |
| same for `compliance.js` (`window.COMPLIANCE`) and `stats.js` (`window.STATS`) | |
| `<script type="application/json" id="templates-json"><!-- BEGIN templates.json --> … <!-- END templates.json --></script>` | `templates.json`, verbatim; sliced between the markers at runtime before `JSON.parse`. |
| app script | sections 0–12, commented: utilities · codec · store · library · state/render · queue · add/edit · people/timeline · referrals · templates · settings · unsubscribe · boot. |

**`node test/build-check.js`** re-inlines the three libs and `templates.json`
from disk between the markers, verifies each inlined copy is byte-identical
(trimming exactly one leading and one trailing newline), syntax-checks every
inline script with `new Function(src)`, checks for external `src`/`href`
resources, and prints the size (limit 400 KB). `--check` verifies without
rewriting. Run it after any change to a lib or to `templates.json`.

**`node test/smoke.playwright.js`** (needs `playwright` on `NODE_PATH` and a
static server on :8787) opens the app at 375×812, walks every tab, adds a
customer whose thank-you is due today, logs a Copy-Text send, checks the
`sms:` link, the STOP line on the first text, `scrollWidth <= 375` on every
screen, zero console/page errors, and writes `docs/screens/01…08.png`.

Rendering: every user string goes through `esc()`; the `html` tagged
template escapes all interpolations unless wrapped in `raw()`/`html`. No
`eval`, no `innerHTML` with unescaped data. Clicks, inputs and submits are
delegated through `data-act` / `data-on-input` / `data-form` attributes. A
global `error` / `unhandledrejection` handler shows a toast.

## Data layer and offline behavior

One `store` object, two backends, one in-memory `db`
(`{customers, touches, replies, templates, settings, heartbeat}`).

- **local mode** (default until Firebase is configured): everything lives in
  `localStorage["kit.db"]`. The header shows the amber chip "Local only — not
  synced". The whole app works with zero setup.
- **firebase mode** (when `kit.firebase` in localStorage has `apiKey` +
  `projectId`): Firebase Auth REST (`accounts:signInWithPassword`; refresh via
  `securetoken.googleapis.com/v1/token` when the id token is older than
  50 min; a 401 triggers one forced refresh and retry) and Firestore REST
  (`GET` list with `pageSize=300` + `pageToken` paging, `PATCH` to set, `PATCH`
  + `updateMask.fieldPaths` to update, `DELETE`). The codec is a verbatim copy
  of `encode`/`decode` from `lib/firestore.js`.
- **Cache first.** The app always paints from `kit.db` before any network call,
  then (firebase mode, signed in, online) pulls every collection, re-applies
  any queued writes on top so an older server copy never overwrites an unsynced
  local edit, and re-renders.
- **Outbox.** Every write goes to `db` + cache immediately and, in firebase
  mode, into `localStorage["kit.outbox"]` (one entry per path; later writes to
  the same path replace earlier ones). The outbox flushes on save, on `online`,
  on tab focus and on boot. Network failures stop the flush and keep the rest;
  a permanent 4xx (rules rejection) drops that one entry and shows the error
  so the queue can never wedge.
- **Offline strip.** Amber "Offline — showing saved copy" when
  `!navigator.onLine` or a fetch fails; it clears on the next successful call.
- Other keys: `kit.firebase` (config, pre-login boot), `kit.auth`
  (uid/email/idToken/refreshToken/issuedAt), `kit.library` (imported
  templates), `kit.ui` (last tab, sender toggle, preview customer).

### Local → Firebase migration

Settings → Firebase: enter Web API key, Project ID, email, password. The button
reads **Connect & migrate local data (N)** when local data exists. On sign-in
the app pushes every local customer/touch/reply/template override plus
`settings/main` into the outbox, switches to firebase mode, loads the server
copy, re-applies the outbox on top and flushes. Nothing is deleted locally.

### Unsubscribe page and the meta tag (must fill in)

`/?u=TOKEN` (20–64 chars of `[A-Za-z0-9_-]`) renders a bare page: "You're off
the list." plus the goodbye-01 body (with `{first}` stripped) and POSTs
`documents/optouts?documentId=TOKEN&key=API_KEY` with exactly
`{at, source:"link"}` and no auth header (matches `firestore.rules`).

**A customer's phone has no localStorage for this site**, so the page gets the
Firebase config from the meta tag near the top of `index.html`:

```html
<meta name="kit-firebase" content='{"apiKey":"","projectId":""}'>
```

Fill in both values (the same ones you type in Settings) before the first real
send, or the unsubscribe link will show the goodbye page but never record the
opt-out. In local mode (no config anywhere) the page still shows the goodbye.
On boot and whenever the Queue renders (throttled to once a minute), firebase
mode lists `optouts`, flips the matching customer to `dnc`
(`reason: "unsubscribe link"`, `channel: "email"`) and deletes the optout doc;
unmatched tokens are deleted too.

## How the engine is called

- Queue = `KIT.extraQueueItems()` (REFERRAL_THANKS first) + `KIT.buildQueue()`.
  Per item: `templatePool(LIBRARY, overrides, slot, item.season)` →
  `pickTemplate(pool, usedTemplateIds, customerId + ':' + dueDate)` (same seed
  as `daily.js`, so app and job pick the same template for the same touch) →
  `render(tpl, customer, settings, {sender, firstText: !firstTextSentAt,
  season, date})`. The email textarea holds body + sign-off; the compliance
  footer (`COMPLIANCE.emailFooter(settings, siteUrl + '/?u=' + token)`) is
  shown under it and appended on send. `r.missing` → "Fill in: …" warning;
  `[VERIFY …]` is highlighted and blocks Approve All for that card.
- First channel on a card creates the touch doc (`status: sent`, channels
  `['email']` or `['sms']`, `sentBy` = sender toggle, subject/emailBody/textBody
  as edited, `providerId` from Resend) and applies `{type:'sent', n, dueDate,
  slot, carried, channels, sentDate, sentAt, templateId, minGapDays, touchId}`
  (or `{type:'sentExtra', …}` with `touchN: -1` for REFERRAL_THANKS). A second
  channel on the same card updates the same touch doc and stamps
  `firstTextSentAt` if the text was second. The card stays on screen as a
  "sent" card until you tap Done, so you can email and then text.
- Send as Text is a real `<a href="sms:+1NNN?&body=…">` whose href updates as
  you edit the text; tapping it logs the touch and opens Messages. Copy Text
  copies and logs the same way. The app never sends a text itself.
- Skip → `{type:'skipped', n, dueDate, slot}` + touch doc `status: skipped`
  (extra items: `pendingThanks` cleared directly, engine has no event for it).
  Snooze → `{type:'snoozed', days: 7, today}`.
- Add customer with Referred by → `attributedTouchId =
  STATS.suggestAttributedTouch(referrerId, touches, today)` and
  `{type:'referralReceived', date, referredName}` applied to the referrer.
- Log a phone call → replies doc `{channel:'phone', source:'manual',
  snippet:'Phone call'}` attributed via `STATS.attributeReply`, then
  `{type:'reply', date, at}`. Log a reply → same, unless
  `KIT.isOptOutText(text)`, which confirms and applies
  `{type:'optOut', reason:'STOP reply', channel, at}` and drafts the GOODBYE note
  on the timeline (email button through the send function, or an `sms:` link).
- Timeline "Send next note now" pins that customer's next touch into the queue
  even if it is not due yet (the DEPLOY_CHECKLIST first-run test).

## Placeholders / things Mick must fill in

- `<meta name="kit-firebase">` (above).
- Settings: phone, from email (must match `MAIL_FROM`), reply-to, **physical
  address** (default `[VERIFY] Mosaic Autos, street address, Zumbrota, MN
  55992` — the footer prints whatever is there), site URL, send secret.
- `manifest.json` is the one extra file (flagged): name "North Star Car Guy",
  short name "NSCG", SVG data-URI icons, standalone, black theme. No service
  worker, by design (the app is one file and caches its data itself).

## Known limitations

- localStorage is the cache: a few hundred customers with full timelines is a
  few MB, fine; tens of thousands would not be. Browsers can clear site data;
  in firebase mode that only costs a re-sync.
- Offline conflict resolution is last-write-wins per document (the outbox
  re-applies on top of the server copy on load). Two devices editing the same
  customer offline at the same time will keep whichever syncs last.
- Firestore list calls pull whole collections (no incremental sync). At Mick's
  volume that is a few hundred KB per open.
- The unsubscribe page cannot verify the token belongs to anyone; a bogus
  token creates an orphan optout doc that the app deletes on next open.
- Clipboard copy needs a user tap (browser rule); the legacy `execCommand`
  fallback covers older WebViews.
- Test send goes through the send function with a synthetic customer and is
  not logged as a touch.
- No dark mode: the palette is fixed black/white/magenta by spec.

## Lib gaps worked around (not edited)

1. `engine.js` has no `{referred}` placeholder even though `templates.json`
   declares `{referred|…}` and all three REFERRAL_THANKS templates use it. The
   app substitutes `{referred|fallback}` with `pendingThanks.referredName` (or
   the fallback) before calling `KIT.render`. `daily.js` never sends
   REFERRAL_THANKS, so only the app is affected. Suggest adding `referred` to
   `placeholderValues` (from `opts.referredName`) in a later engine version.
2. No engine event clears `pendingThanks` for a skipped REFERRAL_THANKS; the
   app sets `pendingThanks = null` directly.
3. `KIT.applyEvent` ignores `lastSentAt` unless `event.sentAt` is passed; the
   app passes it (as `daily.js` does).

## Assumptions

1. Template seed is `customerId + ':' + dueDate` (matches `daily.js`), not the
   touch number, so app and job agree.
2. The email textarea shows body + sign-off; the footer is appended on send
   and stored in `touch.emailBody` as sent (same as `daily.js`).
3. Copy Text counts as a text send and logs `channels: ['sms']`, per the build
   brief; if Mick copies but never sends, he can Skip nothing (the touch is
   already logged) — he should use Snooze if he is unsure.
4. `sentBy` on hand sends is the Mick/Ella toggle value; the toggle defaults to
   `settings.senderMode` and is remembered per device.
5. Deleting a customer also deletes their touches and replies (the compliance
   doc says "the timeline goes with it"). Optout docs are never re-created.
6. Timeline opens clear `unreadReplies` (written to the customer doc).
7. Editing a customer's sale date before any touch was sent also moves
   `anchorDate`; after sends it leaves the anchor alone.
8. Repeat buyer: the form is pre-filled from the existing customer; contact
   fields, consent and birthday from the form overwrite the old ones; the
   engine's `repeatPurchase` event resets the cadence.
9. Referrals tab "Retire" writes the same override doc as the Templates tab.
10. Imported templates (`kit.library`) are per device and are not synced.
11. The one dollar figure in the UI is the TCPA note on the locked SMS toggle,
    as instructed; nothing customer-facing contains `$`.
12. Header/brand per Mick's 2026-09-15 change: "North Star Car Guy · Keep In
    Touch"; the Templates checker no longer warns on "North Star".
