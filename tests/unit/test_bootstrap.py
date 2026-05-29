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
    assert {n.kind for n in state.nodes} == {"kernel", "fileexplorer"}
    # Le fichier corrompu est préservé en .bak (pas de perte silencieuse).
    assert cpath.with_name(cpath.name + ".bak").read_text(encoding="utf-8") == "{ pas du json"


def test_fresh_canvas_seeds_builtin_nodes(tmp_path):
    bootstrap.ensure_meki_dir(tmp_path)
    state = bootstrap.load_canvas(tmp_path)
    assert {n.kind for n in state.nodes} == {"kernel", "fileexplorer"}


def test_save_then_load_canvas(tmp_path):
    bootstrap.ensure_meki_dir(tmp_path)
    state = CanvasState(viewport=Viewport(x=3, y=4, zoom=1.5))
    bootstrap.save_canvas(tmp_path, state)
    loaded = bootstrap.load_canvas(tmp_path)
    assert loaded.viewport == Viewport(x=3, y=4, zoom=1.5)
    on_disk = json.loads(paths.canvas_path(tmp_path).read_text(encoding="utf-8"))
    assert on_disk["viewport"]["x"] == 3
