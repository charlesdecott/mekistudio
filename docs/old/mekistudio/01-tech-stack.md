# Stack technique

## Dépendances et leurs rôles

| Technologie | Rôle dans mekistudio |
|---|---|
| **uv** | Gestionnaire de paquets et d'environnements Python. Installe le CLI via `uv tool install`, gère le virtualenv. Seul outil requis sur la machine hôte (en dehors de Docker). |
| **Typer** | Expose le CLI `mekistudio` avec ses sous-commandes (`serve`, `config`, `doctor`, `image`, `stop`, `update`, `uninstall`). Chaque commande est une fonction Python décorée. |
| **FastAPI + uvicorn** | Serveur HTTP + WebSocket. FastAPI définit les routes REST et les endpoints WS ; uvicorn est le runner ASGI. En mode `--reload`, FastAPI est instancié via une factory (`create_app`) pour que uvicorn puisse recharger sans retenir l'instance. |
| **Jinja2** | Templates HTML côté serveur. Rendu des pages complètes (`dashboard`, `project_home`, `project_chat`, `project_canvas`). L'état initial est injecté via une balise `<script type="application/json">` — jamais inline dans `x-data` (double-quoting cassé). |
| **Alpine.js v3** | Réactivité côté client, sans étape de build. Chaque page charge une factory Alpine (`dashboard()`, `projectChat()`…). Tailwind CSS + daisyUI sont chargés **via CDN**, aucun bundler. |
| **Pydantic v2** | Modèles de données et validation partout : `MekiConfig`, `Project`, `Conversation`, `Worktree`, `CanvasLayout`, `NodePosition`. Sérialisation via `model_dump(mode="json")`. Parse tolérant : `extra="ignore"` sur tous les modèles pour survivre à une dérive de schéma. |
| **claude-agent-sdk** | Bibliothèque Anthropic qui lance le processus `claude` CLI et expose un client async (`ClaudeSDKClient`). `ClaudeBridge` l'enveloppe pour normaliser les événements, capturer les hooks et router `AskUserQuestion` vers l'UI. |
| **GitPython** | Opérations git : `git init`, `git clone`, `git worktree add/remove/list`, calcul ahead/behind, merge, status. Utilisé uniquement dans `backend/` (jamais dans les routes). |
| **pywinpty** | Allocation de PTY (pseudo-terminal) sur Windows. Permet aux sessions de terminal dans le navigateur de fonctionner sur Windows sans WSL. Dépendance conditionnelle (`sys_platform == 'win32'`). |
| **httpx** | Client HTTP utilisé dans le CLI pour le healthcheck post-démarrage du conteneur (`/healthz`). |
| **pytest + pytest-asyncio + pytest-playwright** | Tests unitaires async et tests end-to-end pilotés par navigateur. Les tests e2e sont marqués `@pytest.mark.e2e` et exclus par défaut. |
| **Docker** | Sandbox de l'agent. Le Dockerfile empaquette le studio + uv + claude CLI ; le conteneur n'expose que le port du studio et monte uniquement `~/meki-projects`. Traefik est intégré en sidecar pour router `mekistudio.localhost`. |

## Conventions Python (appliquées partout dans le projet)

- **Python 3.11+**, `from __future__ import annotations` en tête de chaque fichier.
- **Pydantic v2** pour tous les modèles ; `model_dump(mode="json")` pour la sérialisation.
- **`pathlib.Path` uniquement** — `os.path` banni.
- **Commentaires sur le pourquoi** des invariants non évidents, jamais sur le quoi.
- **TDD** quand ça compte : spécifier l'interface en Pydantic, écrire le test, implémenter jusqu'au vert. Passer le test pour la colle triviale.
