# CARVIS Operations Manual & Roadmap

> **North Star Car Guy** is the public brand. **CarVis** is the operating system that runs it.
> This manual is the spine. Every system eventually documents itself here: purpose,
> inputs, outputs, KPIs, automation opportunities, and version history.
> _Living document — no process is ever "finished."_

---

## 1. Charter

**Mission.** Build CarVis into the most complete AI-assisted operating system for an
independent automotive business, and make North Star Car Guy the most trusted car
operation in the region.

**Prime directive.** Prefer long-term systems over short-term fixes. Integrate, don't
duplicate. Every workflow should be measurable, repeatable, and a candidate for automation.

**Primary objectives (optimize for, in tension-aware balance):**
Trust · Customer experience · Lead gen · Inventory acquisition · Inventory sales ·
Referrals · Personal brand · Operational efficiency · Automation · Continuous improvement ·
Scalability · Documentation · Measurement · Profitability · Long-term competitive advantage.

---

## 2. Honest Current State (v1.0 — what actually exists today)

CarVis today is a **single-page PWA** (offline-capable, installable) with a small set of
**Netlify Functions**. Data lives in the browser (`localStorage`) and syncs across devices
via Netlify Blobs. This is a deliberate, low-cost, dependency-light foundation — not yet the
multi-agent enterprise platform the vision describes. That gap is the roadmap.

| # | Module | State | Purpose | Inputs | Outputs | KPIs it should drive |
|---|--------|-------|---------|--------|---------|----------------------|
| 1 | **HUD dashboard** | ✅ Built | At-a-glance command center | Monthly numbers | Hero count, goal ring, gauges, ticker | Goal pace, focus |
| 2 | **Monthly Numbers** | ✅ Built | Real sales tracking, backfillable | Manual entry per month | Sold/Bought/Deals/Close-rate vs goals; 6-mo chart, 12-mo trend | Sales, acquisition, close rate |
| 3 | **Hot Prospects + Follow-Up Engine** | ✅ Built | Priority list that ages by heat into a daily due list | Name/phone/note/heat | Pinned list + "Follow-Ups Due" (SLA, quiet-timer, Logged, AI revival draft) | Follow-up SLA, revival rate |
| 4 | **High-Performance Habits** | ✅ Built | Burchard HP6 daily checklist | Daily checkmarks | Per-day completion, resets daily | Consistency, energy |
| 5 | **Buyer Reply drafts** | ✅ Built (scripted) | 3 options (Direct/Softer/NEPQ) | Buyer message | Copy-paste replies | Response speed, tone |
| 6 | **Outreach Email** | ✅ Built | 1:1 referral/review/follow-up email via Resend | Contacts + template | Sent email, reply-to Mick | Referrals, reviews |
| 7 | **Vehicle Lookup** | ✅ Built | Search real inventory | `inventory.json` | Specs, price, payment est. | Sales enablement |
| 8 | **Ask CARVIS (live AI)** | ✅ Built | Live answers in Mick's voice, voice in/out | Question | Spoken + written answer (Fable-5 proxy, model-fallback chain) | Speed, coaching, drafting |
| 9 | **Cloud Sync + Backup** | ✅ Built | Home↔work continuity | All `carvis_*` keys | Netlify Blobs store + JSON file | Reliability |
| 10 | **Accessibility** | ✅ Built | Low-vision default + A⁺ mode + time-of-day theme | — | Legible, high-contrast UI | Usability |
| 11 | **Measurement (funnel + source)** | ✅ Built | One-tap capture of leads/appts/sales by source | Taps (source-tagged) | Monthly funnel, conversion %, source-ROI table | Lead→appt→sale rates, source ROI |
| 12 | **Playbook (SOP / prompt library)** | ✅ Built | Reusable scripts + AI prompts, versioned | Titled plays | Copy-to-paste scripts, one-tap "run in brain" prompts, version history, use counts | Systemized knowledge, reuse |
| 13 | **Customer Intake (⬆)** | ✅ Built | Command-driven extraction of customers from uploads | Files (photo/scan/screenshot/CSV/TXT/PDF) or pasted lists + a plain-English command | AI-classified prospect/sold records with multi-deal grouping, routed into Ready / Needs Review / Possible Duplicates / Missing; one-tap create + merge | Clean bulk import, no bad records |

