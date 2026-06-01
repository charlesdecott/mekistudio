from __future__ import annotations

import subprocess

import pytest

from mekistudio.backend.git import branch_info


def _git(cwd, *args):
    subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True)


def _has_git() -> bool:
    try:
        subprocess.run(["git", "--version"], check=True, capture_output=True)
        return True
    except Exception:
        return False


@pytest.mark.skipif(not _has_git(), reason="git absent")
def test_branch_info_real_repo(tmp_path):
    _git(tmp_path, "init", "-q")
    _git(tmp_path, "config", "user.email", "t@t")
    _git(tmp_path, "config", "user.name", "t")
    (tmp_path / "a.txt").write_text("x")
    _git(tmp_path, "add", "-A")
    _git(tmp_path, "commit", "-qm", "init")
    info = branch_info(tmp_path)
    assert info["branch"] in ("main", "master")
    assert info["detached"] is False
    assert info["dirty"] == 0
    assert info["ahead"] is None and info["behind"] is None  # pas d'upstream
    (tmp_path / "b.txt").write_text("y")
    assert branch_info(tmp_path)["dirty"] == 1


def test_branch_info_non_git_is_tolerant(tmp_path):
    # tmp_path n'est pas un repo git -> réponse neutre, pas d'exception
    info = branch_info(tmp_path)
    assert info["branch"] is None
    assert info["dirty"] is None
    assert info["ahead"] is None and info["behind"] is None
