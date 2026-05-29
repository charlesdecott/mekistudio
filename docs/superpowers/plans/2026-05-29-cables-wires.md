# Câbles/wires & impulsions — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Relier les nodes du canvas par des câbles dérivés d'un parent logique (`Node.source_id` : arbre kernel→explorer→éditeurs), tracés en **subway 45° adaptatif + ruban néon**, re-routés automatiquement ; puis (Phase 2) une **impulsion lumineuse de debug** (⚡) qui parcourt le chemin en **comète** et illumine les nodes.

**Architecture:** Le graphe de câbles est **dérivé** d'un champ `Node.source_id` (pas d'edges persistés). Backend : un champ + une réconciliation des liens. Front : géométrie **pure** isolée (`cables.js`, testable `node --test`) + rendu **SVG impératif** dans `.world` (pas Alpine `x-for`). Impulsions = couche d'animation par-dessus, pilotée en DOM impératif.

**Tech Stack:** Python 3.11+/Pydantic v2/FastAPI (backend) ; Alpine.js + SVG (front) ; pytest (backend) ; `node --test` (géométrie JS) ; Playwright (validation navigateur).

**Spec de référence :** [`docs/superpowers/specs/2026-05-29-cables-wires-design.md`](../specs/2026-05-29-cables-wires-design.md). Lire les décisions D1–D14 et les cas limites §8 avant de commencer.

---

## Conventions

- Python : `from __future__ import annotations`, `pathlib`, Pydantic v2 (`model_dump(mode="json")`), commentaires = le *pourquoi*.
- JS : `cables.js` est un **script classique** (pas ESM) — IIFE qui expose `window.MekiCables` **et** `module.exports` (pour `node --test`).
- TDD : test rouge → impl verte → commit. Un commit par étape cohérente.
- **Rappel mémoire projet** : pas de hot-reload — après une modif servie, `mekistudio update --restart` (ou relancer `serve`) + hard refresh ; valider le front avec **Playwright (screenshot + console)**, un HTTP 200 ne prouve pas l'exécution JS.

## Structure des fichiers

| Fichier | Responsabilité | Phase |
|---|---|---|
| `mekistudio/backend/models.py` | +`Node.source_id` | 1 |
| `mekistudio/backend/nodes/registry.py` | `CANONICAL_PARENT_KIND`, `canonical_parent_id`, `reconcile_source_links`, `default_canvas` lien explorer→kernel | 1 |
| `mekistudio/backend/nodes/__init__.py` | exporte les nouveaux symboles | 1 |
| `mekistudio/backend/bootstrap.py` | appelle `reconcile_source_links` (load + ensure) | 1 |
| `mekistudio/frontend/routes/canvas.py` | `NodeCreate.source_id` + dérivation serveur | 1 |
| `mekistudio/frontend/static/js/cables.js` | **géométrie pure** : constantes, `adaptiveSide`, `sideAnchor`, `assignLanes`, `subwayPoints`, `pointsToPath`, `cableClass` ; (P2) `pathBetween` | 1+2 |
| `mekistudio/frontend/static/js/cables.test.js` | tests `node --test` | 1+2 |
| `mekistudio/frontend/static/js/canvas.js` | `dataset.source`, `ensureCablesLayer`, `nodeBoxes`, `drawCables` + hooks ; (P2) toolbar ⚡, comète, glows | 1+2 |
| `mekistudio/frontend/static/css/canvas.css` | `.cables` + néon ; (P2) glows + toolbar | 1+2 |
| `mekistudio/frontend/templates/canvas.html` | include `cables.js` avant `canvas.js` | 1 |
| `tests/unit/test_nodes.py`, `tests/unit/test_app.py` | câblage `source_id`, dérivation, migration | 1 |

---

# PHASE 1 — Câbles

### Task 1 : `Node.source_id` (modèle + roundtrip)

**Files:**
- Modify: `mekistudio/backend/models.py:30-41`
- Test: `tests/unit/test_nodes.py`

- [ ] **Step 1 : Test rouge — le champ existe et roundtrip**

Ajouter à `tests/unit/test_nodes.py` :

```python
def test_node_has_source_id_default_none():
    from mekistudio.backend.nodes import build_kernel_node
    assert build_kernel_node().source_id is None


def test_canvas_roundtrip_preserves_source_id():
    from mekistudio.backend.models import CanvasState, Node
    from mekistudio.backend.components import NodeComponent
    n = Node(kind="fileeditor", source_id="abc", root=NodeComponent(children=[]))
    state = CanvasState(nodes=[n])
    assert CanvasState.model_validate(state.model_dump(mode="json")).nodes[0].source_id == "abc"
```

- [ ] **Step 2 : Run — échec attendu**

