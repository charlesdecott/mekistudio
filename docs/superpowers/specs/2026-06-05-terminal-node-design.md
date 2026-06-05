# Node terminal (shell PowerShell interactif) — design

**Date** : 2026-06-05 · **Branche** : `feat-terminals` · **Brique** : I

## 1. Objectif

Un **node terminal** sur le canvas : un vrai shell **PowerShell interactif** (PTY) qu'on
pilote depuis l'interface (taper des commandes, lancer un build/serveur, voir les logs en
direct, REPL, couleurs ANSI). Réutilise toute la plomberie temps-réel **déjà durcie du node
chat** (session détachée façon `screen`, manager dans `app.state`, WebSocket avec
`attach{since_seq}` + replay, queue-avec-drop), mais le « bridge » pilote un **PTY** (via
**pywinpty**) au lieu du Claude SDK, et le front est **xterm.js** au lieu des bulles de chat.

## 2. Décisions validées (brainstorm)

- **PTY interactif complet** (pas un command-runner) : vrai PowerShell, REPL/git/installeurs
  interactifs, ANSI, resize.
- **Session détachée + scrollback persisté disque** : le PTY vit dans `app.state` (survit au
  reload de page) ; le scrollback est aussi écrit sur disque (survit à un restart serveur —
  voir §6 pour la sémantique honnête).
- **v1 = 1 terminal built-in sous git** (`git → { chat, terminal, subcanvas }`) ; spawn
  multi reporté.
- **Shell réel, cwd = repo, aucune restriction** : honnête, c'est un vrai terminal sur la
  machine (pas de faux sandbox ; le sandbox conteneur reste la brique Docker mise de côté).
- **Transport** : approche « miroir du chat », **JSON + `seq`** (pas de base64 :
  `PtyProcess.read()` rend déjà un `str` décodé incrémentalement, voir §7).

## 3. Modèle de données

### `TerminalComponent` (`components/primitives.py`)

Calqué sur `ChatComponent` : ne porte que l'**identité**, pas les données (le scrollback vit
sur disque + se charge via la WebSocket, comme les messages du chat).

```python
class TerminalComponent(ComponentBase):
    type: Literal["terminal"] = "terminal"
    terminal_id: str = Field(default_factory=new_id)   # clé du PTY + dossier disque (stable, persisté)
    title: str = "terminal"
    shell: Literal["powershell"] = "powershell"        # extensible plus tard (cmd, bash…)
    cols: int = Field(default=80, ge=1, le=1000)        # dernière taille connue (init du PTY)
    rows: int = Field(default=24, ge=1, le=1000)
```

Ajout à l'union `Component` (discriminée sur `type`). Pas de `model_rebuild` propre (aucun
champ récursif) ; les `model_rebuild()` existants de Layout/NodeComponent capturent l'union
élargie au chargement du module.

### Node (`nodes/terminal.py`)

```python
KIND = "terminal"
def build_terminal_node(x=-440.0, y=560.0) -> Node:
    return Node(kind=KIND, x=x, y=y, w=560.0, h=340.0,
                movable=True, resizable=True, configurable=False,
                root=NodeComponent(children=[LayoutComponent(children=[TerminalComponent()])]))
```

Built-in → **non supprimable** (la route DELETE protège déjà les built-in). Réduction
(`collapsed`) gérée par le générique existant.

## 4. Backend — `backend/terminal/` (calque de `backend/chat/`)

### `ring.py` — module **pur** testable sans PTY

`ScrollbackRing(cap_chars=200_000)` : tampon borné de chunks `(seq, text)`.
- `append(text) -> dict` : assigne `seq` monotone, évince les plus vieux chunks entiers si le
  total dépasse `cap_chars`, renvoie `{"type":"output","seq":seq,"data":text}`.
- `since(seq) -> list[dict]` : chunks de `seq` strictement supérieur (pour le replay).
- `text() -> str` : concat de tous les chunks (pour la persistance disque).
- `load(text)` : amorce le ring depuis un texte persisté (un chunk `seq=1`, next=2).

Le `seq` permet le `attach{since_seq}` (reconnexion live = ne renvoyer que le nouveau).

### `store.py` — `TerminalStore`

