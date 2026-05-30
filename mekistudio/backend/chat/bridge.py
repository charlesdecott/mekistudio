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
    def __init__(self, conversation_id: str, store: ConversationStore, client_factory: ClientFactory,
                 repo_root=None) -> None:
        self._cid = conversation_id
        self._store = store
        self._factory = client_factory
        self._repo_root = repo_root  # cwd + confinement des outils (brique D)
        self._client: Any = None
        self._to_sdk: asyncio.Queue[str] = asyncio.Queue()
        self._pending: list[str] = []
        self._subscribers: set[asyncio.Queue] = set()
        self._lock = asyncio.Lock()
        self._state = "idle"  # idle | running | error
        self._in_flight: dict | None = None  # {"message_id", "text"}
        self._turn_id: str | None = None
        self._stop_requested = False
        # Tour multi-étapes (brique D) : un GROUPE message_start..message_stop = une bulle, qui
        # peut contenir PLUSIEURS AssistantMessage (un par bloc/outil parallèle).
        self._turn_finalized = False        # reset dans _start_turn
        self._turn_tool_ids: set = set()    # tool_use émis dans le tour
        self._turn_tool_results: set = set()  # tool_result reçus dans le tour
        self._consume_task: asyncio.Task | None = None
        self._error_message: str | None = None
        self._drop_events: dict = {}  # queue -> asyncio.Event, signalé sur QueueFull (D17)

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
            options = build_options(self._repo_root, self._store)
            self._client = self._factory(options)
            await self._client.connect(self._message_stream())
            self._consume_task = asyncio.create_task(self._consume())
        except Exception as exc:  # connexion SDK KO (CLI absente/non authentifiée) -> dégradé
            self._state = "error"
            self._client = None
            self._consume_task = None
            self._error_message = f"Connexion SDK impossible : {exc}"

    # --- broadcast (D17 : non bloquant ; socket lent -> désabonné ET fermé, il rattrape par replay) ---
    def _broadcast(self, ev: dict) -> None:
        for q in list(self._subscribers):
            try:
                q.put_nowait(ev)
            except asyncio.QueueFull:
                # Socket trop lent : désabonner ET signaler la fermeture. Sans ce signal, le
                # sender resterait bloqué à jamais sur queue.get() (fuite de WS + tâches). Le
                # client se reconnecte ensuite et rattrape via attach{since_seq}.
                self._subscribers.discard(q)
                ev_drop = self._drop_events.pop(q, None)
                if ev_drop is not None:
                    ev_drop.set()

    def unsubscribe(self, queue: asyncio.Queue) -> None:
        self._subscribers.discard(queue)
        self._drop_events.pop(queue, None)

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
        self._turn_finalized = False
        self._in_flight = None
        self._turn_tool_ids.clear()
        self._turn_tool_results.clear()
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
                        await self._finalize_in_flight()  # défensif : ferme un groupe précédent non clos
                        self._in_flight = {"message_id": events.new_id(), "text": ""}
                        self._broadcast(events.message_start(self._in_flight["message_id"]))
                elif kind == "delta":
                    async with self._lock:
                        if self._in_flight is not None:
                            chunk = ev.get("text", "")
                            self._in_flight["text"] += chunk
                            self._broadcast(events.text_delta(self._in_flight["message_id"], chunk))
                elif kind == "assistant":
                    await self._accumulate_assistant(ev.get("text", ""), ev.get("tools") or [])
                elif kind == "message_stop":
                    async with self._lock:
                        await self._finalize_in_flight()
                elif kind == "tool_result":
                    async with self._lock:
                        rec = await self._store.append(
                            events.tool_result(ev["id"], ev.get("output", ""), bool(ev.get("is_error")))
                        )
                        self._broadcast(rec)
                        self._turn_tool_results.add(ev["id"])
                elif kind == "result":
                    await self._maybe_persist_session(ev.get("session_id"))
                    await self._end_turn()
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            # La boucle _consume est MORTE : plus aucun tour ne sera traité. On finalise la bulle
            # en vol (sinon figée en streaming), on vide la file (sinon prompts bloqués) et on
            # passe en état 'error' -> les prompts suivants renvoient une erreur ; récupération
            # via ✨ Nouvelle session (clear -> nouveau bridge).
            async with self._lock:
                await self._finalize_in_flight("error")
                erec = await self._store.append(events.error_event(f"Erreur de session : {exc}"))
                self._broadcast(erec)
                self._pending.clear()
                self._broadcast_queued()
                self._state = "error"
                self._error_message = "Session interrompue par une erreur. Clique ✨ Nouvelle session."

    async def _maybe_persist_session(self, sid: str | None) -> None:
        if not sid or self._store.meta().get("claude_session_id"):
            return
        await self._store.set_session_id(sid)  # meta AVANT le record (autoritatif pour resume)
        rec = await self._store.append(events.session_event(sid))
        self._broadcast(rec)

    async def _accumulate_assistant(self, text: str, tools: list) -> None:
        """Un AssistantMessage = UN bloc du groupe courant (texte OU un outil). On ACCUMULE
        sans finaliser : la bulle se ferme au message_stop (ou au message_start suivant)."""
        async with self._lock:
            if self._in_flight is None:  # sécurité : AssistantMessage sans message_start
                self._in_flight = {"message_id": events.new_id(), "text": ""}
                self._broadcast(events.message_start(self._in_flight["message_id"]))
            if text:  # un bloc tool-only a text="" -> ne pas écraser le texte du groupe
                self._in_flight["text"] = text
            for t in tools:
                tu = await self._store.append(events.tool_use(t["id"], t["name"], t.get("input") or {}))
                self._broadcast(tu)
                self._turn_tool_ids.add(t["id"])

    async def _finalize_in_flight(self, status: str = "success") -> None:
        """Ferme la bulle du GROUPE courant (persiste assistant_message + message_stop).
        Idempotent (in_flight=None ensuite). Le CALLER tient le verrou. Appelée au message_stop,
        au message_start suivant (défensif) et en fin de tour."""
        if self._in_flight is None:
            return
        rec = await self._store.append(events.assistant_message(self._in_flight["text"], status))
        self._broadcast(events.message_stop(self._in_flight["message_id"], rec["seq"], status))
        self._in_flight = None

    async def _end_turn(self) -> None:
        """Fin de tour (ResultMessage SDK) : finalise une étape en vol restante (interrupt avant
        l'AssistantMessage), BALAYE les outils orphelins (tool_use sans tool_result → carte fermée,
        live ET replay, D8), puis dépile la file ou idle."""
        async with self._lock:
            if self._turn_finalized:
                return
            self._turn_finalized = True
            # étape en vol restante (ex. interrupt avant message_stop)
            await self._finalize_in_flight("interrupted" if self._stop_requested else "success")
            for tid in self._turn_tool_ids - self._turn_tool_results:
                tr = await self._store.append(events.tool_result(tid, "interrompu", True))
                self._broadcast(tr)
            if self._pending:  # enchaînement de la file
                nxt = self._pending.pop(0)
                self._broadcast_queued()
                await self._start_turn(nxt)
            else:
                self._state = "idle"

    # --- reattach atomique (D6) ---
    async def attach(self, queue: asyncio.Queue, since_seq: int, on_drop: asyncio.Event | None = None) -> None:
        # Replay de l'historique via put BLOQUANT, HORS verrou : le sender draine la queue au
        # fil de l'eau -> pas de QueueFull même sur une très longue conversation (>maxsize).
        records = await self._store.read_since(since_seq)
        last = since_seq
        for rec in records:
            await queue.put(rec)
            last = rec.get("seq", last)
        # Section critique SANS await suspensif (read_since/put_nowait ne cèdent pas la main) ->
        # atomique vs _consume/_finalize. On rattrape les records devenus durables PENDANT le
        # replay (gap), on émet l'in-flight (même message_id), et on s'abonne d'un bloc.
        async with self._lock:
            for rec in await self._store.read_since(last):
                queue.put_nowait(rec)
            if self._state == "running" and self._in_flight is not None:
                queue.put_nowait(events.message_start(self._in_flight["message_id"]))
                queue.put_nowait(events.text_delta(self._in_flight["message_id"], self._in_flight["text"]))
            self._subscribers.add(queue)
            if on_drop is not None:
                self._drop_events[queue] = on_drop

    # --- contrôles ---
    async def stop(self) -> None:
        # interrupt() SOUS le verrou : _finalize/_start_turn prennent le même verrou, donc le tour
        # vu 'running' ne peut pas finir + enchaîner pendant qu'on interrompt -> on vise toujours
        # le BON tour (D16). try/except : un interrupt qui lève ne doit pas tuer la WS.
        async with self._lock:
            if self._state != "running" or self._client is None:
                return
            self._stop_requested = True
            try:
                await self._client.interrupt()
            except Exception:
                pass

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
