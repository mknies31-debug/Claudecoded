# 10 · Art Direction — "Slightly Cartoon, but Detailed"

> Data: [`../data/art.json`](../data/art.json). A visual style guide lives at `rts/style/` (pending build).

## The look in one line

**Cartoon silhouette, detailed surface.** Bold, chunky, instantly-readable shapes at RTS zoom — with the *detail* carried in the surface (panel lines, rivets, vents, wear) rather than in a busy outline. Think stylized-realism: readable like a cartoon, finished like a model kit.

## Pillars

1. **Silhouette first.** Every unit must be identifiable by outline alone at 100% zoom-out. Distinct silhouettes per role and per faction.
2. **Clean outlines.** ~2–3px dark outline (`#0E1116`) around major forms; thinner interior lines.
3. **Cel shading + one detail pass.** One body tone, one shadow, one highlight, plus a soft occlusion multiply. Then a light detail layer of panel lines/rivets/vents.
4. **Exaggerated proportions.** Chunky treads, oversized cannons, heavy feet — pushed a little past realism, still grounded.
5. **20% team color.** Faction "team color" covers roughly a fifth of each unit (trim, energy, banners); the rest is a desaturated body so team color reads at a glance.
6. **Always grounded.** A soft radial contact shadow under every unit for readability on any terrain.

## Faction visual identity

| | Directorate | Covenant | Array |
|---|---|---|---|
| **Feel** | industrial, orderly, durable | scrappy, fast, salvaged, stealthy | high-tech, energy, shielded |
| **Team color** | steel blue `#2E6FB0` | field green `#5F8A3A` | violet `#7A4FC0` |
| **Body** | gunmetal `#5A6B78` | weathered tan/olive `#6B6152` | white plating `#C7CEDE` |
| **Accent** | hazard amber `#F5A623` | rust orange `#C15A22` + stealth teal `#3FB6A8` | cyan energy `#2AE0E0` |
| **Shapes** | boxy, riveted, symmetrical | asymmetric, exposed frames, improvised | smooth, floating, glowing cores |

## Environment & UI

Ground olive `#7C8A54`, dirt `#8A7A52`, rock `#7B7466`, water `#3E86A0`. UI is dark slate (`#12161C` / panel `#1B212B`) with ink `#EAF0FF` — chunky beveled panels, bold icons, faction-tinted selection.

## Damage states (readability, not just flavor)

- **Healthy:** full color.
- **Damaged:** scorch decals + a thin smoke wisp.
- **Critical:** exposed metal, fire flicker, heavier smoke, sparks.

## Consistency rules

- Same outline weight and cel-ramp across every asset so the roster reads as one game.
- Team color placement is consistent by role (e.g., turret band, shoulder, banner) so players learn to spot it.
- Effects (muzzle, energy, shields) use each faction's accent color, never another faction's.