Dossier `.mekistudio/terminals/<id>/` : `scrollback.txt` (le `ring.text()`, écrit
**atomiquement** via `.tmp`+`replace`) + `meta.json` (`shell`, `cols`, `rows`, `created_at_ms`).
- `load_scrollback() -> str` (vide si absent), `save_scrollback(text)`, `save_meta(dict)`,
  `meta() -> dict`. Tolérant (jamais d'exception sur fichier corrompu → défauts).

### `bridge.py` — `TerminalBridge`

Possède le process PTY (1 par `terminal_id`, dans `app.state`).
- **Spawn** : `PtyProcess.spawn([powershell, -NoLogo], cwd=repo_root, env=…,
  dimensions=(rows, cols))`. Échec spawn → état `error`, message diffusé, **jamais d'exception**
  qui tue la WS.
- **Reader thread** : boucle bloquante `p.read(4096)` ; chaque chunk est renvoyé sur la boucle
  asyncio via `loop.call_soon_threadsafe(self._on_output, chunk)`. `EOFError`/process mort →
  `call_soon_threadsafe(self._on_exit, code)`. **Tout** l'état (ring, abonnés, persistance) est
  muté **sur la boucle** → pas de verrou (asyncio mono-thread).
- **`attach(queue, since_seq, on_drop)`** : replay `ring.since(since_seq)` (put bloquant hors
  section critique), puis `attached` marker, puis abonnement live (calque exact du chat).
- **`write(data)`** : `p.write(data)` (input clavier).
- **`resize(cols, rows)`** : `p.setwinsize(rows, cols)` + met à jour le meta.
- **`_on_output(chunk)`** : `ring.append` → broadcast → planifie un flush disque **débouncé**
  (`time.monotonic`, au plus 1×/s ; flush aussi au détache/shutdown).
- **`_on_exit(code)`** : broadcast `{"type":"exit","code":code}`, marque mort ; le prochain
  `attach` (reload) **respawn** un shell frais (voir §6).
- **`shutdown()`** : stoppe le thread, `terminate()` le PTY, flush disque final.
- **broadcast non bloquant** : `put_nowait` ; `QueueFull` → désabonne + `drop.set()` (calque D17
  du chat : le client lent se reconnecte et rattrape par replay).

### `manager.py` — `TerminalManager` (dans `app.state`)

`get_or_create(terminal_id) -> TerminalBridge` (création paresseuse + `start()`),
`shutdown()` (arrêt propre de tous les bridges au lifespan). Calque de `ChatManager`.

### Protocole WebSocket — `/ws/term/{terminal_id}` (`routes/terminal_ws.py`)

| Sens | Message |
|---|---|
| client→serveur | `{"type":"attach","since_seq":N}` · `{"type":"input","data":str}` · `{"type":"resize","cols":C,"rows":R}` |
| serveur→client | `{"type":"output","seq":N,"data":str}` · `{"type":"attached"}` · `{"type":"exit","code":N}` |

Structure `sender`/`receiver` + `asyncio.wait(FIRST_COMPLETED)` + cleanup `unsubscribe`
**identique** à `chat_ws.py`. La déconnexion **ne détruit pas** le bridge.

### Wiring `app.py`

`app.state.terminal_manager = TerminalManager(repo_root)` ; lifespan : `await
app.state.terminal_manager.shutdown()` (à côté de `chat_manager.shutdown()`) ;
`app.include_router(terminal_ws.router)`.

### Registry / bootstrap / migration

- `registry.py` : import `terminal` ; `NODE_BUILDERS["terminal"]` ;
  `CANONICAL_PARENT_KIND["terminal"] = gitbranch.KIND` ; `default_canvas()` ajoute le terminal
  parenté à git.
- `bootstrap._ensure_builtin_nodes` : **migration automatique** — il injecte déjà tout kind
  built-in manquant depuis `default_canvas()`, donc le terminal apparaît dans les canvas
  existants sans code supplémentaire ; `reconcile_source_links` le relie à git.
- Câble dérivé `git → terminal` (par `source_id`).

## 5. Frontend — xterm.js vendoré

### Vendoring (`static/vendor/`)

`xterm.js` (UMD 5.5.0, expose `window.Terminal`), `xterm.css`, `xterm-addon-fit.js`
(expose `window.FitAddon.FitAddon`). Téléchargés localement (comme `marked`/`purify`) →
**aucune dépendance CDN au runtime**, déterministe pour Playwright. Chargés en `defer` dans
`canvas.html` **avant** `canvas.js` ; `<link>` vers `xterm.css`.

### `static/js/terminal-view.js` — script classique (`window.MekiTerminal`)

`mount(container, terminalId, component) -> { el, destroy }`, calqué sur `chat-view.js` :
- crée un `Terminal({ convertEol:false, fontFamily mono, theme sombre })` + `FitAddon`, l'ouvre
  dans un host ; `fit()` au montage et sur `ResizeObserver` du host.
- WebSocket `/ws/term/<id>` avec **generation guard**, backoff de reconnexion, `intentionalClose`
  (calque chat). À l'`open` : `attach{since_seq:lastSeq}`.
- `output` → `term.write(data)` + `lastSeq = seq` ; `attached` → marque live ; `exit` → écrit une
  ligne `\r\n[processus terminé — code N]\r\n`.
- `term.onData(d => sendWs({type:'input', data:d}))` (clavier → PTY).
- resize (fit) → `sendWs({type:'resize', cols, rows})` (débouncé léger).
- `destroy()` : `term.dispose()`, ferme la WS, coupe le backoff/observer → zéro fuite au
  re-render.
- Fallback si `window.Terminal` absent : message texte dans le host (comme l'éditeur/chat).

### `canvas.js`

- Branche `terminal` dans `renderComponent` → host `cmp-terminal-host` + `mountTerminal`.
- `mountTerminal(host, comp, node)` : `window.MekiTerminal.mount(...)` indexé dans
  **`_termViews[node.id]`**.
- **Destruction** aux mêmes endroits que `_chatViews` : `destroyViews` global (≈ lignes
  106-107) **et** `rerenderNode` (≈ ligne 1360) détruisent aussi `_termViews`.
- `el.addEventListener('wheel', stopPropagation)` (molette = scroll terminal, pas zoom canvas) ;
  `mousedown.stop` sur le host (le clavier va à xterm, pas au drag du node).

### `canvas.css`

`.cmp-terminal-host` : fond `#0b0e14`, `padding`, hauteur 100 %. xterm gère le reste via
`xterm.css`.

## 6. Sémantique de persistance (honnête)

- **Reload de page (même run serveur)** : le PTY **vit** dans `app.state` → reattach = replay du
  ring + live. Un build/serveur en cours **survit**.
- **Restart serveur** : le process PTY meurt (enfant du serveur — **impossible** à garder
  vivant). Ce qui survit = le **scrollback texte** persisté ; au premier `attach`, le bridge
  **charge l'historique** dans le ring (replay) **puis relance un shell frais**. Comme rouvrir un
  terminal : on voit le log d'avant, prompt neuf.
- **`exit` tapé** → ligne `[processus terminé]` ; un shell frais est relancé au prochain `attach`
  (reload). Bouton restart/clear explicite = futur.

## 7. Modèle de concurrence / threading

- `PtyProcess.read()` retourne un **`str` décodé incrémentalement** (l'UTF-8 multi-octets à
  cheval entre deux reads est géré par le décodeur interne) → **aucun risque de corruption**, et
  on transporte le `str` tel quel en JSON (**pas de base64**).
- **Seul** le reader thread fait du bloquant (`read`) ; il **ne mute rien** partagé — il poste
  vers la boucle via `call_soon_threadsafe`. Toute mutation d'état (ring/abonnés/persistance/
  write/resize) se fait **sur la boucle asyncio** → modèle mono-thread, pas de verrou.
- `write`/`setwinsize` appelés depuis la boucle pendant que le thread est en `read` : OK
  (pipes in/out distincts du ConPTY, usage standard ptyprocess).

## 8. Gestion d'erreurs

- Spawn PTY KO (shell introuvable, pywinpty absent) → état `error`, diffusion d'un message lisible
  dans le terminal, node rendu quand même, jamais d'exception qui tue la WS.
- Socket lent → drop + fermeture `1013` (calque chat), reconnexion + replay.
- xterm CDN/vendor absent → fallback texte dans le host.
- `canvas.json` jamais corrompu (built-in re-seedés, écriture atomique — invariants existants).

## 9. Posture de sécurité

Shell **réel non sandboxé**, cwd = racine du repo. C'est un choix **assumé** (machine de
l'utilisateur, studio auto-hébergé) : pas de faux sentiment de sandbox. Le confinement fort
(conteneur) reste la brique Docker explicitement mise de côté (`docs/old/.../07-sandbox-docker.md`).
Aucune entrée réseau distante ; la WS est servie en local (`127.0.0.1:8777`).

## 10. Stratégie de tests (TDD)

- **Pur / unit (pytest)** :
  - `ring.py` : `append`/`since`/`text`/`load`, monotonie du `seq`, éviction au-delà du cap.
  - `store.py` : round-trip scrollback + meta, tolérance fichier absent/corrompu.
  - `build_terminal_node` : contraintes (movable/resizable/non-configurable, non built-in
    supprimable).
  - `default_canvas` / `reconcile_source_links` : terminal présent, parenté à git.
  - `bootstrap` : canvas pré-terminal → injection auto du terminal (migration).
- **Node `--test` (front pur)** : aucun module pur front neuf nécessaire (la logique terminal est
  côté serveur) → pas de test JS pur ; la vue est couverte par Playwright.
- **Smoke réel pywinpty** (`@pytest.mark.integration` ou test dédié non-réseau) : spawn
  `powershell -Command "Write-Output meki-smoke"` → bytes reçus contenant `meki-smoke`
  (épingle l'API pywinpty, comme le smoke SDK du chat).
- **Playwright e2e** (`scripts/pw-terminal.mjs`) : node terminal rendu ; taper
  `echo meki-e2e` + Entrée → sortie `meki-e2e` visible ; reload → scrollback rejoué ;
  **0 erreur console**. Régénérer `canvas.json` live après changement de seed (mémoire
  `dev-loop-and-canvas-staleness`) ; valider après `uv tool install --editable . --force`
  **serveur arrêté** (pywinpty est natif — mémoire `global-tool-env-vs-project-venv`).

## 11. Hors périmètre v1 (futur)

Spawn de terminaux multiples à la demande · bouton clear/restart explicite · multi-shell
(cmd/bash/wsl) · réglages (`configurable`) · terminal *worktree-aware* (1 par worktree) ·
recherche/copier-coller avancés · liens cliquables (web-links addon).

## 12. Dépendance

`pywinpty` ajouté à `pyproject.toml` (`dependencies`). **Natif** → après `uv add`, refaire
`uv tool install --editable . --force` **serveur arrêté** (sinon « No module named winpty »
dans l'env du tool global).
