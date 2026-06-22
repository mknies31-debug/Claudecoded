# Deploying CARVIS to Netlify

CARVIS is a static PWA plus three serverless functions. There is **no build
step** — Netlify serves the files as-is and bundles the functions automatically
(`netlify.toml` already points at them). The only dependency, `@netlify/blobs`,
is installed from `package.json` at deploy time.

## 1. Deploy

**Option A — Drag & drop (fastest)**
1. Go to https://app.netlify.com → **Add new site → Deploy manually**.
2. Drag the project folder (or `carvis-netlify.zip`) onto the drop zone.
3. Netlify reads `netlify.toml`, installs deps, and bundles the functions.

**Option B — Git (auto-deploys on every push)**
Connect the repo + branch in Netlify once; it redeploys on each push.

## 2. Environment variables

Set these in **Site settings → Environment variables**, then trigger a redeploy.
Features stay dark until their variables are present.

| Variable | Powers | Example |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | Live Ask CARVIS answers (`carvis.js`, Fable 5) | `sk-ant-...` |
| `CARVIS_MODEL` *(optional)* | Force a specific model | a model id your key can use |
| `RESEND_API_KEY` | Outreach email (`send-email.js`) + referral auto-emails (`daily-runner`) | from resend.com |
| `MAIL_FROM` | Email sender identity | `Mick Knies <mick@northstarcarguy.com>` |
| `MAIL_REPLY_TO` | Where replies land | `mick@northstarcarguy.com` |
| `CRM_SYNC_KEY` | Lets the daily referral cron find your data — set it to the **same** key you saved under ⇅ SYNC | your private sync key (6+ chars) |
| `CRON_SECRET` | Guards the `daily-runner` URL — manual triggers must send it as an `x-cron-key` header (the scheduled run is exempt) | any long random string |
| `EMAIL_PROVIDER` *(optional)* | `resend` (default) or `mailerlite` | swap the email vendor |
| `MAILERLITE_API_KEY` *(optional)* | MailerLite send (only if `EMAIL_PROVIDER=mailerlite`) | from mailerlite.com |

**Cloud sync (`sync.mjs`) needs no variables** — Netlify Blobs self-enables on
first use. Email only delivers to addresses on a Resend-verified domain (until
then it can only reach your own Resend account email — fine for testing wiring).

## 3. Smoke test after it's live

1. Open the site → click **⇅ SYNC** → set a sync key (6+ chars) → **Save Key**.
2. Add a test hot prospect, then open the **same key** in another browser or on
   your phone → it should appear. That confirms cloud sync (Blobs) works on the
   real deploy.
3. Install it: in the browser menu choose **Install / Add to Home Screen** to
   run CARVIS full-screen like a native app.

## What each function does

- `carvis.js` — server-side Anthropic proxy (keeps the API key off the client).
  Powers ◉ Ask CARVIS, the command bar, and the 🎙 mic — live answers in
  Mick's voice, spoken aloud when AUDIO is on. It tries a chain of models
  (Fable 5 first) and uses the first one your key can access, so the live brain
  works even if the newest model isn't enabled on your account. Set
  `CARVIS_MODEL` to pin a specific one.
- `send-email.js` — sends 1:1 outreach email via Resend, replies routed to Mick.
- `sync.mjs` — cross-device cloud sync of CARVIS data, keyed by a private
  passphrase, stored in Netlify Blobs.
- `daily-runner.mjs` — **scheduled** function (daily, 14:00 UTC). Reads the same
  synced blob via `CRM_SYNC_KEY`, runs the referral follow-up engine (auto-emails
  + queued texts), and writes the results back. No-ops safely until
  `CRM_SYNC_KEY` is set. Trigger it by hand to test: `POST
  /.netlify/functions/daily-runner`. See `README.md` for the referral workflow.
