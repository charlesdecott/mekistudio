"""WebSocket /ws/chat/{conversation_id} : relie un ChatBridge (détaché, dans app.state)
au navigateur. La déconnexion NE détruit PAS le bridge (modèle « screen », D5)."""
from __future__ import annotations

import asyncio
import contextlib
from pathlib import Path

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from mekistudio.backend.bootstrap import load_canvas, save_canvas
from mekistudio.backend.components import iter_components
from mekistudio.frontend.routes.canvas import _canvas_lock  # lock partagé des écritures canvas.json

router = APIRouter()


async def _rotate_node_conversation(repo_root: Path, old_id: str, new_id: str) -> None:
    """Met à jour le conversation_id du node chat dans canvas.json, sous le MÊME lock
    que les autres mutations canvas (évite le lost-update avec un drag concurrent)."""
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
                await bridge.attach(queue, int(msg.get("since_seq", 0)), on_drop=drop)
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
                return  # fin -> fermeture serveur ; le client reconnecte sur new_id

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
        bridge.unsubscribe(queue)  # NE détruit PAS le bridge (D5)
