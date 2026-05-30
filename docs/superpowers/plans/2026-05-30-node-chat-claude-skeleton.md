# Node chat × Claude Agent SDK — squelette vertical · Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un node chat sur le canvas qui pilote une vraie session Claude Code (Claude Agent SDK) et streame ses réponses texte, mot par mot, dans des bulles Discord-fidèles, via WebSocket ; la session tourne en tâche de fond façon `screen` (survit aux reloads), avec stop, file d'attente et nouvelle session.

**Architecture:** Backend pur (`backend/chat/`) = `events` (schéma wire/records) → `store` (persistance jsonl+meta, source du `seq`) → `bridge` (enveloppe le client SDK en **mode streaming-input**, une boucle de consommation unique, verrou d'état, broadcast borné) → `manager` (registre par `conversation_id`). Le router WS (`frontend/routes/chat_ws.py`) relie le bridge au navigateur ; le front a un **réducteur pur** (`chat-model.js`, testé `node --test`) et une **vue DOM** (`chat-view.js`, cycle de vie WS comme l'`EditorView`).

**Tech Stack:** Python 3.11+, FastAPI/uvicorn (websockets via `uvicorn[standard]`, déjà présent), Pydantic v2, `claude-agent-sdk` ; front : Alpine.js + DOM impératif, `marked` + `DOMPurify` vendored, tests `node --test`.

**Spec de référence :** [`docs/superpowers/specs/2026-05-30-node-chat-claude-skeleton-design.md`](../specs/2026-05-30-node-chat-claude-skeleton-design.md). Décisions citées `Dn`.

---

## Carte des fichiers & contrats (à lire avant de coder)

**Créés — backend**
- `mekistudio/backend/chat/__init__.py` — package vide.
- `mekistudio/backend/chat/events.py` — builders d'events (dicts) + `now_ms()` ; ré-exporte `new_id`. Types **durables** (persistés, reçoivent un `seq`) : `user_message`, `assistant_message`, `session`, `error`. Types **transients** (wire only) : `message_start`, `text_delta`, `message_stop`, `queued`, `cleared`.
- `mekistudio/backend/chat/store.py` — `ConversationStore(root: Path, conversation_id: str)` : `next_seq` (prop), `async append(record: dict) -> dict`, `async read_since(seq: int) -> list[dict]`, `meta() -> dict`, `async set_session_id(sid: str)`.
- `mekistudio/backend/chat/bridge.py` — `ChatBridge(conversation_id, store, client_factory)` : `async start()`, `async submit_prompt(text)`, `async stop()`, `async cancel_queued(index)`, `async attach(queue, since_seq)`, `unsubscribe(queue)`, `async shutdown()`, props `state`/`in_flight`/`pending`. **Client normalisé** : protocole `connect(stream)`/`receive()`/`interrupt()`/`disconnect()` ; `receive()` yield des dicts normalisés `{"kind": "init"|"message_start"|"delta"|"assistant"|"result", ...}`. `default_client_factory(options)` = adaptateur réel SDK→normalisé.
- `mekistudio/backend/chat/manager.py` — `ChatManager(repo_root, client_factory=default_client_factory)` : `async get_or_create(cid) -> ChatBridge`, `async clear(old_id) -> str`, `async shutdown()`.
- `mekistudio/backend/nodes/chat.py` — `KIND="chat"`, `build_chat_node(x=-440.0, y=0.0) -> Node`.

**Créés — frontend**
- `mekistudio/frontend/routes/chat_ws.py` — router WS `/ws/chat/{conversation_id}` + `_rotate_node_conversation(repo_root, old_id, new_id)`.
- `mekistudio/frontend/static/js/chat-model.js` — `window.MekiChat = { createState, reduce }` (pur).
- `mekistudio/frontend/static/js/chat-model.test.js` — `node --test`.
- `mekistudio/frontend/static/js/chat-view.js` — `window.MekiChatView = { mount(node, conversationId) -> {destroy} }`.
- `mekistudio/frontend/static/vendor/marked.min.js`, `mekistudio/frontend/static/vendor/purify.min.js`.

**Créés — tests**
- `tests/integration/__init__.py`, `tests/integration/test_sdk_smoke.py`.
- `tests/unit/test_chat_events.py`, `test_chat_store.py`, `test_chat_bridge.py`, `test_chat_manager.py`, `test_chat_node.py`, `test_chat_ws.py`.

**Modifiés**
- `mekistudio/backend/components/primitives.py` (+ `ChatComponent`, union, rebuild Layout/Node) ; `mekistudio/backend/components/__init__.py` (export).
- `mekistudio/backend/nodes/registry.py` (NODE_BUILDERS, CANONICAL_PARENT_KIND, default_canvas) ; `mekistudio/backend/nodes/__init__.py`.
- `mekistudio/frontend/app.py` (lifespan + `chat_client_factory` + router WS).
- `mekistudio/frontend/static/js/canvas.js` (branche `renderComponent` `type:"chat"` + registre `_chatViews`/`destroy`).
- `mekistudio/frontend/static/css/canvas.css` (styles chat layout A).
- `mekistudio/frontend/templates/canvas.html` (ordre des scripts).
- `pyproject.toml` (`claude-agent-sdk` + marker `integration`).
- `docs/ROADMAP.md`.

**Wire (rappel D6/§4.6)** — serveur→client : `user_message{seq,ts,text}` · `message_start{message_id}` · `text_delta{message_id,text}` · `message_stop{message_id,seq,status}` · `assistant_message{seq,ts,text,status}` (replay) · `session{seq,claude_session_id}` · `error{seq,message}` · `queued{items}` · `cleared{conversation_id}`. Client→serveur : `attach{since_seq}` · `prompt{text}` · `stop` · `cancel_queued{index}` · `clear`.

---

## Phase 0 — Épinglage SDK

### Task 0 : Dépendances, marker pytest, smoke test SDK

**Files:**
- Modify: `pyproject.toml`
- Create: `tests/integration/__init__.py`, `tests/integration/test_sdk_smoke.py`

- [ ] **Step 1 : Ajouter la dépendance SDK + le marker `integration`**

Dans `pyproject.toml`, ajouter `"claude-agent-sdk>=0.2"` à `dependencies` (après `"typer>=0.13",`). `websockets` est **déjà** fourni par `uvicorn[standard]` — ne rien ajouter. Étendre la config pytest :

```toml
[tool.pytest.ini_options]
addopts = "-ra -m 'not integration'"
testpaths = ["tests"]
markers = [
    "integration: tests qui lancent la vraie CLI claude (réseau/auth) ; exclus par défaut",
]
```

- [ ] **Step 2 : Installer**

Run: `uv pip install -e ".[dev]"` puis `uv pip install claude-agent-sdk`
Expected: installation OK, `python -c "import claude_agent_sdk"` ne lève pas.

