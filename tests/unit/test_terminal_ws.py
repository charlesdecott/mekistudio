from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from mekistudio.frontend.app import create_app

winpty = pytest.importorskip("winpty")  # le WS spawn un vrai PTY ; skip propre si absent


def test_app_has_terminal_manager(tmp_path):
    app = create_app(tmp_path)
    assert getattr(app.state, "terminal_manager", None) is not None


def test_ws_terminal_streams_output(tmp_path):
    app = create_app(tmp_path)
    with TestClient(app) as client:
        with client.websocket_connect("/ws/term/term-ws") as ws:
            ws.send_json({"type": "attach", "since_seq": 0})
            ws.send_json({"type": "input", "data": "Write-Output meki-ws\r\n"})
            buf = ""
            for _ in range(400):
                ev = ws.receive_json()
                if ev.get("type") == "output":
                    buf += ev["data"]
                    if "meki-ws" in buf:
                        break
            assert "meki-ws" in buf


def test_ws_rejects_unsafe_terminal_id(tmp_path):
    from fastapi import WebSocketDisconnect
    app = create_app(tmp_path)
    with TestClient(app) as client:
        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect("/ws/term/bad.id") as ws:
                ws.receive_json()  # serveur ferme 1008 -> lève
        # aucun dossier disque créé pour un id refusé (anti path-traversal)
        assert not (tmp_path / ".mekistudio" / "terminals" / "bad.id").exists()


def test_ws_terminal_resize_is_accepted(tmp_path):
    app = create_app(tmp_path)
    with TestClient(app) as client:
        with client.websocket_connect("/ws/term/term-rs") as ws:
            ws.send_json({"type": "attach", "since_seq": 0})
            ws.send_json({"type": "resize", "cols": 120, "rows": 40})
            ws.send_json({"type": "input", "data": "Write-Output after-resize\r\n"})
            buf = ""
            for _ in range(400):
                ev = ws.receive_json()
                if ev.get("type") == "output":
                    buf += ev["data"]
                    if "after-resize" in buf:
                        break
            assert "after-resize" in buf
