# mekistudio-2 Walking Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `mekistudio run` dans un repo git bootstrappe `.mekistudio/` et ouvre un canvas infini vide (pan/zoom) sur `http://127.0.0.1:8777/`, en pur Python sans Docker.

**Architecture:** Layout calqué sur l'origine — `packages/backend/` (paths, models, bootstrap), `packages/frontend/` (FastAPI app + routes + templates + static), `packages/cli.py` comme seul câblage. `backend/` n'importe jamais `frontend/`. La racine du repo voyage via `app.state.repo_root`.

**Tech Stack:** uv, Typer, FastAPI/uvicorn, Jinja2, Pydantic v2, Alpine.js (CDN), pytest + httpx (TestClient).

---

## Conventions (à respecter dans chaque fichier .py)

- `from __future__ import annotations` en tête.
- Pydantic v2 ; `model_dump(mode="json")` pour sérialiser.
- `pathlib.Path` uniquement.
- Commentaires : le **pourquoi** des invariants non-évidents.

## Structure des fichiers

| Fichier | Responsabilité |
|---|---|
| `pyproject.toml` | Projet uv, deps, entry point `mekistudio`, config pytest |
| `.gitignore` | Ignore venvs, caches, `.mekistudio/` |
| `README.md` | Démarrage rapide |
| `packages/cli.py` | CLI Typer ; commande `run` ; SEUL câblage back+front |
| `packages/backend/paths.py` | Racine repo + chemins `.mekistudio/` |
| `packages/backend/models.py` | Pydantic : `Manifest`, `Viewport`, `CanvasState` |
| `packages/backend/bootstrap.py` | Création/chargement `.mekistudio/`, corrupt-safe |
| `packages/frontend/app.py` | `create_app()` FastAPI |
| `packages/frontend/routes/canvas.py` | `/`, `/healthz`, `/api/canvas`, viewport |
| `packages/frontend/templates/canvas.html` | Page canvas |
| `packages/frontend/static/js/canvas.js` | Composant Alpine pan/zoom |
| `packages/frontend/static/css/canvas.css` | Style canvas |
| `tests/unit/test_paths.py` | Tests `paths` |
| `tests/unit/test_models.py` | Tests `models` |
| `tests/unit/test_bootstrap.py` | Tests `bootstrap` |
| `tests/unit/test_app.py` | Tests routes (TestClient) |
| `tests/unit/test_cli.py` | Test `run` (CliRunner) |

---

### Task 1: Scaffold du projet

**Files:**
- Create: `pyproject.toml`, `.gitignore`, `README.md`
- Create: `packages/__init__.py`, `packages/backend/__init__.py`, `packages/frontend/__init__.py`, `packages/frontend/routes/__init__.py`
- Create: `packages/frontend/static/.gitkeep`, `tests/__init__.py`, `tests/unit/__init__.py`

- [ ] **Step 1: Créer `pyproject.toml`**

```toml
[project]
name = "mekistudio2"
version = "0.1.0"
description = "mekistudio-2 — AI dev studio, pur Python sans Docker."
readme = "README.md"
requires-python = ">=3.11"
authors = [{ name = "Mekidesign Dev", email = "info@neuronys.com" }]
license = { text = "MIT" }
dependencies = [
    "fastapi>=0.115",
    "uvicorn[standard]>=0.32",
    "jinja2>=3.1",
    "pydantic>=2.9",
    "typer>=0.13",
]

[project.optional-dependencies]
dev = [
    "pytest>=8.3",
    "httpx>=0.27",
    "ruff>=0.7",
]

[project.scripts]
mekistudio = "packages.cli:app"

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["packages"]

[tool.pytest.ini_options]
addopts = "-ra"
testpaths = ["tests"]
```

- [ ] **Step 2: Créer `.gitignore`**

```gitignore
.venv/
.venvwin/
__pycache__/
*.pyc
.pytest_cache/
.ruff_cache/
.mekistudio/
out.log
err.log
```

- [ ] **Step 3: Créer `README.md`**

