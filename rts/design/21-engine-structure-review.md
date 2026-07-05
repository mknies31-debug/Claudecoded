# 21 · Engine Structure Review

> A code-structure pass over [`../game/index.html`](../game/index.html) after the V1 + graphics work. Measured, not guessed: **558 lines total — 45 CSS, 63 HTML shell, 442 JS (57.9k chars, of which 44% is embedded ROSTER/MAP data), 34 functions.** Companion to [design/17](17-architecture-review.md) (project architecture) and [design/20](20-engine.md) (feature scope).

## Structure map (as it actually layers)

The single file reads top-to-bottom as ten layers, each a coherent system:

| Layer | Functions | Notes |
|---|---|---|
| Embedded data | `ROSTER`/`MAP` markers | injected by `build-game-data.mjs`; never hand-edited |
| Combat math | `pdps`, `effHP` | formula-identical to `combat-core.mjs` |
| World/camera | `resize`, `sx/sy/wx/wy` | letterboxed fit, no pan/zoom (map fits) |
| Config | `SPEED`, `RAD`, `DIFFS`, `SPEEDS`, `GATH`, `BUILDABLE` | all tuning knobs in one band |
| Entities | `spawn`, `spawnHQ` | plain structs; shields attached at spawn |
| Navigation | `buildNavGrid`, `los`, `astar`, `navMove` | grid ray-traced from `MAP.barriers`; LOS fast-path |
| Session | `newGame`, `startGatherers` | world reset on faction change |
| Input | selection/orders listeners, `updateSel` | drag-select, contextual right-click |
| Simulation | `moveToward`, `separate`, `revealed`, `acquire`, `combat`, `applyDamage`, `harvest`, `updateEnt` | fixed timestep DT=1/30, accumulator-driven |
| CPU + loop + render | `cpuThink`, `tick`, `loop`, `render`, `drawEnt` | render decoupled from sim rate |

## What's structurally sound

- **Data-driven throughout** — the same JSON that the validators/sims certify drives the game; `build-game-data.mjs` is the only path data enters by.
- **Fixed-timestep sim, decoupled render** — deterministic-enough stepping is what makes the whole engine headlessly testable (`game-v1-check.mjs`, 6/6).
- **Systems stay separated even inside one file** — each layer could be cut at its comment banner and moved to a module without rework.
- **The CPU plays by the same functions the player's units use** (§40 by construction, not by promise).

## Findings

1. **Combat math now exists in three copies** — `combat-core.mjs` (sims), `prototype/index.html`, `game/index.html` — with **no drift check**. The single-file/offline constraint forces inlining, but nothing fails if a copy diverges. *Fix: a behavioral cross-check script that loads all three and asserts identical `pdps`/`effHP` outputs across the full roster.*
2. **The game's damage formulation intentionally differs from the sims** — per shot it removes `maxHp · (pdps·reload / effHP)` of the target and applies flat 50% splash inside `aoe`, where the sims scale shots by `min(aoe, targets)`; kiting/first-strike are *emergent* from real-time positioning rather than the analytic `kiteFactor`. Reasonable design — but currently undocumented, so a future reader will "fix" one to match the other in the wrong direction. *Fix: state it here and in design/20 (done), and cover the equivalence direction in the drift check.*
3. **Render allocates every frame** — background/water/plateau gradients are rebuilt per frame and tree clusters re-derived per frame from `hash()`. Fine at 60fps today, but it's the ceiling on richer art. *Fix (highest perf leverage): render all static terrain once to an offscreen canvas, redraw only on resize; per-frame work drops to shimmer/pulse + entities.*
4. **Session state is a loose set of globals** — `newGame()` must remember to reset each of `ents/credits/oreUnlocked/over/uid/sel/cpuTimer/cpuAttack/…`; the Start gate added `started` (reset deliberately not included), and `FRAME` isn't reset (harmless). This is the classic stale-state bug farm. *Fix: one `G` state object built and swapped atomically by `newGame()`.*
5. **O(n²) hot paths** — `acquire` and `separate` scan all entities per unit per tick; `revealed()` rescans for detectors per stealth query. Fine at current ~50-unit scale. *Fix when needed: per-tick detector cache first (one line), spatial hash grid second.*
6. **Small UX/structure debts** — "Play again" uses `location.reload()`, which drops the chosen faction/difficulty (should be `newGame()` + Start overlay); changing faction mid-match hot-restarts without returning to the Start screen; move orders are effectively attack-move (combat auto-acquires while moving) — fine, but should be a stated rule.
7. **`HQ_STATS` is hardcoded in the game file** — the one combat-relevant stat block the certifier/sims can't see. *Fix: move to `data/combat-rules.json` (structures section) and inject.*
8. **`cpuThink` re-implements `ai-policy.mjs` scoring inline** — same triplication class as #1. *Fix: extract the scorer into the shared module and inject it at build time like the data.*
9. **The Artifact/deploy transform is ad-hoc** — the strip-to-fragment step lives in session shell history. *Fix: `scripts/build-artifact.mjs` so any checkout can reproduce the deployable.*
10. **The engine is now instrumentable but uninstrumented** — the Start-gate API means headless **CPU-vs-CPU match batches** are one harness away, which is exactly the §50 measured-gates step (win rates by faction pair, match-length distribution vs `balance-targets.json`).

