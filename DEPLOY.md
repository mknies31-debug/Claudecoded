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
| `ANTHROPIC_API_KEY` | Live Ask CARVIS answers (`carvis.js`) | `sk-ant-...` |
| `CARVIS_MODEL` *(optional)* | Force a specific model | a model id your key can use |
| `RESEND_API_KEY` | Outreach email (`send-email.js`) | from resend.com |
| `MAIL_FROM` | Email sender identity | `Mick Knies <mick@northstarcarguy.com>` |
| `MAIL_REPLY_TO` | Where replies land | `mick@northstarcarguy.com` |
| `CARVIS_TOKEN` *(optional, recommended)* | Locks all three functions to just you | any long random string |

**Cloud sync (`sync.mjs`) needs no variables** — Netlify Blobs self-enables on
first use. Email only delivers to addresses on a Resend-verified domain (until
then it can only reach your own Resend account email — fine for testing wiring).

### Lock it down with `CARVIS_TOKEN` (recommended)

Without it, the three functions are public URLs: anyone who finds them could
send email from your domain, spend your Anthropic credit, or read/write your
synced data (the sync key alone is short and guessable). To close that:

1. Set `CARVIS_TOKEN` to a long random string in Netlify env vars, redeploy.
2. In CARVIS open **⇅ SYNC → Access token**, paste the **same** value, Save.
   Do this on each of your devices. Requests without the token now get 401.

The token is stored only on your device and is never included in cloud sync.

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
  passphrase, stored in Netlify Blobs. Refuses to overwrite newer data with
  older (stale-device guard) and keeps a daily backup for the last 14 days —
  restore one from **⇅ SYNC → Restore a daily backup**.