- [ ] **Step 3 : Écrire le smoke test (fige l'API réelle)**

Create `tests/integration/__init__.py` (vide) et `tests/integration/test_sdk_smoke.py` :

```python
"""Smoke test qui FIGE l'API réelle du SDK installé (D14). Lancer explicitement :
    uv run pytest -m integration tests/integration/test_sdk_smoke.py -v -s
Nécessite la CLI `claude` installée + authentifiée (héritée de la session courante)."""
from __future__ import annotations

import asyncio

import pytest

pytestmark = pytest.mark.integration


async def _user_stream(prompts: list[str]):
    for p in prompts:
        yield {"type": "user", "message": {"role": "user", "content": p}}


@pytest.mark.asyncio
async def test_streaming_text_and_session_id():
    from claude_agent_sdk import ClaudeAgentOptions, ClaudeSDKClient

    opts = ClaudeAgentOptions(tools=[], permission_mode="dontAsk", include_partial_messages=True)
    client = ClaudeSDKClient(options=opts)
    await client.query(_user_stream(["Réponds exactement: bonjour"]))

    deltas: list[str] = []
    session_id = None
    saw_tool_use = False
    async for msg in client.receive_messages():
        name = type(msg).__name__
        if name == "SystemMessage" and getattr(msg, "subtype", None) == "init":
            session_id = getattr(msg, "data", {}).get("session_id") or session_id
        if name == "StreamEvent":
            ev = getattr(msg, "event", {}) or {}
            if ev.get("type") == "content_block_delta" and ev.get("delta", {}).get("type") == "text_delta":
                deltas.append(ev["delta"].get("text", ""))
        if name == "AssistantMessage":
            for b in getattr(msg, "content", []):
                if type(b).__name__ == "ToolUseBlock":
                    saw_tool_use = True
        if name == "ResultMessage":
            session_id = session_id or getattr(msg, "session_id", None)
            break
    await client.disconnect()

    assert "".join(deltas).strip(), "aucun text_delta reçu"
    assert session_id, "aucun session_id"
    assert not saw_tool_use, "tools=[] devrait empêcher tout ToolUseBlock"


@pytest.mark.asyncio
async def test_interrupt_returns_result_subtype():
    """FIGE le subtype renvoyé après interrupt() (attendu: 'error_during_execution')."""
    from claude_agent_sdk import ClaudeAgentOptions, ClaudeSDKClient

    opts = ClaudeAgentOptions(tools=[], permission_mode="dontAsk", include_partial_messages=True)
    client = ClaudeSDKClient(options=opts)
    await client.query(_user_stream(["Compte lentement de 1 à 500, un nombre par ligne."]))

    subtype = None
    async for msg in client.receive_messages():
        if type(msg).__name__ == "StreamEvent":
            await client.interrupt()
        if type(msg).__name__ == "ResultMessage":
            subtype = getattr(msg, "subtype", None)
            break
    await client.disconnect()
    print(f"\n[SMOKE] subtype après interrupt = {subtype!r}")
    assert subtype is not None  # la valeur exacte est figée par l'observation (ex. error_during_execution)
```

- [ ] **Step 4 : Lancer le smoke (manuel, hors CI)**

Run: `uv run pytest -m integration tests/integration/test_sdk_smoke.py -v -s`
Expected: les 2 tests passent ; noter le `subtype` imprimé (ex. `error_during_execution`). Si un nom de symbole diffère (ex. `client.query` vs `client.connect`, forme de `SystemMessage.data`), **corriger l'adaptateur de la Task 3 en conséquence** — c'est le rôle de ce verrou.
Run aussi: `uv run pytest` → la suite par défaut **exclut** `integration` (marker), doit rester verte.

- [ ] **Step 5 : Commit**

```bash
git add pyproject.toml tests/integration/__init__.py tests/integration/test_sdk_smoke.py
git commit -m "feat(chat): dep claude-agent-sdk + smoke test SDK (epinglage API, D14)"
```

---

## Phase 1 — Moteur backend (headless, TDD)

### Task 1 : `events.py` — builders d'events

**Files:**
- Create: `mekistudio/backend/chat/__init__.py` (vide), `mekistudio/backend/chat/events.py`
- Test: `tests/unit/test_chat_events.py`

- [ ] **Step 1 : Test**

```python
from mekistudio.backend.chat import events


def test_durable_and_transient_builders():
    um = events.user_message("salut")
    assert um == {"type": "user_message", "ts": um["ts"], "text": "salut"} and isinstance(um["ts"], int)
    am = events.assistant_message("ok", "success")
    assert am["type"] == "assistant_message" and am["text"] == "ok" and am["status"] == "success"
    assert events.session_event("sid")["claude_session_id"] == "sid"
    assert events.error_event("boom")["message"] == "boom"
    assert events.message_start("m1") == {"type": "message_start", "message_id": "m1"}
    assert events.text_delta("m1", "x") == {"type": "text_delta", "message_id": "m1", "text": "x"}
    assert events.message_stop("m1", 3, "success") == {"type": "message_stop", "message_id": "m1", "seq": 3, "status": "success"}
    assert events.queued([{"index": 0, "text": "a"}])["items"][0]["text"] == "a"
    assert events.cleared("c2") == {"type": "cleared", "conversation_id": "c2"}
    assert events.DURABLE_TYPES == {"user_message", "assistant_message", "session", "error"}
    assert isinstance(events.new_id(), str) and len(events.new_id()) > 0
```

- [ ] **Step 2 : Lancer (échoue)**

Run: `uv run pytest tests/unit/test_chat_events.py -v`
Expected: FAIL `ModuleNotFoundError: mekistudio.backend.chat`.

- [ ] **Step 3 : Implémenter**

`mekistudio/backend/chat/__init__.py` : fichier vide.
`mekistudio/backend/chat/events.py` :

```python
from __future__ import annotations

import time

from mekistudio.backend.components.base import new_id  # ré-export

__all__ = ["new_id", "now_ms", "DURABLE_TYPES"]

DURABLE_TYPES = {"user_message", "assistant_message", "session", "error"}


def now_ms() -> int:
    return int(time.time() * 1000)


# --- durables (persistés ; le store assigne le seq) ---
def user_message(text: str) -> dict:
    return {"type": "user_message", "ts": now_ms(), "text": text}


def assistant_message(text: str, status: str) -> dict:
    return {"type": "assistant_message", "ts": now_ms(), "text": text, "status": status}


def session_event(claude_session_id: str) -> dict:
    return {"type": "session", "ts": now_ms(), "claude_session_id": claude_session_id}


def error_event(message: str) -> dict:
    return {"type": "error", "ts": now_ms(), "message": message}


# --- transients (wire only, pas de seq durable) ---
def message_start(message_id: str) -> dict:
    return {"type": "message_start", "message_id": message_id}


def text_delta(message_id: str, text: str) -> dict:
    return {"type": "text_delta", "message_id": message_id, "text": text}


def message_stop(message_id: str, seq: int, status: str) -> dict:
    return {"type": "message_stop", "message_id": message_id, "seq": seq, "status": status}


def queued(items: list[dict]) -> dict:
    return {"type": "queued", "items": items}


def cleared(conversation_id: str) -> dict:
    return {"type": "cleared", "conversation_id": conversation_id}
```

- [ ] **Step 4 : Lancer (passe)**

Run: `uv run pytest tests/unit/test_chat_events.py -v`
Expected: PASS.

- [ ] **Step 5 : Commit**

```bash
git add mekistudio/backend/chat/__init__.py mekistudio/backend/chat/events.py tests/unit/test_chat_events.py
git commit -m "feat(chat): events.py (builders wire + records durables)"
```

### Task 2 : `store.py` — persistance conversation

**Files:**
- Create: `mekistudio/backend/chat/store.py`
- Test: `tests/unit/test_chat_store.py`

- [ ] **Step 1 : Test**

```python
import json

import pytest

from mekistudio.backend.chat import events
from mekistudio.backend.chat.store import ConversationStore


@pytest.mark.asyncio
async def test_append_seq_read_since_and_meta(tmp_path):
    s = ConversationStore(tmp_path, "c1")
    assert s.next_seq == 1
    r1 = await s.append(events.user_message("a"))
    r2 = await s.append(events.assistant_message("b", "success"))
    assert (r1["seq"], r2["seq"]) == (1, 2)
    assert s.next_seq == 3
    assert [r["text"] for r in await s.read_since(0)] == ["a", "b"]
    assert [r["seq"] for r in await s.read_since(1)] == [2]

    await s.set_session_id("sid-123")
    assert s.meta()["claude_session_id"] == "sid-123"

    # "restart": un nouveau store sur le même dossier reprend le seq
    s2 = ConversationStore(tmp_path, "c1")
    assert s2.next_seq == 3
    assert s2.meta()["claude_session_id"] == "sid-123"


@pytest.mark.asyncio
async def test_tolerates_truncated_last_line(tmp_path):
    s = ConversationStore(tmp_path, "c2")
    await s.append(events.user_message("ok"))
    p = tmp_path / ".mekistudio" / "conversations" / "c2" / "messages.jsonl"
    with p.open("a", encoding="utf-8") as fh:
        fh.write('{"seq": 2, "type": "user_mess')  # ligne tronquée (crash simulé)
    s2 = ConversationStore(tmp_path, "c2")  # ne doit PAS lever
    assert s2.next_seq == 2
    assert [r["text"] for r in await s2.read_since(0)] == ["ok"]
```

- [ ] **Step 2 : Lancer (échoue)** — Run: `uv run pytest tests/unit/test_chat_store.py -v` → FAIL import.

- [ ] **Step 3 : Implémenter** `mekistudio/backend/chat/store.py` :

```python
from __future__ import annotations

import asyncio
import json
from pathlib import Path

from mekistudio.backend.chat import events


class ConversationStore:
    """Persistance d'une conversation : meta.json (autoritatif pour resume) + messages.jsonl
    (append-only, source de vérité du seq). Tolérant à une dernière ligne tronquée."""

    def __init__(self, root: Path, conversation_id: str) -> None:
        self._dir = Path(root) / ".mekistudio" / "conversations" / conversation_id
        self._jsonl = self._dir / "messages.jsonl"
        self._meta = self._dir / "meta.json"
        self._cid = conversation_id
        self._lock = asyncio.Lock()
        self._next_seq = self._scan_next_seq()

    @property
    def conversation_id(self) -> str:
        return self._cid

    @property
    def next_seq(self) -> int:
        return self._next_seq

    def _scan_next_seq(self) -> int:
        last = 0
        if self._jsonl.exists():
            for line in self._jsonl.read_text(encoding="utf-8").splitlines():
                try:
                    last = max(last, int(json.loads(line)["seq"]))
                except (json.JSONDecodeError, KeyError, ValueError, TypeError):
                    continue  # dernière ligne tronquée -> ignorée
        return last + 1

    async def append(self, record: dict) -> dict:
        async with self._lock:
            stored = {"seq": self._next_seq, **record}
            self._dir.mkdir(parents=True, exist_ok=True)
            with self._jsonl.open("a", encoding="utf-8") as fh:
                fh.write(json.dumps(stored, ensure_ascii=False) + "\n")
            self._next_seq += 1
            return stored

    async def read_since(self, seq: int) -> list[dict]:
        if not self._jsonl.exists():
            return []
        out: list[dict] = []
        for line in self._jsonl.read_text(encoding="utf-8").splitlines():
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                continue
            if int(rec.get("seq", 0)) > seq:
                out.append(rec)
        return out

    def meta(self) -> dict:
        if self._meta.exists():
            return json.loads(self._meta.read_text(encoding="utf-8"))
        return {"id": self._cid, "created_at_ms": events.now_ms(), "claude_session_id": None}

    async def set_session_id(self, claude_session_id: str) -> None:
        async with self._lock:
            self._dir.mkdir(parents=True, exist_ok=True)
            meta = self.meta()
            meta["claude_session_id"] = claude_session_id
            tmp = self._meta.with_suffix(".json.tmp")
            tmp.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
            tmp.replace(self._meta)  # atomique (POSIX & Windows)
```

- [ ] **Step 4 : Lancer (passe)** — Run: `uv run pytest tests/unit/test_chat_store.py -v` → PASS.

- [ ] **Step 5 : Commit**

```bash
git add mekistudio/backend/chat/store.py tests/unit/test_chat_store.py
git commit -m "feat(chat): ConversationStore (jsonl+meta, seq, tolerant truncation)"
```

### Task 3 : `bridge.py` — tour simple (client normalisé + FakeClient)

**Files:**
- Create: `mekistudio/backend/chat/bridge.py`
- Test: `tests/unit/test_chat_bridge.py`

> Le bridge dépend d'un **client normalisé** (protocole `connect`/`receive`/`interrupt`/`disconnect`, `receive()` yield des dicts `{"kind": ...}`). `default_client_factory` (adaptateur réel) traduit les types SDK ; les tests injectent un `FakeClient` scripté. Cette Task pose le cœur (un tour, idle→running→finalize) ; les Tasks 4-5 ajoutent reattach, file et stop.

- [ ] **Step 1 : Test (un tour complet)**

```python
import asyncio

import pytest

from mekistudio.backend.chat.bridge import ChatBridge
from mekistudio.backend.chat.store import ConversationStore


class FakeClient:
    """Client normalisé scripté : pour chaque prompt poussé dans le stream, joue une liste
    d'events normalisés. `scripts` = liste de listes (un script par tour, dans l'ordre)."""

    def __init__(self, scripts):
        self._scripts = list(scripts)
        self._stream = None
        self.interrupted = False
        self.disconnected = False

    async def connect(self, stream):
        self._stream = stream

    async def receive(self):
        # un tour par message lu dans le stream
        async for _msg in self._stream:
            script = self._scripts.pop(0) if self._scripts else [{"kind": "result", "subtype": "success", "session_id": "sid"}]
            for ev in script:
                yield ev

    async def interrupt(self):
        self.interrupted = True

    async def disconnect(self):
        self.disconnected = True


def _factory(scripts):
    return lambda options: FakeClient(scripts)


async def _drain(queue, n, timeout=2.0):
    out = []
    for _ in range(n):
        out.append(await asyncio.wait_for(queue.get(), timeout))
    return out


@pytest.mark.asyncio
async def test_single_turn_streams_and_persists(tmp_path):
    store = ConversationStore(tmp_path, "c1")
    script = [
        {"kind": "init", "session_id": "sid-1"},
        {"kind": "message_start"},
        {"kind": "delta", "text": "Bon"},
        {"kind": "delta", "text": "jour"},
        {"kind": "assistant", "text": "Bonjour"},
        {"kind": "result", "subtype": "success", "session_id": "sid-1"},
    ]
    bridge = ChatBridge("c1", store, _factory([script]))
    await bridge.start()
    q = asyncio.Queue()
    await bridge.attach(q, 0)
    await bridge.submit_prompt("salut")

    types = []
    while True:
        ev = await asyncio.wait_for(q.get(), 2.0)
        types.append(ev["type"])
        if ev["type"] == "message_stop":
            assert ev["status"] == "success"
            break
    assert types[:2] == ["user_message", "session"] or "user_message" in types
    assert "message_start" in types and "text_delta" in types
    # persistance : pas de delta sur disque ; un user_message + un assistant_message final
    recs = await store.read_since(0)
    kinds = [r["type"] for r in recs]
    assert kinds.count("user_message") == 1
    assert any(r["type"] == "assistant_message" and r["text"] == "Bonjour" and r["status"] == "success" for r in recs)
    assert all(r["type"] != "text_delta" for r in recs)
    assert store.meta()["claude_session_id"] == "sid-1"
    await bridge.shutdown()
```

- [ ] **Step 2 : Lancer (échoue)** — Run: `uv run pytest tests/unit/test_chat_bridge.py -v` → FAIL import.

- [ ] **Step 3 : Implémenter** `mekistudio/backend/chat/bridge.py` (cœur + adaptateur réel) :

```python
from __future__ import annotations

import asyncio
from typing import Any, AsyncIterator, Callable

from mekistudio.backend.chat import events
from mekistudio.backend.chat.store import ConversationStore

ClientFactory = Callable[[Any], "NormalizedClient"]


class NormalizedClient:
    """Protocole attendu par le bridge (implémenté par l'adaptateur réel et par les fakes)."""

    async def connect(self, stream: AsyncIterator[dict]) -> None: ...
    def receive(self) -> AsyncIterator[dict]: ...
    async def interrupt(self) -> None: ...
    async def disconnect(self) -> None: ...


class ChatBridge:
    def __init__(self, conversation_id: str, store: ConversationStore, client_factory: ClientFactory) -> None:
        self._cid = conversation_id
        self._store = store
        self._factory = client_factory
        self._client: NormalizedClient | None = None
        self._to_sdk: asyncio.Queue[str] = asyncio.Queue()
        self._pending: list[str] = []
        self._subscribers: set[asyncio.Queue] = set()
        self._lock = asyncio.Lock()
        self._state = "idle"  # idle | running | error
        self._in_flight: dict | None = None  # {"message_id", "text"}
        self._final_text: str | None = None
        self._turn_id: str | None = None
        self._stop_requested = False
        self._finalized = False
        self._consume_task: asyncio.Task | None = None

    # --- propriétés publiques ---
    @property
    def state(self) -> str:
        return self._state

    @property
    def in_flight(self) -> dict | None:
        return self._in_flight

    @property
    def pending(self) -> list[str]:
        return list(self._pending)

    # --- cycle de vie ---
    async def _message_stream(self) -> AsyncIterator[dict]:
        while True:
            text = await self._to_sdk.get()
            yield {"type": "user", "message": {"role": "user", "content": text}}

    async def start(self) -> None:
        from mekistudio.backend.chat.options import build_options  # léger, évite l'import SDK au boot
        try:
            options = build_options(self._cid, self._store)
            self._client = self._factory(options)
            await self._client.connect(self._message_stream())
            self._consume_task = asyncio.create_task(self._consume())
        except Exception as exc:  # connexion SDK KO (CLI absente/non authentifiée) -> état dégradé
            self._state = "error"
            self._client = None
            self._consume_task = None
            self._error_message = f"Connexion SDK impossible : {exc}"

    # --- broadcast (D17) ---
    def _broadcast(self, ev: dict) -> None:
        for q in list(self._subscribers):
            try:
                q.put_nowait(ev)
            except asyncio.QueueFull:
                self._subscribers.discard(q)  # socket lent : il se reconnecte et rattrape par replay

    def unsubscribe(self, queue: asyncio.Queue) -> None:
        self._subscribers.discard(queue)

    # --- soumission d'un prompt ---
    async def submit_prompt(self, text: str) -> None:
        async with self._lock:
            if self._state == "error":
                rec = await self._store.append(events.error_event(getattr(self, "_error_message", "session indisponible")))
                self._broadcast(rec)
                return
            if self._state == "idle":
                await self._start_turn(text)
            else:
                self._pending.append(text)
                self._broadcast_queued()

    async def _start_turn(self, text: str) -> None:
        rec = await self._store.append(events.user_message(text))
        self._broadcast(rec)
        self._state = "running"
        self._turn_id = events.new_id()
        self._stop_requested = False
        self._finalized = False
        self._in_flight = None
        self._final_text = None
        self._to_sdk.put_nowait(text)

    def _broadcast_queued(self) -> None:
        self._broadcast(events.queued([{"index": i, "text": t} for i, t in enumerate(self._pending)]))

    # --- boucle de consommation unique (tous les tours) ---
    async def _consume(self) -> None:
        assert self._client is not None
        async for ev in self._client.receive():
            kind = ev.get("kind")
            if kind == "init":
                await self._maybe_persist_session(ev.get("session_id"))
            elif kind == "message_start":
                async with self._lock:
                    self._in_flight = {"message_id": events.new_id(), "text": ""}
                    self._broadcast(events.message_start(self._in_flight["message_id"]))
            elif kind == "delta":
                async with self._lock:
                    if self._in_flight is not None:
                        self._in_flight["text"] += ev.get("text", "")
                        self._broadcast(events.text_delta(self._in_flight["message_id"], ev.get("text", "")))
            elif kind == "assistant":
                self._final_text = ev.get("text", "")
            elif kind == "result":
                await self._maybe_persist_session(ev.get("session_id"))
                await self._finalize()

    async def _maybe_persist_session(self, sid: str | None) -> None:
        if not sid or self._store.meta().get("claude_session_id"):
            return
        await self._store.set_session_id(sid)
        rec = await self._store.append(events.session_event(sid))
        self._broadcast(rec)

    async def _finalize(self) -> None:
        async with self._lock:
            if self._finalized:
                return
            self._finalized = True
            status = "interrupted" if self._stop_requested else "success"
            text = self._final_text if self._final_text is not None else (self._in_flight or {}).get("text", "")
            mid = (self._in_flight or {}).get("message_id") or events.new_id()
            rec = await self._store.append(events.assistant_message(text, status))
            self._broadcast(events.message_stop(mid, rec["seq"], status))
            self._in_flight = None
            # enchaînement de la file
            if self._pending:
                nxt = self._pending.pop(0)
                self._broadcast_queued()
                await self._start_turn(nxt)
            else:
                self._state = "idle"

    async def shutdown(self) -> None:
        if self._consume_task is not None:
            self._consume_task.cancel()
            try:
                await self._consume_task
            except asyncio.CancelledError:
                pass
        if self._client is not None:
            try:
                await self._client.interrupt()
            except Exception:
                pass
            try:
                await self._client.disconnect()
            except Exception:
                pass
```

Create aussi `mekistudio/backend/chat/options.py` (isole l'import SDK + l'adaptateur réel) :

```python
from __future__ import annotations

from typing import Any, AsyncIterator

from mekistudio.backend.chat.store import ConversationStore


def build_options(conversation_id: str, store: ConversationStore) -> Any:
    """Construit ClaudeAgentOptions (outils OFF, streaming, resume). Importé tardivement."""
    from claude_agent_sdk import ClaudeAgentOptions

    return ClaudeAgentOptions(
        tools=[],
        permission_mode="dontAsk",
        include_partial_messages=True,
        resume=store.meta().get("claude_session_id"),
    )


class _SdkClient:
    """Adaptateur : ClaudeSDKClient -> protocole NormalizedClient (events {"kind": ...})."""

    def __init__(self, options: Any) -> None:
        from claude_agent_sdk import ClaudeSDKClient

        self._c = ClaudeSDKClient(options=options)

    async def connect(self, stream: AsyncIterator[dict]) -> None:
        await self._c.query(stream)  # streaming-input (requis pour interrupt)

    async def receive(self):  # async generator
        async for msg in self._c.receive_messages():
            name = type(msg).__name__
            if name == "SystemMessage" and getattr(msg, "subtype", None) == "init":
                yield {"kind": "init", "session_id": (getattr(msg, "data", {}) or {}).get("session_id")}
            elif name == "StreamEvent":
                ev = getattr(msg, "event", {}) or {}
                t = ev.get("type")
                if t == "message_start":
                    yield {"kind": "message_start"}
                elif t == "content_block_delta" and ev.get("delta", {}).get("type") == "text_delta":
                    yield {"kind": "delta", "text": ev["delta"].get("text", "")}
            elif name == "AssistantMessage":
                text = "".join(
                    getattr(b, "text", "") for b in getattr(msg, "content", []) if type(b).__name__ == "TextBlock"
                )
                yield {"kind": "assistant", "text": text}
            elif name == "ResultMessage":
                yield {"kind": "result", "subtype": getattr(msg, "subtype", None), "session_id": getattr(msg, "session_id", None)}

    async def interrupt(self) -> None:
        await self._c.interrupt()

    async def disconnect(self) -> None:
        await self._c.disconnect()


def default_client_factory(options: Any) -> _SdkClient:
    return _SdkClient(options)
```

Et exposer la factory depuis le bridge — ajouter en bas de `bridge.py` :

```python
from mekistudio.backend.chat.options import default_client_factory  # noqa: E402  (ré-export)
```

- [ ] **Step 4 : Lancer (passe)** — Run: `uv run pytest tests/unit/test_chat_bridge.py -v` → PASS.

- [ ] **Step 5 : Commit**

```bash
git add mekistudio/backend/chat/bridge.py mekistudio/backend/chat/options.py tests/unit/test_chat_bridge.py
git commit -m "feat(chat): ChatBridge - tour simple, streaming-input, client normalise"
```

### Task 4 : `bridge.py` — reattach atomique (D6)

**Files:**
- Modify: `mekistudio/backend/chat/bridge.py` (ajouter `attach`)
- Test: `tests/unit/test_chat_bridge.py` (ajout)

- [ ] **Step 1 : Test (reattach pendant un tour, même message_id, pas de doublon)**

```python
@pytest.mark.asyncio
async def test_reattach_during_turn_reuses_message_id(tmp_path):
    store = ConversationStore(tmp_path, "c3")
    # tour qui s'arrête après 2 deltas (pas de result tout de suite) via un script "pausé"
    gate = asyncio.Event()

    class GatedClient(FakeClient):
        async def receive(self):
            async for _ in self._stream:
                yield {"kind": "message_start"}
                yield {"kind": "delta", "text": "AB"}
                await gate.wait()  # tour en vol
                yield {"kind": "assistant", "text": "ABCD"}
                yield {"kind": "result", "subtype": "success", "session_id": "s"}

    bridge = ChatBridge("c3", store, lambda o: GatedClient([]))
    await bridge.start()
    q1 = asyncio.Queue()
    await bridge.attach(q1, 0)
    await bridge.submit_prompt("go")
    # consommer user_message, message_start, text_delta(AB)
    seen = [await asyncio.wait_for(q1.get(), 2.0) for _ in range(3)]
    mid = next(e["message_id"] for e in seen if e["type"] == "message_start")

    # 2e socket se reconnecte EN PLEIN tour
    q2 = asyncio.Queue()
    await bridge.attach(q2, 0)
    catchup = [await asyncio.wait_for(q2.get(), 2.0) for _ in range(3)]  # user_message(replay), message_start, text_delta(AB)
    assert catchup[1]["type"] == "message_start" and catchup[1]["message_id"] == mid
    assert catchup[2]["type"] == "text_delta" and catchup[2]["text"] == "AB"

    gate.set()
    await bridge.shutdown()
```

- [ ] **Step 2 : Lancer (échoue)** — Run: `uv run pytest tests/unit/test_chat_bridge.py::test_reattach_during_turn_reuses_message_id -v` → FAIL (`attach` absent / comportement).

- [ ] **Step 3 : Implémenter** — ajouter à `ChatBridge` :

```python
    async def attach(self, queue: asyncio.Queue, since_seq: int) -> None:
        records = await self._store.read_since(since_seq)  # await AVANT le verrou
        async with self._lock:  # section critique SANS await -> atomique vs _consume
            for rec in records:
                queue.put_nowait(rec)
            if self._state == "running" and self._in_flight is not None:
                queue.put_nowait(events.message_start(self._in_flight["message_id"]))
                queue.put_nowait(events.text_delta(self._in_flight["message_id"], self._in_flight["text"]))
            self._subscribers.add(queue)
```

- [ ] **Step 4 : Lancer (passe)** — Run: `uv run pytest tests/unit/test_chat_bridge.py -v` → PASS (tous).

- [ ] **Step 5 : Commit**

```bash
git add mekistudio/backend/chat/bridge.py tests/unit/test_chat_bridge.py
git commit -m "feat(chat): attach() reattach atomique (replay + in_flight, meme message_id)"
```

### Task 5 : `bridge.py` — file, stop/interrupt, cancel

**Files:**
- Modify: `mekistudio/backend/chat/bridge.py` (ajouter `stop`, `cancel_queued`)
- Test: `tests/unit/test_chat_bridge.py` (ajout)

- [ ] **Step 1 : Tests (file exécutée après le tour ; stop = interrupted ; cancel)**

```python
@pytest.mark.asyncio
async def test_queue_runs_after_current_turn(tmp_path):
    store = ConversationStore(tmp_path, "c4")
    script_turn = [
        {"kind": "message_start"}, {"kind": "delta", "text": "x"},
        {"kind": "assistant", "text": "x"}, {"kind": "result", "subtype": "success", "session_id": "s"},
    ]
    bridge = ChatBridge("c4", store, _factory([list(script_turn), list(script_turn)]))
    await bridge.start()
    q = asyncio.Queue()
    await bridge.attach(q, 0)
    await bridge.submit_prompt("premier")
    await asyncio.sleep(0.01)
    await bridge.submit_prompt("second")  # pendant le tour -> file
    assert bridge.pending == ["second"]
    # laisser les 2 tours se dérouler
    user_msgs = []
    for _ in range(40):
        ev = await asyncio.wait_for(q.get(), 2.0)
        if ev["type"] == "user_message":
            user_msgs.append(ev["text"])
        if len(user_msgs) == 2:
            break
    assert user_msgs == ["premier", "second"]
    await bridge.shutdown()


@pytest.mark.asyncio
async def test_stop_interrupts_and_persists_partial(tmp_path):
    store = ConversationStore(tmp_path, "c5")
    gate = asyncio.Event()

    class GatedClient(FakeClient):
        async def receive(self):
            async for _ in self._stream:
                yield {"kind": "message_start"}
                yield {"kind": "delta", "text": "partiel"}
                await gate.wait()
                # après interrupt(), le vrai SDK renvoie un result de fin ; on le simule
                yield {"kind": "result", "subtype": "error_during_execution", "session_id": "s"}

    client_holder = {}

    def factory(o):
        c = GatedClient([])
        client_holder["c"] = c
        return c

    bridge = ChatBridge("c5", store, factory)
    await bridge.start()
    q = asyncio.Queue()
    await bridge.attach(q, 0)
    await bridge.submit_prompt("vas-y")
    await asyncio.sleep(0.02)
    await bridge.stop()
    gate.set()
    # attendre message_stop
    status = None
    for _ in range(20):
        ev = await asyncio.wait_for(q.get(), 2.0)
        if ev["type"] == "message_stop":
            status = ev["status"]
            break
    assert status == "interrupted"
    assert client_holder["c"].interrupted is True
    recs = await store.read_since(0)
    assert any(r["type"] == "assistant_message" and r["text"] == "partiel" and r["status"] == "interrupted" for r in recs)
    await bridge.shutdown()


@pytest.mark.asyncio
async def test_cancel_queued(tmp_path):
    store = ConversationStore(tmp_path, "c6")
    bridge = ChatBridge("c6", store, _factory([]))
    await bridge.start()
    bridge._state = "running"  # forcer l'état pour tester la file isolément
    await bridge.submit_prompt("a")
    await bridge.submit_prompt("b")
    assert bridge.pending == ["a", "b"]
    await bridge.cancel_queued(0)
    assert bridge.pending == ["b"]
    await bridge.shutdown()
```

- [ ] **Step 2 : Lancer (échoue)** — Run: `uv run pytest tests/unit/test_chat_bridge.py -v` → FAIL (`stop`/`cancel_queued` absents).

- [ ] **Step 3 : Implémenter** — ajouter à `ChatBridge` :

```python
    async def stop(self) -> None:
        async with self._lock:
            if self._state != "running" or self._client is None:
                return
            self._stop_requested = True
        await self._client.interrupt()  # le result de fin arrivera dans _consume -> _finalize (status=interrupted)

    async def cancel_queued(self, index: int) -> None:
        async with self._lock:
            if 0 <= index < len(self._pending):
                self._pending.pop(index)
                self._broadcast_queued()
```

> Drain (§8) : la boucle `_consume` unique lit le `result` du tour interrompu **avant** que `_finalize` ne dépile la file (le prompt suivant n'est poussé dans `_to_sdk` qu'au `_start_turn`). Aucun reste mal attribué.

- [ ] **Step 4 : Lancer (passe)** — Run: `uv run pytest tests/unit/test_chat_bridge.py -v` → PASS.

- [ ] **Step 5 : Commit**

```bash
git add mekistudio/backend/chat/bridge.py tests/unit/test_chat_bridge.py
git commit -m "feat(chat): stop (interrupt -> interrupted), file FIFO, cancel_queued"
```

### Task 6 : `manager.py` — registre, resume, clear, shutdown

**Files:**
- Create: `mekistudio/backend/chat/manager.py`
- Test: `tests/unit/test_chat_manager.py`

- [ ] **Step 1 : Test**

```python
import asyncio

import pytest

from mekistudio.backend.chat.manager import ChatManager


class FakeClient:
    def __init__(self, *_):
        self._stream = None

    async def connect(self, stream):
        self._stream = stream

    async def receive(self):
        if False:
            yield {}
        await asyncio.sleep(3600)  # ne produit rien

    async def interrupt(self):
        ...

    async def disconnect(self):
        ...


@pytest.mark.asyncio
async def test_get_or_create_idempotent_and_clear(tmp_path):
    mgr = ChatManager(tmp_path, client_factory=lambda o: FakeClient())
    b1 = await mgr.get_or_create("conv-A")
    b2 = await mgr.get_or_create("conv-A")
    assert b1 is b2
    new_id = await mgr.clear("conv-A")
    assert new_id != "conv-A"
    b3 = await mgr.get_or_create(new_id)
    assert b3 is not b1
    # ancien dossier conservé si écrit ; nouveau bridge frais
    await mgr.shutdown()


@pytest.mark.asyncio
async def test_resume_passed_when_meta_has_session(tmp_path):
    from mekistudio.backend.chat.store import ConversationStore

    captured = {}

    def factory(options):
        captured["resume"] = getattr(options, "resume", "MISSING")
        return FakeClient()

    s = ConversationStore(tmp_path, "conv-R")
    await s.set_session_id("sid-xyz")
    mgr = ChatManager(tmp_path, client_factory=factory)
    await mgr.get_or_create("conv-R")
    # build_options lit meta.claude_session_id -> resume
    assert captured["resume"] == "sid-xyz"
    await mgr.shutdown()
```

- [ ] **Step 2 : Lancer (échoue)** — Run: `uv run pytest tests/unit/test_chat_manager.py -v` → FAIL import.

- [ ] **Step 3 : Implémenter** `mekistudio/backend/chat/manager.py` :

```python
from __future__ import annotations

from pathlib import Path

from mekistudio.backend.chat import events
from mekistudio.backend.chat.bridge import ChatBridge, default_client_factory
from mekistudio.backend.chat.store import ConversationStore


class ChatManager:
    def __init__(self, repo_root: Path, client_factory=default_client_factory) -> None:
        self._root = Path(repo_root)
        self._factory = client_factory
        self._bridges: dict[str, ChatBridge] = {}

    async def get_or_create(self, conversation_id: str) -> ChatBridge:
        bridge = self._bridges.get(conversation_id)
        if bridge is None:
            store = ConversationStore(self._root, conversation_id)
            bridge = ChatBridge(conversation_id, store, self._factory)
            await bridge.start()
            self._bridges[conversation_id] = bridge
        return bridge

    async def clear(self, old_id: str) -> str:
        bridge = self._bridges.pop(old_id, None)
        if bridge is not None:
            await bridge.shutdown()
        new_id = events.new_id()
        await self.get_or_create(new_id)
        return new_id

    async def shutdown(self) -> None:
        for bridge in list(self._bridges.values()):
            await bridge.shutdown()
        self._bridges.clear()
```

> `build_options` (Task 3) lit `store.meta().get("claude_session_id")` → `resume` ; le test `test_resume_passed_when_meta_has_session` le vérifie via un faux `options` (objet `ClaudeAgentOptions` réel construit par `build_options`). Si l'import SDK n'est pas disponible en CI, marquer ce test `@pytest.mark.integration` ou injecter une `build_options` factice — au choix de l'implémenteur, documenté ici.

- [ ] **Step 4 : Lancer (passe)** — Run: `uv run pytest tests/unit/test_chat_manager.py -v` → PASS (le test resume nécessite le SDK installé pour `build_options`).

- [ ] **Step 5 : Commit**

```bash
git add mekistudio/backend/chat/manager.py tests/unit/test_chat_manager.py
git commit -m "feat(chat): ChatManager (registre par conversation_id, resume, clear, shutdown)"
```

---

## Phase 2 — Node & transport

### Task 7 : `ChatComponent`

**Files:**
- Modify: `mekistudio/backend/components/primitives.py`, `mekistudio/backend/components/__init__.py`
- Test: `tests/unit/test_chat_node.py`

- [ ] **Step 1 : Test**

```python
from mekistudio.backend.components.primitives import ChatComponent, Component
from mekistudio.backend.models import Node
from mekistudio.backend.components import NodeComponent, LayoutComponent


def test_chatcomponent_roundtrip_and_in_node():
    c = ChatComponent()
    assert c.type == "chat" and c.title == "chat" and c.placeholder
    assert isinstance(c.conversation_id, str) and len(c.conversation_id) > 0
    node = Node(kind="chat", root=NodeComponent(children=[LayoutComponent(children=[c])]))
    dumped = node.model_dump(mode="json")
    back = Node.model_validate(dumped)
    inner = back.root.children[0].children[0]
    assert inner.type == "chat" and inner.conversation_id == c.conversation_id
```

- [ ] **Step 2 : Lancer (échoue)** — Run: `uv run pytest tests/unit/test_chat_node.py::test_chatcomponent_roundtrip_and_in_node -v` → FAIL (`ChatComponent` absent).

- [ ] **Step 3 : Implémenter** — dans `primitives.py`, ajouter la classe (près des autres composants) :

```python
class ChatComponent(ComponentBase):
    type: Literal["chat"] = "chat"
    conversation_id: str = Field(default_factory=new_id)
    title: str = "chat"
    placeholder: str = "Écris à Claude…"
```

Ajouter `ChatComponent` à l'union `Component` (dans le `Union[...]` discriminé sur `type`). **Après** la définition de l'union, conserver/ajouter les rebuilds des modèles qui référencent l'union :

```python
LayoutComponent.model_rebuild()
NodeComponent.model_rebuild()
```

Dans `components/__init__.py`, exporter `ChatComponent` (l'ajouter à la liste d'imports et à `__all__`).

- [ ] **Step 4 : Lancer (passe)** — Run: `uv run pytest tests/unit/test_chat_node.py -v` → PASS.

- [ ] **Step 5 : Commit**

```bash
git add mekistudio/backend/components/primitives.py mekistudio/backend/components/__init__.py tests/unit/test_chat_node.py
git commit -m "feat(chat): ChatComponent (union discriminee, rebuild Layout/Node)"
```

### Task 8 : `build_chat_node`

**Files:**
- Create: `mekistudio/backend/nodes/chat.py`
- Modify: `mekistudio/backend/nodes/__init__.py`
- Test: `tests/unit/test_chat_node.py` (ajout)

- [ ] **Step 1 : Test**

```python
from mekistudio.backend.nodes.chat import KIND, build_chat_node


def test_build_chat_node():
    n = build_chat_node()
    assert n.kind == KIND == "chat"
    assert (n.x, n.y, n.w, n.h) == (-440.0, 0.0, 400.0, 520.0)
    assert n.movable and n.resizable
    chat = n.root.children[0].children[0]
    assert chat.type == "chat" and chat.conversation_id
```

- [ ] **Step 2 : Lancer (échoue)** — Run: `uv run pytest tests/unit/test_chat_node.py::test_build_chat_node -v` → FAIL import.

- [ ] **Step 3 : Implémenter** `mekistudio/backend/nodes/chat.py` :

```python
from __future__ import annotations

from mekistudio.backend.components import ChatComponent, LayoutComponent, NodeComponent
from mekistudio.backend.models import Node

KIND = "chat"


def build_chat_node(x: float = -440.0, y: float = 0.0) -> Node:
    """Node chat built-in, à gauche du kernel (x=-440, w=400 -> bord droit -40, pas de
    chevauchement). movable/resizable comme l'éditeur."""
    return Node(
        kind=KIND,
        x=x,
        y=y,
        w=400.0,
        h=520.0,
        movable=True,
        resizable=True,
        root=NodeComponent(children=[LayoutComponent(children=[ChatComponent()])]),
    )
```

Dans `nodes/__init__.py`, ajouter `from mekistudio.backend.nodes import chat` (suivre le style des autres imports du module).

- [ ] **Step 4 : Lancer (passe)** — Run: `uv run pytest tests/unit/test_chat_node.py -v` → PASS.

- [ ] **Step 5 : Commit**

```bash
git add mekistudio/backend/nodes/chat.py mekistudio/backend/nodes/__init__.py tests/unit/test_chat_node.py
git commit -m "feat(chat): build_chat_node (built-in, gauche du kernel)"
```

### Task 9 : Registry + `default_canvas` + stabilité `conversation_id`

**Files:**
- Modify: `mekistudio/backend/nodes/registry.py`
- Test: `tests/unit/test_chat_node.py` (ajout)

- [ ] **Step 1 : Test**

```python
from mekistudio.backend.nodes.registry import default_canvas, NODE_BUILDERS, CANONICAL_PARENT_KIND
from mekistudio.backend.bootstrap import load_canvas, save_canvas


def test_chat_in_default_canvas_linked_to_kernel():
    state = default_canvas()
    kinds = {n.kind for n in state.nodes}
    assert {"kernel", "fileexplorer", "chat"} <= kinds
    assert NODE_BUILDERS["chat"]
    assert CANONICAL_PARENT_KIND["chat"] == "kernel"
    kernel = next(n for n in state.nodes if n.kind == "kernel")
    chat = next(n for n in state.nodes if n.kind == "chat")
    assert chat.source_id == kernel.id


def test_conversation_id_survives_load_reconcile_save(tmp_path):
    state = default_canvas()
    chat = next(n for n in state.nodes if n.kind == "chat")
    cid = chat.root.children[0].children[0].conversation_id
    save_canvas(tmp_path, state)
    reloaded = load_canvas(tmp_path)  # déclenche reconcile_constraints + reconcile_source_links
    chat2 = next(n for n in reloaded.nodes if n.kind == "chat")
    assert chat2.root.children[0].children[0].conversation_id == cid
```

- [ ] **Step 2 : Lancer (échoue)** — Run: `uv run pytest tests/unit/test_chat_node.py -v` → FAIL (chat absent du registry).

- [ ] **Step 3 : Implémenter** — dans `registry.py` :
- importer `chat` : `from mekistudio.backend.nodes import chat` (à la ligne des imports de nodes).
- `NODE_BUILDERS["chat"] = chat.build_chat_node`.
- `CANONICAL_PARENT_KIND["chat"] = "kernel"`.
- dans `default_canvas()`, après l'explorer, ajouter le chat lié au kernel :

```python
    c = chat.build_chat_node()
    c.source_id = k.id
    return CanvasState(nodes=[k, e, c])
```

(adapter aux noms locaux réels `k`/`e` ; ajouter `c` à la liste retournée). `reconcile_constraints`/`reconcile_source_links` couvrent `chat` automatiquement (kind connu) et n'inspectent jamais `node.root` → `conversation_id` stable.

- [ ] **Step 4 : Lancer (passe)** — Run: `uv run pytest tests/unit/test_chat_node.py tests/unit -k "registry or default or conversation or chat" -v` puis `uv run pytest` → tout vert.

- [ ] **Step 5 : Commit**

```bash
git add mekistudio/backend/nodes/registry.py tests/unit/test_chat_node.py
git commit -m "feat(chat): chat built-in dans default_canvas (source_id=kernel), conversation_id stable"
```

### Task 10 : Router WS + `app.py` lifespan + rotation `conversation_id`

**Files:**
- Create: `mekistudio/frontend/routes/chat_ws.py`
- Modify: `mekistudio/frontend/app.py`
- Test: `tests/unit/test_chat_ws.py`

- [ ] **Step 1 : Test (WS de bout en bout avec faux client)**

```python
import asyncio

from starlette.testclient import TestClient

from mekistudio.frontend.app import create_app


class FakeClient:
    def __init__(self, *_):
        self._stream = None

    async def connect(self, stream):
        self._stream = stream

    async def receive(self):
        async for _ in self._stream:
            yield {"kind": "message_start"}
            yield {"kind": "delta", "text": "salut"}
            yield {"kind": "assistant", "text": "salut"}
            yield {"kind": "result", "subtype": "success", "session_id": "sid"}

    async def interrupt(self):
        ...

    async def disconnect(self):
        ...


def test_ws_prompt_streams_text(tmp_path):
    app = create_app(tmp_path, chat_client_factory=lambda o: FakeClient())
    client = TestClient(app)
    with client.websocket_connect("/ws/chat/conv1") as ws:
        ws.send_json({"type": "attach", "since_seq": 0})
        ws.send_json({"type": "prompt", "text": "coucou"})
        types = []
        for _ in range(30):
            ev = ws.receive_json()
            types.append(ev["type"])
            if ev["type"] == "message_stop":
                break
        assert "user_message" in types and "message_start" in types
        assert "text_delta" in types and "message_stop" in types
```

- [ ] **Step 2 : Lancer (échoue)** — Run: `uv run pytest tests/unit/test_chat_ws.py -v` → FAIL (route/lifespan absents).

- [ ] **Step 3 : Implémenter** `mekistudio/frontend/routes/chat_ws.py` :

```python
from __future__ import annotations

import asyncio
from pathlib import Path

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from mekistudio.backend.bootstrap import load_canvas, save_canvas
from mekistudio.backend.components import iter_components
from mekistudio.frontend.routes.canvas import _canvas_lock  # lock partagé des écritures canvas.json

router = APIRouter()


async def _rotate_node_conversation(repo_root: Path, old_id: str, new_id: str) -> None:
    async with _canvas_lock:
        state = load_canvas(repo_root)
        for node in state.nodes:
            for comp in iter_components(node.root):
                if getattr(comp, "type", None) == "chat" and getattr(comp, "conversation_id", None) == old_id:
                    comp.conversation_id = new_id
                    save_canvas(repo_root, state)
                    return


@router.websocket("/ws/chat/{conversation_id}")
async def chat_ws(ws: WebSocket, conversation_id: str) -> None:
    await ws.accept()
    manager = ws.app.state.chat_manager
    repo_root = ws.app.state.repo_root
    bridge = await manager.get_or_create(conversation_id)
    queue: asyncio.Queue = asyncio.Queue(maxsize=1000)

    async def sender() -> None:
        while True:
            ev = await queue.get()
            await ws.send_json(ev)

    async def receiver() -> None:
        while True:
            msg = await ws.receive_json()
            t = msg.get("type")
            if t == "attach":
                await bridge.attach(queue, int(msg.get("since_seq", 0)))
            elif t == "prompt":
                await bridge.submit_prompt(msg.get("text", ""))
            elif t == "stop":
                await bridge.stop()
            elif t == "cancel_queued":
                await bridge.cancel_queued(int(msg.get("index", -1)))
            elif t == "clear":
                new_id = await manager.clear(conversation_id)
                await _rotate_node_conversation(repo_root, conversation_id, new_id)
                await ws.send_json({"type": "cleared", "conversation_id": new_id})
                return  # termine -> fermeture serveur ; le client reconnecte sur new_id

    sender_task = asyncio.create_task(sender())
    receiver_task = asyncio.create_task(receiver())
    try:
        await asyncio.wait({sender_task, receiver_task}, return_when=asyncio.FIRST_COMPLETED)
    except WebSocketDisconnect:
        pass
    finally:
        for task in (sender_task, receiver_task):
            task.cancel()
        bridge.unsubscribe(queue)  # NE détruit PAS le bridge (D5)
```

Dans `app.py` : ajouter le lifespan + l'injection + le router. Modifier `create_app` :

```python
from contextlib import asynccontextmanager

from mekistudio.backend.chat.bridge import default_client_factory
from mekistudio.backend.chat.manager import ChatManager
from mekistudio.frontend.routes import chat_ws


@asynccontextmanager
async def _lifespan(app):
    app.state.chat_manager = ChatManager(app.state.repo_root, app.state.chat_client_factory)
    try:
        yield
    finally:
        await app.state.chat_manager.shutdown()


def create_app(repo_root=None, *, chat_client_factory=None):
    # ... résolution de repo_root inchangée ...
    app = FastAPI(title="mekistudio-2", lifespan=_lifespan)
    app.state.repo_root = repo_root
    app.state.chat_client_factory = chat_client_factory or default_client_factory
    # ... mount static + include canvas/fs (inchangé) ...
    app.include_router(chat_ws.router)
    return app
```

(Conserver le reste de `create_app` ; n'ajouter que `lifespan=`, `app.state.chat_client_factory`, l'`include_router`.)

- [ ] **Step 4 : Lancer (passe)** — Run: `uv run pytest tests/unit/test_chat_ws.py -v` puis `uv run pytest` → tout vert.

- [ ] **Step 5 : Commit**

```bash
git add mekistudio/frontend/routes/chat_ws.py mekistudio/frontend/app.py tests/unit/test_chat_ws.py
git commit -m "feat(chat): router WS /ws/chat + lifespan ChatManager + rotation conversation_id (clear)"
```

---

## Phase 3 — Front

### Task 11 : `chat-model.js` — réducteur pur

**Files:**
- Create: `mekistudio/frontend/static/js/chat-model.js`, `mekistudio/frontend/static/js/chat-model.test.js`

- [ ] **Step 1 : Test (`node --test`)**

```js
const test = require('node:test');
const assert = require('node:assert');
const MekiChat = require('./chat-model.js');

test('live: deltas assemblés puis finalisés', () => {
  let s = MekiChat.createState();
  s = MekiChat.reduce(s, { type: 'user_message', seq: 1, ts: 0, text: 'hi' });
  s = MekiChat.reduce(s, { type: 'message_start', message_id: 'm1' });
  s = MekiChat.reduce(s, { type: 'text_delta', message_id: 'm1', text: 'Bon' });
  s = MekiChat.reduce(s, { type: 'text_delta', message_id: 'm1', text: 'jour' });
  s = MekiChat.reduce(s, { type: 'message_stop', message_id: 'm1', seq: 2, status: 'success' });
  assert.equal(s.messages.length, 2);
  assert.equal(s.messages[1].text, 'Bonjour');
  assert.equal(s.messages[1].status, 'success');
  assert.equal(s.lastSeq, 2);
});

test('message_start est idempotent (double attach -> reset, pas de doublon)', () => {
  let s = MekiChat.createState();
  s = MekiChat.reduce(s, { type: 'message_start', message_id: 'm1' });
  s = MekiChat.reduce(s, { type: 'text_delta', message_id: 'm1', text: 'AB' });
  // reattach : re-message_start + re-delta complet
  s = MekiChat.reduce(s, { type: 'message_start', message_id: 'm1' });
  s = MekiChat.reduce(s, { type: 'text_delta', message_id: 'm1', text: 'AB' });
  assert.equal(s.messages.length, 1);
  assert.equal(s.messages[0].text, 'AB');
});

test('replay assistant_message + dédup par seq (replay puis live = bulle unique)', () => {
  let s = MekiChat.createState();
  s = MekiChat.reduce(s, { type: 'message_start', message_id: 'm1' });
  s = MekiChat.reduce(s, { type: 'text_delta', message_id: 'm1', text: 'X' });
  s = MekiChat.reduce(s, { type: 'message_stop', message_id: 'm1', seq: 5, status: 'success' });
  // un replay du record durable même seq ne doit pas dupliquer
  s = MekiChat.reduce(s, { type: 'assistant_message', seq: 5, ts: 0, text: 'X', status: 'success' });
  assert.equal(s.messages.filter((m) => m.kind === 'assistant').length, 1);
});

test('queued met à jour la file ; error crée une bulle', () => {
  let s = MekiChat.createState();
  s = MekiChat.reduce(s, { type: 'queued', items: [{ index: 0, text: 'a' }] });
  assert.deepEqual(s.queue, [{ index: 0, text: 'a' }]);
  s = MekiChat.reduce(s, { type: 'error', seq: 9, message: 'boom' });
  assert.equal(s.messages.at(-1).kind, 'error');
  assert.equal(s.lastSeq, 9);
});
```

- [ ] **Step 2 : Lancer (échoue)** — Run: `node --test mekistudio/frontend/static/js/chat-model.test.js` → FAIL (module absent).

- [ ] **Step 3 : Implémenter** `mekistudio/frontend/static/js/chat-model.js` :

```js
(function (root) {
  'use strict';

  function createState() {
    return { messages: [], byId: {}, bySeq: {}, inFlight: null, lastSeq: 0, queue: [], state: 'idle' };
  }

  function _bumpSeq(state, seq) {
    if (typeof seq === 'number' && seq > state.lastSeq) state.lastSeq = seq;
  }

  function reduce(state, ev) {
    switch (ev.type) {
      case 'user_message': {
        if (ev.seq && state.bySeq[ev.seq]) break;
        const m = { kind: 'user', text: ev.text, ts: ev.ts, status: 'final', seq: ev.seq };
        state.messages.push(m);
        if (ev.seq) state.bySeq[ev.seq] = m;
        _bumpSeq(state, ev.seq);
        break;
      }
      case 'message_start': {
        let m = state.byId[ev.message_id];
        if (!m) {
          m = { kind: 'assistant', message_id: ev.message_id, text: '', status: 'streaming' };
          state.byId[ev.message_id] = m;
          state.messages.push(m);
        } else {
          m.text = '';
          m.status = 'streaming';
        }
        state.inFlight = m;
        break;
      }
      case 'text_delta': {
        const m = state.byId[ev.message_id];
        if (m) m.text += ev.text;
        break;
      }
      case 'message_stop': {
        const m = state.byId[ev.message_id];
        if (m) {
          m.status = ev.status;
          m.seq = ev.seq;
          if (ev.seq) state.bySeq[ev.seq] = m;
        }
        state.inFlight = null;
        _bumpSeq(state, ev.seq);
        break;
      }
      case 'assistant_message': {
        if (ev.seq && state.bySeq[ev.seq]) { _bumpSeq(state, ev.seq); break; }
        const m = { kind: 'assistant', text: ev.text, status: ev.status, seq: ev.seq };
        state.messages.push(m);
        if (ev.seq) state.bySeq[ev.seq] = m;
        _bumpSeq(state, ev.seq);
        break;
      }
      case 'session':
        _bumpSeq(state, ev.seq);
        break;
      case 'error': {
        const m = { kind: 'error', text: ev.message, status: 'error', seq: ev.seq };
        state.messages.push(m);
        if (ev.seq) state.bySeq[ev.seq] = m;
        _bumpSeq(state, ev.seq);
        break;
      }
      case 'queued':
        state.queue = (ev.items || []).slice();
        break;
      default:
        break;
    }
    return state;
  }

  const MekiChat = { createState, reduce };
  if (typeof module !== 'undefined' && module.exports) module.exports = MekiChat;
  if (typeof window !== 'undefined') root.MekiChat = MekiChat;
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 4 : Lancer (passe)** — Run: `node --test mekistudio/frontend/static/js/chat-model.test.js` → PASS (4 tests).

- [ ] **Step 5 : Commit**

```bash
git add mekistudio/frontend/static/js/chat-model.js mekistudio/frontend/static/js/chat-model.test.js
git commit -m "feat(chat): chat-model.js reducteur pur (live+replay, dedup seq, node --test)"
```

### Task 12 : Vendoring `marked`/`DOMPurify` + ordre des scripts

**Files:**
- Create: `mekistudio/frontend/static/vendor/marked.min.js`, `mekistudio/frontend/static/vendor/purify.min.js`
- Modify: `mekistudio/frontend/templates/canvas.html`

- [ ] **Step 1 : Récupérer les libs vendored**

Run:
```bash
curl -L -o mekistudio/frontend/static/vendor/marked.min.js https://cdn.jsdelivr.net/npm/marked@12/marked.min.js
curl -L -o mekistudio/frontend/static/vendor/purify.min.js https://cdn.jsdelivr.net/npm/dompurify@3/dist/purify.min.js
```
Expected: deux fichiers non vides. Vérifier qu'ils exposent bien `window.marked` et `window.DOMPurify` (UMD) :
Run: `node -e "global.window=global; require('./mekistudio/frontend/static/vendor/purify.min.js'); console.log(typeof window.DOMPurify)"`
Expected: `function` (ou `object`). Idem pour `marked`.

- [ ] **Step 2 : Insérer les scripts dans le template (ordre déterministe)**

Dans `canvas.html`, dans le bloc de `<script defer>` existant (cables → collision → canvas → Alpine → editor module), insérer **avant `canvas.js`** :

```html
<script defer src="/static/vendor/marked.min.js"></script>
<script defer src="/static/vendor/purify.min.js"></script>
<script defer src="/static/js/chat-model.js"></script>
<script defer src="/static/js/chat-view.js"></script>
```

Ordre final des `defer` : `cables.js`, `collision.js`, `marked.min.js`, `purify.min.js`, `chat-model.js`, `chat-view.js`, `canvas.js`, **puis** Alpine (`defer`), **puis** `editor.js` (module). Les `defer` s'exécutent dans l'ordre du document, avant `alpine:init` → `window.MekiChat`/`marked`/`DOMPurify` prêts au 1er rendu.

- [ ] **Step 3 : Vérifier le service statique**

Run: `uv run mekistudio serve` (dans un terminal) puis dans un autre : `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8777/static/vendor/purify.min.js`
Expected: `200`. (Arrêter le serveur ensuite.)

- [ ] **Step 4 : Commit**

```bash
git add mekistudio/frontend/static/vendor/marked.min.js mekistudio/frontend/static/vendor/purify.min.js mekistudio/frontend/templates/canvas.html
git commit -m "chore(chat): vendoring marked+DOMPurify + ordre des scripts (defer avant Alpine)"
```

### Task 13 : `chat-view.js` — vue DOM + cycle de vie WS

**Files:**
- Create: `mekistudio/frontend/static/js/chat-view.js`
- Modify: `mekistudio/frontend/static/js/canvas.js` (branche `renderComponent` + registre `_chatViews`/`destroy`)

- [ ] **Step 1 : Écrire `chat-view.js`**

```js
(function (root) {
  'use strict';

  function el(tag, cls, attrs) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }

  function renderMarkdown(text) {
    if (window.marked && window.DOMPurify) {
      return window.DOMPurify.sanitize(window.marked.parse(text || ''));
    }
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML; // fallback : texte échappé, jamais de HTML brut
  }

  // Monte la vue chat dans `container`. Retourne { el, destroy }.
  function mount(container, conversationId, component) {
    const MekiChat = window.MekiChat;
    let convId = conversationId;
    let state = MekiChat.createState();
    let ws = null;
    let generation = 0;
    let intentionalClose = false;
    let backoff = 500;
    let reconnectTimer = null;

    // --- DOM ---
    const wrap = el('div', 'cmp-chat');
    const header = el('div', 'chat-header');
    const title = el('span', 'chat-title');
    title.textContent = (component && component.title) || 'chat';
    const dot = el('span', 'chat-dot');
    const spacer = el('span', 'chat-spacer');
    const newBtn = el('button', 'chat-new');
    newBtn.textContent = '✨ Nouvelle session';
    header.append(dot, title, spacer, newBtn);

    const statusBar = el('div', 'chat-statusbar');
    const statusText = el('span', 'chat-status-text');
    statusText.textContent = '✦ Claude écrit…';
    const stopBtn = el('button', 'chat-stop');
    stopBtn.textContent = '⏹ Stop';
    statusBar.append(statusText, stopBtn);
    statusBar.style.display = 'none';

    const list = el('div', 'chat-messages');
    const chips = el('div', 'chat-chips');
    const composer = el('div', 'chat-composer');
    const ta = el('textarea', 'chat-input');
    ta.placeholder = (component && component.placeholder) || 'Écris à Claude…';
    const send = el('button', 'chat-send');
    send.textContent = '➤';
    composer.append(ta, send);
    wrap.append(header, statusBar, list, chips, composer);
    container.append(wrap);

    // empêcher le node-wrap parent de capter scroll/clic (move/zoom)
    [list, ta].forEach((e) => e.addEventListener('wheel', (ev) => ev.stopPropagation()));
    [composer, header, statusBar, chips].forEach((e) =>
      e.addEventListener('mousedown', (ev) => ev.stopPropagation())
    );

    // --- rendu ---
    function render() {
      list.innerHTML = '';
      for (const m of state.messages) {
        const row = el('div', 'chat-row chat-' + m.kind);
        const avatar = el('div', 'chat-avatar chat-av-' + m.kind);
        avatar.textContent = m.kind === 'user' ? 'C' : m.kind === 'assistant' ? '✦' : '!';
        const body = el('div', 'chat-body');
        const name = el('div', 'chat-name');
        name.textContent = m.kind === 'user' ? 'charles' : m.kind === 'assistant' ? 'Claude' : 'erreur';
        const content = el('div', 'chat-content');
        if (m.kind === 'assistant' && m.status !== 'streaming') {
          content.innerHTML = renderMarkdown(m.text);
        } else {
          content.textContent = m.text || '';
        }
        if (m.status === 'streaming') content.append(el('span', 'chat-cursor'));
        if (m.status === 'interrupted') body.append(name, content, el('div', 'chat-interrupted'));
        else body.append(name, content);
        row.append(avatar, body);
        list.append(row);
      }
      list.scrollTop = list.scrollHeight;

      const running = state.state === 'running' || !!state.inFlight;
      statusBar.style.display = running ? 'flex' : 'none';

      chips.innerHTML = '';
      state.queue.forEach((it) => {
        const chip = el('span', 'chat-chip');
        chip.textContent = '⏳ ' + it.text + ' ';
        const x = el('span', 'chat-chip-x');
        x.textContent = '✕';
        x.addEventListener('click', () => sendWs({ type: 'cancel_queued', index: it.index }));
        chip.append(x);
        chips.append(chip);
      });
    }

    function applyEvent(ev) {
      if (ev.type === 'message_start' || ev.type === 'text_delta') {
        state.state = 'running';
      }
      if (ev.type === 'message_stop') state.state = 'idle';
      MekiChat.reduce(state, ev);
      render();
    }

    // --- WebSocket ---
    function sendWs(obj) {
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
    }

    function connect() {
      const myGen = ++generation;
      intentionalClose = false;
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(`${proto}://${location.host}/ws/chat/${convId}`);
      ws.addEventListener('open', () => {
        backoff = 500;
        sendWs({ type: 'attach', since_seq: state.lastSeq });
      });
      ws.addEventListener('message', (e) => {
        if (myGen !== generation) return; // socket périmée
        const ev = JSON.parse(e.data);
        if (ev.type === 'cleared') {
          rotateTo(ev.conversation_id);
          return;
        }
        applyEvent(ev);
      });
      ws.addEventListener('close', () => {
        if (intentionalClose || myGen !== generation) return;
        reconnectTimer = setTimeout(connect, backoff + Math.random() * 250);
        backoff = Math.min(backoff * 2, 8000);
      });
    }

    function closeWs() {
      intentionalClose = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = null;
      if (ws) {
        try { ws.close(); } catch (_) {}
      }
    }

    function rotateTo(newId) {
      closeWs();
      convId = newId;
      if (component) component.conversation_id = newId;
      state = MekiChat.createState();
      render();
      connect();
    }

    // --- interactions ---
    send.addEventListener('click', () => submit());
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submit();
      }
    });
    function submit() {
      const text = ta.value.trim();
      if (!text) return;
      sendWs({ type: 'prompt', text });
      ta.value = '';
    }
    stopBtn.addEventListener('click', () => sendWs({ type: 'stop' }));
    newBtn.addEventListener('click', () => sendWs({ type: 'clear' }));

    render();
    connect();

    return {
      el: wrap,
      destroy() {
        generation++; // invalide les closures de socket
        closeWs();
      },
    };
  }

  const MekiChatView = { mount };
  if (typeof window !== 'undefined') root.MekiChatView = MekiChatView;
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 2 : Brancher dans `canvas.js`**