```markdown
# mekistudio-2

AI dev studio en pur Python, sans Docker. Reconstruit petit à petit.

## Démarrer

```bash
uv sync --extra dev
cd /chemin/vers/un/repo/git
uv run mekistudio run        # ouvre http://127.0.0.1:8777/
```

`mekistudio run` crée `.mekistudio/` dans le repo s'il n'existe pas, puis
ouvre le canvas principal.

## Tests

```bash
uv run pytest
```
```

- [ ] **Step 4: Créer les packages vides**

Créer ces fichiers vides : `packages/__init__.py`, `packages/backend/__init__.py`, `packages/frontend/__init__.py`, `packages/frontend/routes/__init__.py`, `tests/__init__.py`, `tests/unit/__init__.py`.
Créer `packages/frontend/static/.gitkeep` (vide) — garantit que le dossier `static/` existe pour le montage FastAPI.

- [ ] **Step 5: Vérifier que uv résout l'environnement**

Run: `uv sync --extra dev`
Expected: crée `.venv`, installe fastapi/uvicorn/jinja2/pydantic/typer + dev, sans erreur.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: scaffold mekistudio-2 (uv, packages, pytest)"
```

---

### Task 2: `paths.py` — racine repo + chemins

**Files:**
- Create: `packages/backend/paths.py`
- Test: `tests/unit/test_paths.py`

- [ ] **Step 1: Écrire le test qui échoue**

```python
from __future__ import annotations

from packages.backend import paths


def test_find_repo_root_walks_up_to_git(tmp_path):
    (tmp_path / ".git").mkdir()
    nested = tmp_path / "a" / "b"
    nested.mkdir(parents=True)
    assert paths.find_repo_root(nested) == tmp_path


def test_find_repo_root_without_git_returns_start(tmp_path):
    nested = tmp_path / "a"
    nested.mkdir()
    assert paths.find_repo_root(nested) == nested


def test_path_helpers(tmp_path):
    assert paths.meki_dir(tmp_path) == tmp_path / ".mekistudio"
    assert paths.manifest_path(tmp_path) == tmp_path / ".mekistudio" / "manifest.json"
    assert paths.canvas_path(tmp_path) == tmp_path / ".mekistudio" / "canvas.json"
```

- [ ] **Step 2: Lancer le test pour vérifier l'échec**

Run: `uv run pytest tests/unit/test_paths.py -v`
Expected: FAIL — `ModuleNotFoundError` / `AttributeError: module ... has no attribute 'find_repo_root'`.

- [ ] **Step 3: Implémenter `paths.py`**

```python
from __future__ import annotations

from pathlib import Path


def find_repo_root(start: Path) -> Path:
    """Remonte depuis `start` jusqu'au premier dossier contenant `.git`.

    Sans `.git` trouvé, on renvoie `start` : l'appelant décide quoi en faire
    (afficher un avertissement), mais on ne bloque jamais le démarrage.
    """
    start = start.resolve()
    for candidate in (start, *start.parents):
        if (candidate / ".git").exists():
            return candidate
    return start


def meki_dir(root: Path) -> Path:
    return root / ".mekistudio"


def manifest_path(root: Path) -> Path:
    return meki_dir(root) / "manifest.json"


def canvas_path(root: Path) -> Path:
    return meki_dir(root) / "canvas.json"
```

Note : `find_repo_root` résout le chemin ; le test passe des `tmp_path` déjà absolus donc l'égalité tient.

- [ ] **Step 4: Lancer le test pour vérifier le succès**

Run: `uv run pytest tests/unit/test_paths.py -v`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/backend/paths.py tests/unit/test_paths.py
git commit -m "feat(backend): paths — racine repo + chemins .mekistudio"
```

---

### Task 3: `models.py` — Pydantic

**Files:**
- Create: `packages/backend/models.py`
- Test: `tests/unit/test_models.py`

- [ ] **Step 1: Écrire le test qui échoue**

```python
from __future__ import annotations

from packages.backend.models import CanvasState, Manifest, Viewport


def test_manifest_defaults():
    m = Manifest(name="demo")
    assert m.name == "demo"
    assert m.schema_version == 1
    assert isinstance(m.id, str) and len(m.id) > 0


def test_manifest_ids_are_unique():
    assert Manifest(name="a").id != Manifest(name="b").id


def test_canvas_state_defaults():
    c = CanvasState()
    assert c.schema_version == 1
    assert c.nodes == []
    assert c.edges == []
    assert c.viewport == Viewport(x=0, y=0, zoom=1)


def test_canvas_state_roundtrip():
    c = CanvasState(viewport=Viewport(x=10, y=-5, zoom=2))
    data = c.model_dump(mode="json")
    assert CanvasState.model_validate(data) == c
```

