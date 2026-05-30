import asyncio

from mekistudio.backend.chat.bridge import ChatBridge
from mekistudio.backend.chat.store import ConversationStore


class FakeClient:
    """Client normalisé scripté. `scripts` = liste de scripts (un par tour). Un item
    {"kind": "_gate", "event": <asyncio.Event>} met le tour en pause jusqu'au set() (déterminisme)."""

    def __init__(self, scripts):
        self._scripts = list(scripts)
        self._stream = None
        self.interrupted = False
        self.disconnected = False

    async def connect(self, stream):
        self._stream = stream

    async def receive(self):
        async for _msg in self._stream:
            script = self._scripts.pop(0) if self._scripts else [{"kind": "result", "subtype": "success", "session_id": "sid"}]
            for ev in script:
                if ev.get("kind") == "_gate":
                    await ev["event"].wait()
                    continue
                yield ev

    async def interrupt(self):
        self.interrupted = True

    async def disconnect(self):
        self.disconnected = True


def _factory(scripts):
    return lambda options: FakeClient(scripts)


async def _drain_until(q, type_, timeout=2.0):
    while True:
        ev = await asyncio.wait_for(q.get(), timeout)
        if ev["type"] == type_:
            return ev


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
    assert "user_message" in types and "message_start" in types and "text_delta" in types

    recs = await store.read_since(0)
    assert [r["type"] for r in recs].count("user_message") == 1
    assert any(r["type"] == "assistant_message" and r["text"] == "Bonjour" and r["status"] == "success" for r in recs)
    assert all(r["type"] != "text_delta" for r in recs)  # deltas JAMAIS persistés
    assert store.meta()["claude_session_id"] == "sid-1"
    await bridge.shutdown()


async def test_reattach_during_turn_reuses_message_id(tmp_path):
    store = ConversationStore(tmp_path, "c3")
    gate = asyncio.Event()
    script = [
        {"kind": "message_start"},
        {"kind": "delta", "text": "AB"},
        {"kind": "_gate", "event": gate},
        {"kind": "assistant", "text": "ABCD"},
        {"kind": "result", "subtype": "success", "session_id": "s"},
    ]
    bridge = ChatBridge("c3", store, _factory([script]))
    await bridge.start()
    q1 = asyncio.Queue()
    await bridge.attach(q1, 0)
    await bridge.submit_prompt("go")

    seen = []
    while True:
        ev = await asyncio.wait_for(q1.get(), 2.0)
        seen.append(ev)
        if ev["type"] == "text_delta":
            break
    mid = next(e["message_id"] for e in seen if e["type"] == "message_start")

    q2 = asyncio.Queue()
    await bridge.attach(q2, 0)  # reconnexion EN PLEIN tour
    catchup = [await asyncio.wait_for(q2.get(), 2.0) for _ in range(3)]
    assert catchup[0]["type"] == "user_message"
    assert catchup[1]["type"] == "message_start" and catchup[1]["message_id"] == mid
    assert catchup[2]["type"] == "text_delta" and catchup[2]["text"] == "AB"

    gate.set()
    await bridge.shutdown()


async def test_queue_runs_after_current_turn(tmp_path):
    store = ConversationStore(tmp_path, "c4")
    gate = asyncio.Event()
    turn1 = [
        {"kind": "message_start"}, {"kind": "delta", "text": "x"},
        {"kind": "_gate", "event": gate},
        {"kind": "assistant", "text": "x"}, {"kind": "result", "subtype": "success", "session_id": "s"},
    ]
    turn2 = [
        {"kind": "message_start"}, {"kind": "delta", "text": "y"},
        {"kind": "assistant", "text": "y"}, {"kind": "result", "subtype": "success", "session_id": "s"},
    ]
    bridge = ChatBridge("c4", store, _factory([turn1, turn2]))
    await bridge.start()
    q = asyncio.Queue()
    await bridge.attach(q, 0)
    await bridge.submit_prompt("premier")
    await _drain_until(q, "text_delta")  # turn1 en vol (au gate)
    await bridge.submit_prompt("second")
    assert bridge.pending == ["second"]

    gate.set()
    stops = 0
    for _ in range(80):  # attendre la fin des 2 tours (2 message_stop)
        ev = await asyncio.wait_for(q.get(), 2.0)
        if ev["type"] == "message_stop":
            stops += 1
            if stops == 2:
                break
    assert stops == 2
    recs = await store.read_since(0)
    assert [r["text"] for r in recs if r["type"] == "user_message"] == ["premier", "second"]
    assert sum(1 for r in recs if r["type"] == "assistant_message") == 2
    await bridge.shutdown()


