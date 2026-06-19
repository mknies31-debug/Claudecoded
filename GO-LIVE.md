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
| `RESEND_API_KEY` | outbound email | auto-emails actually sending |
| `MAIL_FROM` | sender identity, e.g. `Mick Knies <mick@northstarcarguy.com>` | email |
| `MAIL_REPLY_TO` | where replies land, e.g. `mick@northstarcarguy.com` | email |
| `ANTHROPIC_API_KEY` | photo intake + Ask CARVIS | the 📷 From-a-photo feature |
| `EMAIL_PROVIDER` *(optional)* | `resend` (default) or `mailerlite` | swapping vendors |
| `MAILERLITE_API_KEY` *(optional)* | MailerLite send | only if you switch |

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

---

## 4. Verify your Resend sending domain
Until a domain is verified, Resend only delivers to **your own** Resend account
email — fine for testing the wiring, not for real customers.

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
have to wait to test it.

- [ ] Trigger it: `POST https://YOUR-SITE/.netlify/functions/daily-runner`
      (any REST client, or `curl -X POST`).
- [ ] Read the JSON it returns:
      - `{ "ok": true, "provider": "resend", "report": {...} }` → it ran.
      - `{ "skipped": true, "reason": "CRM_SYNC_KEY is not set..." }` → fix Step 3.
- [ ] In the app, open **⇄ REFERRALS → ◉ Daily Ops** and confirm the
      **Emails Sent Today** / **Texts Ready to Send** counts reflect the run.

**Confirm:** the report shows `emailsSent` (once approved) and `textsQueued`
numbers that make sense for your customers' purchase dates.

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
