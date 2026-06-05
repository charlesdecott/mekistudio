# Node `subcanvas` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduire un node built-in `subcanvas` — un cadre réductible générique qui contient tout le monde de l'explorateur (dossiers + éditeurs), le sort de la collision du canvas principal, et se replie en une tuile compacte.

**Architecture:** Nouvelle topologie `kernel → git → { chat, subcanvas → explorateur → {dossiers → éditeurs} }`. Coordonnées absolues conservées ; les **bornes du cadre sont dérivées** (boîte englobante du sous-arbre + padding + bande de titre). La collision principale ne voit qu'**une boîte** (le subcanvas) et **exclut** ses descendants. Le layout radial interne (`relayoutZones`) est inchangé ; il définit en plus les bornes du cadre. Migration auto via `default_canvas` + `reconcile_source_links` (déjà en place pour la brique G).

**Tech Stack:** Python 3.11 / Pydantic v2 / pytest (backend) · JS classique pur testé `node --test` (géométrie) · DOM impératif `canvas.js` validé Playwright.

**Référence design :** `docs/superpowers/specs/2026-06-05-subcanvas-node-design.md`

---

## Phase 1 — Backend : node, topologie, migration

### Task 1 : Module node `subcanvas` + câblage registry

**Files:**
- Create: `mekistudio/backend/nodes/subcanvas.py`
- Modify: `mekistudio/backend/nodes/registry.py` (import + `NODE_BUILDERS`)
- Modify: `mekistudio/backend/nodes/__init__.py` (export `SUBCANVAS_KIND`, `build_subcanvas_node`)
- Test: `tests/unit/test_nodes.py`

- [ ] **Step 1 : Test d'échec**

Ajouter à `tests/unit/test_nodes.py` :

```python
def test_build_subcanvas_node_structure():
    from mekistudio.backend.components import HeaderComponent
    from mekistudio.backend.nodes import SUBCANVAS_KIND, build_subcanvas_node
    n = build_subcanvas_node()
    assert n.kind == SUBCANVAS_KIND == "subcanvas"
    # cadre dérivé : ni déplaçable, ni redimensionnable, ni configurable ; réductible via collapsed.
    assert n.movable is False and n.resizable is False and n.configurable is False
    assert n.collapsed is False
    header = n.root.children[0].children[0]
    assert isinstance(header, HeaderComponent)


def test_build_node_includes_subcanvas():
    from mekistudio.backend.nodes import SUBCANVAS_KIND, build_node
    assert build_node(SUBCANVAS_KIND).kind == SUBCANVAS_KIND
```

- [ ] **Step 2 : Lancer → échec**

Run: `uv run pytest tests/unit/test_nodes.py::test_build_subcanvas_node_structure -v`
Expected: FAIL — `ImportError: cannot import name 'SUBCANVAS_KIND'`

- [ ] **Step 3 : Créer le module node**

Créer `mekistudio/backend/nodes/subcanvas.py` :

```python
"""Node « subcanvas » (built-in, brique H). Cadre réductible GÉNÉRIQUE qui contient
d'autres nodes : il les sort de la collision du canvas principal (la passe principale
ne voit qu'UNE boîte) et peut les replier en une tuile. Ses bornes sont DÉRIVÉES du
sous-arbre (cf. front : MekiSubcanvas.derivedBounds) — pas de position propre.

Topologie (brique H) : pend à git ; l'explorateur (+ dossiers + éditeurs) pend à lui
(kernel → git → { chat, subcanvas → explorateur → … }). Pensé générique/imbricable
pour les futurs sous-canvas par worktree."""
from __future__ import annotations

from mekistudio.backend.components import HeaderComponent, LayoutComponent, NodeComponent
from mekistudio.backend.models import Node

KIND = "subcanvas"


def build_subcanvas_node(x: float = 300.0, y: float = 0.0) -> Node:
    """Cadre conteneur. Non déplaçable / non redimensionnable (bornes dérivées du
    contenu côté front) ; réductible (collapsed). Le header porte le titre du cadre."""
    return Node(
        kind=KIND,
        x=x,
        y=y,
        w=360.0,
        h=300.0,
        movable=False,
        resizable=False,
        configurable=False,
        root=NodeComponent(
            children=[LayoutComponent(children=[HeaderComponent(level=2, text="Fichiers")])],
        ),
    )
```

- [ ] **Step 4 : Câbler le registry**

Dans `mekistudio/backend/nodes/registry.py`, ajouter `subcanvas` à l'import (ligne 7) :

```python
from mekistudio.backend.nodes import chat, file_editor, file_explorer, folder, gitbranch, kernel, subcanvas
```

Et à `NODE_BUILDERS` (après la ligne `folder.KIND: ...`) :

```python
    subcanvas.KIND: subcanvas.build_subcanvas_node,
```

- [ ] **Step 5 : Exporter depuis `__init__.py`**

Dans `mekistudio/backend/nodes/__init__.py`, ajouter après le bloc `folder` (ligne 10) :

```python
from mekistudio.backend.nodes.subcanvas import KIND as SUBCANVAS_KIND
from mekistudio.backend.nodes.subcanvas import build_subcanvas_node
```

Et dans `__all__`, après `"build_folder_node",` :

```python
    "SUBCANVAS_KIND",
    "build_subcanvas_node",
```

- [ ] **Step 6 : Lancer → succès**

Run: `uv run pytest tests/unit/test_nodes.py::test_build_subcanvas_node_structure tests/unit/test_nodes.py::test_build_node_includes_subcanvas -v`
Expected: PASS (2 passed)

