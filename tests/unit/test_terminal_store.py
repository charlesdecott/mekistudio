from __future__ import annotations

import pytest

from mekistudio.backend.terminal.store import TerminalStore


def test_scrollback_roundtrip_utf8(tmp_path):
    store = TerminalStore(tmp_path, "term-1")
    payload = "café ✓ \x1b[31mrouge\x1b[0m\r\naccentué é à\n"
    store.save_scrollback(payload)
    assert TerminalStore(tmp_path, "term-1").load_scrollback() == payload


def test_scrollback_absent_returns_empty(tmp_path):
    assert TerminalStore(tmp_path, "missing").load_scrollback() == ""


def test_meta_roundtrip(tmp_path):
    store = TerminalStore(tmp_path, "term-2")
    store.save_meta({"shell": "powershell", "cols": 120, "rows": 40, "created_at_ms": 123})
    meta = TerminalStore(tmp_path, "term-2").meta()
    assert meta["shell"] == "powershell"
    assert meta["cols"] == 120 and meta["rows"] == 40


def test_meta_absent_returns_defaults(tmp_path):
    meta = TerminalStore(tmp_path, "fresh").meta()
    assert meta["id"] == "fresh"
    assert "created_at_ms" in meta


def test_dir_under_mekistudio_terminals(tmp_path):
    store = TerminalStore(tmp_path, "term-3")
    store.save_scrollback("x")
    expected = tmp_path / ".mekistudio" / "terminals" / "term-3" / "scrollback.txt"
    assert expected.exists()


def test_save_is_atomic_no_tmp_residue(tmp_path):
    store = TerminalStore(tmp_path, "term-4")
    store.save_scrollback("hello")
    store.save_meta({"cols": 80})
    d = tmp_path / ".mekistudio" / "terminals" / "term-4"
    assert not list(d.glob("*.tmp"))  # pas de fichier temporaire résiduel


def test_traversal_terminal_id_rejected(tmp_path):
    # garde défensive : un id avec des `..\` ne doit pas pouvoir viser hors du dossier terminals
    with pytest.raises(ValueError):
        TerminalStore(tmp_path, r"..\..\PWNED")
    with pytest.raises(ValueError):
        TerminalStore(tmp_path, "../escape")


def test_corrupt_meta_tolerated(tmp_path):
    store = TerminalStore(tmp_path, "term-5")
    (tmp_path / ".mekistudio" / "terminals" / "term-5").mkdir(parents=True)
    (tmp_path / ".mekistudio" / "terminals" / "term-5" / "meta.json").write_text(
        "{ not json", encoding="utf-8"
    )
    meta = store.meta()  # ne lève pas -> défauts
    assert meta["id"] == "term-5"
