# 19 · AI Opponent (CPU) — for 1 v CPU

> Bible §40 (AI), §46 (skill tiers). Reference brain: [`../scripts/ai-policy.mjs`](../scripts/ai-policy.mjs) (validated against the composition sim). This is the design for single-player / practice / co-op-vs-CPU.

## The one rule: intelligence before statistics (§40)

**The CPU plays by the same visible rules as a human.** It never gets secret HP, damage, armor, or income. Difficulty scales the *quality of its decisions* — scouting, build order, composition, positioning, timing, micro — **not** the unit stats. Any economic help at the top tiers is **small, optional, and disclosed on the difficulty screen** (§40). Everything the CPU "knows" it must have scouted; fog-of-war applies to it too.

This is not a slogan — it's testable: the reference brain reads the *same* `data/units/*.json` and resolves fights with the *same* [`combat-core.mjs`](../scripts/combat-core.mjs) a human's units use, and its edge at higher tiers comes only from picking a better composition (see the self-test below).

## Architecture — four decision layers, all reading the balance data

The CPU is a policy over the data files, not a scripted build. Each layer has a clean input→output and a data source, so the eventual engine just wires perception and actuation to it.

| Layer | Decides | Reads | Grounded in |
|---|---|---|---|
| **Economy** | when to expand, wood-floor vs ore-push, tech timing | [`economy.json`](../data/economy.json), [`resources.json`](../data/resources.json), [`timings.json`](../data/timings.json) | §11 payback bands · ore soft-tech-gate (can't tech past tier-1 on wood alone) |
| **Composition** | what to build to answer what it scouts | [`data/units/*.json`](../data/units) `answers`/`counteredBy`/`resist` | §5 counters · §10 combined-arms (a mix beats spam) |
| **Positioning** | where to fight/expand/defend | [`data/maps/*.json`](../data/maps) | §37 high ground (first-strike), chokes (splash), ramps, relay towers (detection) |
| **Engagement** | commit / retreat / focus-fire / kite | [`combat-rules.json`](../data/combat-rules.json), `combat-core` | §6-8 effective-HP, range/first-strike, retreat |

## Difficulty tiers (§40 × §46) — decisions, not stats

Each tier maps to a §46 skill band and degrades **only** the decision layers:

| Tier | §46 band | Composition | Economy | Positioning / micro | Disclosed eco help |
|---|---|---|---|---|---|
| **Easy** | new | naive even mix; slow to react | one base, late expand | ignores high ground; no focus-fire | none |
| **Normal** | bronze–silver | counters its single biggest scouted threat | standard expand + payback-timed | takes obvious high ground; basic focus | none |
| **Hard** | gold–platinum | multi-counter mix; drops filler | ore-push for tech on time | holds ridges, uses ramps, brings detection | none |
| **Expert** | diamond+ | **best-response** mix (drops short-range filler vs long-range, uses faction mechanics) | efficient wood-floor + ore-ceiling, tech on the early window | first-strike from high ground, kites, retreats hurt units, captures relays | **small, disclosed** (e.g. +5–10%) only if enabled |

The gap between Easy and Expert is entirely **which composition it picks and how it fights** — the exact axis the composition sim already measures (naive even-split vs best-response). That is why the same balance data both defines the game *and* powers a legal opponent.

## Reference brain & self-test ([`ai-policy.mjs`](../scripts/ai-policy.mjs))

The composition layer is implemented now and **validated against the sim**, to prove the data is sufficient to drive a competent, legal CPU:

- **Input:** the AI's faction + the enemy composition it has scouted, a budget.
- **Counter scoring:** each of its faction's armed units is scored against the enemy by effective-HP efficiency (the same `effHP`/`pdps` the game uses) and the `answers`/`counteredBy` matrix; it assembles a mix, weighted toward the enemy's biggest threat, within budget.
- **Difficulty:** `easy` returns a naive even mix; `expert` returns the best-response (filler dropped, mechanics on).
- **Self-test:** for each faction, the brain answers a set of enemy mono-comps and the result is scored with `composition.mjs`'s `battle()`. Expert should beat the spams Easy loses to — with identical unit stats on both sides. That delta **is** the difficulty, and it's produced without a single stat cheat (§40).

## Not yet (needs the engine)

Perception (fog-of-war scouting), actuation (pathing, unit orders, build queue), and real-time micro are engine features. The four layers above are engine-agnostic policies; when the playable build exists, it supplies observations and executes the brain's decisions. Campaign AI (§41) may additionally use scripted reinforcements/bosses, but **standard units still behave consistently** and difficulty still isn't secret stats.