- [ ] **Step 2: Lancer le test pour vérifier l'échec**

Run: `uv run pytest tests/unit/test_models.py -v`
Expected: FAIL — `ModuleNotFoundError: packages.backend.models`.

- [ ] **Step 3: Implémenter `models.py`**

```python
from __future__ import annotations

import uuid

from pydantic import BaseModel, Field


class Manifest(BaseModel):
    """Identité du projet, persistée dans .mekistudio/manifest.json."""

    id: str = Field(default_factory=lambda: uuid.uuid4().hex)
    name: str
    schema_version: int = 1


class Viewport(BaseModel):
    x: float = 0.0
    y: float = 0.0
    zoom: float = 1.0


class CanvasState(BaseModel):
    """État du canvas. nodes/edges restent en list[dict] au Jalon 1 — c'est
    le seam : on typera les nodes quand on branchera le premier vrai node."""

    schema_version: int = 1
    nodes: list[dict] = Field(default_factory=list)
    edges: list[dict] = Field(default_factory=list)
    viewport: Viewport = Field(default_factory=Viewport)
```

- [ ] **Step 4: Lancer le test pour vérifier le succès**

Run: `uv run pytest tests/unit/test_models.py -v`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/backend/models.py tests/unit/test_models.py
git commit -m "feat(backend): models Pydantic Manifest/Viewport/CanvasState"
```

---

### Task 4: `bootstrap.py` — store `.mekistudio/`

**Files:**
- Create: `packages/backend/bootstrap.py`
- Test: `tests/unit/test_bootstrap.py`

- [ ] **Step 1: Écrire le test qui échoue**

```python
from __future__ import annotations

import json

from packages.backend import bootstrap, paths
from packages.backend.models import CanvasState, Viewport


def test_ensure_creates_meki_dir(tmp_path):
    manifest = bootstrap.ensure_meki_dir(tmp_path)
    assert paths.manifest_path(tmp_path).exists()
    assert paths.canvas_path(tmp_path).exists()
    assert manifest.name == tmp_path.name


def test_ensure_is_idempotent(tmp_path):
    first = bootstrap.ensure_meki_dir(tmp_path)
    raw_after_first = paths.manifest_path(tmp_path).read_text(encoding="utf-8")
    second = bootstrap.ensure_meki_dir(tmp_path)
    # même id, fichier inchangé
    assert second.id == first.id
    assert paths.manifest_path(tmp_path).read_text(encoding="utf-8") == raw_after_first


def test_load_canvas_survives_corrupt_json(tmp_path):
    bootstrap.ensure_meki_dir(tmp_path)
    paths.canvas_path(tmp_path).write_text("{ pas du json", encoding="utf-8")
    state = bootstrap.load_canvas(tmp_path)
    assert isinstance(state, CanvasState)
    assert state.viewport == Viewport()  # défauts, pas de crash


def test_save_then_load_canvas(tmp_path):
    bootstrap.ensure_meki_dir(tmp_path)
    state = CanvasState(viewport=Viewport(x=3, y=4, zoom=1.5))
    bootstrap.save_canvas(tmp_path, state)
    loaded = bootstrap.load_canvas(tmp_path)
    assert loaded.viewport == Viewport(x=3, y=4, zoom=1.5)
    on_disk = json.loads(paths.canvas_path(tmp_path).read_text(encoding="utf-8"))
    assert on_disk["viewport"]["x"] == 3
```

- [ ] **Step 2: Lancer le test pour vérifier l'échec**

Run: `uv run pytest tests/unit/test_bootstrap.py -v`
Expected: FAIL — `ModuleNotFoundError: packages.backend.bootstrap`.

- [ ] **Step 3: Implémenter `bootstrap.py`**

```python
from __future__ import annotations

import json
import logging
from pathlib import Path

from packages.backend import paths
from packages.backend.models import CanvasState, Manifest

log = logging.getLogger(__name__)


