# mekistudio — Roadmap

Repo unique auto-hébergé, pur Python, sans Docker. On reconstruit **petit à
petit**, en s'inspirant des concepts des anciennes versions documentés dans
[`docs/old/`](old/) — **sans reprendre le code** (tout est réimplémenté).

## Où on en est (2026-05-29)

- ✅ **Jalon 1 — walking skeleton** (mergé) : `mekistudio serve` bootstrappe
  `.mekistudio/` (manifest + canvas, corrupt-safe) et sert un canvas infini
  vide (pan/zoom) sur `http://127.0.0.1:8777/`.
- ✅ **CLI auto-hébergée** : install global *editable* (`uv tool install
  --editable`), `mekistudio update` (git pull, code live) et
  `mekistudio update --restart` (arrête l'instance via `.mekistudio/serve.pid`,
  pull, relance un `serve` frais).
- ✅ **Phase 2 — docs de référence** : concepts des deux anciennes versions
  dans `docs/old/mekistudio/` (8 docs) et `docs/old/mekistudio-lego/` (4 docs).

Specs/plans détaillés : [`docs/superpowers/`](superpowers/).

## Architecture cible (rappel)

`mekistudio/backend/` (jamais d'import de `frontend/`) + `mekistudio/frontend/`
(FastAPI + Jinja + Alpine) + `mekistudio/cli.py` (seul câblage). Stack : uv,
Typer, FastAPI/uvicorn, Jinja2, Alpine.js, Pydantic v2, Claude Agent SDK,
pytest.

**Seam déjà en place** : `CanvasState.nodes` / `edges` sont en `list[dict]` —
à typer quand on branche le premier vrai node.

## Reste à faire (incrémental, un node/backend à la fois)

L'idée directrice vient du fork **lego** (cf. `docs/old/mekistudio-lego/`) :
des **nodes composés de briques modulaires** plutôt qu'un canvas monolithique.

1. **Système de nodes/briques minimal** — un `registry`, un modèle `Node` typé,
   le rendu d'un node sur le canvas (brancher le seam `nodes`). Réf :
   `docs/old/mekistudio-lego/01-brick-system.md`, `03-canvas-runtime.md`.
2. **Premier vrai node : chat** — connecter le **ClaudeBridge** (Claude Agent
   SDK) : streaming des tokens, panneau de hooks. Réf :
   `docs/old/mekistudio/04-claude-bridge.md`.
3. **Persistance des conversations** — `meta.json` + `messages.jsonl` +
   `hooks.jsonl` sous `.mekistudio/`. Réf : `docs/old/mekistudio/03-state-on-disk.md`.
4. **Nodes git** (status / diff) + **pulses** chat ↔ git. Réf :
   `docs/old/mekistudio/05-canvas.md`, `docs/old/mekistudio-lego/02-node-catalog.md`.
5. **Worktrees git** par branche, état isolé. Réf :
   `docs/old/mekistudio/06-worktrees.md`.
6. **Terminaux** (PTY via pywinpty). Réf : catalogue de nodes lego.
7. **Plus tard / optionnel** : sandbox Docker + Traefik (mis de côté). Réf :
   `docs/old/mekistudio/07-sandbox-docker.md`.

Chaque étape : spec → plan → implémentation TDD → merge, comme le Jalon 1.

## Pour Claude Code (session ouverte dans ce repo)

Avant d'implémenter un node ou un morceau de backend, **lis le(s) doc(s)
`docs/old/` correspondant(s)** pour récupérer les concepts et le « pourquoi »
sans relire l'ancien code. On réimplémente proprement, on ne copie pas.
