# mekistudio

AI dev studio en **pur Python, sans Docker, auto-hébergé** : un seul repo (`C:\mekistudio`, branche `main`) qui se met à jour lui-même. **Vision** : importer mekistudio dans lui-même et le laisser s'améliorer. On reconstruit **petit à petit**, en réimplémentant les concepts des anciennes versions — sans reprendre leur code.

## Architecture
- `mekistudio/backend/` n'importe **jamais** `frontend/` ; `mekistudio/cli.py` est le seul câblage.
- Stack : uv · Typer · FastAPI/uvicorn · Jinja2 · Alpine.js · Pydantic v2 · Claude Agent SDK · pytest.
- CLI : `serve` (canvas sur :8777, bootstrap `.mekistudio/`) · `update` (git pull, code live) · `update --restart` (stop + pull + relance).
- Install global **editable** (`uv tool install --editable .`) → le code est lu en direct depuis le repo.
- Composants : `backend/components/` (primitives Pydantic, union discriminée sur `type`) assemblés en nodes dans `backend/nodes/` (`registry.py` → `NODE_BUILDERS`/`default_canvas`). `CanvasState.nodes` typé `list[Node]` ; `edges` reste `list[dict]` (pas encore de wires).

## Docs
- `docs/ROADMAP.md` — où on en est + reste à faire (à lire en premier).
- `docs/ARCHITECTURE.md` — archi réelle du code (modules, surface API, front, invariants, recette « ajouter un node »).
- `docs/IDEAS.md` — boîte à idées (features futures notées au fil de l'eau).
- `docs/old/{mekistudio,mekistudio-lego}/` — concepts des anciennes versions (à lire avant de réimplémenter un node/backend ; pas de code).
- `docs/superpowers/` — specs & plans détaillés.

## Conventions
Python 3.11+, `from __future__ import annotations`, `pathlib` only, Pydantic v2 (`model_dump(mode="json")`). TDD. Commentaires = le *pourquoi*. Un commit par changement cohérent.
