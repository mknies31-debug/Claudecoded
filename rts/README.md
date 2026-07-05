# RTS Balance Spec

A structured, buildable version of the **Competitive Balance Bible** for a modern Command & Conquer–style RTS. The 50-section design doc is reorganized here into themed prose (`design/`) with every number extracted into machine-readable data (`data/`) and a trackable launch gate (`CHECKLIST.md`).

**Central principle:** the player who *scouts better, spends more efficiently, positions more intelligently, and adapts faster* should usually win — while each faction keeps a distinct personality.

## How this is organized

| Read this… | for… | Bible § |
|---|---|---|
| [design/00-philosophy.md](design/00-philosophy.md) | principle, 5 layers, 20 commandments | 1–3 |
| [design/01-factions.md](design/01-factions.md) | power budget, profiles, counter coverage | 4–5 |
| [design/02-combat-math.md](design/02-combat-math.md) | unit value, effective HP, DPS, cost-efficiency | 6–8 |
| [design/03-combat-systems.md](design/03-combat-systems.md) | anti-spam, composition, range, armor facing, air, stealth, disables, defenses, repair, veterancy | 9–10, 22–32 |
| [design/04-economy.md](design/04-economy.md) | starting parity, payback, income curve, harassment, comebacks | 11–14 |
| [design/05-game-flow.md](design/05-game-flow.md) | openings, rush protection, tech timing, upgrades, production, build times, command capacity | 15–21 |
| [design/06-power-units.md](design/06-power-units.md) | heroes, epic units, superweapons, support powers | 33–36 |
| [design/07-maps.md](design/07-maps.md) | per-map tests, pool diversity | 37–38 |
| [design/08-quality.md](design/08-quality.md) | RNG, AI, campaign, teams, testing, simulation, telemetry, skill tiers | 39–46 |
| [design/09-process.md](design/09-process.md) | patch process, patch size, warning signs | 47–49 |
| [design/10-art-direction.md](design/10-art-direction.md) · [style/](style/index.html) | "slightly cartoon, but detailed" — palettes, cel-shading, damage states, + a visual style guide | — |
| [design/11-budget-options.md](design/11-budget-options.md) | faction-budget fix (Option B canonical) | 4 |
| [design/12-directorate-roster.md](design/12-directorate-roster.md) · [data/units/directorate.json](data/units/directorate.json) | Directorate roster (15 units, validated) | 5, 9, 20 |
| [design/13-covenant-roster.md](design/13-covenant-roster.md) · [data/units/covenant.json](data/units/covenant.json) | Covenant roster (16 units, validated) | 5, 9, 20 |
| [design/14-array-roster.md](design/14-array-roster.md) · [data/units/array.json](data/units/array.json) | Array roster (15 units, validated) — all 3 factions complete | 5, 9, 20 |
| [design/15-matchup-findings.md](design/15-matchup-findings.md) | duel sim (counters) — findings + fixes | 6–8 |
| [design/16-composition-findings.md](design/16-composition-findings.md) | army-composition sim (mixed vs spam) — infantry-spam fix + backlog | 10 |
| [lab/](lab/index.html) | interactive balance calculator + budget validator | 6–9 |
| [CHECKLIST.md](CHECKLIST.md) | launch certification gate — **20/20 design gates pass** ([certify.mjs](scripts/certify.mjs)) | 50 |

## Scripts (the checks)

Everything provable on paper is proven by a script — run any of them from the repo root:

| Script | Verifies |
|---|---|
| [`scripts/validate-roster.mjs`](scripts/validate-roster.mjs) | per-faction roster: anti-spam (§9), build bands (§20), threat coverage (§5), effective-HP sanity |
| [`scripts/matchup.mjs`](scripts/matchup.mjs) | duel simulator (§6–8) — do counters actually counter? |
| [`scripts/composition.mjs`](scripts/composition.mjs) | army-composition simulator (§10) — combined arms vs mono-spam |
| [`scripts/certify.mjs`](scripts/certify.mjs) | **launch auditor (§50)** — all design-verifiable checklist gates, runtime gates flagged pending |
| [`scripts/build-lab-data.mjs`](scripts/build-lab-data.mjs) · [`scripts/build-prototype-data.mjs`](scripts/build-prototype-data.mjs) | re-inject roster JSON into the lab / prototype (keep them in sync with `data/units/`) |

**Interactive:** [`lab/index.html`](lab/index.html) — balance calculator + budget validator · [`prototype/index.html`](prototype/index.html) — **visual battle sandbox** that animates the composition sim (mixed vs spam) with the faction art · [`style/index.html`](style/index.html) — cel-shaded style guide. All single-file, offline.

## Data files (the numbers)

Everything quantitative is JSON so a balance tool, simulator, or prototype can read it directly:

