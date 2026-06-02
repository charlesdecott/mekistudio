# mekistudio — Architecture-cible « north star » : studio conteneurisé, multi-repos, multiplayer

> **Statut** : vision-cible validée (brainstorming 2026-05-30). Ce document **fige l'architecture**
> pour que les choix faits maintenant restent valides en local *et* en cloud. Il **chapeaute**
> plusieurs sous-projets (A–E), chacun ayant ensuite son propre cycle spec → plan → implémentation.
>
> **Il lève une incohérence de la roadmap** : `docs/ROADMAP.md` #7 dit « sandbox Docker (mis de
> côté) » alors que `docs/sandbox-isolation-research.md` (note de recherche, untracked) la dit
> « promue ». **Tranché ici** : l'isolation conteneur n'est plus optionnelle ni « plus tard » — elle
> devient l'ossature du studio. La note de recherche est l'annexe technique de ce north-star.

## 1. Pourquoi ce document

Le studio tourne aujourd'hui en **natif** sur l'hôte. Dès qu'on réactivera les outils de Claude
(`Bash`/`Write`/`Edit`, cf. node chat livré « outils OFF »), il pourra toucher tout le système.
Deux problèmes, distincts mais liés, se posent alors :

- **Problème A — Isolation.** Enfermer l'exécution (studio + Claude + code) dans un **conteneur**
  pour qu'un prompt erroné ou malveillant ne puisse rien casser hors de son périmètre. Multiplateforme
  (Windows / Linux / macOS). Accès **navigateur** aujourd'hui, **SSH/terminal** plus tard.
- **Problème B — Orchestration & ports.** Faire tourner **plusieurs choses en même temps** (plusieurs
  studios, plusieurs repos, plusieurs dev-servers par repo) **sans conflit de ports** et **depuis une
  seule UI web**. Ajouter/retirer un service exposé **à chaud**, sans redémarrer ni « ouvrir des ports ».

## 2. Vision en une phrase

> **Une seule UI web** (le *control plane*) qui orchestre **N repos**, chacun dans un **workspace
> conteneurisé** isolé (le *data plane*), exposés derrière **un unique port** par un **reverse-proxy
> qui route par nom d'hôte** — la **même architecture** servant le **local solo** et le **cloud
> multi-collègues (multiplayer temps réel)**, seul l'adaptateur de lancement des conteneurs changeant.

## 3. Le principe qui décide de tout : **un seul port + proxy par nom**

On ne *forwarde* aucun port. Le conteneur (local) ou le dev-server (cloud) **ne publie qu'un seul
port** (`:8777`). À l'intérieur, un **reverse-proxy** écoute ce port et **route selon le nom d'hôte**
vers n'importe quel port **interne** — ces ports internes ne sont **jamais** exposés à l'hôte.

```
   NAVIGATEUR (local: toi · cloud: collègues via VPN)
   studio.localhost · repoA.localhost · webapp.repoA.localhost · repoB.localhost
                         │  (tout sur UN SEUL port publié :8777)
                         ▼
   REVERSE-PROXY  — route par NOM d'hôte (pas par port) · routes ajoutées/retirées À CHAUD
                         │
            ┌────────────┴───────────────┐
            ▼                             ▼
   workspace repoA (conteneur)   workspace repoB (conteneur)
     studio interne :8777          dev-server :5173
     dev-server     :3000          (ports INTERNES, jamais exposés à l'hôte)
     webapp         :23322 ← NEW
```

**Conséquence directe** sur la question « comment ajouter un port sans tout relancer » : une nouvelle
webapp sur `:23322` → le control plane **ajoute une route** `webapp.repoA.localhost → 23322`, le proxy
recharge **à chaud**. On la teste depuis Windows via `http://webapp.repoA.localhost:8777`. **Aucun**
reload du dev-server, **aucun** port ouvert en plus, **zéro** conflit (les ports en conflit potentiel
sont internes et privés à chaque workspace). C'est le pattern `<branche>.<service>.<projet>.localhost`
de mekistudio-1 (Traefik), cf. `docs/old/mekistudio/07-sandbox-docker.md`.

