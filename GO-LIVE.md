# GO-LIVE Checklist — North Star Referral CRM

Everything below is a one-time setup. Work top to bottom; each step says how to
confirm it worked before moving on. Nothing reaches a real customer until
**Step 5** (your copy) is done.

---

## 1. Deploy the site to Netlify
The CRM ships inside CARVIS — there's no separate app and no build step.

- [ ] Push this repo's branch to Netlify, **or** drag the project folder onto
      https://app.netlify.com → **Add new site → Deploy manually**.
- [ ] Netlify reads `netlify.toml`, installs `@netlify/blobs`, and bundles the
      functions automatically.

**Confirm:** the site loads and you can tap **⇄ REFERRALS** in the top bar.

---

## 2. Set the environment variables
Netlify → **Site settings → Environment variables**. Add these, then redeploy
(**Deploys → Trigger deploy → Clear cache and deploy**). Features stay dark until
their variable is present.

| Variable | Powers | Required for |
| --- | --- | --- |
| `CRM_SYNC_KEY` | lets the daily cron find your data | the auto-follow-up loop |
| `EMAIL_PROVIDER` | `gmail` to send from your Gmail (or `resend` / `mailerlite`) | choosing the sender |
| `GMAIL_USER` | your Gmail address, `northstarmickknies@gmail.com` | sending via Gmail |
| `GMAIL_APP_PASSWORD` | the 16-char Google **App Password** (NOT your login password) | sending via Gmail |
| `MAIL_REPLY_TO` *(optional)* | where replies land (defaults to `GMAIL_USER`) | email |
| `MAIL_FROM_NAME` *(optional)* | the display name on Gmail sends (default "Mick — North Star Car Guy") | email |
| `ANTHROPIC_API_KEY` | photo intake + Ask CARVIS | the 📷 From-a-photo feature |
| `CRON_SECRET` | guards the cron's public URL — manual triggers must send this | keeping the send loop private |
| `RESEND_API_KEY` / `MAIL_FROM` | only if `EMAIL_PROVIDER=resend` (domain sending) | the Resend path |
| `MAILERLITE_API_KEY` *(optional)* | only if `EMAIL_PROVIDER=mailerlite` | the MailerLite path |

> **Sending from your Gmail (`northstarmickknies@gmail.com`).** Set `EMAIL_PROVIDER=gmail`,
> `GMAIL_USER=northstarmickknies@gmail.com`, and `GMAIL_APP_PASSWORD`. Get that password from
> **Google Account → Security → 2-Step Verification (turn on) → App passwords →**
> generate one for "Mail." Emails then come from your real address, **land in your
> Sent folder**, and replies hit your normal inbox. No domain needed — you can
> **skip Step 4**.

> **Set `CRON_SECRET`** to any long random string. The daily scheduled run
> doesn't need it, but it blocks strangers from triggering your email loop by
> hitting the function URL. To trigger the job by hand, send that value as an
> `x-cron-key` header (see Step 6).

**Confirm:** after redeploy, the variables show under Site settings with values set.

---

## 3. Turn on the sync key (and match it to the cron)
The browser and the cron share one private Blob, keyed by your sync key. They
must use the **exact same string**.

- [ ] In the app: **⇅ SYNC** → type a private key (6+ characters) → **Save Key**.
- [ ] Use that **identical string** as the `CRM_SYNC_KEY` env var from Step 2.
- [ ] (Optional) set the same key on your phone and home machine so everything
      stays in step.

**Confirm:** add a test customer on one device; open the same key on another →
it appears. That proves sync is live.

### Running on phone + desktop at the same time
Yes — install it on both (browser menu → **Install / Add to Home Screen**) and
run them together. They are the same site sharing one cloud blob.

- **Everything saves to the same place.** Typed, voice, and photo capture, edits,
  opt-outs, and the nightly cron all write the same data set — there is no
  separate store per device or per input method.
- **Saving up is immediate.** Any change pushes to the cloud about 1.5 seconds
  after you stop — effectively right away.
- **Pulling down happens on open + refocus, not continuously.** A device fetches
  the latest when the app loads and each time you switch back to it (plus a
  manual **⬇ Pull now** button under ⇅ SYNC). It does *not* live-refresh while
  sitting idle. So if both are open and you add someone on the phone, the desktop
  shows it once you click back into it or hit **Pull now**. The cron's nightly
  work appears the same way — next time a device opens or refocuses.