- [ ] **Step 7 : Commit**

```bash
git add mekistudio/backend/nodes/subcanvas.py mekistudio/backend/nodes/registry.py mekistudio/backend/nodes/__init__.py tests/unit/test_nodes.py
git commit -m "feat(brique H): node subcanvas + câblage registry"
```

---

### Task 2 : Topologie — subcanvas sous git, explorateur sous subcanvas

**Files:**
- Modify: `mekistudio/backend/nodes/registry.py` (`CANONICAL_PARENT_KIND`, `default_canvas`)
- Test: `tests/unit/test_nodes.py`

- [ ] **Step 1 : Mettre à jour les tests de topologie existants (ils vont casser) + en ajouter**

Dans `tests/unit/test_nodes.py`, **remplacer** `test_default_canvas_has_builtin_nodes` :

```python
def test_default_canvas_has_builtin_nodes():
    # Built-in = kernel + git + subcanvas + explorateur + chat.
    canvas = default_canvas()
    assert isinstance(canvas, CanvasState)
    kinds = {n.kind for n in canvas.nodes}
    assert kinds == {KERNEL_KIND, "gitbranch", "subcanvas", FILE_EXPLORER_KIND, "chat"}
```

**Remplacer** `test_default_canvas_git_topology` :

```python
def test_default_canvas_subcanvas_topology():
    # Brique H : kernel -> git -> { chat, subcanvas -> explorateur }.
    state = default_canvas()
    by = {n.kind: n for n in state.nodes}
    assert by["kernel"].source_id is None
    assert by["gitbranch"].source_id == by["kernel"].id
    assert by["chat"].source_id == by["gitbranch"].id
    assert by["subcanvas"].source_id == by["gitbranch"].id
    assert by["fileexplorer"].source_id == by["subcanvas"].id
```

**Remplacer** `test_canonical_parent_id` :

```python
def test_canonical_parent_id():
    from mekistudio.backend.nodes import canonical_parent_id, default_canvas
    state = default_canvas()
    k = next(n for n in state.nodes if n.kind == "kernel")
    g = next(n for n in state.nodes if n.kind == "gitbranch")
    sc = next(n for n in state.nodes if n.kind == "subcanvas")
    assert canonical_parent_id(state, "subcanvas") == g.id
    assert canonical_parent_id(state, "fileexplorer") == sc.id  # brique H : sous le subcanvas
    assert canonical_parent_id(state, "gitbranch") == k.id
    assert canonical_parent_id(state, "kernel") is None
```

Dans `test_reconcile_source_links_repairs_absent_and_dangling`, **remplacer** les deux assertions `assert e.source_id == g.id` par le rattachement au subcanvas :

```python
def test_reconcile_source_links_repairs_absent_and_dangling():
    from mekistudio.backend.nodes import default_canvas, reconcile_source_links
    state = default_canvas()
    sc = next(n for n in state.nodes if n.kind == "subcanvas")
    e = next(n for n in state.nodes if n.kind == "fileexplorer")
    e.source_id = None                      # absent
    reconcile_source_links(state)
    assert e.source_id == sc.id             # canonique = subcanvas (brique H)
    e.source_id = "ghost"                   # dangling
    reconcile_source_links(state)
    assert e.source_id == sc.id
    before = e.source_id                     # idempotent
    reconcile_source_links(state)
    assert e.source_id == before
```

- [ ] **Step 2 : Lancer → échec**

Run: `uv run pytest tests/unit/test_nodes.py::test_default_canvas_subcanvas_topology -v`
Expected: FAIL — `KeyError: 'subcanvas'` (pas dans `default_canvas`).

- [ ] **Step 3 : Mettre à jour `CANONICAL_PARENT_KIND` + `default_canvas`**

Dans `mekistudio/backend/nodes/registry.py`, **remplacer** le dict `CANONICAL_PARENT_KIND` (lignes 29-35) :

```python
CANONICAL_PARENT_KIND: dict[str, str] = {
    gitbranch.KIND: kernel.KIND,
    subcanvas.KIND: gitbranch.KIND,        # H : le cadre pend à git
    file_explorer.KIND: subcanvas.KIND,    # H : l'explorateur vit DANS le cadre (était gitbranch)
    chat.KIND: gitbranch.KIND,
    file_editor.KIND: file_explorer.KIND,  # fallback ; le path-aware prend le dessus s'il y a des dossiers
    folder.KIND: file_explorer.KIND,       # fallback ; idem
}
```

**Remplacer** `default_canvas` (lignes 152-162) :

```python
def default_canvas() -> CanvasState:
    """Canvas initial (brique H) : kernel → git → { chat, subcanvas → explorateur }.
    Le kernel reste figé à (0,0) ; le cadre subcanvas contient l'explorateur."""
    k = kernel.build_kernel_node()
    g = gitbranch.build_gitbranch_node()
    g.source_id = k.id  # git pend au kernel
    sc = subcanvas.build_subcanvas_node(x=300.0, y=240.0)
    sc.source_id = g.id  # le cadre pend à git
    e = file_explorer.build_file_explorer_node(x=360.0, y=300.0)
    e.source_id = sc.id  # l'explorateur vit dans le cadre
    c = chat.build_chat_node(x=-440.0, y=240.0)
    c.source_id = g.id  # le chat pend aussi à git
    return CanvasState(nodes=[k, g, sc, e, c])
```