## 4. Control plane / data plane

- **Control plane** (« le hub ») = **l'unique UI mekistudio** + le cerveau :
  - **registre des projets** (N repos sur un même hôte/dev-server) ;
  - **orchestrateur de workspaces** (créer / démarrer / arrêter / détruire les conteneurs) ;
  - **table de routage** du reverse-proxy (source de vérité des routes nom→port) ;
  - **auth · présence · synchronisation collaborative** (activées surtout en cloud).
- **Data plane** = les **workspaces**, **un conteneur par projet** (et, plus fin, par worktree) :
  - le **code du repo**, **Claude (avec outils)**, et **les dev-servers** du projet ;
  - ports **internes**, déclarés au proxy par le control plane.

Le contrat entre les deux est **étroit et explicite** : le control plane sait *créer/piloter un
workspace* et *publier/retirer une route* ; il ne connaît pas l'intérieur d'un workspace.

## 5. Local ≡ cloud : un adaptateur « container backend »

La **seule** différence entre local et cloud est **où l'on lance les conteneurs**, derrière une
interface unique :

| | Local (maintenant) | Cloud (plus tard) |
|---|---|---|
| Container backend | Docker de ta machine | Docker du dev-server distant |
| Exposition | loopback / `*.localhost` | VPN (Tailscale/WireGuard) + DNS + TLS |
| Auth | légère / absente | obligatoire |
| Utilisateurs | toi, solo | toi + collègues (multiplayer) |

Control plane, reverse-proxy et data plane sont **identiques** dans les deux cas. C'est l'exigence
explicite « choisir une archi qui correspond aux deux cas pour ne pas la changer plus tard ».

## 6. Modèle de tenancy & isolation

L'isolation **n'est pas un réglage global** : elle **dépend du type de projet**.

- **Projet perso** (toi, confiance totale) : peut démarrer en isolation **« hôte seul »** légère
  (un bac à sable partagé suffit à protéger l'OS).
- **Projet client / collaborateur** (accès « collaborateur complet » : Claude **avec outils** piloté
  par un tiers) : **conteneur dédié par projet/par client**, obligatoire. Le VPN protège le
  *périmètre*, **pas** les tenants entre eux : sans conteneur dédié, un Claude-avec-outils piloté par
  un tiers pourrait lire/écrire les fichiers des autres projets.

**Règle** : dès qu'un projet est partagé en accès collaborateur, il a son propre workspace conteneur.

## 7. Où vit le code

Pour garder **une seule archi** local↔cloud : **le code vit dans le workspace (conteneur)**, édité
via éditeur navigateur / VSCode *Remote-attach* / git (on ne peut pas bind-mount un laptop dans un
dev-server cloud). En **local uniquement**, le **bind-mount** du dossier hôte est une **option de
confort** (hot-reload, IDE natif) — une *optimisation locale*, **pas** l'architecture.

## 8. Exposition & accès

- **Cible de déploiement** : **réseau privé** — VPN (Tailscale/WireGuard) ou LAN homelab. **Pas**
  d'exposition Internet publique (un studio qui exécute du code est une cible ; on garde la surface
  minimale).
- **Accès** : navigateur d'abord ; **SSH/terminal** ensuite (le node terminal PTY de la roadmap #6
  s'y branche naturellement).
- **Cible d'accès client** : **collaborateur complet** (Claude avec outils pour le client) — ce qui
  **impose** l'isolation par projet du §6 et, à terme, quotas/budgets IA par tenant.

## 9. Multiplayer temps réel = une couche du control plane

