// Géométrie/topologie PURE du node « subcanvas » (brique H). Zéro DOM -> testable `node --test`.
(function (root) {
  'use strict';

  // Ids des descendants TRANSITIFS de `rootId` dans l'arbre `source_id` (exclut la racine).
  // links: [{id, source}]. Déterministe (parcours en largeur, ordre d'insertion des liens).
  function descendants(links, rootId) {
    const kids = new Map();
    links.forEach((l) => { if (!kids.has(l.source)) kids.set(l.source, []); kids.get(l.source).push(l.id); });
    const out = [];
    const stack = (kids.get(rootId) || []).slice();
    const seen = new Set();
    while (stack.length) {
      const id = stack.shift();
      if (seen.has(id)) continue;            // garde-fou anti-cycle
      seen.add(id); out.push(id);
      (kids.get(id) || []).forEach((c) => stack.push(c));
    }
    return out;
  }

  // Boîte englobante de `boxes` ({x,y,w,h}) dilatée de `pad` sur les 4 côtés, plus une bande de
  // titre de `titleH` réservée EN HAUT (le header du cadre y vit, jamais recouvert par un descendant).
  // Retourne {x,y,w,h} ou null si aucune boîte.
  function derivedBounds(boxes, opts) {
    opts = opts || {};
    const pad = opts.pad == null ? 24 : opts.pad;
    const titleH = opts.titleH == null ? 26 : opts.titleH;
    if (!boxes || !boxes.length) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const b of boxes) {
      minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h);
    }
    const x = Math.round(minX - pad);
    const y = Math.round(minY - pad - titleH);
    return { x, y, w: Math.round(maxX + pad - x), h: Math.round(maxY + pad - y) };
  }

  const MekiSubcanvas = { descendants, derivedBounds };
  if (typeof module !== 'undefined' && module.exports) module.exports = MekiSubcanvas;
  if (typeof window !== 'undefined') root.MekiSubcanvas = MekiSubcanvas;
})(typeof window !== 'undefined' ? window : globalThis);
