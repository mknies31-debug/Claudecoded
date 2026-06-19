# North Star Referral CRM

A dead-simple referral engine for Mick at North Star Car Guy. It lives **inside**
CARVIS (the command center) under the **⇄ REFERRALS** button. You add a customer
once; it handles the timed follow-ups from there — auto-emails on a schedule, and
one-tap **texts** it hands you to fire by hand.

No new app to learn, no spreadsheet, no separate login. It rides the same Data
Sync you already use, so home and work stay in step.

> **Going live?** Follow **[`GO-LIVE.md`](GO-LIVE.md)** — the step-by-step setup
> checklist (deploy, keys, sync, copy, cron test, real-device test).

---

## Add a customer — three ways
**The only things you ever have to give are a NAME and a PHONE NUMBER.**
Everything else (vehicle, email, address, notes, purchase date) is optional —
skip it now, fill it in later.

**1. By voice — "enter customer"**
Say it to the mic (🎙) or type **enter customer** in the command bar. CARVIS asks
you the questions one at a time — name, phone, car, email, address, anything else
— and you just talk back. Say **"skip"** for anything you don't have. When it's
done it shows you the filled-in card to check over before saving.

**2. From a photo**
Tap **⇄ REFERRALS → ＋ Add Customer → 📷 From a photo**. Snap or upload a
driver's license, business card, buyer's order, or even a handwritten note.
CARVIS reads it, pulls out the name, phone, address, email, and vehicle, and
drops them into the form for you to check. *(Needs `ANTHROPIC_API_KEY` set — the
same key that powers Ask CARVIS.)*

**3. By hand**
Tap **⇄ REFERRALS → ＋ Add Customer**, type the name and phone, add whatever else
you've got, pick **Referred by** if someone sent them in, and tap **◉ ADD
CUSTOMER**.

Voice and photo both end at the same review form, so you always get a chance to
fix anything before it saves. Once saved, they're on the follow-up timeline.

---

## The Daily Ops dashboard (what you actually look at)
Open **⇄ REFERRALS → ◉ Daily Ops**:

- **Emails Sent Today** — the automated emails the daily run cleared for you.
- **Held (need copy)** — emails the system *would* have sent but is holding until
  your real wording is in (see "Turning on auto-emails" below).
- **Texts Sent Today** — texts you fired from here today.
- **⚑ Referral Loop — Close It** — when a customer was referred by someone already
  on file, you get a high-priority card to send that person a personal thank-you.
  Tap **✎ Text**, or **⎘ Copy**, then **✓ Marked thanked** to clear it. This one is
  deliberately *not* automated — a referral thank-you should come from you.
