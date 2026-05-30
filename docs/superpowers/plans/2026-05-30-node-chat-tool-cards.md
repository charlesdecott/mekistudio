# Tool-cards lecture seule (brique D) · Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development ou superpowers:executing-plans. Steps en `- [ ]`.

**Goal:** Rallumer des outils **lecture seule** (Read/Glob/Grep/LS) **confinés au repo** dans le node chat, et afficher chaque appel comme une **tool-card** (mode C log terminal) appariée par `tool_use_id`, avec persistance/replay.

**Architecture:** Confinement via **hook `PreToolUse` durci** (jamais court-circuité) + `cwd=repo_root` + `allowed_tools`. Le bridge passe en **multi-étapes** (finalise chaque `AssistantMessage`, balaye les outils orphelins en fin de tour). Nouveaux events durables `tool_use`/`tool_result`. Front : réducteur pur `toolsById` + rendu mode C.

**Tech Stack:** claude-agent-sdk (hooks/tools), Pydantic, asyncio ; front DOM impératif + `node --test` ; Playwright (script Node) pour la validation.

**Spec :** [`docs/superpowers/specs/2026-05-30-node-chat-tool-cards-design.md`](../specs/2026-05-30-node-chat-tool-cards-design.md). Décisions `Dn`.

## Carte des fichiers
- **+** `mekistudio/backend/chat/guard.py` — `make_repo_guard(repo_root)` (hook PreToolUse durci, default-deny).
- **~** `mekistudio/backend/chat/events.py` — builders `tool_use`/`tool_result` + `DURABLE_TYPES`.
- **~** `mekistudio/backend/chat/options.py` — config read-only + hook + `cwd`/`allowed_tools`/`setting_sources` ; `build_options(repo_root, store)` ; adaptateur `_SdkClient` → events `tool_use`/`tool_result` + `_tool_output`.
- **~** `mekistudio/backend/chat/bridge.py` — `repo_root` ; `_consume` multi-étapes (`_finalize_step`/`_end_turn`) ; balayage orphelins.
- **~** `mekistudio/backend/chat/manager.py` — passe `repo_root` au bridge.
- **~** `mekistudio/frontend/static/js/chat-model.js` (+ `.test.js`) — `toolsById`, pairing.
- **~** `mekistudio/frontend/static/js/chat-view.js` — `TOOL_META`/`fileArg`, rendu mode C ; **~** `canvas.css`.
- **+** `tests/integration/test_sdk_tools_smoke.py`, `tests/unit/test_chat_guard.py` ; **~** `tests/unit/test_chat_bridge.py`.

---

## Phase 1 — events + guard (headless TDD)

### Task 1 : `events.py` — builders tool

**Files:** Modify `mekistudio/backend/chat/events.py` · Test `tests/unit/test_chat_events.py`

- [ ] **Test** (ajouter à `test_chat_events.py`) :
```python
def test_tool_builders():
    tu = events.tool_use("id1", "Read", {"file_path": "a.py"})
    assert tu == {"type": "tool_use", "ts": tu["ts"], "id": "id1", "name": "Read", "input": {"file_path": "a.py"}}
    tr = events.tool_result("id1", "73 lignes", False)
    assert tr["type"] == "tool_result" and tr["id"] == "id1" and tr["output"] == "73 lignes" and tr["is_error"] is False
    assert {"tool_use", "tool_result"} <= events.DURABLE_TYPES
```
- [ ] **Run** : `uv run pytest tests/unit/test_chat_events.py -q` → FAIL.
- [ ] **Impl** — dans `events.py`, ajouter à `DURABLE_TYPES` `"tool_use","tool_result"`, et :
```python
def tool_use(id: str, name: str, input: dict) -> dict:
    return {"type": "tool_use", "ts": now_ms(), "id": id, "name": name, "input": input}

def tool_result(id: str, output: str, is_error: bool) -> dict:
    return {"type": "tool_result", "ts": now_ms(), "id": id, "output": output, "is_error": is_error}
```
- [ ] **Run** → PASS. **Commit** : `git add -A && git commit -m "feat(chat): events tool_use/tool_result"`.

### Task 2 : `guard.py` — hook PreToolUse durci

**Files:** Create `mekistudio/backend/chat/guard.py` · Test `tests/unit/test_chat_guard.py`

