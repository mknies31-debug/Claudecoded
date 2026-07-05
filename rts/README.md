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
| [CHECKLIST.md](CHECKLIST.md) | launch certification gate | 50 |

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
2. **Faction names** — Directorate / Covenant / Array: final or placeholders?
3. **Superweapon vs comeback tension** — §35 says superweapons must "force action"; confirm the discounted-collector emergency recovery (§14) and superweapon cadence don't combine into stalemate-y turtle metas.
4. **Command capacity vs "no strict pop cap"** (§21) — confirm the soft-cap slowdown curve so it discourages extreme counts without dictating normal army size.

## Not yet built (candidate next steps)
- **`rts/lab/`** — a single-file balance calculator that reads `data/*.json`: enter a unit's stats → effective-HP-by-damage-type, practical DPS, value/cost, and automatic flags against the target ranges and anti-spam rule.
- **`rts/prototype/`** — a minimal browser skirmish tuned to these numbers.
- **Unit datasheets** — `data/units/*.json` per faction, validated against the rules here.