Dans l'objet Alpine `canvas`, ajouter un registre près de `_editors` :

```js
_chatViews: {},
```

Dans `renderComponent(c, node)`, ajouter une branche pour le type `chat` (calquée sur la branche `editor`) :

```js
if (c.type === 'chat') {
  const host = document.createElement('div');
  host.className = 'cmp-chat-host';
  // monter après insertion dans le DOM
  queueMicrotask(() => {
    const view = window.MekiChatView.mount(host, c.conversation_id, c);
    this._chatViews[node.id] = view;
  });
  return host;
}
```

Dans `rerenderNode(node)` (avant le `replaceChildren`) et dans la suppression d'un wrap / `closeEditor`, détruire la vue chat existante si présente :

```js
if (this._chatViews[node.id]) {
  this._chatViews[node.id].destroy();
  delete this._chatViews[node.id];
}
```

Dans `renderNodes(nodes)` (boot/reload, avant le `replaceChildren` global), détruire toutes les vues existantes :

```js
Object.values(this._chatViews).forEach((v) => v.destroy());
this._chatViews = {};
```

- [ ] **Step 3 : Vérif rapide chargement (pas de test auto ; validé en Phase 4)**

Run: `uv run mekistudio serve` puis ouvrir `http://127.0.0.1:8777/`, vérifier dans la console qu'il n'y a **aucune** erreur `MekiChatView is not defined` / `MekiChat is not defined`. (Validation complète en Task 15.)

