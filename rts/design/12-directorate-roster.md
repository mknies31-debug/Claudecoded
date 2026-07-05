# 12 · Directorate Roster (v1)

> Data: [`../data/units/directorate.json`](../data/units/directorate.json) · validated by [`../scripts/validate-roster.mjs`](../scripts/validate-roster.mjs) (0 failures). Tune numbers in the [Balance Lab](../lab/index.html).

The **easy, durable, combined-arms** baseline faction. Reliable economy, strong repair, straightforward controls; concedes stealth, mobility, expansion, and early harassment (per the Option-B budget). This roster is the reference other factions get measured against.

## Roster

| Unit | Tier | Class | Role | Cost | Build | Pop | HP |
|---|:--:|---|---|--:|--:|--:|--:|
| Rifleman Squad | 1 | Basic infantry | anti-infantry / garrison | 300 | 8 | 1 | 220 |
| Missile Trooper | 1 | Specialist infantry | anti-armor / anti-air | 350 | 13 | 1 | 180 |
| Field Engineer | 1 | Specialist infantry | capture / repair | 300 | 14 | 1 | 150 |
| Recon Spotter | 1 | Scout vehicle | recon + **detector** | 350 | 14 | 1 | 300 |
| Collector Truck | 1 | (harvester) | economy | 1400 | 40 | 2 | 1000 |
| Sentry Turret | 1 | Structure | static anti-vehicle | 700 | 20 | 0 | 1200 |
| Vanguard MBT | 2 | Main battle tank | **general-purpose** armor | 900 | 28 | 3 | 1600 |
| Warden AA Halftrack | 2 | Advanced vehicle | anti-air / anti-inf | 700 | 38 | 2 | 620 |
| Lancer Tank Destroyer | 2 | Advanced vehicle | dedicated anti-armor | 1000 | 42 | 3 | 900 |
| Howitzer | 2 | Artillery | siege | 1100 | 40 | 4 | 500 |
| Repair Rig | 2 | Advanced vehicle | field repair | 600 | 36 | 2 | 600 |
| Flak Battery | 2 | Structure | static anti-air + **detector** | 800 | 22 | 0 | 900 |
| Falcon Gunship | 3 | Aircraft | precision strike | 1200 | 35 | 4 | 700 |
| Bastion Land Battleship | 3 | Epic unit | epic assault + support | 7500 | 150 | 15 | 9000 |
| Judgment Cannon | 3 | (superweapon) | area strike | 5000 | 120 | 0 | 2500 |

## Threat coverage (§5) — all ten answered

| Threat | Directorate answer(s) |
|---|---|
| Mass infantry | Rifleman, Warden AA, Howitzer, Bastion |
| Heavy armor | Missile Trooper, MBT, Lancer, Falcon, Sentry Turret |
| Aircraft | Missile Trooper, Warden AA, Flak Battery |
| Artillery | Recon Spotter (flank), Howitzer (counter-battery), Falcon |
| Stealth | Recon Spotter, Flak Battery *(detection)* |
| Static defenses | Howitzer, Falcon, Judgment Cannon, Engineer |
| Harassment | Rifleman, Recon Spotter, Sentry Turret |
| Epic units | Lancer + Falcon + Missile Troopers *(combined arms, §34)* |
| Superweapons | Falcon / any raid on the facility; Judgment Cannon as pressure |
| Economic expansion | MBT push, Falcon raid, Sentry Turret, Engineer |

## Identity checks

- **Combined arms, not spam.** The only general-purpose unit (MBT) carries **4** exploitable weaknesses (§9); everything else is a specialist, so a pure-MBT army loses to missile infantry + aircraft.
- **Durable & repair-forward.** High HP and armor values, plus Repair Rig field repair and the Bastion's repair aura (§31).
- **Easy.** No stealth micro, no fragile timing units; a standard 3–5 role army (MBT + Missile Troopers + Warden AA + Recon + Repair) covers most situations.
- **Weaknesses honored.** No cloaking, low mobility (slow tanks), expensive/slow epic, and harvesters are unarmed harass-bait — matching the budget's sacrifices.

## Next factions

Covenant and Array rosters should solve the **same ten threats differently** (Covenant via mines/ambush/hijack/rear-armor; Array via shield-disruption/immobilization/specialists — §5) and hit their own budget peaks. Reuse the validator for each.
