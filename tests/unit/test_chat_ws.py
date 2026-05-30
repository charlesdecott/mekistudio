import asyncio

from fastapi.testclient import TestClient

from mekistudio.frontend.app import create_app


class _StreamingClient:
    """Joue un tour (texte) à chaque prompt reçu dans le stream."""

    def __init__(self, *_):
        self._stream = None

    async def connect(self, stream):
        self._stream = stream

    async def receive(self):
        async for _msg in self._stream:
            yield {"kind": "message_start"}
            yield {"kind": "delta", "text": "salut"}
            yield {"kind": "assistant", "text": "salut"}
            yield {"kind": "result", "subtype": "success", "session_id": "sid"}

    async def interrupt(self):
        ...

    async def disconnect(self):
        ...


class _IdleClient:
    def __init__(self, *_):
        self._stream = None

    async def connect(self, stream):
        self._stream = stream

    async def receive(self):
        if False:
            yield {}
        await asyncio.sleep(3600)

    async def interrupt(self):
        ...

    async def disconnect(self):
        ...


def test_ws_prompt_streams_text(tmp_path):
    app = create_app(tmp_path, chat_client_factory=lambda o: _StreamingClient())
    with TestClient(app) as client:
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


def test_ws_clear_rotates_conversation_id_in_canvas(tmp_path):
    app = create_app(tmp_path, chat_client_factory=lambda o: _IdleClient())
    with TestClient(app) as client:
        client.get("/")  # bootstrap -> canvas.json avec le node chat built-in
        canvas = client.get("/api/canvas").json()
        chat_node = next(n for n in canvas["nodes"] if n["kind"] == "chat")
        old_cid = chat_node["root"]["children"][0]["children"][0]["conversation_id"]

        with client.websocket_connect(f"/ws/chat/{old_cid}") as ws:
            ws.send_json({"type": "attach", "since_seq": 0})
            ws.send_json({"type": "clear"})
            ev = ws.receive_json()
            while ev["type"] != "cleared":
                ev = ws.receive_json()
            new_cid = ev["conversation_id"]

        assert new_cid != old_cid
        canvas2 = client.get("/api/canvas").json()
        chat2 = next(n for n in canvas2["nodes"] if n["kind"] == "chat")
        rotated = chat2["root"]["children"][0]["children"][0]["conversation_id"]
        assert rotated == new_cid