Le travail collaboratif (plusieurs personnes sur le même projet, en temps réel) est une **couche du
control plane** (identité, présence, diffusion d'état du canvas, chat multi-pilotes). Il **réutilise
un acquis** : le node chat est déjà **détaché « façon `screen` » avec reattach = replay + live**
(`docs/ROADMAP.md`). Plusieurs clients s'attachant à la même session Claude, c'est **déjà à moitié
en place** — le multiplayer généralise ce mécanisme au canvas et à la présence.

## 10. Découpage en sous-projets

Chaque sous-projet a ensuite **son propre cycle** spec → plan → implémentation TDD → merge.

| # | Sous-projet | Livre | Ordre |
|---|---|---|---|
| **A** | **Fondation** : studio conteneurisé + reverse-proxy mono-port | Isolation de l'hôte + fin des conflits de ports (routes à chaud). **Local solo.** | **D'abord** (plus petit, débloque le reste) |
| **B** | **Control plane** : registre multi-repos + orchestrateur de workspaces | « Gérer N repos depuis une seule UI » ; adaptateur container-backend (Docker local) | Ensuite |
| **C** | **Parité cloud** | Backend cloud + VPN/DNS/TLS + auth | Quand le cloud devient réel |
| **D** | **Multiplayer temps réel** | Identité, présence, canvas partagé, chat multi-pilotes | En parallèle de C |
| **E** | **Isolation multi-tenant** | Conteneur dédié par projet/client, quotas/budgets IA, contrôle d'accès | Transverse, durci au fil de B/C/D |

**Le prochain spec à écrire est celui de la fondation A.**

## 11. Invariants (à respecter par tous les sous-projets)

1. **Un seul port publié** par hôte/dev-server ; tout le reste est routé par nom d'hôte.
2. **Le proxy se reconfigure à chaud** : ajouter/retirer une route ne redémarre ni le proxy, ni un
   workspace, ni un dev-server.
3. **Le control plane est l'unique source de vérité du routage** (table nom→workspace:port).
4. **Local et cloud partagent le même code** ; seule l'implémentation du *container backend* (et
   l'activation auth/VPN) diffère, derrière une interface stable.
5. **Isolation selon le type de projet** : perso = légère ; client/collaborateur = conteneur dédié.
6. **Le code des projets vit dans le workspace** ; le bind-mount est une option locale, jamais une
   dépendance d'architecture.
7. **`backend/` n'importe jamais `frontend/`** (invariant mekistudio existant) ; le control plane
   respecte le même layering.

## 12. Décisions ouvertes (tranchées dans les specs des sous-projets)

- **Runtime conteneur** : Docker (Desktop/WSL2) vs Podman vs autre — *spec A*.
- **Reverse-proxy** : Traefik vs Caddy vs nginx vs proxy Python maison — *spec A* (critère clé :
  reconfiguration à chaud + rester OSS/inspectable, cohérent avec « importer mekistudio dans lui-même »).
- **Forme de la config de routage** (labels conteneur, fichier watch, API proxy) — *spec A*.
- **Schéma de nommage d'hôte** définitif (`<service>.<repo>.localhost` ?) — *spec A*.
- **Interface du container backend** (méthodes create/start/stop/destroy/exec/route) — *spec B*.
- **Modèle d'auth & d'identité** (cloud) et **quotas/budgets IA** — *specs C/E*.

## 13. Références

- `docs/sandbox-isolation-research.md` — annexe technique (Windows ≠ sandbox OS natif → conteneur ;
  pièges bind-mount/auth/gVisor ; image devcontainer Anthropic + `init-firewall.sh`).
- `docs/old/mekistudio/07-sandbox-docker.md` — sandbox Docker + Traefik de mekistudio-1 (concepts).
- `docs/old/mekistudio/06-worktrees.md` — isolation par worktree (grain fin futur).
- `docs/old/mekistudio/05-canvas.md`, `docs/old/mekistudio-lego/02-node-catalog.md` — nodes
  `service` / `browser` / `terminal` (consommateurs naturels du routage).
- `docs/ROADMAP.md` #7 — **à mettre à jour** suite à ce north-star (isolation promue, plus « de côté »).
