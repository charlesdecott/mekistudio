from __future__ import annotations

from typer.testing import CliRunner

from mekistudio.backend import paths
from mekistudio.cli import app


def test_serve_bootstraps_and_starts_server(tmp_path, monkeypatch):
    (tmp_path / ".git").mkdir()
    monkeypatch.chdir(tmp_path)

    started = {}
    # On neutralise le serveur bloquant et l'ouverture du navigateur.
    monkeypatch.setattr("mekistudio.cli.uvicorn.run", lambda *a, **k: started.setdefault("ran", True))
    monkeypatch.setattr("mekistudio.cli.webbrowser.open", lambda *a, **k: None)

    result = CliRunner().invoke(app, ["serve", "--no-open", "--port", "8777"])

    assert result.exit_code == 0, result.output
    assert paths.manifest_path(tmp_path).exists()
    assert started.get("ran") is True


class _FakeProc:
    def __init__(self, returncode=0):
        self.returncode = returncode


def test_update_rebuilds_global_tool(tmp_path, monkeypatch):
    calls = []

    def fake_run(cmd, *a, **k):
        calls.append(cmd)
        return _FakeProc(0)

    monkeypatch.setattr("mekistudio.cli.subprocess.run", fake_run)

    result = CliRunner().invoke(app, ["update", "--repo", str(tmp_path), "--no-pull"])

    assert result.exit_code == 0, result.output
    # Sans --pull, on ne touche pas à git ; on reconstruit l'outil global.
    assert calls == [["uv", "tool", "install", "--force", str(tmp_path)]]


def test_update_pulls_then_rebuilds(tmp_path, monkeypatch):
    (tmp_path / ".git").mkdir()
    calls = []

    def fake_run(cmd, *a, **k):
        calls.append(cmd)
        return _FakeProc(0)

    monkeypatch.setattr("mekistudio.cli.subprocess.run", fake_run)

    result = CliRunner().invoke(app, ["update", "--repo", str(tmp_path)])

    assert result.exit_code == 0, result.output
    assert calls[0] == ["git", "-C", str(tmp_path), "pull", "--ff-only"]
    assert calls[1] == ["uv", "tool", "install", "--force", str(tmp_path)]
