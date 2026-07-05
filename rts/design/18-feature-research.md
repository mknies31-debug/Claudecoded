# 18 · Feature Research (backlog → cited proposals)

> Turns the [README](../README.md) "Known backlog" + "Open questions" and the two residual [§16](16-composition-findings.md) flags into concrete, evidence-based proposals. Every recommendation is grounded in how a shipped RTS actually solves the same problem, cited inline. **Fact** (how a shipped game works, from an authoritative source) is kept separate from **inference** (my read of what that implies for us). Nothing here changes existing files — it is the design case for the next engineering steps.
>
> Data touched by these proposals: [`combat-rules.json`](../data/combat-rules.json) · [`terrain.json`](../data/terrain.json) · [`resources.json`](../data/resources.json) · [`units/covenant.json`](../data/units/covenant.json) · scripts [`composition.mjs`](../scripts/composition.mjs) · [`matchup.mjs`](../scripts/matchup.mjs).
>
> Each section ends with an **effort × impact** tag.

---

## 1 · Mechanic-aware combat simulation

The centerpiece. [`composition.mjs`](../scripts/composition.mjs) resolves combat as *DPS × effective-HP × splash*, focus-firing the lowest-effHP target. That model structurally cannot represent Covenant's *utility* anti-armor — Hijacker (`dmg 0`), Mine Layer (`dmg 0`), Ambush Tank (stealth + rear-armor). [§16 flag #2](16-composition-findings.md) (Covenant mix loses to Marauder spam 55%) is a **known model blind spot**, not a confirmed balance bug. This section proposes the minimal data + resolution changes to close it.

### How shipped games do it

