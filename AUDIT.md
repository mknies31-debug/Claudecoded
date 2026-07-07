# CARVIS — Multi-Agent Audit & Optimization Report

_Full audit of CARVIS ("North Star Command") — the single-file PWA command
center for Mick Knies, North Star Car Guy (independent used-car operation inside
Mosaic Auto Group, Zumbrota MN). Scope: `index.html`, `netlify/functions/{carvis.js, send-email.js, sync.mjs}`, `sw.js`, `manifest.json`, `inventory.json`. Out of scope: `ledger/`, `volt/` (separate projects)._

Method: nine specialist agents audited independently (lead developer, debugging,
UX, performance, sales strategy, prompt engineering, expansion, plus two
sales-scenario testers covering ten real scenarios). Findings were merged,
de-duplicated, and every critical/high finding was verified against the source
before any fix. A second wave of three agents (code-error, usability,
integration) reviewed the changes.

---

## 1. Executive Summary

CARVIS was **a beautifully produced cockpit wrapped around an empty CRM.** The
craft was real — server-side API key, an authentic NEPQ system prompt, honest
"you haven't entered numbers yet" empty states, a genuine high-visibility mode —
but the core loop a solo dealer lives on did not exist:

- **The lead pipeline was unreachable dead code.** `DATA.leads` was hardcoded
  empty with no way to add a lead, so the Directives panel, the CALL/DRAFT/DONE
  actions, and Mick's real ghost-recovery / appointment / NEPQ script library
  were all code that could never run. Found independently by 6 of 9 agents.
- **Cloud sync could silently destroy the entire business.** Whole-snapshot
  last-write-wins with no timestamp check, a debounced push that died on tab
  close, and "✓ Saved" shown even when the write failed.
- **All three serverless endpoints were unauthenticated.** Anyone who found the
  URL could send email from Mick's verified domain, spend his Anthropic credit,
  or brute-force the 6-character sync key to read/overwrite customer data.
- Smaller but real: stored XSS via imported contact names, the habit checklist
  resetting at ~6 PM Minnesota time (UTC key), the AI proxy truncating its own
  mandated three-option format at 1000 tokens, no fetch timeouts anywhere, and
  a command bar that physically overflowed at phone width.

The fix was **not more AI** — it was one unified prospect record threaded
through the panels that already existed, plus durability and security hardening.
Roughly 80% of the needed sales copy and UI was already built; the connective
tissue was missing, and that tissue is where the extra 2–4 cars a month live.

**Outcome:** every critical and high finding below is fixed. CARVIS now captures
leads, surfaces due follow-ups, reaches Mick's real scripts, protects his data,
and locks its endpoints.

---

## 2. Complete Bug & Weakness Report (ranked)

### Critical
1. **Unauthenticated serverless endpoints.** `send-email.js` was an open relay
   from Mick's verified domain; `carvis.js` an open Anthropic proxy; `sync.mjs`
   readable/writable with a guessable 6-char key. → *Fixed:* optional
   `CARVIS_TOKEN` shared secret enforced on all three (401 without it).
2. **Cloud sync data-loss machine.** Timestamp-blind last-write-wins;
   debounced push lost on tab close; failed `localStorage` writes swallowed
   while UI showed "✓ Saved". → *Fixed:* verified writes, `pagehide`/hidden
   flush via `keepalive`, per-side `lastmod` timestamps, pull skips older
   snapshots, server rejects stale pushes (409), daily backups (14 days).
3. **Lead pipeline was unreachable dead code.** `DATA.leads` never populated;
   Directives/draft engine and real scripts entombed. → *Fixed:* Directives now
   derive from the prospect roster; scripts reachable everywhere.

### High
4. **No lead capture / follow-up cadence / appointments.** Hot Prospects stored
   only name/note/heat — no phone, source, date, or next action. → *Fixed:* rich
   prospect record + follow-up dates + appointments with a Google Calendar link.
5. **Stored XSS** via unescaped `innerHTML` (contact dropdown, reply/draft
   bodies, scraped inventory fields, image/URL). → *Fixed:* `esc()` everywhere,
   `http(s)`-only URL/image guard, draft copy by array index (no attribute
   injection).
