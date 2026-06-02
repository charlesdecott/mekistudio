// Géométrie PURE de placement des « node-zones » (brique G). Zéro DOM -> testable `node --test`.
(function (root) {
  'use strict';

  // Solveur de relaxation : répulsion dure (zones ne se chevauchent jamais) + ressort backbone
  // (enfant tiré vers son parent à distance-repos). Déterministe (aucun aléa). pinned = immobile.
  // zones: [{ id, parentId, center:{x,y}, radius, pinned }]. Retourne Map<id,{x,y}>.
  function solve(zones, opts) {
    opts = opts || {};
    const VOID = opts.VOID == null ? 60 : opts.VOID;
    const GAP = opts.GAP == null ? 40 : opts.GAP;
    const ITERS = opts.iters == null ? 80 : opts.iters;
    const SPRING = opts.spring == null ? 0.12 : opts.spring;
    const pos = new Map(), byId = new Map();
    zones.forEach((z) => { pos.set(z.id, { x: z.center.x, y: z.center.y }); byId.set(z.id, z); });

    for (let it = 0; it < ITERS; it++) {
      // 1) ressort backbone (doux) — l'enfant rejoint la distance-repos du parent
      for (const z of zones) {
        if (z.pinned || !z.parentId || !byId.has(z.parentId)) continue;
        const p = byId.get(z.parentId);
        const pc = pos.get(z.id), pp = pos.get(z.parentId);
        let dx = pc.x - pp.x, dy = pc.y - pp.y; let d = Math.hypot(dx, dy) || 1;
        const rest = z.radius + p.radius + GAP;
        const move = (d - rest) * SPRING; const ux = dx / d, uy = dy / d;
        pc.x -= ux * move; pc.y -= uy * move;
        if (!p.pinned) { pp.x += ux * move; pp.y += uy * move; }
      }
      // 2) répulsion (dure) — APRÈS le ressort, donc le dernier mot revient au "pas de chevauchement"
      for (let i = 0; i < zones.length; i++) {
        for (let j = i + 1; j < zones.length; j++) {
          const a = zones[i], b = zones[j];
          const pa = pos.get(a.id), pb = pos.get(b.id);
          let dx = pb.x - pa.x, dy = pb.y - pa.y; let d = Math.hypot(dx, dy);
          const min = a.radius + b.radius + VOID;
          if (d >= min) continue;
          if (d < 1e-6) { dx = a.id < b.id ? 1 : -1; dy = 0; d = 1; } // confondus -> sépare sur x (déterministe)
          const push = min - d, ux = dx / d, uy = dy / d;
          const wa = a.pinned ? 0 : (b.pinned ? 1 : 0.5);
          const wb = b.pinned ? 0 : (a.pinned ? 1 : 0.5);
          pa.x -= ux * push * wa; pa.y -= uy * push * wa;
          pb.x += ux * push * wb; pb.y += uy * push * wb;
        }
      }
    }
    return pos;
  }

  const MekiZoneLayout = { solve };
  if (typeof module !== 'undefined' && module.exports) module.exports = MekiZoneLayout;
  if (typeof window !== 'undefined') root.MekiZoneLayout = MekiZoneLayout;
})(typeof window !== 'undefined' ? window : globalThis);
