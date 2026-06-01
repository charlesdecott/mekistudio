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
  - **Impulsions ⚡** (livré) : mini-toolbar ⚡ sous le node sélectionné → **comète** le
    long du chemin (`pathBetween` sur l'arbre `source_id`), nodes traversés en glow doux, cible
    en flash fort. **Désormais déclenchées aussi par les hooks du node chat** (F1+F2, voir plus bas) —
    le ⚡ reste pour le debug.
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
  - **Hooks → impulsions (F1+F2)** (livré, 2026-05-31) : les hooks Claude Code (capturés via des
    hooks **émetteurs** `HookMatcher`, à côté du guard) et la **fin de tour** déclenchent les
    impulsions du canvas. **Comète** chat → éditeur du fichier lu (s'il est ouvert), sinon comète
    vers l'explorateur ; **glow** explorateur (Glob/LS) ; **glow fort persistant** sur le chat en
    fin de tour (Stop), éteint au **clic** ; **flash rouge** sur refus hors-repo / erreur outil.
    Comètes **concurrentes** (plusieurs en vol). **Volet « hooks »** repliable (debug) dans le node
    chat. Events **transients** (`hook_fired`/`turn_end`/`attached`, non persistés) ; le marqueur
    `attached` = fin de replay → **pas d'impulsion au reload**. Mapping **pur** testé
    (`chat-impulses.js`, `node --test`) ; API hooks épinglée par smoke. Validé Playwright (comète qui
    voyage, glow de l'éditeur, persistance, concurrence, 0 erreur console). Spec/plan :
    `docs/superpowers/{specs,plans}/2026-05-30-node-chat-hooks-impulsions*`.
  - **Auto-spawn d'éditeur (F3a)** (livré, 2026-05-31) : lire un fichier **non ouvert** → la comète
    matérialise un **éditeur du fichier** (près de l'explorateur, fade-in à l'arrivée). **Éphémère**
    par défaut : persisté (`Node.ephemeral`+`expires_at_ms`), **auto-supprimé** au TTL (10 min, purge
    au chargement serveur), **survit à un reload**, **clic = épingle** → permanent (`POST .../pin`),
    **dedup** par fichier, **plafond 20**. Validé Playwright (spawn, dedup, survie reload, épingle,
    TTL→disparition, 0 erreur console). Comète qui **trace le câble** progressivement (pixel par pixel)
    + placement **aléatoire en secteur libre** (câbles dégagés des nodes). Spec :
    `docs/superpowers/specs/2026-05-31-node-chat-autospawn-editor-f3a*`.
  - **Réglages d'auto-spawn (F3b)** (livré, 2026-06-01) : le node chat devient `configurable`
    (engrenage → modale) — **mode** (éphémère / plafond+recyclage FIFO / illimité) + **TTL** + **plafond**
    éditables (`ChatComponent.spawn_mode`/`spawn_ttl_min`/`spawn_cap`). Le mode change le spawn
    (éphémère = aperçu+TTL ; plafond = aperçu plafonné sans TTL ; illimité = éditeur permanent). Validé
    pytest + Playwright. **Brique F (hooks → impulsions → matérialisation) complète.**
  - **Refacto organisation des nodes (brique G)** (livré, 2026-06-01) : nouvelle topologie
    **`kernel → git → { chat, explorateur }`** (chat **et** explorateur re-parentés ; migration auto au
    chargement). **Node « branch git »** built-in (`GET /api/git/branch` lecture seule, tolérant) :
    affiche `⎇ branche · ↑ahead ↓behind · ● modifs`, **rafraîchie à la fin de tour** (événementiel),
    **réductible** (barre de titre = vue minimale). **Dossiers en nodes** : ouvrir un fichier (double-clic
    ou auto-spawn F3) matérialise la **chaîne de dossiers** de son chemin (un node par segment, ou
    **compacte** style VSCode via un toggle dans les réglages de l'explorateur) ; chaque node dossier est un
    **mini-explorateur** enraciné, **réductible**. Le cœur est le **parentage path-aware** (`source_id` par
    plus-long-préfixe, fonction pure testée). **Masquage dérivé** (un dossier sorti disparaît de l'explorateur
    parent), **cycle de vie compté-référence + épingle** (purge fixpoint des dossiers éphémères vides),
    **placement F3 ancré** sur la node dossier (regroupement, câbles dégagés), fermeture non destructive,
    **réduire/agrandir** générique (`Node.collapsed`). **Disposition organique « neurones »** (`neuro-layout.js`,
    `layoutFolderTree`) : explorateur au centre, dendrites directionnelles (chaos/longueur/étalement réglés en
    companion), anti-collision + anti-câble-sous-node, **auto-fit du viewport** (tout voir), **dossiers
    matérialisés par la comète** comme les fichiers. (1ʳᵉ tentative en arbre vertical rejetée — cf. spec
    `2026-06-01-canvas-organic-neuron-layout-design`.) Modules purs `node --test` (`folders.js`, `git-node.js`,
    `neuro-layout.js`, `parenting.py`). Validé pytest + Playwright (chaîne, groupement, 0 câble sous une node,
    compaction, fermeture, git, réduction, disposition organique centrée). Revue adversariale → défauts corrigés.
    Spec/plan : `docs/superpowers/{specs,plans}/2026-06-01-node-org-refactor-brick-g*` + `…-organic-neuron-layout-design`.
  - Reste sur le chat : **write/Edit/Bash + isolation Docker** (brique dédiée, cf.
    `docs/sandbox-isolation-research.md` : conteneur par session + clone + merge-back) · **QCM /
    `ask_user`** (le glow-notif persistant l'attend déjà) · modes de carte A/B en réglages.
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
