from __future__ import annotations

import os
import subprocess
import webbrowser
from pathlib import Path

import typer
import uvicorn

from mekistudio.backend import bootstrap, paths

app = typer.Typer(help="mekistudio — AI dev studio (pur Python, sans Docker)")


# Un callback (même vide) garde les sous-commandes nommées, pour que
# `mekistudio serve` / `mekistudio update` fonctionnent tels quels.
@app.callback()
def _main() -> None:
    """mekistudio CLI."""


@app.command()
def serve(
    host: str = typer.Option("127.0.0.1", help="Adresse d'ecoute."),
    port: int = typer.Option(8777, help="Port HTTP."),
    open_browser: bool = typer.Option(
        True, "--open/--no-open", help="Ouvrir le navigateur au demarrage."
    ),
) -> None:
    """Demarre le studio dans le repo git courant."""
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

    from mekistudio.frontend.app import create_app

    uvicorn.run(create_app(repo_root=root), host=host, port=port)


@app.command()
def update(
    repo: Path = typer.Option(
        None, help="Chemin du repo source (defaut : repo git courant)."
    ),
    pull: bool = typer.Option(True, "--pull/--no-pull", help="git pull la source."),
) -> None:
    """Met a jour le studio depuis la source.

    L'outil global est installe en *editable* (`uv tool install --editable`) :
    il lit le code en direct depuis le repo. Un `git pull` suffit donc — pas de
    rebuild, pas d'exe a reecrire — et c'est pris en compte au prochain
    `mekistudio serve`. Si les dependances (pyproject) ont change, relance
    `uv tool install --editable --force .` studio arrete.
    """
    root = repo.resolve() if repo else paths.find_repo_root(Path.cwd())

    if pull and (root / ".git").exists():
        typer.secho(f"[mekistudio] git pull dans {root}", fg=typer.colors.CYAN)
        if subprocess.run(["git", "-C", str(root), "pull", "--ff-only"]).returncode != 0:
            typer.secho(
                "[mekistudio] git pull a echoue (pas de remote / non fast-forward).",
                fg=typer.colors.YELLOW,
            )

    typer.secho(
        "[mekistudio] a jour — pris en compte au prochain `mekistudio serve`.",
        fg=typer.colors.GREEN,
    )
