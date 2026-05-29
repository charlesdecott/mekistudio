from __future__ import annotations

import pytest

from mekistudio.backend import fs


def test_list_dir_sorts_dirs_first(tmp_path):
    (tmp_path / "z_dir").mkdir()
    (tmp_path / "b_dir").mkdir()
    (tmp_path / "a_file.txt").write_text("x", encoding="utf-8")
    entries = fs.list_dir(tmp_path)
    assert [(e.kind, e.name) for e in entries] == [
        ("dir", "b_dir"),
        ("dir", "z_dir"),
        ("file", "a_file.txt"),
    ]
    assert entries[0].path == "b_dir"


def test_list_dir_nested_path_is_posix(tmp_path):
    (tmp_path / "sub").mkdir()
    (tmp_path / "sub" / "inner.py").write_text("x", encoding="utf-8")
    entries = fs.list_dir(tmp_path, "sub")
    assert [(e.kind, e.name, e.path) for e in entries] == [
        ("file", "inner.py", "sub/inner.py")
    ]


def test_list_dir_rejects_traversal(tmp_path):
    with pytest.raises(ValueError):
        fs.list_dir(tmp_path, "..")


def test_list_dir_rejects_non_dir(tmp_path):
    (tmp_path / "f.txt").write_text("x", encoding="utf-8")
    with pytest.raises(ValueError):
        fs.list_dir(tmp_path, "f.txt")


def test_list_dir_hides_pycache(tmp_path):
    (tmp_path / "__pycache__").mkdir()
    (tmp_path / "real.py").write_text("x", encoding="utf-8")
    names = [e.name for e in fs.list_dir(tmp_path)]
    assert "__pycache__" not in names
    assert "real.py" in names
