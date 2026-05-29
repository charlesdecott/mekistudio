# mekistudio-2 — Walking Skeleton (Jalon 1)

**Date**: 2026-05-29
**Statut**: validé (design), prêt pour le plan d'implémentation

## Contexte

`mekistudio-2` est une réécriture *from scratch* de mekistudio, en pur Python,
qui tourne directement sur Windows **sans Docker**. On reconstruit petit à
petit : ce premier jalon ne fait qu'amener à `mekistudio run` dans un repo git
déjà initialisé, ce qui crée `.mekistudio/` si absent et ouvre le canvas
principal (vide). Les nodes et le backend seront ajoutés incrémentalement
ensuite.

Deux codebases existantes servent de référence (documentées, jamais copiées
ligne à ligne) :

- `C:\sandbox-dev\workspace\mekistudio` — le projet d'origine.
- `C:\sandbox-dev\workspace\mekistudio-lego` — un fork qui repense les nodes du
  canvas en briques modulaires (`backend/canvas/bricks/` + `nodes/` +
  `registry`/`converter`/`hot_reload`).

Les deux partagent la stack : uv + Typer (CLI) + FastAPI/uvicorn + Jinja +
Alpine.js + Claude Agent SDK + pytest.

### Note importante

mekistudio (origine) supporte **déjà** un mode natif sans Docker
(`serve --no-sandbox` → `_serve_native()`). Docker n'est que le mode par défaut.
mekistudio-2 ne reprend pas ce code : on repart d'une page blanche et on met
Docker/sandbox totalement de côté pour l'instant.

## Objectif du Jalon 1

Une boucle qui tourne : `mekistudio run` dans un repo git → `.mekistudio/`
bootstrap → navigateur ouvert sur un canvas infini vide (pan/zoom). Rien de
plus. Code écrit frais ; coutures légères pour brancher le premier node en
drop-in plus tard.

## Architecture

Layout calqué sur l'actuel. Règle de layering conservée : `backend/` n'importe
jamais `frontend/` ; `packages/cli.py` est le seul point qui câble les deux.

```
mekistudio-2/
  pyproject.toml              # uv ; entry point: mekistudio = "packages.cli:app"
  README.md  .gitignore
  docs/old/{mekistudio,mekistudio-lego}/…   # docs de référence (Phase 2)
  packages/
    cli.py                    # Typer ; SEUL câblage back+front
    backend/
      __init__.py
      paths.py                # racine repo + chemins .mekistudio/
      bootstrap.py            # crée .mekistudio/ si absent
      models.py               # Pydantic v2 : Manifest, CanvasState
    frontend/
      __init__.py
      app.py                  # create_app() FastAPI
      routes/
        __init__.py
        canvas.py             # GET / ; GET /healthz ; GET+POST viewport
      templates/canvas.html
      static/js/canvas.js     # Alpine : pan/zoom infini
      static/css/canvas.css
  tests/unit/
    test_bootstrap.py
    test_app.py
```

### Conventions Python (reprises du projet d'origine)

- Python 3.11+, `from __future__ import annotations` en tête de chaque fichier.
- Pydantic v2 ; `model_dump(mode="json")` pour la sérialisation.
- `pathlib.Path` uniquement — jamais `os.path`.
- Commentaires : le **pourquoi** des invariants non-évidents, jamais le quoi.

## Composants

### `packages/backend/paths.py`

- `find_repo_root(start: Path) -> Path` : remonte depuis `start` jusqu'à trouver
  un dossier `.git`. Si rien trouvé, renvoie `start` (le cwd) — l'appelant
  affiche un message amical mais ne crash pas.
- Helpers de chemins : `meki_dir(root)` → `root/.mekistudio`,
  `manifest_path(root)`, `canvas_path(root)`.

### `packages/backend/models.py`

Pydantic v2, extensibles :

- `Manifest` : `id: str` (uuid4), `name: str`, `schema_version: int = 1`.
- `Viewport` : `x: float = 0`, `y: float = 0`, `zoom: float = 1`.
- `CanvasState` : `schema_version: int = 1`, `nodes: list[dict] = []`,
  `edges: list[dict] = []`, `viewport: Viewport = Viewport()`.

`nodes`/`edges` restent en `list[dict]` au Jalon 1 — c'est le seam : typer les
nodes viendra quand on branchera le premier vrai node.

### `packages/backend/bootstrap.py`

- `ensure_meki_dir(root: Path) -> Manifest` :
  - crée `.mekistudio/` si absent ;
  - si `manifest.json` absent → écrit un `Manifest` neuf (`name` = nom du dossier
    racine, `id` = uuid4) ; sinon le charge.
  - si `canvas.json` absent → écrit un `CanvasState` vide par défaut.
  - **Idempotent** : ne réécrit jamais un fichier existant valide.
