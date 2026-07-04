# 08 · Quality — RNG, AI, Campaign, Teams, Testing, Telemetry

> Bible §39–46. Data: [`../data/balance-targets.json`](../data/balance-targets.json).

## Randomness (§39)

Minimal in competitive combat. **Acceptable:** small accuracy variation at extreme range · minor projectile spread · predictable resource-regen range · cosmetic destruction. **Avoid:** random crits · random stuns · random instant kills · random resource bonuses · random support-power failures. Players should understand why an engagement ended as it did.

## AI (§40) — improve intelligence before statistics

- **Easy:** slower reactions, limited aggression, basic comps, no income bonus.
- **Normal:** standard economy, functional counters, moderate expansion.
- **Hard:** better scouting/comps/timing, small **optional disclosed** income bonus.
- **Expert:** adaptive build orders, coordinated attacks, strong ability use, efficient retreat, clearly disclosed economic bonus if used.

**Never secretly increase unit health, weapon damage, or armor.** The AI plays by recognizable rules.

## Campaign (§41)

Need not match ranked exactly. May use unique enemy structures, scripted reinforcements, boss units, special upgrades, environmental effects. **Standard player units should behave consistently.** Difficulty should change enemy aggression, composition, reinforcement timing, objective pressure, and resources — **not simply multiply enemy health.**

## Team games (§42)

Test the combinations that don't exist in 1v1: shield stacking · repair stacking · speed bonuses · stealth fields · resource transfer · support-power chains · superweapon synchronization · air-army concentration.

**Stacking rule — diminishing returns:** first aura 100% · second 35% · third 15%. Control effects must not chain indefinitely.

## Testing matrix (§43)

Every unit tested vs: every enemy unit of similar tier · equal-cost groups · equal-population groups · higher/lower terrain · defensive structures · support powers · veterancy · mixed armies · different skill levels.

Standard combat tests: **20 uncontrolled + 20 controlled + 20 terrain + 20 mixed-army** engagements. Never balance from one lab fight.

## Automated simulation (§44)

Run thousands of simplified engagements; track survival rate · damage efficiency · target acquisition · overkill · formation effects · range advantage · pathing interference. Sims catch statistical problems; **human matches reveal** frustration, ease of use, surprise factor, strategy, control burden, map interaction. Both required.

## Telemetry (§45)

Record: build order · resource collection/spending · idle production time · harvester losses · expansion timing · tech timing · unit creation/losses · damage dealt/received · ability usage · retreat success · map control · superweapon timing · match result.

`Efficiency = Value Destroyed / Unit Cost` → `<0.7` weak · `0.8–1.2` normal · `>1.3` strong · `>1.6` consistently problematic. Support units need a separate assisted-value calc.

## Balance by skill level (§46)

Track separately: new · bronze/silver · gold/platinum · diamond · top 5% · tournament. A strategy can be fair for elites but oppressive for beginners. **Preferred beginner-focused fixes** (before weakening for everyone): better warning · clearer detector icon · earlier tutorial · longer reveal time · better default defense.
