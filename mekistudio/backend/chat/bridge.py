"""ChatBridge — moteur détaché d'une conversation (1 par conversation_id, dans app.state).

Mode streaming-input : un générateur persistant (`_message_stream`) alimente le client SDK,
une UNIQUE boucle `_consume` lit le flux pour tous les tours (bornes = `result`). Verrou
d'état (D16) ; broadcast borné non bloquant (D17) ; reattach atomique (D6). Découplé du WS :
un tour est une `asyncio.Task` qui survit à la déconnexion du client."""
from __future__ import annotations

import asyncio
from typing import Any, Callable

from mekistudio.backend.chat import events
from mekistudio.backend.chat.store import ConversationStore

ClientFactory = Callable[[Any], Any]


class ChatBridge:
    def __init__(self, conversation_id: str, store: ConversationStore, client_factory: ClientFactory) -> None:
        self._cid = conversation_id
        self._store = store
        self._factory = client_factory
        self._client: Any = None
        self._to_sdk: asyncio.Queue[str] = asyncio.Queue()
        self._pending: list[str] = []
        self._subscribers: set[asyncio.Queue] = set()
        self._lock = asyncio.Lock()
        self._state = "idle"  # idle | running | error
        self._in_flight: dict | None = None  # {"message_id", "text"}
        self._final_text: str | None = None
        self._last_subtype: str | None = None
        self._turn_id: str | None = None
        self._stop_requested = False
        self._finalized = False
        self._consume_task: asyncio.Task | None = None
        self._error_message: str | None = None

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
    async def _message_stream(self):
        while True:
            text = await self._to_sdk.get()
            yield {"type": "user", "message": {"role": "user", "content": text}}

    async def start(self) -> None:
        from mekistudio.backend.chat.options import build_options

        try:
            options = build_options(self._cid, self._store)
            self._client = self._factory(options)
            await self._client.connect(self._message_stream())
            self._consume_task = asyncio.create_task(self._consume())
        except Exception as exc:  # connexion SDK KO (CLI absente/non authentifiée) -> dégradé
            self._state = "error"
            self._client = None
            self._consume_task = None
            self._error_message = f"Connexion SDK impossible : {exc}"

    # --- broadcast (D17 : non bloquant ; socket lent -> désabonné, il rattrapera par replay) ---
    def _broadcast(self, ev: dict) -> None:
        for q in list(self._subscribers):
            try:
                q.put_nowait(ev)
            except asyncio.QueueFull:
                self._subscribers.discard(q)

    def unsubscribe(self, queue: asyncio.Queue) -> None:
        self._subscribers.discard(queue)

    def _broadcast_queued(self) -> None:
        self._broadcast(events.queued([{"index": i, "text": t} for i, t in enumerate(self._pending)]))

    # --- soumission ---
    async def submit_prompt(self, text: str) -> None:
        async with self._lock:
            if self._state == "error":
                rec = await self._store.append(events.error_event(self._error_message or "session indisponible"))
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
        self._last_subtype = None
        self._to_sdk.put_nowait(text)

    # --- boucle de consommation unique (tous les tours) ---
    async def _consume(self) -> None:
        assert self._client is not None
        try:
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
                            chunk = ev.get("text", "")
                            self._in_flight["text"] += chunk
                            self._broadcast(events.text_delta(self._in_flight["message_id"], chunk))
                elif kind == "assistant":
                    self._final_text = ev.get("text", "")
                elif kind == "result":
                    self._last_subtype = ev.get("subtype")
                    await self._maybe_persist_session(ev.get("session_id"))
                    await self._finalize()
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # erreur de session en cours -> event error, le bridge survit
            rec = await self._store.append(events.error_event(f"Erreur de session : {exc}"))
            self._broadcast(rec)
            async with self._lock:
                self._state = "idle"
                self._in_flight = None

    async def _maybe_persist_session(self, sid: str | None) -> None:
        if not sid or self._store.meta().get("claude_session_id"):
            return
        await self._store.set_session_id(sid)  # meta AVANT le record (autoritatif pour resume)
        rec = await self._store.append(events.session_event(sid))
        self._broadcast(rec)

    async def _finalize(self) -> None:
        async with self._lock:
            if self._finalized:
                return
            self._finalized = True
            if self._stop_requested:
                status = "interrupted"  # déduit du flag, JAMAIS du subtype (= error_during_execution)
            elif self._last_subtype not in (None, "success"):
                status = "error"
            else:
                status = "success"
            text = self._final_text if self._final_text is not None else (self._in_flight or {}).get("text", "")
            mid = (self._in_flight or {}).get("message_id") or events.new_id()
            rec = await self._store.append(events.assistant_message(text, status))
            self._broadcast(events.message_stop(mid, rec["seq"], status))
            self._in_flight = None
            if self._pending:  # enchaînement de la file
                nxt = self._pending.pop(0)
                self._broadcast_queued()
                await self._start_turn(nxt)
            else:
                self._state = "idle"

    # --- reattach atomique (D6) ---
    async def attach(self, queue: asyncio.Queue, since_seq: int) -> None:
        records = await self._store.read_since(since_seq)  # await AVANT le verrou
        async with self._lock:  # section critique SANS await -> atomique vs _consume
            for rec in records:
                queue.put_nowait(rec)
            if self._state == "running" and self._in_flight is not None:
                queue.put_nowait(events.message_start(self._in_flight["message_id"]))
                queue.put_nowait(events.text_delta(self._in_flight["message_id"], self._in_flight["text"]))
            self._subscribers.add(queue)

    # --- contrôles ---
    async def stop(self) -> None:
        async with self._lock:
            if self._state != "running" or self._client is None:
                return
            self._stop_requested = True
        await self._client.interrupt()  # le result de fin arrivera dans _consume -> _finalize

    async def cancel_queued(self, index: int) -> None:
        async with self._lock:
            if 0 <= index < len(self._pending):
                self._pending.pop(index)
                self._broadcast_queued()

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


from mekistudio.backend.chat.options import default_client_factory  # noqa: E402,F401  (ré-export)