async def test_stop_interrupts_and_persists_partial(tmp_path):
    store = ConversationStore(tmp_path, "c5")
    gate = asyncio.Event()
    holder = {}
    turn = [
        {"kind": "message_start"}, {"kind": "delta", "text": "partiel"},
        {"kind": "_gate", "event": gate},
        {"kind": "result", "subtype": "error_during_execution", "session_id": "s"},
    ]

    def factory(o):
        c = FakeClient([turn])
        holder["c"] = c
        return c

    bridge = ChatBridge("c5", store, factory)
    await bridge.start()
    q = asyncio.Queue()
    await bridge.attach(q, 0)
    await bridge.submit_prompt("vas-y")
    await _drain_until(q, "text_delta")
    await bridge.stop()
    assert holder["c"].interrupted is True

    gate.set()
    stop_ev = await _drain_until(q, "message_stop")
    assert stop_ev["status"] == "interrupted"
    recs = await store.read_since(0)
    assert any(r["type"] == "assistant_message" and r["text"] == "partiel" and r["status"] == "interrupted" for r in recs)
    await bridge.shutdown()


async def test_cancel_queued(tmp_path):
    store = ConversationStore(tmp_path, "c6")
    bridge = ChatBridge("c6", store, _factory([]))
    await bridge.start()
    bridge._state = "running"  # isole la logique de file
    await bridge.submit_prompt("a")
    await bridge.submit_prompt("b")
    assert bridge.pending == ["a", "b"]
    await bridge.cancel_queued(0)
    assert bridge.pending == ["b"]
    await bridge.shutdown()


async def test_start_connect_error_degrades(tmp_path):
    store = ConversationStore(tmp_path, "c7")

    class BoomClient:
        async def connect(self, stream):
            raise RuntimeError("CLI claude introuvable")

        async def receive(self):
            if False:
                yield {}

        async def interrupt(self):
            ...

        async def disconnect(self):
            ...

    bridge = ChatBridge("c7", store, lambda o: BoomClient())
    await bridge.start()
    assert bridge.state == "error"
    q = asyncio.Queue()
    await bridge.attach(q, 0)
    await bridge.submit_prompt("hi")
    ev = await asyncio.wait_for(q.get(), 2.0)
    assert ev["type"] == "error" and "claude" in ev["message"].lower()
    await bridge.shutdown()


async def test_backpressure_drops_slow_socket_and_signals(tmp_path):
    # Socket lent (queue bornee jamais drainee) -> QueueFull -> desabonne + Event on_drop set (D17).
    store = ConversationStore(tmp_path, "cbp")
    script = (
        [{"kind": "message_start"}]
        + [{"kind": "delta", "text": "x"} for _ in range(20)]
        + [{"kind": "assistant", "text": "x" * 20}, {"kind": "result", "subtype": "success", "session_id": "s"}]
    )
    bridge = ChatBridge("cbp", store, _factory([script]))
    await bridge.start()
    q = asyncio.Queue(maxsize=3)
    drop = asyncio.Event()
    await bridge.attach(q, 0, on_drop=drop)
    await bridge.submit_prompt("go")
    await asyncio.wait_for(drop.wait(), 2.0)  # le bridge a signale la fermeture
    assert q not in bridge._subscribers
    await bridge.shutdown()


