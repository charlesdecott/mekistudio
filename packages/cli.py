from __future__ import annotations

import os
import webbrowser
from pathlib import Path

import typer
import uvicorn

from packages.backend import bootstrap, paths

app = typer.Typer(help="mekistudio-2 — AI dev studio (pur Python, sans Docker)")


# Un callback (même vide) force Typer à garder `run` comme sous-commande
# nommée, pour que `mekistudio run` fonctionne tel quel.
@app.callback()
def _main() -> None:
    """mekistudio-2 CLI."""


@app.command()
def run(
    host: str = typer.Option("127.0.0.1", help="Adresse d'ecoute."),
    port: int = typer.Option(8777, help="Port HTTP."),
    open_browser: bool = typer.Option(
        True, "--open/--no-open", help="Ouvrir le navigateur au demarrage."
    ),
) -> None:
    """Demarre mekistudio dans le repo git courant."""
    root = paths.find_repo_root(Path.cwd())
    if not (root / ".git").exists():
        typer.secho(
            f"[mekistudio] pas de depot git detecte — j'utilise {root}",
            fg=typer.colors.YELLOW,
        )
    bootstrap.ensure_meki_dir(root)

    # Le serveur (sous-process uvicorn eventuel via reload) lit la racine ici.
    os.environ["MEKISTUDIO_REPO_ROOT"] = str(root)

    url = f"http://{host}:{port}/"
    typer.secho(f"[mekistudio] canvas pret sur {url}", fg=typer.colors.GREEN)
    if open_browser:
        try:
            webbrowser.open(url)
        except Exception:
            pass

    from packages.frontend.app import create_app

    uvicorn.run(create_app(repo_root=root), host=host, port=port)