- [ ] **Step 4 : Lancer → succès (suite complète des nodes)**

Run: `uv run pytest tests/unit/test_nodes.py -v`
Expected: PASS (toutes, y compris les tests mis à jour). Le path-aware (`test_reconcile_path_aware_chain_and_idempotent`) reste vert : `d.source_id == e.id` (dossier → explorateur) est inchangé.

- [ ] **Step 5 : Commit**

```bash
git add mekistudio/backend/nodes/registry.py tests/unit/test_nodes.py
git commit -m "feat(brique H): topologie subcanvas — explorateur dans le cadre, cadre sous git"
```

---

### Task 3 : Migration auto d'un canvas pré-subcanvas

**Files:**
- Test: `tests/unit/test_nodes.py` (migration via `reconcile_source_links`)
- Test: `tests/unit/test_bootstrap.py` (injection built-in)

Aucune modif de code : `reconcile_source_links` répare déjà le « mauvais kind » (l'explorateur pendu à git n'est plus le bon parent → re-parenté au subcanvas), et `bootstrap._ensure_builtin_nodes` réinjecte le subcanvas manquant. On verrouille ce comportement par des tests.

- [ ] **Step 1 : Test de migration (reconcile)**

Ajouter à `tests/unit/test_nodes.py` :

```python
def test_reconcile_migrates_legacy_explorer_into_subcanvas():
    # Canvas legacy (brique G) : explorateur encore pendu à git, AUCUN subcanvas mais
    # le node existe déjà dans l'état (réinjecté par bootstrap). reconcile doit le ranger.
    from mekistudio.backend.models import CanvasState
    from mekistudio.backend.nodes import (
        build_chat_node,
        build_file_explorer_node,
        build_gitbranch_node,
        build_kernel_node,
        build_subcanvas_node,
        reconcile_source_links,
    )
    k = build_kernel_node()
    g = build_gitbranch_node(); g.source_id = k.id
    sc = build_subcanvas_node(); sc.source_id = g.id
    c = build_chat_node(); c.source_id = g.id
    e = build_file_explorer_node(); e.source_id = g.id  # legacy : sous git
    state = CanvasState(nodes=[k, g, sc, c, e])
    reconcile_source_links(state)
    by = {n.kind: n for n in state.nodes}
    assert by["fileexplorer"].source_id == by["subcanvas"].id  # migré dans le cadre
    assert by["subcanvas"].source_id == by["gitbranch"].id
    reconcile_source_links(state)  # idempotent
    assert by["fileexplorer"].source_id == by["subcanvas"].id
```

- [ ] **Step 2 : Test d'injection built-in (bootstrap)**

Regarder d'abord un test existant pour le style/fixtures : `tests/unit/test_bootstrap.py`. Ajouter un test qui écrit un canvas legacy (sans subcanvas) puis vérifie que `ensure_meki_dir` l'injecte et range l'explorateur :

```python
def test_ensure_builtin_injects_subcanvas_and_reparents_explorer(tmp_path):
    import json
    from mekistudio.backend import bootstrap, paths
    from mekistudio.backend.nodes import (
        build_chat_node, build_file_explorer_node, build_gitbranch_node, build_kernel_node,
    )
    from mekistudio.backend.models import CanvasState
    # canvas legbrique-G : kernel → git → { chat, explorateur } (pas de subcanvas)
    k = build_kernel_node()
    g = build_gitbranch_node(); g.source_id = k.id
    c = build_chat_node(); c.source_id = g.id
    e = build_file_explorer_node(); e.source_id = g.id
    paths.meki_dir(tmp_path).mkdir(parents=True, exist_ok=True)
    paths.canvas_path(tmp_path).write_text(
        json.dumps(CanvasState(nodes=[k, g, c, e]).model_dump(mode="json")), encoding="utf-8"
    )
    bootstrap.ensure_meki_dir(tmp_path)
    state = bootstrap.load_canvas(tmp_path)
    by = {n.kind: n for n in state.nodes}
    assert "subcanvas" in by                                   # réinjecté
    assert by["fileexplorer"].source_id == by["subcanvas"].id  # rangé dans le cadre
```

- [ ] **Step 3 : Lancer → vérifier**

Run: `uv run pytest tests/unit/test_nodes.py::test_reconcile_migrates_legacy_explorer_into_subcanvas tests/unit/test_bootstrap.py::test_ensure_builtin_injects_subcanvas_and_reparents_explorer -v`
Expected: PASS (2 passed). Si l'injection échoue, vérifier que `subcanvas` est bien dans `default_canvas()` (Task 2).

- [ ] **Step 4 : Suite backend complète (non-régression)**

Run: `uv run pytest -q`
Expected: PASS. Surveiller `test_app.py` / `test_chat_node.py` : si une assertion compte les built-in (ex. nombre de nodes du canvas par défaut), la mettre à jour (5 built-in désormais : kernel, git, subcanvas, explorateur, chat).

- [ ] **Step 5 : Commit**

```bash
git add tests/unit/test_nodes.py tests/unit/test_bootstrap.py
git commit -m "test(brique H): migration auto d'un canvas pré-subcanvas (reconcile + bootstrap)"
```

---

## Phase 2 — Géométrie pure du cadre (testée `node --test`)

### Task 4 : Module `subcanvas.js` — appartenance + bornes dérivées

**Files:**
- Create: `mekistudio/frontend/static/js/subcanvas.js`
- Test: `mekistudio/frontend/static/js/subcanvas.test.js`

- [ ] **Step 1 : Écrire les tests d'échec**