- [ ] **Test** `tests/unit/test_chat_guard.py` :
```python
from pathlib import Path
from mekistudio.backend.chat.guard import make_repo_guard


def _deny(r): return r.get("hookSpecificOutput", {}).get("permissionDecision") == "deny"


async def _call(guard, name, **inp):
    return await guard({"tool_name": name, "tool_input": inp}, "tid", None)


async def test_guard_confines_to_repo(tmp_path):
    g = make_repo_guard(tmp_path)
    # in-repo (relatif & absolu) -> allow ({})
    assert await _call(g, "Read", file_path="sub/a.py") == {}
    assert await _call(g, "Read", file_path=str(tmp_path / "a.py")) == {}
    # hors-repo / .. -> deny
    assert _deny(await _call(g, "Read", file_path="C:/Windows/hosts"))
    assert _deny(await _call(g, "Read", file_path="../../secret"))
    # chemin manquant / vide / non-string -> deny (Read exige file_path)
    assert _deny(await _call(g, "Read"))
    assert _deny(await _call(g, "Read", file_path=""))
    assert _deny(await _call(g, "Read", file_path=["x"]))
    # outil hors liste lecture -> deny (ceinture)
    assert _deny(await _call(g, "Bash", command="ls"))
    # Glob/Grep : sans path -> allow (cwd=repo) ; pattern/glob absolu hors-repo -> deny
    assert await _call(g, "Glob", pattern="src/**") == {}
    assert _deny(await _call(g, "Glob", pattern="C:/Windows/**"))
    assert _deny(await _call(g, "Grep", pattern="x", glob="C:/etc/**"))
    assert await _call(g, "Grep", pattern="x") == {}  # pattern=regex de contenu, pas un chemin
```
- [ ] **Run** : `uv run pytest tests/unit/test_chat_guard.py -q` → FAIL (module absent).
- [ ] **Impl** `mekistudio/backend/chat/guard.py` :
```python
from __future__ import annotations
from pathlib import Path

READ_TOOLS = {"Read": "file_path", "LS": "path", "Glob": "path", "Grep": "path"}
EXTRA_PATH = {"Glob": ["pattern"], "Grep": ["glob"]}  # champs additionnels pouvant porter un chemin
PATH_OPTIONAL = {"Glob", "Grep"}                       # path absent -> défaut = cwd = repo


def _inside(root: Path, candidate) -> bool:
    if not isinstance(candidate, str) or candidate == "":
        return False
    try:
        (root / candidate).resolve().relative_to(root)
        return True
    except (ValueError, TypeError, OSError):
        return False


def _deny(msg: str) -> dict:
    return {"hookSpecificOutput": {"hookEventName": "PreToolUse",
                                   "permissionDecision": "deny", "permissionDecisionReason": msg}}


def make_repo_guard(repo_root: Path):
    """Hook PreToolUse : default-deny par outil, ne lève jamais. {} = laisse l'in-repo passer."""
    root = Path(repo_root).resolve()

    async def pre_tool_use(input_data, tool_use_id, context):
        name = input_data.get("tool_name")
        tool_input = input_data.get("tool_input") or {}
        if name not in READ_TOOLS:
            return _deny(f"Outil « {name} » non autorisé (lecture seule).")
        key = READ_TOOLS[name]
        primary = tool_input.get(key)
        if primary in (None, "") and name not in PATH_OPTIONAL:
            return _deny("Chemin manquant.")
        fields = ([key] if primary not in (None, "") else []) + EXTRA_PATH.get(name, [])
        for field in fields:
            val = tool_input.get(field)
            if val in (None, ""):
                continue
            if not _inside(root, val):
                return _deny(f"« {val} » ({field}) est hors du dossier du projet.")
        return {}

    return pre_tool_use
```
- [ ] **Run** → PASS. **Commit** : `git add -A && git commit -m "feat(chat): guard PreToolUse confine au repo (durci, default-deny)"`.

## Phase 2 — options + bridge multi-étapes

### Task 3 : `options.py` — config read-only + hook + adaptateur tool

**Files:** Modify `mekistudio/backend/chat/options.py`