Run: `python -m pytest tests/unit/test_nodes.py::test_node_has_source_id_default_none tests/unit/test_nodes.py::test_canvas_roundtrip_preserves_source_id -v`
Expected: FAIL (`Node` n'a pas `source_id`).

- [ ] **Step 3 : Ajouter le champ**

Dans `mekistudio/backend/models.py`, classe `Node`, après la ligne `h: float | None = None` (l.35) :

```python
    source_id: str | None = None  # parent logique (câble dérivé). None = racine (kernel).
```

Et mettre à jour le docstring de `CanvasState` (l.45-46) :

```python
    """État du canvas. `nodes` est typé. Les câbles sont DÉRIVÉS de `Node.source_id`
    (arbre kernel→explorer→éditeurs) ; `edges` reste réservé/inutilisé."""
```

- [ ] **Step 4 : Run — vert**

Run: `python -m pytest tests/unit/test_nodes.py -v`
Expected: PASS.

- [ ] **Step 5 : Commit**

```bash
git add mekistudio/backend/models.py tests/unit/test_nodes.py
git commit -m "feat(cables): Node.source_id (parent logique dérivé)"
```

---

### Task 2 : Câblage & réconciliation backend (`registry.py`)

**Files:**
- Modify: `mekistudio/backend/nodes/registry.py`
- Modify: `mekistudio/backend/nodes/__init__.py`
- Test: `tests/unit/test_nodes.py`

- [ ] **Step 1 : Tests rouges**

Ajouter à `tests/unit/test_nodes.py` (et compléter l'import depuis `mekistudio.backend.nodes`) :

```python
def test_default_canvas_links_explorer_to_kernel():
    from mekistudio.backend.nodes import default_canvas
    state = default_canvas()
    k = next(n for n in state.nodes if n.kind == "kernel")
    e = next(n for n in state.nodes if n.kind == "fileexplorer")
    assert k.source_id is None
    assert e.source_id == k.id


def test_reconcile_source_links_repairs_absent_and_dangling():
    from mekistudio.backend.nodes import default_canvas, reconcile_source_links
    state = default_canvas()
    k = next(n for n in state.nodes if n.kind == "kernel")
    e = next(n for n in state.nodes if n.kind == "fileexplorer")
    e.source_id = None                      # absent
    reconcile_source_links(state)
    assert e.source_id == k.id
    e.source_id = "ghost"                   # dangling
    reconcile_source_links(state)
    assert e.source_id == k.id
    before = e.source_id                     # idempotent
    reconcile_source_links(state)
    assert e.source_id == before


def test_canonical_parent_id():
    from mekistudio.backend.nodes import canonical_parent_id, default_canvas
    state = default_canvas()
    k = next(n for n in state.nodes if n.kind == "kernel")
    assert canonical_parent_id(state, "fileexplorer") == k.id
    assert canonical_parent_id(state, "kernel") is None
```

- [ ] **Step 2 : Run — échec attendu**

Run: `python -m pytest tests/unit/test_nodes.py -k "source_links or canonical or links_explorer" -v`
Expected: FAIL (ImportError `canonical_parent_id`/`reconcile_source_links`).

- [ ] **Step 3 : Implémenter dans `registry.py`**

Ajouter en haut (après les imports existants) :

```python
# Parent logique attendu d'un kind (kind -> kind du parent). Source de vérité
# partagée par le spawn (create_node) et la réconciliation des liens.
CANONICAL_PARENT_KIND: dict[str, str] = {
    file_explorer.KIND: kernel.KIND,
    file_editor.KIND: file_explorer.KIND,
}


def canonical_parent_id(state: CanvasState, kind: str) -> str | None:
    """Id du parent canonique d'un node de ce kind, cherché PAR KIND dans l'état
    courant (jamais via default_canvas() qui régénère des ids aléatoires)."""
    parent_kind = CANONICAL_PARENT_KIND.get(kind)
    if parent_kind is None:
        return None
    return next((n.id for n in state.nodes if n.kind == parent_kind), None)


def reconcile_source_links(state: CanvasState) -> CanvasState:
    """Repose les liens parent ABSENTS ou CASSÉS (dangling) des built-in. Idempotent.
    N'utilise pas builder() et ne saute pas les kinds inconnus (juste la chaîne kind)."""
    ids = {n.id for n in state.nodes}
    for node in state.nodes:
        if node.kind == kernel.KIND:
            node.source_id = None
        elif node.source_id is None or node.source_id not in ids:
            node.source_id = canonical_parent_id(state, node.kind)
    return state
```

Et remplacer `default_canvas()` (l.40-50) par :

```python
def default_canvas() -> CanvasState:
    """Canvas initial : kernel (racine) + explorateur relié au kernel."""
    k = kernel.build_kernel_node()
    e = file_explorer.build_file_explorer_node()
    e.source_id = k.id  # 1 câble par node : l'explorateur pend au kernel
    return CanvasState(nodes=[k, e])
```

- [ ] **Step 4 : Exporter les nouveaux symboles**

Dans `mekistudio/backend/nodes/__init__.py`, étendre l'import depuis `registry` et `__all__` :

```python
from mekistudio.backend.nodes.registry import (
    CANONICAL_PARENT_KIND,
    NODE_BUILDERS,
    build_node,
    canonical_parent_id,
    default_canvas,
    reconcile_constraints,
    reconcile_source_links,
)
```

et ajouter `"CANONICAL_PARENT_KIND"`, `"canonical_parent_id"`, `"reconcile_source_links"` à `__all__`.

- [ ] **Step 5 : Run — vert**

Run: `python -m pytest tests/unit/test_nodes.py -v`
Expected: PASS (tous, dont `test_default_canvas_has_builtin_nodes` toujours vert).

- [ ] **Step 6 : Commit**

```bash
git add mekistudio/backend/nodes/registry.py mekistudio/backend/nodes/__init__.py tests/unit/test_nodes.py
git commit -m "feat(cables): canonical_parent_id + reconcile_source_links + lien explorer→kernel"
```

---

### Task 3 : Dérivation au spawn + orchestration bootstrap

**Files:**
- Modify: `mekistudio/frontend/routes/canvas.py:64-69` (NodeCreate), `:160-175` (create_node)
- Modify: `mekistudio/backend/bootstrap.py:39-44` (_ensure_builtin_nodes), `:47-67` (load_canvas)
- Test: `tests/unit/test_app.py`, `tests/unit/test_bootstrap.py`

- [ ] **Step 1 : Tests rouges (routes)**

Ajouter à `tests/unit/test_app.py` :

```python
def test_create_fileeditor_derives_source_id(tmp_path):
    client = _client(tmp_path)
    ids = _ids_by_kind(client)
    node = client.post("/api/canvas/nodes", json={"kind": "fileeditor", "x": 700, "y": 0}).json()
    assert node["source_id"] == ids["fileexplorer"]  # parent dérivé côté serveur


def test_create_node_explicit_source_id_override(tmp_path):
    client = _client(tmp_path)
    ids = _ids_by_kind(client)
    node = client.post(
        "/api/canvas/nodes",
        json={"kind": "fileeditor", "x": 1, "y": 1, "source_id": ids["kernel"]},
    ).json()
    assert node["source_id"] == ids["kernel"]


def test_create_node_bogus_source_id_falls_back_to_derived(tmp_path):
    client = _client(tmp_path)
    ids = _ids_by_kind(client)
    node = client.post(
        "/api/canvas/nodes",
        json={"kind": "fileeditor", "x": 1, "y": 1, "source_id": "ghost"},
    ).json()
    assert node["source_id"] == ids["fileexplorer"]  # bidon -> dérivé, pas de 422


def test_open_preserves_source_id(tmp_path):
    (tmp_path / "f.txt").write_text("hi", encoding="utf-8")
    client = _client(tmp_path)
    ids = _ids_by_kind(client)
    eid = client.post("/api/canvas/nodes", json={"kind": "fileeditor", "x": 1, "y": 1}).json()["id"]
    opened = client.post(f"/api/canvas/nodes/{eid}/open", json={"path": "f.txt"}).json()
    assert opened["source_id"] == ids["fileexplorer"]  # /open n'efface pas le lien
```

- [ ] **Step 2 : Run — échec attendu**

Run: `python -m pytest tests/unit/test_app.py -k "source_id or open_preserves" -v`
Expected: FAIL (`source_id` absent de la réponse / vaut `None`).

- [ ] **Step 3 : Implémenter la dérivation dans `routes/canvas.py`**

Étendre l'import (l.20) :

```python
from mekistudio.backend.nodes import (
    NODE_BUILDERS,
    build_node,
    canonical_parent_id,
    default_canvas,
)
```

`NodeCreate` (l.64-69) gagne un champ :

```python
class NodeCreate(BaseModel):
    """Crée un node d'un kind donné à une position. `source_id` : override optionnel
    du parent logique (sinon dérivé côté serveur)."""

    kind: str
    x: float = 0.0
    y: float = 0.0
    source_id: str | None = None
```

Dans `create_node` (l.172), juste après `node = build_node(...)` et **avant** `state.nodes.append(node)` :

```python
        node = build_node(body.kind, x=body.x, y=body.y)
        # source_id dérivé côté serveur (le client n'a rien à envoyer) ; override
        # accepté seulement s'il référence un node existant.
        if body.source_id and any(n.id == body.source_id for n in state.nodes):
            node.source_id = body.source_id
        else:
            node.source_id = canonical_parent_id(state, body.kind)
        state.nodes.append(node)
```

- [ ] **Step 4 : Run — vert (routes)**

Run: `python -m pytest tests/unit/test_app.py -v`
Expected: PASS.

- [ ] **Step 5 : Test rouge (orchestration bootstrap)**

Ajouter à `tests/unit/test_bootstrap.py` :

```python
def test_ensure_builtin_relinks_when_kernel_missing(tmp_path):
    # canvas hérité : explorateur SANS kernel et source_id pointant un id mort.
    import json
    from mekistudio.backend import paths
    from mekistudio.backend.bootstrap import ensure_meki_dir, load_canvas
    from mekistudio.backend.nodes import build_file_explorer_node

    paths.meki_dir(tmp_path).mkdir(parents=True, exist_ok=True)
    e = build_file_explorer_node()
    e.source_id = "dead-kernel-id"
    legacy = {"schema_version": 1, "nodes": [e.model_dump(mode="json")], "edges": [], "viewport": {"x": 0, "y": 0, "zoom": 1}}
    paths.canvas_path(tmp_path).write_text(json.dumps(legacy), encoding="utf-8")

    ensure_meki_dir(tmp_path)  # doit réinjecter le kernel ET relier l'explorateur
    state = load_canvas(tmp_path)
    k = next(n for n in state.nodes if n.kind == "kernel")
    exp = next(n for n in state.nodes if n.kind == "fileexplorer")
    assert exp.source_id == k.id  # relié au VRAI kernel présent, pas l'id mort
```

- [ ] **Step 6 : Run — échec attendu**

Run: `python -m pytest tests/unit/test_bootstrap.py::test_ensure_builtin_relinks_when_kernel_missing -v`
Expected: FAIL (`source_id` reste `dead-kernel-id`).

- [ ] **Step 7 : Brancher `reconcile_source_links` dans `bootstrap.py`**

Import (l.9) :

```python
from mekistudio.backend.nodes import default_canvas, reconcile_constraints, reconcile_source_links
```

`load_canvas` — remplacer le `return` final (l.67) :

```python
    return reconcile_source_links(reconcile_constraints(state))
```

`_ensure_builtin_nodes` (l.42-44) — réconcilier APRÈS l'ajout des built-in (UUID neufs), avant `save` :

```python
    if missing or not paths.canvas_path(root).exists():
        state.nodes.extend(missing)
        reconcile_source_links(state)  # relie les built-in fraîchement réinjectés
        save_canvas(root, state)
```

- [ ] **Step 8 : Run — vert (tout le backend)**

Run: `python -m pytest tests/unit -v`
Expected: PASS.

- [ ] **Step 9 : Commit**

```bash
git add mekistudio/frontend/routes/canvas.py mekistudio/backend/bootstrap.py tests/unit/test_app.py tests/unit/test_bootstrap.py
git commit -m "feat(cables): source_id dérivé au spawn + réconciliation au chargement"
```

---

### Task 4 : `cables.js` — constantes + `adaptiveSide` + `sideAnchor`

**Files:**
- Create: `mekistudio/frontend/static/js/cables.js`
- Create: `mekistudio/frontend/static/js/cables.test.js`

- [ ] **Step 1 : Test rouge**

Créer `mekistudio/frontend/static/js/cables.test.js` :

```js
const test = require('node:test');
const assert = require('node:assert');
const C = require('./cables.js');

const box = (x, y, w, h) => ({ x, y, w, h });

test('adaptiveSide: axe dominant + tie horizontal', () => {
  const a = box(0, 0, 100, 100);
  assert.equal(C.adaptiveSide(a, box(300, 0, 100, 100)), 'right');
  assert.equal(C.adaptiveSide(a, box(-300, 0, 100, 100)), 'left');
  assert.equal(C.adaptiveSide(a, box(0, 300, 100, 100)), 'bottom');
  assert.equal(C.adaptiveSide(a, box(0, -300, 100, 100)), 'top');
  // tie |dx|==|dy| -> horizontal
  assert.equal(C.adaptiveSide(a, box(200, 200, 100, 100)), 'right');
});

test('sideAnchor: point sur la face + clamp sur la longueur du côté', () => {
  const b = box(0, 0, 100, 40);
  assert.deepEqual(C.sideAnchor(b, 'right', 0), { x: 100, y: 20 });
  assert.deepEqual(C.sideAnchor(b, 'left', 0), { x: 0, y: 20 });
  // offset énorme -> clampé sur la face (hauteur 40, marge 10 -> +-10 max)
  assert.equal(C.sideAnchor(b, 'right', 999).y, 30);
  assert.equal(C.sideAnchor(b, 'right', -999).y, 10);
});
```

- [ ] **Step 2 : Run — échec attendu**

Run: `node --test mekistudio/frontend/static/js/cables.test.js`
Expected: FAIL (`Cannot find module './cables.js'`).

- [ ] **Step 3 : Créer `cables.js` (squelette + 2 fonctions)**

Créer `mekistudio/frontend/static/js/cables.js` :

```js
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
```

- [ ] **Step 4 : Run — vert**

Run: `node --test mekistudio/frontend/static/js/cables.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5 : Commit**

```bash
git add mekistudio/frontend/static/js/cables.js mekistudio/frontend/static/js/cables.test.js
git commit -m "feat(cables): cables.js — adaptiveSide + sideAnchor (géométrie pure)"
```

---

### Task 5 : `cables.js` — `assignLanes`

**Files:**
- Modify: `mekistudio/frontend/static/js/cables.js`
- Test: `mekistudio/frontend/static/js/cables.test.js`

- [ ] **Step 1 : Test rouge**

Ajouter à `cables.test.js` :

```js
test('assignLanes: offsets centrés, triés par le voisin, gap clampé, jamais égaux', () => {
  const box = (x, y, w, h) => ({ x, y, w, h });
  const node = box(0, 0, 100, 300); // côté droit long
  // 3 voisins dans le désordre vertical -> lanes triées de haut en bas
  const cables = [
    { neighbor: box(400, 200, 50, 50) },
    { neighbor: box(400, 0, 50, 50) },
    { neighbor: box(400, 100, 50, 50) },
  ];
  const offs = C.assignLanes(cables, node, 'right');
  // l'entrée du voisin le plus haut (y=0, index 1) doit avoir l'offset le plus négatif
  assert.ok(offs[1] < offs[2] && offs[2] < offs[0]);
  // centrés autour de 0
  assert.ok(Math.abs(offs[0] + offs[1] + offs[2]) < 1e-9);
  // 2 lanes ne partagent jamais la même valeur
  assert.equal(new Set(offs).size, 3);
  // 1 seul câble -> offset 0
  assert.deepEqual(C.assignLanes([{ neighbor: box(400, 0, 10, 10) }], node, 'right'), [0]);
});
```

- [ ] **Step 2 : Run — échec attendu**

Run: `node --test mekistudio/frontend/static/js/cables.test.js`
Expected: FAIL (`C.assignLanes is not a function`).

- [ ] **Step 3 : Implémenter**

Dans `cables.js`, ajouter avant la ligne `const MekiCables = ...` :

```js
  // Attribue des offsets de lane (centrés) aux câbles partageant (node, côté).
  // cables: [{ neighbor:{x,y,w,h} }] ; retourne les offsets dans l'ordre d'entrée.
  function assignLanes(cables, box, side) {
    const n = cables.length;
    if (n <= 1) return cables.map(() => 0);
    const tan = (side === 'left' || side === 'right')
      ? (c) => cy(c.neighbor) : (c) => cx(c.neighbor);
    const order = cables.map((_, i) => i).sort((i, j) => tan(cables[i]) - tan(cables[j]));
    const gap = Math.min(GAP_LANE, (sideLength(box, side) - 2 * MARGE) / (n - 1));
    const offs = new Array(n);
    order.forEach((origIdx, rank) => { offs[origIdx] = (rank - (n - 1) / 2) * gap; });
    return offs;
  }
```

et l'ajouter à l'objet exporté : `const MekiCables = { STUB, GAP_LANE, MARGE, HIDE_DIST, adaptiveSide, sideAnchor, assignLanes };`

- [ ] **Step 4 : Run — vert**

Run: `node --test mekistudio/frontend/static/js/cables.test.js`
Expected: PASS.

- [ ] **Step 5 : Commit**

```bash
git add mekistudio/frontend/static/js/cables.js mekistudio/frontend/static/js/cables.test.js
git commit -m "feat(cables): assignLanes — ruban trié + gap clampé"
```

---

### Task 6 : `cables.js` — `subwayPoints` (45° strict) + `pointsToPath`

**Files:**
- Modify: `mekistudio/frontend/static/js/cables.js`
- Test: `mekistudio/frontend/static/js/cables.test.js`

- [ ] **Step 1 : Test rouge**

Ajouter à `cables.test.js` :

```js
function segs(points) {
  const out = [];
  for (let i = 1; i < points.length; i++) {
    out.push({ dx: points[i].x - points[i - 1].x, dy: points[i].y - points[i - 1].y });
  }
  return out;
}

test('subwayPoints: exactement une diagonale 45° stricte, reste axis-aligned', () => {
  const A = { x: 100, y: 100 }, B = { x: 400, y: 220 };
  const pts = C.subwayPoints(A, 'right', B, 'left');
  const s = segs(pts);
  const diag = s.filter((g) => Math.abs(g.dx) > 0.001 && Math.abs(g.dy) > 0.001);
  assert.equal(diag.length, 1, 'une seule diagonale');
  assert.ok(Math.abs(Math.abs(diag[0].dx) - Math.abs(diag[0].dy)) < 0.001, '45° strict');
  // les autres segments sont horizontaux ou verticaux
  s.filter((g) => g !== diag[0]).forEach((g) => {
    assert.ok(Math.abs(g.dx) < 0.001 || Math.abs(g.dy) < 0.001);
  });
});

test('subwayPoints: run vertical dominant gère le 45° sans déborder', () => {
  const A = { x: 100, y: 100 }, B = { x: 140, y: 400 };
  const s = segs(C.subwayPoints(A, 'right', B, 'left'));
  const diag = s.filter((g) => Math.abs(g.dx) > 0.001 && Math.abs(g.dy) > 0.001);
  assert.equal(diag.length, 1);
  assert.ok(Math.abs(Math.abs(diag[0].dx) - Math.abs(diag[0].dy)) < 0.001);
});

test('pointsToPath: M..L.. uniquement, segments = points-1', () => {
  const d = C.pointsToPath([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 10 }]);
  assert.match(d, /^M [\d.]+ [\d.]+( L [\d.]+ [\d.]+)+$/);
  assert.equal((d.match(/L/g) || []).length, 2);
  assert.ok(!/[CQA]/.test(d), 'pas de courbe');
});
```

- [ ] **Step 2 : Run — échec attendu**

Run: `node --test mekistudio/frontend/static/js/cables.test.js`
Expected: FAIL (`subwayPoints` / `pointsToPath` indéfinis).

- [ ] **Step 3 : Implémenter**

Dans `cables.js`, ajouter avant `const MekiCables = ...` :

```js
  function stubOut(p, side, len) {
    switch (side) {
      case 'right': return { x: p.x + len, y: p.y };
      case 'left':  return { x: p.x - len, y: p.y };
      case 'top':   return { x: p.x, y: p.y - len };
      default:      return { x: p.x, y: p.y + len };
    }
  }

  // Connecteur entre 2 points : segment droit + UNE diagonale 45° (longueur =
  // min(|dx|,|dy|)) + segment droit. La diagonale ne déborde jamais.
  function subwayConnect(B, P) {
    const dx = P.x - B.x, dy = P.y - B.y;
    const adx = Math.abs(dx), ady = Math.abs(dy);
    const sx = Math.sign(dx) || 1, sy = Math.sign(dy) || 1;
    if (adx >= ady) {                  // horizontal dominant : H - diag - H
      const m1 = { x: B.x + sx * (adx - ady) / 2, y: B.y };
      const m2 = { x: m1.x + sx * ady, y: P.y };
      return [B, m1, m2, P];
    }
    const m1 = { x: B.x, y: B.y + sy * (ady - adx) / 2 }; // vertical dominant : V - diag - V
    const m2 = { x: P.x, y: m1.y + sy * adx };
    return [B, m1, m2, P];
  }

  // Tracé complet : ancre -> stub ⟂ -> connecteur -> stub ⟂ -> ancre.
  // anchorA / anchorB sont DÉJÀ décalés (offsets de lane inclus).
  function subwayPoints(anchorA, sideA, anchorB, sideB) {
    const B = stubOut(anchorA, sideA, STUB);
    const P = stubOut(anchorB, sideB, STUB);
    return [anchorA].concat(subwayConnect(B, P)).concat([anchorB]);
  }

  function pointsToPath(pts) {
    return 'M ' + pts.map((p) => p.x.toFixed(1) + ' ' + p.y.toFixed(1)).join(' L ');
  }
```

Ajouter `subwayPoints, pointsToPath` à l'objet exporté.

- [ ] **Step 4 : Run — vert**

Run: `node --test mekistudio/frontend/static/js/cables.test.js`
Expected: PASS.

- [ ] **Step 5 : Commit**

```bash
git add mekistudio/frontend/static/js/cables.js mekistudio/frontend/static/js/cables.test.js
git commit -m "feat(cables): subwayPoints (45° strict, anti-débordement) + pointsToPath"
```

---

### Task 7 : `cables.js` — `cableClass`

**Files:**
- Modify: `mekistudio/frontend/static/js/cables.js`
- Test: `mekistudio/frontend/static/js/cables.test.js`

- [ ] **Step 1 : Test rouge**

Ajouter à `cables.test.js` :

```js
test('cableClass: paires connues + fallback neutre', () => {
  assert.equal(C.cableClass('fileexplorer', 'kernel'), 'k2e');
  assert.equal(C.cableClass('fileeditor', 'fileexplorer'), 'e2e');
  assert.equal(C.cableClass('chat', 'fileeditor'), 'cable-default');     // futur, non mappé
  assert.equal(C.cableClass('fileeditor', ''), 'cable-default');          // parent introuvable
});
```

- [ ] **Step 2 : Run — échec attendu**

Run: `node --test mekistudio/frontend/static/js/cables.test.js`
Expected: FAIL.

- [ ] **Step 3 : Implémenter**

Dans `cables.js`, avant `const MekiCables = ...` :

```js
  function cableClass(kindChild, kindParent) {
    const pair = kindChild + '>' + kindParent;
    if (pair === 'fileexplorer>kernel') return 'k2e';
    if (pair === 'fileeditor>fileexplorer') return 'e2e';
    return 'cable-default';
  }
```

Ajouter `cableClass` à l'objet exporté.

- [ ] **Step 4 : Run — vert**

Run: `node --test mekistudio/frontend/static/js/cables.test.js`
Expected: PASS.

- [ ] **Step 5 : Commit**

```bash
git add mekistudio/frontend/static/js/cables.js mekistudio/frontend/static/js/cables.test.js
git commit -m "feat(cables): cableClass (couleur typée + fallback)"
```

---

### Task 8 : Template + CSS (include + style néon)

**Files:**
- Modify: `mekistudio/frontend/templates/canvas.html:11`
- Modify: `mekistudio/frontend/static/css/canvas.css`

- [ ] **Step 1 : Inclure `cables.js` AVANT `canvas.js`**

Dans `templates/canvas.html`, juste avant la ligne `<script defer src="/static/js/canvas.js"></script>` (l.11), ajouter :

```html
  <!-- géométrie pure des câbles (window.MekiCables) — avant canvas.js qui l'utilise. -->
  <script defer src="/static/js/cables.js"></script>
```

- [ ] **Step 2 : Styles du layer + néon**

Ajouter à la fin de `mekistudio/frontend/static/css/canvas.css` :

```css
/* --- Câbles (layer SVG dans .world, sous tous les node-wrap) --- */
.cables {
  position: absolute; left: 0; top: 0; width: 1px; height: 1px;
  overflow: visible; pointer-events: none;
  z-index: -1; /* derrière les node-wrap, y compris leurs z-index résiduels (selectNode) */
}
.cable .cable-halo { fill: none; stroke-width: 7; opacity: .22; stroke-linecap: round; stroke-linejoin: round; }
.cable .cable-core { fill: none; stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; }
.cable.k2e .cable-halo, .cable.k2e .cable-core { stroke: #b388ff; }
.cable.e2e .cable-halo, .cable.e2e .cable-core { stroke: #45d6c2; }
.cable.cable-default .cable-halo, .cable.cable-default .cable-core { stroke: #8893a7; }
```

- [ ] **Step 3 : Commit** (pas de test auto ; vérif visuelle en Task 11)

```bash
git add mekistudio/frontend/templates/canvas.html mekistudio/frontend/static/css/canvas.css
git commit -m "feat(cables): include cables.js + styles néon du layer"
```

---

### Task 9 : `canvas.js` — `dataset.source`, `ensureCablesLayer`, `nodeBoxes`, `drawCables`

**Files:**
- Modify: `mekistudio/frontend/static/js/canvas.js` (renderNode l.50-63, init l.27-40, état l.19-26)

- [ ] **Step 1 : `dataset.source` sur chaque wrap**

Dans `renderNode` (après `wrap.dataset.configurable = ...`, l.57) :

```js
      wrap.dataset.source = node.source_id || ''; // graphe de câbles lu depuis le DOM
```

- [ ] **Step 2 : Ajouter les méthodes de rendu des câbles**

Ajouter ces méthodes dans l'objet Alpine (par ex. juste après `applyBox`, l.70) :

```js
    // Layer SVG unique des câbles, premier enfant de .world. Idempotent.
    ensureCablesLayer() {
      const world = this.$root.querySelector('.world');
      if (!world) return null;
      let svg = world.querySelector('svg.cables');
      if (!svg) {
        svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('class', 'cables');
      }
      if (world.firstChild !== svg) world.insertBefore(svg, world.firstChild);
      return svg;
    },

    // Lit les boîtes de tous les nodes depuis le DOM : Map id -> {box, kind, source}.
    nodeBoxes() {
      const map = new Map();
      this.$root.querySelectorAll('.node-wrap').forEach((w) => {
        map.set(w.dataset.id, {
          box: { x: parseFloat(w.style.left) || 0, y: parseFloat(w.style.top) || 0,
                 w: w.offsetWidth, h: w.offsetHeight },
          kind: w.dataset.kind || '',
          source: w.dataset.source || '',
        });
      });
      return map;
    },

    // Recalcule et trace tous les câbles depuis une Map de boîtes (DOM impératif).
    drawCablesFrom(nodes) {
      const svg = this.ensureCablesLayer();
      if (!svg) return;
      const C = window.MekiCables;
      // 1) câbles enfant -> parent présent
      const cables = [];
      nodes.forEach((info, id) => {
        if (info.source && nodes.has(info.source)) cables.push({ id, parent: info.source });
      });
      // 2) côté choisi à chaque extrémité
      const sides = cables.map((cab) => ({
        child: C.adaptiveSide(nodes.get(cab.id).box, nodes.get(cab.parent).box),
        parent: C.adaptiveSide(nodes.get(cab.parent).box, nodes.get(cab.id).box),
      }));
      // 3) regroupe par (node, côté) pour attribuer les lanes aux DEUX extrémités
      const groups = new Map();
      const push = (nodeId, side, neighbor, ref) => {
        const k = nodeId + '|' + side;
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push({ neighbor, ref });
      };
      cables.forEach((cab, i) => {
        push(cab.id, sides[i].child, nodes.get(cab.parent).box, { i, end: 'child' });
        push(cab.parent, sides[i].parent, nodes.get(cab.id).box, { i, end: 'parent' });
      });
      const offChild = new Array(cables.length).fill(0);
      const offParent = new Array(cables.length).fill(0);
      groups.forEach((list, key) => {
        const cut = key.lastIndexOf('|');
        const box = nodes.get(key.slice(0, cut)).box;
        const offs = C.assignLanes(list, box, key.slice(cut + 1));
        list.forEach((item, j) => {
          if (item.ref.end === 'child') offChild[item.ref.i] = offs[j];
          else offParent[item.ref.i] = offs[j];
        });
      });
      // 4) trace chaque câble (halo + net), masque si boîtes ~confondues
      const seen = new Set();
      cables.forEach((cab, i) => {
        const a = nodes.get(cab.id), b = nodes.get(cab.parent);
        const dist = Math.hypot((a.box.x + a.box.w / 2) - (b.box.x + b.box.w / 2),
                                (a.box.y + a.box.h / 2) - (b.box.y + b.box.h / 2));
        let g = svg.querySelector('g[data-edge="' + cab.id + '"]');
        if (dist < C.HIDE_DIST) { if (g) g.remove(); return; }
        seen.add(cab.id);
        const anchorA = C.sideAnchor(a.box, sides[i].child, offChild[i]);
        const anchorB = C.sideAnchor(b.box, sides[i].parent, offParent[i]);
        const d = C.pointsToPath(C.subwayPoints(anchorA, sides[i].child, anchorB, sides[i].parent));
        if (!g) {
          g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
          g.dataset.edge = cab.id;
          for (const cls of ['cable-halo', 'cable-core']) {
            const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            p.setAttribute('class', cls);
            g.appendChild(p);
          }
          svg.appendChild(g);
        }
        g.setAttribute('class', 'cable ' + C.cableClass(a.kind, b.kind));
        g.querySelector('.cable-halo').setAttribute('d', d);
        g.querySelector('.cable-core').setAttribute('d', d);
      });
      // 5) supprime les <g> orphelins
      svg.querySelectorAll('g[data-edge]').forEach((g) => {
        if (!seen.has(g.dataset.edge)) g.remove();
      });
    },

    drawCables() { this.drawCablesFrom(this.nodeBoxes()); },
```

- [ ] **Step 3 : Tracer les câbles au chargement**

Dans `init` (après `if (defaultView) this.centerOnKernel(nodes);`, l.39) :

```js
      this.drawCables(); // câbles initiaux (le layer SVG est créé ici, après les wraps)
```

- [ ] **Step 4 : Vérif manuelle rapide**

Relancer le serveur (`mekistudio update --restart` ou `serve`), hard refresh. Les câbles kernel→explorer doivent apparaître. (Validation Playwright complète en Task 11.)

- [ ] **Step 5 : Commit**

```bash
git add mekistudio/frontend/static/js/canvas.js
git commit -m "feat(cables): rendu SVG impératif (ensureCablesLayer + drawCables)"
```

---

### Task 10 : `canvas.js` — re-route (move/resize/spawn/close) + cache de drag

**Files:**
- Modify: `mekistudio/frontend/static/js/canvas.js` (état, onNodeMouseDown l.74-121, openFileInNewEditor l.385, closeEditor l.347)

- [ ] **Step 1 : État du cache de drag**

Dans la liste d'état Alpine (après `_saveTimer: null,`, l.25) :

```js
    _dragBoxes: null,        // snapshot des boîtes pendant un drag (évite un reflow/frame)
```

- [ ] **Step 2 : Snapshot au mousedown + re-route par frame**

Dans `onNodeMouseDown`, juste après le calcul de `orig` (l.97) :

```js
      this._dragBoxes = this.nodeBoxes(); // boîtes des AUTRES nodes figées le temps du drag
```

Dans `onMove`, juste après `this.applyBox(wrap, node);` (l.117) :

```js
        // re-route : seule la boîte du node manipulé change ; les autres viennent du cache.
        if (this._dragBoxes) {
          const m = new Map(this._dragBoxes);
          const prev = m.get(node.id) || { kind: wrap.dataset.kind, source: wrap.dataset.source };
          m.set(node.id, {
            box: { x: node.x || 0, y: node.y || 0,
                   w: node.w != null ? node.w : orig.w, h: node.h != null ? node.h : orig.h },
            kind: prev.kind, source: prev.source,
          });
          this.drawCablesFrom(m);
        }
```

Dans `finish` (après `if (moved) this.persistNode(node);`, l.105) :

```js
        this._dragBoxes = null;
        this.drawCables(); // re-route final avec lecture fraîche du DOM
```

- [ ] **Step 3 : Re-route au spawn et à la fermeture**

Dans `openFileInNewEditor`, juste après `if (world) world.appendChild(this.renderNode(node));` (l.385) :

```js
        this.drawCables(); // câble du nouvel éditeur -> explorateur
```

Dans `closeEditor`, juste après `if (wrap) wrap.remove();` (l.347) :

```js
      this.drawCables(); // le câble disparaît avec le node source retiré
```

- [ ] **Step 4 : Vérif manuelle**

Relancer + hard refresh. Déplacer l'explorateur → le câble suit ; ouvrir 2-3 fichiers → ruban d'éditeurs ; fermer un éditeur → son câble disparaît.

- [ ] **Step 5 : Commit**

```bash
git add mekistudio/frontend/static/js/canvas.js
git commit -m "feat(cables): re-route auto (move/resize/spawn/close) + cache de drag"
```

---

### Task 11 : 🛑 CHECKPOINT — validation navigateur Phase 1 (Playwright)

**Files:**
- Create (jetable) : un script Playwright de validation (hors repo, ex. `tmp/validate_cables.py`).

- [ ] **Step 1 : Lancer le serveur**

Run: `mekistudio serve` (ou `mekistudio update --restart`). Noter l'URL (`http://127.0.0.1:8777/`).

- [ ] **Step 2 : Script de validation**

Créer un script Playwright (Python) qui, sur `http://127.0.0.1:8777/` :
- capture les **erreurs console** (doit être **0**) ;
- vérifie qu'il y a **exactement un** `svg.cables`, **premier enfant** de `.world` ;
- compte les `g[data-edge]` (= nombre de nodes avec `source` valide ; au départ : 1, kernel→explorer) ;
- ouvre 2-3 fichiers via double-clic dans l'explorateur → vérifie l'apparition de câbles (ruban) ;
- drag l'explorateur de quelques centaines de px → vérifie que le `d` d'un `.cable-core` **change** ;
- sélectionne/désélectionne 3 nodes puis vérifie qu'un câble passe **derrière** les cartes (z-index) ;
- teste un **zoom 0.2 et 4** (molette) sans erreur ;
- screenshots à chaque étape.

```python
import pathlib
from playwright.sync_api import sync_playwright

OUT = pathlib.Path("tmp/shots"); OUT.mkdir(parents=True, exist_ok=True)
errors = []
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={"width": 1280, "height": 900})
    pg.on("console", lambda m: errors.append(m.text) if m.type in ("error", "warning") else None)
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://127.0.0.1:8777/", wait_until="networkidle"); pg.wait_for_timeout(500)
    one_svg = pg.eval_on_selector_all(".world > svg.cables", "els => els.length")
    first = pg.eval_on_selector(".world", "w => w.firstElementChild && w.firstElementChild.matches('svg.cables')")
    edges = pg.eval_on_selector_all("svg.cables g[data-edge]", "els => els.length")
    pg.screenshot(path=str(OUT / "p1-initial.png"))
    print("SVG_COUNT", one_svg, "FIRST_CHILD", first, "EDGES", edges, "ERRORS", len(errors))
    b.close()
assert one_svg == 1 and first and not errors, (one_svg, first, errors)
print("OK")
```

- [ ] **Step 3 : Exécuter + inspecter les screenshots**

Run: `python tmp/validate_cables.py`
Expected: `SVG_COUNT 1`, `FIRST_CHILD True`, `ERRORS 0`, `OK`. Ouvrir les PNG : câbles néon visibles, ruban propre, derrière les cartes.

- [ ] **Step 4 : 🛑 STOP — revue manuelle de l'utilisateur**

Présenter les screenshots. **Ne pas passer à la Phase 2 sans validation manuelle** (exigence explicite : vérif à la main entre les deux phases). Corriger toute régression avant de continuer.

---

# PHASE 2 — Impulsions

### Task 12 : `cables.js` — `pathBetween` (chemin orienté)

**Files:**
- Modify: `mekistudio/frontend/static/js/cables.js`
- Test: `mekistudio/frontend/static/js/cables.test.js`

- [ ] **Step 1 : Test rouge**

Ajouter à `cables.test.js` :

```js
// arbre : kernel <- explorer <- ed1, ed2
const TREE = {
  k: { id: 'k', source: null },
  e: { id: 'e', source: 'k' },
  a: { id: 'a', source: 'e' },
  b: { id: 'b', source: 'e' },
};

test('pathBetween: from==to -> []', () => {
  assert.deepEqual(C.pathBetween(TREE, 'a', 'a'), []);
});

test('pathBetween: descente pure kernel -> feuille', () => {
  assert.deepEqual(C.pathBetween(TREE, 'k', 'a'),
    [{ childId: 'e', parentId: 'k', dir: 'down' }, { childId: 'a', parentId: 'e', dir: 'down' }]);
});

test('pathBetween: montée pure feuille -> kernel', () => {
  assert.deepEqual(C.pathBetween(TREE, 'a', 'k'),
    [{ childId: 'a', parentId: 'e', dir: 'up' }, { childId: 'e', parentId: 'k', dir: 'up' }]);
});

test('pathBetween: frère -> frère (montée puis descente via LCA)', () => {
  assert.deepEqual(C.pathBetween(TREE, 'a', 'b'),
    [{ childId: 'a', parentId: 'e', dir: 'up' }, { childId: 'b', parentId: 'e', dir: 'down' }]);
});

test('pathBetween: composantes disjointes -> null', () => {
  const forest = { a: { id: 'a', source: null }, b: { id: 'b', source: null } };
  assert.equal(C.pathBetween(forest, 'a', 'b'), null);
});

test('pathBetween: cycle -> null (pas de boucle infinie)', () => {
  const cyc = { a: { id: 'a', source: 'b' }, b: { id: 'b', source: 'a' } };
  assert.equal(C.pathBetween(cyc, 'a', 'b'), null);
});
```

- [ ] **Step 2 : Run — échec attendu**

Run: `node --test mekistudio/frontend/static/js/cables.test.js`
Expected: FAIL.

- [ ] **Step 3 : Implémenter**

Dans `cables.js`, avant `const MekiCables = ...` :

```js
  // Chaîne d'ancêtres [id, parent, ..., racine] ; null si cycle.
  function ancestorChain(nodesById, id) {
    const chain = [], seen = new Set();
    let cur = id;
    while (cur != null && nodesById[cur]) {
      if (seen.has(cur)) return null; // cycle
      seen.add(cur);
      chain.push(cur);
      cur = nodesById[cur].source || null;
    }
    return chain;
  }

  // Câbles ORIENTÉS du chemin from->to : {childId, parentId, dir}. dir='up'
  // (enfant->parent) en montée, 'down' (parent->enfant) en descente.
  // [] si from==to ; null si pas de chemin (disjoint) ou cycle.
  function pathBetween(nodesById, fromId, toId) {
    if (fromId === toId) return [];
    const a = ancestorChain(nodesById, fromId);
    const b = ancestorChain(nodesById, toId);
    if (!a || !b) return null;
    const bIdx = new Map(b.map((id, i) => [id, i]));
    let ia = -1, ib = -1;
    for (let i = 0; i < a.length; i++) {
      if (bIdx.has(a[i])) { ia = i; ib = bIdx.get(a[i]); break; }
    }
    if (ia === -1) return null; // pas d'ancêtre commun -> composantes disjointes
    const segs = [];
    for (let i = 0; i < ia; i++) segs.push({ childId: a[i], parentId: a[i + 1], dir: 'up' });
    for (let i = ib - 1; i >= 0; i--) segs.push({ childId: b[i], parentId: b[i + 1], dir: 'down' });
    return segs;
  }
```

Ajouter `pathBetween` à l'objet exporté.

- [ ] **Step 4 : Run — vert**

Run: `node --test mekistudio/frontend/static/js/cables.test.js`
Expected: PASS (tous).

- [ ] **Step 5 : Commit**

```bash
git add mekistudio/frontend/static/js/cables.js mekistudio/frontend/static/js/cables.test.js
git commit -m "feat(cables): pathBetween orienté (LCA, disjoint/cycle -> null)"
```

---

### Task 13 : `canvas.js` — mini-toolbar ⚡

**Files:**
- Modify: `mekistudio/frontend/static/js/canvas.js` (état, selectNode l.124-133, startPan, closeEditor)
- Modify: `mekistudio/frontend/static/css/canvas.css`

- [ ] **Step 1 : État**

Dans l'état Alpine : `_toolbar: null,`.

- [ ] **Step 2 : Afficher/cacher la toolbar**

Ajouter les méthodes (près de `selectNode`) :

```js
    showToolbar(wrap) {
      this.hideToolbar();
      const world = this.$root.querySelector('.world');
      if (!world) return;
      const bar = document.createElement('div');
      bar.className = 'node-toolbar';
      bar.style.left = (parseFloat(wrap.style.left) || 0) + 'px';
      bar.style.top = ((parseFloat(wrap.style.top) || 0) + wrap.offsetHeight + 8) + 'px';
      const zap = document.createElement('button');
      zap.type = 'button'; zap.className = 'node-toolbar-btn'; zap.textContent = '⚡';
      zap.title = 'Envoyer une impulsion (debug)';
      const id = wrap.dataset.id;
      zap.addEventListener('mousedown', (e) => e.stopPropagation());
      zap.addEventListener('click', (e) => { e.stopPropagation(); this.firePulse(id); });
      bar.appendChild(zap);
      world.appendChild(bar);
      this._toolbar = bar;
    },
    hideToolbar() { if (this._toolbar) { this._toolbar.remove(); this._toolbar = null; } },
```

Dans `selectNode`, à la fin (après `wrap.style.zIndex = ++this._zTop;`, l.132) :

```js
      this.showToolbar(wrap);
```

- [ ] **Step 3 : Cacher la toolbar à la désélection / fermeture**

Dans `startPan` (début de la méthode — clic sur le fond vide) : ajouter `this.hideToolbar(); this.selectedId = null;` (déselection). Si `startPan` n'existe pas explicitement, l'ajouter au handler `@mousedown="startPan($event)"` du `#canvas`.

Dans `closeEditor`, juste après `if (wrap) wrap.remove();` (l.347) :

```js
      if (this.selectedId === state.nodeId) { this.hideToolbar(); this.selectedId = null; }
```

- [ ] **Step 4 : CSS de la toolbar**

Ajouter à `canvas.css` :

```css
.node-toolbar {
  position: absolute; display: flex; gap: 6px; padding: 4px 6px;
  background: #11141a; border: 1px solid #262d3a; border-radius: 8px; z-index: 7;
}
.node-toolbar-btn {
  background: #1c2330; color: #cdb6ff; border: 1px solid #7c4dff;
  border-radius: 6px; padding: 2px 8px; cursor: pointer; font-size: 13px; line-height: 1.4;
}
.node-toolbar-btn:hover { background: #2a2150; }
```

- [ ] **Step 5 : Vérif manuelle** — sélectionner un node (dont le kernel) → ⚡ apparaît dessous ; cliquer le fond → disparaît.

- [ ] **Step 6 : Commit**

```bash
git add mekistudio/frontend/static/js/canvas.js mekistudio/frontend/static/css/canvas.css
git commit -m "feat(impulsions): mini-toolbar ⚡ sous le node sélectionné"
```

---

### Task 14 : `canvas.js` — comète le long du chemin

**Files:**
- Modify: `mekistudio/frontend/static/js/canvas.js`
- Modify: `mekistudio/frontend/static/css/canvas.css`

- [ ] **Step 1 : `reachableFrom` + `firePulse` (sans glows pour l'instant)**

Ajouter les méthodes :

```js
    // Ensemble des nodes atteignables depuis startId (adjacence NON orientée via source_id).
    reachableFrom(byId, startId) {
      const adj = {};
      Object.values(byId).forEach((n) => {
        if (n.source && byId[n.source]) {
          (adj[n.id] = adj[n.id] || []).push(n.source);
          (adj[n.source] = adj[n.source] || []).push(n.id);
        }
      });
      const seen = new Set([startId]), q = [startId];
      while (q.length) {
        const c = q.shift();
        (adj[c] || []).forEach((nb) => { if (!seen.has(nb)) { seen.add(nb); q.push(nb); } });
      }
      return seen;
    },

    async firePulse(fromId) {
      if (this._pulsing) return; // verrou : un clic ⚡ ignoré pendant un vol
      const boxes = this.nodeBoxes();
      const byId = {};
      boxes.forEach((info, id) => { byId[id] = { id, source: info.source || null }; });
      const targets = [...this.reachableFrom(byId, fromId)].filter((id) => id !== fromId);
      if (!targets.length) return; // node isolé -> no-op
      const toId = targets[Math.floor(Math.random() * targets.length)];
      const path = window.MekiCables.pathBetween(byId, fromId, toId);
      if (!path || !path.length) return;
      this._pulsing = true;
      try {
        for (const seg of path) await this.animateComet(seg);
      } finally { this._pulsing = false; }
    },
```

Et l'état : `_pulsing: false,`.

- [ ] **Step 2 : `animateComet`**

```js
    animateComet(seg) {
      return new Promise((resolve) => {
        const svg = this.ensureCablesLayer();
        const g = svg && svg.querySelector('g[data-edge="' + seg.childId + '"]');
        const path = g && g.querySelector('.cable-core');
        if (!path) return resolve();
        const len = path.getTotalLength();
        const NS = 'http://www.w3.org/2000/svg';
        const dot = document.createElementNS(NS, 'circle');
        dot.setAttribute('class', 'comet'); dot.setAttribute('r', '5.5');
        svg.appendChild(dot);
        const trail = [];
        for (let i = 0; i < 14; i++) {
          const c = document.createElementNS(NS, 'circle');
          c.setAttribute('class', 'comet-trail');
          c.setAttribute('r', (5 - i * 0.3).toFixed(1));
          c.setAttribute('opacity', (0.55 * (1 - i / 14)).toFixed(2));
          svg.appendChild(c); trail.push(c);
        }
        const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
        const dur = 850; let start = null;
        const step = (ts) => {
          if (start === null) start = ts;
          const t = Math.min(1, (ts - start) / dur), e = ease(t);
          const at = seg.dir === 'up' ? e * len : (1 - e) * len; // sens du flux
          const p = path.getPointAtLength(at);
          dot.setAttribute('cx', p.x); dot.setAttribute('cy', p.y);
          trail.forEach((c, i) => {
            const back = seg.dir === 'up'
              ? Math.max(0, at - (i + 1) * 11) : Math.min(len, at + (i + 1) * 11);
            const q = path.getPointAtLength(back); c.setAttribute('cx', q.x); c.setAttribute('cy', q.y);
          });
          if (t < 1) requestAnimationFrame(step);
          else { dot.remove(); trail.forEach((c) => c.remove()); resolve(); }
        };
        requestAnimationFrame(step);
      });
    },
```

- [ ] **Step 3 : CSS comète**

```css
.comet { fill: #fff7da; }
.comet-trail { fill: #ffce6e; }
```

- [ ] **Step 4 : Vérif manuelle** — sélectionner un node, cliquer ⚡ : une comète parcourt le chemin **sans reculer** (y compris en descente). Un 2ᵉ clic pendant le vol est ignoré.

- [ ] **Step 5 : Commit**

```bash
git add mekistudio/frontend/static/js/canvas.js mekistudio/frontend/static/css/canvas.css
git commit -m "feat(impulsions): comète le long du chemin (sens du flux, verrou)"
```

---

### Task 15 : `canvas.js` — glows (traversé / cible) + nettoyage

**Files:**
- Modify: `mekistudio/frontend/static/js/canvas.js`
- Modify: `mekistudio/frontend/static/css/canvas.css`

- [ ] **Step 1 : `glow` + Map de timers**

État : `_glowTimers: {},`. Ajouter :

```js
    // Allume un node. ms>0 : retrait auto (fondu CSS) ; ms=0 : persistant (notif).
    glow(id, level, ms) {
      const wrap = this.$root.querySelector('.node-wrap[data-id="' + id + '"]');
      if (!wrap) return;
      if (this._glowTimers[id]) { clearTimeout(this._glowTimers[id]); delete this._glowTimers[id]; }
      wrap.classList.remove('glow-soft', 'glow-strong', 'glow-notif');
      wrap.classList.add('glow-' + level);
      if (ms > 0) {
        this._glowTimers[id] = setTimeout(() => {
          wrap.classList.remove('glow-' + level);
          delete this._glowTimers[id];
        }, ms);
      }
    },
    clearGlow(id) {
      if (this._glowTimers[id]) { clearTimeout(this._glowTimers[id]); delete this._glowTimers[id]; }
      const wrap = this.$root.querySelector('.node-wrap[data-id="' + id + '"]');
      if (wrap) wrap.classList.remove('glow-soft', 'glow-strong', 'glow-notif');
    },
```

- [ ] **Step 2 : Brancher les glows dans `firePulse`**

Remplacer la boucle de `firePulse` (Task 14, Step 1) par :

```js
      this._pulsing = true;
      try {
        for (const seg of path) {
          await this.animateComet(seg);
          const arrived = seg.dir === 'up' ? seg.parentId : seg.childId;
          if (arrived !== toId) this.glow(arrived, 'soft', 600); // node traversé : doux
        }
        this.glow(toId, 'strong', 1500); // cible : flash fort + rémanence
      } finally { this._pulsing = false; }
```

- [ ] **Step 3 : Nettoyage à la fermeture**

Dans `closeEditor`, avant `if (wrap) wrap.remove();` (l.347) :

```js
      this.clearGlow(state.nodeId);
```

- [ ] **Step 4 : CSS glows** (le `.glow-notif` persistant est prêt pour les vraies notifications/attentes d'input ; le bouton ⚡ de debug ne déclenche que soft/strong)

```css
.node-wrap { transition: box-shadow .3s ease; }
.node-wrap.glow-soft   { box-shadow: 0 0 12px 2px rgba(255, 210, 122, .45); }
.node-wrap.glow-strong { box-shadow: 0 0 26px 6px rgba(255, 210, 122, .95); }
.node-wrap.glow-notif  { animation: meki-notif 1.25s ease-in-out infinite; }
@keyframes meki-notif {
  0%, 100% { box-shadow: 0 0 10px 2px rgba(255, 210, 122, .40); }
  50%      { box-shadow: 0 0 24px 6px rgba(255, 210, 122, .95); }
}
```

- [ ] **Step 5 : Vérif manuelle** — ⚡ : les nodes **traversés** s'illuminent doucement, la **cible** flashe fort ~1,5 s puis s'éteint en fondu.

- [ ] **Step 6 : Commit**

```bash
git add mekistudio/frontend/static/js/canvas.js mekistudio/frontend/static/css/canvas.css
git commit -m "feat(impulsions): glows traversé/cible + nettoyage à la fermeture"
```

---

### Task 16 : Validation navigateur Phase 2 (Playwright)

**Files:**
- Modify (jetable) : `tmp/validate_cables.py`

- [ ] **Step 1 : Étendre le script de validation**

Sur `http://127.0.0.1:8777/` : sélectionner le kernel (clic) → vérifier qu'un `.node-toolbar` apparaît ; cliquer le `⚡` → attendre ~1,2 s → vérifier qu'au moins un `.node-wrap` porte `glow-strong` ou `glow-soft` pendant l'animation ; **0 erreur console** ; screenshots avant/pendant/après.

```python
pg.click('.node-wrap[data-kind="kernel"]')
pg.wait_for_selector('.node-toolbar', timeout=2000)
pg.screenshot(path=str(OUT / "p2-toolbar.png"))
pg.click('.node-toolbar-btn')
pg.wait_for_timeout(500); pg.screenshot(path=str(OUT / "p2-comet.png"))
pg.wait_for_timeout(1200); pg.screenshot(path=str(OUT / "p2-arrived.png"))
print("ERRORS", len(errors)); assert not errors
```

- [ ] **Step 2 : Exécuter + inspecter**

Run: `python tmp/validate_cables.py`
Expected: toolbar visible, comète animée, cible illuminée, `ERRORS 0`.

- [ ] **Step 3 : Mise à jour ROADMAP**

Cocher « câbles/wires entre nodes » dans `docs/ROADMAP.md` (l.47) et ajouter une ligne sur le Jalon 2 (câbles + impulsions debug).

- [ ] **Step 4 : Commit**

```bash
git add docs/ROADMAP.md
git commit -m "docs(roadmap): câbles/wires + impulsions livrés"
```

- [ ] **Step 5 : 🛑 Revue manuelle finale de l'utilisateur** (screenshots + comportement).

---

## Self-Review (rempli)

**1. Couverture spec :**
- D1/D2/D13 (source_id, hiérarchie, migration) → Tasks 1-3. D3/D5/D14 (subway 45°, ruban, constantes) → Tasks 5-6. D4 (adaptatif) → Task 4. D6 (cableClass) → Task 7. D7 (layer SVG z-index:-1, néon) → Tasks 8-9. D8/D9 (re-route, boîtes DOM, cache) → Task 10. D10 (toolbar, pathBetween orienté, atteignable) → Tasks 12-14. D11 (glows, verrou, timers) → Tasks 14-15. D12 (tests node/pytest/Playwright) → tout + Tasks 11, 16.
- Cas limites §8 : 45°/débordement → Task 6 ; clamp d'ancre → Task 4 ; orphelin/HIDE_DIST → Task 9 ; disjoint/cycle → Task 12 ; z-index → Tasks 8/11 ; zoom → Task 11.

**2. Placeholders :** aucun TODO/TBD ; tout le code est explicite. Le `.glow-notif` est volontairement non déclenché par le ⚡ (réservé aux vraies notifications) — documenté Task 15 Step 4.

**3. Cohérence des types/signatures :** `adaptiveSide(a,b)`, `sideAnchor(box,side,off)`, `assignLanes(cables,box,side)→offsets`, `subwayPoints(anchorA,sideA,anchorB,sideB)→points`, `pointsToPath(points)→string`, `cableClass(kindChild,kindParent)→class`, `pathBetween(nodesById,from,to)→[{childId,parentId,dir}]|[]|null` — utilisés de façon identique dans `drawCablesFrom` (Task 9) et `firePulse`/`animateComet` (Tasks 14-15). `drawCables`/`drawCablesFrom`/`nodeBoxes`/`ensureCablesLayer` cohérents entre Tasks 9 et 10.

---

## Note de coexistence

La spec anti-collision (`IDEAS.md`) touche aussi `onNodeMouseDown`/`onMove`/`init`/spawn. Points d'insertion **distincts** (collision = positions des nodes ; câbles = `drawCables*`). Si les deux features sont implémentées, merger sans écraser les hooks de l'autre (les `drawCables()` s'ajoutent après les manipulations de position).

---

# PHASE 3 — Contournement pur 45° + changement de face (livré)

Demandé après validation Phase 1 (cf. spec §12, D15/D17). **Pur 45°** (90° rejeté).
Implémenté en TDD ; `node --test` **17/17** ; validé honnêtement au navigateur. Fichiers :
`cables.js`, `cables.test.js`, `canvas.js` (`drawCablesFrom`).

- **T17 — Up-and-over 45° (`routeAround`)** : `segHitsBox` (Liang-Barsky) + `pathHits` +
  `routeAroundH` (couloir au-dessus/en dessous, le plus court) + `routeAround` (dispatch
  H / V-par-réflexion). Branché `drawCablesFrom` 4a (`obstacles` = autres nodes gonflés de `STUB`).
- **T18 — Changement de face (`routeAvoiding`)** : `route45OrNull` (tracé 45° dégageant ou
  null) + `routeAvoiding` (essaie les faces de la node concernée, garde le 45° le plus court qui
  dégage ; repli droit seulement si aucune face). Branché `drawCablesFrom` 4b (**escape** : si
  `pathHits` encore vrai après 4a). Tests : sans obstacle → faces naturelles ; dense → ne passe
  pas sous le node (45°) ; collé à la source → change de face.
- **T18-bis — Anti-superposition des CÂBLES : DIFFÉRÉE** (fonctions pures conservées et testées,
  non branchées — la passe de bump écrasait le changement de face).
- **T19 — Validation honnête (Playwright)** : sur disposition **dense réelle** sans
  chevauchement → 0 câble sous un node, contournement appliqué (7 segments), 0 erreur. A révélé
  **D17** : un obstacle qui **chevauche** une extrémité reste irrésoluble → nécessite
  l'anti-chevauchement des nodes (spec sœur), prochaine feature.

Chaque étape : test (rouge) → implémentation (vert) → commit.
