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
| `RESEND_API_KEY` | Outreach email (`send-email.js`) | from resend.com |
| `MAIL_FROM` | Email sender identity | `Mick Knies <mick@northstarcarguy.com>` |
| `MAIL_REPLY_TO` | Where replies land | `mick@northstarcarguy.com` |

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
  Mick's voice on Fable 5 (`claude-fable-5`), spoken aloud when AUDIO is on.
- `send-email.js` — sends 1:1 outreach email via Resend, replies routed to Mick.
- `sync.mjs` — cross-device cloud sync of CARVIS data, keyed by a private
  passphrase, stored in Netlify Blobs.
