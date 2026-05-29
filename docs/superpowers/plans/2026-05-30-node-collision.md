# Anti-chevauchement & collision douce des nodes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deux nodes ne se recouvrent **jamais** sur le canvas : au déplacement, un node percuté **s'écarte en douceur** (puis revient), au resize il est poussé (et reste), au spawn un node naît dans un trou libre, et au chargement une passe sépare les nodes hérités qui se chevauchent.

**Architecture:** Géométrie **pure** isolée dans `collision.js` (script classique, testable `node --test`), câblée dans `canvas.js`. Pivot : position **home** (`node.x/y`, persistée) vs **rendu transitoire** (`transform: translate` sur `.node-wrap`). Les nodes poussés portent un `translate` temporaire ; l'invariant zéro-recouvrement est garanti par une **passe finale unique au lâcher**. Coexiste avec les **câbles déjà livrés** : tout déplacement re-route les câbles (`drawCables`), et `nodeBox` tient compte du `translate` pour que les câbles suivent les nodes poussés.

**Tech Stack:** JS (Alpine + SVG), `node --test` (géométrie pure), Playwright (comportement réel). Aucun changement backend requis.

**Spec de référence :** [`docs/superpowers/specs/2026-05-29-canvas-node-collision-design.md`](../specs/2026-05-29-canvas-node-collision-design.md) — lire D1–D8 et §8 (cas limites) avant de commencer.

---

## Conventions
- JS : `collision.js` = **script classique** (IIFE → `window.MekiCollision` **et** `module.exports`), comme `cables.js`/`collision.js`.
- TDD : test rouge → impl verte → commit. Commandes : `node --test mekistudio/frontend/static/js/collision.test.js`.
- **Coexistence câbles** : `canvas.js` contient déjà `drawCables()`/`drawCablesFrom()`/`nodeBoxes()` (feature câbles). Après **tout** déplacement (push transitoire, reloge final, spawn, réconciliation), appeler `this.drawCables()`. `nodeBox` (collision) et `nodeBoxes` (câbles) doivent lire la **position rendue** (home + translate).
- **Rappel mémoire** : pas de hot-reload (restart serve + hard refresh) ; valider le front avec **Playwright (screenshot + console)**.

## Structure des fichiers

| Fichier | Responsabilité | Tâche |
|---|---|---|
| `mekistudio/frontend/static/js/collision.js` | géométrie pure : `intersects`, `isFree`, `partVector`, `pushVector`, `clampAgainst`, `findFreeSpot` | 1 |
| `mekistudio/frontend/static/js/collision.test.js` | tests `node --test` | 1 |
| `mekistudio/frontend/templates/canvas.html` | include `collision.js` avant `canvas.js` | 2 |
| `mekistudio/frontend/static/css/canvas.css` | `transition: transform` + `.dragging` | 2 |
| `mekistudio/frontend/static/js/canvas.js` | home/translate, `nodeBox`, push au move, reloge au lâcher, spawn `findFreeSpot`, réconciliation au boot, + `drawCables` partout | 3–8 |

---

### Task 1 : `collision.js` — géométrie pure + tests

**Files:**
- Create: `mekistudio/frontend/static/js/collision.js`
- Create: `mekistudio/frontend/static/js/collision.test.js`

- [ ] **Step 1 : Test rouge — `intersects` / `isFree`**

Créer `mekistudio/frontend/static/js/collision.test.js` :

```js
const test = require('node:test');
const assert = require('node:assert');
const M = require('./collision.js');
const box = (x, y, w, h) => ({ x, y, w, h });

test('intersects: recouvrement, contact, séparé, effet gap', () => {
  assert.equal(M.intersects(box(0, 0, 100, 100), box(50, 50, 100, 100)), true);
  assert.equal(M.intersects(box(0, 0, 100, 100), box(200, 0, 100, 100)), false);
  // contact à 10px d'écart : false sans gap, true avec gap=12
  assert.equal(M.intersects(box(0, 0, 100, 100), box(110, 0, 100, 100)), false);
  assert.equal(M.intersects(box(0, 0, 100, 100), box(110, 0, 100, 100), 12), true);
});

test('isFree: libre vs occupé', () => {
  const others = [box(200, 0, 100, 100)];
  assert.equal(M.isFree(box(0, 0, 100, 100), others, 12), true);
  assert.equal(M.isFree(box(150, 0, 100, 100), others, 12), false);
});
```

- [ ] **Step 2 : Run — échec**

Run: `node --test mekistudio/frontend/static/js/collision.test.js`
Expected: FAIL (`Cannot find module './collision.js'`).

- [ ] **Step 3 : Créer `collision.js` (constantes + `intersects`/`isFree`)**

Créer `mekistudio/frontend/static/js/collision.js` :

