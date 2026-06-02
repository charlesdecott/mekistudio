# Fondation A — Studio conteneurisé + reverse-proxy mono-port (design)

> **Statut** : design validé (brainstorming 2026-05-30/31). Premier sous-projet du
> [north-star](2026-05-30-studio-conteneurise-north-star.md) (bloc **A**). Périmètre : **local solo**.
> Prochaine étape après validation : `writing-plans` → plan d'implémentation TDD.
>
> **Objectif** : (1) faire tourner mekistudio + Claude **dans un conteneur** (isolation de l'hôte) ;
> (2) ne publier **qu'un seul port** (`8777`) ; (3) un **reverse-proxy Python intégré** route par
> **nom d'hôte** vers des ports **internes** ; (4) **ajouter/retirer une route à chaud** (0 restart,
> 0 WebSocket coupée) pour exposer un dev-server sans ouvrir de port.
>
> Étayé par deux passes de recherche sourcées (proxy/WS, orchestration, `*.localhost`, durcissement
> conteneur, doc officielle Claude) + vérifications adversariales. Les claims « repo-spécifiques »
> ci-dessous ont été **revérifiés dans le code réel**.

## 0. Décisions verrouillées (résumé)

| Sujet | Décision | Pourquoi |
|---|---|---|
| Proxy | **Python maison**, **intégré** à l'app FastAPI du studio (1 process) | Muter un dict en RAM ne coupe **aucune** WS (Caddy, lui, coupe **toutes** les WS à chaque reload — issues #6420/#7222). 100 % inspectable (« importer mekistudio dans lui-même »). |
| Nommage | `<service>.<repo>.localhost:8777` | Lisible, hiérarchique (cf. Coder/Gitpod) ; même grammaire de localhost → vrai domaine TLS. *Conséquence phase C à trancher* : wildcard `*.<repo>.<domain>` = **un cert par repo** (alternative `repo--service` = un seul wildcard — décision différée en C, §8). |
| Chat via proxy | **Oui**, le `/ws/chat` du studio traverse le proxy en A (via `mekistudio.localhost`) | Sinon le choix « proxy zéro-coupure » n'a aucun sens et le test DoD est vide. |
| Code en A | **Bind-mount** `C:\mekistudio` | Boucle dev quasi inchangée ; on optimisera (volume nommé) **si** le 9p mesuré gêne. |
| docker-py | **Différé en phase B** | En A il n'y a qu'**un** conteneur : `compose.yml` + script suffisent. |
| Auth Claude | `ANTHROPIC_API_KEY` (chemin SDK) injecté au **runtime** + `~/.claude` en **volume nommé** | Le callback OAuth n'atteint pas le conteneur ; jamais de secret dans l'image. |
| Clients non-navigateur | Pas de fallback path-based en A | `127.0.0.1` + header `Host` pour curl/httpx/tests. Fallback path **différé en C**. |

## 1. Topologie & périmètre

