# Node-Zone Relaxation Layout — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Faire du dossier une « node-zone » (tuile au centre, fichiers autour, dans la zone), avec un moteur de relaxation qui garantit zéro chevauchement de zones et un backbone dossier→dossier lisible.

**Architecture:** Un module pur `zonelayout.js` (testé `node --test`) fournit le solveur de relaxation (`solve`), le packing intra-zone (`packAround`) et l'angle d'init d'une nouvelle zone (`freestAngle`). `canvas.js` câble ça en DOM impératif : il construit les disques-zones depuis le DOM, appelle `solve`, écrit les positions (animées par transition CSS), range les fichiers via `packAround`, puis redessine câbles + territoires. Le rendu de zone inverse `folderBlobCorners` (la tuile dossier entre dans le hull). Le routage backbone traite les zones comme obstacles. Une passe CSS met le backbone en avant.

**Tech Stack:** JavaScript vanilla (modules `(function(root){…})` exposant `window.MekiXxx`), `node:test`/`node:assert` pour les tests purs, Playwright pour la validation d'intégration. Pas de dépendance nouvelle.

---

## File Structure

- **Create** `mekistudio/frontend/static/js/zonelayout.js` — module pur `MekiZoneLayout` : `solve`, `packAround`, `freestAngle` (+ helpers internes). Une responsabilité : la géométrie de placement des zones et de leurs fichiers.
- **Create** `mekistudio/frontend/static/js/zonelayout.test.js` — tests `node --test` du module pur.
- **Modify** `mekistudio/frontend/static/js/canvas.js` — `folderBlobCorners` (inversion : inclure la tuile), nouvelle méthode `relayoutZones`, branchements (spawn/create/remove/boot), routage backbone (zones obstacles).
- **Modify** `mekistudio/frontend/static/js/territories.test.js` — un test : le hull inclut la tuile dossier.
- **Modify** `mekistudio/frontend/static/css/canvas.css` — hiérarchie visuelle des câbles (backbone épais/vif, fichiers fins/atténués).
- **Modify** `mekistudio/frontend/templates/canvas.html` — charger `zonelayout.js`.
- **Modify** `CLAUDE.md`, `docs/ARCHITECTURE.md` — mise à jour de l'invariant « les nodes bougent en douceur ».
- **Create** `scripts/pw-zone-layout.mjs` — validation Playwright du scénario réel.

Constantes & signatures (cohérence inter-tâches) :
- `MekiZoneLayout.solve(zones, opts) -> Map<id,{x,y}>` ; `opts = { iters=80, VOID=60, GAP=40, spring=0.12 }`.
- `MekiZoneLayout.packAround(folderCenter, folderSize, fileSizes, opts) -> [{x,y}]` (top-left de chaque fichier) ; `opts = { gap=18 }`.
- `MekiZoneLayout.freestAngle(occupied) -> radians`.
- `zone` = `{ id, parentId, center:{x,y}, radius, pinned }`.

---

## Task 1: `zonelayout.js` — solveur de relaxation `solve`

**Files:**
- Create: `mekistudio/frontend/static/js/zonelayout.js`
- Test: `mekistudio/frontend/static/js/zonelayout.test.js`

- [ ] **Step 1: Write the failing test**

```js
// mekistudio/frontend/static/js/zonelayout.test.js
const test = require('node:test');
const assert = require('node:assert');
const Z = require('./zonelayout.js');

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

test('solve : deux zones qui se chevauchent sont écartées d’au moins VOID', () => {
  const zones = [
    { id: 'a', parentId: null, center: { x: 0, y: 0 }, radius: 50, pinned: false },
    { id: 'b', parentId: null, center: { x: 20, y: 0 }, radius: 50, pinned: false },
  ];
  const pos = Z.solve(zones, { iters: 120, VOID: 60, GAP: 40 });
  const d = dist(pos.get('a'), pos.get('b'));
  assert.ok(d >= 50 + 50 + 60 - 1, 'écart >= r1+r2+VOID, obtenu ' + d.toFixed(1));
});

test('solve : une zone pinned ne bouge pas', () => {
  const zones = [
    { id: 'root', parentId: null, center: { x: 0, y: 0 }, radius: 80, pinned: true },
    { id: 'a', parentId: 'root', center: { x: 10, y: 0 }, radius: 50, pinned: false },
  ];
  const pos = Z.solve(zones, { iters: 120 });
  assert.deepEqual(pos.get('root'), { x: 0, y: 0 });
});

test('solve : un enfant est tiré vers la distance-repos de son parent', () => {
  const zones = [
    { id: 'p', parentId: null, center: { x: 0, y: 0 }, radius: 60, pinned: true },
    { id: 'c', parentId: 'p', center: { x: 400, y: 0 }, radius: 40, pinned: false },
  ];
  const pos = Z.solve(zones, { iters: 200, VOID: 60, GAP: 40 });
  const rest = 60 + 40 + 40; // r_p + r_c + GAP = 140
  const d = dist(pos.get('p'), pos.get('c'));
  assert.ok(Math.abs(d - rest) < 25, 'distance ~ repos (' + rest + '), obtenu ' + d.toFixed(1));
});

test('solve : déterministe (mêmes entrées -> mêmes sorties)', () => {
  const mk = () => ([
    { id: 'a', parentId: null, center: { x: 0, y: 0 }, radius: 50, pinned: false },
    { id: 'b', parentId: null, center: { x: 10, y: 5 }, radius: 50, pinned: false },
    { id: 'c', parentId: 'a', center: { x: -10, y: 0 }, radius: 30, pinned: false },
  ]);
  const p1 = Z.solve(mk(), { iters: 80 }), p2 = Z.solve(mk(), { iters: 80 });
  for (const id of ['a', 'b', 'c']) assert.deepEqual(p1.get(id), p2.get(id));
});

test('solve : centres confondus -> séparés de façon déterministe', () => {
  const zones = [
    { id: 'a', parentId: null, center: { x: 0, y: 0 }, radius: 40, pinned: false },
    { id: 'b', parentId: null, center: { x: 0, y: 0 }, radius: 40, pinned: false },
  ];
  const pos = Z.solve(zones, { iters: 120, VOID: 60 });
  assert.ok(dist(pos.get('a'), pos.get('b')) > 1, 'séparés');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test mekistudio/frontend/static/js/zonelayout.test.js`
