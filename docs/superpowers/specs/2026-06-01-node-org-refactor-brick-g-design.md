# Brique G — Refacto de l'organisation des nodes (design)

> Statut : validé en brainstorm (companion visuel) le 2026-06-01. Spec unique
> (tout G), construite en séquence G1 → cœur path-aware → dossiers → placement.

## But

Réorganiser la hiérarchie des nodes du canvas en deux temps :

1. **G1** — insérer une node **« branch git »** entre le kernel et le chat/explorateur :
   `kernel → git → { chat, explorateur }`. La node git affiche la branche
   courante (+ avance/retard remote + modifs locales) et se rafraîchit à la fin
   de tour. Pensée pour grandir vers les worktrees plus tard.
2. **G2** — **dossiers en nodes** : ouvrir un fichier (à la main ou via l'auto-spawn
   F3) matérialise la **chaîne de dossiers** de son chemin en nodes ; les fichiers
   d'un même dossier se regroupent sous leur node dossier. Une node dossier est un
   **mini-explorateur** enraciné sur le sous-chemin, réductible à son nom.

Invariant directeur : **les câbles restent dérivés de `Node.source_id`** — on ne
persiste pas d'edges. Le changement de fond est que `source_id` devient
**path-aware** (parentage par préfixe de chemin) en plus du parentage par kind.

## Décisions (issues du brainstorm)