**What does NOT exist yet (the vision's core, honestly):** a content engine, any analytics
pipeline, market/auction/BI monitoring, a referral *system* (vs. one-off emails), an
automated follow-up sequencer, SOP library, a CEO/board briefing, and the multi-agent
"organization." Those are conceptual today. See §5.

---

## 3. The CarVis Agent Organization (target design)

CarVis is designed as an **organization**, not a feature list. Each agent has a mission,
inputs, outputs, KPIs, and a reporting line to the **CEO Agent** (the live Fable-5 brain).
Agents collaborate; they do not operate in isolation. Status is honest: most are PLANNED.

| Agent | Mission | Owns modules | KPIs | State |
|-------|---------|--------------|------|-------|
| **CEO Agent** | Synthesize everything into daily priorities | Board briefing, roadmap | Goal pace, focus quality | ✅ Built (Daily Briefing) |
| **Sales Agent** | Convert leads → appointments → sales | Numbers, drafts, prospects | Close rate, appts | ▶ Partial |
| **Acquisition Agent** | Buy the right cars at the right price | Buy-side numbers, market | Cars bought, cost basis | ⬜ Planned |
| **Content Agent** | Daily Reach/Trust/Action videos | Content OS | Views→DMs→appts | ⬜ Planned |
| **CRM / Follow-up Agent** | Never let a lead go cold | Prospects, follow-up engine | Follow-up SLA, revival rate | ✅ Built (aging + SLA + AI revival) |
| **Referral Agent** | Turn happy customers into pipelines | Outreach, referral loop | Referrals/mo | ⬜ Planned |
| **Reputation Agent** | Reviews & trust signals | Review requests | Reviews, rating | ⬜ Planned |
| **BI / Market Agent** | Actionable market/auction/season intel | Market Pulse | Pricing edge | ⬜ Planned |
| **Analytics Agent** | Measure everything, surface truth | Funnel, source ROI, dashboards | Data coverage, conversion | ▶ Partial (funnel + source capture) |

---

## 4. Continuous Improvement Loop

Every system runs this cycle, forever:

**Observe → Measure → Analyze → Improve → Document → Automate → Measure again → Repeat.**

Cadences:
- **Daily:** Executive board briefing (CEO Agent) → Top Priorities, Quick Wins, Sales/Inventory/Lead/Referral focus, Content plan, Blind spots.
- **Weekly:** Numbers review, content performance, follow-up SLA audit.
- **Monthly:** Close the month's numbers, goal reset, roadmap review, doc updates.
- **Quarterly / Annual:** Strategy, competitive position, big bets.

---

## 5. Roadmap

**Phase 0 — Foundation** ✅ _Done._ Core HUD, real monthly numbers (start-at-zero + backfill),
hot prospects, habits, buyer drafts, outreach email, vehicle lookup, live Fable-5 brain with
model-fallback, cloud sync, accessibility, PWA.

**Phase 1 — The Executive Layer** _(in progress)_
- **CEO Daily Briefing** ✅ _Built._ The "morning board meeting" (◆ button / `brief`
  command): a deterministic live pace strip (day-of-month vs goal, prospects, habits)
  plus an AI board briefing from the live brain — Top 3 Priorities, Quick Wins,
  Sales/Inventory/Lead/Referral focus, Blind spots. Cached per day; read-aloud button.
- **Follow-up Engine** ✅ _Built._ Hot Prospects now age by heat (SLA hot 1d / warm 3d /
  cool 7d) into a **Follow-Ups Due** list — quiet-timer badges, urgency sort, one-tap
  **Logged** (resets the clock), **Call** (`tel:`), and one-tap **AI revival draft**
  (Fable-5, click-to-copy). Feeds the Daily Briefing's follow-up focus.
- **Measurement capture** ✅ _Built._ One-tap Measure panel (📈): source-tagged leads /
  appointments / sales → monthly funnel with conversion %, and a **source-ROI table**
  (which channels actually convert to sales). Undo-last, sticky source, feeds the Briefing.
- **SOP / Prompt Library** ✅ _Built._ The **Playbook** (📖): reusable scripts (copy-to-paste)
  and prompts (one-tap "run in the brain", with `{fill-in}` blanks), each **versioned**
  (edits keep the old wording; restore any version) and use-counted so your go-to plays
  rise to the top. Ships with optional starter prompts.

**Phase 1 is complete** — the Executive Layer (CEO Briefing + Follow-Up Engine + Measurement
+ Playbook) is live. Next is Phase 2 (Growth Engines): Content OS and Referral System.

**Phase 2 — Growth Engines**
- **Content OS** — daily 3-video plan (Reach/Trust/Action) cross-referencing inventory,
  season, weather, local events; content log + performance capture.
- **Referral System** — a loop, not a one-off email: triggers, tracking, rewards.

**Phase 3 — Intelligence**
- **Analytics dashboards** — views→DMs→calls→appts→sales attribution; ROI/ROTI.
- **BI / Market feed** — auction/pricing/season/competitor signals, actionable only.

**Phase 4 — Automation**
- Scheduled briefings, sequenced follow-ups, auto-drafted content, alerting.

**Phase 5 — Scale**
- Multi-user (Mick + Ella), role separation, full operations manual, playbook as an asset.

---

## 6. Metrics Catalog (track everything measurable)

Sales: cars sold, gross-influenced, close rate, days-to-close.
Acquisition: cars bought, cost basis, source mix.
Pipeline: leads, hot/warm/cool, follow-up SLA, revival rate.
Content: views, retention, shares, saves, comments, followers, DMs.
Funnel: DMs→calls→appointments→sales, per source.
Referral/Reputation: referrals/mo, reviews, rating.
Efficiency: ROI, return on time invested (ROTI).

---

## 7. Debt & Risk Register (honest)

- **Technical:** single-user localStorage; no server DB; analytics require a capture layer
  that doesn't exist yet; live AI depends on `ANTHROPIC_API_KEY` + account model access.
- **Documentation:** most agents are conceptual; SOPs not yet written.
- **Business:** content/distribution is manual; referral + follow-up are not yet systematized.
- **Competitive advantage today:** speed, trust-first voice, and an owned, accessible OS.

---

## 8. Version History

| Version | Date | Change |
|---------|------|--------|
| v1.0 | 2026-06 | Foundation complete; Operations Manual established. Metrics start at 0; live Fable-5 brain wired with model-fallback. |
| v1.1 | 2026-06 | Phase 1 begins: **CEO Daily Briefing** shipped (pace strip + AI board meeting, cached, read-aloud). |
| v1.2 | 2026-06 | **Follow-Up Engine (B1)** shipped: prospect aging + SLA → daily due list, one-tap Logged / Call / AI revival draft; briefing now cites real quiet-timers. |
| v1.3 | 2026-06 | **Measurement capture (B2)** shipped: one-tap funnel (leads→appts→sales) + source-ROI table; briefing cites the funnel + best source. |
| v1.4 | 2026-06 | **Playbook / SOP library (B3)** shipped: versioned scripts + runnable prompts, use-counts, starters. **Phase 1 (Executive Layer) complete.** |
| v1.5 | 2026-07 | **Customer Intake** shipped: command-driven, vision-capable extraction of prospects/sold customers from any upload, with multi-deal grouping, 4-bucket review, and one-tap create + merge. Proxy now accepts a per-request system prompt + images/PDF. |

_Next: **Phase 2 — Growth Engines** (Content OS, Referral System). Intake now feeds the customer base that outreach + referral depend on._