**Un** conteneur Linux (backend WSL2 sur l'hôte Windows ; image portable Linux/macOS). Il publie
**uniquement** `8777`, **bindé sur le loopback hôte** (`-p 127.0.0.1:8777:8777`). À l'intérieur, **un
seul process** uvicorn fait tourner l'app FastAPI du studio, **enveloppée d'un middleware/dispatch
ASGI** qui fait le proxy. Le CLI/SDK `claude` tourne **dans** ce conteneur (principe officiel :
*« the agent runs INSIDE the isolation boundary »*).

```
NAVIGATEUR (Windows)                       CONTENEUR (publie SEUL 127.0.0.1:8777)
mekistudio.localhost:8777 ───────┐         ┌───────────────────────────────────────┐
  (studio: canvas + /ws/chat)    ├──:8777─▶│  app ASGI (uvicorn, 1 process)        │
webapp.mekistudio.localhost:8777 ┘         │   ├─ DISPATCH ASGI (sur Host)         │
                                           │   │     ├─ host = studio → FastAPI app │
                                           │   │     └─ host = service → tunnel ──┐ │
                                           │   └─ studio FastAPI (canvas, /ws/chat)│ │
                                           │  dev-server interne 127.0.0.1:23322 ◀─┘ │
                                           └───────────────────────────────────────┘
                                             ports internes JAMAIS publiés à l'hôte
```

**Definition of done (walking skeleton, bout-en-bout)** :
1. `mekistudio` tourne en conteneur, accessible sur `http://mekistudio.localhost:8777`.
2. On lance un serveur HTTP bidon sur un port interne (ex. `23322`).
3. On **ajoute sa route à chaud** (`webapp.mekistudio.localhost → 127.0.0.1:23322`).
4. On l'ouvre depuis le **navigateur Windows** via `http://webapp.mekistudio.localhost:8777`.
5. **Test e2e** : pendant l'ajout de route, une session chat en streaming **ne se coupe pas** (preuve
   directe que le proxy Python tient sa promesse — la raison d'être de A).

## 2. Le dispatch ASGI (proxy)

Le proxy s'interpose **avant** le routage FastAPI, lit le `Host`, et décide studio-vs-tunnel. Il
branche sur **`scope['type']`** (`http` / `websocket` / `lifespan`) — le seam le plus stable d'ASGI —
**jamais** en sniffant les en-têtes. Implémentation : un wrapper ASGI autour de l'app retournée par
`create_app()` (`frontend/app.py`), ou un middleware le plus externe. *(Décision in-process actée :
le studio et le proxy partagent le process ; il n'y a donc **pas** de hop HTTP interne pour les
requêtes studio, et **pas** de `--proxy-headers` à activer en A — voir §4.)*

**Modèle de routes (deux niveaux conceptuels, implémentation simple en A)** :
- **Route** : `host_pattern` → `service_id` (identité **logique** stable).
- **Endpoint** : `service_id` → cible **loopback** `127.0.0.1:port`.

Le découplage `service_id` ↔ endpoint est **gravé maintenant** (un rebind d'IP/port en phase B ne
changera pas l'URL publique), **sans** abstraction pluggable en A : une résolution via le dict suffit.

**Règles de matching (invariants, peu coûteux, stables)** :
- **Normaliser le Host rigoureusement** *avant* routage : minuscules ; retirer le port via
  `rpartition(':')` en gérant les crochets IPv6 (`[::1]`) ; rejeter Host absent, label vide,
  `userinfo` (`@`), CR/LF, longueur > 253 / label > 63, charset non-DNS. Host malformé → **rejet**.
- **Default-deny** : un host inconnu **n'atteint jamais** le studio par fallthrough → `404` (corps
  clair, jamais de hang). *(Le `421 Misdirected Request` — RFC 9110 §15.5.20 — est réservé au cas
  HTTP/2 coalescing de la phase C ; la sécurité en A vient du **default-deny + targets loopback**.)*
- **Targets loopback-only** : la cible n'est **jamais** influencée par le client (ferme le
  SSRF-via-routing — OWASP SSRF).
- **Politique de collision** (fondation ajoutée) : `routes.json` est keyé par host normalisé ;
  `upsert_route` est **idempotent** et **last-write-wins** sur un host déjà présent ; deux hosts qui
  normalisent vers la même clé = la même route (pas de doublon silencieux). `resolve()` retourne
  `None` (not-found typé), ne lève pas.
- `mekistudio.localhost` → l'app studio interne (canvas **et** `/ws/chat` : le chat est un endpoint
  du studio, pas un service routé séparément). Tout autre `<service>.<repo>.localhost` connu → tunnel.

## 3. Cycle de vie WebSocket & streaming (zone critique)

Le chat streame token-par-token, session « screen » (reattach = replay+live). Le proxy ne voit
**jamais** le stream amont de Claude (async-generator in-process) ; il ne tunnelise que le segment
**navigateur ↔ studio**. Invariants (RFC 6455 ; RFC 9112 §9.6 *connection/hop-by-hop* — ex-RFC 7230,
obsolète ; spec ASGI) :

