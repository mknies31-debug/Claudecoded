# 11 · Faction Budget — Three Options

> Resolves README open question #1. Data: [`../data/budget-options.json`](../data/budget-options.json).

## Two problems in the original budget

1. **Totals aren't 100 and aren't equal.** The §4 category values actually sum to **Directorate 143 · Covenant 150 · Array 149** — so the "100-point budget" label is wrong and the three factions don't share a total.
2. **The "≤3 categories" rule is impossible as written.** 10 categories × 3 factions, with a cap of 3 sole-leads each, is `3×3 = 9 < 10` → someone must lead 4 unless categories **tie**. The original already breaks it: Directorate leads 4 (economy, combat, durability, ease) and Covenant leads 4 (expansion, pressure, mobility, stealth).

Every option below fixes **both**, and every option keeps each faction's identity (Directorate = durable/simple, Covenant = fast/sneaky/fragile, Array = tech/control).

---

## Option A — Equal 100-point pool (literal fix)

Rescale so each faction totals **exactly 100**. Two categories are **contested ties** on purpose (economy: Directorate≈Array; mobility: Covenant≈Array) so no one is sole-#1 in more than three.

| Category | Directorate | Covenant | Array |
|---|---:|---:|---:|
| Economy reliability | **12** | 10 | **12** |
| Expansion speed | 7 | **14** | 8 |
| Early pressure | 9 | **13** | 7 |
| Direct combat | **14** | 8 | 10 |
| Mobility | 7 | **13** | **13** |
| Durability | **15** | 6 | 10 |
| Stealth & deception | 3 | **14** | 7 |
| Battlefield control | 8 | 9 | **14** |
| Technology scaling | 12 | 7 | **13** |
| Ease of use | **13** | 6 | 6 |
| **Total** | **100** | **100** | **100** |

**Sole peaks:** D = combat, durability, ease · Cov = expansion, pressure, stealth · Arr = control, tech.
**Pro:** makes the "100-point" wording true. **Con:** numbers get small/cramped; ease of use still eats a power slot.

---

## Option B — Eight categories, equal 150 (structural fix) ⟵ recommended

Remove the pigeonhole at the source: **8 power categories**, so ≤3 leads each is actually satisfiable (`8 ≤ 9`). Fold *expansion* into *economy*; pull *ease of use* out of the power budget into a separate **complexity tag** (it's a usability trait, not raw power). Each faction totals **150**.

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
| *Complexity tag* | *easy* | *hard* | *hard* |

**Sole peaks:** D = economy, combat, durability · Cov = pressure, mobility, stealth · Arr = control, tech.
**Pro:** the rule is genuinely satisfied, not tie-patched; totals equal; ease-of-use stops distorting the budget. **Con:** changes the category list from the Bible's 10.

---

## Option C — Difficulty-weighted budget (design-forward)

Keep all 10 categories and **let the totals stay unequal on purpose**: total power scales *inversely* with ease of use — the easy faction carries less raw budget, the hard factions more (a skill payoff). The corrected originals already trend this way. Two contested ties fix the lead rule.

| Category | Directorate | Covenant | Array |
|---|---:|---:|---:|
| Economy reliability | **16** | 15 | **16** |
| Expansion speed | 11 | **19** | 14 |
| Early pressure | 13 | **19** | 10 |
| Direct combat | **19** | 12 | 17 |
| Mobility | 11 | **19** | **19** |
| Durability | **20** | 9 | 16 |
| Stealth & deception | 5 | **20** | 12 |
| Battlefield control | 11 | 14 | **20** |
| Technology scaling | 17 | 13 | **20** |
| Ease of use | **18** | 10 | 11 |
| **Total** | **141** | **150** | **155** |

**Sole peaks:** D = combat, durability, ease · Cov = expansion, pressure, stealth · Arr = control, tech.
**Pro:** closest to the Bible's numbers; encodes "harder = higher ceiling" as an explicit design lever. **Con:** unequal totals need a clearly-communicated rationale or they read as imbalance.

---

## Recommendation

**Option B.** It fixes the rule structurally instead of patching it with ties, gives honest equal totals, and correctly treats ease-of-use as a complexity descriptor rather than spending "power" on being simple. Option C is the better pick if you specifically want *difficulty = reward* baked into the numbers.