Expected: FAIL avec `Cannot find module './zonelayout.js'`.

- [ ] **Step 3: Write minimal implementation**

```js
// mekistudio/frontend/static/js/zonelayout.js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test mekistudio/frontend/static/js/zonelayout.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add mekistudio/frontend/static/js/zonelayout.js mekistudio/frontend/static/js/zonelayout.test.js
git commit -m "feat(zonelayout): solveur de relaxation des zones (répulsion + ressort backbone)"
```

---

## Task 2: `zonelayout.js` — packing intra-zone `packAround`

**Files:**
- Modify: `mekistudio/frontend/static/js/zonelayout.js`
- Test: `mekistudio/frontend/static/js/zonelayout.test.js`

- [ ] **Step 1: Write the failing test**

```js
// AJOUTER à zonelayout.test.js
test('packAround : aucun fichier ne chevauche la tuile ni un autre fichier', () => {
  const center = { x: 500, y: 500 };
  const folder = { w: 116, h: 108 };
  const files = Array.from({ length: 6 }, () => ({ w: 150, h: 46 }));
  const out = Z.packAround(center, folder, files, { gap: 18 });
  assert.equal(out.length, 6, 'tous les fichiers placés');
  const boxes = out.map((p, i) => ({ x: p.x, y: p.y, w: files[i].w, h: files[i].h }));
  const folderBox = { x: center.x - folder.w / 2, y: center.y - folder.h / 2, w: folder.w, h: folder.h };
  const hit = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  for (let i = 0; i < boxes.length; i++) {
    assert.ok(!hit(boxes[i], folderBox), 'fichier ' + i + ' ne touche pas la tuile');
    for (let j = i + 1; j < boxes.length; j++) assert.ok(!hit(boxes[i], boxes[j]), 'fichiers ' + i + '/' + j + ' disjoints');
  }
});

test('packAround : déterministe', () => {
  const c = { x: 0, y: 0 }, f = { w: 116, h: 108 }, files = [{ w: 150, h: 46 }, { w: 150, h: 46 }, { w: 150, h: 46 }];
  assert.deepEqual(Z.packAround(c, f, files), Z.packAround(c, f, files));
});

test('packAround : liste vide -> []', () => {
  assert.deepEqual(Z.packAround({ x: 0, y: 0 }, { w: 116, h: 108 }, []), []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test mekistudio/frontend/static/js/zonelayout.test.js`
Expected: FAIL avec `Z.packAround is not a function`.

- [ ] **Step 3: Write minimal implementation**