Créer `mekistudio/frontend/static/js/subcanvas.test.js` :

```javascript
const test = require('node:test');
const assert = require('node:assert');
const S = require('./subcanvas.js');

test('descendants : chaîne + fourche, exclut la racine et les étrangers', () => {
  const links = [
    { id: 'sc', source: 'git' },
    { id: 'exp', source: 'sc' },
    { id: 'f1', source: 'exp' },
    { id: 'e1', source: 'f1' },
    { id: 'e2', source: 'exp' },
    { id: 'chat', source: 'git' }, // étranger (hors sous-arbre)
  ];
  const d = new Set(S.descendants(links, 'sc'));
  assert.ok(d.has('exp') && d.has('f1') && d.has('e1') && d.has('e2'));
  assert.ok(!d.has('sc'));   // exclut la racine
  assert.ok(!d.has('chat')); // exclut les étrangers
  assert.equal(d.size, 4);
});

test('descendants : racine sans enfant -> vide ; tolère un parent manquant', () => {
  assert.deepEqual(S.descendants([{ id: 'a', source: 'x' }], 'sc'), []);
});

test('derivedBounds : englobe toutes les boîtes + padding + bande de titre en haut', () => {
  const boxes = [
    { x: 100, y: 100, w: 50, h: 40 },
    { x: 300, y: 260, w: 60, h: 30 },
  ];
  const b = S.derivedBounds(boxes, { pad: 24, titleH: 26 });
  // englobe à droite/bas avec pad
  assert.ok(b.x <= 100 - 24 + 0.001 && b.y <= 100 - 24 - 26 + 0.001);
  assert.ok(b.x + b.w >= 360 + 24 - 0.001);
  assert.ok(b.y + b.h >= 290 + 24 - 0.001);
  // bande de titre : le haut remonte de titleH au-delà du pad
  assert.equal(Math.round(b.y), 100 - 24 - 26);
});

test('derivedBounds : aucune boîte -> null', () => {
  assert.equal(S.derivedBounds([], {}), null);
});
```

- [ ] **Step 2 : Lancer → échec**

Run: `node --test mekistudio/frontend/static/js/subcanvas.test.js`
Expected: FAIL — `Cannot find module './subcanvas.js'`

- [ ] **Step 3 : Implémenter le module pur**

Créer `mekistudio/frontend/static/js/subcanvas.js` :

```javascript
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
```

- [ ] **Step 4 : Lancer → succès**

Run: `node --test mekistudio/frontend/static/js/subcanvas.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5 : Charger le script dans la page**

Repérer dans `mekistudio/frontend/templates/canvas.html` la liste des `<script src=".../zonelayout.js">` / `territories.js`. Ajouter, AVANT `canvas.js` :

```html
<script src="/static/js/subcanvas.js"></script>
```

- [ ] **Step 6 : Commit**

```bash
git add mekistudio/frontend/static/js/subcanvas.js mekistudio/frontend/static/js/subcanvas.test.js mekistudio/frontend/templates/canvas.html
git commit -m "feat(brique H): MekiSubcanvas pur (descendants + bornes dérivées) + chargement"
```

---

## Phase 3 — Intégration front (`canvas.js` + CSS)

> Vérification de phase : ces tâches sont DOM-impératives. La géométrie est déjà couverte
> par `subcanvas.test.js` ; l'intégration est validée par le script Playwright de la Task 9.
> Après chaque tâche : relancer le serveur (`mekistudio update --restart` ou redémarrer
> `serve`) + hard refresh, et vérifier visuellement avant de committer.

### Task 5 : Rendu du cadre subcanvas (CSS + renderNode + collapsible)

**Files:**
- Modify: `mekistudio/frontend/static/css/canvas.css`
- Modify: `mekistudio/frontend/static/js/canvas.js` (`_isCollapsible`)

- [ ] **Step 1 : CSS du cadre**

Dans `mekistudio/frontend/static/css/canvas.css`, ajouter (près des autres règles `.node-wrap[data-kind=...]`) :

```css
/* --- Brique H : cadre subcanvas (conteneur générique) --- */
.node-wrap[data-kind="subcanvas"] { z-index: -1; }              /* derrière ses descendants, au-dessus des câbles */
.node-wrap[data-kind="subcanvas"] .cmp-node {
  background: rgba(108, 170, 255, 0.04);
  border: 2px dashed rgba(108, 170, 255, 0.55);
  border-radius: 12px;
}
/* header = bande de titre en haut (la bande réservée par derivedBounds) ; jamais recouvert */
.node-wrap[data-kind="subcanvas"] .cmp-header {
  position: absolute; top: 0; left: 0; right: 0;
  padding: 4px 10px; font-size: 12px; color: #9cdcff;
  background: rgba(17, 51, 78, 0.55); border-radius: 10px 10px 0 0;
}
/* replié : tuile compacte (la hauteur dérivée est écrasée par relayoutZones) */
.node-wrap[data-kind="subcanvas"].collapsed .cmp-node { background: rgba(108,170,255,0.10); border-style: solid; }
/* descendants masqués quand le cadre est replié */
.node-wrap.contained-hidden { display: none !important; }
```

- [ ] **Step 2 : Rendre le subcanvas réductible**

Dans `mekistudio/frontend/static/js/canvas.js`, **remplacer** `_isCollapsible` (ligne ~1562) :

```javascript
    _isCollapsible(node) { return node.kind === 'folder' || node.kind === 'gitbranch' || node.kind === 'fileeditor' || node.kind === 'subcanvas'; },