def ensure_meki_dir(root: Path) -> Manifest:
    """Crée .mekistudio/ + manifest + canvas si absents. Idempotent : ne
    réécrit jamais un fichier existant."""
    paths.meki_dir(root).mkdir(parents=True, exist_ok=True)

    mpath = paths.manifest_path(root)
    if mpath.exists():
        manifest = _load_manifest(root)
    else:
        manifest = Manifest(name=root.name)
        _write_json(mpath, manifest.model_dump(mode="json"))

    cpath = paths.canvas_path(root)
    if not cpath.exists():
        _write_json(cpath, CanvasState().model_dump(mode="json"))

    return manifest


def load_canvas(root: Path) -> CanvasState:
    cpath = paths.canvas_path(root)
    if not cpath.exists():
        return CanvasState()
    try:
        data = json.loads(cpath.read_text(encoding="utf-8"))
        return CanvasState.model_validate(data)
    except Exception as exc:  # JSON corrompu / schéma invalide
        log.warning("canvas.json illisible (%s) — valeurs par défaut", exc)
        return CanvasState()


def save_canvas(root: Path, state: CanvasState) -> None:
    _write_json(paths.canvas_path(root), state.model_dump(mode="json"))


def _load_manifest(root: Path) -> Manifest:
    try:
        data = json.loads(paths.manifest_path(root).read_text(encoding="utf-8"))
        return Manifest.model_validate(data)
    except Exception as exc:
        log.warning("manifest.json illisible (%s) — valeurs par défaut", exc)
        return Manifest(name=root.name)


def _write_json(path: Path, payload: dict) -> None:
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
```

- [ ] **Step 4: Lancer le test pour vérifier le succès**

Run: `uv run pytest tests/unit/test_bootstrap.py -v`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/backend/bootstrap.py tests/unit/test_bootstrap.py
git commit -m "feat(backend): bootstrap .mekistudio (idempotent, corrupt-safe)"
```

---

### Task 5: La vue — template + static (glue, pas de pytest)

**Files:**
- Create: `packages/frontend/templates/canvas.html`
- Create: `packages/frontend/static/css/canvas.css`
- Create: `packages/frontend/static/js/canvas.js`

- [ ] **Step 1: Créer `packages/frontend/templates/canvas.html`**

```html
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{{ project_name }} — mekistudio</title>
  <link rel="stylesheet" href="/static/css/canvas.css">
  <script>window.__PROJECT_NAME__ = {{ project_name | tojson }};</script>
  <script defer src="https://unpkg.com/alpinejs@3.x.x/dist/cdn.min.js"></script>
  <script defer src="/static/js/canvas.js"></script>
</head>
<body>
  <div id="canvas" x-data="canvas()" x-init="init()"
       :style="gridStyle()"
       @mousedown="startPan($event)" @mousemove="onPan($event)"
       @mouseup="endPan()" @mouseleave="endPan()"
       @wheel.prevent="onZoom($event)">
    <div class="hud" x-text="projectName"></div>
    <div class="world" :style="worldStyle()"></div>
  </div>
</body>
</html>
```

L'inline script (window.__PROJECT_NAME__) s'exécute pendant le parsing, donc avant le `canvas.js` deferred — la valeur est dispo quand Alpine initialise `canvas()`.

- [ ] **Step 2: Créer `packages/frontend/static/css/canvas.css`**

```css
* { margin: 0; box-sizing: border-box; }
html, body, #canvas { width: 100%; height: 100%; overflow: hidden; }
#canvas {
  position: relative;
  background-color: #0f1115;
  background-image:
    linear-gradient(#1b1f27 1px, transparent 1px),
    linear-gradient(90deg, #1b1f27 1px, transparent 1px);
  cursor: grab;
  font-family: system-ui, sans-serif;
}
#canvas:active { cursor: grabbing; }
.world { position: absolute; top: 0; left: 0; transform-origin: 0 0; }
.hud {
  position: absolute; top: 12px; left: 12px; z-index: 10;
  padding: 6px 12px; border-radius: 8px;
  background: rgba(20, 24, 32, .85); color: #e6e6e6;
  font-size: 13px; pointer-events: none;
}
```

- [ ] **Step 3: Créer `packages/frontend/static/js/canvas.js`**

