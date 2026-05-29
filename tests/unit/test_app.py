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
    # Built-in : kernel + explorateur (l'éditeur est dynamique).
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


def _new_editor(client):
    """Crée un node éditeur (dynamique) et renvoie son id."""
    r = client.post("/api/canvas/nodes", json={"kind": "fileeditor", "x": 700, "y": 0})
    assert r.status_code == 200
    return r.json()["id"]


def test_create_node_adds_and_persists(tmp_path):
    client = _client(tmp_path)
    eid = _new_editor(client)
    nodes = client.get("/api/canvas").json()["nodes"]
    assert any(n["id"] == eid and n["kind"] == "fileeditor" for n in nodes)


def test_create_node_unknown_kind_is_422(tmp_path):
    r = _client(tmp_path).post("/api/canvas/nodes", json={"kind": "nope"})
    assert r.status_code == 422


def test_create_node_rejects_non_finite(tmp_path):
    r = _client(tmp_path).post(
        "/api/canvas/nodes",
        content='{"kind": "fileeditor", "x": Infinity, "y": 0}',
        headers={"content-type": "application/json"},
    )
    assert r.status_code == 422


def test_delete_node_removes_and_persists(tmp_path):
    client = _client(tmp_path)
    eid = _new_editor(client)
    assert client.delete(f"/api/canvas/nodes/{eid}").status_code == 200
    nodes = client.get("/api/canvas").json()["nodes"]
    assert all(n["id"] != eid for n in nodes)


def test_delete_unknown_node_is_404(tmp_path):
    assert _client(tmp_path).delete("/api/canvas/nodes/nope").status_code == 404


def test_delete_builtin_node_is_422(tmp_path):
    client = _client(tmp_path)
    ids = _ids_by_kind(client)
    # kernel / explorateur sont built-in -> non supprimables
    assert client.delete(f"/api/canvas/nodes/{ids['fileexplorer']}").status_code == 422
    assert client.delete(f"/api/canvas/nodes/{ids['kernel']}").status_code == 422


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


def test_fs_applies_excludes(tmp_path):
    (tmp_path / "keep.py").write_text("x", encoding="utf-8")
    (tmp_path / "secret").mkdir()
    r = _client(tmp_path).get("/api/fs", params={"exclude": ["secret"]})
    names = [e["name"] for e in r.json()["entries"]]
    assert "keep.py" in names and "secret" not in names


def test_settings_updates_excludes_and_persists(tmp_path):
    client = _client(tmp_path)
    ids = _ids_by_kind(client)
    r = client.post(
        f"/api/canvas/nodes/{ids['fileexplorer']}/settings",
        json={"excludes": [" .git ", "node_modules", "node_modules", ""]},
    )
    assert r.status_code == 200
    # GET /api/canvas : le FileTreeComponent porte les exclusions normalisées
    nodes = client.get("/api/canvas").json()["nodes"]
    fe = next(n for n in nodes if n["kind"] == "fileexplorer")
    tree = fe["root"]["children"][0]["children"][1]
    assert tree["type"] == "filetree"
    assert tree["excludes"] == [".git", "node_modules"]  # trim + dédoublonné + sans vide


def test_settings_on_non_configurable_is_422(tmp_path):
    client = _client(tmp_path)
    ids = _ids_by_kind(client)
    r = client.post(
        f"/api/canvas/nodes/{ids['kernel']}/settings", json={"excludes": ["x"]}
    )
    assert r.status_code == 422


def test_settings_rejects_path_separator(tmp_path):
    client = _client(tmp_path)
    ids = _ids_by_kind(client)
    r = client.post(
        f"/api/canvas/nodes/{ids['fileexplorer']}/settings",
        json={"excludes": ["src/foo"]},
    )
    assert r.status_code == 422


def test_settings_rejects_too_many_excludes(tmp_path):
    client = _client(tmp_path)
    ids = _ids_by_kind(client)
    r = client.post(
        f"/api/canvas/nodes/{ids['fileexplorer']}/settings",
        json={"excludes": [f"e{i}" for i in range(201)]},
    )
    assert r.status_code == 422