- [ ] **Impl** — `build_options` (signature `(repo_root, store)`) :
```python
def build_options(repo_root, store):
    from claude_agent_sdk import ClaudeAgentOptions, HookMatcher
    from mekistudio.backend.chat.guard import make_repo_guard
    return ClaudeAgentOptions(
        cwd=str(repo_root),
        tools=["Read", "Glob", "Grep", "LS"],
        allowed_tools=["Read", "Glob", "Grep", "LS"],
        permission_mode="default",
        hooks={"PreToolUse": [HookMatcher(matcher=None, hooks=[make_repo_guard(repo_root)])]},
        setting_sources=[],
        include_partial_messages=True,
        resume=store.meta().get("claude_session_id"),
    )
```
Ajouter le helper de coercion + étendre `_SdkClient.receive` :
```python
def _tool_output(content) -> str:
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    return "".join(b.get("text", "") for b in content if isinstance(b, dict))[:4000]  # borne


# dans _SdkClient.receive(), brancher :
#   AssistantMessage -> yield {"kind":"assistant", "text": <concat TextBlock>,
#                              "tools": [{"id":b.id,"name":b.name,"input":b.input}
#                                        for b in content if type(b).__name__=="ToolUseBlock"]}
#   UserMessage      -> pour chaque b in content si type(b).__name__=="ToolResultBlock":
#                         yield {"kind":"tool_result","id":b.tool_use_id,
#                                "output":_tool_output(b.content),"is_error":bool(getattr(b,"is_error",False))}
```
> ⚠️ Noms d'attributs (`ToolUseBlock.id/.name/.input`, `ToolResultBlock.tool_use_id/.content/.is_error`) **figés par le smoke (Phase 0, Task 7)** — ajuster si l'observation diffère. Le smoke est lancé AVANT de figer ce code en prod, mais l'adaptateur est écrit ici pour que les tests bridge (faux client) tournent.

- [ ] **Commit** (avec Task 4, le bridge en dépend).

### Task 4 : `bridge.py` — multi-étapes + orphelins

**Files:** Modify `mekistudio/backend/chat/bridge.py` · Test `tests/unit/test_chat_bridge.py`