6. **AI proxy defects.** `max_tokens:1000` truncated the mandated three options
   (worse on Fable 5, where thinking shares the budget); 5-model chain
   re-walked every request including two retired models; no upstream timeout;
   the prompt never told the model it's blind to inventory/date/customers.
   → *Fixed:* 4096 tokens + `stop_reason` surfaced, memoized winning model,
   per-attempt 8s timeout, retired ids dropped, "what you cannot see" block +
   live inventory/date context injected.
7. **No fetch timeouts** — one hung request on rural cell signal wedged Ask
   CARVIS / sync / email forever. → *Fixed:* `apiFetch` wrapper with
   `AbortController` timeout on every call.
8. **Vehicle search crash** on any inventory row missing both `stock` and `vin`
   (`v.vin.slice` on undefined). → *Fixed:* guarded.
9. **Stale-inventory "Yes — in stock"** answered from month-old data. → *Fixed:*
   freshness gate; answers "verify before you promise it" when stale.
10. **Command bar overflowed at 390px**; labeled shortcuts hidden on mobile.
    → *Fixed:* chips scroll on their own row, redundant icon buttons hidden,
    `100dvh`.
11. **Mandatory ~2s boot ceremony every visit** that faked its diagnostics.
    → *Fixed:* plays once per day, tap-to-skip, honest boot lines.

### Medium
12. Habit checklist keyed on UTC date — reset ~6 PM local. → *Fixed:* local date
    + 14-day pruning of old keys.
13. Fake "System Status: ONLINE" panel. → *Fixed:* reflects real client state
    (sync on/off, access lock, inventory count/staleness).
14. Outreach email defects: literal `[your review link]` could be sent; "Know
    anyone car shopping, there?" subject; double sign-off; SMS-style "STOP"
    opt-out; off-brand "500 across all brands". → *Fixed:* review-link setting +
    send-block, name fallback, single sign-off, email unsubscribe line, on-brand
    copy.
15. Thin contacts (no phone/notes/dates); no send history. → *Partly fixed:*
    `lastEmailed` stamped; phone/source now live on prospects.
16. Trade-intent regex missed "what's my F-150 worth?" phrasings. → *Fixed:*
    broadened (`worth|value|apprais|payoff|owe on|give me for|my <model>`).
17. Duplicate leads invisible. → *Fixed:* dedupe on phone, then name+vehicle.
18. Naive CSV import mangled quoted "Last, First" names. → *Fixed:* quoted-field
    parser + type coercion.
19. Two overlapping reply tools with no bridge. → *Improved:* Buyer Reply now
    pins to the prospect roster; both note when to use the live brain.
20. Perpetual canvas loop + never-ending oscillator hum drained phone battery.
    → *Fixed:* reduced-motion honored, ~30fps cap, pause when hidden, hum stops
    when tab hidden.
21. No pipeline visibility beyond hand-typed monthly totals; no one-tap logging.
    → *Improved:* `+1 Sold`/`+1 Bought` quick log; prospects carry a `stage`.

### Low / noted
22. PWA icons are data-URI SVGs Chrome/iOS may reject (real PNG icons
    recommended — noted, not changed).
23. `inventory.json` is a hollow shell (319 vehicles, price/miles/specs all
    empty, ~1 month stale) — the crawler only captured VIN/year/make/model/URL.
    The app now degrades honestly, but **fixing the crawler is the single change
    that unlocks vehicle Q&A, buyer-reply context, and AI answers at once.**

**Suspicions the audit _cleared_ (no change needed):** the service worker is
network-first, so deploys are **not** served stale; `snapshotStore()` already
covered every persisted key.

---

## 3. Prioritized Improvement Plan

1. **Security & durability first** (done) — token-gate endpoints, sync
   ts-guard + flush + verified writes + daily backups.
2. **Make the pipeline real** (done) — prospects → due-today directives →
   reachable scripts → appointments.
3. **Correctness & trust** (done) — XSS, crash, stale-inventory honesty, AI
   truncation, timeouts, date bug.
4. **Daily-use polish** (done) — mobile command bar, boot skip, quick logging,
   battery.
5. **Still open (needs Mick / infra):** enrich the inventory crawler
   (price/miles/photos); ship real PNG PWA icons; optional scheduled
   follow-up email digest (a Netlify cron reading the sync blob).

---

## 4. Recommended Fixes with Reasoning

Each fix targets a **root cause**, not a symptom:

- **Prospect record as the single source of truth.** Rather than a fourth data
  silo, Hot Prospects became the lead store (`name, phone, vehicle, src, heat,
  note, stage, lastTouch, next, appt`). The Directives panel now _derives_ from
  it (`computeDirectives`/`isDue`), so the already-built script engine and
  CALL/DRAFT/DONE actions finally execute on real data. Reasoning: 80% of the UI
  existed; wiring it beats rebuilding it and keeps one mental model for Mick.
- **`lset()` verified writes + `lastmod`.** A save that can silently fail while
  claiming success is worse than a visible error. Every write now verifies and
  stamps a timestamp; sync compares timestamps both directions and the server
  refuses stale overwrites. Reasoning: the two-device home/work case is exactly
  what sync exists for and exactly where it lost data.
- **Optional `CARVIS_TOKEN`.** A shared secret is the smallest change that closes
  an open email relay and open AI proxy without adding accounts/OAuth to a
  static PWA. Reasoning: proportionate to a one-person operation; off by default
  so nothing breaks, on in one paste when Mick's ready.
- **Copy-by-index, `esc()` everywhere.** Draft bodies now live in a JS array
  referenced by index instead of being interpolated into `data-` attributes,
  eliminating the injection surface entirely rather than escaping it case by
  case.

---

## 5. Revised Prompts & Instructions (`carvis.js` system prompt)

Rewritten to match the surface it actually runs on:
- **Plain-text/TTS format rule** — the UI renders `textContent` and reads
  answers aloud, so: never use markdown; casual questions get 1–3 sentences; the
  three-option format uses a fixed plain-text layout, and only when Mick asks to
  _write_ a message (not ask _about_ one).
- **"What you cannot see" block** — the model is told it has no live
  inventory/date/customer access and must never invent stock, prices, or
  availability; it's pointed to the car lookup instead.
- **Voice anchors** — real lines from Mick's playbook embedded so the live AI
  and the canned templates speak the _same_ Mick.
- **Two-case money rule** — never quote a figure in customer-facing drafts;
  numbers are fine when talking to Mick, tagged once ("check KBB").
- **Live context injected per call** — today's date + top inventory matches +
  this month's numbers, so answers about real cars are grounded.

---

## 6. Updated Workflow Map

**Before:** Marketplace message → paste into Buyer Reply → copy a draft →
(conversation evaporates). Numbers typed monthly. Follow-up from memory.

**After:**
```
Marketplace / call / referral
        │  (Buyer Reply → PIN, or Hot Prospects add)
        ▼
   PROSPECT  { name, phone, vehicle, source, heat, stage, lastTouch, next, appt }
        │
        ├─ due today?  ──▶  DIRECTIVES panel  ──▶  CALL · DRAFT (real scripts) · SET APPT · DID IT
        │                                                    │
        ├─ appointment ──▶  APPT badge + Google Calendar link
        │
        └─ sold ──▶ contact (referral/review email, lastEmailed stamped)

  Every change → verified local write → debounced cloud push (flushed on close)
                 → server ts-guard + daily backup
```

---

## 7. Features to Remove, Combine, or Add

- **Combined:** Hot Prospects + Directives + lead drafts into one pipeline;
  Buyer Reply now feeds it.
- **Demoted:** perpetual canvas/hum gated on visibility & reduced-motion; fake
  "System Status: ONLINE" replaced with real state; "talkback coming soon" copy
  removed (the live brain already ships).
- **Added:** phone/source/follow-up dates, due-today directives, appointments +
  calendar links, pin-as-prospect, `+1 Sold/Bought` quick log, cloud daily-backup
  restore, access-token lock, review-link setting.
- **Recommended next:** enrich inventory crawler; real PNG icons; scheduled
  follow-up email digest.

---

## 8. Testing Results

- **Static:** `node --check` passes on all three functions and the extracted
  client script; a guard confirms every new function is defined.
- **Unit (pure logic):** `isDue` (quiet/next/appt/far-future), quoted-CSV
  parsing, dedupe (phone and name+vehicle), and `gcalLink` date math all pass.
  Month-end rollover bug in `gcalLink` was found by the test and fixed.
