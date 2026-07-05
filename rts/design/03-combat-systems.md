# 03 · Combat Systems

> Bible §9–10, §22–32. Data: [`../data/combat-rules.json`](../data/combat-rules.json), [`../data/timings.json`](../data/timings.json).

## Anti-spam (§9)

Spam occurs when a unit has acceptable performance vs nearly everything, high mobility, low cost, low build time, no meaningful counter, and minimal control needs.

**Every general-purpose unit must have at least two exploitable weaknesses.**

*MBT example* — Strengths: strong vs vehicles/structures, durable. Required weaknesses: anti-tank infantry, aircraft, limited vision, slow turning, poor vs dispersed light infantry.

Mechanisms: armor-specific counters · area damage · minimum range · mobility differences · terrain restrictions · formation vulnerability · production limits **only when thematically justified**. Avoid arbitrary unit caps as the main solution — **the player should understand why spam failed.**

## Army composition (§10)

A healthy standard army has **3–5 unit roles** (e.g. MBTs, anti-infantry vehicles, AA, repair, recon). Single-unit armies may be a surprise/timing/low-level tactic but must not be the best all-purpose strategy.

Reward combined arms through **natural interaction** (vision, detection, range coverage, repair, target specialization, formation protection) — **not** a flat percentage bonus for mixing.

## Range & vision (§22)

A unit should not auto-fire at max range without **vision** of the target — creating a scout ↔ artillery ↔ aircraft ↔ radar ↔ high-ground relationship.

**Artillery** needs ≥3 weaknesses: minimum range · low durability · deployment time · slow movement · low vision · long reload · poor accuracy while moving. It dominates static targets but collapses when flanked.

## Mobility & retreat (§23–24)

Fast units get hidden value (choose fights, raid, escape, reinforce, capture) so they pay via reduced durability/damage, higher cost, limited target coverage, more control. **Fast factions must not also have the strongest direct combat at equal cost.**

Retreat is possible but costly: acceleration takes time, rear armor may be weaker, turning exposes, slows exist, fast units pursue. Escaping every losing battle without loss should not be easy.

## Armor facing (§25) — larger vehicles only

Front **90%** · Side **110%** · Rear **130%** damage. Apply to tanks, heavy vehicles, epic units — **not** every unit.

## Infantry terrain (§26)

- **Garrison:** more protection/vision, fixed firing positions; vulnerable to fire, explosives, clearing units.
- **Cover:** 15–25% ranged reduction; **no** protection vs area weapons.
- **Forest:** reduced detection range; **no** full invisibility while firing.

Infantry should be useful without forcing every map into urban combat.

## Air (§27)

Aircraft are strike assets, not universally superior. Limits: ammunition · refueling · airfield capacity (e.g. 4/airfield) · AA vulnerability · expensive replacement · predictable return path. Equal-cost dedicated AA strongly defeats unsupported aircraft but shouldn't annihilate them before a retreat attempt.

## Stealth (§28)

Creates information pressure, not helplessness. Every faction gets: Tier-1 mobile detector, defensive detector, Tier-2 advanced detector, temporary support-power detection. Reveal on firing/capturing/heavy damage/entering detection/certain abilities; **reveal after firing 2–4 s.**

## Disable & control effects (§29)

Durations (see `timings.json → disableDurationsSec`): slow 3–8 s · weapon disable 2–5 s · movement disable 1.5–4 s · full EMP 2–5 s · vision reduction 5–12 s · mind control requires channel/strict limit. **Diminishing returns:** 100% → 50% (within 10 s) → 25% → temporary immunity.

## Defensive structures (§30)

Support an army, don't become it. A defense may be more cost-efficient than a mobile unit *in its exact firing role* because it can't move/retreat, can be bypassed, depends on power, may be outranged. Every faction must be able to break a turtle: artillery · air attack · power disruption · superweapon pressure · alternate route. Heavy defense should cost expansion, mobility, tech, offense.

## Repair (§31)

- **Field:** moderate rate, reduced by enemy fire, limited resource/cooldown, vulnerable support unit.
- **Base:** faster, costs credits, needs facility/nearby structure.
- **Combat restriction:** units damaged in the last 3 s get reduced repair — no immortal armies.

## Veterancy (§32)

Veteran +8% dmg / +8% HP / slight accuracy. Elite +10% dmg / +10% HP / slow out-of-combat regen / minor ability. **Total combat-value gain normally < 35%.** Veterancy must not eliminate counter relationships.