- [ ] **Test** (ajouter) — multi-étapes + orphelin + non-régression :
```python
async def test_multistep_turn_with_tool(tmp_path):
    store = ConversationStore(tmp_path, "ct1")
    # étape 1 : texte + un tool_use ; tool_result ; étape 2 : texte final
    script = [
        {"kind": "message_start"}, {"kind": "delta", "text": "Je lis"},
        {"kind": "assistant", "text": "Je lis", "tools": [{"id": "X", "name": "Read", "input": {"file_path": "a.py"}}]},
        {"kind": "tool_result", "id": "X", "output": "73 l.", "is_error": False},
        {"kind": "message_start"}, {"kind": "delta", "text": "Fait"},
        {"kind": "assistant", "text": "Fait", "tools": []},
        {"kind": "result", "subtype": "success", "session_id": "s"},
    ]
    bridge = ChatBridge("ct1", store, _factory([script]), repo_root=tmp_path)
    await bridge.start()
    q = asyncio.Queue(); await bridge.attach(q, 0); await bridge.submit_prompt("lis a.py")
    await _drain_until(q, "tool_result")
    recs = await store.read_since(0)
    kinds = [r["type"] for r in recs]
    assert kinds.count("assistant_message") == 2
    assert any(r["type"] == "tool_use" and r["id"] == "X" and r["name"] == "Read" for r in recs)
    assert any(r["type"] == "tool_result" and r["id"] == "X" and r["is_error"] is False for r in recs)
    await bridge.shutdown()


async def test_orphan_tool_closed_on_turn_end(tmp_path):
    store = ConversationStore(tmp_path, "ct2")
    # tool_use sans tool_result, puis result -> tool_result synthétique is_error
    script = [
        {"kind": "message_start"}, {"kind": "delta", "text": "lis"},
        {"kind": "assistant", "text": "lis", "tools": [{"id": "Y", "name": "Read", "input": {"file_path": "a.py"}}]},
        {"kind": "result", "subtype": "error_during_execution", "session_id": "s"},
    ]
    bridge = ChatBridge("ct2", store, _factory([script]), repo_root=tmp_path)
    await bridge.start()
    q = asyncio.Queue(); await bridge.attach(q, 0); await bridge.submit_prompt("go")
    await _drain_until(q, "tool_result")
    recs = await store.read_since(0)
    assert any(r["type"] == "tool_result" and r["id"] == "Y" and r["is_error"] is True for r in recs)
    await bridge.shutdown()


async def test_text_only_turn_unchanged(tmp_path):  # non-régression squelette
    store = ConversationStore(tmp_path, "ct3")
    script = [
        {"kind": "message_start"}, {"kind": "delta", "text": "Bonjour"},
        {"kind": "assistant", "text": "Bonjour", "tools": []},
        {"kind": "result", "subtype": "success", "session_id": "s"},
    ]
    bridge = ChatBridge("ct3", store, _factory([script]), repo_root=tmp_path)
    await bridge.start()
    q = asyncio.Queue(); await bridge.attach(q, 0); await bridge.submit_prompt("salut")
    await _drain_until(q, "message_stop")
    recs = await store.read_since(0)
    assert [r["type"] for r in recs].count("assistant_message") == 1
    assert all(r["type"] not in ("tool_use", "tool_result") for r in recs)
    await bridge.shutdown()
```
> Le `FakeClient` de `test_chat_bridge.py` doit accepter `{"kind":"assistant","tools":[…]}` et `{"kind":"tool_result",…}` (il yield les events tels quels). Et `ChatBridge(... , repo_root=...)`.
- [ ] **Run** → FAIL.
- [ ] **Impl** — modifs `bridge.py` :
  - `__init__(... , repo_root=None)` : stocker `self._repo_root = repo_root` ; ajouter `self._step_finalized = False`, `self._turn_finalized = False`, `self._turn_tool_ids: set = set()`, `self._turn_tool_results: set = set()` ; supprimer l'usage per-tour de `_final_text`.
  - `start()` : `options = build_options(self._repo_root, self._store)`.
  - `_start_turn()` : ajouter `self._turn_finalized = False; self._step_finalized = False; self._turn_tool_ids.clear(); self._turn_tool_results.clear()` ; retirer `self._final_text = None` / `self._finalized = False` (remplacés).
  - `_consume()` :
    - `message_start` → (sous verrou) `self._step_finalized = False` + nouvelle `in_flight` + broadcast.
    - `delta` → inchangé.
    - `assistant` → `await self._finalize_step(ev.get("text",""), ev.get("tools") or [])`.
    - `tool_result` → (sous verrou) persiste+broadcast `events.tool_result(id, output, is_error)` ; `self._turn_tool_results.add(id)`.
    - `result` → `self._last_subtype = ev.get("subtype")` ; `await self._maybe_persist_session(...)` ; `await self._end_turn()`.
  - **`_finalize_step(text, tools)`** :
    ```python
    async def _finalize_step(self, text, tools):
        async with self._lock:
            if self._step_finalized:
                return
            self._step_finalized = True
            inflight = self._in_flight
            if not (inflight is None and not text and not tools):  # étape vide -> rien
                mid = (inflight or {}).get("message_id") or events.new_id()
                rec = await self._store.append(events.assistant_message(text, "success"))
                self._broadcast(events.message_stop(mid, rec["seq"], "success"))
            for t in tools:
                tu = await self._store.append(events.tool_use(t["id"], t["name"], t.get("input") or {}))
                self._broadcast(tu)
                self._turn_tool_ids.add(t["id"])
            self._in_flight = None
    ```
  - **`_end_turn()`** (remplace `_finalize`) :
    ```python
    async def _end_turn(self):
        async with self._lock:
            if self._turn_finalized:
                return
            self._turn_finalized = True
            # étape en vol non finalisée (interrupt avant AssistantMessage)
            if self._in_flight is not None:
                status = "interrupted" if self._stop_requested else "success"
                mid = self._in_flight["message_id"]
                rec = await self._store.append(events.assistant_message(self._in_flight.get("text", ""), status))
                self._broadcast(events.message_stop(mid, rec["seq"], status))
                self._in_flight = None
            # balayage des outils orphelins (D8) -> carte fermée (✗) live + replay
            for tid in self._turn_tool_ids - self._turn_tool_results:
                tr = await self._store.append(events.tool_result(tid, "interrompu", True))
                self._broadcast(tr)
            if self._pending:
                nxt = self._pending.pop(0)
                self._broadcast_queued()
                await self._start_turn(nxt)
            else:
                self._state = "idle"
    ```
  - `_consume` except (erreur de session) : remplacer `not self._finalized` par `not self._step_finalized`.
  - `stop()` : inchangé. `_maybe_persist_session` : inchangé.
- [ ] **Run** : `uv run pytest tests/unit/test_chat_bridge.py -q` → PASS (anciens + nouveaux). **Commit** (avec Task 3 + Task 5) : `git add -A && git commit -m "feat(chat): bridge multi-etapes + tool events + balayage orphelins ; options read-only+hook"`.

### Task 5 : `manager.py` — passe `repo_root`

