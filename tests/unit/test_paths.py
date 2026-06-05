from __future__ import annotations

from mekistudio.backend import paths


def test_find_repo_root_walks_up_to_git(tmp_path):
    (tmp_path / ".git").mkdir()
    nested = tmp_path / "a" / "b"
    nested.mkdir(parents=True)
    assert paths.find_repo_root(nested) == tmp_path


def test_find_repo_root_without_git_returns_start(tmp_path):
    nested = tmp_path / "a"
    nested.mkdir()
    assert paths.find_repo_root(nested) == nested


def test_path_helpers(tmp_path):
    assert paths.meki_dir(tmp_path) == tmp_path / ".mekistudio"
    assert paths.manifest_path(tmp_path) == tmp_path / ".mekistudio" / "manifest.json"
    assert paths.canvas_path(tmp_path) == tmp_path / ".mekistudio" / "canvas.json"


def test_is_safe_id_accepts_uuid_hex():
    from mekistudio.backend.components import new_id
    assert paths.is_safe_id(new_id())           # uuid4 hex -> sûr
    assert paths.is_safe_id("abc-DEF_123")
    assert paths.is_safe_id("a")


def test_is_safe_id_rejects_traversal_and_separators():
    for bad in ("..", "../x", r"..\..\x", "a/b", r"a\b", "a.b", "a b", "", "x" * 65,
                "with:colon", None, 42):
        assert not paths.is_safe_id(bad), bad
