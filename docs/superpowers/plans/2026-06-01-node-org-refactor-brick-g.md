# Brique G — Plan d'implémentation (refacto organisation des nodes)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development
> ou exécution inline TDD. Étapes en cases à cocher.

**Goal:** Réorganiser la hiérarchie des nodes (`kernel→git→{chat,explorateur}`) et
introduire les dossiers en nodes (chaîne par chemin, `source_id` path-aware,
cycle de vie compté-référence, placement F3 ancré), avec capacité réduire/agrandir.

**Architecture:** Câbles toujours dérivés de `Node.source_id` ; le parentage
devient **path-aware** (préfixe de chemin) en plus du parentage par kind. Le cœur
est une **fonction pure** de re-parentage par préfixe, testée à part. Front en DOM
impératif (placement réutilisant la géométrie pure existante).

**Tech Stack:** Python 3.11+ (`from __future__ import annotations`, Pydantic v2,
pathlib), FastAPI, Alpine.js, modules JS purs testés `node --test`, pytest, uv,
Playwright (scripts Node).

Réf : `docs/superpowers/specs/2026-06-01-node-org-refactor-brick-g-design.md`.

---

## Fichiers touchés

**Backend (créés)** : `backend/nodes/parenting.py` (pur, préfixe), `backend/nodes/
gitbranch.py`, `backend/nodes/folder.py`, `backend/git.py`, `frontend/routes/git.py`.
**Backend (modifiés)** : `backend/models.py` (+`path`,+`collapsed`),
`backend/components/primitives.py` (+`GitBranchComponent`), `backend/nodes/
registry.py` (registre + CANONICAL_PARENT_KIND + reconcile path-aware + default_canvas),
`backend/nodes/__init__.py`, `frontend/routes/canvas.py` (NodeCreate.path, create_node
path-aware, get_canvas purge folders, update_node collapsed), `frontend/app.py`
(+git router).
**Front (modifiés)** : `frontend/static/js/folders.js` (créé, pur : compaction +
préfixe), `frontend/static/js/canvas.js` (folder nodes, placement ancré, reconcile
dossiers, masquage dérivé, collapsed, git refresh), `frontend/static/js/git-node.js`
(créé, rendu/refresh), `frontend/templates/canvas.html`, `frontend/static/css/canvas.css`.
**Tests** : `tests/unit/test_parenting.py`, `test_git.py`, extensions de
`test_nodes.py`/`test_app.py`/`test_bootstrap.py`/`test_components.py` ; modules purs
`folders.js`/`parenting`-JS via `node --test` ; scripts `scripts/pw-g-*.mjs`.

---

# PHASE 1 — G1 : node « branch git » + re-parentage + migration

### Task 1.1 : `Node.path` + `Node.collapsed`

**Files:** Modify `mekistudio/backend/models.py`. Test `tests/unit/test_models.py`.

- [ ] **Step 1 — test**
```python
def test_node_path_and_collapsed_defaults():
    from mekistudio.backend.nodes import build_kernel_node
    n = build_kernel_node()
    assert n.path is None and n.collapsed is False
```
- [ ] **Step 2** run → FAIL (attribut absent).
- [ ] **Step 3** — dans `Node`, après `expires_at_ms` :
```python
    # G : dossiers en nodes -> chemin posix du dossier (None sinon) ; collapsed = node réduit (barre de titre seule).
    path: str | None = None
    collapsed: bool = False
```
- [ ] **Step 4** run → PASS. **Step 5** commit `feat(models): Node.path + Node.collapsed (brique G)`.

### Task 1.2 : `GitBranchComponent`

**Files:** Modify `backend/components/primitives.py`, `__init__.py`. Test `tests/unit/test_components.py`.

