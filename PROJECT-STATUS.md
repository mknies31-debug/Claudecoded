# North Star Referral CRM — Project Status & Handoff

_Last updated: 2026-06-19_

A single document that captures where the project stands, what's done, what's
left, and the open items that need **you** (Mick). Branch with all work:
`claude/focused-ptolemy-r6yf4n`.

---

## 1. What this is (one paragraph)
A referral follow-up engine for a solo automotive sales pro, built **inside** the
existing CARVIS PWA as a `⇄ REFERRALS` overlay. You add a customer once (by
typing, voice, or photo); it tracks them after purchase, **auto-sends** a timed
email sequence, and hands you one-tap **text** drafts to fire by hand. No new
app, no database — it rides CARVIS's existing Data Sync.

---

## 2. Current status: BUILD COMPLETE ✅
The software is feature-complete and green (25/25 tests). Real copy is loaded and
auto-emails are switched on. What remains is mechanical setup (deploy + keys) and
two small items that need input from you (Section 5).

| Piece | State |
| --- | --- |
| Capture (type / voice / photo) | ✅ Done |
| Pipeline + dashboard + text queue | ✅ Done |
| Edit customer (preserves timeline) | ✅ Done |
| Daily cron loop (email auto-send + text queue) | ✅ Done |
| Compliance guardrails + test suite | ✅ Done (25/25) |
| **Message copy (your real voice)** | ✅ **Live** |
| **Auto-emails on** (`APPROVED = true`) | ✅ **On** |
| Deploy + env vars + Resend domain | ⏳ Your setup — see `GO-LIVE.md` |
| Google-review link in referral msg | ⏳ Needs your URL (Section 5) |

---

## 3. The copy is now live (the old blocker, cleared)
Your "North Star Lead Command" upload had your real referral templates. I adapted
your voice and phrasing into this engine's structure — 5 time-windows × 3 tones
(Direct / Softer / NEPQ):

| Window | When | Channels |
| --- | --- | --- |
| Welcome / Delivery | day 1 | email + text |
| Two-Week Check-In | day 14 | text |
| Referral Ask | day 45 | email + text |
| Service Reminder | day 180 | email |
| One-Year Anniversary | day 365 | email + text |

Your signature lines carried over: _"send them my way — I'll take care of them the
same way I took care of you,"_ _"no pressure, just wanted to stay on your radar,"_
the Minnesota-winter service nudge, and birthday-style warmth at the one-year mark.

**Compliance held:** every message stays within texts ≤ 3 sentences, emails ≤ 6,
zero price/trade/credit/financing language, and no exclamation marks. The test
suite lints all 30 messages and passes. (One edit: your "trade or upgrade" line
became "be your first call," because "trade" trips the zero-value rule.)

To change any wording later: edit `shared/templates.mjs`, run `npm test`, redeploy.

---

## 4. Two judgment calls I made (you said "most effective")
1. **Did NOT port the other app's features.** Its referral pipeline duplicates
   what this CRM already does, and the Conversation Assistant / Customer
   Archetypes / Curb Offers / Ella pay tracker are separate products. Porting
   them would be a large, redundant rebuild that delays go-live. Say the word if
   you want any of them and I'll scope it as its own effort.
2. **Left the Google-review ask out, on purpose.** It needs your real review URL —
   I won't ship a `[your Google link]` placeholder to customers. See Section 5.

---

## 5. OPEN ITEMS — these need you
- [ ] **Google review link.** Send me your Google review URL and I'll wire it into
      the day-45 referral message as a `{{review_link}}` token (~5 min).
- [ ] **Go live.** Follow `GO-LIVE.md` — deploy to Netlify, set the env vars
      (`CRM_SYNC_KEY`, `RESEND_API_KEY`, `MAIL_FROM`, `MAIL_REPLY_TO`,
      `ANTHROPIC_API_KEY`), verify your Resend sending domain, match the in-app
      sync key to `CRM_SYNC_KEY`, then run the 10-minute real-device smoke test.
- [ ] **(Optional) Decide on features.** Tell me if you want any of the other
      app's features brought into CARVIS.

---

## 6. ⚠️ Security flag from your upload (separate app)
The uploaded "North Star Lead Command" app's own `SECURITY.md` says its Firebase
Realtime Database is **world-readable and world-writable** — anyone who views the
page source can read or delete every lead, phone number, and note (customer PII).
That is a **different, separate app** from this CRM, but if it's holding real
customer data today it should be locked down: add Firebase Authentication and
publish the locked-down rules (`database.rules.json`). I have not touched that app
— just flagging it so it doesn't pass silently. I can help fix it if you want.

---

## 7. Where everything lives (map)
```
shared/            isomorphic logic — runs in browser AND cron
  schema.mjs         customer + touch_log shapes, validation
  sequences.mjs      the 5 timeline windows + "what's due" logic
  hydrate.mjs        {{first_name}} / {{vehicle}} token engine
  compliance.mjs     the guardrails (size / zero-value / tone)
  templates.mjs      ← your live copy (5 windows × 3 tones)
  engine.mjs         runDailyCycle() — the pure daily loop
  intake.mjs         voice/photo answer parsing

crm/               the dashboard UI (runs in the CARVIS shell)
  crm.js  crm.css

netlify/functions/ secrets + I/O only
  daily-runner.mjs   the scheduled cron
  _lib/              email provider + blob store

test/crm.test.mjs  the regression suite (npm test)

GO-LIVE.md         ← step-by-step setup checklist
CLAUDE.md          architecture + guardrails
README.md          overview
```

## 8. Handy commands
- `npm test` — run the full suite (no install needed beyond deps)
- `npm run crm:dry` — preview a daily cycle against sample data (sends nothing)

---

**Bottom line:** the engine is built, your real voice is in it, and auto-emails
are on. Send me your Google review link and walk through `GO-LIVE.md`, and you're
live.
