# 04 · Economy

> Bible §11–14. Data: [`../data/economy.json`](../data/economy.json) · resources: [`../data/resources.json`](../data/resources.json).

## Two resources: wood (floor) & ore (ceiling)

The map carries **two** harvestable resources with deliberately different risk/tempo profiles. Both convert to credits; both keep harvester payback inside the §11 band (100–140 s). The point is the *choice*, not two flavors of the same node.

| | **Wood / Lumber** | **Ore / Minerals** |
|---|---|---|
| Value per load | low (30) | **high (75)** |
| Extraction speed | **fast** (short cadence, quick trips) | slow — "lower to mine" |
| Gatherer | Lumber Harvester — cheap (900), quick | Mining Vehicle — pricier (1400), slower, armored |
| Effective cr/s | ~8 | ~11 (at a secured node) |
| Node total | modest, **renewable — regrows fast** | large but **finite — depletes, never returns** |
| Location | near base — **safe** | central + expansions — **contested** |
| Role | economic **floor** | economic **ceiling** |

**The tension this creates:**
- **Wood only** → survivable but low-ceiling; anyone also holding ore out-scales you.
- **Ore only** → high-ceiling but brittle; deny the mine (§13) or outlast its depletion and the economy collapses.
- **Both (intended)** → wood keeps you alive, ore lets you win — and the ore contest is what drives map control and the harassment/comeback loops (§12–14).

This dovetails with faction identity: the harass-and-expand Covenant can fall back on the un-killable wood floor when denied the map, while the ore contest rewards the scouting and aggression the whole design is built around. *(Open question in [`resources.json`](../data/resources.json): should ore also **gate** advanced tech — a hard second currency — or stay a pure credit source? Flagged, not silently adopted.)*

## Starting conditions (§11)

Economically **equivalent, not identical**. One faction may start with one large harvester, another with two small collectors, a third with a stationary extractor core. **First two minutes of potential income within ~5%** across factions.

## Payback periods

- **Harvester:** 100–140 s. *Example:* 1,400 cr cost ÷ 12 cr/s ≈ **117 s**.
- **Refinery + included harvester:** 150–220 s — a meaningful window where expansion is vulnerable.

Too-fast payback → exponential growth. Too-slow → expansion is discouraged.

## Income progression

| Match time | Typical income |
|---|---|
| 0–3 min | 500–700 cr/min |
| 3–7 min | 800–1,200 cr/min |
| 7–12 min | 1,200–1,800 cr/min |
| 12+ min | 1,500–2,400 cr/min |

Actual numbers depend on unit pricing; the requirement is **controlled escalation**.

## Economic lead limits (§12)

+10% income → small advantage · +20% → significant · +35% → strongly favored · +50% → usually wins unless severe mistakes. **Avoid mechanics where a small income lead instantly finances more economy with no vulnerability.**

Expansions must require: upfront investment · travel time · map control · defense · delayed payback · visible construction.

## Harassment (§13)

Against a normal early raid the defender should get **8–15 s** to respond (retreat / bring defenders / repair). A fully unprotected harvester should still die if unanswered.

- **Minor success:** lost mining time, repairs, forced defensive production.
- **Moderate:** destroys one collector, attackers escape with some losses.
- **Major:** destroys multiple collectors, damages refinery, preserves most attackers.

Major economic damage should require good scouting, good control, opponent error, and significant army investment.

## Comebacks (§14)

Earned through **asymmetry of position**, not hidden bonuses. The trailing player may have shorter reinforcement routes, concentrated defenses, easier unit preservation, and raid targets on exposed expansions.

Approved tools: sell structures · salvage wreckage · capture neutral income · ambush reinforcements · destroy advanced tech · interrupt superweapon construction · defensive terrain · rebuild with cheap basics.

**Emergency recovery** (after losing a primary refinery): access to a **discounted replacement collector** — **not** free resources, automatic income, or a combat bonus. Prevents one accidental collector loss from ending beginner matches while preserving the value of sustained harassment.
