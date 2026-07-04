# 05 · Game Flow — Openings, Tech, Production

> Bible §15–21. Data: [`../data/timings.json`](../data/timings.json).

## Openings (§15) — each faction has ≥4 credible ones

- **A · Standard economy:** power → refinery → basic production → scout → expansion prep.
- **B · Early pressure:** production first, several low-tier units, delayed expansion.
- **C · Defensive tech:** early defense, faster Tier-2, lower field presence.
- **D · Fast expansion:** early second economy, minimal military, high vulnerability.

**Relationships:** pressure punishes greedy expansion · defensive tech resists pressure · standard economy outgrows excessive defense · fast expansion outscales passive standard play · scouting enables adaptation. **No opening is safe against everything.**

## Rush protection (§16) — no artificial immunity

No invulnerability timers in normal competitive matches. Protect the opening via: reasonable base distance · cheap defensive infantry · initial vision · a carefully-balanced HQ weapon (optional) · limited early siege damage · appropriate build times. Early attacks are possible, but base destruction in the first **3 minutes** should require extreme neglect.

## Technology timing (§17)

| Tier | Timing |
|---|---|
| Tier 1 | Start |
| Tier 2 | 3:30–6:00 |
| Tier 3 | 7:00–11:00 |
| Epic unit | 11:00–18:00 |
| Superweapon activation | 14:00–22:00 |

Reaching earlier requires economic sacrifice → smaller army, less map control, more vulnerability.

## Upgrades (§18)

Create **specialization**, not universal power. Minor 5–10% · standard 10–15% · major specialized 15–25%. Avoid upgrades that improve every unit. Better: infantry armor, tank reverse speed, aircraft ammo, shorter stealth reveal. Research costs credits + time + tech-building capacity → temporarily fewer units.

## Production (§19)

Separate investment from economy. Each factory = one independent queue at full speed; **additional factories give no hidden % bonus.** A factory costs ~2–4 standard combat units (prevents instant mass-production scaling). An army destroyed near the **opponent's** base is harder to replace than one lost near home → rewards defensive positioning, forward production, map control.

## Build times (§20)

Basic infantry 5–10 s · specialist infantry 10–18 s · scout vehicle 12–20 s · MBT 22–35 s · artillery 28–45 s · aircraft 25–45 s · advanced vehicle 35–55 s · epic unit 90–180 s. (See `timings.json → buildTimesSec`.) Build time must prevent instant replacement of elite units.

## Command capacity (§21) — soft cap

Generous base capacity; advanced command structures raise it; **going over slows production rather than destroying units.** Costs: infantry squad 1 · light vehicle 2 · tank 3 · artillery 4 · aircraft 4 · epic 15. Prevents extreme unit counts without rigidly defining normal strategy.
