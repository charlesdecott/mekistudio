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
    # Built-in : kernel + git + explorateur + chat (l'éditeur/dossier sont dynamiques).
    kinds = {n["kind"] for n in body["nodes"]}
    assert kinds == {"kernel", "gitbranch", "fileexplorer", "chat"}
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


# --- brique F3a : auto-spawn éphémère ---

def test_create_ephemeral_node_with_expiry(tmp_path):
    node = _client(tmp_path).post(
        "/api/canvas/nodes",
        json={"kind": "fileeditor", "x": 700, "y": 0, "ephemeral": True, "expires_at_ms": 9_999_999_999_999},
    ).json()
    assert node["ephemeral"] is True and node["expires_at_ms"] == 9_999_999_999_999


def test_create_node_defaults_not_ephemeral(tmp_path):
    node = _client(tmp_path).post("/api/canvas/nodes", json={"kind": "fileeditor", "x": 1, "y": 1}).json()
    assert node["ephemeral"] is False and node["expires_at_ms"] is None


def test_pin_makes_node_permanent_and_persists(tmp_path):
    client = _client(tmp_path)
    eid = client.post(
        "/api/canvas/nodes",
        json={"kind": "fileeditor", "x": 1, "y": 1, "ephemeral": True, "expires_at_ms": 123},
    ).json()["id"]
    pinned = client.post(f"/api/canvas/nodes/{eid}/pin")
    assert pinned.status_code == 200
    assert pinned.json()["ephemeral"] is False and pinned.json()["expires_at_ms"] is None
    nodes = client.get("/api/canvas").json()["nodes"]
    assert any(n["id"] == eid and n["ephemeral"] is False for n in nodes)


def test_pin_unknown_node_404(tmp_path):
    assert _client(tmp_path).post("/api/canvas/nodes/nope/pin").status_code == 404


def test_get_canvas_purges_expired_ephemeral(tmp_path):
    client = _client(tmp_path)
    expired = client.post(
        "/api/canvas/nodes", json={"kind": "fileeditor", "x": 1, "y": 1, "ephemeral": True, "expires_at_ms": 1}
    ).json()["id"]
    alive = client.post(
        "/api/canvas/nodes", json={"kind": "fileeditor", "x": 2, "y": 2, "ephemeral": True, "expires_at_ms": 9_999_999_999_999}
    ).json()["id"]
    ids = {n["id"] for n in client.get("/api/canvas").json()["nodes"]}
    assert expired not in ids  # éphémère expiré -> purgé au chargement
    assert alive in ids        # éphémère vivant -> gardé


def test_get_canvas_keeps_permanent_and_ephemeral_without_expiry(tmp_path):
    client = _client(tmp_path)
    perm = _new_editor(client)  # permanent (non éphémère)
    eph_noexp = client.post(
        "/api/canvas/nodes", json={"kind": "fileeditor", "x": 3, "y": 3, "ephemeral": True}
    ).json()["id"]  # éphémère SANS date d'expiration -> pas purgé
    ids = {n["id"] for n in client.get("/api/canvas").json()["nodes"]}
    assert perm in ids and eph_noexp in ids


# --- brique F3b : réglages de l'auto-spawn (node chat configurable) ---

def _chat(client):
    nodes = client.get("/api/canvas").json()["nodes"]
    chat = next(n for n in nodes if n["kind"] == "chat")
    return chat, chat["root"]["children"][0]["children"][0]


def test_chat_node_is_configurable_with_spawn_defaults(tmp_path):
    chat, comp = _chat(_client(tmp_path))
    assert chat["configurable"] is True
    assert comp["type"] == "chat"
    assert comp["spawn_mode"] == "ephemeral" and comp["spawn_ttl_min"] == 10 and comp["spawn_cap"] == 20


def test_chat_spawn_settings_update_and_persist(tmp_path):
    client = _client(tmp_path)
    cid = _chat(client)[0]["id"]
    r = client.post(f"/api/canvas/nodes/{cid}/settings", json={"spawn_mode": "capped", "spawn_ttl_min": 30, "spawn_cap": 8})
    assert r.status_code == 200
    _, comp = _chat(client)
    assert comp["spawn_mode"] == "capped" and comp["spawn_ttl_min"] == 30 and comp["spawn_cap"] == 8


def test_chat_spawn_settings_validation(tmp_path):
    client = _client(tmp_path)
    cid = _chat(client)[0]["id"]
    assert client.post(f"/api/canvas/nodes/{cid}/settings", json={"spawn_mode": "bogus"}).status_code == 422
    assert client.post(f"/api/canvas/nodes/{cid}/settings", json={"spawn_cap": 0}).status_code == 422
    assert client.post(f"/api/canvas/nodes/{cid}/settings", json={"spawn_ttl_min": 0}).status_code == 422