| Sujet | Décision |
|---|---|
| Découpage | **1 seule spec** (tout G), construite en séquence (voir Ordre). |
| Topologie | `kernel → git → { chat, explorateur }` (chat **et** explorateur re-parentés du kernel vers git). |
| Placement par défaut | Kernel figé à (0,0) ; git en dessous ; chat bas-gauche, explorateur bas-droite. |
| Contenu node git | Branche + `↑ahead ↓behind vs origin` + `● N modifs` (option C). Réductible → `⎇ branche`. |
| Refresh git | **Événementiel** : à la fin de tour du chat (`turn_end`), pas de timer. Calcul **local** (pas de réseau). |
| Forme hiérarchie dossiers | **Chaîne complète** par défaut (un node par segment) + **toggle « compacter »** (style VSCode) dans les réglages de l'explorateur principal. |
| Création des nodes dossier | Automatique (ouverture/lecture d'un fichier matérialise sa chaîne) **et** manuelle (« sortir » un dossier de l'explorateur). |
| « Sort de l'explorateur » | **Masquage dérivé** : l'explorateur masque tout sous-dossier qui possède déjà sa node. Pas d'état stocké. |
| Cycle de vie node dossier | **Compté-référence + épinglable** : affichée ssi ≥1 enfant affiché, sinon purgée — sauf épinglée. Auto = éphémère, manuel/épinglé = permanent (réutilise `ephemeral` + endpoint `pin` + purge de F3). |
| Fermeture explicite | Non destructif : les fichiers survivent et se rebranchent au parent (la règle de préfixe le fait gratuitement). `shift`-fermer = ferme aussi les enfants. |
| UI node dossier | Mini-explorateur (`FileTreeComponent` enraciné), **réductible** au seul nom (comme minimiser une fenêtre). |
| Capacité « réduire » | Générique au niveau du node (`collapsed`) : node git + node dossier (réutilisable ailleurs). |
| Placement F3 | `editorSpawnPos` **paramétré par ancre** = la node dossier du fichier (sinon l'explorateur). Regroupe les fichiers d'un dossier ; câbles dégagés. Placement **au spawn seulement** (pas de relayout). |

## Modèle de données

`Node` (mekistudio/backend/models.py) gagne deux champs :

- `path: str | None = None` — pour les nodes **dossier** : chemin posix relatif au
  repo du dossier (ex. `"docs/superpowers"`). `None` pour les autres kinds.
- `collapsed: bool = False` — état **réduit** (barre de titre seule). Générique.

Les nodes dossier réutilisent **`ephemeral`** (auto-créée = `True`, sortie-à-la-main
ou épinglée = `False`) ; pas de `expires_at_ms` (leur durée de vie est
**comptée-référence**, pas un TTL). L'endpoint `pin` existant met `ephemeral=False`.

Nouveau composant `FolderTreeComponent` ? **Non** : on réutilise
`FileTreeComponent(root_path=<path>)` tel quel (un dossier = un explorateur
enraciné sur un sous-chemin). Le node dossier porte aussi `path` au niveau `Node`
(source de vérité du parentage ; le `root_path` du composant doit l'égaler).

### Path effectif d'un node (pour le parentage par préfixe)

| kind | path effectif |
|---|---|
| `kernel` | — (racine, `source_id=None`) |
| `gitbranch`, `chat`, `fileexplorer` | — (parentage **par kind**, voir ci-dessous) |
| `folder` | `node.path` (ex. `"docs/superpowers"`) |
| `fileeditor` | `dirname(file_path)` (ex. `"docs/superpowers/specs"`), ou `""` si fichier à la racine |

L'explorateur (`fileexplorer`) joue **deux rôles** : node parenté par kind (→ git)
**et** candidat-racine de l'arbre de chemins (path `""`, préfixe de tout).

## Architecture du parentage (`source_id`) — le cœur

`registry.py` aujourd'hui : `source_id` ← `canonical_parent_id(state, kind)` (par
kind) ; `reconcile_source_links` ne répare que `None`/danglant. On généralise.

### Fonction pure `derive_parent_id(node, candidates)` + reconcile path-aware

Règles, dans l'ordre :

1. `kernel` → `source_id = None`.
2. kinds **kind-based** (`gitbranch`, `chat`, `fileexplorer`) → `source_id =
   canonical_parent_id(state, kind)`. **Migration** : on re-dérive aussi quand le
   parent courant existe mais est du **mauvais kind** (ex. chat/explorateur
   pointant encore sur le kernel après l'ajout de git) — pas seulement quand il
   est `None`/danglant.
3. kinds **path-based** (`folder`, `fileeditor`) → `source_id` = id du candidat
   (explorateur ∪ nodes dossier) dont le **path est le plus long préfixe-segment**
   du path effectif du node :
   - éditeur (dir `D`) : préfixe **incluant l'égalité** (`P == D` → le node dossier
     `D` est le parent direct) ; sinon plus proche ancêtre dossier ; sinon explorateur (`""`).
   - dossier (path `F`) : préfixe **strict** (`P != F`, pas d'auto-parentage) ;
     plus proche ancêtre dossier ; sinon explorateur (`""`).

Préfixe = **par segments** (`"docs"` préfixe `"docs/superpowers"` ; `"doc"` ne
l'est pas). Déterministe (tie-break par id stable), **idempotent** (re-exécution
sans changement), **ordre-indépendant** (l'ensemble des candidats est connu
d'avance — pas de souci topologique pour une passe simple).

`CANONICAL_PARENT_KIND` devient :
```
gitbranch     → kernel
fileexplorer  → gitbranch   (changé : était kernel)
chat          → gitbranch   (changé : était kernel)
fileeditor    → fileexplorer  (fallback ; le path-aware prend le dessus s'il y a des dossiers)
folder        → fileexplorer  (fallback ; idem)
```

`default_canvas()` seedé : `kernel`, `gitbranch (source_id=kernel)`,
`fileexplorer (source_id=git)`, `chat (source_id=git)`.

La fonction pure de re-parentage par préfixe est **testée à part** (esprit
`cables.js`/`collision.js`) avant de toucher routes/front : préfixe, plus-long-
préfixe, idempotence, migration, chaîne profonde.

## Node « branch git » (G1)

- Nouveau kind `gitbranch` (`backend/nodes/gitbranch.py`, `KIND="gitbranch"`),
  enregistré dans `NODE_BUILDERS` + `CANONICAL_PARENT_KIND`. Built-in (ajouté aux
  vieux canvas par `_ensure_builtin_nodes`), **non supprimable**, **non
  configurable**, movable/resizable, `collapsed` supporté.
- Position par défaut : sous le kernel (ex. `x=0, y=240`). `default_canvas` place
  ensuite chat et explorateur plus bas (chat `x=-440, y=240` ; explorateur
  `x=300, y=240`) pour le fan-out sous git. (Valeurs affinées à l'implémentation.)
- Composant `GitBranchComponent` (primitive, union discriminée `type="gitbranch"`) :
  champ d'affichage minimal ; les données (branche/ahead/behind/dirty) sont
  **chargées par le front** via un endpoint, **pas** stockées dans canvas.json
  (comme le filetree/chat — l'état git change hors du canvas).
- Endpoint **lecture seule** `GET /api/git/branch` → `{branch, ahead, behind,
  dirty, detached}`. Implémentation `backend/git.py` (subprocess `git`, **sandboxé
  au repo**, jamais d'écriture) :
  - `branch` : `git rev-parse --abbrev-ref HEAD` (`"HEAD"` → `detached=True`).
  - `dirty` : nombre de lignes de `git status --porcelain`.
  - `ahead/behind` : `git rev-list --left-right --count @{upstream}...HEAD` si un
    upstream existe (sinon `ahead=behind=None`) — **local, pas de fetch réseau**.
  - Tolérant : hors repo git / git absent → `{branch:None,...}` (200, pas 500).
- Refresh : le front appelle `GET /api/git/branch` au chargement **et** sur l'event
  `turn_end` (déjà émis par le bridge). Optionnellement, une **impulsion** chat→git
  accompagne le refresh (réutilise `pulseTo`), cohérent avec l'ancien modèle.
- Réductible : `collapsed=True` → la barre de titre `⎇ <branche>` seule.

## Dossiers en nodes (G2)

### Node dossier

- Nouveau kind `folder` (`backend/nodes/folder.py`, `KIND="folder"`),
  `build_folder_node(x, y, path)` → `Node(kind="folder", path=path,
  configurable=True, root=NodeComponent[Layout[Header(level=2, nom du dossier),
  FileTreeComponent(root_path=path)]])`. Non built-in (supprimable).
- Mini-explorateur : réutilise `/api/fs` + l'arbre lazy + `excludes`. Il **masque
  à son tour** les sous-dossiers sortis (masquage dérivé, voir plus bas).
- Réductible (`collapsed`) → nom du dossier seul.

### Création (front) — `reconcileFolderNodes()` déclaratif

Mécanisme unique pour double-clic **et** auto-spawn F3 : après ouverture/fermeture
d'un fichier, le front recalcule l'ensemble **désiré** de nodes dossier et le
diff avec l'existant.

- Ensemble désiré (mode **plein**) = tous les dossiers ancêtres de tous les
  fichiers ouverts (chaque préfixe de segment). Mode **compact** = même ensemble
  puis fusion des dossiers à enfant unique (on garde un dossier ssi il contient
  directement un fichier ouvert **ou** a ≥2 enfants gardés).
- On **ajoute** les nodes dossier manquants (POST `kind=folder`, `path`,
  `ephemeral=true`), placés via `editorSpawnPos(ancre=parent dossier)`.
- On **supprime** les nodes dossier obsolètes **éphémères** (DELETE) ; les
  **épinglés** (sortis à la main) sont préservés même hors de l'ensemble désiré.
- Puis `drawCables()` : les `source_id` re-dérivés par préfixe re-câblent
  automatiquement éditeurs et dossiers (split/fusion « gratuits »).

### Sortie manuelle d'un dossier

Clic-droit sur un dossier de l'arbre (explorateur ou node dossier) → « Sortir en
node » : POST `kind=folder, path, ephemeral=false` (épinglé/permanent), placé,
re-câblé. Pour browser en avance (sans fichier ouvert dedans).

### Masquage dérivé (« retiré de l'explorateur parent »)

À chaque rendu de l'arbre d'un explorateur/node dossier, le front **masque** toute
entrée dossier dont le chemin possède déjà une node `folder` sur le canvas
(claim-set calculé depuis l'état, transient — pas persisté). Fermer la node
dossier → le dossier réapparaît. (Implémenté dans le rendu `fsItem`/`fsExpand`.)

### Cycle de vie (purge comptée-référence)

`GET /api/canvas` gagne, à côté de la purge TTL des éditeurs, une passe **fixpoint**
qui retire toute node `folder` **éphémère** sans enfant vivant (aucun node avec
`source_id == folder.id`). Itère jusqu'à stabilité pour effondrer une chaîne vide
de bas en haut. Les dossiers épinglés (`ephemeral=False`) sont conservés.

### Fermeture explicite

Croix sur une node dossier → DELETE. Les enfants (éditeurs, sous-dossiers)
**survivent** : au prochain `drawCables`/reload, le path-aware les rebranche au
plus proche ancêtre (node dossier parent ou explorateur). `shift`-fermer →
supprime aussi récursivement les enfants (confirmation si éditeurs non sauvés).

## Auto-spawn F3 & placement

- `editorSpawnPos(anchorWrap=null)` : ancre paramétrable. `null`/défaut →
  explorateur (compat). Avec une ancre node dossier → secteur angulaire libre
  autour de **cette** node ; exclut l'ancre du test anti-câble ; route le câble
  vers son centre. Réutilise toute la géométrie pure testée (`pathHits`,
  `collision.isFree/findFreeSpot`).
- `spawnEphemeralEditor(path)` et `openFileInNewEditor(path)` : (1)
  `await reconcileFolderNodes()` pour garantir la chaîne, (2) trouver la node
  dossier du fichier (`_findFolderForPath(path)`), (3) `editorSpawnPos(folderWrap)`,
  (4) créer l'éditeur avec `source_id = folderId`. Dedup par fichier et cap global
  F3 **inchangés**.
- `renderNode` estampe `dataset.folder` (path du dossier) sur les nodes `folder`
  et `dataset.path`/dir sur les éditeurs au besoin, pour les lookups DOM (miroir de
  `dataset.file`).

## Capacité « réduire / agrandir » (générique)

- `Node.collapsed: bool`. Bouton « ▾/▸ » dans l'en-tête des nodes qui le supportent
  (git, dossier). Replié → on masque le corps, on garde la barre de titre ; la
  taille se réduit à l'en-tête. Persisté via `POST /api/canvas/nodes/{id}` (nouveau
  champ accepté) ou un petit endpoint `.../collapse`. État relu au rendu.

## API (résumé des changements)

- `GET /api/git/branch` (nouveau) — état git lecture seule, tolérant.
- `POST /api/canvas/nodes` — `NodeCreate` gagne `path: str | None` (folder) ;
  `create_node` dérive `source_id` **path-aware** pour `folder`/`fileeditor`.
- `GET /api/canvas` — purge comptée-référence des nodes `folder` éphémères vides
  (fixpoint), en plus de la purge TTL.
- `POST /api/canvas/nodes/{id}` (ou `.../collapse`) — accepte `collapsed`.
- `pin` réutilisé pour épingler une node dossier.
- `reconcile_source_links` path-aware (+ migration wrong-kind built-ins).

## Migration des canvas existants

La node git est built-in : `_ensure_builtin_nodes` l'ajoute aux vieux canvas.
`reconcile_source_links` re-pointe chat & explorateur de kernel→git
automatiquement (règle « mauvais kind » de la migration). Vérifié par test
(charger un canvas legacy chat/explorateur→kernel ⇒ après load, →git).

## Tests

- **pytest** :
  - path-aware reconcile : préfixe-segment, plus-long-préfixe (éditeur =, dossier
    strict), idempotence, chaîne profonde, migration wrong-kind.
  - `GET /api/git/branch` : repo git réel (branche connue), hors-repo tolérant.
  - `create_node` folder : path stocké, source_id dérivé ; éditeur sous dossier.
  - purge comptée-référence : chaîne vide effondrée (fixpoint) ; dossier épinglé
    conservé ; éditeur expiré → dossier purgé.
  - `default_canvas`/migration : topologie kernel→git→{chat,explorateur}.
- **modules purs `node --test`** : re-parentage par préfixe (miroir JS de la règle)
  + compaction (ensemble désiré plein vs compact).
- **Playwright** (comme d'habitude : screenshot + console 0 erreur) :
  - ouvrir un fichier profond → chaîne de nodes dossier + éditeur câblé au bon dossier.
  - auto-spawn F3 d'un read → groupé sous son dossier ; 2 fichiers même dossier = proches.
  - **0 câble sous une node** (réutilise le script de mesure existant).
  - fermeture non destructive (éditeur survit, se rebranche).
  - toggle compact (réglages explorateur) → chaîne fusionnée.
  - node git : affiche la branche, se rafraîchit en fin de tour.
  - réduire/agrandir une node (git + dossier).

## Ordre de construction (séquence dans la spec unique)

1. **G1** — node git + composant + endpoint + re-parentage chat/explorateur +
   migration + rendu/réduction. (Petit, fondateur, dérisque le reconcile par kind.)
2. **Cœur path-aware** — `Node.path`, fonction pure de re-parentage par préfixe
   (+ tests purs), `reconcile_source_links` path-aware, `create_node` path-aware.
3. **Node dossier** — kind + builder + mini-explorateur, sortie manuelle, masquage
   dérivé, cycle de vie compté-référence (purge), fermeture non destructive.
4. **Placement F3 + toggle compact + réduire** — `editorSpawnPos` ancré,
   `reconcileFolderNodes` (plein/compact), `_findFolderForPath`, toggle dans les
   réglages explorateur, capacité `collapsed` générique.

Chaque étape : TDD, modules purs testés `node --test`, validation Playwright,
revue. Commits cohérents sur `main` (convention projet).

## Hors périmètre (différé)

- Worktrees (la node git est conçue pour, mais pas implémentée ici).
- Fetch/push/pull réseau, graphe de commits, diff (anciens nodes git riches).
- Relayout automatique des clusters (placement au spawn seulement).
- QCM/`ask_user`, write/Edit/Bash (autres briques).
