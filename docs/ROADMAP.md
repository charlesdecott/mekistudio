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
- 🟡 **Jalon 2 — système de composants + premiers nodes** : composants
  primitifs Pydantic (`backend/components/` : `NodeComponent`, `LayoutComponent`,
  `HeaderComponent` niveaux 1–4, `FileTreeComponent`, `EditorComponent`, union
  discriminée sur `type`), assemblages dans `backend/nodes/` (`kernel.py`,
  `file_explorer.py`, `file_editor.py` + `registry.py` avec `NODE_BUILDERS` /
  `default_canvas()`). **Seam typé** : `CanvasState.nodes` est désormais
  `list[Node]`. Canvas neuf seedé (kernel + explorateur + éditeur) ; rendu
  récursif côté `canvas.js`.
  - `kernelNode` : header de niveau 1.
  - `fileExplorer` : arbre façon VSCode, dépliage **paresseux** via `GET /api/fs`
    (listing sandboxé au repo, `__pycache__` masqué), icônes emoji par type,
    scrollbar discrète.
  - **Manipulation des nodes** : toolbar gauche (sélection / déplacer /
    redimensionner), contraintes par node (`movable` / `resizable` / `max_*` /
    `configurable`, re-dérivées du kind au chargement), kernel figé au centre.
    Persistance via `POST /api/canvas/nodes/{id}` (écriture atomique, rejet des
    valeurs non finies).
  - **Réglages de node** : node `configurable` → engrenage (hors coin haut-droit
    quand sélectionné) → modale. fileExplorer : liste d'exclusions éditable
    (défaut `__pycache__`, bornée, noms simples), `POST /api/canvas/nodes/{id}/settings`.
  - `fileEditor` (dynamique) : éditeur CodeMirror 6 (coloration, guides
    d'indentation, **word-wrap**), lit/édite/sauve un fichier (`/api/file`,
    écriture atomique sandboxée). **Double-clic** sur un fichier de l'explorateur
    → spawn un node éditeur en cascade près de l'explorateur ; **bouton fermer**
    (warning si non sauvegardé). Multi-éditeurs. Node socle ; dérivés dans
    [`IDEAS.md`](IDEAS.md).
  - **Création/suppression de nodes** : `POST /api/canvas/nodes` (kind, borné,
    rejet non-fini) · `DELETE /api/canvas/nodes/{id}` (built-in non supprimables).
    Clic = node au premier plan ; scrollbar discrète globale.
  - **Câbles/wires** (livré) : dérivés de `Node.source_id` (arbre kernel→explorer→éditeurs),
    tracé **subway 45° adaptatif** + ruban néon, **contournement des nodes** (45° + changement
    de face) et **anti-superposition** des câbles, re-route auto.
  - **Impulsions ⚡** (livré, debug) : mini-toolbar ⚡ sous le node sélectionné → **comète** le
    long du chemin (`pathBetween` sur l'arbre `source_id`), nodes traversés en glow doux, cible
    en flash fort. Simulateur en attendant le node chat (alors `AgentEnd` déclenchera la vraie
    impulsion chat → éditeur).
  - **Anti-chevauchement des nodes** (livré) : invariant zéro-recouvrement, collision douce
    (voisin écarté/relogé), kernel = mur, spawn dans un trou libre, réconciliation au boot.
  - **Node chat × Claude Agent SDK — squelette vertical** (livré, 2026-05-30) : node chat
    **built-in** piloté par une vraie session Claude (Claude Agent SDK, **mode streaming-input**),
    réponses **texte streamées token-par-token** dans des bulles **Discord-fidèles**
    (`chat-view.js` + réducteur **pur** `chat-model.js`, testé `node --test`). **WebSocket**
    `/ws/chat/{conversation_id}` (1ʳᵉ brique temps réel), session **détachée façon `screen`**
    (survit au reload, **reattach** = replay + live), **stop** (`interrupt()`), **file
    d'attente**, **nouvelle session** (clear). Persistance disque
    (`.mekistudio/conversations/<id>/` : `meta.json` + `messages.jsonl`, records discrets ;
    deltas **non** journalisés). Outils **OFF**. Bridge détaché (`backend/chat/`), API SDK
    épinglée par un smoke test. Spec/plan/revue adversariale (52 findings) :
    `docs/superpowers/{specs,plans}/2026-05-30-node-chat-claude-skeleton*`.
  - **Tool-cards lecture seule** (livré, 2026-05-30, brique D) : outils **Read/Glob/Grep/LS**
    rallumés, **confinés au repo** par un hook `PreToolUse` durci (le `claude` ne peut rien lire
    hors du dossier — prouvé en smoke réel). Tour **multi-étapes** (chaque `AssistantMessage` =
    une étape), **tool-cards mode C** (log terminal : icône+couleur par outil, état ⟳/✓/✗/🚫,
    sortie dépliable), appariées par `tool_use_id`, persistées+rejouées ; **balayage des outils
    orphelins** à l'interrupt. Validé Playwright (Read CLAUDE.md → carte, 0 erreur console).
    Spec/plan/revue : `docs/superpowers/{specs,plans}/2026-05-30-node-chat-tool-cards*` ;
    3 modes de carte (A/B/C) dans `docs/tool-card-styles.md`.
  - Reste sur le chat : **write/Edit/Bash + isolation Docker** (brique dédiée, cf.
    `docs/sandbox-isolation-research.md` : conteneur par session + clone + merge-back) · **hooks →
    impulsions** · **QCM / `ask_user`** · **panneau hooks** · modes de carte A/B en réglages.
    Ailleurs : palette d'ajout, multi-onglets.

Specs/plans détaillés : [`docs/superpowers/`](superpowers/).

## Architecture cible (rappel)

`mekistudio/backend/` (jamais d'import de `frontend/`) + `mekistudio/frontend/`
(FastAPI + Jinja + Alpine) + `mekistudio/cli.py` (seul câblage). Stack : uv,
Typer, FastAPI/uvicorn, Jinja2, Alpine.js, Pydantic v2, Claude Agent SDK,
pytest.

**Seam** : `CanvasState.nodes` est typé `list[Node]` (branché au kernelNode) ;
`edges` reste en `list[dict]` tant qu'il n'y a pas de câbles/wires.

## Reste à faire (incrémental, un node/backend à la fois)

L'idée directrice vient du fork **lego** (cf. `docs/old/mekistudio-lego/`) :
des **nodes composés de briques modulaires** plutôt qu'un canvas monolithique.

1. **Système de nodes/briques minimal** — un `registry`, un modèle `Node` typé,
   le rendu d'un node sur le canvas (brancher le seam `nodes`). Réf :
   `docs/old/mekistudio-lego/01-brick-system.md`, `03-canvas-runtime.md`.
2. **Premier vrai node : chat** — ✅ **squelette livré** (streaming texte, WebSocket,
   screen/reattach, stop/file/nouvelle session, outils OFF). Reste : **tool-cards**,
   **panneau de hooks**, **hooks → impulsions**, **QCM**. Réf :
   `docs/old/mekistudio/04-claude-bridge.md`.
3. **Persistance des conversations** — ✅ `meta.json` + `messages.jsonl` (squelette chat).
   Reste : `hooks.jsonl` (avec la brique hooks). Réf : `docs/old/mekistudio/03-state-on-disk.md`.
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