```

- [ ] **Step 3 : Vérifier visuellement**

Redémarrer le serveur + hard refresh. Le cadre `📦 Fichiers` apparaît (taille par défaut au 1er rendu, avant le dimensionnement de la Task 6) avec son header bleu et un bouton réduire. Aucune erreur console.

- [ ] **Step 4 : Commit**

```bash
git add mekistudio/frontend/static/css/canvas.css mekistudio/frontend/static/js/canvas.js
git commit -m "feat(brique H): rendu du cadre subcanvas (CSS + réductible)"
```

---

### Task 6 : `relayoutZones` dimensionne le cadre + marque les descendants

**Files:**
- Modify: `mekistudio/frontend/static/js/canvas.js` (`relayoutZones`)

- [ ] **Step 1 : Ajouter le dimensionnement dérivé en fin de `relayoutZones`**

Dans `relayoutZones`, **remplacer** la dernière ligne `this.drawCables(); this.fitView();` (ligne ~514) par un appel au nouveau helper puis le dessin :

```javascript
      this._sizeSubcanvas();
      this.drawCables(); this.fitView();
```

- [ ] **Step 2 : Implémenter `_sizeSubcanvas`**

Ajouter cette méthode juste après `relayoutZones` (avant `_scheduleRelayout`, ligne ~516) :

```javascript
    // Brique H : dimensionne le cadre subcanvas sur la boîte englobante DÉRIVÉE de son sous-arbre
    // (explorateur + dossiers + éditeurs), réserve une bande de titre en haut, et MARQUE ses
    // descendants `data-contained` (exclus de la collision principale). Replié -> tuile + descendants
    // masqués. Retourne true si le cadre existe.
    _sizeSubcanvas() {
      const S = window.MekiSubcanvas;
      const sc = this.$root.querySelector('.node-wrap[data-kind="subcanvas"]');
      if (!S || !sc) return false;
      const scId = sc.dataset.id;
      // liens (id -> source) lus du DOM -> descendants transitifs du cadre.
      const links = [];
      this.$root.querySelectorAll('.node-wrap').forEach((w) => links.push({ id: w.dataset.id, source: w.dataset.source || '' }));
      const ids = new Set(S.descendants(links, scId));
      const wraps = [];
      this.$root.querySelectorAll('.node-wrap').forEach((w) => {
        if (w === sc) return;
        const inside = ids.has(w.dataset.id);
        w.dataset.contained = inside ? scId : '';
        w.classList.toggle('contained-hidden', inside && !!sc.classList.contains('collapsed'));
        if (inside) wraps.push(w);
      });
      const collapsed = sc.classList.contains('collapsed');
      if (collapsed || !wraps.length) {
        // tuile compacte : le header seul (la bande de titre). Position = coin haut-gauche courant.
        sc.style.width = '200px'; sc.style.height = '34px';
        return true;
      }
      const boxes = wraps.map((w) => this.boxOf(w));
      const b = S.derivedBounds(boxes, { pad: 22, titleH: 26 });
      if (!b) return true;
      sc.style.left = b.x + 'px'; sc.style.top = b.y + 'px';
      sc.style.width = b.w + 'px'; sc.style.height = b.h + 'px';
      return true;
    },
```

- [ ] **Step 3 : Vérifier visuellement**

Redémarrer + hard refresh, ouvrir quelques fichiers (double-clic dans l'explorateur) → le cadre enveloppe l'explorateur + les dossiers + les éditeurs, header en haut. Le cadre suit quand on ouvre/ferme des fichiers (relayout). Aucune erreur console.

- [ ] **Step 4 : Commit**

```bash
git add mekistudio/frontend/static/js/canvas.js
git commit -m "feat(brique H): relayoutZones dimensionne le cadre (bornes dérivées) + marque les contenus"
```

---

### Task 7 : Collision principale — exclure les contenus, garder le cadre

**Files:**
- Modify: `mekistudio/frontend/static/js/canvas.js` (`reconcileOverlaps` + obstacles de drag)

- [ ] **Step 1 : Helper d'appartenance au boot**

Ajouter (près de `_sizeSubcanvas`) un helper qui calcule les ids contenus depuis `data-source` (utilisable AVANT le 1er relayout) :

```javascript
    // Brique H : ids des descendants du cadre subcanvas, lus de l'arbre data-source (dispo dès le rendu).
    _containedIds() {
      const S = window.MekiSubcanvas;
      const sc = this.$root.querySelector('.node-wrap[data-kind="subcanvas"]');
      if (!S || !sc) return new Set();
      const links = [];
      this.$root.querySelectorAll('.node-wrap').forEach((w) => links.push({ id: w.dataset.id, source: w.dataset.source || '' }));
      return new Set(S.descendants(links, sc.dataset.id));
    },
```

- [ ] **Step 2 : Exclure les contenus dans `reconcileOverlaps`**

Dans `reconcileOverlaps` (ligne ~77), filtrer les wraps contenus (le cadre reste, comme mur) :

```javascript
    reconcileOverlaps() {
      const C = window.MekiCollision;
      const contained = this._containedIds();
      const wraps = [...this.$root.querySelectorAll('.node-wrap')].filter((w) => !contained.has(w.dataset.id));
      const fixed = wraps.filter((w) => w.dataset.movable === 'false');
      const movable = wraps.filter((w) => w.dataset.movable !== 'false')
        .sort((a, b) => (a.dataset.id < b.dataset.id ? -1 : 1));
      const placed = fixed.map((w) => this._homeBox(w));
      for (const w of movable) {
        const home = this._homeBox(w);
        if (C.isFree(home, placed, C.GAP)) { placed.push(home); continue; }
        const spot = C.findFreeSpot(home, { w: home.w, h: home.h }, placed, C.GAP);
        w.style.left = spot.x + 'px'; w.style.top = spot.y + 'px';
        placed.push({ x: spot.x, y: spot.y, w: home.w, h: home.h });
        this._persistPos(w.dataset.id, spot.x, spot.y);
      }
    },