- [ ] **Step 1 — test** : composant parse via l'union (`type="gitbranch"`), défauts.
```python
def test_gitbranch_component():
    from mekistudio.backend.components import GitBranchComponent
    c = GitBranchComponent()
    assert c.type == "gitbranch"
```
- [ ] **Step 2** FAIL. **Step 3** — ajouter la primitive (mount-point ; données chargées par le front) :
```python
class GitBranchComponent(ComponentBase):
    """Affiche l'état git (branche/ahead/behind/dirty). Point de montage : les
    données ne sont PAS dans canvas.json — le front les charge via /api/git/branch."""
    type: Literal["gitbranch"] = "gitbranch"
```
Ajouter à l'`Union` `Component` + exports `__init__.py`. **Step 4** PASS. **Step 5** commit.

### Task 1.3 : endpoint git (pur backend)

**Files:** Create `backend/git.py`. Test `tests/unit/test_git.py`.

- [ ] **Step 1 — test** (le repo de test EST un repo git) :
```python
def test_branch_info_real_repo(tmp_path):
    import subprocess
    subprocess.run(["git","init","-q"], cwd=tmp_path, check=True)
    subprocess.run(["git","config","user.email","t@t"], cwd=tmp_path, check=True)
    subprocess.run(["git","config","user.name","t"], cwd=tmp_path, check=True)
    (tmp_path/"a.txt").write_text("x")
    subprocess.run(["git","add","-A"], cwd=tmp_path, check=True)
    subprocess.run(["git","commit","-qm","init"], cwd=tmp_path, check=True)
    from mekistudio.backend.git import branch_info
    info = branch_info(tmp_path)
    assert info["branch"] in ("main","master") and info["dirty"] == 0
    (tmp_path/"b.txt").write_text("y")
    assert branch_info(tmp_path)["dirty"] == 1

def test_branch_info_non_git(tmp_path):
    from mekistudio.backend.git import branch_info
    assert branch_info(tmp_path)["branch"] is None  # tolérant, pas d'exception
```
- [ ] **Step 2** FAIL. **Step 3** — implémenter `branch_info(root: Path) -> dict`
  (subprocess `git`, `cwd=root`, `timeout=5`, lecture seule) :
  - `branch` = `git rev-parse --abbrev-ref HEAD` (`"HEAD"` ⇒ `detached=True`) ;
  - `dirty` = nb lignes non vides de `git status --porcelain` ;
  - `behind, ahead` = `git rev-list --left-right --count @{upstream}...HEAD`
    (gauche=behind, droite=ahead) si returncode 0 et sortie non vide, sinon `None` ;
  - tout `FileNotFoundError`/`SubprocessError`/returncode!=0 sur `rev-parse` ⇒
    `{"branch":None,"detached":False,"dirty":None,"ahead":None,"behind":None}`.
- [ ] **Step 4** PASS. **Step 5** commit.

### Task 1.4 : route `GET /api/git/branch`

**Files:** Create `frontend/routes/git.py`. Modify `frontend/app.py`. Test `tests/unit/test_app.py`.

- [ ] **Step 1 — test** via TestClient : `GET /api/git/branch` 200 + clés
  `branch/ahead/behind/dirty/detached`.
- [ ] **Step 2** FAIL. **Step 3** — router `@router.get("/api/git/branch")` qui
  lit `request.app.state.repo_root` et renvoie `git.branch_info(root)`. `app.include_router(git.router)`.
- [ ] **Step 4** PASS. **Step 5** commit.

### Task 1.5 : node gitbranch (builder + registre + topologie + migration)

**Files:** Create `backend/nodes/gitbranch.py`. Modify `registry.py`, `nodes/__init__.py`.
Test `tests/unit/test_nodes.py`, `test_bootstrap.py`.

