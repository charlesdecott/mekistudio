// Géométrie PURE des câbles (subway 45° adaptatif + ruban). Script classique :
// exposé à la fois pour le navigateur (window.MekiCables) et pour node --test.
(function () {
  const STUB = 18;       // sortie perpendiculaire avant le connecteur (px monde)
  const GAP_LANE = 12;   // espacement de base entre lanes d'un même (node, côté)
  const MARGE = 10;      // garde une ancre sur la face du node
  const HIDE_DIST = 24;  // sous ce centre-à-centre, on masque le câble

  const cx = (b) => b.x + b.w / 2;
  const cy = (b) => b.y + b.h / 2;
  const sideLength = (b, side) => (side === 'left' || side === 'right') ? b.h : b.w;

  // Côté de sortie de a vers b par axe dominant des centres ; tie -> horizontal.
  function adaptiveSide(a, b) {
    const dx = cx(b) - cx(a), dy = cy(b) - cy(a);
    if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left';
    return dy >= 0 ? 'bottom' : 'top';
  }

  // Point d'ancrage sur un côté, décalé de off le long de la tangente, clampé.
  function sideAnchor(b, side, off) {
    const lim = Math.max(0, sideLength(b, side) / 2 - MARGE);
    const o = Math.max(-lim, Math.min(lim, off));
    switch (side) {
      case 'right': return { x: b.x + b.w, y: cy(b) + o };
      case 'left':  return { x: b.x,       y: cy(b) + o };
      case 'top':   return { x: cx(b) + o, y: b.y };
      default:      return { x: cx(b) + o, y: b.y + b.h }; // bottom
    }
  }

  const MekiCables = { STUB, GAP_LANE, MARGE, HIDE_DIST, adaptiveSide, sideAnchor };
  if (typeof module !== 'undefined' && module.exports) module.exports = MekiCables;
  if (typeof window !== 'undefined') window.MekiCables = MekiCables;
})();
