// Disposition organique « neurones » PURE (brique G). Zéro DOM -> testable `node --test`
// (comme cables.js/collision.js/folders.js). Remplace l'arbre vertical (tree-layout.js) rejeté.
//
// Explorateur au CENTRE ; chaque dossier part dans une direction depuis le centre et TOURNE à
// chaque niveau (dendrites) ; frères éclatés en éventail. Déterministe (gigue dérivée de l'id ->
// même arbre = même forme). Puis relaxation anti-collision -> zéro recouvrement. Auto-fit du
// viewport géré côté canvas.js.
(function (root) {
  'use strict';

  function hash(s, seed) {
    s = s + '@' + (seed || 0);
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return Math.abs(h);
  }

  function _overlap(a, b, gap) {
    const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    return (ox > -gap && oy > -gap) ? { ox, oy } : null;
  }

  // Le segment p->q traverse-t-il la boîte b ? (Liang-Barsky, comme cables.js)
  function _segHitsBox(p, q, b) {
    let t0 = 0, t1 = 1;
    const dx = q.x - p.x, dy = q.y - p.y;
    const checks = [[-dx, p.x - b.x], [dx, (b.x + b.w) - p.x], [-dy, p.y - b.y], [dy, (b.y + b.h) - p.y]];
    for (const [pk, qk] of checks) {
      if (pk === 0) { if (qk < 0) return false; continue; }
      const r = qk / pk;
      if (pk < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
      else { if (r < t0) return false; if (r < t1) t1 = r; }
    }
    return t0 <= t1;
  }

  // Relaxation : (1) sépare les nodes qui se recouvrent (entre eux + vs fixes) ET (2) pousse hors d'un
  // CÂBLE tout node tiers qui s'y trouve (le segment parent→enfant) -> couloirs libres pour le routeur
  // subway, donc « zéro câble sous une node » même en disposition organique dense. Borné.
  function _relax(movable, fixed, edges, rootC, gap, iters) {
    const ids = Object.keys(movable);
    const ctr = (b) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
    const cen = (id) => (id == null ? rootC : (movable[id] ? ctr(movable[id]) : rootC));
    // Ordre des contraintes par PRIORITÉ CROISSANTE (la dernière écrite gagne à la fin du tour) :
    // câble (best-effort, organique) -> node↔node -> node↔fixe (colonne vertébrale, invariant dur).
    for (let it = 0; it < iters; it++) {
      let moved = false;
      // (a) pousser un node tiers hors d'un câble (bande autour du segment parent→enfant)
      for (const e of edges) {
        const P = cen(e.parentId), C = cen(e.childId);
        const dx = C.x - P.x, dy = C.y - P.y, L = Math.hypot(dx, dy);
        if (L < 1) continue;
        const nx = -dy / L, ny = dx / L;
        for (const id of ids) {
          if (id === e.childId || id === e.parentId) continue;
          const N = movable[id];
          const inf = { x: N.x - gap, y: N.y - gap, w: N.w + 2 * gap, h: N.h + 2 * gap };
          if (!_segHitsBox(P, C, inf)) continue;
          const nc = ctr(N);
          const s = Math.sign((nc.x - P.x) * nx + (nc.y - P.y) * ny) || 1;
          N.x += nx * s * (gap * 0.5); N.y += ny * s * (gap * 0.5);
          moved = true;
        }
      }
      // (b) séparer les nodes qui se recouvrent
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const A = movable[ids[i]], B = movable[ids[j]];
          const ov = _overlap(A, B, gap);
          if (!ov) continue;
          const dx = (A.x + A.w / 2) - (B.x + B.w / 2), dy = (A.y + A.h / 2) - (B.y + B.h / 2);
          if (Math.abs(dx) >= Math.abs(dy)) { const p = (ov.ox + gap) / 2 * (dx >= 0 ? 1 : -1); A.x += p; B.x -= p; }
          else { const p = (ov.oy + gap) / 2 * (dy >= 0 ? 1 : -1); A.y += p; B.y -= p; }
          moved = true;
        }
      }
      // (c) écarter de la colonne vertébrale figée — DERNIER (invariant : jamais sur kernel/git/chat)
      for (const id of ids) {
        const A = movable[id];
        for (const F of fixed) {
          const ov = _overlap(A, F, gap);
          if (!ov) continue;
          const dx = (A.x + A.w / 2) - (F.x + F.w / 2), dy = (A.y + A.h / 2) - (F.y + F.h / 2);
          if (Math.abs(dx) >= Math.abs(dy)) A.x += (ov.ox + gap) * (dx >= 0 ? 1 : -1);
          else A.y += (ov.oy + gap) * (dy >= 0 ? 1 : -1);
          moved = true;
        }
      }
      if (!moved) break;
    }
  }

  // items : [{ id, parent, w, h, sortKey }] (descendants de rootId). rootId = explorateur (fixe).
  // opts : { rootX, rootY (CENTRE de l'explorateur), rootW, rootH, chaos, length, spread, seed, gap, iters }.
  // -> { id: {x, y} } coin haut-gauche, sans recouvrement.
  function layout(items, rootId, opts) {
    const o = opts || {};
    const chaos = o.chaos != null ? o.chaos : 0.25;
    const length = o.length != null ? o.length : 180;
    const spread = o.spread != null ? o.spread : 1.0;
    const seed = o.seed || 0;
    const gap = o.gap != null ? o.gap : 26;
    const cx0 = o.rootX || 0, cy0 = o.rootY || 0;

    const byId = new Map(items.map((it) => [it.id, it]));
    const children = new Map();
    for (const it of items) {
      // parent inconnu (ni un autre item, ni la racine explicite) -> rattaché à la RACINE pour ne jamais
      // « perdre » un node (ex. fichier à la racine du repo, ou data-source temporairement vide).
      const key = byId.has(it.parent) ? it.parent : rootId;
      if (!children.has(key)) children.set(key, []);
      children.get(key).push(it);
    }
    const kidsOf = (id) => (children.get(id) || []).slice().sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0));

    const center = {}; // id -> {x,y} centre
    const seen = new Set();
    // L'explorateur peut être grand (ex. 300x380) : le 1er niveau doit le DÉGAGER, sinon des nodes
    // qui partent vers le haut/bas atterrissent dedans. Niveaux suivants : `length`.
    const rootRadius = Math.max(o.rootW || 0, o.rootH || 0) / 2;
    function place(it, dir, parentC, depth) {
      if (seen.has(it.id)) return; seen.add(it.id);
      const len = depth === 1
        ? rootRadius + gap + length * (0.15 + (hash(it.id, seed) % 30) / 100)
        : length * (0.78 + (hash(it.id, seed) % 44) / 100);
      const c = { x: parentC.x + Math.cos(dir) * len, y: parentC.y + Math.sin(dir) * len };
      center[it.id] = c;
      const ks = kidsOf(it.id);
      ks.forEach((k, i) => {
        const sp = ks.length > 1 ? (i - (ks.length - 1) / 2) * spread : 0;
        const turn = sp + ((hash(k.id, seed) % 2) ? 1 : -1) * chaos * (0.6 + (hash(k.id + 't', seed) % 50) / 100);
        place(k, dir + turn, c, depth + 1);
      });
    }
    // Distribution angulaire des enfants directs sur un ARC (par défaut le cercle entier).
    // Le canvas passe un arc biaisé à droite pour éviter la « colonne vertébrale » (chat/git/kernel
    // à gauche de l'explorateur) et garder le couloir gauche libre pour le câble explorateur→git.
    const arcStart = o.arcStart != null ? o.arcStart : -Math.PI / 2;
    const arcSpan = o.arcSpan != null ? o.arcSpan : 2 * Math.PI;
    const rootC = { x: cx0, y: cy0 };
    const top = kidsOf(rootId);
    top.forEach((c, i) => {
      const base = arcStart + (top.length ? ((i + 0.5) / top.length) * arcSpan : arcSpan / 2);
      const jitter = ((hash(c.id, seed) % 100) / 100 - 0.5) * 0.6;
      place(c, base + jitter, rootC, 1);
    });

    // boîtes mobiles (coin haut-gauche) + l'explorateur comme obstacle fixe
    const movable = {};
    for (const it of items) { const c = center[it.id]; if (!c) continue; movable[it.id] = { x: c.x - it.w / 2, y: c.y - it.h / 2, w: it.w, h: it.h }; }
    const fixed = [];
    if (o.rootW && o.rootH) fixed.push({ x: cx0 - o.rootW / 2, y: cy0 - o.rootH / 2, w: o.rootW, h: o.rootH });
    if (Array.isArray(o.obstacles)) for (const b of o.obstacles) fixed.push(b); // ex. kernel/git/chat (figés)
    // câbles parent→enfant (parentId null = explorateur au centre) pour la relaxation anti-câble-sous-node.
    const edges = [];
    for (const it of items) { if (!movable[it.id]) continue; edges.push({ childId: it.id, parentId: (it.parent === rootId || !movable[it.parent]) ? null : it.parent }); }
    _relax(movable, fixed, edges, { x: cx0, y: cy0 }, gap, o.iters != null ? o.iters : 300);
    // garantie dure : une dernière passe « hors colonne vertébrale » (jamais un node sur kernel/git/chat).
    for (let pass = 0; pass < 8; pass++) {
      let moved = false;
      for (const id in movable) {
        const A = movable[id];
        for (const F of fixed) {
          const ov = _overlap(A, F, gap);
          if (!ov) continue;
          const dx = (A.x + A.w / 2) - (F.x + F.w / 2), dy = (A.y + A.h / 2) - (F.y + F.h / 2);
          if (Math.abs(dx) >= Math.abs(dy)) A.x += (ov.ox + gap) * (dx >= 0 ? 1 : -1);
          else A.y += (ov.oy + gap) * (dy >= 0 ? 1 : -1);
          moved = true;
        }
      }
      if (!moved) break;
    }

    const out = {};
    for (const id in movable) out[id] = { x: movable[id].x, y: movable[id].y };
    return out;
  }

  const MekiNeuroLayout = { layout };
  if (typeof module !== 'undefined' && module.exports) module.exports = MekiNeuroLayout;
  if (typeof window !== 'undefined') root.MekiNeuroLayout = MekiNeuroLayout;
})(typeof window !== 'undefined' ? window : globalThis);
