# 13 · Covenant Roster (v1)

> Data: [`../data/units/covenant.json`](../data/units/covenant.json) · 16 units, validated (0 failures / 0 warnings, all 10 threats). Compare with [Directorate](12-directorate-roster.md).

The **fast, cheap, stealthy** faction. It solves the same ten threats as the Directorate but *differently* (§5): armor dies to **ambush, hijack, mines, and rear-armor** rather than frontal tank destroyers. Peaks in early pressure, mobility, and stealth; pays with low durability, weak direct late-game combat, thin tech, and a high skill floor.

## Roster

| Unit | Tier | Class | Role | Cost | Build | Pop | HP |
|---|:--:|---|---|--:|--:|--:|--:|
| Raider Squad | 1 | Basic infantry | anti-inf / harass | 160 | 7 | 1 | 180 |
| Saboteur | 1 | Specialist infantry | **stealth** demo / anti-armor | 400 | 15 | 1 | 140 |
| Hijacker | 1 | Specialist infantry | **vehicle theft** | 500 | 16 | 1 | 130 |
| Recon Hound | 1 | Scout vehicle | recon + **detector** | 300 | 12 | 1 | 220 |
| Raider Buggy | 1 | Scout vehicle | fast economy raider | 420 | 14 | 2 | 480 |
| Salvage Harvester | 1 | (harvester) | economy + salvage | 1200 | 36 | 2 | 850 |
| Sensor Spike | 1 | Structure | static **detector** | 500 | 18 | 0 | 700 |
| Rocket Technical | 2 | Advanced vehicle | anti-air / anti-armor | 650 | 36 | 2 | 500 |
| Scorch Buggy | 2 | Advanced vehicle | **anti-infantry flame / area** | 520 | 36 | 2 | 470 |
| Mine Layer | 2 | Advanced vehicle | area denial | 550 | 35 | 2 | 520 |
| Marauder Scrap Tank | 2 | Main battle tank | **general-purpose** light armor | 700 | 24 | 2 | 1050 |
| Ambush Tank | 2 | Advanced vehicle | **stealth** rear-armor flanker | 900 | 40 | 3 | 700 |
| Rocket Nest | 2 | Structure | static anti-vehicle / air | 650 | 20 | 0 | 900 |
| Interceptor Gyro | 3 | Aircraft | fast anti-air / harass | 850 | 28 | 3 | 520 |
| Ravager | 3 | Epic unit | fast epic raider + salvage | 6500 | 130 | 14 | 6500 |
| Locust Swarm | 3 | (superweapon) | drone swarm | 4500 | 110 | 0 | 2000 |

## Same threats, Covenant's way (§5)

| Threat | Directorate | Covenant |
|---|---|---|
| Mass infantry | Howitzer artillery · tank splash | **Scorch Buggy** (flame `aoe 5`) · Raider Buggy |
| Heavy armor | Missile Trooper · Lancer TD · Falcon | **Saboteur charges · Hijacker (steal it) · Ambush Tank (rear) · mines** |
| Aircraft | Missile Trooper · Warden AA · Flak | Rocket Technical · Interceptor · Rocket Nest |
| Artillery | Recon flank · counter-battery Howitzer | Recon Hound flank · **Ambush Tank · Interceptor** |
| Stealth (enemy) | Recon Spotter · Flak Battery | Recon Hound · Sensor Spike |
| Epic units | Lancer + Falcon combined arms | **Hijacker steals it · Ambush Tank rear · mines** |
| Economy defense | turrets + durable harvester | mines + cheap Raiders (own harvester is frailer bait) |

## Identity contrast

- **Cheaper, faster, weaker.** The Marauder (Covenant's only general-purpose unit, 4 weaknesses) costs 700/24 s vs the Vanguard's 900/28 s and has ~⅔ the HP — pressure, not staying power.
- **Stealth & deception are structural**, not a gimmick: Saboteur and Ambush Tank cloak; both hard-require the enemy to bring detection.
- **Anti-armor by trickery.** No dedicated tank destroyer — armor is beaten by hijack/mines/rear strikes, which reward control and punish the fragile Covenant if mistimed.
- **Anti-swarm by fire, not artillery.** The **Scorch Buggy** (§16) is Covenant's dedicated answer to infantry mass: cheap, short-range flame with `aoe 5` that melts clusters but folds to armor/artillery and can't kite — the on-identity alternative to the Directorate's stand-off Howitzer. Added to close the one real roster gap the composition sim found.
- **High skill floor.** Fragile bodies + micro-heavy tools = the "hard" complexity tag.

## Next

Array roster (§ tech/control): shield-disruption, immobilization fields, specialists — the third distinct solution to the same ten threats.
