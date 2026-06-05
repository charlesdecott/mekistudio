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
  montage de l'état git, brique G), **`TerminalComponent`** (`terminal_id`/`shell`/`cols`/`rows` —
  identité d'une session terminal, scrollback hors canvas.json, brique I). `Component` = l'union ;
  `iter_components(c)` parcourt l'arbre.
- **`nodes/`** — fabriques + registre. `kernel.py`, `gitbranch.py`, `file_explorer.py`,
  `file_editor.py`, `chat.py`, `folder.py` exposent chacun `KIND` + `build_*_node(...)`.
  `registry.py` : `NODE_BUILDERS`, `build_node`, `default_canvas()` (built-in = **kernel → git →
  { chat, subcanvas → explorateur }**), `reconcile_constraints(state)`. **Parentage des câbles** : par KIND
  (`CANONICAL_PARENT_KIND`/`canonical_parent_id`) pour kernel/git/chat/explorateur ; **path-aware**
  (préfixe de chemin) pour `folder`/`fileeditor` via `node_effective_path` + `derive_source_id` +
  le module **pur** `parenting.py` (`is_prefix`, `longest_prefix_id`). `reconcile_source_links(state)`
  applique les deux (idempotent, déterministe) et **migre** les built-in de mauvais kind
  (chat/explorateur encore reliés au kernel → git).