```js
// Géométrie PURE de l'anti-collision (boîtes {x,y,w,h}, coords monde). Script classique :
// exposé pour le navigateur (window.MekiCollision) et pour node --test.
(function () {
  const GAP = 12;  // marge anti-contact + respiration (px monde)
  const EPS = 4;   // hystérésis : on relâche un node écarté au-delà de GAP+EPS

  function intersects(a, b, gap) {
    gap = gap || 0;
    return a.x < b.x + b.w + gap && b.x < a.x + a.w + gap
        && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;
  }
  function isFree(box, others, gap) {
    return !others.some((o) => intersects(box, o, gap));
  }

  const MekiCollision = { GAP, EPS, intersects, isFree };
  if (typeof module !== 'undefined' && module.exports) module.exports = MekiCollision;
  if (typeof window !== 'undefined') window.MekiCollision = MekiCollision;
})();
```

- [ ] **Step 4 : Run — vert** · Run: `node --test mekistudio/frontend/static/js/collision.test.js` · Expected: PASS (2).

- [ ] **Step 5 : Commit**

```bash
git add mekistudio/frontend/static/js/collision.js mekistudio/frontend/static/js/collision.test.js
git commit -m "feat(collision): collision.js — intersects + isFree (géométrie pure)"
```

- [ ] **Step 6 : Test rouge — `partVector` (2 côtés, côté court d'abord)**

Ajouter à `collision.test.js` :

```js
test('partVector: pousse l\'obstacle hors du couloir, côté court d\'abord, 2 candidats', () => {
  // mover horizontal sur obstacle ; pénétration Y plus petite -> pousse en Y
  const mover = box(0, 0, 200, 100);
  const obstacle = box(150, 60, 100, 100); // chevauche le coin bas-droit
  const cands = M.partVector(mover, obstacle, { x: 1, y: 0 }, 12);
  assert.equal(cands.length, 2);
  // appliqué au 1er candidat, l'obstacle ne recoupe plus le mover (gap inclus)
  const moved = { ...obstacle, x: obstacle.x + cands[0].x, y: obstacle.y + cands[0].y };
  assert.equal(M.intersects(mover, moved, 12), false);
  // candidat 1 de magnitude <= candidat 2
  const mag = (v) => Math.abs(v.x) + Math.abs(v.y);
  assert.ok(mag(cands[0]) <= mag(cands[1]));
});
```

- [ ] **Step 7 : Run — échec** (`M.partVector is not a function`).

- [ ] **Step 8 : Implémenter `partVector`**

Dans `collision.js`, avant la ligne `const MekiCollision = ...` :

```js
  // Déplacements (±) à appliquer à `obstacle` pour le sortir du couloir de `mover`,
  // le long de l'axe de pénétration MINIMALE (ou perpendiculaire au drag en cas d'égalité).
  // Retourne 2 candidats, le plus court d'abord (départage : côté naturel).
  function partVector(mover, obstacle, dragDir, gap) {
    gap = gap || 0;
    const oxl = Math.min(mover.x + mover.w, obstacle.x + obstacle.w) - Math.max(mover.x, obstacle.x);
    const oyl = Math.min(mover.y + mover.h, obstacle.y + obstacle.h) - Math.max(mover.y, obstacle.y);
    let axis = oxl <= oyl ? 'x' : 'y';
    if (Math.abs(oxl - oyl) < 1 && dragDir) {              // égalité ~45° : perpendiculaire au drag
      axis = Math.abs(dragDir.x) >= Math.abs(dragDir.y) ? 'y' : 'x';
    }
    if (axis === 'y') {
      const up = (mover.y - gap) - (obstacle.y + obstacle.h);          // < 0
      const down = (mover.y + mover.h + gap) - obstacle.y;             // > 0
      const natural = (obstacle.y + obstacle.h / 2) >= (mover.y + mover.h / 2) ? 1 : -1;
      const cands = [{ x: 0, y: up }, { x: 0, y: down }];
      cands.sort((a, b) => (Math.abs(a.y) - Math.abs(b.y)) || (natural > 0 ? a.y - b.y : b.y - a.y));
      return cands;
    }
    const left = (mover.x - gap) - (obstacle.x + obstacle.w);          // < 0
    const right = (mover.x + mover.w + gap) - obstacle.x;              // > 0
    const natural = (obstacle.x + obstacle.w / 2) >= (mover.x + mover.w / 2) ? 1 : -1;
    const cands = [{ x: left, y: 0 }, { x: right, y: 0 }];
    cands.sort((a, b) => (Math.abs(a.x) - Math.abs(b.x)) || (natural > 0 ? a.x - b.x : b.x - a.x));
    return cands;
  }
```

Ajouter `partVector` à l'objet exporté.

- [ ] **Step 9 : Run — vert** · Commit :

```bash
git add mekistudio/frontend/static/js/collision.js mekistudio/frontend/static/js/collision.test.js
git commit -m "feat(collision): partVector (écarte l'obstacle, 2 côtés, court d'abord)"
```

- [ ] **Step 10 : Test rouge — `pushVector` (quadrant bas-droite) + `clampAgainst` (axe MTV bloqué)**

Ajouter à `collision.test.js` :

```js
test('pushVector: pousse l\'obstacle bas/droite seulement (resize ancré haut-gauche)', () => {
  const grower = box(0, 0, 200, 200);
  const obstacle = box(150, 150, 100, 100);
  const v = M.pushVector(grower, obstacle, 12);
  assert.ok(v.x >= 0 && v.y >= 0);                       // jamais haut/gauche
  const moved = { ...obstacle, x: obstacle.x + v.x, y: obstacle.y + v.y };
  assert.equal(M.intersects(grower, moved, 12), false);
});

test('clampAgainst: bloque l\'axe de pénétration min, glisse sur l\'autre', () => {
  const obstacle = box(200, 0, 100, 300);                 // mur vertical à droite
  // mover (100x100) venant de la gauche, poussé dedans en x, libre en y
  const clamped = M.clampAgainst(box(0, 0, 100, 100), { x: 250, y: 80, w: 100, h: 100 }, obstacle, 12);
  assert.ok(clamped.x + 100 <= obstacle.x - 12 + 0.01);   // stoppé au contact à gauche du mur
  assert.equal(clamped.y, 80);                            // glisse librement en y
});
```

- [ ] **Step 11 : Run — échec**, puis **implémenter** dans `collision.js` :

```js
  // MTV pour sortir `obstacle` d'un `grower` qui s'agrandit vers le bas-droite
  // (composantes négatives interdites). Renvoie le plus petit push autorisé.
  function pushVector(grower, obstacle, gap) {
    gap = gap || 0;
    const right = (grower.x + grower.w + gap) - obstacle.x; // déplace l'obstacle à droite
    const down = (grower.y + grower.h + gap) - obstacle.y;  // ou en bas
    return right <= down ? { x: right, y: 0 } : { x: 0, y: down };
  }

  // Borne `mover` (taille dans dragTo.w/h) au contact de `obstacle` : bloque l'axe de
  // pénétration MIN, laisse glisser l'autre. Renvoie la position bornée {x,y}.
  function clampAgainst(moverHome, dragTo, obstacle, gap) {
    gap = gap || 0;
    const w = dragTo.w, h = dragTo.h;
    const b = { x: dragTo.x, y: dragTo.y, w, h };
    if (!intersects(b, obstacle, gap)) return { x: dragTo.x, y: dragTo.y };
    const penX = Math.min(b.x + w, obstacle.x + obstacle.w) - Math.max(b.x, obstacle.x) + gap;
    const penY = Math.min(b.y + h, obstacle.y + obstacle.h) - Math.max(b.y, obstacle.y) + gap;
    let nx = dragTo.x, ny = dragTo.y;
    if (penX <= penY) {
      nx = (b.x + w / 2 <= obstacle.x + obstacle.w / 2)
        ? obstacle.x - gap - w : obstacle.x + obstacle.w + gap;
    } else {
      ny = (b.y + h / 2 <= obstacle.y + obstacle.h / 2)
        ? obstacle.y - gap - h : obstacle.y + obstacle.h + gap;
    }
    return { x: nx, y: ny };
  }
```

Ajouter `pushVector, clampAgainst` à l'export. Run vert · Commit `feat(collision): pushVector (quadrant) + clampAgainst (MTV)`.

- [ ] **Step 12 : Test rouge — `findFreeSpot` (trou, spirale bornée, repli déterministe)**

Ajouter à `collision.test.js` :

```js
test('findFreeSpot: ancre libre rendue telle quelle', () => {
  const spot = M.findFreeSpot({ x: 0, y: 0 }, { w: 100, h: 100 }, [box(500, 500, 100, 100)], 12);
  assert.deepEqual(spot, { x: 0, y: 0 });
});

test('findFreeSpot: ancre occupée -> trou libre proche, et résultat libre', () => {
  const others = [box(0, 0, 100, 100), box(112, 0, 100, 100)];
  const spot = M.findFreeSpot({ x: 0, y: 0 }, { w: 100, h: 100 }, others, 12);
  assert.equal(M.isFree({ x: spot.x, y: spot.y, w: 100, h: 100 }, others, 12), true);
});
```

- [ ] **Step 13 : Run — échec**, puis **implémenter** :

```js
  function minDist(b, others) {
    if (!others.length) return Infinity;
    let m = Infinity;
    for (const o of others) {
      const dx = Math.max(o.x - (b.x + b.w), b.x - (o.x + o.w), 0);
      const dy = Math.max(o.y - (b.y + b.h), b.y - (o.y + o.h), 0);
      m = Math.min(m, Math.hypot(dx, dy));
    }
    return m;
  }
  // 1er emplacement libre en spirale carrée autour de `anchor` ; repli déterministe
  // (le plus éloigné des autres dans le cap) si rien de libre. Jamais de boucle infinie.
  function findFreeSpot(anchor, size, others, gap) {
    gap = gap || 0;
    const at = (x, y) => ({ x, y, w: size.w, h: size.h });
    if (isFree(at(anchor.x, anchor.y), others, gap)) return { x: anchor.x, y: anchor.y };
    const step = Math.max(size.w, size.h) + gap;
    const CAP = 60;
    let best = null, bestD = -1;
    for (let r = 1; r <= CAP; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;  // anneau de rayon r
          const x = anchor.x + dx * step, y = anchor.y + dy * step;
          if (isFree(at(x, y), others, gap)) return { x, y };
          const d = minDist(at(x, y), others);
          if (d > bestD) { bestD = d; best = { x, y }; }
        }
      }
    }
    return best || { x: anchor.x, y: anchor.y };
  }
```

Ajouter `findFreeSpot` à l'export. Run vert · Commit `feat(collision): findFreeSpot (spirale bornée + repli déterministe)`.

---

### Task 2 : Template + CSS

**Files:**
- Modify: `mekistudio/frontend/templates/canvas.html` (zone des `<script>`, ~l.11)
- Modify: `mekistudio/frontend/static/css/canvas.css`

- [ ] **Step 1 : Inclure `collision.js` avant `canvas.js`**

Dans `templates/canvas.html`, juste avant `<script defer src="/static/js/canvas.js"></script>` (à côté de l'include `cables.js` déjà présent) :

```html
  <!-- géométrie pure de l'anti-collision (window.MekiCollision) — avant canvas.js. -->
  <script defer src="/static/js/collision.js"></script>
```

- [ ] **Step 2 : CSS — transition douce + classe dragging**

Ajouter à la fin de `mekistudio/frontend/static/css/canvas.css` :

```css
/* --- Anti-collision : écart/retour animé via transform --- */
.node-wrap { transition: transform .12s ease-out; }
.node-wrap.dragging { transition: none; } /* le node tenu ne traîne pas son transform */
```

- [ ] **Step 3 : Commit** (vérif visuelle en Task 9)

```bash
git add mekistudio/frontend/templates/canvas.html mekistudio/frontend/static/css/canvas.css
git commit -m "feat(collision): include collision.js + transition transform"
```

---

### Task 3 : `canvas.js` — modèle home/translate + `nodeBox` (suivi par les câbles) + reset à la saisie

**Files:**
- Modify: `mekistudio/frontend/static/js/canvas.js`

- [ ] **Step 1 : Helpers de transform transitoire**

Ajouter ces méthodes dans l'objet Alpine (près de `applyBox`, ~l.64) :

```js
    // déplacement transitoire (en coords monde) d'un node poussé, sans toucher son home.
    setTranslate(wrap, dx, dy) {
      wrap._tx = dx; wrap._ty = dy;
      wrap.style.transform = (dx || dy) ? `translate(${dx}px, ${dy}px)` : '';
    },
    clearTranslate(wrap) { this.setTranslate(wrap, 0, 0); },
    // box RENDUE en coords monde = home (node.x/y ou style) + translate transitoire.
    boxOf(wrap) {
      const x = (parseFloat(wrap.style.left) || 0) + (wrap._tx || 0);
      const y = (parseFloat(wrap.style.top) || 0) + (wrap._ty || 0);
      return { x, y, w: wrap.offsetWidth, h: wrap.offsetHeight };
    },
```

- [ ] **Step 2 : Les câbles suivent la position RENDUE**

Dans `nodeBoxes()` (feature câbles, ~l.89), remplacer la lecture de la box par `boxOf` pour inclure le `translate` (sinon un câble vers un node poussé pointe vers son home) :

```js
    nodeBoxes() {
      const map = new Map();
      this.$root.querySelectorAll('.node-wrap').forEach((w) => {
        const b = this.boxOf(w);
        map.set(w.dataset.id, { box: b, kind: w.dataset.kind || '', source: w.dataset.source || '' });
      });
      return map;
    },
```

- [ ] **Step 3 : Reset du translate à la saisie**

Dans `onNodeMouseDown` (~l.74), juste après `this.selectNode(wrap);` (avant le calcul de `orig`), remettre le node tenu à sa position de repos et marquer `.dragging` :

```js
      this.clearTranslate(wrap);          // on drague depuis le home, jamais d'une position écartée
      wrap.classList.add('dragging');
```

Et dans `finish` (~l.100), au début, retirer la classe :

```js
        wrap.classList.remove('dragging');
```

- [ ] **Step 4 : Vérif** — relancer + hard refresh : déplacer un node fonctionne comme avant (pas de régression), les câbles suivent.

- [ ] **Step 5 : Commit**

```bash
git add mekistudio/frontend/static/js/canvas.js
git commit -m "feat(collision): modèle home/translate + nodeBox rendu (câbles suivent)"
```

---

### Task 4 : `canvas.js` — push au déplacement (écarte les voisins) + retour hystérésis

**Files:**
- Modify: `mekistudio/frontend/static/js/canvas.js` (état + `onNodeMouseDown`/`onMove`)

- [ ] **Step 1 : État du drag collision**

Dans la liste d'état Alpine : `_dragDir: { x: 0, y: 0 },`.

- [ ] **Step 2 : Calculer `dragDir` cumulatif dans `onMove`**

Dans `onMove` (move uniquement), après `node.x = orig.x + dx; node.y = orig.y + dy;` :

```js
        this._dragDir = { x: dx, y: dy };  // vecteur cumulatif saisie -> curseur
```

- [ ] **Step 3 : Passe de push par frame (après `applyBox`)**

Dans `onMove`, juste après `this.applyBox(wrap, node);` et **avant** le re-route des câbles (`drawCablesFrom`/`drawCables`), insérer la passe de collision (move uniquement) :

```js
        if (moving) {
          const C = window.MekiCollision;
          const moverBox = { x: node.x, y: node.y, w: orig.w, h: orig.h };
          const decided = [];  // box cibles déjà décidées cette frame (évite 2 voisins au même trou)
          this.$root.querySelectorAll('.node-wrap').forEach((w) => {
            if (w === wrap) return;
            const home = { x: parseFloat(w.style.left) || 0, y: parseFloat(w.style.top) || 0,
                           w: w.offsetWidth, h: w.offsetHeight };
            const fixed = w.dataset.movable === 'false';
            if (!C.intersects(moverBox, home, C.GAP)) {
              // séparé : retour avec hystérésis (release au-delà de GAP+EPS)
              if ((w._tx || w._ty) && !C.intersects(moverBox, home, C.GAP + C.EPS)) this.clearTranslate(w);
              if (w._tx || w._ty) decided.push(this.boxOf(w)); else decided.push(home);
              return;
            }
            if (fixed) {                  // kernel = mur : A s'arrête au contact
              const cl = C.clampAgainst({ x: orig.x, y: orig.y },
                { x: node.x, y: node.y, w: orig.w, h: orig.h }, home, C.GAP);
              node.x = cl.x; node.y = cl.y; this.applyBox(wrap, node);
              decided.push(home); return;
            }
            // voisin mobile : essaie les 2 côtés (court d'abord), évite home des autres + décidées + mover
            const obstacles = [moverBox, ...decided];
            this.$root.querySelectorAll('.node-wrap').forEach((o) => {
              if (o === wrap || o === w) return;
              if (!(o._tx || o._ty)) obstacles.push({ x: parseFloat(o.style.left) || 0,
                y: parseFloat(o.style.top) || 0, w: o.offsetWidth, h: o.offsetHeight });
            });
            const cands = C.partVector(moverBox, home, this._dragDir, C.GAP);
            let placed = null;
            for (const v of cands) {
              const target = { x: home.x + v.x, y: home.y + v.y, w: home.w, h: home.h };
              if (C.isFree(target, obstacles, C.GAP)) { placed = v; break; }
            }
            if (placed) { this.setTranslate(w, placed.x, placed.y); decided.push({ ...home, x: home.x + placed.x, y: home.y + placed.y }); }
            else {        // les 2 côtés bloqués -> A bloqué au contact (no-cascade)
              const cl = C.clampAgainst({ x: orig.x, y: orig.y },
                { x: node.x, y: node.y, w: orig.w, h: orig.h }, home, C.GAP);
              node.x = cl.x; node.y = cl.y; this.applyBox(wrap, node);
              decided.push(home);
            }
          });
        }
```

- [ ] **Step 4 : Re-router les câbles avec les positions poussées**

S'assurer que le re-route câbles dans `onMove` (déjà présent) tourne **après** la passe de collision. Comme `nodeBoxes()` lit maintenant `boxOf` (translate inclus, Task 3), les câbles suivent les voisins écartés. (Si le drag utilise le cache `_dragBoxes`, le remplacer par `this.drawCables()` pour relire les positions live pendant un push.)

Remplacer, dans `onMove`, le bloc de re-route câbles qui utilise `_dragBoxes` par un simple `this.drawCables();` (lecture live, translate inclus).

- [ ] **Step 5 : Vérif** — déplacer un node vers un voisin : le voisin s'écarte (animé) puis revient ; les câbles suivent ; le kernel ne bouge pas.

- [ ] **Step 6 : Commit**

```bash
git add mekistudio/frontend/static/js/canvas.js
git commit -m "feat(collision): push des voisins au déplacement (2 côtés, hystérésis, kernel-mur)"
```

---

### Task 5 : `canvas.js` — passe finale au lâcher (reloge définitif, invariant)

**Files:**
- Modify: `mekistudio/frontend/static/js/canvas.js` (`finish`)

- [ ] **Step 1 : Reloger les conflits au lâcher**

Dans `finish` (~l.100), après `wrap.classList.remove('dragging');` et **avant** `if (moved) this.persistNode(node);`, insérer (move uniquement) la passe finale — seule autorité de l'invariant :

```js
        const C = window.MekiCollision;
        const finalA = { x: node.x, y: node.y, w: wrap.offsetWidth, h: wrap.offsetHeight };
        const relogged = [];
        if (moving) {
          const wraps = [...this.$root.querySelectorAll('.node-wrap')].filter((w) => w !== wrap);
          // obstacles cumulatifs : A + nodes déjà relogés
          const obstacles = [finalA];
          wraps.forEach((w) => {
            const home = { x: parseFloat(w.style.left) || 0, y: parseFloat(w.style.top) || 0,
                           w: w.offsetWidth, h: w.offsetHeight };
            if (w.dataset.movable === 'false') { obstacles.push(home); return; }
            if (C.intersects(finalA, home, C.GAP)) {
              const others = obstacles.concat(
                wraps.filter((o) => o !== w).map((o) => ({ x: parseFloat(o.style.left) || 0,
                  y: parseFloat(o.style.top) || 0, w: o.offsetWidth, h: o.offsetHeight })));
              const spot = C.findFreeSpot(home, { w: home.w, h: home.h }, others, C.GAP);
              const nd = this._nodeData(w.dataset.id);
              if (nd) { nd.x = spot.x; nd.y = spot.y; }
              w.style.left = spot.x + 'px'; w.style.top = spot.y + 'px'; this.clearTranslate(w);
              obstacles.push({ x: spot.x, y: spot.y, w: home.w, h: home.h });
              relogged.push(w.dataset.id);
            } else {
              this.clearTranslate(w);                 // pas de conflit -> revient à son home
              obstacles.push(home);
            }
          });
        }
```

> `_nodeData(id)` : helper qui retrouve l'objet node JS par id. Si `canvas.js` ne garde pas de liste, persister directement via `persistNode` avec les nouvelles `x/y` lues du wrap (cf. Step 2). Si un tel helper n'existe pas, créer `_nodeData(id)` qui lit/écrit `w.style.left/top` comme source (les `node.x/y` ne sont pas conservés globalement) — dans ce cas, remplacer `nd.x/nd.y` par l'écriture directe `w.style.left/top` (déjà faite) et persister via un POST explicite.

- [ ] **Step 2 : Persister les relogés puis A en dernier + re-route**

Toujours dans `finish`, remplacer `if (moved) this.persistNode(node);` par :

```js
        for (const id of relogged) {
          const w = this.$root.querySelector('.node-wrap[data-id="' + id + '"]');
          if (w) this._persistPos(id, parseFloat(w.style.left) || 0, parseFloat(w.style.top) || 0);
        }
        if (moved) this.persistNode(node);   // A en DERNIER (cohérence si échec réseau partiel)
        this.drawCables();
```

Ajouter le helper `_persistPos` (POST position seule) près de `persistNode` :

```js
    async _persistPos(id, x, y) {
      try {
        await fetch('/api/canvas/nodes/' + id, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ x, y }),
        });
      } catch (e) { /* best-effort ; le boot réconcilie */ }
    },
```

- [ ] **Step 3 : Vérif** — lâcher A sur le home d'un voisin → le voisin est **décalé** définitivement (et persiste) ; recharger → disposition conservée, zéro recouvrement.

- [ ] **Step 4 : Commit**

```bash
git add mekistudio/frontend/static/js/canvas.js
git commit -m "feat(collision): passe finale au lâcher (reloge définitif, persist A en dernier)"
```

---

### Task 6 : `canvas.js` — spawn dans un trou libre (remplace la cascade)

**Files:**
- Modify: `mekistudio/frontend/static/js/canvas.js` (`openFileInNewEditor` ~l.351, `editorPosAt` ~l.390, état `_editorSpawns`)

- [ ] **Step 1 : Réserve de spots + remplacement de `editorPosAt`**

Remplacer `editorPosAt(slot)` par un calcul de spot libre. État : ajouter `_pendingSpots: [],` et supprimer l'usage de `_editorSpawns` (réservation cascade).

Nouveau `editorSpawnPos()` :

```js
    // position de spawn d'un éditeur : 1er trou libre près de l'explorateur, en évitant
    // les nodes existants ET les spots déjà réservés (double-clics rapprochés).
    editorSpawnPos() {
      const C = window.MekiCollision;
      const ex = this.$root.querySelector('.node-wrap[data-kind="fileexplorer"]');
      let bx = 360, by = 0, bw = 300;
      if (ex) { bx = parseFloat(ex.style.left) || 0; by = parseFloat(ex.style.top) || 0; bw = ex.offsetWidth; }
      const anchor = { x: bx + bw + 40, y: by };
      const others = [];
      this.$root.querySelectorAll('.node-wrap').forEach((w) => {
        others.push(this.boxOf(w));
      });
      this._pendingSpots.forEach((s) => others.push(s));
      const size = { w: 520, h: 440 };  // EDITOR_SPAWN_SIZE — refléter file_editor.py
      const spot = C.findFreeSpot(anchor, size, others, C.GAP);
      this._pendingSpots.push({ x: spot.x, y: spot.y, w: size.w, h: size.h });
      return spot;
    },
```

- [ ] **Step 2 : Brancher dans `openFileInNewEditor`**

Dans `openFileInNewEditor` (~l.351-389), remplacer la réservation de slot + `editorPosAt` par :

```js
      const pos = this.editorSpawnPos();
      try {
        // ... POST /api/canvas/nodes {kind:'fileeditor', x:pos.x, y:pos.y} ... open ... render ...
        // (inchangé pour le reste)
      } finally {
        // libère la réservation correspondant à ce spawn
        this._pendingSpots = this._pendingSpots.filter((s) => !(s.x === pos.x && s.y === pos.y));
      }
```

Et après `world.appendChild(this.renderNode(node));` garder `this.drawCables();` (déjà présent).

- [ ] **Step 3 : Vérif** — double-clic sur 2 fichiers rapprochés → 2 éditeurs **distincts**, groupés près de l'explorateur, sans recouvrement ; câbles tracés.

- [ ] **Step 4 : Commit**

```bash
git add mekistudio/frontend/static/js/canvas.js
git commit -m "feat(collision): spawn éditeur dans un trou libre (findFreeSpot + réservation)"
```

---

### Task 7 : `canvas.js` — push au redimensionnement (pousse-et-reste)

**Files:**
- Modify: `mekistudio/frontend/static/js/canvas.js` (`onMove` branche resize, `finish`)

- [ ] **Step 1 : Pousser les voisins recouverts par la box agrandie**

Dans `onMove`, branche resize, après `node.w = ...; node.h = ...; this.applyBox(wrap, node);` :

```js
        if (resizing) {
          const C = window.MekiCollision;
          const grown = { x: node.x, y: node.y, w: node.w, h: node.h };
          this.$root.querySelectorAll('.node-wrap').forEach((w) => {
            if (w === wrap || w.dataset.movable === 'false') return;
            const home = { x: parseFloat(w.style.left) || 0, y: parseFloat(w.style.top) || 0,
                           w: w.offsetWidth, h: w.offsetHeight };
            if (!C.intersects(grown, home, C.GAP)) { return; }   // resize : pas de retour auto
            const v = C.pushVector(grown, home, C.GAP);          // bas/droite uniquement
            const others = [];
            this.$root.querySelectorAll('.node-wrap').forEach((o) => {
              if (o === wrap || o === w) return;
              others.push(this.boxOf(o));
            });
            const target = { x: home.x + v.x, y: home.y + v.y, w: home.w, h: home.h };
            if (C.isFree(target, others, C.GAP)) this.setTranslate(w, v.x, v.y);
            else { node.w = this.clampW(node, home.x - C.GAP - node.x);  // borne la taille au contact
                   this.applyBox(wrap, node); }
          });
          this.drawCables();
        }
```

- [ ] **Step 2 : Figer les voisins poussés au lâcher (resize)**

Dans `finish`, ajouter (resize) une passe qui fige les `translate` des voisins poussés en home définitif (même séquence que Task 5 Step 1/2 mais sans retour : tout node avec `_tx/_ty` non nul → home = home+translate, clear, persist), puis persiste A. (Réutiliser `_persistPos`.)

```js
        if (resizing) {
          this.$root.querySelectorAll('.node-wrap').forEach((w) => {
            if (w === wrap || !(w._tx || w._ty)) return;
            const nx = (parseFloat(w.style.left) || 0) + w._tx;
            const ny = (parseFloat(w.style.top) || 0) + w._ty;
            w.style.left = nx + 'px'; w.style.top = ny + 'px'; this.clearTranslate(w);
            this._persistPos(w.dataset.id, nx, ny);
          });
          this.drawCables();
        }
```

- [ ] **Step 3 : Vérif** — agrandir un node sur un voisin → le voisin est poussé bas/droite et **reste** ; resize **borné** si un 3ᵉ node bloque. Commit `feat(collision): push au resize (quadrant, pousse-et-reste, clamp)`.

---

### Task 8 : `canvas.js` — réconciliation au chargement + mesure kernel

**Files:**
- Modify: `mekistudio/frontend/static/js/canvas.js` (`init` ~l.27-40)

- [ ] **Step 1 : Passe ordonnée déterministe après `renderNodes`**

Dans `init`, après `this.renderNodes(nodes);` et avant `this.drawCables();` :

```js
      this.reconcileOverlaps();
```

Ajouter la méthode :

```js
    // sépare les nodes hérités qui se chevauchent (figés d'abord, puis mobiles triés par id).
    reconcileOverlaps() {
      const C = window.MekiCollision;
      const wraps = [...this.$root.querySelectorAll('.node-wrap')];
      const fixed = wraps.filter((w) => w.dataset.movable === 'false');
      const movable = wraps.filter((w) => w.dataset.movable !== 'false')
        .sort((a, b) => (a.dataset.id < b.dataset.id ? -1 : 1));
      const placed = fixed.map((w) => this.boxOf(w));   // les figés sont des murs
      for (const w of movable) {
        const home = this.boxOf(w);
        if (C.isFree(home, placed, C.GAP)) { placed.push(home); continue; }
        const spot = C.findFreeSpot(home, { w: home.w, h: home.h }, placed, C.GAP);
        w.style.left = spot.x + 'px'; w.style.top = spot.y + 'px';
        placed.push({ x: spot.x, y: spot.y, w: home.w, h: home.h });
        this._persistPos(w.dataset.id, spot.x, spot.y);
      }
    },
```

- [ ] **Step 2 : Vérif** — canvas hérité avec chevauchement (forcer 2 nodes au même endroit via l'API, recharger) → séparés au boot, disposition **stable** sur 2 rechargements, kernel non déplacé.

- [ ] **Step 3 : Commit** `feat(collision): réconciliation au chargement (passe ordonnée + persist)`.

---

### Task 9 : Validation navigateur (Playwright)

**Files:** script jetable `.superpowers/validate_collision.py`.

- [ ] **Step 1 : Scénarios** — sur `http://127.0.0.1:8777/` (après `serve` + le code chargé) :
  - **0 erreur console** ; outil « déplacer » : traîner un éditeur sur un autre → à tout instant **aucun rect ne se recouvre** (assert sur les bounding boxes des `.node-wrap`, gap inclus) ; le percuté revient quand on s'éloigne ; capture.
  - lâcher sur le home d'un voisin → voisin **décalé** (sa position persiste : re-GET `/api/canvas`).
  - kernel : tenter de pousser un node dessus → node **bloqué**, kernel immobile.
  - resize : agrandir sur un voisin → poussé et **reste**.
  - spawn : ouvrir 2 fichiers → 2 éditeurs distincts, non recouvrants.
  - boot : POST 2 nodes au même endroit via l'API, recharger → séparés, stable sur 2 boots.
  - **les câbles suivent** les nodes écartés/relogés (0 câble figé sur un home obsolète).

```python
# squelette : adapter du pattern .superpowers/validate_cables_p1.py
# assert d'absence de recouvrement entre toutes paires de .node-wrap (rects DOM + GAP)
```

- [ ] **Step 2 : Exécuter** : `C:/Python314/python.exe .superpowers/validate_collision.py` ; inspecter captures + 0 erreur.

- [ ] **Step 3 : ROADMAP** — cocher « anti-chevauchement » et committer `docs(roadmap): anti-collision livré`.

- [ ] **Step 4 : 🛑 Revue manuelle utilisateur** (captures + comportement).

---

## Self-Review (rempli)

**1. Couverture spec :** D1 (revient/décalé) → T4 (hystérésis) + T5 (passe finale). D2 (no-cascade, 2 côtés) → T4. D3 (resize pousse-et-reste, quadrant, clamp) → T7. D4 (spawn free-spot + réservation) → T6. D5 (réconciliation ordonnée) → T8. D6 (kernel-mur) → T4 (clampAgainst sur figé) + T8 (figés d'abord). D7 (tests) → T1 (`node --test`) + T9 (Playwright). D8 (multi-éditeur = nouveau) → T6. Constantes §7 → T1 (`GAP`/`EPS`), `EDITOR_SPAWN_SIZE` → T6. Cas limites §8 : diagonale/MTV → `partVector`/`clampAgainst` (T1) ; saisir-écarté → reset translate (T3) ; échec persist → réconciliation boot (T8) ; kernel auto-dim mesuré → `boxOf`/offsetWidth (T3).

**2. Placeholders :** aucun TODO/TBD. Le `kernel.py w/h explicites` est *optionnel* (spec §8) — non requis car `boxOf` mesure le kernel via `offsetWidth` (header synchrone, stable). `_nodeData` : noté comme à créer ou contourner par écriture directe `style.left/top` + `_persistPos` (T5 Step 1 note).

**3. Cohérence signatures :** `intersects(a,b,gap)`, `isFree(box,others,gap)`, `partVector(mover,obstacle,dragDir,gap)→[v,v]`, `pushVector(grower,obstacle,gap)→v`, `clampAgainst(home,dragTo{,w,h},obstacle,gap)→{x,y}`, `findFreeSpot(anchor,size,others,gap)→{x,y}` — utilisées identiquement dans T4/T5/T6/T7/T8. `boxOf`/`setTranslate`/`clearTranslate`/`_persistPos` cohérents T3→T8.

---

## Coexistence avec les câbles (déjà livrés)
- **`nodeBoxes()`** lit désormais `boxOf` (home + translate) → les câbles suivent les nodes **poussés** (T3).
- **`drawCables()`** est appelé après **chaque** déplacement collision : push par frame (T4), reloge final (T5), resize (T7), spawn (déjà), réconciliation (`init`, T8).
- Pendant un drag, on **n'utilise plus le cache `_dragBoxes`** (positions live, car les voisins bougent) → `drawCables()` direct (T4 Step 4).
- Points d'insertion **distincts** de la feature câbles ; aucune fonction câble n'est modifiée hormis `nodeBoxes` (lecture rendue) et le remplacement du re-route câble par `drawCables()` dans `onMove`.