**Files:** Modify `mekistudio/backend/chat/manager.py`

- [ ] **Impl** — `get_or_create` : `bridge = ChatBridge(conversation_id, store, self._factory, repo_root=self._root)`.
- [ ] **Run** : `uv run pytest -q` (toute la suite, non-régression) → PASS. Commit avec Task 4.

## Phase 3 — front

### Task 6 : `chat-model.js` — `toolsById` + pairing

**Files:** Modify `chat-model.js` (+ `.test.js`)

- [ ] **Test** (`chat-model.test.js`) :
```js
test('tool_use crée une carte running, tool_result la ferme, dédup seq', () => {
  let s = MekiChat.createState();
  s = MekiChat.reduce(s, { type: 'message_start', message_id: 'm1' });
  s = MekiChat.reduce(s, { type: 'message_stop', message_id: 'm1', seq: 1, status: 'success' });
  s = MekiChat.reduce(s, { type: 'tool_use', seq: 2, id: 'X', name: 'Read', input: { file_path: 'a.py' } });
  assert.equal(s.toolsById['X'].status, 'running');
  assert.ok(s.messages.at(-1).tools.includes('X'));
  s = MekiChat.reduce(s, { type: 'tool_result', seq: 3, id: 'X', output: '73 l.', is_error: false });
  assert.equal(s.toolsById['X'].status, 'done');
  // replay du même tool_result (même seq) -> idempotent
  s = MekiChat.reduce(s, { type: 'tool_result', seq: 3, id: 'X', output: '73 l.', is_error: false });
  assert.equal(s.toolsById['X'].status, 'done');
});

test('tool_result is_error -> status error', () => {
  let s = MekiChat.createState();
  s = MekiChat.reduce(s, { type: 'message_start', message_id: 'm1' });
  s = MekiChat.reduce(s, { type: 'message_stop', message_id: 'm1', seq: 1, status: 'success' });
  s = MekiChat.reduce(s, { type: 'tool_use', seq: 2, id: 'Y', name: 'Read', input: {} });
  s = MekiChat.reduce(s, { type: 'tool_result', seq: 3, id: 'Y', output: 'interrompu', is_error: true });
  assert.equal(s.toolsById['Y'].status, 'error');
});
```
- [ ] **Run** : `node --test mekistudio/frontend/static/js/chat-model.test.js` → FAIL.
- [ ] **Impl** — `chat-model.js` : `createState()` ajoute `toolsById: {}` ; suivre le dernier message assistant (`lastAssistant`). Dans `reduce` :
  - `message_start`/`assistant_message` : quand une bulle assistant est créée, lui ajouter `tools: []` et mémoriser comme courante.
  - `tool_use` : `if (ev.seq && state.bySeq[ev.seq]) break;` ; `state.toolsById[ev.id] = {id:ev.id, name:ev.name, input:ev.input, status:'running', output:''}` ; pousser `ev.id` sur `tools` de la dernière bulle assistant ; `bySeq[ev.seq]=…` ; `lastSeq`.
  - `tool_result` : `if (ev.seq && state.bySeq[ev.seq]) break;` ; `const t = state.toolsById[ev.id]; if (t){ t.status = ev.is_error?'error':'done'; t.output = ev.output; }` ; `bySeq[ev.seq]=…` ; `lastSeq`.
- [ ] **Run** → PASS (nouveaux + anciens). **Commit** : `git add -A && git commit -m "feat(chat): chat-model toolsById (pairing tool_use/tool_result, dedup seq)"`.

### Task 7 : `chat-view.js` + CSS — rendu mode C

**Files:** Modify `chat-view.js`, `canvas.css`

- [ ] **Impl** — `chat-view.js` : `TOOL_META = { Read:{icon:'📄',c:'#4d8dff'}, Glob:{icon:'🔍',c:'#b388ff'}, Grep:{icon:'🔎',c:'#b388ff'}, LS:{icon:'📁',c:'#8893a7'} }` ; `STATUS = { running:'⟳', done:'✓', error:'✗' }` ; `fileArg(name,input)` → `input.file_path||input.pattern||input.path||''`. Dans `render()`, pour une bulle assistant avec `m.tools?.length`, ajouter sous `.chat-content` un bloc `.chat-tools` (mono) : une ligne par `id` → `TOOL_META[name]` (icône colorée) + nom + `fileArg` + statut (`error` → ✗ rouge « bloqué/erreur ») ; clic sur la ligne → toggle l'affichage de `t.output` (préformaté). Lire les outils via `state.toolsById[id]`.
- [ ] **Impl** — `canvas.css` : `.chat-tools{margin-top:8px;background:#0b0e14;border:1px solid #1c2533;border-radius:8px;padding:8px 10px;font-family:Consolas,monospace;font-size:12px;line-height:1.7}` · `.chat-tool{cursor:pointer}` · `.chat-tool .out{white-space:pre-wrap;color:#9fb3c8;margin:2px 0 6px 18px;display:none}` · `.chat-tool.open .out{display:block}` · `.chat-tool .err{color:#e5484d}`.
- [ ] **Commit** : `git add -A && git commit -m "feat(chat): tool-cards mode C (log terminal, TOOL_META) + CSS"`.