```javascript
function canvas() {
  return {
    projectName: window.__PROJECT_NAME__ || 'mekistudio',
    panning: false,
    last: { x: 0, y: 0 },
    view: { x: 0, y: 0, zoom: 1 },
    _saveTimer: null,

    async init() {
      try {
        const r = await fetch('/api/canvas');
        if (r.ok) {
          const state = await r.json();
          if (state.viewport) this.view = state.viewport;
        }
      } catch (e) { /* canvas vide par défaut */ }
    },

    // La grille (fond de #canvas) suit le viewport : feedback visuel du pan/zoom
    // même sans node affiché.
    gridStyle() {
      const s = 40 * this.view.zoom;
      return `background-size: ${s}px ${s}px; ` +
             `background-position: ${this.view.x}px ${this.view.y}px;`;
    },
    worldStyle() {
      return `transform: translate(${this.view.x}px, ${this.view.y}px) ` +
             `scale(${this.view.zoom});`;
    },

    startPan(e) { this.panning = true; this.last = { x: e.clientX, y: e.clientY }; },
    onPan(e) {
      if (!this.panning) return;
      this.view.x += e.clientX - this.last.x;
      this.view.y += e.clientY - this.last.y;
      this.last = { x: e.clientX, y: e.clientY };
    },
    endPan() { if (this.panning) { this.panning = false; this.scheduleSave(); } },

    onZoom(e) {
      const factor = e.deltaY < 0 ? 1.1 : 0.9;
      this.view.zoom = Math.min(4, Math.max(0.2, this.view.zoom * factor));
      this.scheduleSave();
    },

    scheduleSave() {
      clearTimeout(this._saveTimer);
      this._saveTimer = setTimeout(() => this.save(), 400);
    },
    async save() {
      try {
        await fetch('/api/canvas/viewport', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ x: this.view.x, y: this.view.y, zoom: this.view.zoom }),
        });
      } catch (e) { /* best-effort */ }
    },
  };
}
```

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/templates packages/frontend/static
git commit -m "feat(frontend): canvas infini Alpine (pan/zoom, grille suiveuse)"
```

---

### Task 6: `app.py` + `routes/canvas.py` — serveur

**Files:**
- Create: `packages/frontend/app.py`
- Create: `packages/frontend/routes/canvas.py`
- Test: `tests/unit/test_app.py`

- [ ] **Step 1: Écrire le test qui échoue**

```python
from __future__ import annotations

from fastapi.testclient import TestClient

from packages.backend import paths
from packages.frontend.app import create_app


def _client(tmp_path):
    return TestClient(create_app(repo_root=tmp_path))


def test_healthz(tmp_path):
    r = _client(tmp_path).get("/healthz")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_index_renders_html_and_bootstraps(tmp_path):
    r = _client(tmp_path).get("/")
    assert r.status_code == 200
    assert "text/html" in r.headers["content-type"]
    assert "mekistudio" in r.text.lower()
    # GET / déclenche le bootstrap du repo
    assert paths.manifest_path(tmp_path).exists()


def test_get_canvas_returns_state(tmp_path):
    r = _client(tmp_path).get("/api/canvas")
    assert r.status_code == 200
    body = r.json()
    assert body["nodes"] == []
    assert body["viewport"] == {"x": 0, "y": 0, "zoom": 1}


def test_post_viewport_persists(tmp_path):
    client = _client(tmp_path)
    r = client.post("/api/canvas/viewport", json={"x": 12, "y": -3, "zoom": 2})
    assert r.status_code == 200
    again = client.get("/api/canvas").json()
    assert again["viewport"] == {"x": 12, "y": -3, "zoom": 2}
```

- [ ] **Step 2: Lancer le test pour vérifier l'échec**

Run: `uv run pytest tests/unit/test_app.py -v`
Expected: FAIL — `ModuleNotFoundError: packages.frontend.app`.

- [ ] **Step 3: Implémenter `packages/frontend/routes/canvas.py`**

```python
from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates

from packages.backend import bootstrap
from packages.backend.models import Viewport

router = APIRouter()

_TEMPLATES = Jinja2Templates(
    directory=str(Path(__file__).resolve().parent.parent / "templates")
)


