# Deploy checklist — North Star Keep-In-Touch

Everything below is clicking in a browser. There is exactly one step (E.3) that
has a terminal command, and it has a no-terminal alternative right next to it.
Budget: about 45 minutes the first time. Do the sections in order.

Keep a scratch note open. You'll copy six things into it along the way:
**Project ID, Web API key, your UID, Resend API key, the site URL, your send secret.**

---

## A. Firebase (the database and your login)

1. Go to https://console.firebase.google.com and sign in with your Google
   account. If you already have a Firebase project you want to reuse, open it
   and skip to step 3. Otherwise click **Add project**, name it
   `keep-in-touch`, turn Google Analytics **off**, click **Create project**.
2. Wait for "Your new project is ready", click **Continue**.
3. Left menu → **Build → Authentication** → **Get started** →
   **Sign-in method** tab → click **Email/Password** → toggle **Enable** on
   (leave "Email link" off) → **Save**.
4. **Users** tab → **Add user** → type your email and a long password (this is
   the only login the app will ever have; use a password manager) → **Add user**.
5. In the Users list, find your row. The **User UID** column shows a 28-character
   code. Click it to copy. Paste it into your scratch note as **UID**.
6. Left menu → **Build → Firestore Database** → **Create database** → choose
   the location closest to you (`nam5 (United States)` is fine) → **Next** →
   choose **Start in production mode** → **Create**.
7. Open the file `firestore.rules` from the project folder in any text editor
   (TextEdit, Notepad, GitHub's web editor — anything). Find the line

       && request.auth.uid == "PASTE_YOUR_UID_HERE";

   and replace `PASTE_YOUR_UID_HERE` with your UID from step 5. Keep the quotes.
   Save the file (and if you are using GitHub, commit it there).
8. Back in Firebase: **Firestore Database → Rules** tab. Select everything in
   the editor, delete it, paste the entire contents of your edited
   `firestore.rules`, click **Publish**. Green "Rules published" = done.
9. Click the **gear icon** next to "Project Overview" → **Project settings** →
   **General** tab. Copy **Project ID** and **Web API Key** into your scratch note.
   (If there is no Web API Key yet, scroll down to "Your apps", click the `</>`
   web icon, nickname `kit`, do NOT tick Firebase Hosting, click Register app,
   then come back — the key appears.)

---

## B. Resend (the email sender)

1. Go to https://resend.com and sign in (same account as CARVIS).
2. **Domains → Add domain** → type the domain you'll send from (the one you own,
   e.g. `northstarcarguy.com`). Resend shows 3–4 DNS records. Add them at your
   domain registrar (GoDaddy, Namecheap, Cloudflare: DNS → Add record, copy each
   Type / Name / Value exactly). Come back and click **Verify DNS records**.
   This can take from 5 minutes to a day. Until it says **Verified**, email only
   delivers to your own Resend login address — fine for testing.
3. **API Keys → Create API key** → name `keep-in-touch`, permission
   **Sending access**, domain = the one above → **Add**. Copy the key (starts
   with `re_`) into your scratch note NOW; Resend never shows it again.
4. *Later, for the Tier 2 inbox only:* **Receiving → Add domain/route** for the
   same domain, then **Webhooks → Add webhook** with the URL
   `https://YOUR-SITE.netlify.app/.netlify/functions/inbound`, event
   `email.received`. Copy the **Signing secret** (starts with `whsec_`). You'll
   paste it into Netlify as `RESEND_WEBHOOK_SECRET` in section E.

---

## C. Netlify (hosting + the send function)

**Recommended path — connect the GitHub repo (all clicking, no terminal):**

1. Go to https://app.netlify.com → **Add new site → Import an existing project**
   → **GitHub** → authorize if asked → pick the repo that contains the
   `keep-in-touch` folder.
2. On the settings screen, fill in exactly:

   | Field | Value |
   |---|---|
   | Branch to deploy | `main` (or whatever the default is) |
   | Base directory | `keep-in-touch` |
   | Build command | *(leave empty)* |
   | Publish directory | `keep-in-touch` |
   | Functions directory | `keep-in-touch/netlify/functions` |

3. Click **Add environment variables** (or after the first deploy: **Site
   configuration → Environment variables → Add a variable**) and add these.
   Type each key exactly as written.

   | Key | Value | Needed for |
   |---|---|---|
   | `KIT_SECRET` | make up a long random phrase (20+ characters, e.g. from your password manager). Write it in your scratch note. | Tier 1 |
   | `RESEND_API_KEY` | the `re_…` key from B.3 | Tier 1 |
   | `MAIL_FROM` | `Mick at North Star Car Guy <mick@northstarcarguy.com>` | Tier 1 |
   | `MAIL_REPLY_TO` | the dedicated Gmail address replies should land in | Tier 1 |
   | `SITE_URL` | fill in after step 5, e.g. `https://kit-mick.netlify.app` (no trailing slash) | Tier 1 |
   | `FIREBASE_PROJECT_ID` | Project ID from A.9 | Tier 2 |
   | `FIREBASE_SERVICE_ACCOUNT` | see section E | Tier 2 |
   | `RESEND_WEBHOOK_SECRET` | the `whsec_…` from B.4 | Tier 2 inbox |

4. Click **Deploy**. Wait for the green "Published".
5. **Site configuration → Site details → Change site name** → something short like
   `kit-mick`. Your app is now `https://kit-mick.netlify.app`. Put that in
   `SITE_URL` (step 3) and click **Deploys → Trigger deploy → Deploy site** once
   so the functions pick up the new variable.
