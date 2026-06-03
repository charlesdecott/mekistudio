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

  // Range des fichiers en ANNEAUX concentriques autour de la tuile dossier (anneau proche d'abord,
  // croissance vers l'extérieur). Aucun chevauchement (tuile + fichiers déjà posés). Déterministe.
  // Retourne le top-left de chaque fichier, dans le même ordre que `fileSizes`.
  function packAround(folderCenter, folderSize, fileSizes, opts) {
    opts = opts || {};
    const gap = opts.gap == null ? 14 : opts.gap;
    const out = [];
    if (!fileSizes || !fileSizes.length) return out;
    const placed = [{ x: folderCenter.x - folderSize.w / 2, y: folderCenter.y - folderSize.h / 2, w: folderSize.w, h: folderSize.h }];
    const hit = (a, b) => a.x < b.x + b.w + gap && a.x + a.w + gap > b.x && a.y < b.y + b.h + gap && a.y + a.h + gap > b.y;
    // Anneaux SERRÉS qui HUGGENT le dossier : le pas radial suit la HAUTEUR des fichiers (lignes proches),
    // l'espacement angulaire suit la LARGEUR (pas de chevauchement). -> zone compacte, lien fichier court.
    const rowStep = Math.max(...fileSizes.map((s) => s.h)) + gap;
    const colStep = Math.max(...fileSizes.map((s) => s.w)) + gap;
    const base = Math.max(folderSize.w, folderSize.h) / 2 + gap + Math.max(...fileSizes.map((s) => s.h)) / 2; // 1er anneau HUGGE la tuile
    let idx = 0;
    for (let ring = 1; ring <= 60 && idx < fileSizes.length; ring++) {
      const radius = base + (ring - 1) * rowStep;
      const slots = Math.max(3, Math.floor((2 * Math.PI * radius) / colStep));
      for (let k = 0; k < slots && idx < fileSizes.length; k++) {
        const ang = (k / slots) * 2 * Math.PI; // déterministe, régulier
        const fs = fileSizes[idx];
        const box = { x: folderCenter.x + Math.cos(ang) * radius - fs.w / 2, y: folderCenter.y + Math.sin(ang) * radius - fs.h / 2, w: fs.w, h: fs.h };
        if (placed.some((p) => hit(p, box))) continue; // créneau pris -> suivant
        const rb = { x: Math.round(box.x), y: Math.round(box.y), w: fs.w, h: fs.h };
        out.push({ x: rb.x, y: rb.y });
        placed.push(rb); idx++;
      }
    }
    return out;
  }

  // Angle (radians) du MILIEU du plus grand secteur angulaire libre autour d'un centre, étant
  // donné les angles déjà occupés par les voisins. Sert à initialiser une NOUVELLE zone "vers le vide".
  function freestAngle(occupied) {
    // occupied: angles en radians dans [0, 2π).
    if (!occupied || !occupied.length) return 0;
    if (occupied.length === 1) return occupied[0] + Math.PI;
    const s = occupied.slice().sort((a, b) => a - b);
    let best = s[0] + Math.PI, bestSector = -1;
    for (let i = 0; i < s.length; i++) {
      const a0 = s[i], a1 = i + 1 < s.length ? s[i + 1] : s[0] + Math.PI * 2;
      if (a1 - a0 > bestSector) { bestSector = a1 - a0; best = a0 + (a1 - a0) / 2; }
    }
    return best;
  }

  // Layout d'ARBRE RADIAL orienté (dendrite) : l'explorateur (racine, pinned) au centre, chaque dossier
  // posé VERS L'EXTÉRIEUR sur un rayon. Une chaîne à enfant unique part TOUT DROIT (même cap que le
  // parent, rayon croissant) ; une fourche évente ses enfants dans un CÔNE vers l'avant (jamais en sens
  // opposé). Rayon d'un enfant = rayon parent + r_parent + GAP + r_enfant (sa zone juste au-delà de celle
  // du parent). Déterministe (enfants triés par id) -> stable au reload. zones: [{id,parentId,radius,
  // pinned,center}]. Retourne Map<id,{x,y}> (centres). La racine garde son centre courant.
  function radialLayout(zones, opts) {
    opts = opts || {};
    const GAP = opts.gap == null ? 40 : opts.gap;
    const CONE = opts.cone == null ? 0.85 : opts.cone; // demi-angle d'éventail d'une fourche (~49°)
    const START = opts.start == null ? -Math.PI / 2 : opts.start; // 1er rayon vers le HAUT
    const byId = new Map(), kids = new Map(), pos = new Map();
    zones.forEach((z) => { byId.set(z.id, z); kids.set(z.id, []); });
    let root = zones.find((z) => z.pinned) || zones.find((z) => !z.parentId || !byId.has(z.parentId)) || zones[0];
    if (!root) return pos;
    zones.forEach((z) => {
      if (z.id === root.id) return;
      const pid = (z.parentId && byId.has(z.parentId)) ? z.parentId : root.id; // orphelin -> racine
      kids.get(pid).push(z.id);
    });
    // ordre des enfants par sortKey (ex. chemin de dossier) si fourni, sinon par id : le 1er rend le
    // layout REPRODUCTIBLE quels que soient les ids générés (course des spawns concurrents).
    const keyOf = (id) => { const z = byId.get(id); return (z && z.sortKey != null) ? String(z.sortKey) : String(id); };
    kids.forEach((list) => list.sort((a, b) => keyOf(a).localeCompare(keyOf(b))));
    const rootC = { x: root.center.x, y: root.center.y };
    pos.set(root.id, { x: Math.round(rootC.x), y: Math.round(rootC.y) });
    // pose récursive : un node à (bearing, radius) depuis la racine ; ses enfants en cône vers l'avant.
    const place = (nodeId, bearing, radius) => {
      pos.set(nodeId, { x: Math.round(rootC.x + Math.cos(bearing) * radius), y: Math.round(rootC.y + Math.sin(bearing) * radius) });
      const node = byId.get(nodeId), cl = kids.get(nodeId), k = cl.length;
      cl.forEach((cid, i) => {
        const child = byId.get(cid);
        const cr = radius + node.radius + GAP + child.radius;
        const cb = k === 1 ? bearing : bearing - CONE + (2 * CONE) * (i / (k - 1)); // 1 enfant -> tout droit
        place(cid, cb, cr);
      });
    };
    const top = kids.get(root.id), K = top.length;
    top.forEach((cid, i) => {
      const child = byId.get(cid);
      const r = root.radius + GAP + child.radius;
      const b = K === 1 ? START : START + (i / K) * 2 * Math.PI; // dossiers de 1er niveau étalés autour
      place(cid, b, r);
    });
    return pos;
  }

  // Packe les fichiers d'un dossier en COLONNE le long d'un CAP (bearing) -> ils filent VERS L'EXTÉRIEUR
  // (dendrite), la zone reste ÉTROITE côté parent (juste la tuile) -> les dossiers peuvent être proches.
  // Retourne le top-left de chaque fichier RELATIF au centre de la tuile (origine). Déterministe.
  function packOutward(folderSize, fileSizes, bearing, opts) {
    opts = opts || {};
    const gap = opts.gap == null ? 12 : opts.gap;
    const out = [];
    if (!fileSizes || !fileSizes.length) return out;
    const ux = Math.cos(bearing), uy = Math.sin(bearing);
    let d = Math.max(folderSize.w, folderSize.h) / 2 + gap; // 1er fichier juste au-delà de la tuile
    for (let i = 0; i < fileSizes.length; i++) {
      const fs = fileSizes[i];
      const ext = Math.abs(ux) * fs.w + Math.abs(uy) * fs.h; // extension du fichier le long du cap
      const cx = ux * (d + ext / 2), cy = uy * (d + ext / 2); // centre du fichier sur le rayon
      out.push({ x: Math.round(cx - fs.w / 2), y: Math.round(cy - fs.h / 2) });
      d += ext + gap;
    }
    return out;
  }

  const MekiZoneLayout = { solve, packAround, freestAngle, radialLayout, packOutward };
  if (typeof module !== 'undefined' && module.exports) module.exports = MekiZoneLayout;
  if (typeof window !== 'undefined') root.MekiZoneLayout = MekiZoneLayout;
})(typeof window !== 'undefined' ? window : globalThis);