- [ ] **Step 1 — tests** :
```python
def test_default_canvas_git_topology():
    from mekistudio.backend.nodes import default_canvas
    s = default_canvas()
    by = {n.kind: n for n in s.nodes}
    assert set(by) == {"kernel","gitbranch","fileexplorer","chat"}
    assert by["gitbranch"].source_id == by["kernel"].id
    assert by["chat"].source_id == by["gitbranch"].id
    assert by["fileexplorer"].source_id == by["gitbranch"].id

def test_migration_reparents_chat_explorer_to_git():
    # canvas legacy : chat & explorateur pendent au kernel, pas de node git
    from mekistudio.backend.models import CanvasState
    from mekistudio.backend.nodes import build_kernel_node, build_chat_node, build_file_explorer_node, reconcile_source_links
    from mekistudio.backend.nodes import gitbranch
    k=build_kernel_node(); c=build_chat_node(); e=build_file_explorer_node()
    c.source_id=k.id; e.source_id=k.id
    g=gitbranch.build_gitbranch_node(); g.source_id=k.id
    s=CanvasState(nodes=[k,g,c,e])
    reconcile_source_links(s)
    by={n.kind:n for n in s.nodes}
    assert by["chat"].source_id==by["gitbranch"].id   # re-pointé malgré parent existant (mauvais kind)
    assert by["fileexplorer"].source_id==by["gitbranch"].id
```
- [ ] **Step 2** FAIL. **Step 3** :
  - `gitbranch.py` : `KIND="gitbranch"`, `build_gitbranch_node(x=0.0, y=240.0)` →
    `Node(kind, x, y, w=240, h=120, configurable=False, root=NodeComponent[Layout[
    Header(level=2,"⎇"), GitBranchComponent()]])`.
  - `registry.py` : importer `gitbranch` ; ajouter au `NODE_BUILDERS` ; `CANONICAL_PARENT_KIND`
    → `{gitbranch:kernel, fileexplorer:gitbranch, chat:gitbranch, fileeditor:fileexplorer}` ;
    `default_canvas()` seede `k, g(source=k), e(source=g), c(source=g)` avec positions
    (chat `-440,240`, explorateur `300,240`).
  - `reconcile_source_links` : pour les kinds kind-based, re-dériver aussi quand le
    parent courant existe mais `kind != CANONICAL_PARENT_KIND[node.kind]` (migration).
    (La généralisation path-aware complète arrive en Phase 2 ; ici on ajoute juste la
    règle « mauvais kind » pour les built-ins.)
  - exports `__init__.py` (+ `GITBRANCH_KIND`, `build_gitbranch_node`).
  - `_BUILTIN_KINDS` (routes/canvas.py) inclut désormais `gitbranch` (dérivé de
    `default_canvas()` ⇒ automatique).
- [ ] **Step 4** run `uv run pytest tests/unit/test_nodes.py tests/unit/test_bootstrap.py -q` → PASS.
- [ ] **Step 5** commit `feat(brique G): node gitbranch + re-parentage chat/explorateur (migration)`.

### Task 1.6 : rendu front node git + refresh + réduire

**Files:** Create `frontend/static/js/git-node.js`. Modify `canvas.js`, `canvas.html`, `canvas.css`.

- [ ] **Step 1** — `renderComponent` branche `type==='gitbranch'` → conteneur
  `.cmp-gitbranch` (barre `⎇ <branche>` + ligne `↑a ↓b · ● n`). `git-node.js` expose
  `window.MekiGitNode = { render(el, info), fmt(info) }` (pur, testé `node --test`
  pour `fmt` : `{branch:'main',ahead:2,behind:0,dirty:3}` → texte attendu ;
  `branch:null` → « (pas un repo git) »).
- [ ] **Step 2** — `canvas.js` : `refreshGit()` = `fetch('/api/git/branch')` →
  `MekiGitNode.render`. Appelé : (a) après le 1er rendu du canvas ; (b) sur l'event
  `turn_end` (là où les impulsions F1+F2 écoutent déjà). Optionnel : `pulseTo(chatId, gitId,'soft')` avant le refresh.
