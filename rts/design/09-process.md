# 09 · Balance Process & Patching

> Bible §47–49. Data: [`../data/balance-targets.json`](../data/balance-targets.json) (warning signs).

## Patch process (§47)

**Step 1 — Identify the problem.** Is it numerical · mechanical · visual · audio · map-related · matchup-specific · skill-level-specific?

**Step 2 — Find the smallest solution.** Change one primary variable, in this preferred order:

1. Fix bugs
2. Improve warning / readability
3. Adjust build time
4. Adjust technology requirement
5. Adjust cost
6. Adjust cooldown
7. Adjust speed
8. Adjust health
9. Adjust damage
10. Redesign mechanic

**Step 3 — Test secondary effects.** A tank cost change ripples into economy timing, factory value, counter-unit demand, tech timing, team games.

**Step 4 — Observe.** Allow sufficient match volume before another major adjustment, unless clearly game-breaking.

## Patch size (§48)

- **Normal balance patch:** 5–12 meaningful changes.
- **Major seasonal patch:** 15–30 changes, limited redesigns, map-pool update.
- **Emergency hotfix:** only a severe exploit or dominant imbalance.

**Avoid repeatedly changing the entire game** — players need time to learn and adapt.

## Warning signs (§49) — investigate immediately

- One opening exceeds **60%** usage
- One faction exceeds **54%** matchup win rate
- One unit appears in nearly every army
- One unit is almost never built
- Average match time rises sharply
- Early surrender rate rises
- Superweapons determine too many matches
- Defensive games become common
- One faction performs very differently by map
- Beginner and expert data diverge dramatically
- Players cannot explain counterplay

(Also encoded in `balance-targets.json → warningSigns` for automated dashboards.)