@router.get("/healthz")
async def healthz() -> dict:
    return {"status": "ok"}


@router.get("/", response_class=HTMLResponse)
async def index(request: Request):
    root = request.app.state.repo_root
    manifest = bootstrap.ensure_meki_dir(root)
    return _TEMPLATES.TemplateResponse(
        request=request,
        name="canvas.html",
        context={"project_name": manifest.name},
    )


@router.get("/api/canvas")
async def get_canvas(request: Request) -> dict:
    root = request.app.state.repo_root
    return bootstrap.load_canvas(root).model_dump(mode="json")


@router.post("/api/canvas/viewport")
async def set_viewport(request: Request, viewport: Viewport) -> dict:
    root = request.app.state.repo_root
    state = bootstrap.load_canvas(root)
    state.viewport = viewport
    bootstrap.save_canvas(root, state)
    return {"status": "ok"}
```

- [ ] **Step 4: Implémenter `packages/frontend/app.py`**

```python
from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from packages.frontend.routes import canvas


def create_app(repo_root: Path | None = None) -> FastAPI:
    """Construit l'app FastAPI. `repo_root` est passé explicitement par la CLI
    (et par les tests) ; à défaut on lit MEKISTUDIO_REPO_ROOT, sinon le cwd —
    ainsi backend/ n'a jamais à connaître la CLI."""
    if repo_root is None:
        env = os.environ.get("MEKISTUDIO_REPO_ROOT")
        repo_root = Path(env) if env else Path.cwd()

    app = FastAPI(title="mekistudio-2")
    app.state.repo_root = repo_root

    static_dir = Path(__file__).resolve().parent / "static"
    app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")
    app.include_router(canvas.router)
    return app
```

- [ ] **Step 5: Lancer le test pour vérifier le succès**

Run: `uv run pytest tests/unit/test_app.py -v`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/frontend/app.py packages/frontend/routes/canvas.py tests/unit/test_app.py
git commit -m "feat(frontend): app FastAPI + routes canvas (/, healthz, api)"
```

---

### Task 7: `cli.py` — commande `run`

**Files:**
- Create: `packages/cli.py`
- Test: `tests/unit/test_cli.py`

- [ ] **Step 1: Écrire le test qui échoue**

```python
from __future__ import annotations

from typer.testing import CliRunner

from packages.backend import paths
from packages.cli import app


def test_run_bootstraps_and_starts_server(tmp_path, monkeypatch):
    (tmp_path / ".git").mkdir()
    monkeypatch.chdir(tmp_path)

    started = {}
    # On neutralise le serveur bloquant et l'ouverture du navigateur.
    monkeypatch.setattr("packages.cli.uvicorn.run", lambda *a, **k: started.setdefault("ran", True))
    monkeypatch.setattr("packages.cli.webbrowser.open", lambda *a, **k: None)

    result = CliRunner().invoke(app, ["run", "--no-open", "--port", "8777"])

    assert result.exit_code == 0, result.output
    assert paths.manifest_path(tmp_path).exists()
    assert started.get("ran") is True
```

- [ ] **Step 2: Lancer le test pour vérifier l'échec**

Run: `uv run pytest tests/unit/test_cli.py -v`
Expected: FAIL — `ModuleNotFoundError: packages.cli`.

- [ ] **Step 3: Implémenter `packages/cli.py`**

```python
from __future__ import annotations

import os
import webbrowser
from pathlib import Path

import typer
import uvicorn

from packages.backend import bootstrap, paths

app = typer.Typer(help="mekistudio-2 — AI dev studio (pur Python, sans Docker)")


# Un callback (même vide) force Typer à garder `run` comme sous-commande
# nommée, pour que `mekistudio run` fonctionne tel quel.
@app.callback()
def _main() -> None:
    """mekistudio-2 CLI."""


@app.command()
def run(
    host: str = typer.Option("127.0.0.1", help="Adresse d'écoute."),
    port: int = typer.Option(8777, help="Port HTTP."),
    open_browser: bool = typer.Option(
        True, "--open/--no-open", help="Ouvrir le navigateur au démarrage."
    ),
) -> None:
    """Démarre mekistudio dans le repo git courant."""
    root = paths.find_repo_root(Path.cwd())
    if not (root / ".git").exists():
        typer.secho(
            f"[mekistudio] pas de depot git detecte — j'utilise {root}",
            fg=typer.colors.YELLOW,
        )
    bootstrap.ensure_meki_dir(root)

    # Le serveur (sous-process uvicorn éventuel via reload) lit la racine ici.
    os.environ["MEKISTUDIO_REPO_ROOT"] = str(root)

    url = f"http://{host}:{port}/"
    typer.secho(f"[mekistudio] canvas pret sur {url}", fg=typer.colors.GREEN)
    if open_browser:
        try:
            webbrowser.open(url)
        except Exception:
            pass

    from packages.frontend.app import create_app

    uvicorn.run(create_app(repo_root=root), host=host, port=port)
```

