/* ============================================================================
 * models.js — cel-shaded unit & building silhouettes for the single-file RTS.
 * Plain script (no modules). Defines global MODELS: a map of class/building
 * name -> (ctx, r, C) draw function. Each shape is drawn CENTERED at (0,0)
 * with footprint ~radius r. Mobile units face +x (the caller has already
 * translated + rotated the context). Buildings are drawn unrotated.
 *
 *   C = { team, dark, lite, accent, outline }
 *     team    faction color   — dominant on hull / body (~>50% area)
 *     dark    pre-shaded body shadow / treads / recesses
 *     lite    pre-shaded body highlight
 *     accent  damage-type color — WEAPON element only, may be null -> skip
 *     outline '#0b0e12'-ish dark ink for all major forms
 *
 * House style: bold readable silhouettes, dark outlines at ~r*0.16, three body
 * tones + outline, flat cel fills (NO gradients), detail in the surface (panel
 * lines / rivets / vents) not the silhouette, chunky proportions.
 * ========================================================================== */
const MODELS = (function () {
  'use strict';
  const TAU = Math.PI * 2;

  // -- shared drawing helpers ------------------------------------------------
  function ink(ctx, r, C) {            // set the house outline style
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(1, r * 0.16);
    ctx.strokeStyle = C.outline;
  }
  function rr(ctx, x, y, w, h, rad) {  // rounded-rect PATH (no fill/stroke)
    rad = Math.min(rad, Math.abs(w) / 2, Math.abs(h) / 2);
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + w, y, x + w, y + h, rad);
    ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.arcTo(x, y + h, x, y, rad);
    ctx.arcTo(x, y, x + w, y, rad);
    ctx.closePath();
  }
  function poly(ctx, pts) {            // closed polygon PATH from [[x,y],...]
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
  }
  function disc(ctx, x, y, rad) { ctx.beginPath(); ctx.arc(x, y, rad, 0, TAU); }
  function fs(ctx) { ctx.fill(); ctx.stroke(); }   // outlined fill of current path
  function f(ctx) { ctx.fill(); }                  // bare fill (interior detail)
  const wep = C => C.accent || C.dark;             // weapon tint; dark when unarmed

  // small helper: a filled+outlined rounded rect in one call
  function box(ctx, x, y, w, h, rad, fill) { ctx.fillStyle = fill; rr(ctx, x, y, w, h, rad); fs(ctx); }

  /* ======================= MOBILE: INFANTRY ============================== */

  // one soldier: boots + body + head + rifle; the rifle muzzle carries accent
  function soldierBase(ctx, r, C) {
    // boots / legs (shadow tone)
    ctx.fillStyle = C.dark;
    rr(ctx, -r * 0.34, r * 0.3, r * 0.3, r * 0.55, r * 0.1); fs(ctx);
    rr(ctx, r * 0.04, r * 0.3, r * 0.3, r * 0.55, r * 0.1); fs(ctx);
    // backpack (shadow) behind the torso
    ctx.fillStyle = C.dark;
    rr(ctx, -r * 0.52, -r * 0.32, r * 0.3, r * 0.7, r * 0.12); fs(ctx);
    // torso (team — dominant)
    ctx.fillStyle = C.team;
    rr(ctx, -r * 0.44, -r * 0.46, r * 0.82, r * 0.92, r * 0.28); fs(ctx);
    // chest highlight
    ctx.fillStyle = C.lite;
    rr(ctx, -r * 0.08, -r * 0.36, r * 0.4, r * 0.44, r * 0.16); f(ctx);
    // head (team) + face highlight + helmet brow line
    ctx.fillStyle = C.team; disc(ctx, 0, -r * 0.62, r * 0.33); fs(ctx);
    ctx.fillStyle = C.lite; disc(ctx, r * 0.08, -r * 0.66, r * 0.14); f(ctx);
    ctx.fillStyle = C.dark;
    rr(ctx, -r * 0.3, -r * 0.74, r * 0.6, r * 0.12, r * 0.06); f(ctx);  // helmet rim
  }
  const Infantry = (ctx, r, C) => {
    ink(ctx, r, C);
    soldierBase(ctx, r, C);
    // rifle across the chest pointing +x, accent at the muzzle
    ctx.fillStyle = C.dark;
    rr(ctx, -r * 0.08, -r * 0.04, r * 1.0, r * 0.16, r * 0.06); fs(ctx);
    ctx.fillStyle = C.dark;                                   // stock
    rr(ctx, -r * 0.26, -r * 0.1, r * 0.22, r * 0.3, r * 0.07); f(ctx);
    ctx.fillStyle = wep(C);                                   // muzzle
    rr(ctx, r * 0.78, -r * 0.06, r * 0.2, r * 0.2, r * 0.06); fs(ctx);
  };

  // soldier + shoulder-mounted launcher TUBE (accent at the tube mouth)
  const Specialist = (ctx, r, C) => {
    ink(ctx, r, C);
    soldierBase(ctx, r, C);
    // chunky launcher over the shoulder, tilted slightly up toward +x
    ctx.save();
    ctx.translate(-r * 0.1, -r * 0.38);
    ctx.rotate(-0.22);
    ctx.fillStyle = C.dark;                                   // tube body
    rr(ctx, -r * 0.35, -r * 0.17, r * 1.4, r * 0.34, r * 0.17); fs(ctx);
    ctx.fillStyle = C.lite;                                   // top highlight strip
    rr(ctx, -r * 0.2, -r * 0.14, r * 0.95, r * 0.09, r * 0.04); f(ctx);
    ctx.fillStyle = wep(C);                                   // muzzle ring (+x)
    disc(ctx, r * 1.02, 0, r * 0.19); fs(ctx);
    ctx.fillStyle = C.dark;                                   // back-blast vent (-x)
    poly(ctx, [[-r * 0.35, -r * 0.2], [-r * 0.62, 0], [-r * 0.35, r * 0.2]]); fs(ctx);
    ctx.restore();
  };

  /* ======================= MOBILE: VEHICLES ============================== */

  // small pointed wedge + antenna + light gun; no turret, no treads
  const Scout = (ctx, r, C) => {
    ink(ctx, r, C);
    // under-shadow / skirt
    ctx.fillStyle = C.dark;
    poly(ctx, [[-r * 0.85, -r * 0.5], [r * 0.55, -r * 0.46], [r * 1.02, 0],
               [r * 0.55, r * 0.46], [-r * 0.85, r * 0.5]]); fs(ctx);
    // wheel nubs
    ctx.fillStyle = C.dark;
    disc(ctx, -r * 0.5, r * 0.5, r * 0.2); fs(ctx);
    disc(ctx, r * 0.35, r * 0.5, r * 0.2); fs(ctx);
    // wedge hull (team) — inset so the skirt reads as a rim
    ctx.fillStyle = C.team;
    poly(ctx, [[-r * 0.78, -r * 0.4], [r * 0.5, -r * 0.36], [r * 0.9, 0],
               [r * 0.5, r * 0.36], [-r * 0.78, r * 0.4]]); fs(ctx);
    // canopy (highlight)
    ctx.fillStyle = C.lite;
    poly(ctx, [[-r * 0.3, -r * 0.26], [r * 0.3, -r * 0.2], [r * 0.5, 0],
               [r * 0.3, r * 0.2], [-r * 0.3, r * 0.26]]); f(ctx);
    // antenna sweeping back-up (dark, not a weapon)
    ctx.strokeStyle = C.outline; ctx.lineWidth = Math.max(1, r * 0.1);
    ctx.beginPath(); ctx.moveTo(-r * 0.7, -r * 0.2); ctx.lineTo(-r * 1.0, -r * 0.95); ctx.stroke();
    ctx.fillStyle = C.dark; disc(ctx, -r * 1.0, -r * 0.98, r * 0.12); f(ctx);
    // light gun (+x) with accent tip
    ink(ctx, r, C);
    ctx.fillStyle = C.dark; rr(ctx, r * 0.4, -r * 0.08, r * 0.55, r * 0.16, r * 0.06); fs(ctx);
    ctx.fillStyle = wep(C); rr(ctx, r * 0.9, -r * 0.08, r * 0.18, r * 0.16, r * 0.05); f(ctx);
  };

  // wide hull + chunky treads + big central turret + single barrel
  const Tank = (ctx, r, C) => {
    ink(ctx, r, C);
    // treads top & bottom (run along +x)
    ctx.fillStyle = C.dark;
    rr(ctx, -r * 1.02, -r * 0.98, r * 2.04, r * 0.34, r * 0.1); fs(ctx);
    rr(ctx, -r * 1.02, r * 0.64, r * 2.04, r * 0.34, r * 0.1); fs(ctx);
    // tread lugs (surface detail)
    ctx.strokeStyle = C.outline; ctx.lineWidth = Math.max(1, r * 0.07);
    for (let i = -4; i <= 4; i++) {
      const x = i * r * 0.22;
      ctx.beginPath(); ctx.moveTo(x, -r * 0.96); ctx.lineTo(x, -r * 0.66); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x, r * 0.66); ctx.lineTo(x, r * 0.96); ctx.stroke();
    }
    ink(ctx, r, C);
    // hull (team — dominant)
    ctx.fillStyle = C.team; rr(ctx, -r * 0.96, -r * 0.66, r * 1.92, r * 1.32, r * 0.22); fs(ctx);
    // glacis highlight
    ctx.fillStyle = C.lite; rr(ctx, -r * 0.9, -r * 0.58, r * 1.1, r * 0.3, r * 0.12); f(ctx);
    // turret (team) + highlight + rim band
    ctx.fillStyle = C.team; disc(ctx, -r * 0.05, 0, r * 0.62); fs(ctx);
    ctx.fillStyle = C.lite; disc(ctx, -r * 0.22, -r * 0.2, r * 0.3); f(ctx);
    ctx.fillStyle = C.dark;                                  // mantlet collar
    rr(ctx, r * 0.35, -r * 0.22, r * 0.3, r * 0.44, r * 0.1); fs(ctx);
    // barrel (+x) + accent muzzle
    ctx.fillStyle = C.dark; rr(ctx, r * 0.55, -r * 0.12, r * 0.85, r * 0.24, r * 0.1); fs(ctx);
    ctx.fillStyle = wep(C); rr(ctx, r * 1.28, -r * 0.14, r * 0.2, r * 0.28, r * 0.07); fs(ctx);
  };

  // angular hull + TWIN weapon pods (clearly not a tank)
  const Advanced = (ctx, r, C) => {
    ink(ctx, r, C);
    // under-skirt shadow (angular, no big treads)
    ctx.fillStyle = C.dark;
    poly(ctx, [[-r * 0.92, -r * 0.52], [-r * 0.55, -r * 0.84], [r * 0.7, -r * 0.84],
               [r * 1.0, -r * 0.3], [r * 1.0, r * 0.3], [r * 0.7, r * 0.84],
               [-r * 0.55, r * 0.84], [-r * 0.92, r * 0.52]]); fs(ctx);
    // angular hull (team)
    ctx.fillStyle = C.team;
    poly(ctx, [[-r * 0.82, -r * 0.44], [-r * 0.5, -r * 0.72], [r * 0.6, -r * 0.72],
               [r * 0.86, -r * 0.26], [r * 0.86, r * 0.26], [r * 0.6, r * 0.72],
               [-r * 0.5, r * 0.72], [-r * 0.82, r * 0.44]]); fs(ctx);
    // faceted highlight down the spine
    ctx.fillStyle = C.lite;
    poly(ctx, [[-r * 0.5, -r * 0.5], [r * 0.4, -r * 0.5], [r * 0.5, 0],
               [r * 0.4, 0], [-r * 0.5, 0]]); f(ctx);
    // central sensor dome
    ctx.fillStyle = C.dark; disc(ctx, -r * 0.1, 0, r * 0.26); fs(ctx);
    ctx.fillStyle = C.lite; disc(ctx, -r * 0.16, -r * 0.06, r * 0.1); f(ctx);
    // TWIN pods (upper + lower) projecting +x, accent muzzles
    const pod = (cy) => {
      ctx.fillStyle = C.dark; rr(ctx, r * 0.3, cy - r * 0.2, r * 0.75, r * 0.4, r * 0.12); fs(ctx);
      ctx.fillStyle = wep(C); rr(ctx, r * 0.98, cy - r * 0.14, r * 0.18, r * 0.28, r * 0.06); fs(ctx);
    };
    pod(-r * 0.44); pod(r * 0.44);
  };

  // tiny chassis + VERY long barrel + rear recoil spade
  const Artillery = (ctx, r, C) => {
    ink(ctx, r, C);
    // rear recoil spade dug in behind (-x)
    ctx.fillStyle = C.dark;
    poly(ctx, [[-r * 0.55, -r * 0.34], [-r * 1.18, 0], [-r * 0.55, r * 0.34]]); fs(ctx);
    // short tracks under the small chassis
    ctx.fillStyle = C.dark;
    rr(ctx, -r * 0.62, r * 0.42, r * 1.0, r * 0.26, r * 0.08); fs(ctx);
    // small hull (team), set back
    ctx.fillStyle = C.team; rr(ctx, -r * 0.62, -r * 0.5, r * 1.0, r * 0.92, r * 0.18); fs(ctx);
    // cab highlight
    ctx.fillStyle = C.lite; rr(ctx, -r * 0.52, -r * 0.42, r * 0.5, r * 0.4, r * 0.12); f(ctx);
    // mount pivot
    ctx.fillStyle = C.dark; disc(ctx, r * 0.02, -r * 0.05, r * 0.24); fs(ctx);
    // VERY long barrel (+x), longer than the tank's
    ctx.fillStyle = C.dark; rr(ctx, -r * 0.05, -r * 0.12, r * 1.6, r * 0.22, r * 0.1); fs(ctx);
    // muzzle brake (accent)
    ctx.fillStyle = wep(C); rr(ctx, r * 1.42, -r * 0.18, r * 0.26, r * 0.36, r * 0.08); fs(ctx);
  };

  // swept-wing gunship, nose at +x, rotor/jet hint at the tail
  const Aircraft = (ctx, r, C) => {
    ink(ctx, r, C);
    // swept wings (team) sweeping back from mid-body
    ctx.fillStyle = C.team;
    poly(ctx, [[r * 0.15, -r * 0.14], [-r * 0.2, -r * 0.14], [-r * 0.75, -r * 0.95],
               [-r * 0.45, -r * 1.0]]); fs(ctx);                 // top wing
    poly(ctx, [[r * 0.15, r * 0.14], [-r * 0.2, r * 0.14], [-r * 0.75, r * 0.95],
               [-r * 0.45, r * 1.0]]); fs(ctx);                  // bottom wing
    // tail fins
    ctx.fillStyle = C.dark;
    poly(ctx, [[-r * 0.72, -r * 0.1], [-r * 1.02, -r * 0.42], [-r * 0.78, -r * 0.08]]); fs(ctx);
    poly(ctx, [[-r * 0.72, r * 0.1], [-r * 1.02, r * 0.42], [-r * 0.78, r * 0.08]]); fs(ctx);
    // fuselage (team) — a long tapered diamond, nose at +x
    ctx.fillStyle = C.team;
    poly(ctx, [[r * 1.1, 0], [r * 0.2, -r * 0.3], [-r * 0.85, -r * 0.2],
               [-r * 0.85, r * 0.2], [r * 0.2, r * 0.3]]); fs(ctx);
    // fuselage spine highlight
    ctx.fillStyle = C.lite;
    poly(ctx, [[r * 0.9, 0], [r * 0.1, -r * 0.15], [-r * 0.7, -r * 0.08], [-r * 0.7, 0]]); f(ctx);
    // cockpit
    ctx.fillStyle = C.lite; disc(ctx, r * 0.42, 0, r * 0.18); fs(ctx);
    // engine exhausts (jet hint) at the tail
    ctx.fillStyle = C.dark;
    disc(ctx, -r * 0.8, -r * 0.1, r * 0.1); f(ctx);
    disc(ctx, -r * 0.8, r * 0.1, r * 0.1); f(ctx);
    // nose cannon (accent)
    ctx.fillStyle = wep(C);
    poly(ctx, [[r * 1.1, 0], [r * 0.82, -r * 0.14], [r * 0.82, r * 0.14]]); fs(ctx);
  };

  /* ======================= STATIC: DEFENSE =============================== */

  // round turret base + head + barrel (static; barrel drawn toward +x)
  const Structure = (ctx, r, C) => {
    ink(ctx, r, C);
    // octagonal base (dark) with footprint ring
    const o = r * 0.92, k = o * 0.42;
    ctx.fillStyle = C.dark;
    poly(ctx, [[-k, -o], [k, -o], [o, -k], [o, k], [k, o], [-k, o], [-o, k], [-o, -k]]); fs(ctx);
    // base team ring
    ctx.fillStyle = C.team; disc(ctx, 0, 0, r * 0.74); fs(ctx);
    // rivets around the ring
    ctx.fillStyle = C.outline;
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * TAU;
      disc(ctx, Math.cos(a) * r * 0.74, Math.sin(a) * r * 0.74, r * 0.07); f(ctx);
    }
    // rotating head (team) + highlight
    ctx.fillStyle = C.team; disc(ctx, -r * 0.05, 0, r * 0.5); fs(ctx);
    ctx.fillStyle = C.lite; disc(ctx, -r * 0.18, -r * 0.16, r * 0.24); f(ctx);
    // collar + barrel (+x) with accent muzzle
    ctx.fillStyle = C.dark; rr(ctx, r * 0.25, -r * 0.18, r * 0.3, r * 0.36, r * 0.1); fs(ctx);
    ctx.fillStyle = C.dark; rr(ctx, r * 0.45, -r * 0.11, r * 0.65, r * 0.22, r * 0.09); fs(ctx);
    ctx.fillStyle = wep(C); rr(ctx, r * 0.98, -r * 0.13, r * 0.18, r * 0.26, r * 0.07); fs(ctx);
  };

  /* ======================= BUILDINGS (unrotated) ========================= */
  // helper for a tiny 1-glyph label (single short fillText, cel-safe)
  function glyph(ctx, r, C, ch, y) {
    ctx.fillStyle = C.lite;
    ctx.font = 'bold ' + (r * 0.72).toFixed(1) + 'px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(ch, 0, y == null ? -r * 0.05 : y);
  }

  // fortified command block
  const HQ = (ctx, r, C) => {
    ink(ctx, r, C);
    // outer wall
    ctx.fillStyle = C.dark; rr(ctx, -r, -r, 2 * r, 2 * r, r * 0.14); fs(ctx);
    // corner towers
    ctx.fillStyle = C.dark;
    const tw = r * 0.5;
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sy]) => {
      rr(ctx, sx * r - (sx < 0 ? 0 : tw), sy * r - (sy < 0 ? 0 : tw), tw, tw, r * 0.08); fs(ctx);
    });
    // crenellations along the top wall
    ctx.fillStyle = C.outline;
    for (let i = -2; i <= 2; i++) rr(ctx, i * r * 0.34 - r * 0.1, -r * 1.02, r * 0.2, r * 0.22, r * 0.04), f(ctx);
    // inner keep (team — dominant)
    ctx.fillStyle = C.team; rr(ctx, -r * 0.6, -r * 0.6, r * 1.2, r * 1.2, r * 0.1); fs(ctx);
    // roof highlight band
    ctx.fillStyle = C.lite; rr(ctx, -r * 0.6, -r * 0.6, r * 1.2, r * 0.34, r * 0.1); f(ctx);
    // door
    ctx.fillStyle = C.outline; rr(ctx, -r * 0.22, r * 0.18, r * 0.44, r * 0.42, r * 0.08); f(ctx);
    // 'HQ' label
    glyph(ctx, r, C, 'HQ', -r * 0.02);
  };

  // production hall base shared by Barracks / Motor Pool / Airstrip / Tech
  function hall(ctx, r, C) {
    ctx.fillStyle = C.dark; rr(ctx, -r, -r * 0.72, 2 * r, r * 1.5, r * 0.12); fs(ctx);
    ctx.fillStyle = C.team; rr(ctx, -r * 0.9, -r * 0.6, r * 1.8, r * 1.3, r * 0.1); fs(ctx);
  }

  // bunkhouse + door (half-round roof)
  const Barracks = (ctx, r, C) => {
    ink(ctx, r, C);
    hall(ctx, r, C);
    // half-cylinder roof (team) with highlight
    ctx.fillStyle = C.team;
    ctx.beginPath(); ctx.moveTo(-r * 0.92, -r * 0.5);
    ctx.arc(0, -r * 0.5, r * 0.92, Math.PI, 0, false); ctx.closePath(); fs(ctx);
    ctx.fillStyle = C.lite;
    ctx.beginPath(); ctx.arc(0, -r * 0.5, r * 0.92, Math.PI, Math.PI * 1.45, false);
    ctx.arc(0, -r * 0.5, r * 0.66, Math.PI * 1.45, Math.PI, true); ctx.closePath(); f(ctx);
    // door (dark) with lite frame
    ctx.fillStyle = C.lite; rr(ctx, -r * 0.24, r * 0.05, r * 0.48, r * 0.7, r * 0.06); f(ctx);
    ctx.fillStyle = C.outline; rr(ctx, -r * 0.18, r * 0.12, r * 0.36, r * 0.63, r * 0.05); f(ctx);
    // windows
    ctx.fillStyle = C.lite;
    rr(ctx, -r * 0.72, r * 0.12, r * 0.26, r * 0.26, r * 0.05); f(ctx);
    rr(ctx, r * 0.46, r * 0.12, r * 0.26, r * 0.26, r * 0.05); f(ctx);
    glyph(ctx, r, C, 'B', -r * 0.5);
  };

  // garage bay + overhead crane arm
  const MotorPool = (ctx, r, C) => {
    ink(ctx, r, C);
    hall(ctx, r, C);
    // flat team roof slab
    ctx.fillStyle = C.lite; rr(ctx, -r * 0.9, -r * 0.6, r * 1.8, r * 0.28, r * 0.08); f(ctx);
    // big bay door (dark arch) with garage-panel lines
    ctx.fillStyle = C.outline;
    ctx.beginPath(); ctx.moveTo(-r * 0.5, r * 0.75);
    ctx.lineTo(-r * 0.5, -r * 0.1); ctx.arc(0, -r * 0.1, r * 0.5, Math.PI, 0, false);
    ctx.lineTo(r * 0.5, r * 0.75); ctx.closePath(); f(ctx);
    ctx.strokeStyle = C.dark; ctx.lineWidth = Math.max(1, r * 0.06);
    for (let i = 1; i <= 3; i++) {
      const y = -r * 0.1 + i * r * 0.2;
      ctx.beginPath(); ctx.moveTo(-r * 0.5, y); ctx.lineTo(r * 0.5, y); ctx.stroke();
    }
    ink(ctx, r, C);
    // crane: post + boom arm + hook (the signature)
    ctx.fillStyle = C.dark; rr(ctx, r * 0.6, -r * 1.0, r * 0.18, r * 1.3, r * 0.05); fs(ctx);
    ctx.fillStyle = C.dark; rr(ctx, -r * 0.2, -r * 1.0, r * 0.9, r * 0.18, r * 0.05); fs(ctx);
    ctx.strokeStyle = C.outline; ctx.lineWidth = Math.max(1, r * 0.08);
    ctx.beginPath(); ctx.moveTo(-r * 0.12, -r * 0.9); ctx.lineTo(-r * 0.12, -r * 0.5); ctx.stroke();
    ctx.fillStyle = wep(C); disc(ctx, -r * 0.12, -r * 0.42, r * 0.12); fs(ctx);  // hook block
    glyph(ctx, r, C, 'M', r * 0.5);
  };

  // runway strip + apron pad + small control box
  const Airstrip = (ctx, r, C) => {
    ink(ctx, r, C);
    // apron (dark)
    ctx.fillStyle = C.dark; rr(ctx, -r, -r * 0.7, 2 * r, r * 1.4, r * 0.1); fs(ctx);
    // runway strip (team) down the middle
    ctx.fillStyle = C.team; rr(ctx, -r * 0.95, -r * 0.3, r * 1.9, r * 0.6, r * 0.06); fs(ctx);
    // dashed centerline (highlight)
    ctx.fillStyle = C.lite;
    for (let i = -3; i <= 3; i++) rr(ctx, i * r * 0.28 - r * 0.08, -r * 0.05, r * 0.16, r * 0.1, r * 0.03), f(ctx);
    // threshold chevrons at the +x end
    ctx.fillStyle = C.lite;
    for (let i = 0; i < 2; i++) {
      const x = r * 0.62 + i * r * 0.16;
      poly(ctx, [[x, -r * 0.24], [x + r * 0.12, 0], [x, r * 0.24], [x - r * 0.04, r * 0.24],
                 [x + r * 0.08, 0], [x - r * 0.04, -r * 0.24]]); f(ctx);
    }
    // control box at the -x end
    ctx.fillStyle = C.team; rr(ctx, -r * 0.92, -r * 0.62, r * 0.42, r * 0.44, r * 0.06); fs(ctx);
    ctx.fillStyle = C.outline; rr(ctx, -r * 0.84, -r * 0.54, r * 0.26, r * 0.2, r * 0.04); f(ctx);
    glyph(ctx, r, C, 'A', r * 0.46);
  };

  // dish / antenna array on a block
  const TechCenter = (ctx, r, C) => {
    ink(ctx, r, C);
    // block base
    ctx.fillStyle = C.dark; rr(ctx, -r * 0.9, -r * 0.1, r * 1.8, r * 0.82, r * 0.1); fs(ctx);
    ctx.fillStyle = C.team; rr(ctx, -r * 0.8, -r * 0.02, r * 1.6, r * 0.66, r * 0.08); fs(ctx);
    ctx.fillStyle = C.lite; rr(ctx, -r * 0.8, -r * 0.02, r * 1.6, r * 0.18, r * 0.08); f(ctx);
    glyph(ctx, r, C, 'T', r * 0.36);
    // mast
    ctx.fillStyle = C.dark; rr(ctx, -r * 0.08, -r * 0.7, r * 0.16, r * 0.72, r * 0.05); fs(ctx);
    // parabolic dish, tilted up-right (team face + dark rim)
    ctx.save();
    ctx.translate(0, -r * 0.72);
    ctx.rotate(-0.5);
    ctx.fillStyle = C.team;
    ctx.beginPath(); ctx.ellipse(0, 0, r * 0.26, r * 0.62, 0, 0, TAU); fs(ctx);
    ctx.fillStyle = C.lite;
    ctx.beginPath(); ctx.ellipse(-r * 0.06, -r * 0.08, r * 0.14, r * 0.42, 0, 0, TAU); f(ctx);
    // feed horn at focus
    ctx.strokeStyle = C.outline; ctx.lineWidth = Math.max(1, r * 0.08);
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(r * 0.5, 0); ctx.stroke();
    ctx.fillStyle = (C.accent || C.lite); disc(ctx, r * 0.5, 0, r * 0.1); f(ctx);  // node
    ctx.restore();
    // side antenna spikes with node tips
    ctx.strokeStyle = C.outline; ctx.lineWidth = Math.max(1, r * 0.08);
    ctx.beginPath(); ctx.moveTo(-r * 0.62, -r * 0.05); ctx.lineTo(-r * 0.8, -r * 0.55); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(r * 0.62, -r * 0.05); ctx.lineTo(r * 0.8, -r * 0.55); ctx.stroke();
    ctx.fillStyle = (C.accent || C.lite);
    disc(ctx, -r * 0.8, -r * 0.58, r * 0.08); f(ctx);
    disc(ctx, r * 0.8, -r * 0.58, r * 0.08); f(ctx);
  };

  return {
    'Basic infantry': Infantry,
    'Specialist infantry': Specialist,
    'Scout vehicle': Scout,
    'Main battle tank': Tank,
    'Advanced vehicle': Advanced,
    'Artillery': Artillery,
    'Aircraft': Aircraft,
    'Structure': Structure,
    'HQ': HQ,
    'Barracks': Barracks,
    'Motor Pool': MotorPool,
    'Airstrip': Airstrip,
    'Tech Center': TechCenter,
  };
})();

// expose as a real global property for both the browser <script> include and
// headless (vm) verification; harmless if globalThis is unavailable.
try { if (typeof globalThis !== 'undefined') globalThis.MODELS = MODELS; } catch (e) {}
