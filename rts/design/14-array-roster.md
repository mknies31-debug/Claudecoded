# 14 · Array Roster (v1)

> Data: [`../data/units/array.json`](../data/units/array.json) · validated (0 failures / 0 warnings, all 10 threats). Third solution to the same threat list — compare [Directorate](12-directorate-roster.md) and [Covenant](13-covenant-roster.md).

The **technology & battlefield-control** faction. It answers the same ten threats through **shields, energy weapons, immobilization fields, and expensive specialists** — winning by controlling engagements and out-teching, not by cheap numbers or ambush. Peaks in battlefield control and technology; pays with weak early pressure, a fixed/exposed economy, slow replacement, small early armies, and high complexity. Recurring motif: shields give strong resist **until EMP drops them**.

## Roster

| Unit | Tier | Class | Role | Cost | Build | Pop | HP |
|---|:--:|---|---|--:|--:|--:|--:|
| Sentinel Trooper | 1 | Basic infantry | shielded anti-inf | 260 | 9 | 1 | 240 |
| Architect | 1 | Specialist infantry | infrastructure / capture / repair | 320 | 15 | 1 | 170 |
| Probe Skimmer | 1 | Scout vehicle | recon + **detector** | 380 | 16 | 1 | 280 |
| Extractor Core | 1 | Structure | economy (stationary) | 1600 | 25 | 0 | 1300 |
| Pylon Turret | 1 | Structure | static energy defense + **detector** | 750 | 22 | 0 | 1150 |
| Disruptor | 2 | Specialist infantry | **shield-break** anti-armor | 450 | 16 | 1 | 200 |
| Aegis Tank | 2 | Main battle tank | **general-purpose** shielded armor | 1050 | 32 | 3 | 1500 |
| Arc Walker | 2 | Advanced vehicle | anti-air / anti-inf | 780 | 40 | 2 | 640 |
| Warp Snare | 2 | Advanced vehicle | **immobilization control** | 850 | 42 | 3 | 560 |
| Prism Artillery | 2 | Artillery | energy siege | 1200 | 44 | 4 | 520 |
| Restorer Drone | 2 | Advanced vehicle | shield / repair support | 650 | 36 | 2 | 520 |
| Nullifier | 3 | Advanced vehicle | anti-armor specialist | 1300 | 48 | 4 | 850 |
| Phase Interceptor | 3 | Aircraft | energy anti-air / precision | 1250 | 40 | 4 | 680 |
| Arbiter | 3 | Epic unit | epic + shield-aura support | 8000 | 165 | 15 | 8000 |
| Stasis Lance | 3 | (superweapon) | area stasis + energy | 5200 | 130 | 0 | 2600 |

## Three answers to heavy armor (§5)

| Directorate | Covenant | Array |
|---|---|---|
| Missile Trooper · Lancer TD · Falcon | Saboteur · Hijacker · Ambush Tank (rear) · mines | **Disruptor (shield-break) · Nullifier lance · Warp Snare (immobilize → focus fire)** |

Same problem, three genuinely different playstyles — the design goal from [00-philosophy](00-philosophy.md).

## Identity checks

- **Control-first.** The Warp Snare (immobilization, §29) is the signature: it pins armor and epics so the expensive Array army can focus them down — a control answer, not a stat answer.
- **Shields + EMP counterplay.** Almost every Array unit lists "EMP (drops shield)" as a weakness, so the faction is strong until an opponent invests in disables — clean, discoverable counterplay.
- **Expensive & slow to replace.** Highest costs and build times of the three (Aegis Tank 1050/32 s; Arbiter 8000/165 s), matching the "weak replacement / small early army" sacrifices.
- **Fixed economy.** The stationary Extractor Core is reliable but can't flee — a different economic vulnerability than mobile harvesters.
- Only the Aegis Tank is general-purpose (4 weaknesses, §9).

## Roster program complete (v1)

All three factions now solve the full §5 threat list, each in its own way, and each passes the validator (anti-spam, build bands, coverage). Totals: **45 units across 3 factions, 0 failures.** Next candidates: wire the rosters into the Lab, run cross-faction cost-efficiency matchups (§8), or draft the first map per §37.