## Phase 0 — smoke SDK (épinglage, AVANT de figer l'adaptateur en prod)

> Lancé **après** que le code tourne avec le faux client (Phases 1-3), pour **figer l'API réelle** et ajuster `options.py` si besoin. Lecture seule = sûr.

### Task 8 : smoke test tool

**Files:** Create `tests/integration/test_sdk_tools_smoke.py`

- [ ] **Impl** — test `@pytest.mark.integration` (repo tmp + `setting_sources=[]`) : générateur persistant, prompt « Combien de lignes dans `<un fichier du repo tmp>` ? Utilise Read. » → itérer `receive_messages()` ; **capturer/asserter** : un `AssistantMessage` avec `ToolUseBlock(name=="Read", input.file_path)` ; un `ToolResultBlock(tool_use_id, content, is_error==False)` via `UserMessage` (`_tool_output(content)` non vide) ; multi-étapes (≥1 AssistantMessage avec tool + AssistantMessage final). Un 2ᵉ cas avec un **compteur d'appels du hook** : prompt qui tente `Read C:/Windows/...` → assert hook **appelé** (compteur≥1) + **deny** ; **print** la forme réelle du result du deny (xfail si pas de ToolResultBlock). Cas interrupt-en-plein-outil : print si un ToolResultBlock arrive.
- [ ] **Run** : `uv run pytest -m integration tests/integration/test_sdk_tools_smoke.py -v -s` → ajuster `options.py`/`bridge` selon les noms réels observés ; **re-run** la suite unit. **Commit** : `git add -A && git commit -m "test(chat): smoke tool SDK (epingle multi-etapes + ToolUse/ToolResult + prouve le guard)"`.

## Phase 4 — Validation Playwright

### Task 9 : script Playwright (console + screenshots)

**Files:** Create `scripts/pw-chat-tools.mjs` (hors package)

- [ ] **Impl** — installer Playwright (`npm i -D playwright` + `npx playwright install chromium`), script Node : lance chromium headless, capture `page.on('console')` + `page.on('pageerror')` dans un log, navigue sur `http://127.0.0.1:8777/`, screenshot initial, tape un prompt forçant un Read (« combien de lignes dans `CLAUDE.md` ? »), attend les tool-cards, screenshot, écrit `console.log`/screenshots dans `scripts/.pw/`.
- [ ] **Run** : démarrer `mekistudio serve` (tool global rafraîchi : `uv tool install --editable . --force` serveur arrêté), lancer le script, **lire les screenshots** (outil Read) + le log console → vérifier : carte Read ⟳→✓, **0 erreur console**, tentative hors-repo → 🚫. Itérer si besoin.
- [ ] **MAJ ROADMAP** + **commit** : `docs(roadmap): brique D tool-cards lecture seule livrée`.

## Auto-revue
- **Couverture spec** : D1 (Task 3) · D2/guard (Task 2,3) · D3 multi-étapes (Task 4) · D4 normalisation/_tool_output (Task 3) · D5 wire (Task 1,4) · D6 front (Task 6,7) · D7 persistance (Task 1,4) · D8 orphelins (Task 4) · D9 smoke (Task 8) · D10 TOOL_META (Task 7). Playwright (Task 9).
- **Types cohérents** : events `tool_use{id,name,input}`/`tool_result{id,output,is_error}` identiques backend/faux-client/front ; `make_repo_guard` retour `{}`/`hookSpecificOutput.permissionDecision`. `repo_root` threadé manager→bridge→build_options/guard.
- **Risque épinglé** : noms d'attributs SDK + forme d'un deny → Task 8 (smoke) ; l'adaptateur Task 3 est écrit contre la forme attendue, ajusté après le smoke.
