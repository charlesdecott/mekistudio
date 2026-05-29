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


def test_list_dir_excludes_hide_names(tmp_path):
    (tmp_path / "__pycache__").mkdir()
    (tmp_path / "node_modules").mkdir()
    (tmp_path / "real.py").write_text("x", encoding="utf-8")
    names = [e.name for e in fs.list_dir(tmp_path, excludes=["__pycache__", "node_modules"])]
    assert "__pycache__" not in names and "node_modules" not in names
    assert "real.py" in names


def test_list_dir_without_excludes_hides_nothing(tmp_path):
    (tmp_path / "__pycache__").mkdir()
    names = [e.name for e in fs.list_dir(tmp_path)]
    assert "__pycache__" in names  # plus de masquage hardcodé


def test_read_write_file_roundtrip(tmp_path):
    f = tmp_path / "a.py"
    f.write_text("print('hi')\n", encoding="utf-8", newline="")  # garder \n
    assert fs.read_file(tmp_path, "a.py") == "print('hi')\n"
    fs.write_file(tmp_path, "a.py", "x = 1\n")
    assert f.read_text(encoding="utf-8") == "x = 1\n"


def test_read_file_rejects_binary(tmp_path):
    (tmp_path / "b.bin").write_bytes(b"\x00\x01\x02")
    with pytest.raises(ValueError):
        fs.read_file(tmp_path, "b.bin")


def test_read_file_rejects_traversal_and_dir(tmp_path):
    (tmp_path / "d").mkdir()
    with pytest.raises(ValueError):
        fs.read_file(tmp_path, "..")
    with pytest.raises(ValueError):
        fs.read_file(tmp_path, "d")


def test_write_file_requires_existing(tmp_path):
    with pytest.raises(ValueError):
        fs.write_file(tmp_path, "nope.txt", "x")


def test_write_file_leaves_no_tmp(tmp_path):
    f = tmp_path / "a.txt"
    f.write_text("x", encoding="utf-8", newline="")
    fs.write_file(tmp_path, "a.txt", "y")
    leftovers = [p.name for p in tmp_path.iterdir() if p.name.endswith(".tmp")]
    assert leftovers == []


def test_is_file_in_root(tmp_path):
    (tmp_path / "x.txt").write_text("x", encoding="utf-8")
    assert fs.is_file_in_root(tmp_path, "x.txt") is True
    assert fs.is_file_in_root(tmp_path, "..") is False
    assert fs.is_file_in_root(tmp_path, "missing") is False
