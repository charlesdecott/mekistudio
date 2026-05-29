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


def _install_was_issued(run_calls, popen_calls, repo):
    """L'install global est émise via subprocess.run (POSIX, synchrone) OU
    subprocess.Popen (Windows, process détaché). Doit forcer --reinstall pour
    ne pas resservir un wheel en cache. Vrai dans les deux cas."""
    for cmd in run_calls:
        if cmd[:5] == ["uv", "tool", "install", "--reinstall", "--force"] and cmd[5] == str(repo):
            return True
    for cmd in popen_calls:
        joined = " ".join(cmd)
        if "uv tool install --reinstall --force" in joined and str(repo) in joined:
            return True
    return False


def test_update_reinstalls_global_tool(tmp_path, monkeypatch):
    run_calls, popen_calls = [], []
    monkeypatch.setattr(
        "mekistudio.cli.subprocess.run",
        lambda cmd, *a, **k: run_calls.append(cmd) or _FakeProc(0),
    )
    monkeypatch.setattr(
        "mekistudio.cli.subprocess.Popen", lambda cmd, *a, **k: popen_calls.append(cmd)
    )

    result = CliRunner().invoke(app, ["update", "--repo", str(tmp_path), "--no-pull"])

    assert result.exit_code == 0, result.output
    # Sans --pull : pas de git, mais l'outil global est bien reconstruit.
    assert not any(c[:1] == ["git"] for c in run_calls)
    assert _install_was_issued(run_calls, popen_calls, tmp_path)


def test_update_pulls_then_reinstalls(tmp_path, monkeypatch):
    (tmp_path / ".git").mkdir()
    run_calls, popen_calls = [], []
    monkeypatch.setattr(
        "mekistudio.cli.subprocess.run",
        lambda cmd, *a, **k: run_calls.append(cmd) or _FakeProc(0),
    )
    monkeypatch.setattr(
        "mekistudio.cli.subprocess.Popen", lambda cmd, *a, **k: popen_calls.append(cmd)
    )

    result = CliRunner().invoke(app, ["update", "--repo", str(tmp_path)])

    assert result.exit_code == 0, result.output
    assert run_calls[0] == ["git", "-C", str(tmp_path), "pull", "--ff-only"]
    assert _install_was_issued(run_calls, popen_calls, tmp_path)
