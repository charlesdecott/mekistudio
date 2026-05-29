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


def _ids_by_kind(client):
    nodes = client.get("/api/canvas").json()["nodes"]
    return {n["kind"]: n["id"] for n in nodes}


def test_move_node_persists(tmp_path):
    client = _client(tmp_path)
    ids = _ids_by_kind(client)
    r = client.post(f"/api/canvas/nodes/{ids['fileexplorer']}", json={"x": 500, "y": 250})
    assert r.status_code == 200
    nodes = client.get("/api/canvas").json()["nodes"]
    fe = next(n for n in nodes if n["kind"] == "fileexplorer")
    assert (fe["x"], fe["y"]) == (500, 250)


def test_resize_clamps_to_min(tmp_path):
    client = _client(tmp_path)
    ids = _ids_by_kind(client)
    r = client.post(f"/api/canvas/nodes/{ids['fileexplorer']}", json={"w": 10, "h": 10})
    assert r.status_code == 200
    body = r.json()
    assert body["w"] == 140 and body["h"] == 80  # clampé au minimum


def test_kernel_cannot_move(tmp_path):
    client = _client(tmp_path)
    ids = _ids_by_kind(client)
    r = client.post(f"/api/canvas/nodes/{ids['kernel']}", json={"x": 9, "y": 9})
    assert r.status_code == 422


def test_kernel_cannot_resize(tmp_path):
    client = _client(tmp_path)
    ids = _ids_by_kind(client)
    r = client.post(f"/api/canvas/nodes/{ids['kernel']}", json={"w": 300})
    assert r.status_code == 422


def test_update_unknown_node_404(tmp_path):
    r = _client(tmp_path).post("/api/canvas/nodes/nope", json={"x": 1})
    assert r.status_code == 404


def test_update_empty_body_is_noop(tmp_path):
    client = _client(tmp_path)
    ids = _ids_by_kind(client)
    r = client.post(f"/api/canvas/nodes/{ids['fileexplorer']}", json={})
    assert r.status_code == 200


def test_update_rejects_non_finite(tmp_path):
    client = _client(tmp_path)
    ids = _ids_by_kind(client)
    # Infinity littéral (json tolérant côté serveur) -> rejeté par allow_inf_nan
    r = client.post(
        f"/api/canvas/nodes/{ids['fileexplorer']}",
        content='{"w": Infinity}',
        headers={"content-type": "application/json"},
    )
    assert r.status_code == 422


def test_viewport_rejects_non_finite(tmp_path):
    r = _client(tmp_path).post(
        "/api/canvas/viewport",
        content='{"x": NaN, "y": 0, "zoom": 1}',
        headers={"content-type": "application/json"},
    )
    assert r.status_code == 422


def test_post_viewport_persists(tmp_path):
    client = _client(tmp_path)
    r = client.post("/api/canvas/viewport", json={"x": 12, "y": -3, "zoom": 2})
    assert r.status_code == 200
    again = client.get("/api/canvas").json()
    assert again["viewport"] == {"x": 12, "y": -3, "zoom": 2}
