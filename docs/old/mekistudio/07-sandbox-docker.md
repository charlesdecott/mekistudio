# 07 — Sandbox Docker

> **Note pour mekistudio-2** : ce document décrit l'architecture Docker de mekistudio-1. **mekistudio-2 met Docker de côté pour l'instant** et fonctionne en mode natif pur Python (`--no-sandbox`). Ce fichier sert de mémoire de ce qui existait et pourquoi, pour une éventuelle réintroduction ultérieure.

---

## Concept

Le sandbox Docker répond à un double objectif :

1. **Isolation de sécurité** : l'agent Claude peut exécuter des commandes shell arbitraires (`Bash`), lire et écrire des fichiers, lancer des processus. Le faire tourner à l'intérieur d'un conteneur restreint limite le rayon d'explosion si une instruction malveillante ou erronée tente de sortir du workspace.
2. **Reproductibilité** : l'image embarque toutes les dépendances (Python, Node.js, Claude Code CLI, Traefik, git, ssh), garantissant un environnement identique sur toutes les machines hôtes.

---

## Image

L'image `mekistudio:<version>` est construite depuis le `Dockerfile` packagé dans `packages/sandbox/resources/`. Elle est basée sur `python:3.11-slim` et contient :

- Git, SSH client, Node.js/npm (requis par `claude-agent-sdk` qui shell-out vers la CLI Claude Code)
- Traefik (proxy inverse, téléchargé à la compilation pour ne pas bloquer le premier lancement)
- `@anthropic-ai/claude-code` (CLI npm)
- `uv` pour l'environnement Python de mekistudio lui-même

L'utilisateur dans le conteneur est `meki` (UID 1000), non-root. Les capabilities sont toutes droppées (`--cap-drop=ALL --security-opt=no-new-privileges`).

---

## Entrypoint

L'entrypoint (`meki-entrypoint`) s'exécute avant la commande principale et règle deux problèmes de runtime :

- **Permissions SSH** : les bind mounts depuis Windows/macOS ne préservent pas les modes POSIX. `~/.ssh-host` (monté en lecture seule depuis le host) est copié dans `~/.ssh` avec `chmod 700/600` pour que `ssh` accepte les clés.
- **Identité git** : les variables `MEKI_GIT_USER_NAME`/`MEKI_GIT_USER_EMAIL` (injectées par le CLI lors du démarrage) ou le `~/.gitconfig` du host (monté en lecture seule) sont utilisés pour configurer `git config --global` à l'intérieur du conteneur.

---

## Traefik comme point d'entrée unique

Le conteneur expose les ports 80 (Traefik) et 8080 (dashboard Traefik), mais **pas** le port 8765 (mekistudio interne). Tout le trafic passe par `mekistudio.localhost`. Ce pattern :

- Donne un seul point de contrôle pour les URLs et les CORS.
- Permet d'attribuer des sous-domaines aux services lancés par les worktrees (`<branch>.<service>.<project>.localhost`).
- Permet l'injection de devtools Eruda dans les iframes (même origine).

---

## Montages volumes

| Source (host) | Destination (conteneur) | Mode | Rôle |
|---|---|---|---|
| `<workspace>` | `/workspaces` | rw | Projets de l'utilisateur |
| `mekistudio-data` (volume nommé) | `/home/meki/.mekistudio` | rw | État persistant du studio |
| `~/.ssh` | `/home/meki/.ssh-host` | ro | Clés SSH pour git clone |
| `~/.claude` | `/home/meki/.claude` | rw | Auth Claude Code (tokens refreshed) |
| `~/.gitconfig` | `/home/meki/.gitconfig-host` | ro | Identité git du host |

Le home du host (`~/`) n'est jamais monté en entier — seulement les sous-répertoires nécessaires.

---

## Devcontainer

Le même `Dockerfile` sert de base au fichier `.devcontainer/devcontainer.json`, ce qui permet d'ouvrir le repo dans VS Code Dev Containers avec le même environnement que le mode `serve`. Le workspace cible est `/workspaces/project`.

---

## Mode natif (`--no-sandbox`)

La commande `mekistudio serve --no-sandbox` bypasse complètement Docker et lance le serveur FastAPI directement sur le système hôte. Ce mode est le défaut dans mekistudio-2. Le flag `MEKISTUDIO_IN_SANDBOX=1` est positionné à l'intérieur du conteneur pour détecter l'imbrication et refuser un `serve` récursif.