- [ ] **Step 4 : Commit**

```bash
git add mekistudio/frontend/static/js/chat-view.js mekistudio/frontend/static/js/canvas.js
git commit -m "feat(chat): chat-view.js (DOM Discord, WS lifecycle, generation, backoff) + branche renderComponent"
```

### Task 14 : CSS layout A (Discord-fidèle)

**Files:**
- Modify: `mekistudio/frontend/static/css/canvas.css`

- [ ] **Step 1 : Ajouter les styles** (fin de `canvas.css`) :

```css
/* --- node chat (Discord-fidèle, layout A) --- */
.cmp-chat { display: flex; flex-direction: column; height: 100%; min-height: 0; color: #dbe2ee; }
.chat-header { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-bottom: 1px solid #232a3d; }
.chat-title { font-weight: 700; font-size: 13px; }
.chat-dot { width: 8px; height: 8px; border-radius: 50%; background: #3ba55d; box-shadow: 0 0 8px #3ba55d; }
.chat-spacer { margin-left: auto; }
.chat-new { background: #1c2433; border: 1px solid #3a4660; color: #9fb3c8; border-radius: 7px; padding: 4px 9px; font-size: 11px; cursor: pointer; }
.chat-statusbar { display: flex; align-items: center; gap: 8px; padding: 6px 10px; background: #221b10; border-bottom: 1px solid #2c2410; font-size: 12px; color: #ffce6e; }
.chat-stop { margin-left: auto; background: #3a1518; border: 1px solid #e5484d; color: #ff8a8d; border-radius: 7px; padding: 4px 9px; font-size: 12px; cursor: pointer; }
.chat-messages { flex: 1; overflow-y: auto; padding: 10px; display: flex; flex-direction: column; gap: 14px; }
.chat-row { display: flex; gap: 10px; }
.chat-avatar { width: 32px; height: 32px; flex: 0 0 auto; display: flex; align-items: center; justify-content: center; font-size: 14px; font-weight: 700; color: #fff; }
.chat-av-user { border-radius: 50%; background: #4d8dff; }
.chat-av-assistant { border-radius: 9px; background: linear-gradient(135deg, #b388ff, #5865f2); }
.chat-av-error { border-radius: 9px; background: #e5484d; }
.chat-name { font-size: 12px; font-weight: 700; color: #b388ff; }
.chat-user .chat-name { color: #6ea0ff; }
.chat-content { font-size: 13px; line-height: 1.5; color: #dbe2ee; word-wrap: break-word; }
.chat-content pre { background: #11151d; padding: 8px; border-radius: 6px; overflow-x: auto; }
.chat-content code { background: #11151d; padding: 1px 5px; border-radius: 4px; }
.chat-cursor { display: inline-block; width: 7px; height: 14px; background: #dbe2ee; margin-left: 2px; vertical-align: text-bottom; animation: chatblink 1.05s steps(1) infinite; }
@keyframes chatblink { 50% { opacity: 0; } }
.chat-interrupted::before { content: "interrompu"; font-size: 10px; color: #ff8a8d; }
.chat-chips { display: flex; gap: 6px; flex-wrap: wrap; padding: 0 10px; }
.chat-chip { background: #1c2433; border: 1px solid #3a4660; border-radius: 14px; padding: 4px 10px; font-size: 11px; color: #9fb3c8; }
.chat-chip-x { color: #ff8a8d; cursor: pointer; margin-left: 4px; }
.chat-composer { display: flex; gap: 8px; padding: 10px; border-top: 1px solid #232a3d; }
.chat-input { flex: 1; resize: none; height: 38px; background: #11151d; border: 1px solid #2c3650; border-radius: 18px; padding: 9px 14px; color: #dbe2ee; font-size: 13px; font-family: inherit; }
.chat-send { background: #5865f2; border: none; border-radius: 18px; color: #fff; padding: 0 16px; font-weight: 600; cursor: pointer; }
```

