# 01 · Factions, Power Budget & Counter Coverage

> Bible §4–5. Data: [`../data/factions.json`](../data/factions.json).

## Power budget

Each faction receives the same **150-point** internal budget across **8 categories**, distributed differently. Values are **not shown to players**; they verify a faction isn't stacking too many major advantages. This is the **canonical Option B** (see [`factions.json`](../data/factions.json) · rationale in [11-budget-options.md](11-budget-options.md)).

**Rule: no faction ranks first in more than three categories.** With 8 categories this is now satisfiable (8 ≤ 9) — and it holds: Directorate leads 3, Covenant leads 3, Array leads 2.

| Category | Directorate | Covenant | Array |
|---|---:|---:|---:|
| Economy | **24** | 22 | 18 |
| Early pressure | 16 | **24** | 12 |
| Direct combat | **26** | 14 | 20 |
| Durability | **30** | 10 | 20 |
| Mobility | 13 | **25** | 20 |
| Stealth & deception | 6 | **26** | 14 |
| Battlefield control | 17 | 18 | **26** |
| Technology scaling | 18 | 11 | **20** |
| **Total** | **150** | **150** | **150** |

> **Bold = category leader.** Ease-of-use is no longer a budget line (it can't be "spent" — an easy faction isn't weaker); it's carried as a **complexity tag** instead: Directorate `easy`, Covenant `hard`, Array `hard`. The original Bible "100-point / 10-category" budget summed to 143/150/149 (unequal) and its ≤3-leads rule was impossible with 10 categories (`3×3 = 9 < 10`). Option B fixes both; the two rejected alternatives (equal-100, difficulty-weighted) live in [11-budget-options.md](11-budget-options.md) and [`budget-options.json`](../data/budget-options.json).

## Faction profiles

**Directorate** — durability, reliable economy, strong repair, strong combined arms, straightforward controls. Sacrifices expansion speed, stealth, early harassment, strategic mobility.

**Covenant** — fast expansion, harassment, stealth, cheap field presence, salvage, tactical flexibility. Sacrifices durability, direct late-game combat, ease of use, reliable frontal defense.

**Array** — technology scaling, battlefield manipulation, shields, mobile infrastructure, specialists. Sacrifices early pressure, replacement speed, economic reliability, simplicity, early army size.

## Universal counter coverage

Every faction must answer each threat — **the answer need not be equivalent.**

Threats: mass infantry · heavy armor · aircraft · artillery · stealth · static defenses · harassment · epic units · superweapons · economic expansion.

**Example — countering heavy armor:**

| Directorate | Covenant | Array |
|---|---|---|
| Missile infantry | Mines | Shield-disrupting energy weapon |
| Precision aircraft | Ambush infantry | Immobilization field |
| Heavy tank destroyer | Hijacking / rear-armor attacks | Expensive anti-armor specialist |

All three solve the problem; the gameplay differs.