# --- brique G : node git, node dossier, parentage path-aware, réduire, purge ---


def test_git_branch_endpoint(tmp_path):
    # tmp_path n'est pas un repo git -> réponse neutre, 200.
    r = _client(tmp_path).get("/api/git/branch")
    assert r.status_code == 200
    body = r.json()
    assert set(body) == {"branch", "detached", "dirty", "ahead", "behind"}


def test_default_canvas_git_topology_via_api(tmp_path):
    nodes = _client(tmp_path).get("/api/canvas").json()["nodes"]
    by = {n["kind"]: n for n in nodes}
    assert by["gitbranch"]["source_id"] == by["kernel"]["id"]
    assert by["fileexplorer"]["source_id"] == by["gitbranch"]["id"]
    assert by["chat"]["source_id"] == by["gitbranch"]["id"]


def test_gitbranch_is_builtin_non_deletable(tmp_path):
    client = _client(tmp_path)
    gid = _ids_by_kind(client)["gitbranch"]
    assert client.delete(f"/api/canvas/nodes/{gid}").status_code == 422


def test_create_folder_node_stores_path_and_derives_parent(tmp_path):
    client = _client(tmp_path)
    ids = _ids_by_kind(client)
    docs = client.post("/api/canvas/nodes", json={"kind": "folder", "x": 1, "y": 1, "path": "docs"}).json()
    assert docs["kind"] == "folder" and docs["path"] == "docs"
    assert docs["source_id"] == ids["fileexplorer"]  # racine -> explorateur
    sub = client.post(
        "/api/canvas/nodes", json={"kind": "folder", "x": 2, "y": 2, "path": "docs/superpowers"}
    ).json()
    assert sub["source_id"] == docs["id"]  # sous-dossier -> dossier parent (préfixe)


def test_create_editor_parents_to_folder_via_override(tmp_path):
    client = _client(tmp_path)
    docs = client.post("/api/canvas/nodes", json={"kind": "folder", "x": 1, "y": 1, "path": "docs"}).json()
    ed = client.post(
        "/api/canvas/nodes", json={"kind": "fileeditor", "x": 3, "y": 3, "source_id": docs["id"]}
    ).json()
    assert ed["source_id"] == docs["id"]


def test_collapse_node_persists(tmp_path):
    client = _client(tmp_path)
    gid = _ids_by_kind(client)["gitbranch"]
    r = client.post(f"/api/canvas/nodes/{gid}", json={"collapsed": True})
    assert r.status_code == 200 and r.json()["collapsed"] is True
    nodes = client.get("/api/canvas").json()["nodes"]
    assert next(n for n in nodes if n["id"] == gid)["collapsed"] is True


def _mk_folder(client, path, *, ephemeral, source_id=None):
    body = {"kind": "folder", "x": 1, "y": 1, "path": path, "ephemeral": ephemeral}
    if source_id:
        body["source_id"] = source_id
    return client.post("/api/canvas/nodes", json=body).json()


def test_get_canvas_purges_empty_ephemeral_folder_chain(tmp_path):
    (tmp_path / "docs").mkdir()
    (tmp_path / "docs" / "sp").mkdir()
    (tmp_path / "docs" / "sp" / "x.md").write_text("x")
    client = _client(tmp_path)
    d = _mk_folder(client, "docs", ephemeral=True)
    s = _mk_folder(client, "docs/sp", ephemeral=True)
    # éditeur éphémère expiré sous docs/sp
    ed = client.post(
        "/api/canvas/nodes",
        json={"kind": "fileeditor", "x": 5, "y": 5, "ephemeral": True, "expires_at_ms": 1, "source_id": s["id"]},
    ).json()
    client.post(f"/api/canvas/nodes/{ed['id']}/open", json={"path": "docs/sp/x.md"})
    ids = {n["id"] for n in client.get("/api/canvas").json()["nodes"]}
    # l'éditeur expiré ET la chaîne de dossiers vides (éphémères) sont purgés (fixpoint)
    assert ed["id"] not in ids and s["id"] not in ids and d["id"] not in ids


def test_get_canvas_keeps_pinned_empty_folder(tmp_path):
    client = _client(tmp_path)
    pinned = _mk_folder(client, "docs", ephemeral=False)  # épinglé (sorti à la main)
    ids = {n["id"] for n in client.get("/api/canvas").json()["nodes"]}
    assert pinned["id"] in ids  # épinglé -> conservé même vide
