from __future__ import annotations

from packages.backend import paths


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
