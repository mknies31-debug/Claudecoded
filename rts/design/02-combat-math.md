# 02 · Unit & Combat Math

> Bible §6–8. Data: [`../data/combat-rules.json`](../data/combat-rules.json), [`../data/balance-targets.json`](../data/balance-targets.json).

## Unit value

```
Unit Value = Durability + Damage + Mobility + Utility + Range
```

Then adjusted by: technology requirement · build time · production restrictions · population use · micro difficulty · counter vulnerability.

## Durability — effective health

```
Effective Health = Base Health / (1 − Damage Reduction)
```

Example: 1,200 HP with 20% cannon resistance → 1,200 / 0.80 = **1,500 effective HP vs cannon.**

**Do not use one universal effective-HP number.** Compute separately against: small arms · explosive · anti-armor · energy · air attacks · siege.

## Damage — theoretical vs practical

```
Sustained DPS = Damage per Shot × Projectiles / Reload Time
```

Adjust for: accuracy · projectile travel time · overkill · target-acquisition delay · rotation time · setup time · burst reload · damage falloff · area of effect.

A weapon with 100 theoretical DPS may deliver only ~75 practical DPS (misses movers, wastes shots on near-dead units, rotates slowly, needs deployment, can't fire while moving). **Balance from real battle performance, not spreadsheet DPS.**

## Cost-efficiency standard

At **equal cost, equal control, no terrain/veterancy/support/defenses**, the intended outcome:

| Matchup | Expected result |
|---|---|
| Strong counter | Wins with **25–45%** remaining |
| Moderate advantage | Wins with **10–25%** remaining |
| Neutral | Either side survives with **under 15%** |
| Moderate disadvantage | Loses after dealing **60–85%** damage |
| Strong disadvantage | Loses after dealing **30–60%** damage |

A correct counter should matter, but the disadvantaged player must still gain value through positioning or support. (Machine-readable in `balance-targets.json → costEfficiency`.)

## Efficiency score (internal telemetry)

```
Efficiency = Value Destroyed / Unit Cost
```
`<0.7` weak/specialized · `0.8–1.2` normal · `>1.3` strong · `>1.6` consistently → likely problematic. Support units need a separate assisted-value calculation.
