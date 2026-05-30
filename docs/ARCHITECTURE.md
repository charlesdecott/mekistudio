# Architecture (état réel du code)

Vue d'ensemble de **ce qui est implémenté** (≠ `ROADMAP.md` qui suit l'avancement,
≠ `docs/old/` qui décrit la vision). À mettre à jour quand l'archi évolue.

## Layering

```
backend/  (état, modèles, FS)  ←  frontend/  (FastAPI + Jinja + Alpine)  ←  cli.py
```
`backend/` n'importe **jamais** `frontend/`. `frontend/routes/` importe `backend/`
(c'est voulu : le câblage HTTP vit côté frontend). `cli.py` est le seul point qui
lance le serveur (`serve`) et gère `update`/`update --restart`.

## Backend (`mekistudio/backend/`)

- **`paths.py`** — `find_repo_root`, layout `.mekistudio/` (`meki_dir`,
  `manifest_path`, `canvas_path`).
- **`models.py`** — `Manifest`, `Viewport`, `Node` (id, kind, x, y, w/h optionnels,
  `movable`/`resizable`/`configurable`, `max_w`/`max_h`, **`source_id`** = parent logique,
  `root: NodeComponent`), `CanvasState` (schema_version, `nodes: list[Node]`,
  `edges: list[dict]` **réservé/inutilisé**, viewport). Les **câbles sont dérivés** de
  `source_id` (arbre kernel→explorer→éditeurs), pas stockés.
- **`components/`** — primitives Pydantic en **union discriminée** sur `type` :
  `NodeComponent`, `LayoutComponent`, `HeaderComponent` (niv. 1–4), `FileTreeComponent`
  (`root_path`, `excludes`), `EditorComponent` (`file_path`). `Component` = l'union ;
  `iter_components(c)` parcourt l'arbre.
- **`nodes/`** — fabriques + registre. `kernel.py`, `file_explorer.py`,
  `file_editor.py` exposent chacun `KIND` + `build_*_node(...)`. `registry.py` :
  `NODE_BUILDERS` (kind→fabrique), `build_node(kind, **kw)`, `default_canvas()`
  (built-in = kernel + explorateur **relié au kernel via `source_id`**),
  `reconcile_constraints(state)` (réimpose `movable/resizable/configurable/max_*` depuis le
  kind), `CANONICAL_PARENT_KIND`/`canonical_parent_id(state, kind)` (parent attendu par kind),
  `reconcile_source_links(state)` (repose les liens `source_id` absents/cassés des built-in).
- **`bootstrap.py`** — `ensure_meki_dir` (crée `.mekistudio/` + manifest + canvas si
  absents, puis `_ensure_builtin_nodes` rajoute les kinds built-in manquants + rappelle
  `reconcile_source_links`) ; `load_canvas` (corrupt-safe : `.bak` + `default_canvas()` ;
  applique `reconcile_constraints` puis `reconcile_source_links`) ;
  `save_canvas`/`_write_json` (**écriture atomique** tmp unique + `replace`, `allow_nan=False`).
- **`fs.py`** — accès fichiers **sandboxé** au repo : `list_dir(root, rel, excludes)`,
  `read_file` (garde binaire/taille `MAX_FILE_BYTES`/UTF-8), `write_file` (fichier
  existant, atomique), `is_file_in_root`.

## Surface API (`frontend/routes/`)

| Méthode & route | Rôle |
|---|---|
| `GET /healthz` | ping |
| `GET /` | page canvas (Jinja `canvas.html`, bootstrap) |
| `GET /api/canvas` | `CanvasState` complet |
| `POST /api/canvas/viewport` | persiste pan/zoom (rejet NaN/Inf) |
| `POST /api/canvas/nodes` | **crée** un node (kind, x, y ; `source_id` **dérivé serveur** par kind, override optionnel ; borné `MAX_NODES`, rejet non-fini) |
| `DELETE /api/canvas/nodes/{id}` | **supprime** un node (built-in protégés → 422) |
| `POST /api/canvas/nodes/{id}` | déplace/redimensionne (contraintes serveur, clamp) |
| `POST /api/canvas/nodes/{id}/open` | ouvre un fichier dans un node éditeur |
| `POST /api/canvas/nodes/{id}/settings` | réglages (ex. `excludes` du fileExplorer) |
| `GET /api/fs?path=&exclude=` | listing dossier (lazy, sandboxé) |
| `GET /api/file?path=` · `POST /api/file` | lire / sauver un fichier texte |

Écritures `canvas.json` sérialisées par un `asyncio.Lock` ; `/api/file` par un autre.

## Frontend (`frontend/`)

- **`templates/canvas.html`** — ordre de chargement des scripts **critique** :
  `cables.js` puis `collision.js` (géométries pures), puis `canvas.js` (classique, *avant*
  Alpine) qui enregistre le composant via `alpine:init` ; Alpine depuis unpkg ; `editor.js`
  en `type="module"`. Toolbar gauche + modale réglages.
- **`static/js/cables.js`** — géométrie **pure** des câbles (`window.MekiCables`, testée
  `node --test`) : `adaptiveSide`/`sideAnchor`/`assignLanes`/`subwayPoints` (subway 45° +
  ruban), `routeAround`/`routeAvoiding` (contournement des nodes : up-and-over 45° puis
  changement de face), `segOverlap`/`cablesOverlap` (anti-superposition ruban),
  `pathBetween` (chemin orienté dans l'arbre `source_id`, pour les impulsions).
- **`static/js/collision.js`** — géométrie **pure** de l'anti-chevauchement
  (`window.MekiCollision`, testée `node --test`) : `intersects`/`isFree`, `partVector`
  (écarte un voisin, 2 côtés), `pushVector` (resize), `clampAgainst` (mur), `findFreeSpot`
  (trou libre en spirale bornée).
- **`static/js/canvas.js`** — composant Alpine `canvas()` : pan/zoom, outils
  `select`/`move`/`resize`, rendu **récursif** des nodes (`renderComponent`), arbre fichiers
  **lazy**, nodes éditeur multi-instances, modale réglages, sélection + z-index.
  **Câbles** : layer SVG dans `.world`, `drawCables`/`drawCablesFrom` (DOM impératif),
  re-route à chaque move/resize/spawn/close/init. **Collision** : modèle home/`translate`
  transitoire (`boxOf`/`setTranslate`), `_pushNeighbors`/`_pushOnResize`, reloge final au
  lâcher (là où poussé), `reconcileOverlaps` au boot, spawn via `findFreeSpot`.
  **Impulsions** : mini-toolbar ⚡ (`showToolbar`), `firePulse`/`animateComet`/`glow`.
- **`static/js/editor.js`** — module ESM **CodeMirror 6** (depuis esm.sh) : expose
  `window.MekiEditor.mount()` ; coloration par extension, guides d'indentation,
  word-wrap, thème oneDark, Ctrl+S ; fallback si le CDN ne charge pas.
- **`static/css/canvas.css`** — scrollbar discrète globale ; layer `.cables` néon
  (`.cable-halo`/`.cable-core`, `z-index:-1`) ; transition `.node-wrap` (transform + box-shadow) ;
  mini-toolbar + glows d'impulsion.

Dépendances réseau externes (assumées) : Alpine (unpkg), CodeMirror (esm.sh).

## Invariants à préserver

- Le canvas n'est **jamais vide** (built-in re-seedés) ; les **contraintes** (movable,
  etc.) viennent du **kind**, jamais du JSON persisté.
- Écritures disque **atomiques** ; accès FS **sandboxé** au repo ; entrées numériques
  **finies** et **bornées**.
- `backend/` n'importe jamais `frontend/`.
- **Câbles dérivés** de `source_id` (jamais d'`edges` persistés) ; géométries câbles/collision
  **pures** (testables `node --test`, sans DOM), DOM impératif côté `canvas.js`.
- **Zéro-recouvrement** des nodes maintenu (collision douce au move/resize/spawn + réconciliation
  au boot) ; le `kernel` (`movable:false`) fait office de **mur**.

## Recette : ajouter un node

1. (si besoin) nouveau composant dans `components/primitives.py` + l'ajouter à l'union
   `Component` + `model_rebuild` + export.
2. `nodes/<kind>.py` : `KIND` + `build_<kind>_node(...)` (pose les contraintes).
3. `registry.py` : enregistrer dans `NODE_BUILDERS` (+ `default_canvas()` si built-in,
   + `reconcile_constraints` si nouvelles contraintes ; + `CANONICAL_PARENT_KIND` si le node
   a un parent logique pour ses câbles).
4. Front : si nouveau `type` de composant, ajouter une branche dans
   `renderComponent` (`canvas.js`).
5. **TDD** (modèle/fabrique/endpoint) puis **validation Playwright** (cf. mémoire
   `validate-frontend-with-playwright`). Après seed/schéma : régénérer le `canvas.json`
   live (cf. mémoire `dev-loop-and-canvas-staleness`).
