from __future__ import annotations

from typer.testing import CliRunner

from packages.backend import paths
from packages.cli import app


def test_run_bootstraps_and_starts_server(tmp_path, monkeypatch):
    (tmp_path / ".git").mkdir()
    monkeypatch.chdir(tmp_path)

    started = {}
    # On neutralise le serveur bloquant et l'ouverture du navigateur.
    monkeypatch.setattr("packages.cli.uvicorn.run", lambda *a, **k: started.setdefault("ran", True))
    monkeypatch.setattr("packages.cli.webbrowser.open", lambda *a, **k: None)

    result = CliRunner().invoke(app, ["run", "--no-open", "--port", "8777"])

    assert result.exit_code == 0, result.output
    assert paths.manifest_path(tmp_path).exists()
    assert started.get("ran") is True
