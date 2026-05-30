from __future__ import annotations

import json

from mekistudio.backend import bootstrap, paths
from mekistudio.backend.models import CanvasState, Viewport


def test_ensure_creates_meki_dir(tmp_path):
    manifest = bootstrap.ensure_meki_dir(tmp_path)
    assert paths.manifest_path(tmp_path).exists()
    assert paths.canvas_path(tmp_path).exists()
    assert manifest.name == tmp_path.name


def test_ensure_is_idempotent(tmp_path):
    first = bootstrap.ensure_meki_dir(tmp_path)
    raw_after_first = paths.manifest_path(tmp_path).read_text(encoding="utf-8")
    second = bootstrap.ensure_meki_dir(tmp_path)
    # même id, fichier inchangé
    assert second.id == first.id
    assert paths.manifest_path(tmp_path).read_text(encoding="utf-8") == raw_after_first


def test_load_canvas_survives_corrupt_json(tmp_path):
    bootstrap.ensure_meki_dir(tmp_path)
    cpath = paths.canvas_path(tmp_path)
    cpath.write_text("{ pas du json", encoding="utf-8")
    state = bootstrap.load_canvas(tmp_path)
    assert isinstance(state, CanvasState)
    assert state.viewport == Viewport()  # défauts, pas de crash
    # Invariant « jamais vide » : on retombe sur le canvas par défaut (built-in).
    assert {n.kind for n in state.nodes} == {"kernel", "fileexplorer", "chat"}
    # Le fichier corrompu est préservé en .bak (pas de perte silencieuse).
    assert cpath.with_name(cpath.name + ".bak").read_text(encoding="utf-8") == "{ pas du json"


def test_fresh_canvas_seeds_builtin_nodes(tmp_path):
    bootstrap.ensure_meki_dir(tmp_path)
    state = bootstrap.load_canvas(tmp_path)
    assert {n.kind for n in state.nodes} == {"kernel", "fileexplorer", "chat"}


def test_ensure_adds_missing_builtin_nodes(tmp_path):
    # Canvas auquel il manque un built-in (ici l'explorateur) -> ré-ajouté.
    bootstrap.ensure_meki_dir(tmp_path)
    state = bootstrap.load_canvas(tmp_path)
    state.nodes = [n for n in state.nodes if n.kind != "fileexplorer"]
    bootstrap.save_canvas(tmp_path, state)
    bootstrap.ensure_meki_dir(tmp_path)
    assert {n.kind for n in bootstrap.load_canvas(tmp_path).nodes} == {
        "kernel", "fileexplorer", "chat"
    }


def test_ensure_does_not_re_add_dynamic_editor(tmp_path):
    # Un éditeur (node dynamique, pas built-in) fermé ne doit pas réapparaître.
    from mekistudio.backend.nodes import build_file_editor_node

    bootstrap.ensure_meki_dir(tmp_path)
    state = bootstrap.load_canvas(tmp_path)
    state.nodes.append(build_file_editor_node())
    bootstrap.save_canvas(tmp_path, state)
    # on le retire puis bootstrap : il ne revient pas (pas un built-in)
    state2 = bootstrap.load_canvas(tmp_path)
    state2.nodes = [n for n in state2.nodes if n.kind != "fileeditor"]
    bootstrap.save_canvas(tmp_path, state2)
    bootstrap.ensure_meki_dir(tmp_path)
    assert "fileeditor" not in {n.kind for n in bootstrap.load_canvas(tmp_path).nodes}


def test_load_reconciles_kind_constraints(tmp_path):
    # Simule un canvas.json où le kernel aurait (à tort) été persisté déplaçable.
    bootstrap.ensure_meki_dir(tmp_path)
    state = bootstrap.load_canvas(tmp_path)
    for n in state.nodes:
        if n.kind == "kernel":
            n.movable = True
            n.resizable = True
    bootstrap.save_canvas(tmp_path, state)
    # Au rechargement, les contraintes du kind sont réimposées.
    reloaded = bootstrap.load_canvas(tmp_path)
    kernel = next(n for n in reloaded.nodes if n.kind == "kernel")
    assert kernel.movable is False and kernel.resizable is False


def test_save_then_load_canvas(tmp_path):
    bootstrap.ensure_meki_dir(tmp_path)
    state = CanvasState(viewport=Viewport(x=3, y=4, zoom=1.5))
    bootstrap.save_canvas(tmp_path, state)
    loaded = bootstrap.load_canvas(tmp_path)
    assert loaded.viewport == Viewport(x=3, y=4, zoom=1.5)
    on_disk = json.loads(paths.canvas_path(tmp_path).read_text(encoding="utf-8"))
    assert on_disk["viewport"]["x"] == 3


def test_ensure_builtin_relinks_when_kernel_missing(tmp_path):
    # canvas hérité : explorateur SANS kernel et source_id pointant un id mort.
    import json
    from mekistudio.backend import paths
    from mekistudio.backend.bootstrap import ensure_meki_dir, load_canvas
    from mekistudio.backend.nodes import build_file_explorer_node

    paths.meki_dir(tmp_path).mkdir(parents=True, exist_ok=True)
    e = build_file_explorer_node()
    e.source_id = "dead-kernel-id"
    legacy = {"schema_version": 1, "nodes": [e.model_dump(mode="json")], "edges": [], "viewport": {"x": 0, "y": 0, "zoom": 1}}
    paths.canvas_path(tmp_path).write_text(json.dumps(legacy), encoding="utf-8")

    ensure_meki_dir(tmp_path)  # doit réinjecter le kernel ET relier l'explorateur
    state = load_canvas(tmp_path)
    k = next(n for n in state.nodes if n.kind == "kernel")
    exp = next(n for n in state.nodes if n.kind == "fileexplorer")
    assert exp.source_id == k.id  # relié au VRAI kernel présent, pas l'id mort
