# Plan d'implémentation — node terminal (brique I)

Spec : [`../specs/2026-06-05-terminal-node-design.md`](../specs/2026-06-05-terminal-node-design.md).
Branche : `feat-terminals`. Runner tests : `uv run --extra dev pytest -q`. Baseline : 170 passed.
TDD strict : test ROUGE d'abord, puis impl VERTE, puis commit. Un commit par brique cohérente.

## Brique 0 — dépendance (fait)

- `pyproject.toml` : `pywinpty>=2.0 ; sys_platform == 'win32'` ; `uv sync` → `.venv` (pywinpty 3.0.3 OK).
- Live/Playwright : `uv tool install --editable . --force` **serveur arrêté** (avant la brique 9).
- Commit : `chore(brique I): dépendance pywinpty (PTY Windows)`.

## Brique 1 — `TerminalComponent` (primitive)

- **Test** (`tests/unit/test_components.py`) : un `TerminalComponent()` a `type=="terminal"`,
  défauts (`shell=="powershell"`, `cols==80`, `rows==24`, `terminal_id` non vide) ; round-trip
  via l'union (`Component`) en parsant `{"type":"terminal",...}` → instance correcte ; bornes
  cols/rows (1..1000).
- **Impl** : `primitives.py` → classe `TerminalComponent` + ajout à l'union `Component`.
- Commit : `feat(brique I): TerminalComponent (primitive)`.

## Brique 2 — node terminal + registry + parentage

- **Test** (`tests/unit/test_nodes.py`) : `build_terminal_node()` → `kind=="terminal"`,
  `movable`/`resizable` True, `configurable` False, contient un `TerminalComponent` ;
  `default_canvas()` contient un terminal **parenté au git** (`source_id == git.id`) ;
  `reconcile_source_links` repose `git → terminal` même si `source_id` cassé.
- **Impl** : `nodes/terminal.py` (`KIND`, `build_terminal_node`) ; `nodes/__init__.py` export ;
  `registry.py` : import, `NODE_BUILDERS`, `CANONICAL_PARENT_KIND["terminal"]=gitbranch.KIND`,
  `default_canvas()` (ajoute `t`, `t.source_id=g.id`).
- Commit : `feat(brique I): node terminal + câblage registry (git → terminal)`.

## Brique 3 — migration auto (test seul)

- **Test** (`tests/unit/test_bootstrap.py`) : un `canvas.json` SANS terminal (built-in
  pré-brique-I) → après `ensure_meki_dir`/`_ensure_builtin_nodes`, le terminal est injecté et
  parenté à git ; ids des autres nodes inchangés.
- **Impl** : aucune (automatique via `_ensure_builtin_nodes`) — le test épingle le comportement.
- Commit : `test(brique I): migration auto du node terminal`.

## Brique 4 — `ScrollbackRing` (pur)

- **Test** (`tests/unit/test_terminal_ring.py`) : `append` assigne un `seq` croissant et renvoie
  `{"type":"output","seq","data"}` ; `since(seq)` ne renvoie que les chunks `> seq` ; `text()`
  concatène ; éviction : au-delà de `cap_chars`, les plus vieux chunks entiers sont retirés mais
  `text()` reste ≤ cap (à un chunk près) et le dernier chunk est toujours conservé ; `load(text)`
  amorce un ring (since(0) renvoie l'historique).
- **Impl** : `backend/terminal/__init__.py`, `backend/terminal/ring.py`.
- Commit : `feat(brique I): ScrollbackRing pur (seq + éviction bornée)`.

## Brique 5 — `TerminalStore`

- **Test** (`tests/unit/test_terminal_store.py`) : `save_scrollback`/`load_scrollback`
  round-trip (UTF-8) ; `save_meta`/`meta` round-trip ; fichiers absents → `""`/défauts ;
  écriture atomique (pas de `.tmp` résiduel) ; dossier `.mekistudio/terminals/<id>/`.
- **Impl** : `backend/terminal/store.py`.
- Commit : `feat(brique I): TerminalStore (scrollback + meta persistés)`.

## Brique 6 — `TerminalBridge` + `TerminalManager` + smoke pywinpty

- **Test** (`tests/unit/test_terminal_bridge.py`, async) : crée un bridge (cwd=tmp), `attach`
  une queue, soumet `write("Write-Output meki-smoke\r\n")`, draine la queue jusqu'à recevoir un
  `output` contenant `meki-smoke` (timeout borné) ; `resize(120,40)` ne lève pas ; `shutdown()`
  arrête proprement (PTY plus alive) ; scrollback persisté non vide. Skip propre si `import
  winpty` échoue (`pytest.importorskip("winpty")`).
  + `TerminalManager.get_or_create` renvoie le même bridge pour le même id.
- **Impl** : `backend/terminal/options.py` (resolve shell+cwd+env), `bridge.py`, `manager.py`.
- Commit : `feat(brique I): TerminalBridge (PTY pywinpty détaché) + manager + smoke`.

## Brique 7 — WebSocket `/ws/term` + wiring app

- **Test** (`tests/unit/test_terminal_ws.py`) : `TestClient.websocket_connect("/ws/term/<id>")`,
  envoyer `attach{since_seq:0}`, `input{"Write-Output meki-ws\r\n"}`, lire les messages jusqu'à
  un `output` contenant `meki-ws` ; `importorskip("winpty")`. `app.state.terminal_manager`
  présent.
- **Impl** : `routes/terminal_ws.py` (calque `chat_ws.py`) ; `app.py` (manager + lifespan +
  include_router).
- Commit : `feat(brique I): WebSocket /ws/term + wiring app.state`.

## Brique 8 — front xterm (vue + branche + html + css)

- Vendoring déjà fait (`static/vendor/xterm.js`, `xterm.css`, `xterm-addon-fit.js`).
- **Impl** : `static/js/terminal-view.js` (`window.MekiTerminal.mount`) ; `canvas.js` (branche
  `terminal` dans `renderComponent`, `mountTerminal`, `_termViews`, destruction dans
  `destroyViews` + `rerenderNode`) ; `canvas.html` (scripts vendor + `<link>` css + chargement
  `terminal-view.js`) ; `canvas.css` (`.cmp-terminal-host`).
- Commit : `feat(brique I): vue xterm.js (terminal-view) + branche renderComponent + vendoring`.

## Brique 9 — régénération canvas.json + Playwright

- `uv tool install --editable . --force` (serveur arrêté), relancer `mekistudio serve`, hard
  refresh → `.mekistudio/canvas.json` régénéré avec le terminal (mémoire `dev-loop`).
- **Test** (`scripts/pw-terminal.mjs`) : node terminal visible ; focus + taper
  `echo meki-e2e` + Entrée → `meki-e2e` apparaît dans le terminal ; reload → scrollback rejoué ;
  **0 erreur console** ; screenshot.
- Commit : `test(brique I): validation Playwright (echo, reload, 0 erreur console)`.

## Brique 10 — docs

- `docs/ROADMAP.md` (brique I livrée + coche « Terminaux »), `docs/ARCHITECTURE.md` (backend
  terminal, route WS, front, invariants), `CLAUDE.md` (topologie `git → { chat, terminal,
  subcanvas }`).
- Commit : `docs(brique I): node terminal (roadmap, archi, topologie)`.

## Vérification finale

- `uv run --extra dev pytest -q` tout vert (+ nouveaux tests).
- `node --test` des modules JS purs inchangés (non impactés).
- **Workflow de revue adversariale** (correctness / sécurité / réutilisation) sur le diff,
  corriger les findings réels, re-Playwright.
- `superpowers:finishing-a-development-branch`.
