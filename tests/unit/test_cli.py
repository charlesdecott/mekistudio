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


def test_update_pulls_the_source(tmp_path, monkeypatch):
    (tmp_path / ".git").mkdir()
    run_calls = []
    monkeypatch.setattr(
        "mekistudio.cli.subprocess.run",
        lambda cmd, *a, **k: run_calls.append(cmd) or _FakeProc(0),
    )

    result = CliRunner().invoke(app, ["update", "--repo", str(tmp_path)])

    assert result.exit_code == 0, result.output
    # Install editable : le code est live, un git pull suffit (pas de reinstall).
    assert run_calls == [["git", "-C", str(tmp_path), "pull", "--ff-only"]]


def test_update_no_pull_does_nothing_external(tmp_path, monkeypatch):
    (tmp_path / ".git").mkdir()
    run_calls = []
    monkeypatch.setattr(
        "mekistudio.cli.subprocess.run",
        lambda cmd, *a, **k: run_calls.append(cmd) or _FakeProc(0),
    )

    result = CliRunner().invoke(app, ["update", "--repo", str(tmp_path), "--no-pull"])

    assert result.exit_code == 0, result.output
    assert run_calls == []  # --no-pull : aucune commande externe
