# 20 · Playable Engine (v1)

> The first **playable** build — a single-file, offline browser skirmish, now at **V1** (three selectable factions, true collision + A\* pathfinding, and the special-trait mechanics — shields, stealth/detection, static defenses — live). Play it: [`../game/index.html`](../game/index.html). Data injected by [`../scripts/build-game-data.mjs`](../scripts/build-game-data.mjs).

This is the runtime every §50 "requires a live build" gate was blocked on. It deliberately reuses the balance work rather than re-inventing it: the **same unit data** (`data/units/*.json`), the **same map** (`data/maps/twin-ridge.json`), the **same combat math** (`pdps` / `effHP`, effective-HP-by-damage-type with `ignoreResist`), and a CPU driven by the **same counter-scoring** as [`ai-policy.mjs`](../scripts/ai-policy.mjs).

## What it is

**Your faction vs the CPU's faction** on Twin Ridge — both chosen from top-bar dropdowns (**Directorate / Covenant / Array**), no longer hardcoded. Destroy the enemy HQ.

- **Control:** left-drag to select, right-click to move / attack, right-click a resource with a gatherer to harvest · wheel zoom · WASD pan · **F** follow. Two top-bar dropdowns pick the player and CPU faction before/at match start.
- **Economy:** wood gatherers give the safe floor income; a **Mining Vehicle unlocks tier-2+** (the ore soft-tech-gate from `resources.json`, enforced live — tier-2/3 build buttons are locked until you have ore).
- **Combat:** units auto-acquire in range and fire; damage is the sim's model (fraction removed = `pdps / effHP`), so armor types, splash (`aoe`), and **high-ground +15%** all matter. Range/first-strike/kiting emerge from real-time positioning.
- **CPU:** an economy→tech→composition→attack policy — keeps gatherers, saves for the ore gatherer to reach tier-2, builds the units that best counter your army (same effHP scoring as the reference brain), and attacks when its army is big enough. **No stat cheats** (§40) — it plays the same units you do.
- **Difficulty (Easy→Expert)** ties the CPU to the [`ai-policy`](../scripts/ai-policy.mjs) axis — it degrades *decisions*, never stats: Easy stays on tier-1 spam with a thin economy and attacks late; Expert runs a bigger economy, techs on time, builds best-response counters, and commits sooner. (Verified: at 150 s Easy is stuck on ~12 Raiders / no ore, Expert has teched and is building counters.)
- **Build speed (Normal / Fast / Instant)** scales production time for quicker games (a full match resolves ~254 s → ~169 s at Instant).
- **Win/lose** on HQ destruction.

Verified headlessly (DOM/canvas shim): a full match runs to a **decisive result** — a passive player loses to the CPU in ~4 min — with the real economy, tech-gate, build queues, combat, and AI all live.

## V1 features (what shipped)

The V1 pass turned the previously-stubbed systems into live mechanics, each driven by the **same unit/map data** rather than bespoke engine tables:

- **A\* pathfinding / true collision.** Units now route *around* the map's impassable barriers instead of sliding straight through them. A navigation grid is built from `MAP.barriers` (the cliffs and deep-water pools that were previously visual-only), and ground units A\*-path around it while keeping their separation steering. **Aircraft fly over terrain** — air units ignore the barrier grid. This replaces the old "straight-line, no obstacle avoidance" stub; the high-ground damage zone stays live alongside it.
- **Faction selection.** The third faction **Array** is unlocked, and **both** the player and CPU factions are chosen live from top-bar dropdowns (Directorate / Covenant / Array) — no hardcoded matchup. Array brings energy weapons, **shields**, and shield-piercing (`ignoreResist`) units, so faction choice now changes the mechanics on the field, not just the roster.
- **Immobile structures.** Units flagged `mobile:false` (Sentry Turret, Flak Battery, Rocket Nest, Sensor Spike, Pylon Turret) are **pinned to their build position** and act as static defense / detection instead of gliding toward targets. Movement orders skip them; they acquire and fire in place.
- **Energy shields (Array).** Any unit with an energy resistance (`resist.energy`) gets a **regenerating shield pool sized to its base HP**. Incoming damage depletes the shield before it touches HP, and the shield regenerates over time when not under fire — *unless* the attacker carries `ignoreResist` (a **shield-break** weapon, e.g. Disruptor / Nullifier), which bypasses the shield straight to HP. Shield vs shield-break is the intended rock-paper-scissors: Array's durability is real against most attackers but folds to the units built to pierce it.
- **Stealth & detection.** Stealth units (Saboteur, Ambush Tank — data flag `stealth`) are **untargetable by an enemy unless that side fields a detector** (Recon Spotter / Hound, Probe Skimmer, Sensor Spike, Flak Battery, Pylon Turret — flag `detector`) within scanning range. `acquire()` now checks a unit's **reveal state**, not just range and ownership, so cloak actually hides you and detection is what buys the counter-play.
- **Visual feedback UI.** The HUD surfaces the **HQ build queue** (what's producing, its progress, and the queued count), the **live harvesting / income rate**, and **selection counts** — so economy and production are readable in-engine instead of inferred.
- **Dynamic camera with follow.** The view is now a real camera (world-space center + zoom) instead of a fixed full-map letterbox. **Mouse wheel zooms 1×–5×, anchored at the cursor** (the world point under the pointer stays put; 1× is the classic whole-map view); **WASD / arrow keys pan** (speed scales inversely with zoom), clamped so the view never leaves the map. The headline is **follow**: press **F** with units selected and the camera smoothly tracks the selection's centroid — it follows your army around the map rather than magnifying the whole screen; manual pan or an empty selection releases it. Architecturally, the offscreen terrain cache is painted once in world space (fixed px-per-tile) so pan/zoom costs a single scaled `drawImage` per frame — the camera didn't sacrifice the render-cache win — and because every system (input hit-testing, orders, drawing) goes through the same world↔screen transforms, it required no changes to simulation code (camera state never affects sim outcomes).

**Playability wave:** a **3-map pool** with an in-game selector (Twin Ridge / Open Steppe / Scrapline — all 19/19 map tests incl. nav-grid reachability); **capturable relay towers** (hold ground 8 s → the relay grants detection around it — stealth counterplay as a map objective); **finite ore** (rich center nodes pay 16 cr/s vs 11 but mine out; wood renews — the §04 floor/ceiling economy live); double-click type-select and **Ctrl+1–5 control groups**; CPU **counter-intel** (buys a detector when you field stealth); and the telemetry-driven CPU rebalance (P7 commit rule + stalemate breaker + two-sided trade-ratio counter-picker — see [design/21](21-engine-structure-review.md)).

**Polish pass:** a **minimap** (terrain thumbnail + unit dots + camera-viewport rectangle, click/drag to jump the camera), order-feedback markers (green move / red attack / gold harvest rings), death bursts, weapon-range rings on selection, hi-DPI-sharp rendering, an options-preserving **Play again / faction change → Start screen** flow (no page reload), match time on the result banner, and minimal synth SFX (order/build/loss/result) with a mute toggle — gesture-gated and silent in headless runs.

## What's still stubbed (honest scope of v1)

- **Base building / placement:** one HQ produces everything, including the immobile structures — you can't yet *place* a building at a chosen spot; the tech gate is still modelled as the ore unlock, not separate constructable structures.
- **Fog of war for the human player:** the map is fully visible to you (stealth/detection gates *targeting*, not vision), and the CPU still reads your army directly; real per-side perception is the next AI layer ([design/19](19-ai-opponent.md)).
- **Micro depth:** no veterancy, abilities, retreat AI, or formations yet.
- **Per-unit unique behaviors:** the special traits that need bespoke logic in the live game — hijack, mine-laying, and similar one-off abilities — are modelled in the sims but not yet wired as in-engine actions.

**A deliberate modelling note:** the live game shares the sims' `pdps`/`effHP` math but *formulates* damage differently — per shot it removes `maxHp · (pdps·reload / effHP)` of the target with flat 50% splash inside `aoe`, and kiting/range/first-strike are **emergent from real-time positioning** rather than the sims' analytic `kiteFactor`/first-strike-window. Both derive from the same certified numbers; they are two views of one model, not two models. (Structure review: [design/21](21-engine-structure-review.md).)

## What it unlocks on the §50 checklist

The engine is the vehicle the remaining runtime gates need: it demonstrates **AI using only legal resources** (§40) in a live loop, and it's the harness that can be **instrumented** for the measured-target gates (faction/matchup win rates, match length, pick rates) once it runs headless match batches. Those instrumentation passes are the natural next step.