- [ ] **Step 2 : Commit**

```bash
git add mekistudio/frontend/static/css/canvas.css
git commit -m "feat(chat): CSS layout A (bulles Discord, barre d'etat, chips, composer)"
```

---

## Phase 4 — Validation navigateur (Playwright) & finalisation

### Task 15 : Validation manuelle Playwright + ROADMAP

> Rappel mémoire projet : **Playwright (screenshot + console)** avant de dire « ça marche » ; restart `serve` + hard refresh (pas de hot-reload). Le node chat n'apparaît que si `canvas.json` contient le node : sur un repo avec un `canvas.json` **existant sans chat**, `_ensure_builtin_nodes` l'injecte au boot — sinon **supprimer `.mekistudio/canvas.json`** pour régénérer.

- [ ] **Step 1 : Lancer le serveur** — Run: `uv run mekistudio serve` (laisser tourner). Ouvrir `http://127.0.0.1:8777/`.

- [ ] **Step 2 : Stream** — Via Playwright (MCP) : taper « Dis bonjour en une phrase » dans le composer, Entrée. **Vérifier** : la bulle assistant se remplit token-par-token (curseur ▍), puis markdown rendu au `message_stop`. **Console : 0 erreur.** Screenshot.

- [ ] **Step 3 : Reattach « screen »** — Lancer un prompt long (« Explique les microservices en 6 paragraphes »), **recharger la page en plein streaming** (hard refresh). **Vérifier** : la conversation se rejoue **et continue** d'arriver (bulle unique, pas de doublon). Screenshot. **Vérifier l'absence de fuite** : pas d'erreur de reconnexion vers un DOM détaché en console.