```js
// DANS zonelayout.js : ajouter la fonction AVANT la ligne `const MekiZoneLayout = { solve };`
  // Range des fichiers en ANNEAUX concentriques autour de la tuile dossier (anneau proche d'abord,
  // croissance vers l'extérieur). Aucun chevauchement (tuile + fichiers déjà posés). Déterministe.
  // Retourne le top-left de chaque fichier, dans le même ordre que `fileSizes`.
  function packAround(folderCenter, folderSize, fileSizes, opts) {
    opts = opts || {};
    const gap = opts.gap == null ? 18 : opts.gap;
    const out = [];
    if (!fileSizes || !fileSizes.length) return out;
    const placed = [{ x: folderCenter.x - folderSize.w / 2, y: folderCenter.y - folderSize.h / 2, w: folderSize.w, h: folderSize.h }];
    const hit = (a, b) => a.x < b.x + b.w + gap && a.x + a.w + gap > b.x && a.y < b.y + b.h + gap && a.y + a.h + gap > b.y;
    const step = Math.max(...fileSizes.map((s) => Math.max(s.w, s.h))) + gap;
    const base = Math.max(folderSize.w, folderSize.h) / 2;
    let idx = 0;
    for (let ring = 1; ring <= 40 && idx < fileSizes.length; ring++) {
      const radius = base + ring * step;
      const slots = Math.max(4, Math.floor((2 * Math.PI * radius) / step));
      for (let k = 0; k < slots && idx < fileSizes.length; k++) {
        const ang = (k / slots) * 2 * Math.PI; // déterministe, régulier
        const fs = fileSizes[idx];
        const box = { x: folderCenter.x + Math.cos(ang) * radius - fs.w / 2, y: folderCenter.y + Math.sin(ang) * radius - fs.h / 2, w: fs.w, h: fs.h };
        if (placed.some((p) => hit(p, box))) continue; // créneau pris -> suivant
        out.push({ x: Math.round(box.x), y: Math.round(box.y) });
        placed.push(box); idx++;
      }
    }
    return out;
  }
```

Et étendre l'export : `const MekiZoneLayout = { solve, packAround };`

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test mekistudio/frontend/static/js/zonelayout.test.js`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add mekistudio/frontend/static/js/zonelayout.js mekistudio/frontend/static/js/zonelayout.test.js
git commit -m "feat(zonelayout): packing intra-zone des fichiers en anneaux"
```

---

## Task 3: `zonelayout.js` — angle d'init `freestAngle`

**Files:**
- Modify: `mekistudio/frontend/static/js/zonelayout.js`
- Test: `mekistudio/frontend/static/js/zonelayout.test.js`

- [ ] **Step 1: Write the failing test**

```js
// AJOUTER à zonelayout.test.js
test('freestAngle : liste vide -> 0', () => {
  assert.equal(Z.freestAngle([]), 0);
});

test('freestAngle : milieu du plus grand secteur libre', () => {
  // occupé à 0 et PI/2 : le plus grand vide va de PI/2 à 2PI -> milieu ~ 5PI/4
  const a = Z.freestAngle([0, Math.PI / 2]);
  assert.ok(Math.abs(a - (5 * Math.PI / 4)) < 1e-6, 'milieu du grand secteur, obtenu ' + a);
});

test('freestAngle : un seul occupé -> opposé', () => {
  const a = Z.freestAngle([0]);
  assert.ok(Math.abs(a - Math.PI) < 1e-6, 'opposé, obtenu ' + a);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test mekistudio/frontend/static/js/zonelayout.test.js`
Expected: FAIL avec `Z.freestAngle is not a function`.

- [ ] **Step 3: Write minimal implementation**

```js
// DANS zonelayout.js : ajouter AVANT `const MekiZoneLayout = …`
  // Angle (radians) du MILIEU du plus grand secteur angulaire libre autour d'un centre, étant
  // donné les angles déjà occupés par les voisins. Sert à initialiser une NOUVELLE zone "vers le vide".
  function freestAngle(occupied) {
    if (!occupied || !occupied.length) return 0;
    if (occupied.length === 1) return occupied[0] + Math.PI;
    const s = occupied.slice().sort((a, b) => a - b);
    let best = s[0] + Math.PI, gap = -1;
    for (let i = 0; i < s.length; i++) {
      const a0 = s[i], a1 = i + 1 < s.length ? s[i + 1] : s[0] + Math.PI * 2;
      if (a1 - a0 > gap) { gap = a1 - a0; best = a0 + (a1 - a0) / 2; }
    }
    return best;
  }
```

Et étendre l'export : `const MekiZoneLayout = { solve, packAround, freestAngle };`

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test mekistudio/frontend/static/js/zonelayout.test.js`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add mekistudio/frontend/static/js/zonelayout.js mekistudio/frontend/static/js/zonelayout.test.js
git commit -m "feat(zonelayout): freestAngle pour l'init directionnelle d'une nouvelle zone"
```

---

## Task 4: Inversion de la zone — la tuile dossier entre dans le hull

**Files:**
- Modify: `mekistudio/frontend/static/js/canvas.js:192-202` (`folderBlobCorners`)
- Test: `mekistudio/frontend/static/js/territories.test.js`

- [ ] **Step 1: Write the failing test (territoire inclut la tuile)**

```js
// AJOUTER à territories.test.js
test('roundedHullPath : la zone englobe la tuile dossier (centre dedans)', () => {
  // tuile dossier + 2 fichiers autour -> le blob doit contenir le centre de la tuile
  const folder = T.boxCorners({ x: 480, y: 470, w: 116, h: 108 }); // centre (538, 524)
  const fileA = T.boxCorners({ x: 480, y: 340, w: 150, h: 46 });
  const fileB = T.boxCorners({ x: 480, y: 600, w: 150, h: 46 });
  const d = T.roundedHullPath(folder.concat(fileA, fileB), 22);
  const nums = d.match(/-?\d+(\.\d+)?/g).map(Number);
  const xs = nums.filter((_, i) => i % 2 === 0), ys = nums.filter((_, i) => i % 2 === 1);
  // bornes du blob — le centre de la tuile (538,524) est strictement à l'intérieur
  assert.ok(Math.min(...xs) < 538 && Math.max(...xs) > 538, 'tuile dans la zone en x');
  assert.ok(Math.min(...ys) < 524 && Math.max(...ys) > 524, 'tuile dans la zone en y');
});
```