def test_file_read_and_write(tmp_path):
    (tmp_path / "hello.py").write_text("a = 1\n", encoding="utf-8", newline="")
    client = _client(tmp_path)
    r = client.get("/api/file", params={"path": "hello.py"})
    assert r.status_code == 200 and r.json()["content"] == "a = 1\n"
    w = client.post("/api/file", json={"path": "hello.py", "content": "b = 2\n"})
    assert w.status_code == 200
    assert (tmp_path / "hello.py").read_text(encoding="utf-8") == "b = 2\n"


def test_file_read_rejects_traversal(tmp_path):
    r = _client(tmp_path).get("/api/file", params={"path": "../secret"})
    assert r.status_code == 422


def test_open_sets_editor_path_and_persists(tmp_path):
    (tmp_path / "main.py").write_text("x\n", encoding="utf-8")
    client = _client(tmp_path)
    eid = _new_editor(client)
    r = client.post(f"/api/canvas/nodes/{eid}/open", json={"path": "main.py"})
    assert r.status_code == 200
    nodes = client.get("/api/canvas").json()["nodes"]
    ed_node = next(n for n in nodes if n["id"] == eid)
    editor = ed_node["root"]["children"][0]["children"][0]
    assert editor["type"] == "editor" and editor["file_path"] == "main.py"


def test_open_invalid_path_is_422(tmp_path):
    client = _client(tmp_path)
    eid = _new_editor(client)
    r = client.post(f"/api/canvas/nodes/{eid}/open", json={"path": "nope.py"})
    assert r.status_code == 422


def test_open_on_non_editor_node_is_422(tmp_path):
    (tmp_path / "f.py").write_text("x", encoding="utf-8")
    client = _client(tmp_path)
    ids = _ids_by_kind(client)
    r = client.post(f"/api/canvas/nodes/{ids['kernel']}/open", json={"path": "f.py"})
    assert r.status_code == 422


def test_open_rejects_overlong_path(tmp_path):
    client = _client(tmp_path)
    eid = _new_editor(client)
    r = client.post(f"/api/canvas/nodes/{eid}/open", json={"path": "a" * 5000})
    assert r.status_code == 422  # borne Pydantic (max_length 4096)


def test_post_viewport_persists(tmp_path):
    client = _client(tmp_path)
    r = client.post("/api/canvas/viewport", json={"x": 12, "y": -3, "zoom": 2})
    assert r.status_code == 200
    again = client.get("/api/canvas").json()
    assert again["viewport"] == {"x": 12, "y": -3, "zoom": 2}


def test_create_fileeditor_derives_source_id(tmp_path):
    client = _client(tmp_path)
    ids = _ids_by_kind(client)
    node = client.post("/api/canvas/nodes", json={"kind": "fileeditor", "x": 700, "y": 0}).json()
    assert node["source_id"] == ids["fileexplorer"]  # parent dérivé côté serveur


def test_create_node_explicit_source_id_override(tmp_path):
    client = _client(tmp_path)
    ids = _ids_by_kind(client)
    node = client.post(
        "/api/canvas/nodes",
        json={"kind": "fileeditor", "x": 1, "y": 1, "source_id": ids["kernel"]},
    ).json()
    assert node["source_id"] == ids["kernel"]


def test_create_node_bogus_source_id_falls_back_to_derived(tmp_path):
    client = _client(tmp_path)
    ids = _ids_by_kind(client)
    node = client.post(
        "/api/canvas/nodes",
        json={"kind": "fileeditor", "x": 1, "y": 1, "source_id": "ghost"},
    ).json()
    assert node["source_id"] == ids["fileexplorer"]  # bidon -> dérivé, pas de 422


def test_open_preserves_source_id(tmp_path):
    (tmp_path / "f.txt").write_text("hi", encoding="utf-8")
    client = _client(tmp_path)
    ids = _ids_by_kind(client)
    eid = client.post("/api/canvas/nodes", json={"kind": "fileeditor", "x": 1, "y": 1}).json()["id"]
    opened = client.post(f"/api/canvas/nodes/{eid}/open", json={"path": "f.txt"}).json()
    assert opened["source_id"] == ids["fileexplorer"]  # /open n'efface pas le lien