- [ ] **Step 4 : Stop** — Relancer un prompt long, cliquer **⏹ Stop**. **Vérifier** : la bulle se fige avec « interrompu » ; un nouveau prompt repart normalement.

- [ ] **Step 5 : File** — Lancer un prompt long, taper+Entrée un 2ᵉ message pendant le tour → **chip « ⏳ … »** ; à la fin du 1ᵉ tour, le 2ᵉ s'exécute. Tester l'annulation (✕) d'une chip.

- [ ] **Step 6 : Nouvelle session** — Cliquer **✨ Nouvelle session** → affichage vidé, nouveau tour repart d'un contexte neuf. **Vérifier sur disque** : un nouveau dossier sous `.mekistudio/conversations/` ; l'ancien existe toujours.

- [ ] **Step 7 : Interactions canvas** — Scroller l'historique **ne zoome pas** le canvas ; cliquer/sélectionner dans le composer **ne déplace pas** le node ; déplacer le node → le câble chat↔kernel se recalcule.

- [ ] **Step 8 : Suite de tests complète** — Run: `uv run pytest` (vert, integration exclus) ; `node --test mekistudio/frontend/static/js/chat-model.test.js` (vert).

- [ ] **Step 9 : Mettre à jour la ROADMAP** — Dans `docs/ROADMAP.md`, cocher la 1ʳᵉ tranche « Node chat (ClaudeBridge) » : squelette livré (chat texte pur, streaming, screen/reattach, stop/file/nouvelle session) ; noter les briques restantes (tool-cards D, hooks→impulsions F, QCM E).

