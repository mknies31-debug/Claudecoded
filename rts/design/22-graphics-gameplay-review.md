# 22 · Graphics & Gameplay Review — coding improvements

> A measured review of [`../game/index.html`](../game/index.html) after the enjoyability campaign (production hierarchy, 3-map pool, relay capture, finite ore, readability HUD, terrain quality). Numbers are from the current build, not estimates. Companion to [design/20](20-engine.md) (scope) and [design/21](21-engine-structure-review.md) (the first structure pass + P0/P1/P2 plan).

**Measured:** 1,002 lines total · 872 JS (111 KB, **41 % of it embedded ROSTER/MAP data**) · 53 CSS · 46 functions · 23 whole-entity scan sites.

---

## A. Graphics — where it stands

**Strong, and done right:**
- **Terrain is cached in world space and painted once** (ground gradient + 260 tone patches + 2 600 speckle grains + 110 scatter props, mesas, organic water, boulder cliffs, painter-sorted woodland). Per-frame cost is a single scaled `drawImage` + a few animated accents. This is the correct architecture and it looks like terrain now.
- **Readability layer is genuine information design** (damage-type accent on weapons, range rings, target lines, under-attack pings, composition chips) — serves decisions, not decoration.

**Weak, ranked by how much they hurt the eye:**
1. **Units don't animate.** Every unit is a static procedural sprite that *slides*. No walk bob, no fire recoil, no tread/rotor motion, no build-up shimmer, no death throe beyond the burst ring. This is the single biggest "it looks like a prototype" tell — and it's cheap to fix (a per-unit phase driven by `FRAME`).
2. **Buildings are placeholder glyph boxes** (`B`/`M`/`A`/`T` on a hall). The model-kit agent produced 13 proper cel-shaded models (units + 4 buildings) but **its scratchpad output was cleared before integration** — re-tasked below. This is the top visual win waiting to land.
3. **`drawEnt` is one 60-line branch** over every class. It works, but it's the hardest-to-extend code in the file and it duplicates damage-type color logic. The model kit (a `MODELS[class]` table) is the fix.
4. **No elevation read on units.** High ground changes damage (+15 %) but a unit on a mesa looks identical to one below it — no shadow lift, no tint. Players can't *see* the positional advantage they're fighting for.

**Memory note:** `TERR_PX=28` makes the terrain cache a **3584×3584 canvas ≈ 51 MB** backing store, repainted on every `newGame`/resize (~3 000 draw calls). Fine on desktop; on a low-memory tab a map switch is a visible hitch. Dropping to 22–24 px/tile halves the memory for little close-zoom loss, or paint at a capped size and let the blit upscale.

## B. Gameplay — where it stands

**Strong:** the production hierarchy (Barracks→Motor Pool→Airstrip→Tech Center with independent queues and auto-chained prerequisites) gives real build-order decisions; capturable relays + finite rich ore make the map worth fighting over; the CPU defends, counters stealth, and commits on a telemetry-tuned rule.

**Gaps, ranked by impact on fun:**
1. **No structure placement.** Now that buildings exist, the player can't choose *where* they go — they auto-spiral next to the HQ. Placement is core RTS agency (walling a choke, forward production, spreading to survive splash). This is the biggest gameplay gap the hierarchy just opened.
2. **No rally points.** Units spawn and sit at a fixed offset; you can't pre-route production to the front. One right-click-with-building-selected fixes it.
3. **Sim-only mechanics never reached the game:** hijack (convert), mine-laying, veterancy, abilities — all modelled and balance-verified in the sims, inert in the live engine. Covenant's whole identity (steal/mine/ambush) is thinner in the game than on paper.
4. **No fog of war for the human.** Stealth gates *targeting*, not *vision* — the whole map is always visible, so scouting (the project's central principle, §1) has no in-game expression.
5. **Known-deferred, still open:** easy-mode turtle meat-grinder (wants a surrender/score resign), Directorate weak in CPU-vs-CPU brawls (its repair/siege identity isn't in the sim).

## C. Coding improvements — ranked

### P0 — correctness & scale ceiling
1. **Spatial hash grid.** `acquire`, `separate`, `revealed`, and the relay-capture loop all scan **every entity per entity** — `tick()` is O(n²), and because `acquire`→`revealed` re-scans for detectors, it's **O(n³) whenever stealth is on the field.** Fine at ~50 units (current matches); it will stutter past ~150. A uniform bucket grid rebuilt once per tick turns every one of these into a local-cell query. *Single highest-leverage change; also unblocks bigger armies / 2v2.*
2. **Per-tick detector cache.** Even before the full grid, hoist the detector list out of `revealed()` (computed once per tick, not once per stealth-query). One array; drops the O(n³) to O(n²) immediately.
3. **Cache DOM refs + dirty-flag the HUD.** `render()` calls `getElementById` **9× every frame** and rewrites `textContent`/`innerHTML` unconditionally. Resolve the refs once at init; only write when the value changed. Removes the steady layout/GC pressure the readability HUD added.

### P1 — maintainability (the single-file is fraying)
4. **Split into assembled source.** 872 JS lines in one `<script>` is past comfortable. Keep the single-file *output* but author `game/src/{style,shell,engine,render,models,ai}.*` assembled by a `build-game.mjs` — same offline artifact, reviewable parts. The model kit is the natural first module. (design/21 P1, now overdue.)
5. **One session-state object.** `newGame()` manually resets ~15 globals (`ents, credits, oreUnlocked, over, uid, sel, cpuTimer, cpuAttack, markers, fxDeaths, simSecs, lastLostSfx, relays, brokeT, FRAME`…). Every feature this campaign added another. Build a fresh `G = newState()` and swap it atomically — the stale-global bug farm the structure review predicted is now actively growing.
6. **Inject the CPU scorer, don't duplicate it.** `drift-check.mjs` guards the combat math across the 3 copies, but the CPU `counterScore`/commit policy is hand-mirrored in `match-batch.mjs`, `playtest-check.mjs`, and `ai-policy.mjs` with no guard. Extract to a shared module injected at build time (like the data), or add a scorer-drift check.

### P2 — feel & depth (cheap, high-reward)
7. **Unit animation hooks.** A 2-line per-unit phase (`e.anim = (e.anim+DT*speed)%1`) feeding `drawEnt` a bob/recoil/tread offset. No new per-frame allocations; transforms the "prototype slide" into motion. *Best effort-to-feel ratio in the whole list.*
8. **Structure placement + rally points.** Click-to-place ghost for buildings; right-click-with-producer-selected sets its rally. Closes gaps B1/B2 with modest input code.
9. **Elevation read.** On high ground, lift the contact shadow and add a faint rim-light to the unit — make the +15 % you're fighting for visible.

**Verdict.** The engine is sound where it counts — fixed-timestep sim, cached terrain, script-verified balance — and that discipline is exactly why this review can be specific. The accumulating costs are three: the entity loops will hit a wall as armies grow (P0-1/2), the single file is outgrowing one `<script>` (P1-4/5), and the units look static next to their good terrain (A1 + P2-7). None is urgent today; all compound. The model kit (re-tasked) plus the animation hook (P2-7) would do the most for "worthy of being enjoyed" per hour of work; the spatial grid (P0-1) is the one that protects everything built after it.
