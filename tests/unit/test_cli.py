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


def test_update_restart_spawns_detached_helper(tmp_path, monkeypatch):
    # Le redémarrage est délégué à un process DÉTACHÉ : update NE tue PAS lui-même l'ancienne
    # instance (sinon, lancé depuis un terminal mekistudio enfant du serveur, le taskkill /T se
    # tuerait lui-même avant de relancer). Il passe le port + l'old_pid au helper détaché.
    (tmp_path / ".git").mkdir()
    meki = tmp_path / ".mekistudio"
    meki.mkdir()
    (meki / "serve.pid").write_text("424242", encoding="utf-8")

    popen_calls = []

    class _FakePopen:
        def __init__(self, cmd, *a, **k):
            popen_calls.append((cmd, k))

    monkeypatch.setattr("mekistudio.cli.subprocess.Popen", _FakePopen)

    result = CliRunner().invoke(
        app, ["update", "--repo", str(tmp_path), "--no-pull", "--restart", "--port", "8778"]
    )

    assert result.exit_code == 0, result.output
    assert len(popen_calls) == 1
    cmd, kwargs = popen_calls[0]
    assert "restart-helper" in cmd
    assert "8778" in cmd and "424242" in cmd  # port + old_pid passés au helper
    # lancé DÉTACHÉ (sinon il mourrait avec le serveur qu'il arrête)
    assert kwargs.get("creationflags") or kwargs.get("start_new_session")


def test_restart_helper_kills_old_then_serves(tmp_path, monkeypatch):
    (tmp_path / ".git").mkdir()
    monkeypatch.chdir(tmp_path)
    killed, served = [], {}
    monkeypatch.setattr("mekistudio.cli._kill", lambda pid: killed.append(pid))
    monkeypatch.setattr("mekistudio.cli._wait_port_free", lambda *a, **k: True)
    monkeypatch.setattr("mekistudio.cli.serve", lambda **k: served.update(k))

    result = CliRunner().invoke(app, ["restart-helper", "--port", "8778", "--old-pid", "999"])

    assert result.exit_code == 0, result.output
    assert killed == [999]  # l'ancienne instance est arrêtée par le helper
    assert served.get("port") == 8778 and served.get("open_browser") is False


def test_stop_running_without_pidfile_is_noop(tmp_path, monkeypatch):
    from mekistudio import cli

    (tmp_path / ".mekistudio").mkdir()
    killed = []
    monkeypatch.setattr("mekistudio.cli._kill", lambda pid: killed.append(pid))

    assert cli._stop_running(tmp_path) is False
    assert killed == []
