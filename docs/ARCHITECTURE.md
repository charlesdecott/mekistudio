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
  `ephemeral`/`expires_at_ms` (F3), **`path`** (chemin d'un node dossier, brique G) /
  **`collapsed`** (node réduit), `root: NodeComponent`), `CanvasState` (schema_version,
  `nodes: list[Node]`, `edges: list[dict]` **réservé/inutilisé**, viewport). Les **câbles sont
  dérivés** de `source_id`, pas stockés.
- **`components/`** — primitives Pydantic en **union discriminée** sur `type` :
  `NodeComponent`, `LayoutComponent`, `HeaderComponent` (niv. 1–4), `FileTreeComponent`
  (`root_path`, `excludes`, **`compact_chain`** = compaction des dossiers-en-nodes),
  `EditorComponent` (`file_path`), `ChatComponent` (F3b), **`GitBranchComponent`** (point de
  montage de l'état git, brique G). `Component` = l'union ; `iter_components(c)` parcourt l'arbre.
- **`nodes/`** — fabriques + registre. `kernel.py`, `gitbranch.py`, `file_explorer.py`,
  `file_editor.py`, `chat.py`, `folder.py` exposent chacun `KIND` + `build_*_node(...)`.
  `registry.py` : `NODE_BUILDERS`, `build_node`, `default_canvas()` (built-in = **kernel → git →
  { chat, explorateur }**), `reconcile_constraints(state)`. **Parentage des câbles** : par KIND
  (`CANONICAL_PARENT_KIND`/`canonical_parent_id`) pour kernel/git/chat/explorateur ; **path-aware**
  (préfixe de chemin) pour `folder`/`fileeditor` via `node_effective_path` + `derive_source_id` +
  le module **pur** `parenting.py` (`is_prefix`, `longest_prefix_id`). `reconcile_source_links(state)`
  applique les deux (idempotent, déterministe) et **migre** les built-in de mauvais kind
  (chat/explorateur encore reliés au kernel → git).
- **`git.py`** — état git **lecture seule** (brique G) : `branch_info(root)` → `{branch, detached,
  dirty, ahead, behind}` via subprocess git **non mutant**, `cwd=root`, `timeout`, **tolérant**
  (hors repo / git absent → `branch=None`, jamais d'exception). `ahead/behind` calculés en LOCAL.
- **`bootstrap.py`** — `ensure_meki_dir` (+ `_ensure_builtin_nodes` qui rajoute les built-in
  manquants — dont la node git — puis `reconcile_source_links`) ; `load_canvas` (corrupt-safe ;
  `reconcile_constraints` puis `reconcile_source_links`) ; `save_canvas`/`_write_json` (atomique).
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
| `GET /api/canvas` | `CanvasState` (purge des éphémères TTL expirés **et** des nodes dossier éphémères sans enfant, fixpoint — brique G) |
| `POST /api/canvas/nodes` | **crée** un node (kind, x, y, `path` pour `folder` ; `source_id` **dérivé serveur** path-aware ou par kind, override optionnel) |
| `DELETE /api/canvas/nodes/{id}` | **supprime** un node (built-in protégés → 422 ; git inclus) |
| `POST /api/canvas/nodes/{id}` | déplace/redimensionne + **`collapsed`** (réduire/agrandir) |
| `POST /api/canvas/nodes/{id}/open` | ouvre un fichier dans un node éditeur |
| `POST /api/canvas/nodes/{id}/pin` | épingle un node éphémère (éditeur F3 / dossier) → permanent |
| `POST /api/canvas/nodes/{id}/settings` | réglages (`excludes`, **`compact_chain`** explorateur ; `spawn_*` chat) |
| `GET /api/git/branch` | état git lecture seule (brique G) |
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
- **`static/js/folders.js`** — géométrie **pure** des dossiers-en-nodes (`window.MekiFolders`, testée
  `node --test`, brique G) : `dirOf`, `ancestors`, `desiredFolders(openFiles, {compact})` (chaîne
  complète = union des ancêtres ; compacte = fusion des dossiers à enfant unique, split au branchement).
- **`static/js/git-node.js`** — rendu **pur** de la node git (`window.MekiGitNode`, testé `node --test`) :
  `fmtTitle`/`fmtDetail` (⎇ branche · ↑ahead ↓behind · ● modifs), `render(el, info)`.
- **`static/js/chat-impulses.js`** — mapping **pur** (`window.MekiImpulses`, testé `node --test`) :
  `impulseFor(ev)` transforme un event wire (`tool_result` enrichi par `{name, file_path}` via
  `toolsById`, `turn_end`, `hook_fired`) en **intention** `{kind:'comet'|'glow', target:{by:'file'|
  'kind', value}, level, dismissable?, fallback?}`. `canvas.js` la résout et anime. Les hooks Claude
  déclenchent ainsi les impulsions (brique F1+F2).
- **`static/js/canvas.js`** — composant Alpine `canvas()` : pan/zoom, outils
  `select`/`move`/`resize`, rendu **récursif** des nodes (`renderComponent`), arbre fichiers
  **lazy**, nodes éditeur multi-instances, modale réglages, sélection + z-index.
  **Câbles** : layer SVG dans `.world`, `drawCables`/`drawCablesFrom` (DOM impératif),
  re-route à chaque move/resize/spawn/close/init. **Collision** : modèle home/`translate`
  transitoire (`boxOf`/`setTranslate`), `_pushNeighbors`/`_pushOnResize`, reloge final au
  lâcher (là où poussé), `reconcileOverlaps` au boot, spawn via `findFreeSpot`.
  **Impulsions** : mini-toolbar ⚡ (`showToolbar`), `firePulse`/`pulseTo`/`animateComet`/`glow`
  (comètes **concurrentes** via `_activePulses`). **Hooks → impulsions** (F1+F2) : écoute
  `meki:impulse` (dispatché par `chat-view.js`), `applyIntent` résout la cible (éditeur par
  `data-file` via `fileOfComponent`, sinon explorateur/chat par `data-kind`) et anime comète/glow ;
  glow **persistant** (Stop/Notification) éteint au clic (`glowDismissable`).
  **Dossiers-en-nodes** (brique G) : `_ensureFolderChain`/`reconcileFolderNodes` (matérialisent la
  chaîne de dossiers d'un fichier ouvert via `MekiFolders`), `_createFolderNode`/`_removeFolderNode`,
  `editorSpawnPos(anchorWrap)` ancré sur la node dossier (regroupement + câbles dégagés),
  `_findFolderForPath`/`_nearestFolderAnchor`, **masquage dérivé** (`fs-claimed` : un dossier de
  l'arbre qui a sa node est masqué), sortie manuelle (clic-droit → `openFolderAsNode`), fermeture
  non destructive (`closeFolderNode`, enfants rebranchés au grand-parent ; shift = cascade).
  **Réduire/agrandir** (`collapsed`) : `makeCollapseToggle`/`toggleCollapse` (git + dossier).
  **Node git** : `refreshGit` (charge `/api/git/branch` au boot et sur `meki:turn-end`).
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
- **Parentage path-aware** (brique G) : le parent d'un node `folder`/`fileeditor` = le node
  (explorateur ∪ dossiers) au **plus long préfixe de chemin** ; le reste par kind. `reconcile_source_links`
  est la source de vérité (idempotent, déterministe) — un node dossier supprimé voit ses enfants
  rebranchés automatiquement au reload.
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