- **Use the same key on every device.** A different key = a separate, empty data
  set. If a device looks empty, it's almost always a mismatched key.
- **Don't edit the same customer on two devices in the same moment.** Sync is
  last-writer-wins on the whole snapshot (no field-level merge). In normal solo
  use — one device at a time — this never bites; just don't have both open and
  editing the same record simultaneously.


---

## 4. Verify your Resend sending domain  *(skip if you're using Gmail — Step 2)*
Only needed for `EMAIL_PROVIDER=resend`. Until a domain is verified, Resend only
delivers to **your own** Resend account email — fine for testing, not customers.

- [ ] In Resend (resend.com): add and verify your domain (e.g.
      `northstarcarguy.com`) via the DNS records they give you.
- [ ] Set `MAIL_FROM` to an address on that verified domain.

**Confirm:** send yourself a test from the app's **📧 Outreach** to an outside
address and check it lands.

---

## 5. Put in your copy and turn auto-emails ON  ← the real go-live switch
Right now every message is placeholder text and auto-emails are **held**.

- [ ] Edit `shared/templates.mjs` — replace the placeholder wording for all 5
      sequences × 3 variants (Direct / Softer / NEPQ) with yours.
      - Keep the rules: texts ≤ 3 sentences, emails ≤ 6, **no price/trade/credit
        talk**, no exclamation marks. Tokens allowed: `{{first_name}}`, `{{vehicle}}`.
- [ ] In that same file set `export const APPROVED = true;`
- [ ] Run `npm test` — it fails the build if any template breaks a rule.
- [ ] Redeploy.

**Confirm:** `npm test` is green and `APPROVED` is `true`.

> Texts work the whole time without this — they're always hand-fired from the
> dashboard. This switch only governs the *automatic emails*.

---

## 6. Test the daily cron by hand
The job runs automatically once a day (`0 14 * * *` ≈ 9:00am Central). You don't
have to wait to test it — but note **Netlify scheduled functions can't be
triggered by a plain browser/URL hit in production.** Use one of these:

- [ ] **Easiest — Netlify UI:** Netlify → **Functions → `daily-runner` → Run now.**
      Watch the log and the returned JSON.
- [ ] **Or the CLI:** `netlify functions:invoke daily-runner` (from the project,
      after `netlify link`). To reach the manual-trigger path from your own
      machine, send the secret: add `--payload '{}'` and the `x-cron-key:
      $CRON_SECRET` header (the scheduled run itself is exempt via `next_run`).
- [ ] Read the JSON it returns:
      - `{ "ok": true, "provider": "gmail", "wrote": true, "report": {...} }` → it ran.
      - `{ "skipped": true, "reason": "CRM_SYNC_KEY is not set..." }` → fix Step 3.
- [ ] In the app, open **⇄ REFERRALS → ◉ Daily Ops** and confirm the
      **Emails Sent Today** / **Texts Ready to Send** counts reflect the run.

**Confirm:** the report shows `emailsSent` (once approved) and `textsQueued`
numbers that make sense for your customers' purchase dates.

> `CRON_SECRET` still guards the function's HTTP path as defense-in-depth (in
> case a future Netlify plan or a proxy does expose it) — the scheduled run is
> always exempt, so setting it never blocks the real cron.

---

## 7. Real-device smoke test (10 minutes on your actual phone)
Voice, camera, and text links can only be trusted after a real-device run.

- [ ] **Voice:** tap 🎙 (or the **⇄ Enter Customer** chip) → say "enter customer"
      → answer the questions out loud → confirm the review form filled in.
- [ ] **Photo:** **＋ Add Customer → 📷 From a photo** → snap a card/paperwork →
      confirm the fields come back populated.
- [ ] **One-tap text:** in the Texts queue, tap **✆ One-tap text** → confirm your
      Messages app opens with the number and message ready.
- [ ] **Install:** browser menu → **Add to Home Screen** to run it full-screen.

**Confirm:** all four behave on the real device.

---

## 8. Confirm the schedule registered
- [ ] Netlify → **Functions** → `daily-runner` shows as a **Scheduled** function
      with the `0 14 * * *` cron.

---

### Quick reference
- Change the timeline windows: `shared/sequences.mjs`
- Change the copy / variants: `shared/templates.mjs`
- Swap email provider or data store: see `README.md`
- Architecture + guardrails: `CLAUDE.md`
- Preview a run locally (sends nothing): `npm run crm:dry`
