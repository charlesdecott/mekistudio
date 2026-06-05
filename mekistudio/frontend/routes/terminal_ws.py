"""WebSocket /ws/term/{terminal_id} : relie un TerminalBridge (détaché, dans app.state)
au navigateur (xterm.js). La déconnexion NE détruit PAS le bridge (modèle « screen »,
comme le chat). Protocole : client {attach{since_seq}, input{data}, resize{cols,rows}}
-> serveur {output{seq,data}, attached, exit{code}}."""
from __future__ import annotations

import asyncio
import contextlib

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

router = APIRouter()

_MAX_DIM = 1000  # borne défensive sur cols/rows (entrée client)


def _clamp_dim(v, default: int) -> int:
    try:
        return max(1, min(_MAX_DIM, int(v)))
    except (TypeError, ValueError):
        return default


@router.websocket("/ws/term/{terminal_id}")
async def terminal_ws(ws: WebSocket, terminal_id: str) -> None:
    await ws.accept()
    manager = ws.app.state.terminal_manager
    bridge = await manager.get_or_create(terminal_id)
    queue: asyncio.Queue = asyncio.Queue(maxsize=1000)
    drop = asyncio.Event()  # mis par le bridge si la queue déborde (socket lent) -> on ferme la WS

    async def sender() -> None:
        while True:
            get_t = asyncio.ensure_future(queue.get())
            drop_t = asyncio.ensure_future(drop.wait())
            done, pending = await asyncio.wait({get_t, drop_t}, return_when=asyncio.FIRST_COMPLETED)
            for task in pending:
                task.cancel()
            if drop.is_set():
                # le bridge nous a désabonnés (trop lent) -> fermer ; le client se reconnecte et
                # rattrape via attach{since_seq} (1013 = « try again later »).
                await ws.close(code=1013)
                return
            await ws.send_json(get_t.result())

    async def receiver() -> None:
        while True:
            msg = await ws.receive_json()
            t = msg.get("type")
            if t == "attach":
                try:
                    since = int(msg.get("since_seq", 0) or 0)
                except (TypeError, ValueError):
                    since = 0
                await bridge.attach(queue, since, on_drop=drop)
            elif t == "input":
                data = msg.get("data", "")
                if isinstance(data, str):
                    bridge.write(data)
            elif t == "resize":
                bridge.resize(_clamp_dim(msg.get("cols"), 80), _clamp_dim(msg.get("rows"), 24))

    sender_task = asyncio.create_task(sender())
    receiver_task = asyncio.create_task(receiver())
    try:
        await asyncio.wait({sender_task, receiver_task}, return_when=asyncio.FIRST_COMPLETED)
    except WebSocketDisconnect:
        pass
    finally:
        for task in (sender_task, receiver_task):
            task.cancel()
        for task in (sender_task, receiver_task):
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await task
        bridge.unsubscribe(queue)  # NE détruit PAS le bridge (modèle « screen »)
