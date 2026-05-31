# Node chat × hooks Claude Code → impulsions — Spec 1 (F1 capture + panneau · F2 impulsions sur l'existant)

> **Statut** : design validé (brainstorming 2026-05-30). Brique **F** découpée en **2 specs** : ce
> doc couvre **F1 + F2** (capter les hooks, les rendre visibles, déclencher les impulsions déjà
> livrées sur les nodes **existants**). L'**auto-spawn d'éditeur** (F3) fait l'objet d'un spec séparé.

## 1. Contexte

Le node chat pilote une vraie session Claude (Claude Agent SDK, mode streaming-input). La brique D a
ajouté les outils **lecture seule** confinés (Read/Glob/Grep/LS) et leurs **tool-cards**. Le canvas
dispose déjà d'**impulsions** (`frontend/static/js/cables.js` + `canvas.js`) : **comète** le long des
câbles (`pathBetween` sur l'arbre `source_id`), **glow** doux/fort/notif sur un node, `firePulse`
(debug). Objectif de la brique F : **les hooks Claude Code déclenchent ces impulsions** pour que le
canvas « montre » ce que fait Claude, et un **panneau debug** rend le flux de hooks visible.

Vision globale F (validée) : impulsions + panneau debug + ouverture à de nouveaux effets. Découpage :
- **F1** — plomberie (capter les hooks) + panneau debug dans le node chat.
- **F2** — impulsions sur les nodes **existants** (réutilise comète/glow).
- **F3** — *(spec séparé)* auto-spawn d'un éditeur quand Claude lit un fichier non ouvert.

## 2. Objectifs / non-objectifs

**Objectifs** — capter le flux de hooks du SDK et le diffuser au front (**transients, non persistés**) ;
**panneau « hooks » repliable** dans le node chat (flux brut, debug) ; **impulsions** mappées sur les
nodes existants (comète chat→éditeur ouvert, glow explorateur, glow chat sur fin de tour / notif,
flash sur refus/erreur) ; mapping **event→impulsion** dans un **module pur testé** ; API hooks
**épinglée par un smoke**.

**Non-objectifs (F3 ou ultérieur)** — **pas d'auto-spawn** d'éditeur ni d'animation « trace le câble » ;
pas de TTL/épingle/dedup ; pas de réglages du node chat (mode de spawn) ; pas de panneau « hooks » en
**node dédié** (plus tard ; ici c'est un volet du chat) ; pas de QCM/askUser interactif (brique E ;
on prévoit seulement le glow-notif persistant). Pas de Write/Edit/Bash (brique Docker).

## 3. Exigences

| # | Exigence | Détail |
|---|----------|--------|
| F1.1 | **Capture hooks** | `build_options(repo_root, store, on_hook)` enregistre des **hooks émetteurs** (même mécanisme `HookMatcher` que le guard, prouvé en brique D) pour PreToolUse *(à côté du guard)*, PostToolUse, Stop, Notification, et les autres types visibles. Chaque émetteur appelle `on_hook(name, data)` et renvoie `{}` ; **ne lève jamais**. |
| F1.2 | **Diffusion** | Le bridge expose `on_hook` ; il diffuse `events.hook_fired(name, data)` (**transient**). Aussi `events.turn_end(status)` émis dans `_end_turn`. Aucun n'est dans `DURABLE_TYPES` → **jamais persistés** (comme `text_delta`). |
| F1.3 | **Panneau hooks** | `chat-view.js` ajoute un volet « hooks » **repliable** au node chat (même esprit que le bloc tool-cards), **replié par défaut**, alimenté par `hook_fired` : ligne = `nom · outil · horodatage` (+ 🚫 si refusé). Live-only (vidé au reload, c'est un moniteur). |
| F2.1 | **Module mapping pur** | Nouveau `frontend/static/js/chat-impulses.js` (`window.MekiImpulses`, script classique, testé `node --test`) : fonction pure `impulseFor(ev) -> intent | null` où `intent = {kind:'comet'|'glow', target:{by:'file'|'kind'|'node', value}, level:'soft'|'strong'|'notif'|'error', dismissable?:bool}`. |
| F2.2 | **Déclenchement** | `chat-view.js` **enrichit** un `tool_result` avec `{name, file_path}` (lookup `state.toolsById[ev.id]`, car `tool_result` ne porte que `{id, output, is_error}`), passe l'event enrichi à `MekiImpulses.impulseFor`, et dispatch `CustomEvent('meki:impulse', {detail:intent})`. `canvas.js` écoute, **résout le node cible** et déclenche `animateComet`/`glow` existants. Cible introuvable → **no-op** (ne casse pas). |
| F2.3 | **Mapping (events fiables)** | Voir §4. Les impulsions roulent sur `tool_use`/`tool_result` (déjà émis, brique D) + `turn_end` + `hook_fired(Notification)` — **indépendant** de la capture incertaine des autres hooks. |
| F2.4 | **Glow dismissable** | `Stop` → glow **fort** sur le chat ; **clic sur le node chat** → `clearGlow` (acquittement). `Notification` → glow-**notif** persistant ; clic = éteint. *(askUser persistera jusqu'à réponse → brique E, hors scope.)* |
| F2.5 | **Concurrence** | Les comètes sont **concurrentes** (`canvas._activePulses`, plusieurs en vol en même temps) ; garde-fou à **24** simultanées pour ne pas s'emballer sur une rafale de tools parallèles (au-delà, ignorées). Les glows ne sont pas bloquants. Le hook émetteur est **non bloquant** (`put_nowait` → `{}`), donc l'animation ne ralentit jamais les outils de Claude. |
| F1.4 | **Smoke d'API hooks** | Test d'intégration `@pytest.mark.integration` (réel SDK, repo tmp, `setting_sources=[]`) : **quels hooks émettent** en session lecture seule, **forme de leur `data`**, et si `[guard, émetteur]` sur PreToolUse **s'exécutent tous deux**. Fige les noms d'attributs (comme le smoke outils D9). |

## 4. Mapping hook/event → impulsion

Source d'événement (fiable, déjà diffusé sauf `turn_end`/`Notification`) → effet :

| Déclencheur | Condition | Impulsion |
|---|---|---|
| `tool_result(is_error=False)` d'un `tool_use` Read/Grep | un **éditeur a ce `file_path` ouvert** | **comète** chat → éditeur, **glow fort vert** à l'arrivée |
| idem | **aucun éditeur** pour ce fichier | **glow doux** sur l'explorateur *(F3 fera le spawn)* |
| `tool_use` Glob/LS | — | **glow doux** sur l'explorateur (pas de fichier unique) |
| `tool_result(is_error=True)` | refus hors-repo (guard) **ou** échec outil | **flash rouge** (glow `error`) sur le chat |
| `turn_end` | fin de tour (Stop) | **glow fort** sur le chat ; **clic node = éteint** |
| `hook_fired(name='Notification')` | Claude demande attention | **glow-notif** persistant sur le chat ; clic = éteint |
| autres `hook_fired` (Pre/PostToolUse bruts, Subagent\*, UserPromptSubmit, PreCompact, PermissionRequest) | — | **panneau debug uniquement**, pas d'impulsion |

Note : `impulseFor` est **pur** — il reçoit l'event **enrichi** (`tool_result` complété par
`{name, file_path}` issu de `toolsById`, cf. F2.2) ; aucune dépendance à un état global.

Résolution de cible (`canvas.js`) : éditeur par `file_path` = `.node-wrap[data-kind="fileEditor"]` dont
le composant `EditorComponent.file_path` correspond (lu via `dataset`/état canvas) ; explorateur = le
node `fileExplorer` ; chat = le node `chat`. La comète emprunte `MekiCables.pathBetween` (arbre
`source_id`) déjà utilisé par `firePulse`.

## 5. Flux de données

```
hook SDK ──(émetteur)──> bridge.on_hook ──> _broadcast(hook_fired) ─┐
_end_turn ──────────────────────────────> _broadcast(turn_end) ────┤   (transients, non persistés)
tool_use / tool_result (déjà brique D) ────────────────────────────┘
        │
        ▼  WS
   chat-view.js
     ├─ hook_fired ........ append au volet « hooks » (F1)
     └─ MekiImpulses.impulseFor(ev) -> intent -> CustomEvent('meki:impulse')
                                                    │
                                                    ▼
                                               canvas.js : résout le node cible -> animateComet / glow
                                               (clic chat -> clearGlow)
```

## 6. Risques / points durs

- 🛡️ **Comportement SDK des hooks non-PreToolUse** : non vérifié (la brique D n'a prouvé que
  PreToolUse). **Mitigation** : les impulsions F2 ne dépendent **pas** de la capture (elles roulent sur
  `tool_use`/`tool_result`/`turn_end` fiables) ; seul `Notification` et le **panneau** dépendent de
  `hook_fired`. Le **smoke** (F3.x) pinne ce qui marche **avant** de coder le front ; si un type de hook
  n'émet pas, le panneau l'omet (pas de régression des impulsions).
- 🛡️ **Contexte d'exécution des hooks** : les callbacks tournent dans la **même boucle asyncio** que
  `_consume` (connexion SDK partagée) → `on_hook` fait un `put_nowait` non bloquant, sûr (pas de verrou
  requis, cohérent avec le guard).
- **Ordre `[guard, émetteur]` sur PreToolUse** : si le SDK n'exécute pas tous les hooks d'une liste, le
  smoke le révèle ; repli = un seul hook PreToolUse qui fait confinement **et** émet.
- **Rafale de comètes** : **concurrentes** (`_activePulses`), plafonnées à 24 simultanées (au-delà,
  ignorées). Chaque comète anime ses propres éléments SVG ; les segments d'UNE comète restent
  séquentiels. Les glows restent visibles.
- **Volet hooks live-only** : non persisté → vide au reload (cohérent « moniteur debug »). Pas de
  réplay d'impulsions (transients).

## 7. Tests

- **Smoke** (`tests/integration/test_sdk_hooks_smoke.py`, `@pytest.mark.integration`, repo tmp,
  `setting_sources=[]`) : un tour à 1 Read + fin de tour → capture des `hook_fired` reçus (noms +
  formes), vérifie qu'au moins PreToolUse/PostToolUse émettent et que le guard tourne toujours. Fige
  les noms d'attributs. *(xfail tolérant si un type n'émet pas — documente le réel.)*
- **pytest** (`test_chat_bridge.py`, `test_chat_events.py`) : `on_hook` → `hook_fired` diffusé et
  **non persisté** ; `turn_end` diffusé en fin de tour et **non persisté** ; `hook_fired`/`turn_end`
  absents de `DURABLE_TYPES` et de `read_since`.
- **node --test** (`chat-impulses.test.js`) : `impulseFor` — `tool_result(Read, is_error=False)` +
  éditeur connu → `{comet, target:file}` ; sans éditeur → `{glow, target:explorer, soft}` ; Glob →
  `{glow, explorer, soft}` ; `is_error=True` → `{glow, chat, error}` ; `turn_end` → `{glow, chat,
  strong, dismissable}` ; `Notification` → `{glow, chat, notif, dismissable}` ; autres → `null`.
- **Playwright** : tour réel (lire 1 fichier ouvert dans un éditeur → comète visible ; lire un fichier
  non ouvert → glow explorateur ; fin de tour → glow chat, clic = éteint ; volet hooks rempli) ;
  **0 erreur console** ; screenshots avant/après.

## 8. Fichiers touchés

- **Backend** : `mekistudio/backend/chat/options.py` (`build_options(..., on_hook)` + fabrique
  d'émetteurs), `mekistudio/backend/chat/bridge.py` (`on_hook`, `_broadcast(hook_fired)`, `turn_end`
  dans `_end_turn`), `mekistudio/backend/chat/events.py` (`hook_fired`, `turn_end` transients).
  `guard.py` inchangé.
- **Frontend** : `mekistudio/frontend/static/js/chat-impulses.js` *(nouveau, pur)*,
  `mekistudio/frontend/static/js/chat-impulses.test.js` *(nouveau)*,
  `chat-view.js` (volet hooks + dispatch), `canvas.js` (écoute `meki:impulse`, résolution cible, clic
  chat = `clearGlow`), `canvas.css` (styles volet hooks + variante glow `error`).
- **Tests** : `tests/integration/test_sdk_hooks_smoke.py` *(nouveau)*, `tests/unit/test_chat_bridge.py`,
  `tests/unit/test_chat_events.py`.
- **Chargement** : `templates/canvas.html` charge `chat-impulses.js` **avant** `canvas.js` (comme
  `cables.js`/`collision.js`).

## 9. Suite (hors ce spec)

**Spec 2 — F3 (auto-spawn éditeur)** : lire un fichier **non ouvert** → la comète **trace le câble** +
**spawn** un node fileEditor (`source_id = chat` pour que la comète dessine le câble chat→éditeur),
**dedup** par `file_path`, **éphémère** par défaut (TTL ~5 min, **clic = épingle** → persisté), modes
**configurables** dans les réglages du node chat (éphémère / plafond+recyclage FIFO / illimité). Rend
le node chat `configurable`. Étend le mapping §4 (cas « fichier non ouvert » → spawn au lieu du repli).
