# 20 · Playable Engine (v0.1)

> The first **playable** build — a single-file, offline browser skirmish. Play it: [`../game/index.html`](../game/index.html). Data injected by [`../scripts/build-game-data.mjs`](../scripts/build-game-data.mjs).

This is the runtime every §50 "requires a live build" gate was blocked on. It deliberately reuses the balance work rather than re-inventing it: the **same unit data** (`data/units/*.json`), the **same map** (`data/maps/twin-ridge.json`), the **same combat math** (`pdps` / `effHP`, effective-HP-by-damage-type with `ignoreResist`), and a CPU driven by the **same counter-scoring** as [`ai-policy.mjs`](../scripts/ai-policy.mjs).

## What it is

**Directorate (you) vs Covenant (CPU)** on Twin Ridge. Destroy the enemy HQ.

- **Control:** left-drag to select, right-click to move / attack, right-click a resource with a gatherer to harvest.
- **Economy:** wood gatherers give the safe floor income; a **Mining Vehicle unlocks tier-2+** (the ore soft-tech-gate from `resources.json`, enforced live — tier-2/3 build buttons are locked until you have ore).
- **Combat:** units auto-acquire in range and fire; damage is the sim's model (fraction removed = `pdps / effHP`), so armor types, splash (`aoe`), and **high-ground +15%** all matter. Range/first-strike/kiting emerge from real-time positioning.
- **CPU:** an economy→tech→composition→attack policy — keeps gatherers, saves for the ore gatherer to reach tier-2, builds the units that best counter your army (same effHP scoring as the reference brain), and attacks when its army is big enough. **No stat cheats** (§40) — it plays the same units you do.
- **Win/lose** on HQ destruction.

Verified headlessly (DOM/canvas shim): a full match runs to a **decisive result** — a passive player loses to the CPU in ~4 min — with the real economy, tech-gate, build queues, combat, and AI all live.

## What's stubbed (honest scope of v0.1)

- **Pathfinding:** units steer straight-line with separation; no obstacle avoidance around cliffs/water yet (they're visual + the high-ground damage zone is live).
- **Fog of war / scouting:** the CPU reads your army directly; real perception is the next AI layer ([design/19](19-ai-opponent.md)).
- **Base building / full tech tree:** one HQ produces everything; the tech gate is modelled as the ore unlock, not separate structures.
- **Micro depth:** no veterancy, abilities, retreat AI, or formations yet.

## What it unlocks on the §50 checklist

The engine is the vehicle the remaining runtime gates need: it demonstrates **AI using only legal resources** (§40) in a live loop, and it's the harness that can be **instrumented** for the measured-target gates (faction/matchup win rates, match length, pick rates) once it runs headless match batches. Those instrumentation passes are the natural next step.
