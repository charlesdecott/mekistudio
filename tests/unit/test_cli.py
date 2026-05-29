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


def test_update_restart_stops_then_relaunches_serve(tmp_path, monkeypatch):
    (tmp_path / ".git").mkdir()
    meki = tmp_path / ".mekistudio"
    meki.mkdir()
    (meki / "serve.pid").write_text("424242", encoding="utf-8")

    killed, run_calls = [], []
    monkeypatch.setattr("mekistudio.cli._kill", lambda pid: killed.append(pid))
    monkeypatch.setattr(
        "mekistudio.cli.subprocess.run",
        lambda cmd, *a, **k: run_calls.append(cmd) or _FakeProc(0),
    )

    result = CliRunner().invoke(
        app, ["update", "--repo", str(tmp_path), "--no-pull", "--restart"]
    )

    assert result.exit_code == 0, result.output
    assert killed == [424242]  # l'instance en cours a été arrêtée
    assert not (meki / "serve.pid").exists()  # pid nettoyé
    # un `serve` frais a été relancé
    assert any("serve" in cmd for cmd in run_calls)


def test_stop_running_without_pidfile_is_noop(tmp_path, monkeypatch):
    from mekistudio import cli

    (tmp_path / ".mekistudio").mkdir()
    killed = []
    monkeypatch.setattr("mekistudio.cli._kill", lambda pid: killed.append(pid))

    assert cli._stop_running(tmp_path) is False
    assert killed == []
