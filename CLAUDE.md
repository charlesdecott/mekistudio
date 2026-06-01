# mekistudio

AI dev studio en **pur Python, sans Docker, auto-hébergé** : un seul repo (`C:\mekistudio`, branche `main`) qui se met à jour lui-même. **Vision** : importer mekistudio dans lui-même et le laisser s'améliorer. On reconstruit **petit à petit**, en réimplémentant les concepts des anciennes versions — sans reprendre leur code.

## Architecture
- `mekistudio/backend/` n'importe **jamais** `frontend/` ; `mekistudio/cli.py` est le seul câblage.
- Stack : uv · Typer · FastAPI/uvicorn · Jinja2 · Alpine.js · Pydantic v2 · Claude Agent SDK · pytest.
- CLI : `serve` (canvas sur :8777, bootstrap `.mekistudio/`) · `update` (git pull, code live) · `update --restart` (stop + pull + relance).
- Install global **editable** (`uv tool install --editable .`) → le code est lu en direct depuis le repo.
- Composants : `backend/components/` (primitives Pydantic, union discriminée sur `type`) assemblés en nodes dans `backend/nodes/` (`registry.py` → `NODE_BUILDERS`/`default_canvas`). `CanvasState.nodes` typé `list[Node]`. Topologie built-in : **`kernel → git → { chat, explorateur }`** (brique G). Nodes dynamiques : `fileeditor`, `folder` (mini-explorateur enraciné, dossiers-en-nodes).
- Câbles/wires **dérivés** d'un parent par node (`Node.source_id`). Parentage **par kind** (`CANONICAL_PARENT_KIND`) pour les built-in, **path-aware** (plus-long-préfixe de chemin, `nodes/parenting.py` pur) pour `folder`/`fileeditor` ; `reconcile_source_links` applique les deux au boot (+ migration des built-in de mauvais kind). Pas d'`edges` persistés (`CanvasState.edges` réservé/inutilisé). Géométries/logiques **pures** côté front (testées `node --test`) : `cables.js` (`MekiCables` — subway 45°, ruban, contournement, `pathBetween`), `collision.js` (`MekiCollision` — collision douce), `folders.js` (`MekiFolders` — chaîne de dossiers complète/compacte), `git-node.js` (`MekiGitNode` — rendu état git), `tree-layout.js` (`MekiTreeLayout` — disposition d'arbre lisible par profondeur). `canvas.js` les câble en DOM impératif. Node git rafraîchie à la fin de tour (`GET /api/git/branch`, lecture seule). Le sous-arbre dossiers→fichiers est disposé en **arbre lisible** (colonnes par profondeur, `layoutFolderTree`) plutôt qu'éparpillé.

## Docs
- `docs/ROADMAP.md` — où on en est + reste à faire (à lire en premier).
- `docs/ARCHITECTURE.md` — archi réelle du code (modules, surface API, front, invariants, recette « ajouter un node »).
- `docs/IDEAS.md` — boîte à idées (features futures notées au fil de l'eau).
- `docs/old/{mekistudio,mekistudio-lego}/` — concepts des anciennes versions (à lire avant de réimplémenter un node/backend ; pas de code).
- `docs/superpowers/` — specs & plans détaillés.

## Conventions
Python 3.11+, `from __future__ import annotations`, `pathlib` only, Pydantic v2 (`model_dump(mode="json")`). TDD. Commentaires = le *pourquoi*. Un commit par changement cohérent.