- [`data/balance-targets.json`](data/balance-targets.json) — win-rate/match-length targets, cost-efficiency table, efficiency-score bands, warning signs, skill tiers
- [`data/factions.json`](data/factions.json) — 100-pt power budget per faction, counter-coverage matrix
- [`data/timings.json`](data/timings.json) — tech windows, build times, command capacity, disable durations, stealth reveal, superweapon timing
- [`data/economy.json`](data/economy.json) — payback periods, income curve, lead limits, harassment windows, comeback tools
- [`data/resources.json`](data/resources.json) — the two harvestable resources: wood (cheap/fast/renewable floor) vs ore (valuable/slow/finite ceiling)
- [`data/terrain.json`](data/terrain.json) — high-ground modifiers (offensive + defensive), natural barriers, choke widths, per-map terrain tests
- [`data/combat-rules.json`](data/combat-rules.json) — unit-value/DPS formulas, anti-spam rule, armor facing, terrain, upgrades, veterancy, repair, air, epic, hero, support, RNG rules

## The three factions

| | Directorate | Covenant | Array |
|---|---|---|---|
| **Identity** | durable combined-arms; reliable economy; easy to play | fast, sneaky, harass-and-expand; fragile | tech/control specialist; shields & manipulation |
| **Ranks #1 in** | durability, direct combat, ease of use | expansion, pressure, mobility, stealth | battlefield control, tech scaling |
| **Pays with** | expansion, mobility, stealth | durability, late combat, simplicity | early pressure, replacement speed, economy |

## Open questions
_Things that need a design decision — flagged, not silently resolved._

1. ~~Faction budget doesn't total 100, and its "≤3 leads" rule is impossible.~~ **RESOLVED** — adopted **Option B** (8 categories, equal 150; ease-of-use moved to a complexity tag) as canonical in [`factions.json`](data/factions.json). Rationale + the two rejected alternatives (equal-100, difficulty-weighted) kept in [design/11-budget-options.md](design/11-budget-options.md).
2. ~~**Faction names** — Directorate / Covenant / Array: final or placeholders?~~ **RESOLVED (canonical working names).** They carry no balance weight and are internally consistent with each identity (a durable state force, a scrappy raider coalition, a tech collective). Treated as final unless renamed — a pure re-label, no data impact.
3. ~~**Superweapon vs comeback tension** — §35.~~ **RESOLVED — the systems can't combine into a turtle.** Superweapon *activation* lands at 14–22 min ([`timings.json`](data/timings.json)) and §35 requires it to force action; the §14 emergency recovery grants **only a discounted replacement collector — no free resources, income, or combat bonus** ([`economy.json`](data/economy.json)), so it stabilizes a broken economy without funding a stall. Neither pays for passivity. Flag re-opens only if telemetry shows superweapon-only wins >5% (a §50 gate) or match length skewing >40 min.
4. ~~**Command capacity vs "no strict pop cap"** (§21).~~ **RESOLVED** in [design/05 §21](design/05-game-flow.md): generous base capacity, advanced command structures raise it, and going over **slows production rather than destroying units** (costs: squad 1 · light vehicle 2 · tank 3 · artillery/aircraft 4 · epic 15). Discourages extreme counts without dictating normal army size.

## Status

**The spec is internally certified and ready to hand to an implementation.** Everything provable on paper is proven:
- 3 factions × ~15 units each, all validating **0 failures / 0 warnings** (`validate-roster.mjs`)
- Duel counters: **0 broken** (`matchup.mjs`)
- Combined-arms beats mono-spam with **no §49 spam unit** (`composition.mjs`) — residual flags are **self-classified** (best-response test) into mis-weighting vs §8 cost questions, none tuned away
- Two-resource economy **wired and verified** — `economy-check.mjs` (58/58): payback bands, wood-floor/ore-ceiling invariants, ore soft-tech-gate, roster gatherers
- Launch checklist: **20/20 design gates pass** (`certify.mjs`)

Everything left is, by nature, **runtime**: it can only be proven by a playable build — real win rates, match-length curves, replay/telemetry systems, AI legality, in-engine visual readability, and authored competitive maps. See [CHECKLIST.md](CHECKLIST.md) for the exact split.

### Known backlog (scoped, non-blocking)
- ~~**Unify the two combat cores**~~ **DONE** — both sims now share [`combat-core.mjs`](scripts/combat-core.mjs) (effective-HP, DPS, kiting, first-strike). This **resolved the original heavy-tank flag** (Directorate mix vs Vanguard spam: 28% loss → 54% win) and duels stay 0-broken. [design/16](design/16-composition-findings.md), [design/17](design/17-architecture-review.md) P0.1
- ~~**Mechanic-aware composition sim**~~ **DONE (v1)** — `composition.mjs --mechanics` models Covenant's utility anti-armor (stealth/flank/mine/hijack) as opt-in hooks; default report stays byte-identical. [design/16](design/16-composition-findings.md)
- **High-alpha spam cost-efficiency (§8)** — the composition sim's `best-response` test isolates **2 genuine cost questions**: Nullifier (dmg 300, `ignoreResist`, r7) and massed MBTs beat even a scouted mix on cost. A §8 cost-curve pass (duel tool) is the right instrument — a deliberate tuning/playtest decision, not a sim fix. [design/16](design/16-composition-findings.md)
- **Competitive maps** — [`terrain.json`](data/terrain.json) defines the high-ground / barrier / choke rules and the §37 tests; actual map files remain to be authored.
- ~~**Browser prototype**~~ **DONE** — [`prototype/index.html`](prototype/index.html) animates the composition sim (mixed vs spam, any faction, any budget) using the exact certified combat model. A full *playable* real-time skirmish (the thing that closes the runtime win-rate gates) is the natural next engineering step.