async def test_consume_error_finalizes_bubble_and_degrades(tmp_path):
    # Exception en plein tour -> bulle finalisee (error), file videe, etat 'error' (recover via clear).
    store = ConversationStore(tmp_path, "cerr")

    class BoomMidTurn(FakeClient):
        async def receive(self):
            async for _msg in self._stream:
                yield {"kind": "message_start"}
                yield {"kind": "delta", "text": "partiel"}
                raise RuntimeError("flux SDK casse")

    bridge = ChatBridge("cerr", store, lambda o: BoomMidTurn([]))
    await bridge.start()
    q = asyncio.Queue()
    await bridge.attach(q, 0)
    await bridge.submit_prompt("go")

    stop_ev = await _drain_until(q, "message_stop")
    assert stop_ev["status"] == "error"
    err = await _drain_until(q, "error")
    assert "casse" in err["message"]
    assert bridge.state == "error" and bridge.pending == []

    # un nouveau prompt renvoie une erreur explicite (pas de silence / zombie)
    await bridge.submit_prompt("encore")
    err2 = await _drain_until(q, "error")
    assert err2["type"] == "error"
    # le partiel a bien ete persiste comme assistant_message error
    recs = await store.read_since(0)
    assert any(r["type"] == "assistant_message" and r["text"] == "partiel" and r["status"] == "error" for r in recs)
    await bridge.shutdown()


# --- brique D : tours multi-étapes + outils ---

async def test_multistep_turn_with_tool(tmp_path):
    store = ConversationStore(tmp_path, "ct1")
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
    q = asyncio.Queue()
    await bridge.attach(q, 0)
    await bridge.submit_prompt("lis a.py")
    await _drain_until(q, "tool_result")
    recs = await store.read_since(0)
    assert [r["type"] for r in recs].count("assistant_message") == 2
    assert any(r["type"] == "tool_use" and r["id"] == "X" and r["name"] == "Read" for r in recs)
    assert any(r["type"] == "tool_result" and r["id"] == "X" and r["is_error"] is False for r in recs)
    await bridge.shutdown()


async def test_orphan_tool_closed_on_turn_end(tmp_path):
    store = ConversationStore(tmp_path, "ct2")
    script = [
        {"kind": "message_start"}, {"kind": "delta", "text": "lis"},
        {"kind": "assistant", "text": "lis", "tools": [{"id": "Y", "name": "Read", "input": {"file_path": "a.py"}}]},
        {"kind": "result", "subtype": "error_during_execution", "session_id": "s"},
    ]
    bridge = ChatBridge("ct2", store, _factory([script]), repo_root=tmp_path)
    await bridge.start()
    q = asyncio.Queue()
    await bridge.attach(q, 0)
    await bridge.submit_prompt("go")
    await _drain_until(q, "tool_result")  # le synthétique de fin de tour
    recs = await store.read_since(0)
    assert any(r["type"] == "tool_result" and r["id"] == "Y" and r["is_error"] is True for r in recs)
    await bridge.shutdown()


async def test_parallel_tools_one_group(tmp_path):
    # Le SDK livre UN AssistantMessage PAR bloc -> plusieurs AssistantMessage entre un même
    # message_start et message_stop (outils parallèles). Tous les tool_use doivent être captés.
    store = ConversationStore(tmp_path, "ctp")
    script = [
        {"kind": "message_start"},
        {"kind": "assistant", "text": "", "tools": [{"id": "A", "name": "Read", "input": {"file_path": "a.py"}}]},
        {"kind": "assistant", "text": "", "tools": [{"id": "B", "name": "Read", "input": {"file_path": "b.py"}}]},
        {"kind": "assistant", "text": "", "tools": [{"id": "C", "name": "Read", "input": {"file_path": "c.py"}}]},
        {"kind": "tool_result", "id": "A", "output": "x", "is_error": False},
        {"kind": "tool_result", "id": "B", "output": "y", "is_error": False},
        {"kind": "tool_result", "id": "C", "output": "z", "is_error": False},
        {"kind": "message_stop"},
        {"kind": "message_start"},
        {"kind": "delta", "text": "Fini"},
        {"kind": "assistant", "text": "Fini", "tools": []},
        {"kind": "message_stop"},
        {"kind": "result", "subtype": "success", "session_id": "s"},
    ]
    bridge = ChatBridge("ctp", store, _factory([script]), repo_root=tmp_path)
    await bridge.start()
    q = asyncio.Queue()
    await bridge.attach(q, 0)
    await bridge.submit_prompt("lis a b c")
    await _drain_until(q, "message_stop")  # fin du groupe d'outils
    recs = await store.read_since(0)
    tu = [r for r in recs if r["type"] == "tool_use"]
    assert {r["id"] for r in tu} == {"A", "B", "C"}, f"tool_use captés: {[r['id'] for r in tu]}"
    await bridge.shutdown()