- [ ] **Step 4: Lancer le test pour vérifier le succès**

Run: `uv run pytest tests/unit/test_cli.py -v`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add packages/cli.py tests/unit/test_cli.py
git commit -m "feat(cli): commande run — bootstrap + uvicorn sur 8777"
```

---

### Task 8: Smoke test complet + verrouillage

**Files:**
- Aucun nouveau fichier (vérification end-to-end).

- [ ] **Step 1: Lancer toute la suite**

Run: `uv run pytest -v`
Expected: PASS — tous les tests (paths, models, bootstrap, app, cli).

- [ ] **Step 2: Lint**

Run: `uv run ruff check packages tests`
Expected: aucune erreur (corriger sinon).

- [ ] **Step 3: Smoke manuel dans un repo git jetable**

```bash
mkdir -p /tmp/meki-smoke && cd /tmp/meki-smoke && git init -q
uv run --project /c/sandbox-dev/workspace/mekistudio-2 mekistudio run --no-open
```
Expected (terminal) :
- ligne `[mekistudio] canvas pret sur http://127.0.0.1:8777/`
- uvicorn démarre (`Uvicorn running on http://127.0.0.1:8777`).
- `/tmp/meki-smoke/.mekistudio/manifest.json` et `canvas.json` créés.

Ouvrir `http://127.0.0.1:8777/` : grille sombre, HUD avec le nom du dossier, pan (drag) et zoom (molette) déplacent la grille. Arrêter avec Ctrl+C.

- [ ] **Step 4: Commit final (si ajustements lint/smoke)**

```bash
git add -A
git commit -m "chore: jalon 1 — walking skeleton vert (tests + lint + smoke)"
```

---

## Self-Review

**1. Couverture du spec :**
- `mekistudio run` dans repo git → Task 7 (`run` + `find_repo_root`).
- Bootstrap `.mekistudio/` si absent → Task 4 + déclenché en Task 7 et sur `GET /` (Task 6).
- Ouvre le canvas direct → Task 7 (`webbrowser.open`) + Task 5/6 (page).
- Canvas infini pan/zoom vide → Task 5.
- `manifest.json` + `canvas.json` (forme spec) → Task 3 (models) + Task 4 (écriture).
- nodes/edges extensibles (seam) → Task 3 (`list[dict]`).
- Sécurité boot (corrupt-safe, no crash) → Task 4 (`load_canvas`/`_load_manifest`).
- Port 8777 / host 127.0.0.1 → Task 7.
- Layering backend ⊥ frontend, cli seul câblage → structure des fichiers + Task 6/7.
- Tests bootstrap (idempotent, corrupt) + app (/, /healthz, /api/canvas) → Tasks 4 & 6.
- Docs `docs/old/...` = Phase 2, hors de ce plan (plan séparé).

**2. Placeholders :** aucun TBD/TODO ; chaque step de code montre le code complet.

**3. Cohérence des types :** `find_repo_root`, `meki_dir`, `manifest_path`, `canvas_path`, `ensure_meki_dir`, `load_canvas`, `save_canvas`, `create_app(repo_root=...)`, `app.state.repo_root`, modèles `Manifest`/`Viewport`/`CanvasState` — noms identiques entre définition (Tasks 2-4) et usage (Tasks 6-7). Le viewport posté `{x,y,zoom}` correspond au modèle `Viewport`. Port 8777 cohérent (spec, cli, tests, smoke).

La Phase 2 (docs de référence) fera l'objet de son propre plan une fois le Jalon 1 vert.
