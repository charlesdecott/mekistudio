from __future__ import annotations

from fastapi.testclient import TestClient

from mekistudio.backend import paths
from mekistudio.frontend.app import create_app


def _client(tmp_path):
    return TestClient(create_app(repo_root=tmp_path))


def test_healthz(tmp_path):
    r = _client(tmp_path).get("/healthz")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_index_renders_html_and_bootstraps(tmp_path):
    r = _client(tmp_path).get("/")
    assert r.status_code == 200
    assert "text/html" in r.headers["content-type"]
    assert "mekistudio" in r.text.lower()
    # GET / déclenche le bootstrap du repo
    assert paths.manifest_path(tmp_path).exists()


def test_get_canvas_returns_state(tmp_path):
    r = _client(tmp_path).get("/api/canvas")
    assert r.status_code == 200
    body = r.json()
    # Le canvas neuf est seedé avec les nodes built-in (fini le canvas vide).
    kinds = {n["kind"] for n in body["nodes"]}
    assert kinds == {"kernel", "fileexplorer"}
    assert all(n["root"]["type"] == "node" for n in body["nodes"])
    assert body["viewport"] == {"x": 0, "y": 0, "zoom": 1}


def test_fs_lists_repo_root(tmp_path):
    (tmp_path / "hello.txt").write_text("hi", encoding="utf-8")
    (tmp_path / "pkg").mkdir()
    r = _client(tmp_path).get("/api/fs")
    assert r.status_code == 200
    entries = r.json()["entries"]
    by_name = {e["name"]: e for e in entries}
    assert by_name["hello.txt"]["kind"] == "file"
    assert by_name["pkg"]["kind"] == "dir"


def test_fs_rejects_traversal(tmp_path):
    r = _client(tmp_path).get("/api/fs", params={"path": ".."})
    assert r.status_code == 422


def test_post_viewport_persists(tmp_path):
    client = _client(tmp_path)
    r = client.post("/api/canvas/viewport", json={"x": 12, "y": -3, "zoom": 2})
    assert r.status_code == 200
    again = client.get("/api/canvas").json()
    assert again["viewport"] == {"x": 12, "y": -3, "zoom": 2}