- **✆ Texts Ready to Send** — every customer who's due for a text. Pick the tone
  (**Direct / Softer / NEPQ**) from the dropdown, then either:
  - tap **✆ One-tap text** — opens your phone's Messages with the number and the
    message already filled in, or
  - tap **⎘ Copy text** to paste it wherever you like.
  Tap **✓ Mark sent** to clear it from the queue (it's logged).
- **⏱ Stagnant 7+ Days** — anyone who's been stuck in the same step for over a
  week, so nobody falls through the cracks.

### Opting someone out (compliance)
On the **≣ Pipeline** tab, tap **⓪ Opt out** on a customer. That instantly freezes
*everything* for them — no auto-emails, and they disappear from the text queue.
Tap **↺ Re-enable** to undo.

---

## How the follow-up timeline works
Five windows, measured from the purchase date:

| Window | When | Channels |
| --- | --- | --- |
| Welcome / Delivery | day 1 | email + text |
| Two-Week Check-In | day 14 | text |
| Referral Ask | day 45 | email + text |
| Service Reminder | day 180 | email |
| One-Year Anniversary | day 365 | email + text |

Once a day a background job ("the daily run") looks at everyone, finds who's due,
**sends the emails**, **queues the texts** for you, and moves each customer one
step forward. You can change the windows or wording in `shared/sequences.mjs` and
`shared/templates.mjs`.

---

## Turning on auto-emails (the copy switch)
Out of the box, **auto-emails are HELD** — the system runs but holds every email
instead of sending, because the message copy is placeholder text until you supply
your real wording. To go live:

1. Edit `shared/templates.mjs` — replace the placeholder copy with yours. Keep the
   rules: texts ≤ 3 sentences, emails ≤ 6 sentences, **no money/price/trade/credit
   talk**, no exclamation marks. (`npm test` will fail if a template breaks a rule.)
2. In that same file, set `export const APPROVED = true;`.
3. Redeploy. Auto-emails now send on the daily run.

Texts never need this — they're always hand-fired, so the queue works from day one.

---

## What needs to be set up once (deploy + env)
See `DEPLOY.md` for the full deploy. The CRM specifically needs:

| Variable | Why |
| --- | --- |
| `CRM_SYNC_KEY` | the **same** private key you set under ⇅ SYNC, so the daily job can find your data |
| `RESEND_API_KEY`, `MAIL_FROM`, `MAIL_REPLY_TO` | so auto-emails can actually send |

Set your sync key in the app (⇅ SYNC) first, then add that exact string as
`CRM_SYNC_KEY` in Netlify. Without it the daily job safely does nothing.

You can test the daily job by hand any time: `POST /.netlify/functions/daily-runner`.

---

## Swap the email provider (Resend → MailerLite or anything)
Email is behind a clean gateway, so switching vendors is a config change, not a
rewrite.

- **To MailerLite:** set `EMAIL_PROVIDER=mailerlite` and `MAILERLITE_API_KEY` in
  Netlify. MailerLite sends through automations rather than ad-hoc HTML, so the
  provider upserts the subscriber and stamps a field; set up a MailerLite
  automation that fires on that field. Code is in
  `netlify/functions/_lib/email-provider.mjs` (`MailerLiteProvider`).
- **To a brand-new provider:** add a class in that same file with one method —
  `async send({ to, toName, subject, html, text })` — and return `{ ok, id }`.
  Register it in `getEmailProvider()`. The engine and UI don't change at all.
  `npm test` includes a provider-swap test that proves the loop still behaves.

## Swap the data store (Blobs → Firestore)
Today the CRM stores data in the same Netlify Blob your sync already uses. To move
to Firebase/Firestore, reimplement the one gateway file
`netlify/functions/_lib/store.mjs` (same `openStore()` shape: return `customers`,
`touchLogs`, `meta`, and a `save()`), and have the browser write to Firestore in
`crm/crm.js` instead of localStorage. Nothing in `shared/` changes — the schema
and rules are storage-agnostic by design.

## Later: real automated SMS (direct-to-carrier)
Texts are **queued, never auto-sent** on purpose — programmatic SMS needs stored
opt-in consent to be compliant. When you're ready and you're capturing consent:

1. Add a `smsConsent` (and consent timestamp) field to the customer — capture it
   on the Add form and store it like any other field in `shared/schema.mjs`.
2. Add an `SmsProvider` gateway next to the email one
   (`netlify/functions/_lib/sms-provider.mjs`) with `send({ to, body })` for your
   carrier/Twilio.
3. In `shared/engine.mjs`, change the text branch so that **only when
   `smsConsent === true`** it calls the SMS provider (mirroring the email branch:
   send → log `touch_log` → advance) instead of queuing a pending text.
4. Gate it behind an env flag like `SMS_AUTOSEND=true` so you can roll it out
   safely. Customers without consent keep getting hand-fired texts exactly as now.

---

## For developers
- **Run tests:** `npm test` (pure Node, no extra installs).
- **Preview the daily run:** `npm run crm:dry` (sends nothing, writes nothing).
- Architecture, file map, and guardrails: see **`CLAUDE.md`**.
