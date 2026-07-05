# 07 · Maps

> Bible §37–38. Terrain numbers: [`../data/terrain.json`](../data/terrain.json).

## Per-map testing (§37)

Every competitive map must be tested for: resource equality · travel-time equality · expansion safety · buildable area · choke width · airspace · infantry cover · artillery positions · neutral objectives · faction-specific advantages.

**Travel-time tolerance between spawns:**

| Destination | Max difference |
|---|---|
| Central objectives | 1 second |
| Expansion locations | 2 seconds |
| Distant flank routes | 3 seconds |

## Terrain: high ground & natural barriers

Data + exact modifiers: [`../data/terrain.json`](../data/terrain.json). The guiding rule — **terrain shapes fights without deciding them.** Every modifier sits at or below the armor-facing swing (0.9/1.1/1.3) so position matters but numbers and splash can always answer it.

### High ground — a real edge, both ways

High ground helps you **on defense and on offense**, which is exactly what makes it worth fighting for:

| | Effect | Which half |
|---|---|---|
| **Shooting down** | +15% damage, +15% range, full vision over obstacles | **offensive** — you reach farther and hit harder |
| **Shooting up** | −15% damage, −10% range, and the plateau top is hidden until you climb or scout it | **defensive** — attackers below hit softer, shorter, and half-blind |

Net ≈ a **30% firepower swing** to whoever holds the hill — comparable to catching a unit in the rear, i.e. meaningful but **breakable**:

- **Area weapons ignore the shoot-up penalty.** Splash, artillery, and flame are how you *dislodge* a dug-in hilltop — the same exemption cover gets against area fire. A hill full of infantry still melts to a Howitzer or a Scorch Buggy below it.
- **Short-range / melee** get no elevation modifier — once you're in the gap, height doesn't matter.
- **Elevated artillery** keeps the range bonus and full vision, so high-ground artillery nests are a specific §37 test item — but they must **not** out-range an entire base approach from safety.

**Access ties high ground to barriers:** a plateau's only ground route is its **ramp** — a natural strongpoint (and a §14 "defensive terrain" comeback tool). Narrow ramps concentrate the defender's fire and multiply splash. Aircraft and climb/jump units ignore ramps, so an all-ground army is never walled out of *every* hill.

### Natural barriers

Barriers channel movement into readable lanes and create the chokes, flanks, and safe economy pockets the rest of the design assumes. Each states what it blocks and what bypasses it:

- **Impassable** (cliffs, deep water, canyon walls) — block all ground; only air (and naval/amphibious where allowed) bypass. These define the map skeleton: spawns, expansion pockets, and the chokes between them.
- **Destructible forest** — blocks vehicle sight and movement, passable by infantry, grants concealment; cleared by fire/explosives. Infantry ambush terrain.
- **Rubble / wreckage** — partial cover, slows movement, salvageable (§14); transient, unlike cliffs.

**Choke width is a §37 test** because it picks the winning army: **narrow** (1–2 lanes) rewards splash/artillery/defensive holds; **medium** (3–4) is the default combined-arms width; **wide/open** (5+) rewards mobility, flanking, and vehicles. Every narrow choke needs at least one flank route, so terrain *rewards* a hold without *dictating* one.

### High-ground/barrier map tests (extends §37)

- Every plateau reachable by ground via ≥1 ramp — no air-only high ground on a ground map.
- Elevated artillery can't bombard a base from full safety.
- A flank exists around every narrow choke.
- Spawns share equal elevation relative to each other (mirror the high ground).

## Map-pool diversity (§38)

The ranked pool must contain a mix — **do not include only one style**:

- Open vehicle maps
- Moderate choke-point maps
- Urban infantry maps
- Expansion-heavy maps
- Multi-route maps
- Maps with limited environmental hazards

**A faction must not be balanced around maps that always favor its preferred army.** If a faction performs very differently by map (a §49 warning sign), the map pool — not just the faction — is suspect.