- **Handshake** : `Upgrade`/`Connection` sont *hop-by-hop* → **ré-émettre explicitement** vers
  l'upstream (un proxy « copie tout » les perd → l'upstream répond 200/400, le WS ne s'ouvre jamais).
  Dériver `Connection` de la présence d'`Upgrade`. Relayer `101` + `Sec-WebSocket-Accept` **verbatim**.
- **Après le 101 : relais d'octets transparent** — deux pumps concurrents (client→upstream,
  upstream→client), **aucun** re-framing/re-masking (RFC 6455 §5.3/§10.3), forward du sous-protocole
  et des Close frames ; quand un côté ferme, **annuler le pump frère** (tue les sockets zombies
  half-open — classe des bugs #7/#8/#12).
- **Backpressure end-to-end** : si un côté est lent, **arrêter de lire** l'autre (await l'écriture
  avant la lecture suivante) plutôt que bufferiser sans borne ; fermer un pair qui ne suit pas.
- **Pas de buffering** sur les chemins streamés : `more_body=True` (flush immédiat) ; **jamais** de
  `Content-Length` sur du chunké.
- **Pas de timeout idle sur les WS** : un chat « screen » est silencieux quand le modèle réfléchit →
  liveness par **Ping/Pong** (RFC 6455 §5.5.2/5.5.3), pas « plus d'octet depuis N s ». Séparer
  **3 horloges** : connect-upstream (court), idle-après-upgrade (**illimité**), max-lifetime
  (large/none en A). En A le seul WS est celui du studio → `uvicorn --ws-ping-interval/--ws-ping-timeout`
  s'appliquent (pour un futur tunnel WS vers un tiers, le Ping/Pong est *passthrough*).
- **Cap de taille de message WS** dès A (`uvicorn --ws-max-size`) + **plafond de connexions WS
  concurrentes** (borne globale, anti-DoS mémoire) — fondations ajoutées.
- **Check `Origin` au handshake** (anti-CSWSH) : un point de contrôle **pré-101** dès A avec une
  vérification basique same-origin (cheap) ; l'allowlist complète + token de session sont **différés
  en C** (le *seam* est posé maintenant).

## 4. Code, auth & boucle dev