- `load_canvas(root) -> CanvasState` / `save_canvas(root, state)`.
- **Sécurité boot** : tout chargement parse via Pydantic ; sur JSON
  corrompu/illisible → log un warning et renvoie les valeurs par défaut en
  mémoire (ne réécrit pas le fichier de l'utilisateur, ne crash pas).

### `packages/frontend/app.py`

`create_app() -> FastAPI` : monte le router canvas et le dossier `static/`.
L'app reçoit la racine du repo via une variable d'environnement posée par la
CLI (`MEKISTUDIO_REPO_ROOT`) afin que `backend/` n'ait pas à connaître la CLI.

### `packages/frontend/routes/canvas.py`

- `GET /` → rend `canvas.html` (injecte le nom du projet depuis le manifest).
- `GET /healthz` → `200 {"status": "ok"}`.
- `GET /api/canvas` → renvoie le `CanvasState` courant (JSON).
- `POST /api/canvas/viewport` → persiste le viewport (debounced côté client).

### Frontend (Jinja + Alpine)

`canvas.html` : page plein écran, fond grille, composant Alpine gérant le
**pan** (drag souris) et le **zoom** (molette). HUD coin haut-gauche : nom du
projet. Au boot, charge `/api/canvas` pour restaurer le viewport ; sur
pan/zoom, POST debouncé vers `/api/canvas/viewport`. Aucun node rendu.

### `packages/cli.py`

App Typer exposant la commande `run` :

1. `root = find_repo_root(Path.cwd())` ; message amical si pas de `.git`.
2. `manifest = ensure_meki_dir(root)`.
3. Pose `MEKISTUDIO_REPO_ROOT` dans l'environnement.
4. Lance `uvicorn` sur `127.0.0.1:8777` (défauts), ouvre le navigateur.
5. Options : `--port` (défaut **8777**), `--host` (défaut `127.0.0.1`),
   `--no-open`.

## Flux de données

```
mekistudio run
  → find_repo_root(cwd)
  → ensure_meki_dir(root)            # .mekistudio/{manifest,canvas}.json
  → MEKISTUDIO_REPO_ROOT=<root>
  → uvicorn create_app() @ 127.0.0.1:8777
  → webbrowser.open(http://127.0.0.1:8777/)

navigateur:
  GET /            → canvas.html (nom projet)
  GET /api/canvas  → CanvasState (restaure viewport)
  pan/zoom         → POST /api/canvas/viewport (debounced) → save_canvas
```

## Gestion d'erreurs

- Pas de `.git` : message amical, on continue avec le cwd (ne bloque pas).
- JSON `.mekistudio/` corrompu : log + défauts en mémoire, jamais de crash.
- Port occupé : uvicorn remonte l'erreur ; message clair suggérant `--port`.

## Tests (TDD là où ça paie)

`tests/unit/test_bootstrap.py` :
- crée un `.mekistudio/` valide (manifest + canvas) dans un tmp repo ;
- **idempotent** : un 2e appel ne modifie pas les fichiers existants ;
- survit à un `manifest.json` / `canvas.json` corrompu (défauts, pas de crash).

`tests/unit/test_app.py` :
- `GET /` → 200, contenu HTML ;
- `GET /healthz` → 200 ;
- `GET /api/canvas` → 200, structure CanvasState.

Glue triviale (templates statiques, JS pan/zoom) non couverte par pytest au
Jalon 1.

## Hors périmètre (Jalon 1)

- Tout type de node (chat, git, file, terminal…) et le système de briques.
- Le backend Claude (ClaudeBridge, hooks, WebSocket).
- Worktrees, sandbox, Docker, Traefik.
- Persistance des nodes/edges au-delà du tableau vide.

Ces éléments arrivent dans les jalons suivants, ajoutés ensemble.

## Phase 2 — Docs de référence

Générées par sous-agents en parallèle (lecture des deux codebases → rédaction).
Logique + technos, jamais de code brut. Structure :

```
docs/old/
  mekistudio/
    00-overview.md          # but, philosophie, layering rule
    01-tech-stack.md        # uv, Typer, FastAPI, Jinja, Alpine, SDK, pytest
    02-architecture.md      # backend/frontend/sandbox, flux
    03-state-on-disk.md     # ~/.mekistudio + .mekistudio/ + conversations
    04-claude-bridge.md     # bridge, hooks SDK, can_use_tool, guard
    05-canvas.md            # chat↔git nodes, pulses, infinite canvas
    06-worktrees.md         # git worktrees isolés
    07-sandbox-docker.md    # Docker/Traefik (mis de côté)
  mekistudio-lego/
    00-overview.md          # ce que le fork change vs mekistudio
    01-brick-system.md      # primitives, roots, registry, converter, hot_reload
    02-node-catalog.md      # chaque node : rôle, briques, deps
    03-canvas-runtime.md    # canvas_api / canvas_ws, models
```

## Ordre de livraison

1. **Phase 1** — walking skeleton ci-dessus (priorité immédiate).
2. **Phase 2** — docs de référence, en parallèle via agents.
