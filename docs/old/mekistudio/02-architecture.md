# Architecture

## Découpage des packages

```
packages/
├── cli.py          ← Entrypoint Typer. Seul câblage entre backend et frontend.
├── backend/        ← Logique métier pure Python. Aucune dépendance à frontend.
├── frontend/       ← FastAPI + Jinja + Alpine. Importe backend via deps.py.
└── sandbox/        ← Driver Docker + Dockerfile packagé.
```

## Modules backend et leurs responsabilités

| Module | Responsabilité |
|---|---|
| `paths.py` | Calcule et crée les chemins `~/.mekistudio/` (machine-local) et `<projet>/.mekistudio/` (commité). Toute lecture/écriture d'état passe par ici. |
| `config.py` | `MekiConfig` (Pydantic) + `ConfigStore`. Lit/écrit `~/.mekistudio/config.json`. Survit à la dérive de schéma. |
| `projects.py` | `ProjectRegistry` : crée un projet vide, clone via Git, importe un dossier local. Écrit le manifest dans `<projet>/.mekistudio/manifest.json`. |
| `worktrees.py` | `WorktreeStore` : `git worktree add/remove/list`, calcul ahead/behind, labels cosmétiques, merge vers la branche primaire. |
| `git.py` | Opérations git partagées (status, log, diff) réutilisées par projets et worktrees. |
| `conversations.py` | `ConversationStore` : CRUD des conversations + append-only des flux `messages.jsonl` / `hooks.jsonl`. Rejoue l'historique au reconnect WebSocket. |
| `sessions.py` | `ClaudeSession` + `SessionManager` : maintient le bridge actif entre les déconnexions WS, gère les statuts (`idle` / `running` / `paused`), broadcaste les événements aux sinks abonnés. |
| `claude_bridge.py` | `ClaudeBridge` : enveloppe `ClaudeSDKClient`, normalise les types SDK en événements dict (`TextDelta`, `ToolCallStart`, `HookFired`…), applique le `WorktreeGuard`. `NullBridge` : stand-in sans LLM pour les tests. |
| `terminals.py` | Sessions PTY via pywinpty (Windows) ou pty (Unix). |
| `canvas.py` | `CanvasStore` : lit/écrit `canvas.json` (positions des nœuds + viewport). |
| `context.py` | Conteneurs DI partagés au niveau de l'application. |
| `traefik.py` | Gestion du reverse-proxy Traefik intégré au sandbox. |
| `services.py` | Scaffolding des fichiers par défaut (`services.yml`, `CLAUDE.md`) lors de l'import d'un projet. |

## Couche frontend

| Fichier | Rôle |
|---|---|
| `app.py` | Factory FastAPI + lifespan (démarrage/arrêt propre du SessionManager). |
| `deps.py` | DI partagée : `ProjectRegistry`, `SessionManager`, `BridgeFactory`. Les routes injectent via `Depends(...)`. |
| `routes/pages.py` | Pages Jinja rendues côté serveur (`GET /`, `/projects/{id}/…`). |
| `routes/api.py` | REST : CRUD projets, conversations, worktrees. Réponses Pydantic, erreurs via `HTTPException`. |
| `routes/ws.py` | WebSocket `/ws/chat/{conv_id}` : relaie le bridge vers le client. Un seul bridge par socket. Déconnexion propre dans les deux sens. |
| `templates/` | `_base.html` (layout + CDN), `_macros.html` (atomes réutilisables), pages spécifiques. |
| `static/js/app.js` | Factories Alpine (`dashboard`, `projectChat`, etc.). État initial via `JSON.parse` d'une balise `<script type="application/json">`. |

## Flux de données : envoi d'un message chat

1. L'utilisateur soumet un prompt depuis l'UI Alpine.
2. Le WebSocket l'envoie à `ws.py`.
3. `ws.py` appelle `session.send(prompt)` via le `SessionManager`.
4. `ClaudeSession` transmet au `ClaudeBridge`.
5. `ClaudeBridge` appelle `client.query(prompt)` sur le `ClaudeSDKClient`.
6. Le SDK émet des événements SDK (`StreamEvent`, `ResultMessage`…) que `ClaudeBridge` traduit en événements normalisés (`TextDelta`, `ToolCallStart`, `AgentEnd`…).
7. Les hooks (`PreToolUse`, `PostToolUse`…) arrivent via le callback `on_hook` et sont broadcastés en parallèle.
8. `ClaudeSession` persiste chaque événement dans `messages.jsonl` / `hooks.jsonl` **et** broadcaste aux sinks WS abonnés.
9. Le WS retransmet au client. Alpine met à jour l'UI en temps réel.

## Comment `cli.py` câble tout

`cli.py` est le seul module qui importe à la fois `packages.backend.*` et `packages.frontend.app`. Il résout la config, décide sandbox vs natif, puis délègue soit à `DockerSandbox.start()` soit à `uvicorn.run(create_app())`. À l'intérieur du conteneur, le Dockerfile exécute directement `mekistudio serve --no-sandbox`, ce qui bypass Docker et lance uvicorn nativement.