- [ ] **Step 10 : Commit**

```bash
git add docs/ROADMAP.md
git commit -m "docs(roadmap): node chat skeleton livre (texte pur, streaming, screen, stop/file/clear)"
```

---

## Auto-revue du plan (faite à l'écriture)

- **Couverture spec** : D1-D18 et §4-§9 mappés — outils OFF (T0/T3 `build_options`), streaming-input + interrupt (T0/T3/T5), records discrets + tolérance jsonl (T2), reattach atomique + in_flight_message_id (T4), file/stop/drain (T5), manager/clear/resume/shutdown (T6/T10), ChatComponent + rebuild Layout/Node (T7), built-in + conversation_id stable (T9), WS + lifespan + rotation sous `_canvas_lock` (T10), réducteur live+replay+dédup (T11), vendoring + ordre scripts (T12), vue + cycle de vie WS/generation/backoff/destroy (T13), CSS layout A (T14), Playwright + reattach + fuite WS + interactions (T15).
- **Pas de placeholder** : chaque step a son code/commande réels.
- **Cohérence des types** : `NormalizedClient` (connect/receive/interrupt/disconnect, events `{"kind": init|message_start|delta|assistant|result}`) identique entre `default_client_factory`, `FakeClient` (tests) et `_consume`. Events wire identiques entre `events.py`, le bridge, `chat-model.js` et `chat-view.js`. `conversation_id` lu depuis `c.conversation_id` (jamais `node.id`).
- **Risque résiduel assumé** : noms de symboles SDK (méthode `query` vs `connect` pour le streaming-input, forme de `SystemMessage.data`, subtype d'interrupt) — **figés par le smoke test (T0)** ; ajuster `options.py` si l'observation diffère.
