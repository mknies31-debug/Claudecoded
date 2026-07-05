# Launch Certification Checklist

> Bible §50. The game should **not** launch competitively until every box is checked.
> Mark `[x]` when verified. Link evidence (telemetry query, test run, map report) next to each.

## Faction viability
- [ ] All factions have **four viable openings** — §15 · [design/05](design/05-game-flow.md)
- [ ] Every major unit has **at least one counter** — §5 · [design/01](design/01-factions.md)
- [ ] Every faction has **detection** — §28 · [design/03](design/03-combat-systems.md)
- [ ] Every faction has **anti-air** — §27
- [ ] Every faction has **siege capability** — §22
- [ ] **No single-unit composition dominates** — §9–10 · [design/03](design/03-combat-systems.md)

## Systems
- [ ] All ranked maps pass **travel-time tests** — §37 · [design/07](design/07-maps.md)
- [ ] **Superweapons allow reaction** — §35 · [design/06](design/06-power-units.md)
- [ ] **Early harassment allows response** (8–15 s window) — §13 · [design/04](design/04-economy.md)
- [ ] **Economy cannot grow without map exposure** — §11–12
- [ ] **Team stacking is controlled** (diminishing returns) — §42 · [design/08](design/08-quality.md)

## Tech / tooling
- [ ] **Replays function reliably**
- [ ] **Telemetry functions correctly** — §45
- [ ] **AI uses legal resources** (no hidden HP/damage/armor) — §40
- [ ] **All critical counters are visually readable** — §46, §47(step 2)

## Meta health
- [ ] **Top-player tournaments show strategic variety** — §2, §49

---

## Measured-target gates (from [data/balance-targets.json](data/balance-targets.json))
- [ ] Faction win rates within **48–52%**
- [ ] Matchup win rates within **46–54%**
- [ ] Spawn win rates within **49–51%**
- [ ] Avg ranked match **18–25 min**; `<5 min` under 8%; `>40 min` under 10%
- [ ] Superweapon-only wins **under 5%**
- [ ] Highest unit pick rate **≤ 70%**; lowest standard-unit pick rate **≥ 10%**
- [ ] No active §49 warning sign unresolved