- **`git.py`** — état git **lecture seule** (brique G) : `branch_info(root)` → `{branch, detached,
  dirty, ahead, behind}` via subprocess git **non mutant**, `cwd=root`, `timeout`, **tolérant**
  (hors repo / git absent → `branch=None`, jamais d'exception). `ahead/behind` calculés en LOCAL.
- **`bootstrap.py`** — `ensure_meki_dir` (+ `_ensure_builtin_nodes` qui rajoute les built-in
  manquants — dont la node git et le subcanvas — puis `reconcile_source_links`) ; `load_canvas`
  (corrupt-safe ; `reconcile_constraints` puis `reconcile_source_links`) ; `save_canvas`/`_write_json`
  (atomique). **Migration `subcanvas` automatique** : un canvas antérieur à la brique H reçoit la node
  subcanvas à l'injection ; `reconcile_source_links` re-parent l'explorateur (git → subcanvas).
- **`fs.py`** — accès fichiers **sandboxé** au repo : `list_dir(root, rel, excludes)`,
  `read_file` (garde binaire/taille `MAX_FILE_BYTES`/UTF-8), `write_file` (fichier
  existant, atomique), `is_file_in_root`.
- **`chat/`** — backend du node chat (bridge SDK détaché, manager `app.state`, store, hooks/guard).
- **`terminal/`** (brique I) — backend du node terminal, **calque `chat/`** mais pilote un **PTY**
  (pywinpty) : `ring.py` (`ScrollbackRing` **pur** — seq monotone + éviction bornée), `store.py`
  (`TerminalStore` — `scrollback.txt`+`meta.json`, `newline=""` pour préserver les `\r\n` du PTY),
  `bridge.py` (`TerminalBridge` détaché : spawn PowerShell, **thread lecteur** bloquant qui poste vers
  la boucle via `call_soon_threadsafe` → **zéro verrou**, broadcast non bloquant + drop, attach/replay,
  persistance débouncée, respawn d'un shell frais après `exit`), `manager.py` (`TerminalManager` dans
  `app.state`), `options.py` (`build_spawn` : PowerShell réel, cwd=repo). Sortie relayée en **`str`**
  (pas de base64).

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
| `WS /ws/chat/{conversation_id}` | flux temps réel du node chat (détaché, replay) |
| `WS /ws/term/{terminal_id}` | flux temps réel du node terminal — `attach{since_seq}`/`input`/`resize` → `output`/`attached`/`exit` (brique I) |

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
- **`static/js/zonelayout.js`** — géométrie **pure** de placement (`window.MekiZoneLayout`, testé
  `node --test`, brique G) : `radialLayout` (arbre RADIAL : racine au centre, dossiers en rayons vers
  l'extérieur — chaîne droite, fourche en cône ; enfants triés par `sortKey`=chemin → reproductible),
  `packAround` (range les fichiers en ANNEAU autour de la tuile 📁), `freestAngle`, et `solve`/
  `packOutward` (réserve, non câblés). La dé-collision est dans `territories.js` (`separatePolys`, MTV).
- **`static/js/subcanvas.js`** — géométrie **pure** du cadre `subcanvas` (`window.MekiSubcanvas`,
  testé `node --test`, brique H) : `descendants(links, rootId)` où `links` est `[{id, source}]`
  (ids descendants transitifs, exclut la racine) et `derivedBounds(boxes, {pad, titleH})` où `boxes`
  est `[{x,y,w,h}]` (bounding-box englobante + pad sur les 4 côtés + bande titre `titleH` réservée
  en haut → position/taille du cadre, ou null). Consommé par `canvas.js` `_sizeSubcanvas()`, appelé
  en fin de `relayoutZones`. Les descendants sont **exclus** de la collision principale
  (`reconcileOverlaps` + listes d'obstacles drag/resize) via `_containedIds()` (dérivé de l'arbre
  `source_id`) ; replié → classe `contained-hidden` sur les descendants ; le cadre participe comme
  **une seule boîte**.
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
  **Réduire/agrandir** (`collapsed`) : `makeCollapseToggle`/`toggleCollapse` (git + dossier +
  subcanvas). **Cadre `subcanvas`** (brique H) : `_sizeSubcanvas()` (appelé en fin de
  `relayoutZones`) calcule les bornes dérivées via `MekiSubcanvas.derivedBounds` et les applique ;
  les descendants sont **exclus** de `reconcileOverlaps` et des listes d'obstacles via `_containedIds()`
  (dérivé de l'arbre `source_id`) ; réduction → `contained-hidden` sur les descendants, câbles/territories internes
  sautés ; le câble `git → subcanvas` est externe, `subcanvas → explorateur` est interne.
  **Node git** : `refreshGit` (charge `/api/git/branch` au boot et sur `meki:turn-end`).
  **Placement par ARBRE RADIAL (node-zones)** : chaque dossier est une *node-zone* (tuile 📁 au centre,
  fichiers directs en ANNEAU via `packAround`, `folderBlobCorners` inclut la tuile). `relayoutZones`
  (re)dispose tout à chaque changement : (1) `_reconcileFileParents` rattache chaque fichier à son
  dossier le plus profond (MÊME règle que `reconcile_source_links` serveur → bonne zone + cohérence
  live/reload) ; (2) `MekiZoneLayout.radialLayout` (explorateur racine épinglée ancrée sur son HAUT
  stable, dossiers en rayons) ; (3) `packAround` avec une taille de fichier CANONIQUE (indépendante de
  la mesure live instable) ; (4) `MekiTerritories.separatePolys` (MTV) garantit le VIDE entre blobs
  dessinés. **Déterministe → 0 chevauchement + stable au reload** ; mouvement animé (transition CSS),
  deadband anti-jitter. `editorSpawnPos(anchorWrap)` ne sert qu'à l'init d'un nouveau node.
  Les câbles backbone (bleu/ambre) **contournent les zones tierces** ; les câbles fichiers
  (vert) restent courts dans leur zone. `fitView` **auto-zoome** seulement si ça déborde (tout voir).
  **Comète qui matérialise les dossiers** : à l'auto-spawn, les nouveaux
  dossiers naissent invisibles (`_materializingDepth`/`spawning`) et `pulseTo` les **révèle + trace leur
  câble** le long du chemin (comme les fichiers ; spawn entièrement en try/finally → jamais bloqué invisible).
- **`static/js/editor.js`** — module ESM **CodeMirror 6** (depuis esm.sh) : expose
  `window.MekiEditor.mount()` ; coloration par extension, guides d'indentation,
  word-wrap, thème oneDark, Ctrl+S ; fallback si le CDN ne charge pas.
- **`static/js/terminal-view.js`** (brique I) — vue du node terminal, expose
  `window.MekiTerminal.mount(host, terminal_id, comp) → {el, destroy}` : **xterm.js** + **FitAddon**
  (UMD **vendorés** dans `static/vendor/`, `window.Terminal`/`FitAddon`), WebSocket `/ws/term`
  (generation guard, backoff, `attach{since_seq}` au (re)connect), clavier → `input`,
  `ResizeObserver` → `resize`, **démarrage différé en rAF** (le host doit être dimensionné pour
  `fit()`). `canvas.js` ajoute la branche `terminal` dans `renderComponent` (`mountTerminal`,
  indexé `_termViews`, détruit au re-render/`rerenderNode` comme `_chatViews`).
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
- **Cadre `subcanvas` = bornes dérivées** (brique H) : la géométrie du cadre n'est JAMAIS persistée
  comme vérité — elle est recalculée à chaque `relayoutZones` à partir de la bounding-box du sous-arbre
  (descendants via `MekiSubcanvas.descendants`). Les coordonnées des descendants restent **absolues** ;
  le cadre enveloppe exactement son sous-arbre. La collision principale ne voit que le cadre (une boîte),
  pas ses descendants (exclus via `_containedIds()`, dérivé de l'arbre `source_id`).
- **Zéro-recouvrement** des zones maintenu : dé-collision par polygones `MekiTerritories.separatePolys`
  (MTV, VIDE garanti entre blobs dessinés) + collision douce au move/resize/spawn + réconciliation au boot ; le
  `kernel` (`movable:false`) fait office de **mur**. Les nodes **se ré-arrangent en douceur** (animé,
  transition CSS) — jamais de saut/clignotement.
- **Terminal détaché = PTY hors canvas.json** (brique I) : le `terminal_id` est persisté, **pas** le
  scrollback (vit dans `.mekistudio/terminals/<id>/`, comme les messages du chat). Le process PTY vit
  dans `app.state` (survit au reload de page) mais **meurt avec le serveur** ; au reattach, seul le
  **scrollback texte** est rejoué puis un **shell frais** est relancé. Toute mutation d'état du bridge
  se fait **sur la boucle asyncio** (le thread lecteur ne fait que poster via `call_soon_threadsafe`).

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