- **Scenario walkthroughs (the ten required):** Marketplace inquiry → reply +
  pin; 5-day ghost → quiet directive + ghost-recovery scripts now reachable;
  price on a public comment; trade-in ask (regex broadened); 6-months-out →
  follow-up date resurfaces it; hot-lead appointment → APPT + calendar link;
  sold customer → review/referral with a real link, no placeholder; busy day →
  due-today list; slow day → quiet list prompts outreach; duplicate leads →
  dedupe. All ten now have a real path (previously 3 were "weak/unsupported").
- **Adversarial code review:** three agents (code-error, usability, integration)
  reviewed the diff; their confirmed findings were applied.

_Not tested here:_ live end-to-end against a deployed Netlify site with real API
keys — that requires the deploy and Mick's credentials.

---

## 9. Remaining Risks & Limitations

- **Inventory data is hollow and stale** — the biggest single limiter of the
  car-lookup and inventory-aware AI features. Needs a crawler fix, not an app
  fix. The app now degrades honestly instead of asserting availability.
- **`CARVIS_TOKEN` is opt-in** — until Mick sets it, the endpoints remain
  public. The recommendation and one-paste setup are documented in DEPLOY.md.
- **Appointment reminders rely on the app/calendar** — a static PWA can't push
  notifications on its own; the Google Calendar link hands reminding to the
  phone's calendar. A scheduled email digest (Netlify cron) is the real fix.
- **`localStorage` remains the primary store** — now guarded (verified writes,
  cloud + daily backups), but heavy long-term data would eventually want
  IndexedDB.
- **PWA icons** are still SVG data-URIs (install-icon polish, low urgency).

---

## 10. Final Optimized Version

The optimized program is the committed state of this branch: `index.html` plus
the three hardened functions and updated `DEPLOY.md`. All critical/high findings
resolved; the sales loop is closed end-to-end; endpoints lockable; data durable.

---

## 11. Change Log

**`netlify/functions/carvis.js`** — MAX_TOKENS 1000→4096; dropped retired
`claude-3-5-*`, added `claude-haiku-4-5`; memoized winning model; per-attempt
8s `AbortController` timeout; accepts per-call `context` appended to system;
rewrote SYSTEM_PROMPT (plain-text/TTS format, "what you cannot see", voice
anchors, two-case money rule); optional `CARVIS_TOKEN` auth.

**`netlify/functions/sync.mjs`** — stale-push 409 guard (compares `ts`); daily
backup blobs (14-day window) with `?list`/`?backup`; optional `CARVIS_TOKEN`
auth.

**`netlify/functions/send-email.js`** — optional `CARVIS_TOKEN` auth.

**`index.html`** —
- Durability: `lset()` verified writes + `carvis_lastmod`; save fns return
  success and surface failures; `apiFetch` (token + timeout); `cloudPush`/`Pull`
  ts-guard, 409 reconcile, `force`; `flushPush` on `pagehide`/hidden;
  `NOSYNC` excludes per-device secrets; cloud daily-backup restore UI; access
  token field.
- Pipeline: rich prospect record; `prospectToLead`/`isDue`/`computeDirectives`;
  `renderDirectives` derived from prospects with DUE/QUIET/APPT + CALL/DRAFT/SET
  APPT/DID IT; `openDraft` reads the roster; `markTouched`/`setAppt`/`gcalLink`;
  expanded Hot Prospects form (phone/vehicle/source/date) with dedupe; pin-as-
  prospect from Buyer Reply; `runCmd` draft search over the roster.
- Correctness/security: `esc()` in contact dropdown, drafts, vehicle render;
  `safeUrl` http(s) guard; copy-by-index `COPYBANK`; vin-slice crash guard;
  `TASK_KEY` local date + `pruneTaskKeys`; broadened trade regex; quoted-CSV
  parser + coercion; honest `renderSystem`; inventory freshness gate.
- Prompts/copy: outreach templates (review-link setting + send-block, name
  fallback, single sign-off, unsubscribe line, on-brand copy), `recordOutreach`
  send history; removed "talkback" copy; honest boot lines; honest AI label.
- UX/perf: mobile command bar (scrolling chips, `100dvh`, hidden redundant
  icons); boot once-per-day + tap-to-skip; `+1 Sold/Bought` quick log; AI copy
  button + `stop_reason` + inventory/date context + summary-only TTS with
  sentence chunking; reduced-motion + ~30fps + hidden-pause on the node canvas;
  hum stops when hidden.

**`DEPLOY.md`** — documented `CARVIS_TOKEN` and the sync backup/restore.