- **Code** : bind-mount `C:\mekistudio` → `/workspace` ; `uv tool install --editable /workspace`
  **dans** le conteneur. Accepté en A (pas de hot-reload de toute façon). `.mekistudio/`
  (conversations + `routes.json`) sur un **volume nommé** — ce qui garantit que l'écriture atomique de
  `routes.json` (tmp + `os.replace`) reste **sur le même volume** (le code existant note déjà
  « rename atomique POSIX & Windows (**même volume**) » dans `fs.py`). Écrire `routes.json` sur le
  bind-mount `C:\` casserait l'atomicité (rename cross-FS).
- **Helper d'écriture atomique** (fondation ajoutée) : le pattern existe **en double** aujourd'hui —
  `backend/bootstrap.py::_write_json` (privé) et `backend/fs.py::write_file` (sandboxé au repo).
  **Extraire un helper partagé** (tmp unique dans le **même dossier** + `os.replace` + cleanup du
  `.tmp`) et l'utiliser pour `routes.json` ; ne pas réimplémenter une 3ᵉ variante.
- **Auth Claude** : injecter `ANTHROPIC_API_KEY` au **runtime** (env/secret) pour le chemin SDK ;
  réserver `CLAUDE_CODE_OAUTH_TOKEN` / `claude setup-token` au CLI interactif. `~/.claude` en **volume
  nommé** (survit aux restarts). **Pas** de flow OAuth interactif (callback injoignable). **Jamais**
  de token bâti dans l'image ni committé. **Ne pas** monter `~/.ssh` ni creds cloud.
- **Cycle de vie (`cli.py`)** : aujourd'hui `serve` fait `uvicorn.run(host=127.0.0.1)` + `serve.pid`
  via `os.getpid()` + `_kill` par `taskkill` (win32). En conteneur : garder `host=127.0.0.1` (proxy
  co-localisé), mais **PID-tracking et `update --restart` intra-conteneur** (chemin POSIX `os.kill`,
  pas `taskkill`). **PID 1 = init** (`docker run --init` / tini, ENTRYPOINT exec-form) pour la
  propagation des signaux. *(Proxy intégré = un process : `update --restart` recharge tout le studio ;
  routes re-seedées au boot depuis `routes.json` ; le chat WS fait un blip rattrapé par « screen ».)*
- **Arrêt gracieux (12-factor IX, fondation ajoutée)** : sur SIGTERM, **drain lame-duck** — fermer les
  WS en vol avec `1001` (going-away) et flusher `routes.json` **avant** que uvicorn force-close.
- **`RouteController`** (interface **stable, versionnée, additive** A→E) : `upsert_route`
  (idempotent) / `remove_route` / `list_routes` / `resolve(host) → endpoint | None`. Persistance via
  le helper atomique partagé, **re-seed au boot**. Le modèle de route porte un champ `owner/tenant`
  **optionnel** dès A (inutilisé en solo) pour que le multi-tenant (phase E) n'impose pas de migration
  de `routes.json`. **Schéma versionné** (`schema_version`).

## 5. Socle conteneur (image + durcissement)

**Image** (Docker / OWASP / NIST 800-190) : build **multi-stage**, base **pinnée par digest**, user
**non-root**, `.dockerignore` strict, `HEALTHCHECK` (`/healthz` léger, **indépendant de la table de
routes**), **PID1 init** (signaux). Le CLI `claude` est **présent dans l'image** (version pinnée).

**Durcissement runtime — baseline A (cheap & stable ; template complet en E)** : `--cap-drop ALL`,
`--security-opt no-new-privileges`, `--pids-limit`, `--memory`/`--cpus`, seccomp `RuntimeDefault`
(jamais `unconfined`), **pas** de `docker.sock` monté, **pas** de `--privileged`/host-net, publish sur
**loopback** (`127.0.0.1:8777:8777`). Le profil PSS « Restricted » complet (read-only rootfs strict +
tmpfs, seccomp custom, rootless/userns) est un **template réservé à la phase E** (gratuit à compléter,
même set de flags appliqué à N conteneurs).

**Socle figé dans `compose.yml` versionné** : image studio + port `8777` + volumes nommés
(`~/.claude`, `.mekistudio/`) + bind-mount du code = source de vérité du socle immuable.

## 6. Gestion d'erreurs (fail-closed)

- Host inconnu / malformé → **404** (corps clair ; jamais de fallthrough ni de hang).
- Upstream injoignable → **502** ; échec/timeout au **CONNECT** upstream → **504** ; échec de
  handshake WS upstream → fermer le WS client en `1011`.
- Close codes WS : relayer transparemment ; quand **le proxy** ferme → `1001` (going-away :
  shutdown/route retirée), `1011` (erreur proxy/upstream), `1000` (session propre), `1008`/`1009`
  (policy/oversize). **Jamais** `1005`/`1006` sur le fil (réservés, RFC 6455 §7.4.1).
- `routes.json` : écriture atomique (crash entre write et rename ne corrompt jamais) ; fichier
  illisible au boot → log + démarrage table vide (corrupt-safe, comme le canvas).

## 7. Tests (TDD + e2e, alignés sur le design in-process)

- **Unitaires (fonctions pures, sans I/O)** : normalisation/parsing du Host (casse, port, IPv6,
  label vide, Host absent, userinfo, longueur, CR/LF) ; résolution `host → endpoint` ; default-deny ;
  politique de collision (`upsert` idempotent, last-write-wins) ; sanitization des en-têtes hop-by-hop ;
  cap de message ; check `Origin` basique.
- **Intégration proxy in-process** : tester le leg HTTP via `httpx.ASGITransport` / `TestClient`
  contre un **stub upstream** (flush chunk-par-chunk, pas de `Content-Length` sur chunké) ; tester le
  WS via `TestClient.websocket_connect` **contre la même app** (pas une 2ᵉ uvicorn) — 101 verbatim,
  relais transparent, close propre, annulation du pump frère, backpressure.
- **e2e Playwright DERRIÈRE le proxy** (mémoire projet « valider avec Playwright ») : tokens-live ;
  **detach/reattach à travers le proxy** (déconnexion mid-stream → reconnexion → replay-then-live,
  zéro perte/dup) ; **ajout de route pendant un streaming actif → zéro coupure WS** (test DoD) ;
  idle-keepalive (WS tenu ouvert au-delà du ping interval sans trafic app → reste ouvert).
- **Persistance** : round-trip `routes.json` (toute séquence upsert/remove → re-seed au boot identique).
- **Signaux** : SIGTERM → drain lame-duck + flush `routes.json` **testé** (pas seulement affirmé).

## 8. Hors-scope (différé, nommé explicitement)

| Élément | Phase | Note |
|---|---|---|
| `docker-py` (piloter Docker depuis Python) | **B** | En A, `compose.yml` + script suffisent (1 conteneur). |
| Conteneur-par-projet ; Protocol `ContainerBackend` | **B** | En A on **fige seulement la décision + le nom** ; le Protocol s'écrit au 1ᵉʳ implémenteur. |
| `X-Forwarded-*` / `Forwarded` (RFC 7239) complet | **C** | En A : sur le **leg tunnel** uniquement, stripper l'entrant et poser depuis le vrai socket ; pas de `--proxy-headers` sur le studio (in-process). |
| TLS/mkcert ; wildcard `*.<repo>.<domain>` vs `repo--service` (1 wildcard) | **C** | Schéma de nommage déjà compatible ; **décision wildcard à trancher en C**. |
| `421` (HTTP/2 coalescing) ; fallback path-based | **C** | En A, `404` + `127.0.0.1`/`Host`. |
| Auth multi-utilisateur, présence, multiplayer ; Origin-allowlist + token de session | **C/D** | Le *seam* Origin est posé en A. |
| `canUseTool` fin, audit `PostToolUse`, quotas, sandbox bash bubblewrap complet | **E** | En A, **la frontière conteneur EST la sécurité** + denyRead/env-scrub (§10). |
| Durcissement avancé (read-only strict, seccomp custom, rootless) | **E** | Baseline cheap en A (§5). |

## 9. Décisions « design now, implement later » (gravées, non codées en A)

- **`RouteController` versionné/stable** (A→E additive) ; `service_id` logique découplé de
  `host_pattern` et de l'endpoint physique (rebind B/C sans changer l'URL).
- **`ContainerBackend`** : figer la **décision** (couche d'exécution pluggable ; le control-plane qui
  détient le socket Docker/docker-py doit être **hors du blast-radius** d'un conteneur piloté par un
  agent) et le **nom** ; écrire le Protocol au 1ᵉʳ implémenteur (B).
- **Projet/tenant = frontière d'isolation primaire** dans le data model et le routage dès A :
  `routes.json` keyé pour qu'un tenant ne puisse jamais adresser le service interne d'un autre
  (champ `owner` présent ; enforcement réel en E).
- **Un template de durcissement** réutilisable (les flags de A) appliqué identiquement en A (1) et
  B/E (N). Forward-compat egress : modèle `init-firewall.sh` default-deny (conçu, activé en C/E).
- **Stockage long-lived keyé par projet/tenant** (volumes nommés) pour encoder la frontière B/E.
- **Une origine par service** (sous-domaine) dès A → cookies `Secure`/`SameSite` + CORS cohérents
  quand TLS arrive en C, sans redesign.
- **Namespace d'hôte** `<service>.<repo>.localhost` compatible wildcard TLS phase C.

## 10. Ce qu'on RÉUTILISE du SDK/Claude Code (au lieu de réinventer)

- **`sandbox.filesystem.denyRead`** = `[~/.claude, ~/.ssh, ~/.aws]` (la politique par défaut expose
  encore ces fichiers) + **`CLAUDE_CODE_SUBPROCESS_ENV_SCRUB`** (strippe les creds de l'env des
  sous-process bash) — **cheap, haute valeur, dès A**.
- **Permission modes** : faire tourner le chat en `default`/`acceptEdits` (déjà le cas) ; **verrouiller
  `bypassPermissions`** via managed-settings (`disableBypassPermissionsMode: disable`) ; règles dures
  en `deny` scopé (`Bash(curl:*)`, écritures hors repo) appliquées même en bypass.
- **Hooks `PreToolUse`/`PostToolUse`** : `backend/chat/guard.py` existe déjà — `make_repo_guard(repo_root)
  → pre_tool_use` (hook `PreToolUse`), posture **default-deny par outil** : seuls `Read/LS/Glob/Grep`
  passent, tout le reste (dont `Bash` et les écritures) est **refusé**, chemins confinés au repo, le
  guard ne lève jamais. En A : c'est déjà le bon socle « lecture seule ». Quand on **réactivera** des
  outils (write/bash, brique ultérieure), **étendre l'allowlist avec prudence** et garder le hook
  **non-bypassable** ; audit par tool-call via `PostToolUse` sur le `/ws/chat` existant ; `canUseTool`
  réservé aux requêtes « zone grise » remontées à l'UI.
- **Sandbox OS natif** (Seatbelt/bubblewrap) **si disponible**, en **défense en profondeur** *dans* le
  conteneur — **pas** un acquis (absent sur Windows natif → **la frontière reste le conteneur**, cf.
  `docs/sandbox-isolation-research.md`).
- Principe officiel : *« the agent runs INSIDE the isolation boundary »*.

## 11. Risques connus & mitigations

| Risque | Sévérité | Mitigation (gravée ci-dessus) |
|---|---|---|
| `update --restart` coupe le chat WS + perd les routes (proxy intégré) | Moyenne | Re-seed `routes.json` au boot ; drain lame-duck `1001` ; « screen » rattrape ; génération en cours perdue → **documenté**, pas promis. |
| Perf I/O 9p (bind-mount `C:\`) | Moyenne | Accepté en A ; **benchmark** `git status`/cold-start avant d'envisager le volume nommé. `routes.json` sur volume nommé (atomicité). |
| `*.localhost` KO pour curl/httpx **sur Windows** | Faible | Navigateur OK (le besoin) ; tests programmatiques via `127.0.0.1` + header `Host`. |
| On « possède » le tunnel WS (zone sensible #7/#8/#12) | Moyenne | TDD strict du relais + e2e Playwright (§7) ; relais transparent = pas de re-framing ; backpressure + annulation du pump frère. |
| Régression WS réveillée par l'étage proxy | Moyenne | Test de non-régression e2e derrière proxy ; pas de buffering/compression sur `/ws/chat`. |

## 12. Références

ASGI spec (Connection Scope, `more_body`) · RFC 6455 (WebSocket) · **RFC 9110** (HTTP semantics ;
421 §15.5.20) · **RFC 9112** (HTTP/1.1 ; connection/hop-by-hop §9.6) — *remplacent les RFC 7230/7235
obsolètes* · RFC 7239 (Forwarded, phase C) · nginx WebSocket proxying · Envoy xDS / HTTP upgrades ·
OWASP SSRF Prevention · OWASP Docker Security · OWASP CSWSH (WSTG) · CIS Docker Benchmark · NIST SP
800-190 · Kubernetes Pod Security Standards (Restricted) · 12-Factor App · httpx (async/streaming) ·
uvicorn settings (`--ws-max-size`, `--ws-ping-interval`) · FastAPI lifespan · Claude Code sandboxing ·
Agent SDK secure-deployment / permissions / hooks · Coder networking (wildcard access URL).

Internes : [`north-star`](2026-05-30-studio-conteneurise-north-star.md) ·
`docs/sandbox-isolation-research.md` · `docs/old/mekistudio/07-sandbox-docker.md`.