- [ ] **Step 2: Run test to verify it passes ALREADY (territories.js est déjà pur et générique)**

Run: `node --test mekistudio/frontend/static/js/territories.test.js`
Expected: PASS — `roundedHullPath` englobe déjà tous les points fournis. Ce test **verrouille** le comportement attendu après l'inversion de `folderBlobCorners` (qui, lui, choisit quels points fournir).

- [ ] **Step 3: Inverser `folderBlobCorners` pour inclure la tuile dossier**

Remplacer `mekistudio/frontend/static/js/canvas.js:192-202` :

```js
    folderBlobCorners(nodes) {
      const T = window.MekiTerritories;
      const groups = new Map();
      // La zone d'un dossier inclut désormais SA PROPRE tuile (centre de la zone) + ses fichiers directs.
      nodes.forEach((info, id) => {
        if (info.kind !== 'folder') return;
        groups.set(id, T.boxCorners(info.box).slice()); // la tuile dossier amorce le hull
      });
      nodes.forEach((info) => {
        const pid = info.source;
        if (info.kind !== 'fileeditor' || !pid || !groups.has(pid)) return; // FICHIERS directs uniquement
        for (const p of T.boxCorners(info.box)) groups.get(pid).push(p);
      });
      return groups;
    },
```

- [ ] **Step 4: Run all front pure tests**

Run: `node --test mekistudio/frontend/static/js/territories.test.js`
Expected: PASS (tous, dont le nouveau).

- [ ] **Step 5: Commit**

```bash
git add mekistudio/frontend/static/js/canvas.js mekistudio/frontend/static/js/territories.test.js
git commit -m "feat(brique G): la zone d'un dossier inclut sa tuile (au centre), plus seulement ses fichiers"
```

---

## Task 5: Charger `zonelayout.js` + méthode `relayoutZones` dans `canvas.js`

**Files:**
- Modify: `mekistudio/frontend/templates/canvas.html`
- Modify: `mekistudio/frontend/static/js/canvas.js` (nouvelle méthode, près de `drawCablesFrom`)

- [ ] **Step 1: Charger le module dans le template**

Dans `mekistudio/frontend/templates/canvas.html`, à côté des autres `<script src=".../territories.js">` / `collision.js`, ajouter AVANT `canvas.js` :

```html
    <script src="/static/js/zonelayout.js"></script>
```

