# Launch Certification Checklist

> Bible §50. The game should **not** launch competitively until every box is checked.
> `[x]` = verified. **Design-verifiable** boxes are proven by [`scripts/certify.mjs`](scripts/certify.mjs) against `data/*.json` (run it to re-verify); **runtime** boxes need a playable build + telemetry and are marked `[ ]` with what would close them.

**Certification status:** `node rts/scripts/certify.mjs` → **20/20 design gates pass**, 11 gates pending a playable build.

## Faction viability
- [x] All factions have **four viable openings** — §15 · [design/05](design/05-game-flow.md) · *certify.mjs (A/B/C/D)*
- [x] Every major unit has **at least one counter** — §5 · [design/01](design/01-factions.md) · *certify.mjs: every combat unit lists a counter*
- [x] Every faction has **detection** — §28 · *certify.mjs: all 3 factions answer stealth*
- [x] Every faction has **anti-air** — §27 · *certify.mjs: all 3 factions answer aircraft*
- [x] Every faction has **siege capability** — §22 · *certify.mjs: all 3 factions have siege/anti-static*
- [x] **No single-unit composition dominates** — §9–10 · [design/03](design/03-combat-systems.md) · *composition.mjs: no §49 SPAM unit; 2 flags documented (see below)*

## Systems
- [ ] All ranked maps pass **travel-time tests** — §37 · [design/07](design/07-maps.md) · *`map-check.mjs` proves the §37 tests; **first map Twin Ridge passes 17/17**; a full ranked pool (§38) is still to author*
- [x] **Superweapons allow reaction** — §35 · [design/06](design/06-power-units.md) · *timings.json superweapon activation window 14–22 min; reaction-time rule in design/06*
- [x] **Early harassment allows response** (8–15 s window) — §13 · [design/04](design/04-economy.md) · *economy.json harvesterReactionWindowSec [8,15]*
- [x] **Economy cannot grow without map exposure** — §11–12 · *resources.json: ore (the ceiling) is finite + at contested points; economy.json expansionSafeguards*
- [x] **Team stacking is controlled** (diminishing returns) — §42 · [design/08](design/08-quality.md)

## Tech / tooling
- [ ] **Replays function reliably** — *engine feature (runtime)*
- [ ] **Telemetry functions correctly** — §45 · *engine feature (runtime)*
- [ ] **AI uses legal resources** (no hidden HP/damage/armor) — §40 · *engine/AI audit (runtime)*
- [ ] **All critical counters are visually readable** — §46, §47(step 2) · *art/UX pass — style guide exists ([style/](style/index.html)); needs in-engine verification (runtime)*

## Meta health
- [ ] **Top-player tournaments show strategic variety** — §2, §49 · *needs post-launch meta data (runtime)*

---

## Measured-target gates (from [data/balance-targets.json](data/balance-targets.json))
> Bands are **defined and script-checkable**; the measurement itself needs ranked telemetry (§45). All `[ ]` pending a live build.
- [ ] Faction win rates within **48–52%**
- [ ] Matchup win rates within **46–54%**
- [ ] Spawn win rates within **49–51%**
- [ ] Avg ranked match **18–25 min**; `<5 min` under 8%; `>40 min` under 10%
- [ ] Superweapon-only wins **under 5%**
- [ ] Highest unit pick rate **≤ 70%**; lowest standard-unit pick rate **≥ 10%**
- [ ] No active §49 warning sign unresolved — *composition.mjs: no SPAM unit; 2 residual flags are a scoped §8 heavy-tank cost pass + a documented Covenant utility-anti-armor sim blind spot ([design/16](design/16-composition-findings.md))*

---

## What "certified" means here
This is a **design spec + validation tooling**, not a shipped game. Everything provable on paper — counter coverage, anti-spam, threat answers, budget parity, economy windows, terrain rules — is proven by scripts (`validate-roster.mjs`, `matchup.mjs`, `composition.mjs`, `certify.mjs`) and passes. The remaining boxes are, by nature, **things only a playable build can prove**: real win rates, match-length curves, replay/telemetry systems, AI legality, and in-engine visual readability. The spec is internally certified and ready to hand to an implementation.