```

- [ ] **Step 3 : Exclure les contenus des obstacles de drag**

Trouver, dans le pilote de drag, l'endroit où la liste des obstacles est construite à partir de `.node-wrap` (méthode `softResolve`/`onDrag` — chercher `querySelectorAll('.node-wrap')` autour des lignes ~586/652/690). Pour chaque construction d'obstacles d'un node EN DÉPLACEMENT qui n'est PAS lui-même contenu, exclure `[data-contained]`. Exemple de filtre à appliquer là où les obstacles sont collectés :

```javascript
      const contained = this._containedIds();
      // ... lors du parcours des .node-wrap pour bâtir les obstacles :
      //   if (w === draggedWrap) continue;
      //   if (contained.has(w.dataset.id) && !contained.has(draggedWrap.dataset.id)) continue; // contenu : géré par relayout
```

> Note : un node contenu reste obstacle pour un AUTRE node contenu (collision interne préservée).
> Seuls les nodes de premier niveau (chat) cessent de voir les contenus — ils ne voient que le cadre.

- [ ] **Step 4 : Vérifier visuellement**

Redémarrer + hard refresh, ouvrir plusieurs fichiers, puis **déplacer le node chat** vers le cadre : le chat s'arrête contre **la boîte du cadre**, sans se faufiler entre les éditeurs internes. Aucune erreur console.

- [ ] **Step 5 : Commit**

```bash
git add mekistudio/frontend/static/js/canvas.js
git commit -m "feat(brique H): collision principale = 1 boîte (cadre), descendants exclus"
```

---

### Task 8 : Repli du cadre — masquer contenus + câbles internes, tuile

**Files:**
- Modify: `mekistudio/frontend/static/js/canvas.js` (`toggleCollapse`, `drawCablesFrom`)

- [ ] **Step 1 : Brancher le repli du subcanvas sur un relayout**

Dans `toggleCollapse` (ligne ~1573), après avoir basculé la classe `collapsed` et AVANT le `drawCables()` existant, ajouter une branche subcanvas qui re-dimensionne + masque/affiche les contenus :

```javascript
    async toggleCollapse(node, wrap, btn) {
      const next = !node.collapsed;
      node.collapsed = next;
      if (wrap) wrap.classList.toggle('collapsed', next);
      if (btn) { btn.textContent = next ? '▸' : '▾'; btn.title = next ? 'Agrandir' : 'Réduire'; }
      if (!next && node.kind === 'fileeditor') {
        const st = this._editors[node.id];
        if (st && st.handle && st.handle.refresh) requestAnimationFrame(() => st.handle.refresh());
      }
      if (node.kind === 'subcanvas') {
        this.relayoutZones();   // re-dimensionne le cadre (tuile/plein) + (dé)masque les contenus + recâble + refit
      } else {
        this.drawCables();      // la hauteur change -> les câbles suivent
      }
      try {
        await fetch('/api/canvas/nodes/' + node.id, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ collapsed: next }),
        });
      } catch (e) { /* best-effort */ }
    },
```

- [ ] **Step 2 : Ne pas tracer les câbles vers/depuis un contenu masqué**

Dans `drawCablesFrom` (ligne ~248), après la collecte des câbles, ignorer ceux dont une extrémité est un contenu masqué (cadre replié). Repérer la boucle `nodes.forEach((info, id) => { if (info.source && nodes.has(info.source)) cables.push(...) })` et la garder ainsi :

```javascript
      const hidden = new Set();
      this.$root.querySelectorAll('.node-wrap.contained-hidden').forEach((w) => hidden.add(w.dataset.id));
      const cables = [];
      nodes.forEach((info, id) => {
        if (!info.source || !nodes.has(info.source)) return;
        if (hidden.has(id) || hidden.has(info.source)) return; // brique H : pas de câble vers un contenu replié
        cables.push({ id, parent: info.source });
      });