6. Check the functions exist: **Logs → Functions**. You should see `send`,
   `daily` and `inbound`. Click `daily` — it should say **Scheduled** with the
   cron `0 14,15 * * *`.
7. *(Five-minute sanity check, only if you used drag-and-drop instead of Git.)*
   If `daily` is missing from the Functions list, or its log says "Cannot find
   module", the drag-and-drop deploy did not bundle the functions. Switch to the
   Git path above; it is the reliable one.

**Fallback path — drag and drop (Tier 1 only):** open https://app.netlify.com/drop
in a browser, drag `keep-in-touch-deploy.zip` (or the whole `keep-in-touch` folder) onto it. Then do steps 3
and 5. Hand-sending from the app works. The 9 AM scheduled job may not register
this way (see `docs/01-architect.md` section E); use Git-connect for Tier 2.

---

## D. First run in the app

1. Open your site URL on your phone or laptop. You'll see the setup screen.
2. Paste **Web API key** and **Project ID** from A.9. Tap **Save**.
3. Sign in with the email and password from A.4.
4. **Settings** tab, fill in:
   - Your name shown to customers ("Mick at North Star Car Guy"), your phone (the
     number customers should call/text).
   - **Business address**: Mosaic Autos' street address, exactly as it appears
     on their paperwork. It goes in every email footer (CAN-SPAM). Confirm it
     with Mosaic before the first real send.
   - **Send secret**: paste the `KIT_SECRET` value from C.3. Must match exactly.
   - **Site URL**: your `https://….netlify.app`.
   - Reply-to: the same Gmail address as `MAIL_REPLY_TO`.
   - Leave **Auto-send email** OFF for now.
5. **Add** tab: add yourself as a customer. Real email, real phone, sale date =
   today, tick email consent ("in person at sale"). Save.
6. **Queue** tab: you won't be due until sale + 3 days, so open your own
   timeline and use **Send now** on touch 0 (or set your sale date 4 days back
   and reload). Tap **Send Email**. Within a minute you should have a plain-text
   email from "Mick at North Star Car Guy" with the footer and unsubscribe link.
   Tap **Send as Text** — Messages opens pre-filled. Both show on your timeline.
7. Click the unsubscribe link in that email. You should see the goodbye page.
   Reopen the app: your own record is now **Do not contact**. (Flip it back
   under Edit, or delete yourself and add again.)
8. Open the site on your phone in Safari/Chrome → Share → **Add to Home Screen**.

---

## E. Tier 2 opt-in (9 AM auto-send and the reply inbox) — only when ready

Tier 2 needs a Google "service account" key so the Netlify job can read and
write Firestore without you being logged in.

1. Firebase console → gear → **Project settings → Service accounts** tab →
   **Generate new private key** → **Generate key**. A file like
   `keep-in-touch-firebase-adminsdk-xxxxx.json` downloads. Treat it like a
   password. Never commit it to GitHub, never email it.
2. Netlify → **Site configuration → Environment variables → Add a variable** →
   key `FIREBASE_SERVICE_ACCOUNT`. For the value, either:
   - **No terminal (simplest):** open the downloaded `.json` file in TextEdit /
     Notepad, Select All, Copy, and paste the whole thing as the value. It
     starts with `{` and ends with `}`. The app accepts it as-is.
   - **Or, the one terminal command (Mac, optional):** open Terminal and run
     `base64 -i ~/Downloads/keep-in-touch-firebase-adminsdk-xxxxx.json | pbcopy`
     (fix the filename), then paste the clipboard as the value. Either form works.
3. Add `FIREBASE_PROJECT_ID` (from A.9) if you didn't already.
4. **Deploys → Trigger deploy → Deploy site** so the job sees the new variables.
5. Delete the downloaded `.json` file from your Downloads folder.
6. In the app → **Settings** → turn **Auto-send email** ON. (SMS auto-send stays
   locked; texts always go by your hand.)
7. Next morning after 9:00 AM Central, open **Settings**: the heartbeat should
   read "Last run: today 9:00 AM". If the queue had anyone due with email
   consent, they were sent and appear on their timelines with "sent by:
   scheduled". If the heartbeat is older than 36 hours the Queue shows a red
   banner — then check Netlify → **Logs → Functions → daily** for the error.
8. For the reply inbox: do B.4, add `RESEND_WEBHOOK_SECRET`, trigger a deploy,
   then send a reply to one of your own test emails; it should appear on your
   timeline with a badge.

---

## F. What to check weekly (two minutes)

- **Queue tab**: anything sitting "late 14+ days"? Send or skip it. Nothing
  disappears on its own; it waits for you.
- **Settings → heartbeat** (Tier 2 only): ran today, zero errors. If there is a
  "send cap" or "time budget" note, the rest will go tomorrow; no action.
- **Resend dashboard → Emails**: any bounces? A bounced address means a typo —
  fix it on the customer's record.
- **Gmail reply inbox**: read replies, log the notable ones on the timeline
  (Tier 1) or confirm the badge count matches (Tier 2).
- **Resend → Domains**: still "Verified". (DNS changes at the registrar can
  silently break this.)
- Once a month: **Settings → Export CSV** and keep the file somewhere safe.
  That export is your backup and your VinSolutions hand-off.