- **Unit conversion (hijack).** C&C *Red Alert* Engineers and the Tanya/Hijacker lineage remove a vehicle from the enemy and hand it to you — but the mechanic is deliberately throttled so it can't be spammed: in *Red Alert / Tiberian Dawn* a building had to be beaten to red health first, added specifically "to make Engineer spam less effective" ([C&C Wiki — Engineer (RA1)](https://cnc.fandom.com/wiki/Engineer_(Red_Alert_1)), [Capture (Red Alert)](https://cnc.fandom.com/wiki/Capture_(Red_Alert))). The unit is **consumed on use** and normally **unarmed**, so it trades one expendable body for one high-value target and dies to any escort. *Fact.*
- **Pre-placed area damage (mines).** CoH mines are placed ahead of time and detonate on trigger, independent of the layer surviving. *Teller* anti-tank mines "only detonate under the pressure of a vehicle… cannot be triggered by infantry" — i.e. the trigger is **armor-class-gated** — and are "tougher than regular mines by a factor of over 500%," making them slow to clear ([CoH Wiki — Teller Mines](https://companyofheroes.fandom.com/wiki/Teller_Mines)). They are a one-time burst tied to a route, not sustained DPS. *Fact.*
- **First-strike from stealth (ambush).** SC2 *Dark Templar* are "permanently cloaked… stealthy assassins" with burst high enough to one-shot workers; *Widow Mines* are "cloaked when initially burrowed," fire a 125-damage sentinel missile, then **decloak during cooldown** — the alpha strike lands from concealment, and the unit is exposed afterward, hard-countered by detection ([Liquipedia — Dark Templar](https://liquipedia.net/starcraft2/Dark_Templar_(Legacy_of_the_Void)), [Widow Mine](https://liquipedia.net/starcraft2/Widow_Mine_(Legacy_of_the_Void))). The design pattern is **one free opening volley, then vulnerability**. *Fact.*
- **Facing / rear armor.** CoH resolves this as a *penetration* roll that rises when the shot lands on "the entire 180° section that comprises the rear part of the tank"; flanking is a deliberate risk/reward choice and "attacking an enemy vehicle's rear armor is preferable if it can be managed" ([CoH Wiki — Penetration (coh2)](https://companyofheroes.fandom.com/wiki/Penetration_(coh2))). Our [`combat-rules.json`](../data/combat-rules.json) `armorFacing` already encodes the numbers (front 0.90 / side 1.10 / **rear 1.30**); the sim just doesn't apply them. *Fact.*

### Recommendation for this project

Add four optional data fields and resolve them in a fixed order **around** the existing DPS loop, so the current engine is untouched for units that don't use them. This is deliberately minimal — no new combat model, just pre/mid-loop hooks.

**New optional unit fields** (all default off, so every existing unit behaves exactly as today):

```jsonc
// Hijacker — unit conversion
"convert": { "vsArmor": ["heavy","medium","epic"], "perUnitSec": 16 }
// Mine Layer — pre-placed area damage (one-time alpha)
"mine": { "damage": 300, "dmgType": "explosive", "charges": 6, "triggerArmor": ["heavy","medium","light"] }
// Ambush Tank — first-strike from stealth
"stealth": { "ambushSec": 3, "rear": true }
// any flanker/fast/stealth unit — apply rear-armor facing
"flank": true
```

**Resolution order** (a small, testable change to `battle()`):

1. **Mines — upfront alpha.** Before the main loop, each `mine` unit deals `min(charges, aliveTriggerTargets) × damage` of `dmgType` to enemy units whose `armor ∈ triggerArmor`, using the existing `effHP` path so resistances still apply. Independent of whether the layer survives (matches "pre-placed"). Apply a **detection discount** (e.g. ×0.5) if the enemy side contains a detector unit — mirrors CoH's clear-ability and our own `Recon Hound`/`Sensor Spike`.
2. **Stealth ambush — free opening volley.** `stealth` units fire `ambushSec` seconds of un-returned `pdps` before the main loop (reuse `matchup.mjs`'s existing first-strike window pattern, lines 47–54). If `rear:true`, multiply that volley by `armorFacing.rear` (1.30) against facing-eligible targets. Nullify the window entirely if the enemy has a detector — the SC2 detection counter, and consistent with the Ambush Tank's own `weaknesses: ["detection"]`.
3. **Main DPS loop — unchanged**, except `flank:true` attackers apply `armorFacing.rear` (1.30) to their effHP calc against units in `armorFacing._applyTo` (tanks/heavy vehicles/epic). This is a one-line change in `step()`'s `effHP` call.
4. **Hijack — conversion during the loop.** Each `convert` unit removes `n / perUnitSec` units/sec of the highest-cost eligible enemy type from the enemy pool (it *deletes* value; a v2 could re-add the stolen unit to the owner's side). Bounded by target availability and by the hijacker's own survival — it carries `dmg 0` and low HP, so enemy fire in the same tick attrits it first, which is exactly its `weaknesses: ["infantry","focused fire"]`. This preserves the C&C throttle: one expendable body per high-value target, escort-punishable.

**Why this is enough.** The four hooks map 1:1 onto the four unrepresented mechanics named in [§16](16-composition-findings.md), reuse existing helpers (`effHP`, `pdps`, the first-strike loop, `armorFacing`), and each keeps the mechanic's real-world counter (detection, escort, sustained fights). *Inference:* re-running `composition.mjs` with these should move Covenant-vs-Marauder off the ⚠ decisive band without touching any unit's tuning — converting the flag from "silent blind spot" to a modelled, testable result. Keep the DPS-only path as the default so Directorate/Array numbers are bit-for-bit stable.

**Effort: Medium · Impact: High** (unblocks the largest documented analysis gap; unlocks honest Covenant-vs-armor numbers).

---

## 2 · High-ground rules

Current [`terrain.json`](../data/terrain.json): shooting **down** +15% dmg / +15% range / full vision; shooting **up** −15% dmg / −10% range / reduced vision; area weapons exempt from the up-penalty; melee/short-range unaffected; every modifier sits at or below the armor-facing swing.

### How shipped games do it

| Game | Elevation model | Source |
|---|---|---|
| **StarCraft II** | **Vision only — no damage bonus.** Low-ground units can't see up a cliff and "cannot counterattack unless vision is gained"; the edge is pure information asymmetry. | [Liquipedia — High/Low Ground](https://liquipedia.net/starcraft2/High_Ground_and_Low_Ground) |
| **Age of Empires II** | **~25% both ways** — attacker on the hill deals ≈+25%, takes ≈−25% (the guide notes a real range of ~20–33%), plus an uphill-ranged miss chance. | [AoE Wiki — Elevation](https://ageofempires.fandom.com/wiki/Elevation), [Steam guide](https://steamcommunity.com/sharedfiles/filedetails/?id=637133974) |
| **Company of Heroes** | Elevation folds into the cover/line-of-sight system (accuracy, suppression, sight) rather than a flat damage multiplier. | [CoH Wiki — Penetration (coh2)](https://companyofheroes.fandom.com/wiki/Penetration_(coh2)) |
| **C&C (Tiberium/RA)** | Largely **vision/range**, minimal or no flat combat multiplier. | (series design; see §3 sources) |

The spectrum runs from **SC2 (info-only, no damage)** to **AoE2 (~25% two-way damage swing)**. *Fact.* The clear modern-competitive trend (SC2, and open-source BAR) is to make high ground primarily a **scouting/vision** advantage, because a *damage* bonus stacked on top of a *vision* advantage compounds into hard-to-break holds. *Inference.*

### Recommendation for this project

**Keep the model — it is squarely within shipped norms — with one trim to consider.** Our net ~30% swing is *below* AoE2's ~25%-each (which compounds to a larger effective swing) and *above* SC2's zero, a defensible middle. The design already borrows the two features that keep high ground breakable in every shipped game:

- **Vision asymmetry is the primary lever** (matches SC2's info-centric philosophy) — good, keep it exactly.
- **Area weapons ignore the shoot-up penalty** — this is the AoE/CoH "dislodge the hill with splash" answer and is the single most important anti-turtle valve; keep it prominent.

*Trim to weigh:* because the holder already gets **+range and full vision** (a first-strike/scouting edge on its own), the additional flat **+15% damage** shooting down is the part that "double-dips." Consider dropping the shoot-down **damage** bonus to +0–10% while keeping the **range + vision** asymmetry, nudging the model toward the SC2 end. Rationale: range+vision already decides who shoots first; the flat damage bonus is what risks making an artillery-on-hill nest oppressive (already a named §37 test item). This is a rationale, not a required change — the current numbers are shipped-game-legal.

**Effort: Low · Impact: Low** (a numbers-only tweak in `terrain.json`; the current values are already sound).

---

## 3 · Two-resource economies — should ore gate tech?

The [open question](../data/resources.json) (also flagged in [§04](04-economy.md)): should ore be a **hard second currency** (units/tech cost ore directly) or stay a **pure credit source** with a different risk profile?

### How shipped games do it

- **StarCraft II — two resources, gas gates tech.** Minerals are "the primary resource… used by all three races," while vespene gas is "more specialized and valuable for advanced tech." A base holds minerals:gas at a ~12:5 ratio, and gas is deliberately slower (4 per trip, 2,250 per geyser), so **gas scarcity constrains how quickly you reach gas-dependent tech** ([Liquipedia — Resources](https://liquipedia.net/starcraft2/Resources), [Blizzard — Resources guide](https://news.blizzard.com/en-us/article/4488900/game-guide-resources)). Crucially you can *float on minerals* but you **cannot tech or field advanced units without gas** — this is SC2's single most important pacing lever. *Fact.*
- **Age of Empires II — four resources, hard-gated by role.** Food gates villagers/age-ups/most units; **stone is near-exclusively gated to defenses/Castles/Wonders** and is the rarest node ([AoE Wiki — Resource](https://ageofempires.fandom.com/wiki/Resource), [Liquipedia](https://liquipedia.net/ageofempires/Resources)). A Market lets you convert at moving rates, so a bottleneck is painful but not a hard lock. *Fact.* Multi-resource hard-gating creates real "resource bottlenecks that can cripple your economy" if mismanaged. *Fact (AoE guide).*
- **C&C — single resource, expansion by design.** *Tiberium Wars* uses Tiberium as "the game's sole resource" (plus optional spikes); RA3 replaced scattered ore fields with **discrete ore mines specifically to force expansion**, since a single field just let you stack refineries in your base ([StrategyWiki — TW Economy](https://strategywiki.org/wiki/Command_&_Conquer_3:_Tiberium_Wars/Economy), [C&C Wiki — Ore](https://cnc.fandom.com/wiki/Ore)). *Fact.* A single credit pool keeps the economy simple but makes map control a pure *income* contest, not a *tech* contest.

### Recommendation for this project

**Make ore a *soft* tech-gate, not a hard second currency.** Concretely: keep **both resources convertible to credits** (so a denied Covenant's un-killable wood floor still fields a tier-1 army and stays alive — the identity in [§04](04-economy.md) / [`resources.json`](../data/resources.json)), **but require an ore component on advanced tech**: tier-2/tier-3 production structures and the key [§18 upgrades](../data/combat-rules.json) cost *credits + ore*, while tier-1 army and all economy cost credits only.

Rationale, mapped to our design:
- This is **exactly the SC2 minerals/gas split**, which is the cleanest pacing lever in competitive RTS: you can survive and mass basics on the safe resource, but **the tech ceiling is behind the contested resource**. That is verbatim what `resources.json` already says ore is *for* — "wood keeps you alive, ore lets you win" — so a soft tech-gate makes the ore contest **unskippable** without contradicting the floor/ceiling framing.
- It **avoids the AoE hard-bottleneck failure mode** and, more importantly, avoids hard-locking a map-denied Covenant out of the game — which a pure-ore unit cost would do, directly contradicting the "fall back on the wood floor" identity and the [§14](04-economy.md) comeback rules.
- It makes map control a **tech-timing** contest, not only an income contest — the C&C "force expansion" goal, achieved through the tech curve rather than node geometry.

*Implementation note:* this touches [`economy.json`](../data/economy.json) (add an ore-cost band to tier-2/3 and upgrades) and the roster tier fields, not the combat sim. Keep the wood floor able to sustain tier-1 + economy indefinitely so it remains a true floor. Resolve the open question in `resources.json` to **"soft tech-gate: ore required for advanced tech, both resources still credit-convertible."**

**Effort: Medium · Impact: High** (resolves a standing open question; adds the game's primary mid-game pacing lever).

---

## 4 · Anti-swarm / flame unit design (Scorch Buggy)

We added the **Scorch Buggy** ([§16](16-composition-findings.md), [`covenant.json`](../data/units/covenant.json)): `cost 520, hp 470, range 4, aoe 5, dmg 30, reload 1, dmgType explosive`, fragile, folds to armor/artillery — Covenant's dedicated anti-swarm.

### How shipped games do it

CoH is the canonical reference for balancing flame anti-infantry, and its history is a cautionary tale we can learn from directly:

- **Design intent:** flamers "should be effective against units in bunkers and buildings and **ignore cover bonus** but not do crazy damage on units just fighting them in the open" ([CoH2 discussion, dev-cited intent](https://steamcommunity.com/app/231430/discussions/0/364040961448253581/)). The role is **dislodging entrenched/clustered infantry**, not general DPS. *Fact.*
- **The KV-8 lesson (over-tuned flame):** the KV-8 flame tank "practically deleted infantry instantaneously… with no reaction time to survive except mass retreating" — a textbook over-powered anti-swarm unit. *Fact.*
- **The fixes:** (a) building/cover damage multipliers were **reduced** (buildings 2→1.5, heavy cover 2→1.25, light cover 1.25→1) explicitly "to allow players more time to react"; (b) **all flamethrowers are nerfed so they cannot hurt tanks**, because giving them both range and effectiveness vs armor "would make flamethrowers unreasonably effective" ([CoH2 Wiki — KV-8](https://companyofheroes2.fandom.com/wiki/KV-8), [coh2.org — flamer range](https://www.coh2.org/topic/29222/flame-thrower-range-needs-to-be-reduced/page/1)). *Fact.* The two guardrails are **short range → reaction window**, and **hard-capped vs anything that isn't infantry**.

### Recommendation for this project

**Validate the approach — it already implements CoH's two guardrails — with one hardening tweak.** The Scorch Buggy's `range 4` (must close, giving the [§13](04-economy.md) reaction window) and its `explosive` damage into infantry's negative explosive resist (Raider `explosive: -25`) match the CoH pattern precisely, and its own [`terrain.json`](../data/terrain.json) area-weapon exemption is the "ignore cover, dislodge the hilltop" role verbatim. The [§16](16-composition-findings.md) sim already confirms it is **not** a new §49 spam unit (a Directorate mix still beats Scorch spam).

**One hardening lever, straight from the KV-8 fix:** the biggest failure mode for flame anti-swarm is *generality* — becoming good against everything. CoH's answer was to make flamers **unable to meaningfully hurt tanks**. We approximate this today only via armor resistances (heavy tank `explosive 20`). Consider making it explicit: an optional **armor-class damage falloff** so the Scorch Buggy's damage is full vs `infantry/light`, sharply reduced vs `heavy/epic` — a small `"vsArmorMult"` field in [`covenant.json`](../data/units/covenant.json), read by both sims. This guarantees it can *never* drift into a general-purpose spam even if HP/cost are later retuned, and formalizes the "folds to armor" note as a mechanic rather than an emergent accident. *Inference:* low risk, since it only *reduces* damage in the matchups where the unit is already meant to lose.

**Effort: Low · Impact: Low–Medium** (the unit is sound; this makes its intended weakness a guaranteed mechanic, not an emergent one).

---

## 5 · Heavy-tank cost-efficiency

[§16 flag #1](16-composition-findings.md): a weighted anti-armor mix *still* loses ~19% to pure Vanguard (Directorate) / Marauder (Covenant) spam — a **heavy-tank cost-efficiency** problem the composition sim only *flags*; the fix belongs in the §8 duel/cost tool.

### How shipped games do it

The generalized problem is real and named: in several C&C games "mainline battle tanks were cost efficient and well rounded to the point that many games came down to whomever was best at building and preserving their tank ball" ([Wayward Strategy — Hard Counters](https://waywardstrategy.com/2021/07/27/hard-counters/)). *Fact.* The shipped levers against it:

1. **Hard counters that are cost-positive.** The case *for* hard counters is precisely that they let a cheaper, specialized unit reliably punish a massed general-purpose one — the anti-tank must win *per credit*, not merely "win eventually" ([Wayward Strategy — Hard Counters](https://waywardstrategy.com/2021/07/27/hard-counters/)). *Fact.*
2. **Supply / population weight.** SC2 uses supply cost to shape army composition over time and to stop counter-units from over-massing — "it's important that designated counter-X units don't benefit too greatly from massing"; the Siege Tank's long reload and air/mobility weaknesses exist so a tank *ball* isn't a free win ([Maguro — Supply & limits](https://www.maguro.one/2021/01/supply-limits.html), [Liquipedia — Siege Tank](https://liquipedia.net/starcraft2/Resources)). *Fact.*
3. **Upkeep / income drag.** CoH ties a **population upkeep tax** to army size — a bigger army earns less resource income, a direct brake on snowballing a single unit type ([Game Developer — Cost of Combat in RTS](https://www.gamedeveloper.com/business/avenues-for-success-and-the-cost-of-combat-in-rts)). *Fact.*
4. **Cost curves / speed bumps.** Superlinear cost or tech "speed bumps" keep raw durability-per-credit from scaling freely ([Wayward Strategy — Speed Bumps](https://waywardstrategy.com/2021/10/04/the-importance-and-challenge-of-speed-bumps-in-rts-economies/)). *Fact.*

### Recommendation for this project — concrete levers, cheapest first

We already own three of these four levers; the flag is a **tuning** problem, not a missing system.

- **(a) §8 cost pass on the MBTs — the primary fix.** Run [`matchup.mjs`](../scripts/matchup.mjs) at equal cost and target the *effHP-per-credit* and *DPS-per-credit* of Vanguard / Marauder. A small cost-up or HP-down that leaves duels 0-broken but pulls tank-spam off the ⚠ band is the intended instrument (the composition sim only surfaced it). **Do this first.**
- **(b) Make the anti-tank counter cost-positive.** Per the hard-counter principle, verify Lancer TD / Missile Trooper *win per credit* vs the MBT in `matchup.mjs` (the curated table already asserts `Lancer Tank Destroyer vs Vanguard MBT → strongCounter`). If the counter only wins the duel but not the *cost race*, tank spam stays dominant in the composition sim; nudge the counter's cost or anti-armor damage until it's cost-positive.
- **(c) Lean on the command-capacity weight we already have.** [§21](05-game-flow.md) already prices tanks at command cost **3** and *slows production* past capacity — a soft pop-weight. This is the SC2 supply lever in everything but name; confirm it's actually reflected when scaling large single-type armies, and consider raising the tank command cost specifically if (a)+(b) don't fully resolve it.
- **(d) Optional, larger: CoH-style upkeep.** If tuning alone won't hold, an income-vs-army-size drag in [`economy.json`](../data/economy.json) is the strongest structural brake on any mono-spam (not just tanks). Flag as a bigger change — only if (a)–(c) are insufficient.

*Inference:* (a)+(b) together should clear [§16 flag #1](16-composition-findings.md) without any new system, keeping duels 0-broken. Reserve (d) for the case where the mono-tank ball survives correct tuning.

**Effort: Medium · Impact: High** (resolves a residual §16 flag; strengthens the §10 central claim).

---

## Prioritized roadmap

Ordered by *impact ÷ effort*, and by what unblocks the most downstream analysis.

| # | Item | Effort | Impact | Why this order |
|---|---|---|---|---|
| 1 | **Mechanic-aware sim** (§1) — four optional fields + resolution hooks in `composition.mjs` | Med | High | Closes the single largest documented blind spot ([§16 flag #2](16-composition-findings.md)); every future Covenant-vs-armor number depends on it. Default-off fields keep all existing results stable. |
| 2 | **Ore soft tech-gate** (§3) — resolve the open question; ore required for advanced tech, both resources still credit-convertible | Med | High | Adds the game's primary mid-game pacing lever (SC2 gas model) and resolves a standing open question without breaking the wood-floor identity. |
| 3 | **Heavy-tank §8 cost pass + cost-positive counters** (§5, levers a+b) | Med | High | Resolves [§16 flag #1](16-composition-findings.md) with tools we already own; strengthens the §10 claim. Do before considering upkeep (lever d). |
| 4 | **Flame-unit armor falloff** (§4) — optional `vsArmorMult` guard on Scorch Buggy | Low | Low–Med | Cheap insurance that formalizes the KV-8 lesson; makes the unit's intended weakness a guaranteed mechanic. |
| 5 | **High-ground damage trim** (§2) — optionally reduce shoot-down flat damage toward the SC2 vision-primary end | Low | Low | Numbers-only; current values are already shipped-game-legal, so this is a refinement, not a fix. |

**Bottom line:** items 1–3 are the substantive work — a mechanic-aware sim (so Covenant's utility anti-armor is *modelled*, not asterisked), an ore soft tech-gate (so map control gates the tech ceiling the SC2 way), and a tank-cost pass (so no mono-spam beats combined arms). Items 4–5 are low-cost hardening. None requires a new combat model; all reuse existing data schemas and script helpers.
