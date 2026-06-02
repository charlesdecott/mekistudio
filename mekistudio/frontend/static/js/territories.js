// Géométrie PURE des « territoires » de dossier (brique G). Zéro DOM -> testable `node --test`.
// Trace un polygone ARRONDI (blob) qui englobe un groupe de points (les coins des nodes d'un dossier).
(function (root) {
  'use strict';

  // Enveloppe convexe (Andrew monotone chain). points: [{x,y}] -> hull CCW (sans doublon de fin).
  function convexHull(points) {
    const pts = points.slice().sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
    // dédoublonne (points confondus -> instabilité)
    const uniq = [];
    for (const p of pts) { const last = uniq[uniq.length - 1]; if (!last || last.x !== p.x || last.y !== p.y) uniq.push(p); }
    if (uniq.length <= 2) return uniq;
    const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    const lower = [];
    for (const p of uniq) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
    const upper = [];
    for (let i = uniq.length - 1; i >= 0; i--) { const p = uniq[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
    lower.pop(); upper.pop();
    return lower.concat(upper);
  }

  // Chemin SVG FERMÉ lissé (Catmull-Rom -> cubiques) passant par les points.
  function _smoothClosed(p) {
    const n = p.length;
    let d = 'M ' + p[0].x.toFixed(1) + ' ' + p[0].y.toFixed(1) + ' ';
    for (let i = 0; i < n; i++) {
      const p0 = p[(i - 1 + n) % n], p1 = p[i], p2 = p[(i + 1) % n], p3 = p[(i + 2) % n];
      const c1x = p1.x + (p2.x - p0.x) / 6, c1y = p1.y + (p2.y - p0.y) / 6;
      const c2x = p2.x - (p3.x - p1.x) / 6, c2y = p2.y - (p3.y - p1.y) / 6;
      d += 'C ' + c1x.toFixed(1) + ' ' + c1y.toFixed(1) + ' ' + c2x.toFixed(1) + ' ' + c2y.toFixed(1) + ' ' + p2.x.toFixed(1) + ' ' + p2.y.toFixed(1) + ' ';
    }
    return d + 'Z';
  }

  // Blob arrondi englobant `points`, dilaté de `pad` vers l'extérieur (depuis le centroïde).
  function roundedHullPath(points, pad) {
    pad = pad == null ? 24 : pad;
    let hull = convexHull(points);
    if (!hull.length) return '';
    const cx = hull.reduce((s, p) => s + p.x, 0) / hull.length;
    const cy = hull.reduce((s, p) => s + p.y, 0) / hull.length;
    if (hull.length === 1) { const c = hull[0]; const r = pad; return 'M ' + (c.x - r).toFixed(1) + ' ' + c.y.toFixed(1) + ' a ' + r + ' ' + r + ' 0 1 0 ' + (2 * r) + ' 0 a ' + r + ' ' + r + ' 0 1 0 ' + (-2 * r) + ' 0 Z'; }
    if (hull.length === 2) { // segment -> insère 2 points perpendiculaires pour avoir un blob
      const a = hull[0], b = hull[1]; const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1; const nx = -dy / L, ny = dx / L;
      hull = [a, { x: mx + nx * pad, y: my + ny * pad }, b, { x: mx - nx * pad, y: my - ny * pad }];
    }
    const off = hull.map((p) => { const dx = p.x - cx, dy = p.y - cy, d = Math.hypot(dx, dy) || 1; return { x: p.x + dx / d * pad, y: p.y + dy / d * pad }; });
    return _smoothClosed(off);
  }

  // Helper : les 4 coins d'une boîte {x,y,w,h}.
  function boxCorners(b) {
    return [{ x: b.x, y: b.y }, { x: b.x + b.w, y: b.y }, { x: b.x + b.w, y: b.y + b.h }, { x: b.x, y: b.y + b.h }];
  }

  // Les 2 coins de la boîte les plus proches d'un point `toward` (le « pied » du pont côté parent).
  function nearCorners(box, toward) {
    const c = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
    let ox = c.x - toward.x, oy = c.y - toward.y; const L = Math.hypot(ox, oy) || 1; ox /= L; oy /= L;
    const cs = boxCorners(box).map((p) => ({ p, d: (p.x - c.x) * ox + (p.y - c.y) * oy }));
    cs.sort((a, b) => a.d - b.d); // d le plus petit = le plus VERS `toward`
    return [cs[0].p, cs[1].p];
  }

  // Dilate un polygone CONVEXE de `d` px vers l'extérieur, par OFFSET D'ARÊTE (Minkowski-ish) : chaque
  // ARÊTE recule de `d` le long de sa normale extérieure (le vrai « vide » entre zones, contrairement à
  // une dilatation radiale qui sous-dilate sur les axes). tester dilate(A, VIDE) ∩ B revient à exiger
  // que A et B soient distants d'au moins VIDE (règle « 2 zones ne se touchent pas »). Polygone
  // dégénéré (<3 pts) -> repli radial depuis le centroïde.
  function dilate(poly, d) {
    if (!poly || poly.length < 3) {
      if (!poly || !poly.length) return poly || [];
      const cx = poly.reduce((s, p) => s + p.x, 0) / poly.length, cy = poly.reduce((s, p) => s + p.y, 0) / poly.length;
      return poly.map((p) => { const dx = p.x - cx, dy = p.y - cy, L = Math.hypot(dx, dy) || 1; return { x: p.x + dx / L * d, y: p.y + dy / L * d }; });
    }
    let area = 0;
    for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; area += a.x * b.y - b.x * a.y; }
    const pts = area > 0 ? poly : poly.slice().reverse(); // force CCW -> normale extérieure cohérente
    const n = pts.length;
    const en = []; // normale extérieure unitaire de l'arête i -> i+1 (CCW : (dy, -dx))
    for (let i = 0; i < n; i++) { const a = pts[i], b = pts[(i + 1) % n]; let nx = b.y - a.y, ny = -(b.x - a.x); const L = Math.hypot(nx, ny) || 1; en.push({ x: nx / L, y: ny / L }); }
    const out = [];
    for (let i = 0; i < n; i++) {
      const nA = en[(i - 1 + n) % n], nB = en[i]; // arêtes partageant le sommet i
      let bx = nA.x + nB.x, by = nA.y + nB.y; const L = Math.hypot(bx, by) || 1; bx /= L; by /= L; // bissectrice
      const cosHalf = Math.max(0.3, bx * nB.x + by * nB.y); // borne : pas d'explosion sur angle aigu
      out.push({ x: pts[i].x + bx * d / cosHalf, y: pts[i].y + by * d / cosHalf });
    }
    return out;
  }

  // SAT : deux polygones CONVEXES se chevauchent-ils ? (intérieurs qui s'intersectent)
  // Utilisé pour la répulsion : refuser un placement dont le blob toucherait un autre blob.
  function convexPolysIntersect(A, B) {
    if (!A || !B || A.length < 3 || B.length < 3) return false;
    for (const poly of [A, B]) {
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length];
        const nx = -(b.y - a.y), ny = (b.x - a.x); // normale de l'arête
        let minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
        for (const p of A) { const d = p.x * nx + p.y * ny; if (d < minA) minA = d; if (d > maxA) maxA = d; }
        for (const p of B) { const d = p.x * nx + p.y * ny; if (d < minB) minB = d; if (d > maxB) maxB = d; }
        if (maxA <= minB || maxB <= minA) return false; // axe séparateur -> pas de chevauchement
      }
    }
    return true;
  }

  const MekiTerritories = { convexHull, roundedHullPath, boxCorners, nearCorners, convexPolysIntersect, dilate };
  if (typeof module !== 'undefined' && module.exports) module.exports = MekiTerritories;
  if (typeof window !== 'undefined') root.MekiTerritories = MekiTerritories;
})(typeof window !== 'undefined' ? window : globalThis);