(Vérifier l'ordre : `zonelayout.js` doit être chargé avant `canvas.js`, comme `territories.js`.)

- [ ] **Step 2: Ajouter la méthode `relayoutZones` dans l'objet Alpine de `canvas.js`**

Insérer, juste APRÈS la méthode `drawCablesFrom` (après `mekistudio/frontend/static/js/canvas.js:372` `drawCables()`), cette méthode :

```js
    // Relaxation des node-zones : construit les disques depuis le DOM, résout (répulsion + ressort),
    // écrit les positions (animées par la transition CSS), range les fichiers via packAround, puis
    // redessine câbles + territoires. Remplace le placement "place-once".
    relayoutZones() {
      const ZL = window.MekiZoneLayout, T = window.MekiTerritories;
      if (!ZL || !T) return;
      const nb = this.nodeBoxes();
      const groups = this.folderBlobCorners(nb); // tuile + fichiers (cf. Task 4)
      // Disque-zone par dossier : centre = tuile, rayon = englobe tous les coins de la zone.
      const ctrOf = (b) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
      const explorer = this.$root.querySelector('.node-wrap[data-kind="fileexplorer"]');
      const zones = [];
      nb.forEach((info, id) => {
        if (info.kind !== 'folder') return;
        const c = ctrOf(info.box);
        const pts = groups.get(id) || [];
        let r = Math.max(info.box.w, info.box.h) / 2;
        for (const p of pts) r = Math.max(r, Math.hypot(p.x - c.x, p.y - c.y));
        zones.push({ id, parentId: info.source || null, center: c, radius: r + 24, pinned: false });
      });
      if (explorer) {
        const eb = this.boxOf(explorer);
        zones.push({ id: explorer.dataset.id, parentId: null, center: ctrOf(eb), radius: Math.max(eb.w, eb.h) / 2 + 24, pinned: true });
      }
      if (!zones.length) { this.drawCables(); return; }
      const solved = ZL.solve(zones, { iters: 90, VOID: 60, GAP: 40 });
      // 1) repositionner chaque tuile dossier sur son nouveau centre
      const folderCenters = new Map();
      zones.forEach((z) => {
        if (z.pinned) { folderCenters.set(z.id, z.center); return; }
        const w = this.$root.querySelector('.node-wrap[data-id="' + z.id + '"]');
        if (!w) return;
        const nc = solved.get(z.id);
        const nx = Math.round(nc.x - w.offsetWidth / 2), ny = Math.round(nc.y - w.offsetHeight / 2);
        w.style.left = nx + 'px'; w.style.top = ny + 'px';
        folderCenters.set(z.id, { x: nx + w.offsetWidth / 2, y: ny + w.offsetHeight / 2 });
        this._persistPos(z.id, nx, ny);
      });
      // 2) ranger les fichiers AUTOUR du centre de leur dossier (ou de l'explorateur)
      const filesBySource = new Map();
      this.$root.querySelectorAll('.node-wrap[data-kind="fileeditor"]').forEach((w) => {
        const src = w.dataset.source || (explorer && explorer.dataset.id) || '';
        if (!filesBySource.has(src)) filesBySource.set(src, []);
        filesBySource.get(src).push(w);
      });
      filesBySource.forEach((wraps, src) => {
        const center = folderCenters.get(src);
        if (!center) return;
        const srcW = this.$root.querySelector('.node-wrap[data-id="' + src + '"]');
        const fsize = { w: srcW ? srcW.offsetWidth : 116, h: srcW ? srcW.offsetHeight : 108 };
        const sizes = wraps.map((w) => ({ w: w.offsetWidth, h: w.offsetHeight }));
        const spots = ZL.packAround(center, fsize, sizes, { gap: 18 });
        wraps.forEach((w, i) => {
          if (!spots[i]) return;
          w.style.left = spots[i].x + 'px'; w.style.top = spots[i].y + 'px';
          this._persistPos(w.dataset.id, spots[i].x, spots[i].y);
        });
      });
      this.drawCables(); this.fitView();
    },
```

- [ ] **Step 3: Vérifier le chargement (pas d'erreur console)**

Redémarrer le serveur (pas de hot-reload) puis hard-refresh, et dans la console DevTools :
Run (console): `typeof window.MekiZoneLayout.solve`
Expected: `"function"`.

- [ ] **Step 4: Commit**

```bash
git add mekistudio/frontend/templates/canvas.html mekistudio/frontend/static/js/canvas.js
git commit -m "feat(brique G): méthode relayoutZones (relaxation des node-zones)"
```

---

## Task 6: Brancher `relayoutZones` aux événements (spawn / create / remove / boot)

**Files:**
- Modify: `mekistudio/frontend/static/js/canvas.js` (points d'appel existants de `drawCables`/`fitView` après mutation)

- [ ] **Step 1: Remplacer les redraw post-mutation par `relayoutZones`**

Aux endroits où, après création/suppression d'un éditeur ou d'un dossier, le code appelle `this.drawCables(); this.fitView();` (voir `canvas.js:1276` pour l'éditeur, et la fin de `_createFolderNode`/`_removeFolderNode`), remplacer ce couple par :

```js
        this.relayoutZones(); // relaxation : (re)place les zones sans overlap + range les fichiers
```

(Note : `relayoutZones` appelle déjà `drawCables()` et `fitView()` en fin de course.)

- [ ] **Step 2: Déclencher une relaxation au boot, après réconciliation**

Repérer la fin du boot où les nodes sont rendus et `reconcile_source_links`/`drawCables` ont lieu (recherche `this.drawCables()` dans la séquence de boot/`load`). Ajouter juste après le rendu initial des nodes :

```js
      this.relayoutZones(); // dispose proprement les zones au chargement (déterministe -> stable au reload)
```

- [ ] **Step 3: Conserver `editorSpawnPos` pour l'INIT directionnelle d'un nouveau node**

Ne pas supprimer `editorSpawnPos` : il fournit la position INITIALE d'un nouveau node (avant relaxation). Au minimum, garder son appel tel quel à la création (POST `x/y`), puis laisser `relayoutZones` (Step 1) relaxer ensuite. (Simplification ultérieure possible, hors périmètre.)

- [ ] **Step 4: Valider à la main (serveur + Playwright en Task 10)**

Redémarrer le serveur, hard-refresh. Ouvrir quelques fichiers de dossiers différents. Vérifier visuellement : tuiles dossier centrées dans leur zone, pas de chevauchement, mouvement animé (pas de saut). La validation automatique est en Task 10.

- [ ] **Step 5: Commit**

```bash
git add mekistudio/frontend/static/js/canvas.js
git commit -m "feat(brique G): déclenche relayoutZones au spawn/create/remove/boot"
```

---

## Task 7: Routage backbone — les câbles dossier→dossier évitent les zones

**Files:**
- Modify: `mekistudio/frontend/static/js/canvas.js:284-292` (`obstaclesFor` dans `drawCablesFrom`)

- [ ] **Step 1: Ajouter les blobs de zones comme obstacles pour les câbles backbone**

Dans `drawCablesFrom`, juste avant la définition de `obstaclesFor` (`canvas.js:284`), construire une fois les bbox des zones, puis les ajouter aux obstacles des câbles backbone (`cab-folder`/`cab-d1`) — un câble backbone ne doit pas traverser une zone tierce. On approxime chaque zone par la bbox de ses coins (rapide, suffisant pour le contournement) :

```js
      // bbox de chaque zone (tuile + fichiers) -> obstacle pour les câbles BACKBONE (pas pour les
      // câbles fichiers, qui vivent DANS leur zone). Évite qu'un câble dossier->dossier traverse une zone tierce.
      const T = window.MekiTerritories;
      const zoneBoxes = new Map(); // folderId -> {x,y,w,h}
      if (T) {
        const groups = this.folderBlobCorners(nodes);
        groups.forEach((pts, fid) => {
          if (!pts.length) return;
          let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
          for (const p of pts) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
          zoneBoxes.set(fid, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
        });
      }
      const isBackbone = (cab) => {
        const k = nodes.get(cab.id).kind, pk = nodes.get(cab.parent).kind;
        return (k === 'folder' && (pk === 'folder' || pk === 'fileexplorer'));
      };
```

Puis, dans `obstaclesFor(cab)`, après la boucle qui empile les nodes, ajouter pour les câbles backbone les zones AUTRES que celles des deux extrémités :

```js
        if (isBackbone(cab)) {
          zoneBoxes.forEach((zb, fid) => {
            if (fid === cab.id || fid === cab.parent) return; // pas sa propre zone ni celle du parent
            obs.push({ x: zb.x - PAD, y: zb.y - PAD, w: zb.w + 2 * PAD, h: zb.h + 2 * PAD });
          });
        }
```

- [ ] **Step 2: Vérifier qu'aucun test pur ne casse**

Run: `node --test mekistudio/frontend/static/js/cables.test.js`
Expected: PASS (le routage `cables.js` est inchangé ; on n'a fait qu'enrichir la liste d'obstacles côté `canvas.js`).

- [ ] **Step 3: Valider visuellement (serveur)**

Redémarrer, hard-refresh, ouvrir des fichiers dans plusieurs dossiers imbriqués. Vérifier qu'un câble ambre parent→enfant **contourne** les zones voisines au lieu de les traverser. (Mesure auto en Task 10.)

- [ ] **Step 4: Commit**

```bash
git add mekistudio/frontend/static/js/canvas.js
git commit -m "feat(brique G): les câbles backbone contournent les zones tierces"
```

---

## Task 8: Hiérarchie visuelle des câbles (CSS)

**Files:**
- Modify: `mekistudio/frontend/static/css/canvas.css:236-243`

- [ ] **Step 1: Épaissir le backbone, atténuer les fichiers**

Remplacer les règles d'épaisseur/couleur (`canvas.css:236-243`) par :

```css
.cable .cable-halo { fill: none; stroke-width: 7; opacity: .22; stroke-linecap: round; stroke-linejoin: round; }
.cable .cable-core { fill: none; stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; }
/* brique G : couleur + HIÉRARCHIE du câble par relation */
.cable.cab-git .cable-halo,    .cable.cab-git .cable-core    { stroke: #b388ff; } /* node branche git — violet */
.cable.cab-d1 .cable-halo,     .cable.cab-d1 .cable-core     { stroke: #5b86d6; } /* explorateur → dossier prof. 1 — bleu */
.cable.cab-folder .cable-halo, .cable.cab-folder .cable-core { stroke: #e0b15a; } /* dossier → dossier — ambre */
.cable.cab-file .cable-halo,   .cable.cab-file .cable-core   { stroke: #49c486; } /* fichier → … — vert */
.cable.cable-default .cable-halo, .cable.cable-default .cable-core { stroke: #8893a7; }
/* BACKBONE (bleu + ambre) en avant : trait plus épais, pleine opacité */
.cable.cab-d1 .cable-core, .cable.cab-folder .cable-core { stroke-width: 4; }
/* fichiers (vert) en retrait : trait fin, atténué */
.cable.cab-file .cable-core { stroke-width: 1.6; }
.cable.cab-file .cable-halo { opacity: .10; }
```

- [ ] **Step 2: Valider visuellement (serveur)**

Redémarrer, hard-refresh. Le backbone bleu+ambre doit **ressortir** nettement par rapport au vert des fichiers.

- [ ] **Step 3: Commit**

```bash
git add mekistudio/frontend/static/css/canvas.css
git commit -m "feat(brique G): hiérarchie visuelle des câbles (backbone épais, fichiers atténués)"
```

---

## Task 9: Mise à jour de l'invariant (docs)

**Files:**
- Modify: `CLAUDE.md` (paragraphe « Placement organique INCRÉMENTAL »)
- Modify: `docs/ARCHITECTURE.md` (section placement/invariants)

- [ ] **Step 1: Réécrire le paragraphe d'invariant dans `CLAUDE.md`**

Dans `CLAUDE.md`, remplacer la phrase « **Placement organique INCRÉMENTAL** … les nodes existants **ne bougent jamais** … » par :

```
**Placement par RELAXATION (node-zones)** : chaque dossier est une *node-zone* (tuile 📁 au CENTRE, fichiers directs rangés AUTOUR, dans la zone — `folderBlobCorners` inclut la tuile). Un solveur pur (`zonelayout.js` : `solve` répulsion+ressort, `packAround`, `freestAngle`, testé `node --test`) replace les zones à chaque changement (`relayoutZones`) : **aucune zone ne se chevauche** (répulsion, VIDE garanti) et chaque enfant reste près de son parent (ressort → câble ambre court). Les nodes **se ré-arrangent en douceur (animé, transition CSS)** — jamais de saut/clignotement. `fitView` auto-zoome. Câbles backbone (bleu/ambre) **contournent les zones tierces** et sont mis en avant (CSS) ; câbles fichiers (vert) restent courts dans leur zone.
```

- [ ] **Step 2: Mettre à jour `docs/ARCHITECTURE.md`**

Repérer dans `docs/ARCHITECTURE.md` la description du placement (`editorSpawnPos`, « ne bougent jamais ») et la remplacer par la même substance : modèle node-zone, solveur `zonelayout.js`, invariant « zéro overlap + mouvement animé », routage backbone contournant les zones. (Aligner le vocabulaire sur le spec `docs/superpowers/specs/2026-06-02-node-zone-relaxation-layout-design.md`.)

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md docs/ARCHITECTURE.md
git commit -m "docs: invariant de placement -> relaxation node-zones (mouvement animé, zéro overlap)"
```

---

## Task 10: Validation Playwright (scénario réel)

**Files:**
- Create: `scripts/pw-zone-layout.mjs`

- [ ] **Step 1: Écrire le script de validation**

S'inspirer de `scripts/_repro_many.mjs` (même boot, même `spawn` concurrent de chemins absolus Windows, même mesure de chevauchement de zones). Créer `scripts/pw-zone-layout.mjs` qui, après spawn :

```js
// scripts/pw-zone-layout.mjs — valide le modèle node-zone : 0 overlap de zones, tuile dossier DANS
// sa zone (proche du centroïde), 0 erreur console. S'appuie sur le serveur de dev (port via argv).
import { chromium } from 'playwright';
const URL = process.argv[2] || 'http://127.0.0.1:8797/';
const R = String.raw`C:\mekistudio`;
const rel = [
  'mekistudio\\frontend\\app.py', 'mekistudio\\frontend\\routes\\canvas.py', 'mekistudio\\frontend\\routes\\fs.py',
  'mekistudio\\frontend\\static\\js\\canvas.js', 'mekistudio\\frontend\\static\\js\\cables.js',
  'mekistudio\\frontend\\static\\js\\territories.js', 'mekistudio\\frontend\\static\\js\\zonelayout.js',
  'mekistudio\\frontend\\templates\\canvas.html', 'mekistudio\\frontend\\static\\css\\canvas.css',
];
const abs = rel.map((f) => R + '\\' + f);
const b = await chromium.launch(); const p = await b.newPage();
await p.setViewportSize({ width: 1680, height: 950 });
const logs = []; p.on('console', (m) => { if (m.type() === 'error') logs.push(m.text()); });
p.on('pageerror', (e) => logs.push('PE:' + e.message));
const boot = async () => { await p.goto(URL, { waitUntil: 'networkidle' }); await p.waitForSelector('.cmp-chat .chat-input'); await p.waitForTimeout(1000); };
const clear = () => p.evaluate(async () => { for (const n of (await (await fetch('/api/canvas')).json()).nodes) if (!['kernel','gitbranch','fileexplorer','chat'].includes(n.kind)) { try { await fetch('/api/canvas/nodes/' + n.id, { method: 'DELETE' }); } catch (e) {} } });
try {
  await boot(); await clear();
  await p.evaluate(async () => { const chat = (await (await fetch('/api/canvas')).json()).nodes.find((n) => n.kind === 'chat'); if (chat) await fetch('/api/canvas/nodes/' + chat.id + '/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ spawn_mode: 'unlimited' }) }); });
  await boot();
  await p.evaluate(async (paths) => { let d; for (const el of document.querySelectorAll('[x-data]')) { const x = window.Alpine && window.Alpine.$data(el); if (x && x.spawnEphemeralEditor) d = x; } await Promise.all(paths.map((pp) => d.spawnEphemeralEditor(pp))); }, abs);
  await p.waitForTimeout(6000);
  const m = await p.evaluate(() => {
    const svgNS = 'http://www.w3.org/2000/svg';
    const tmp = document.createElementNS(svgNS, 'svg'); document.body.appendChild(tmp);
    const polyOf = (d) => { const pe = document.createElementNS(svgNS, 'path'); pe.setAttribute('d', d); tmp.appendChild(pe); const L = pe.getTotalLength(); const pts = []; for (let i = 0; i < 160; i++) { const q = pe.getPointAtLength(L * i / 160); pts.push({ x: q.x, y: q.y }); } return pts; };
    const inPoly = (pt, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y; if (((yi > pt.y) !== (yj > pt.y)) && (pt.x < (xj - xi) * (pt.y - yi) / (yj - yi) + xi)) c = !c; } return c; };
    const overlap = (A, B) => A.some((pt) => inPoly(pt, B)) || B.some((pt) => inPoly(pt, A));
    const ctr = (w) => ({ x: (parseFloat(w.style.left) || 0) + w.offsetWidth / 2, y: (parseFloat(w.style.top) || 0) + w.offsetHeight / 2 });
    const terris = [...document.querySelectorAll('.territories path[data-terri]')];
    const polys = {}; terris.forEach((t) => { polys[t.dataset.terri] = polyOf(t.getAttribute('d')); });
    const ids = Object.keys(polys); let overlaps = 0; const pairs = [];
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) if (overlap(polys[ids[i]], polys[ids[j]])) { overlaps++; if (pairs.length < 10) pairs.push(ids[i] + '×' + ids[j]); }
    // chaque tuile dossier est DANS sa propre zone (modèle node-zone)
    let folderIn = 0, folderTot = 0;
    document.querySelectorAll('.node-wrap[data-kind="folder"]').forEach((w) => { const poly = polys[w.dataset.id]; if (!poly) return; folderTot++; if (inPoly(ctr(w), poly)) folderIn++; });
    tmp.remove();
    return { zones: terris.length, overlaps, pairs, folderTot, folderIn };
  });
  await p.screenshot({ path: 'scripts/.pw/zone-layout.png' });
  await clear();
  console.log(JSON.stringify(m, null, 2));
  console.log(m.overlaps === 0 ? '✅ 0 chevauchement de zones' : '⚠️ ' + m.overlaps + ' chevauchement(s): ' + m.pairs.join(', '));
  console.log(m.folderTot > 0 && m.folderIn === m.folderTot ? '✅ chaque tuile dossier est DANS sa zone' : '⚠️ tuiles hors zone: ' + (m.folderTot - m.folderIn));
  console.log('CONSOLE_ERRORS:', logs.length); logs.slice(0, 8).forEach((x) => console.log('  ', x));
} catch (e) { console.log('SCRIPT-ERR', e.message, e.stack); }
finally { await b.close(); }
```

- [ ] **Step 2: Lancer la validation**

Run: `node scripts/pw-zone-layout.mjs http://127.0.0.1:8797/`
Expected:
- `"overlaps": 0` et `✅ 0 chevauchement de zones`
- `folderIn === folderTot` et `✅ chaque tuile dossier est DANS sa zone`
- `CONSOLE_ERRORS: 0`

(Si le port diffère, l'adapter ; serveur dev lancé au préalable.)

- [ ] **Step 3: Inspecter le screenshot**

Lire `scripts/.pw/zone-layout.png` : zones distinctes sans overlap, tuiles 📁 centrées, backbone ambre/bleu lisible et contournant les zones, fichiers verts courts dans leur zone.

- [ ] **Step 4: Commit**

```bash
git add scripts/pw-zone-layout.mjs
git commit -m "test(brique G): validation Playwright du modèle node-zone (0 overlap, tuile centrée)"
```

---

## Self-Review (rempli par l'auteur du plan)

**Couverture du spec :**
- §1 Géométrie de zone (inversion) → Task 4. ✓
- §2 Moteur relaxation (`solve`, `freestAngle`) → Tasks 1, 3 (pur) + Tasks 5/6 (câblage). ✓
- §3 Arrangement intra-zone (`packAround`) → Task 2 (pur) + Task 5 (câblage). ✓
- §4 Routage câbles backbone (zones obstacles) → Task 7. ✓
- §5 Hiérarchie visuelle (CSS) → Task 8. ✓
- §6 Tests (purs + Playwright) → Tasks 1-4 (purs) + Task 10 (Playwright). ✓
- § Changement d'invariant (CLAUDE.md, ARCHITECTURE.md) → Task 9. ✓ (Mémoire : à mettre à jour hors plan, par l'assistant.)

**Placeholders :** aucun « TBD/TODO/handle edge cases » ; tout le code des modules purs et des méthodes nouvelles est fourni ; les modifs de fichiers existants pointent des lignes exactes et montrent le code.

**Cohérence des types/signatures :** `zone = {id,parentId,center,radius,pinned}` identique en Tasks 1/5 ; `solve/packAround/freestAngle` mêmes signatures en Tasks 1-3 et à l'appel Task 5 ; `_persistPos(id,x,y)` et `folderBlobCorners(nodes)` conformes au code existant lu.