- [ ] **Step 3** — capacité **réduire** générique : bouton `▾/▸` dans l'en-tête des
  nodes `collapsed`-aware (git + dossier). Clic → toggle `node.collapsed`, masque le
  corps (classe CSS `.collapsed`), `POST /api/canvas/nodes/{id}` `{collapsed}`. Au
  rendu, applique `node.collapsed`. (Voir Task 4.x pour le dossier ; ici on pose le
  mécanisme + l'applique à git.)
- [ ] **Step 4** — `update_node` (routes) accepte `collapsed: bool | None` dans
  `NodeUpdate` et l'applique (pas de contrainte movable/resizable). Test pytest.
- [ ] **Step 5** — Playwright `scripts/pw-g-gitnode.mjs` : la node git affiche une
  branche ; réduire → corps masqué ; agrandir → revient ; 0 erreur console. Commit.

---

# PHASE 2 — Cœur path-aware (fonction pure + reconcile + create)

### Task 2.1 : module pur `parenting.py` (préfixe-segment)

**Files:** Create `backend/nodes/parenting.py`. Test `tests/unit/test_parenting.py`.

- [ ] **Step 1 — tests** :
```python
from mekistudio.backend.nodes.parenting import is_prefix, longest_prefix_id
def test_is_prefix_segment():
    assert is_prefix("docs","docs/superpowers")
    assert is_prefix("docs/superpowers","docs/superpowers")  # égalité
    assert not is_prefix("doc","docs")            # pas un préfixe-segment
    assert is_prefix("", "docs")                  # racine préfixe tout
def test_longest_prefix_editor_vs_folder():
    cand=[("","EXP"),("docs","D"),("docs/superpowers","S")]
    # éditeur dir = "docs/superpowers" -> parent = S (égalité permise)
    assert longest_prefix_id("docs/superpowers",cand,strict=False)=="S"
    # dossier path = "docs/superpowers" -> parent = D (égalité exclue)
    assert longest_prefix_id("docs/superpowers",cand,strict=True)=="D"
    assert longest_prefix_id("docs/superpowers",[("","EXP")],strict=True)=="EXP"
def test_longest_prefix_tiebreak_deterministic():
    cand=[("docs","B"),("docs","A")]
    assert longest_prefix_id("docs/x",cand,strict=True)=="A"  # id min
```
- [ ] **Step 2** FAIL. **Step 3** — implémenter `_segments`, `is_prefix(prefix,path)`,
  `longest_prefix_id(target, candidates, *, strict)` (plus long préfixe ; `strict`
  exclut l'égalité ; tie-break id min ; `None` si aucun). **Step 4** PASS. **Step 5** commit.

### Task 2.2 : reconcile path-aware + effective path

**Files:** Modify `backend/nodes/registry.py`. Test `tests/unit/test_nodes.py`.

- [ ] **Step 1 — tests** : éditeur sous le bon dossier ; chaîne profonde ; idempotence ;
  éditeur non ouvert (file_path vide) → explorateur ; folder strict.
```python
def test_reconcile_path_aware_chain():
    # explorateur + folder docs + folder docs/superpowers + editor docs/superpowers/x.md
    ... construire CanvasState ...
    reconcile_source_links(s); reconcile_source_links(s)  # idempotent
    assert editor.source_id == folder_superpowers.id
    assert folder_superpowers.source_id == folder_docs.id
    assert folder_docs.source_id == explorer.id
```
- [ ] **Step 2** FAIL. **Step 3** — dans `registry.py` :
  - `node_effective_path(node) -> str | None` : `folder` → `node.path or ""` ;
    `fileeditor` → dir du `file_path` de son `EditorComponent` (`""` si racine, `None`
    si vide) ; autres → `None`.
  - `KIND_BASED = {gitbranch, fileexplorer, chat}` ; `PATH_BASED = {folder, fileeditor}`.
  - `reconcile_source_links` :
    * `kernel` → None ;
    * KIND_BASED → `canonical_parent_id` avec règle migration (None/dangling **ou**
      parent de mauvais kind) ;
    * PATH_BASED → `ep=node_effective_path` ; si `None` → `canonical_parent_id` ;
      sinon `candidates = [("", explorer_id)] + [(f.path, f.id) for f folders if f is not node]`,
      `longest_prefix_id(ep, candidates, strict=(node.kind=="folder"))`, fallback
      `canonical_parent_id`.
  - Idempotent, déterministe.
- [ ] **Step 4** PASS (`test_nodes.py`). **Step 5** commit.

### Task 2.3 : `create_node` path-aware (folder.path + dérivation)

**Files:** Modify `frontend/routes/canvas.py`. Test `tests/unit/test_app.py`.

- [ ] **Step 1 — tests** : créer un folder (`kind=folder, path="docs"`) → `path` stocké,
  `source_id` = explorateur ; créer un sous-folder `path="docs/superpowers"` → source_id
  = folder docs ; créer un éditeur avec `source_id=<folder id>` → conservé.
- [ ] **Step 2** FAIL. **Step 3** :
  - `NodeCreate` gagne `path: str | None = None` (borné `max_length=4096`).
  - `create_node` : si `kind=="folder"` → `build_node("folder", x,y, path=body.path or "")`
    et `node.path = body.path or ""`. Override `source_id` si valide ; sinon, pour
    `folder`/`fileeditor`, dériver path-aware (réutiliser la logique reconcile pour ce
    node : construire candidates depuis `state`, `longest_prefix_id`), fallback
    `canonical_parent_id`. (Extraire un helper `derive_source_id(state, node)` réutilisé
    par reconcile et create.)
- [ ] **Step 4** PASS. **Step 5** commit.

### Task 2.4 : purge comptée-référence des dossiers (fixpoint)

**Files:** Modify `frontend/routes/canvas.py` (`get_canvas`). Test `tests/unit/test_app.py`.

- [ ] **Step 1 — tests** : chaîne folder docs→superpowers + éditeur éphémère expiré →
  après GET, l'éditeur **et** les deux dossiers (éphémères, sans enfant) disparaissent
  (fixpoint) ; un dossier **épinglé** (`ephemeral=False`) reste même vide ; un dossier
  éphémère avec un éditeur épinglé vivant reste.
- [ ] **Step 2** FAIL. **Step 3** — dans `get_canvas`, après la purge TTL (`alive`),
  boucle fixpoint : recompter les enfants (`source_id`), retirer tout `folder` éphémère
  à 0 enfant, répéter jusqu'à stabilité ; `save` si changé. **Step 4** PASS. **Step 5** commit.

---

# PHASE 3 — Node dossier (kind, mini-explorateur, masquage, fermeture)

### Task 3.1 : builder folder + enregistrement

**Files:** Create `backend/nodes/folder.py`. Modify `registry.py`, `__init__.py`. Test `test_nodes.py`.

- [ ] **Step 1 — test** : `build_folder_node(path="docs")` → kind `folder`, `path="docs"`,
  contient un `FileTreeComponent(root_path="docs")` + un `HeaderComponent` texte `"docs"`
  (dernier segment), `configurable=True`, non built-in.
- [ ] **Step 2** FAIL. **Step 3** — `folder.py` `KIND="folder"`,
  `build_folder_node(x=0.0, y=0.0, path="")` (header = `path.split("/")[-1] or path or "/"`,
  FileTree `root_path=path`). Enregistrer dans `NODE_BUILDERS` (PAS dans default_canvas →
  pas built-in). **Step 4** PASS. **Step 5** commit.

### Task 3.2 : module pur `folders.js` (compaction + ensemble désiré)

**Files:** Create `frontend/static/js/folders.js`. Test via `node --test` (`folders.js --test` ou test sibling).

- [ ] **Step 1 — tests** (`window.MekiFolders`) :
  - `dirOf("docs/superpowers/specs/foo.md") === "docs/superpowers/specs"` ; racine → `""`.
  - `ancestors("docs/superpowers/specs")` → `["docs","docs/superpowers","docs/superpowers/specs"]`.
  - `desiredFolders(openFiles, {compact:false})` → union des ancêtres de chaque dir.
  - `desiredFolders(["docs/superpowers/specs/foo.md"], {compact:true})` →
    `["docs/superpowers/specs"]` (fusion enfant-unique) ; après ajout de `["docs/IDEAS.md"]`
    → `["docs","docs/superpowers/specs"]` (split au point de branche).
- [ ] **Step 2** FAIL. **Step 3** — implémenter `dirOf`, `ancestors`, `desiredFolders`
  (plein = tous les préfixes de dir ; compact = garder un dossier ssi il contient
  directement un fichier ouvert **ou** a ≥2 enfants gardés — calcul sur l'arbre des dirs).
  Pur, sans DOM. **Step 4** `node --test` PASS. **Step 5** commit.

### Task 3.3 : `reconcileFolderNodes()` + `_findFolderForPath` (front)

**Files:** Modify `canvas.js`, `canvas.html` (script include `folders.js`).

- [ ] **Step 1** — `openFolderPaths()` : dirs des éditeurs ouverts (lecture DOM
  `data-file`). `_compactMode` lu des réglages explorateur (Task 4.3).
- [ ] **Step 2** — `reconcileFolderNodes()` : `desired = MekiFolders.desiredFolders(
  openFiles, {compact:_compactMode})` ∪ paths des folders **épinglés** ; pour chaque
  path désiré sans node → créer (POST `kind=folder,path,ephemeral=true`, placement
  `editorSpawnPos(ancre=parent dossier)`), render ; pour chaque folder **éphémère** hors
  désiré → DELETE + retirer du DOM ; puis `drawCables()`.
- [ ] **Step 3** — `_findFolderForPath(filePath)` : retourne le `.node-wrap[data-kind=
  "folder"]` dont `data-folder` == `dirOf(filePath)` (après `reconcileFolderNodes`).
- [ ] **Step 4** — `renderNode` estampe `dataset.folder` sur les nodes folder.
- [ ] **Step 5** — câbler `reconcileFolderNodes()` au double-clic (`openFileInNewEditor`)
  et à l'auto-spawn (`spawnEphemeralEditor`) **avant** de placer l'éditeur ; l'éditeur est
  créé avec `source_id = folderId`. Commit (validé en Phase 4 Playwright).

### Task 3.4 : sortie manuelle + masquage dérivé

**Files:** Modify `canvas.js` (fsItem/fsExpand).

- [ ] **Step 1** — clic-droit sur une entrée dossier de l'arbre → menu « Sortir en node »
  → POST `kind=folder, path=entry.path, ephemeral=false`, render, `drawCables`.
- [ ] **Step 2** — masquage dérivé : dans `fsItem`/`fsExpand`, masquer toute entrée
  dossier dont le path possède déjà une node `folder` (claim-set lu du DOM
  `.node-wrap[data-kind="folder"] data-folder`). Re-render de l'arbre après création/
  suppression d'un folder. **Step 3** commit.

### Task 3.5 : fermeture non destructive + shift-fermer

**Files:** Modify `canvas.js`.

- [ ] **Step 1** — croix sur node folder → DELETE node ; les enfants survivent (au
  `drawCables`/reload le path-aware les rebranche). Vérifier qu'après suppression d'un
  folder intermédiaire, l'éditeur enfant se rebranche au folder grand-parent (ou explorateur).
- [ ] **Step 2** — `shift`+croix → supprime récursivement les enfants (confirm si éditeur
  non sauvé). **Step 3** commit (validé Playwright Phase 4).

---

# PHASE 4 — Placement F3 ancré + toggle compact + intégration

### Task 4.1 : `editorSpawnPos(anchorWrap)` paramétré

**Files:** Modify `canvas.js`.

- [ ] **Step 1** — signature `editorSpawnPos(anchorWrap = null)` ; si `null` → explorateur
  (compat). Sinon ancre = `anchorWrap` (node dossier) : `exb/exC` calculés sur l'ancre ;
  exclusion de l'ancre du test anti-câble ; câble routé vers le centre de l'ancre.
  Réutilise secteur angulaire + `pathHits` + `collision.isFree/findFreeSpot` inchangés.
- [ ] **Step 2** — `spawnEphemeralEditor`/`openFileInNewEditor` passent
  `_findFolderForPath(path)` comme ancre. **Step 3** commit.

### Task 4.2 : capacité réduire/agrandir sur node dossier

**Files:** Modify `canvas.js`, `canvas.css`.

- [ ] **Step 1** — appliquer le mécanisme `collapsed` (Task 1.6) à la node dossier
  (bouton dans l'en-tête, corps masqué = mini-explorateur caché, barre = nom du dossier).
  **Step 2** commit.

### Task 4.3 : toggle « compacter » dans les réglages explorateur

**Files:** Modify `canvas.html` (modale), `canvas.js` (openSettings/saveSettings),
`routes/canvas.py` (NodeSettings + persistance), `primitives.py` (où stocker le flag).

- [ ] **Step 1 — décision de stockage** : ajouter `compact_chain: bool = False` sur le
  `FileTreeComponent` de l'explorateur principal (réutilise la modale exclusions). Test
  pytest : `POST .../settings {compact_chain:true}` persiste.
- [ ] **Step 2** — modale : case à cocher « Compacter les dossiers (style VSCode) » dans
  la branche `settingsKind!=='chat'` (explorateur). `saveSettings` POST `compact_chain`.
- [ ] **Step 3** — `canvas.js` lit `compact_chain` de l'explorateur au chargement →
  `_compactMode` ; `reconcileFolderNodes` l'utilise ; changer le réglage relance
  `reconcileFolderNodes()`. **Step 4** commit.

### Task 4.4 : suite de tests + Playwright + revue + docs

**Files:** `scripts/pw-g-*.mjs`, docs.

- [ ] **Step 1** — `uv run pytest -q` (tout vert) + `node --test` sur `folders.js`,
  `parenting`-JS, `git-node.js`, + modules existants (régression).
- [ ] **Step 2** — Playwright (viewport reset façon `pw-f3-autospawn`) :
  `pw-g-chain.mjs` (fichier profond → chaîne + éditeur câblé bon dossier),
  `pw-g-autospawn.mjs` (read groupé sous dossier ; 2 fichiers même dossier proches),
  `pw-g-cables-clear.mjs` (0 câble sous une node — réutilise la mesure),
  `pw-g-close.mjs` (fermeture non destructive), `pw-g-compact.mjs` (toggle → fusion),
  `pw-g-gitnode.mjs` (branche + refresh + réduire). Chacun : 0 erreur console.
- [ ] **Step 3** — **revue adversariale** (workflow multi-agents) sur le diff complet ;
  corriger les findings confirmés.
- [ ] **Step 4** — MAJ `docs/ROADMAP.md` (brique G livrée), `docs/ARCHITECTURE.md`
  (path-aware, folder/gitbranch, /api/git/branch, collapsed), `CLAUDE.md` (mention).
- [ ] **Step 5** — commits cohérents ; notifier l'utilisateur que tout est testable.

---

## Self-review du plan

- **Couverture spec** : G1 (Ph1), path-aware (Ph2), dossiers/lifecycle/masquage/
  fermeture (Ph3), placement F3 + compact + réduire (Ph4) + git endpoint (Ph1). ✓
- **Pas de placeholder** : code/critères concrets pour chaque tâche porteuse ;
  positions ajustables notées comme telles. ✓
- **Cohérence des noms** : `derive_source_id`/`longest_prefix_id`/`reconcileFolderNodes`/
  `_findFolderForPath`/`MekiFolders`/`MekiGitNode`/`branch_info` utilisés de façon
  cohérente entre tâches. ✓
- **Risque #1** = reconcile path-aware (Ph2) : isolé, pur, testé avant front. ✓