async def test_message_stop_after_stop_marks_interrupted(tmp_path):
    # U1 (revue D) : si stop() arrive AVANT le message_stop du groupe, la bulle close au message_stop
    # doit refléter l'interruption ('interrupted'), pas le 'success' codé en dur par défaut.
    store = ConversationStore(tmp_path, "cu1")
    gate = asyncio.Event()
    holder = {}
    turn = [
        {"kind": "message_start"}, {"kind": "delta", "text": "partiel"},
        {"kind": "_gate", "event": gate},
        {"kind": "message_stop"},  # le SDK clôt le groupe APRÈS l'interrupt
        {"kind": "result", "subtype": "error_during_execution", "session_id": "s"},
    ]

    def factory(o):
        c = FakeClient([turn])
        holder["c"] = c
        return c

    bridge = ChatBridge("cu1", store, factory)
    await bridge.start()
    q = asyncio.Queue()
    await bridge.attach(q, 0)
    await bridge.submit_prompt("vas-y")
    await _drain_until(q, "text_delta")
    await bridge.stop()
    gate.set()
    stop_ev = await _drain_until(q, "message_stop")
    assert stop_ev["status"] == "interrupted"
    recs = await store.read_since(0)
    assert any(r["type"] == "assistant_message" and r["text"] == "partiel" and r["status"] == "interrupted" for r in recs)
    await bridge.shutdown()


async def test_late_tool_result_after_end_turn_ignored(tmp_path):
    # spec §4.2 : un tool_result qui arriverait APRÈS le ResultMessage (tour finalisé, carte close par
    # le synthétique D8) ne doit PAS rouvrir la carte -> ignoré (pas de 2e tool_result persisté).
    store = ConversationStore(tmp_path, "cu2")
    script = [
        {"kind": "message_start"},
        {"kind": "assistant", "text": "", "tools": [{"id": "Z", "name": "Read", "input": {"file_path": "a.py"}}]},
        {"kind": "result", "subtype": "success", "session_id": "s"},
        {"kind": "tool_result", "id": "Z", "output": "tardif", "is_error": False},  # arrive APRÈS result
    ]
    bridge = ChatBridge("cu2", store, _factory([script]), repo_root=tmp_path)
    await bridge.start()
    q = asyncio.Queue()
    await bridge.attach(q, 0)
    await bridge.submit_prompt("go")
    await _drain_until(q, "tool_result")  # le synthétique du balayage de fin de tour
    await asyncio.sleep(0.05)  # laisse le tool_result tardif être (ou non) traité
    recs = await store.read_since(0)
    trs = [r for r in recs if r["type"] == "tool_result" and r["id"] == "Z"]
    assert len(trs) == 1, f"un seul tool_result pour Z (le synthétique), eu : {len(trs)}"
    assert trs[0]["is_error"] is True  # la carte reste close 'error', pas rouverte par le tardif
    await bridge.shutdown()


async def test_text_only_turn_unchanged(tmp_path):
    store = ConversationStore(tmp_path, "ct3")
    script = [
        {"kind": "message_start"}, {"kind": "delta", "text": "Bonjour"},
        {"kind": "assistant", "text": "Bonjour", "tools": []},
        {"kind": "result", "subtype": "success", "session_id": "s"},
    ]
    bridge = ChatBridge("ct3", store, _factory([script]), repo_root=tmp_path)
    await bridge.start()
    q = asyncio.Queue()
    await bridge.attach(q, 0)
    await bridge.submit_prompt("salut")
    await _drain_until(q, "message_stop")
    recs = await store.read_since(0)
    assert [r["type"] for r in recs].count("assistant_message") == 1
    assert all(r["type"] not in ("tool_use", "tool_result") for r in recs)
    await bridge.shutdown()
