# Isolation des sessions Claude — état des lieux (recherche, 2026-05)

Note de cadrage pour la future **brique « isolation Docker »** (roadmap #7, promue). Objectif :
faire tourner Claude avec **outils complets** (Read/Write/Edit/Bash) sans qu'il puisse toucher
l'hôte hors du dossier projet. Hôte = **Windows 11 natif**, Docker Desktop / WSL2 dispo, auto-hébergé.

## Le fait qui décide de tout

**Le sandbox OS de Claude (Seatbelt macOS / bubblewrap Linux-WSL2) ne marche PAS sur Windows
natif.** Doc officielle : *« does not support native Windows ; use WSL2 or a container/VM ».*
→ Sur Windows, la seule isolation réelle = **conteneur Docker (backend WSL2) avec le CLI `claude`
qui tourne À L'INTÉRIEUR** (le guide secure-deployment du SDK le confirme : « l'agent tourne
*dans* la frontière d'isolation »). Le `sandbox` du SDK est **inutilisable** ici → l'isolation
**doit** être le conteneur lui-même.

## Vérité « copie du projet »

Une copie (worktree/clone) protège le **repo principal** des modifs, mais **n'isole pas Bash de
l'hôte**. Pour « Claude ne peut rien toucher hors du dossier », il faut un **conteneur/VM**. Le
combo gagnant = **conteneur + clone du repo dedans** (copie isolée **et** process isolés).

## Design recommandé (quand on la construira)

**Orchestration custom via le SDK Docker pour Python** (`docker` package) sur Docker Desktop/WSL2,
en **réutilisant l'image devcontainer officielle d'Anthropic + `init-firewall.sh`**, `claude`
tournant **dans** chaque conteneur. Reste **OSS / inspectable** (cohérent avec « importer
mekistudio dans lui-même »), contrairement au *Docker Sandboxes* first-party (fermé) ou à
Daytona (AGPL) / E2B (Linux/KVM, cloud).

1. **Image** : fork du `Dockerfile` devcontainer Anthropic (Node + `@anthropic-ai/claude-code` +
   toolchain) ; `init-firewall.sh` (egress default-deny, autorise `api.anthropic.com` + git/npm) ;
   durcissement `--cap-drop ALL`, `--security-opt no-new-privileges`, non-root, `--pids-limit`,
   `--memory`/`--cpus`.
2. **Conteneur par session + CLONE du repo dedans** (pas un bind-mount live de `C:`) → modèle
   **copie + revue avant merge** ; à l'arrêt, exposer le **diff/branche** du conteneur dans l'UI,
   merge/push vers le repo hôte (pattern **textcortex/claude-code-sandbox** → successeur *Spritz*).
3. **Piloter depuis Python** : `docker` SDK (`containers.run`, `exec_run`, stream des logs) ou
   `devcontainer` CLI ; streamer le stdout de `claude` vers le canvas via la WebSocket.

## Pièges
- **Bind-mount `C:\…` = lent** (pont 9p WSL2) → garder la copie de travail **dans** le FS du
  conteneur (clone) ou dans le FS WSL2, pas sur `C:`. (Renforce le choix « copie + merge-back ».)
- **Auth `claude` dans le conteneur** : persister `~/.claude` dans un **volume nommé** par session,
  ou injecter `CLAUDE_CODE_OAUTH_TOKEN` / `ANTHROPIC_API_KEY` ; le callback OAuth peut ne pas
  atteindre le conteneur → prévoir le **collage du code**. **Ne pas** monter `~/.ssh` / creds cloud.
- **gVisor** : protège plus, mais **10–200× plus lent en I/O fichier** → à éviter pour un agent qui
  touche beaucoup de fichiers ; un conteneur durci suffit (la frontière, c'est le conteneur).
- **WSL2 + `claude --sandbox`** sans conteneur : possible mais **instable** (#31708) et n'isole que
  l'env WSL2 → le conteneur par session est plus robuste pour un studio multi-sessions.

## Sources clés
- Sandboxing (Windows non supporté) : https://code.claude.com/docs/en/sandboxing
- Secure deployment (docker run durci, proxy, gVisor) : https://code.claude.com/docs/en/agent-sdk/secure-deployment
- Devcontainer Anthropic : https://code.claude.com/docs/en/devcontainer · https://github.com/anthropics/claude-code/tree/main/.devcontainer
- devcontainer CLI : https://github.com/devcontainers/cli
- Pattern copie→branche→diff→push : https://github.com/textcortex/claude-code-sandbox (archivé → Spritz)
- Docker Sandboxes (first-party, Windows, **pas OSS**) : https://docs.docker.com/ai/sandboxes/agents/claude-code/
- Alt. Linux/cloud : E2B https://github.com/e2b-dev/E2B · Daytona https://github.com/daytonaio/daytona (AGPL) · microsandbox https://github.com/zerocore-ai/microsandbox
