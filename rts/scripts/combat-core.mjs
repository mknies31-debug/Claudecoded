// Shared combat primitives for the duel (matchup.mjs) and army-composition
// (composition.mjs) simulators, so BOTH engines model the SAME physics:
// per-damage-type effective HP, sustained DPS, range/kiting, and first-strike.
// Constants that are loop-resolution or scoring choices (DT, MAX_T, RETREAT,
// win thresholds) stay in each script; only the shared mechanics live here.

// sustained damage/sec: shot damage * projectiles / reload, scaled by accuracy (§6-8).
export const pdps = u => u.reload > 0 ? (u.dmg * u.proj / u.reload) * (u.acc / 100) : 0;

// effective HP vs a given damage type: hp / (1 - resist). Shield-break
// (ignoreResist) bypasses resistance (§15-B). Full resist → Infinity (immune).
export const effHP = (def, atkType, atk) => {
  if (atk && atk.ignoreResist) return def.hp;            // shield-break bypasses resist (§15-B)
  const r = (def.resist?.[atkType] ?? 0) / 100;
  return r < 1 ? def.hp / (1 - r) : Infinity;
};

// Kiting: an out-ranged attacker returns less fire while it closes the gap.
// Mobile units partly close it; immobile (structures) get kited hard. gap>0
// means "I am out-ranged by my foe". Identical formula in both sims.
export function kiteFactor(myRange, foeRange, mobile) {
  const gap = foeRange - myRange;                        // >0 means I'm out-ranged
  if (gap <= 0) return 1;
  return mobile ? Math.max(0.5, 1 - 0.10 * gap) : Math.max(0.05, 1 - 0.30 * gap);
}

// First-strike window (seconds) the longer-ranged side fires unanswered:
// proportional to how far it out-ranges the target, capped at 8 s. Returns 0
// when not out-ranging. In a 1v1 the max of the two directions reproduces the
// duel's min(8, |rangeA - rangeB|).
export function firstStrikeWindow(myRange, foeRange) {
  return Math.min(8, Math.max(0, myRange - foeRange));
}