```

> Le câble `git → subcanvas` survit (aucune extrémité masquée) et pointe sur la tuile.
> Les câbles internes (`subcanvas → explorateur`, etc.) disparaissent avec leurs contenus.

- [ ] **Step 3 : Masquer les territoires des dossiers repliés**

Les territoires (`drawFolderTerritories`) se redessinent à chaque relayout depuis `folderBlobCorners`. Quand le cadre est replié, les contenus sont `display:none` → `boxOf` renvoie une boîte dégénérée (w/h 0). Filtrer : dans `drawFolderTerritories`, ne dessiner que les dossiers visibles. Au début de `groups.forEach` (ligne ~214), ajouter :

```javascript
      const hidden = new Set();
      this.$root.querySelectorAll('.node-wrap.contained-hidden').forEach((w) => hidden.add(w.dataset.id));
      // ... puis dans le forEach :
      groups.forEach((pts, id) => {
        if (hidden.has(id)) return; // brique H : dossier replié dans le cadre -> pas de territoire
        // (corps existant inchangé)
```

Et purger les paths orphelins en fin (déjà fait par la ligne `svg.querySelectorAll(...).forEach(... if (!seen...) remove())`).

- [ ] **Step 4 : Vérifier visuellement**

Redémarrer + hard refresh, ouvrir quelques fichiers. **Réduire** le cadre via ▾ : tout le monde fichiers disparaît, le cadre devient une **tuile** `📦 Fichiers`, le câble `git → cadre` reste, les territoires disparaissent. **Agrandir** via ▸ : tout réapparaît à sa place. Aucune erreur console.

- [ ] **Step 5 : Commit**

```bash
git add mekistudio/frontend/static/js/canvas.js
git commit -m "feat(brique H): repli du cadre — tuile + masquage contenus/câbles/territoires"
```

---

## Phase 4 — Validation Playwright + docs

### Task 9 : Script Playwright `pw-subcanvas.mjs`

**Files:**
- Create: `scripts/pw-subcanvas.mjs`

- [ ] **Step 1 : Écrire le script de validation**

Créer `scripts/pw-subcanvas.mjs` (sur le modèle de `scripts/pw-zone-layout.mjs`) :

```javascript
// scripts/pw-subcanvas.mjs — valide la brique H : le cadre subcanvas enveloppe l'explorateur +
// les éditeurs ouverts ; chat (top-level) ne chevauche pas le cadre ; repli -> tuile + contenus
// masqués ; 0 erreur console. S'appuie sur le serveur de dev (port via argv).
import { chromium } from 'playwright';
const URL = process.argv[2] || 'http://127.0.0.1:8797/';
const R = String.raw`C:\mekistudio`;
const rel = ['mekistudio\\frontend\\app.py', 'CLAUDE.md', 'docs\\ROADMAP.md'];
const abs = rel.map((f) => R + '\\' + f);
const b = await chromium.launch(); const p = await b.newPage();
await p.setViewportSize({ width: 1680, height: 950 });
const logs = []; p.on('console', (m) => { if (m.type() === 'error') logs.push(m.text()); });
p.on('pageerror', (e) => logs.push('PE:' + e.message));
const boot = async () => { await p.goto(URL, { waitUntil: 'networkidle' }); await p.waitForSelector('.cmp-chat .chat-input'); await p.waitForTimeout(1000); };
const clear = () => p.evaluate(async () => { for (const n of (await (await fetch('/api/canvas')).json()).nodes) if (!['kernel','gitbranch','subcanvas','fileexplorer','chat'].includes(n.kind)) { try { await fetch('/api/canvas/nodes/' + n.id, { method: 'DELETE' }); } catch (e) {} } });
const rectOf = (sel) => p.evaluate((s) => { const w = document.querySelector(s); if (!w) return null; return { x: parseFloat(w.style.left)||0, y: parseFloat(w.style.top)||0, w: w.offsetWidth, h: w.offsetHeight }; }, sel);
const contains = (o, i) => i && o && i.x >= o.x - 1 && i.y >= o.y - 1 && i.x + i.w <= o.x + o.w + 1 && i.y + i.h <= o.y + o.h + 1;
const overlap = (a, b2) => a && b2 && a.x < b2.x + b2.w && b2.x < a.x + a.w && a.y < b2.y + b2.h && b2.y < a.y + a.h;
try {
  await boot(); await clear();
  await p.evaluate(async () => { const chat = (await (await fetch('/api/canvas')).json()).nodes.find((n) => n.kind === 'chat'); if (chat) await fetch('/api/canvas/nodes/' + chat.id + '/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ spawn_mode: 'unlimited' }) }); });
  await boot();
  await p.evaluate(async (paths) => { let d; for (const el of document.querySelectorAll('[x-data]')) { const x = window.Alpine && window.Alpine.$data(el); if (x && x.spawnEphemeralEditor) d = x; } await Promise.all(paths.map((pp) => d.spawnEphemeralEditor(pp))); }, abs);
  await p.waitForTimeout(5000);
  await p.screenshot({ path: 'scripts/.pw/subcanvas.png' });
  // 1) le cadre englobe explorateur + éditeurs
  const sc = await rectOf('.node-wrap[data-kind="subcanvas"]');
  const exp = await rectOf('.node-wrap[data-kind="fileexplorer"]');
  const eds = await p.$$eval('.node-wrap[data-kind="fileeditor"]', (ws) => ws.map((w) => ({ x: parseFloat(w.style.left)||0, y: parseFloat(w.style.top)||0, w: w.offsetWidth, h: w.offsetHeight })));
  const expIn = contains(sc, exp);
  const edsIn = eds.filter((e) => contains(sc, e)).length;
  // 2) chat (top-level) ne chevauche pas le cadre
  const chat = await rectOf('.node-wrap[data-kind="chat"]');
  const chatClear = !overlap(sc, chat);
  console.log(JSON.stringify({ sc, expIn, edsTot: eds.length, edsIn, chatClear }, null, 2));
  console.log(expIn ? '✅ explorateur DANS le cadre' : '⚠️ explorateur hors cadre');
  console.log(edsIn === eds.length ? '✅ tous les éditeurs DANS le cadre' : '⚠️ éditeurs hors cadre: ' + (eds.length - edsIn));
  console.log(chatClear ? '✅ chat ne chevauche pas le cadre' : '⚠️ chat chevauche le cadre');
  // 3) repli -> tuile + contenus masqués
  await p.evaluate(() => { const w = document.querySelector('.node-wrap[data-kind="subcanvas"] .node-collapse'); if (w) w.click(); });
  await p.waitForTimeout(800);
  const scC = await rectOf('.node-wrap[data-kind="subcanvas"]');
  const hidden = await p.$$eval('.node-wrap[data-kind="fileeditor"]', (ws) => ws.every((w) => getComputedStyle(w).display === 'none'));
  console.log((scC.h <= 60 && hidden) ? '✅ repli -> tuile + contenus masqués' : '⚠️ repli incomplet (h=' + scC.h + ', hidden=' + hidden + ')');
  await clear();
  console.log('CONSOLE_ERRORS:', logs.length); logs.slice(0, 8).forEach((x) => console.log('  ', x));
} catch (e) { console.error('FAIL', e); } finally { await b.close(); }
```

- [ ] **Step 2 : Lancer le serveur de dev + le script**

Démarrer un serveur de dev sur un port libre (ex. `uv run mekistudio serve --port 8797` en arrière-plan), créer le dossier de sortie si besoin, puis :

Run: `node scripts/pw-subcanvas.mjs http://127.0.0.1:8797/`
Expected: les 4 lignes ✅ (explorateur dans le cadre, éditeurs dans le cadre, chat dégagé, repli→tuile) et `CONSOLE_ERRORS: 0`.

- [ ] **Step 3 : Inspecter le screenshot**

Ouvrir `scripts/.pw/subcanvas.png` : le cadre `📦 Fichiers` enveloppe l'explorateur et les éditeurs ; chat/git/kernel dehors.

- [ ] **Step 4 : Commit**

```bash
git add scripts/pw-subcanvas.mjs
git commit -m "test(brique H): validation Playwright du cadre subcanvas (confinement + repli)"
```

---

### Task 10 : Documentation (CLAUDE.md, ARCHITECTURE, ROADMAP)

**Files:**
- Modify: `CLAUDE.md` (section Architecture — topologie + node subcanvas)
- Modify: `docs/ARCHITECTURE.md` (modules front + invariants)
- Modify: `docs/ROADMAP.md` (brique H livrée)

- [ ] **Step 1 : CLAUDE.md**

Dans la section *Architecture* de `CLAUDE.md`, mettre à jour la topologie built-in en
`kernel → git → subcanvas → { explorateur }` (chat sous git), et ajouter une phrase :
« **Node `subcanvas`** (brique H) : cadre réductible générique qui contient le monde de
l'explorateur (dossiers + éditeurs) ; bornes **dérivées** du sous-arbre (`subcanvas.js` —
`MekiSubcanvas.descendants`/`derivedBounds`), descendants **exclus** de la collision principale
(`data-contained`), repli → tuile (`MekiSubcanvas` + `relayoutZones._sizeSubcanvas`). »
Ajouter `subcanvas.js (MekiSubcanvas)` à l'énumération des modules purs front.

- [ ] **Step 2 : docs/ARCHITECTURE.md**

Documenter le module `subcanvas.js`, le champ DOM `data-contained`, la règle de collision
(top-level uniquement + cadre = 1 boîte), et l'invariant « le cadre enveloppe exactement son
sous-arbre (bornes dérivées) ». Mentionner la migration auto (reconcile + bootstrap).

- [ ] **Step 3 : docs/ROADMAP.md**

Ajouter une puce sous le Jalon 2 : « ✅ **Brique H — node subcanvas** (livré) : cadre
réductible générique confinant le monde de l'explorateur ; collision principale = 1 boîte ;
migration auto ; futur = un subcanvas par worktree (imbriqué). Spec/plan :
`docs/superpowers/{specs,plans}/2026-06-05-subcanvas-node*`. »

- [ ] **Step 4 : Commit**

```bash
git add CLAUDE.md docs/ARCHITECTURE.md docs/ROADMAP.md
git commit -m "docs(brique H): node subcanvas (topologie, modules front, invariants, roadmap)"
```

---

## Self-review (couverture du spec)

- **Concept cadre réductible générique** → Tasks 1, 5, 8. ✅
- **Topologie `kernel → git → { chat, subcanvas → explorateur → … }`** → Task 2. ✅
- **Appartenance = descendants `source_id`** → Task 4 (`descendants`), Tasks 6/7 (`_containedIds`). ✅
- **Coords absolues + bornes dérivées** → Task 4 (`derivedBounds`), Task 6 (`_sizeSubcanvas`). ✅
- **Collision principale = 1 boîte, descendants exclus** → Task 7. ✅
- **`separatePolys` confiné à l'intérieur** → inchangé (les zones internes restent dans `relayoutZones`) ; aucune régression attendue (le cadre n'entre pas dans le radial). ✅
- **Câbles dérivés `git→subcanvas` + `subcanvas→explorateur` ; repli masque l'interne** → Task 8. ✅
- **Comètes routées via le conteneur / glow tuile si replié** → couvert par la topologie `source_id` (la comète suit `pathBetween` sur l'arbre, qui passe désormais par le subcanvas) ; si le node cible est `contained-hidden`, l'impulsion retombe sur le cadre. *Vérifier visuellement* lors de la Task 9 (optionnel : ouvrir le chat et faire lire un fichier). ✅
- **Migration auto** → Task 3. ✅
- **Tests pytest / `node --test` / Playwright** → Tasks 1-4 (pytest + node), Task 9 (Playwright). ✅
- **Hors périmètre (drag manuel, imbrication, worktrees)** → non implémenté, noté Task 10 + mémoire. ✅