## Prioritized recommendations

- **P0 — protect correctness, unlock the next gate: ✅ ALL DONE.**
  (a) ~~combat-math drift check~~ → [`drift-check.mjs`](../scripts/drift-check.mjs), **1,274 checks, no drift** (49 units × 6 damage types × shield-break on/off × both apps vs `combat-core.mjs`);
  (b) ~~offscreen terrain cache~~ → static terrain paints once into an offscreen layer (rebuilt on resize/`newGame`), per-frame render is a blit + animated accents (water shimmer, rich-ore pulse, relay ring) + entities; vignette gradient cached;
  (c) ~~match-batch telemetry harness~~ → [`match-batch.mjs`](../scripts/match-batch.mjs), first results below.
- **P1 — structure for growth:** split the source into `game/src/` parts (css / shell / engine) assembled by a `build-game.mjs` into the same single-file artifact; atomic session-state object; Play-again via `newGame()` preserving options; `HQ_STATS` into data.
- **P2 — scale & polish:** spatial partitioning for `acquire`/`separate`; shared CPU scorer injection; control groups + explicit attack-move affordance.

**Verdict:** the single-file constraint is doing its job (offline, zero-dep, testable) and the layering inside it is clean enough to survive growth — but the project's core discipline is "one source of truth, script-verified," and the engine violated it in exactly two places: duplicated combat math (now guarded by the drift check) and duplicated CPU scoring (P2, still open).

## First live-engine telemetry (match-batch, 36 matches, seeded)

`node rts/scripts/match-batch.mjs 4` — 9 ordered faction pairs × 4, both sides driven by the identical `hard` policy, 15-min cap:

| Measure | Result | Band |
|---|---|---|
| **Directorate** win rate | 44% (7/16) | ◻ 48–52 |
| **Covenant** win rate | **100% (16/16)** | ◻ 48–52 |
| **Array** win rate | **6% (1/16)** | ◻ 48–52 |
| p1-side wins | 45% (mirror matchups 44%) | ~ 49–51, low N |
| Match length | avg 8.5 min (4.0–14.3), 3 draws | 18–25 min band is full-game scope |

**The initial hypothesis — a tempo dimension the sims never measured.** The first read: the `hard` policy commits at a fixed army *value* (2600), so the cheapest roster (Covenant) masses to it first, attacks first, snowballs; the priciest (Array) starves. Recommended follow-up: test commit-policy variants before touching any unit cost (§49).

**The hypothesis was FALSIFIED by a 198-match commit-policy experiment.** Eight policies were tested — constant thresholds, pure time-gates (both sides commit at the identical instant), enemy-relative margins, spend-fractions, always-attack — and **Covenant won 143/144 of its games under every one of them**. Instrumentation found the real mechanism: the CPU's greedy counter-picker (pdps/effHP-per-cost) is **blind to range and splash** — it converged on Covenant's Interceptor Gyro (range 8, aoe 3, flies over pathing) while sending range-5, low-HP units into it, and never bought its own AA/ranged answers (they lose the offense-only tiebreak). A unit-interaction/build-policy artifact, not commit timing — though commit timing *was* real for the one pair it could touch (Directorate–Array swung 12-0 → 0-6 → 7-3 purely on commit rule).

**Fixes applied (no unit stats touched, §49):**
1. **Commit rule P7**, per difficulty: never attack before `commitT` (Easy 5:30 → Expert 3:30), then only with `margin ×` the enemy army's value (Easy 1.35 → Expert 1.0, floor 1200), plus a **stalemate breaker** — past 2×`commitT` the margin drops away (§35 "force action"; without it, mirror armies sat at mutual 1.1× standoffs forever).
2. **Two-sided trade-ratio picker**: candidates score by *kill-rate ÷ death-rate* against the scouted enemy comp, with kiting (out-ranged units deliver less; the combat-core kite formula) and splash (aoe>1 threats kill clumps 1.4× faster) terms, still per-cost. The Gyro trap can no longer win the tiebreak; AA and stand-off answers now surface.

**Post-fix batch (same 36-match protocol):** Covenant 100%→**69%**, Array 6%→**75%**, the Covenant–Array pairing is dead even (4–4), **0 draws** (the breaker resolves every mirror), and p1-side bias landed at exactly **50%**. The residual: **Directorate fell to 6%** in CPU-vs-CPU brawls — its identity (durable attrition + repair + siege) is exactly what the v1 sim doesn't reward: there is no repair, and the anti-army picker never buys its Howitzer. That is the next calibration item — likely an engine-depth gap (repair/siege roles), not a cost error, and it barely affects human play, where the difficulty knob and player micro dominate. Flagged, not tuned.
