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
    pull: bool = typer.Option(
        True, "--pull/--no-pull", help="git pull avant de reconstruire."
    ),
) -> None:
    """Met a jour l'install globale `mekistudio` depuis la source.

    Auto-upgrade : on (optionnellement) `git pull` la source, puis on
    reconstruit l'outil global isole via `uv tool install --force`. Le swap
    prend effet au prochain lancement (un .exe en cours ne peut etre ecrase) —
    relance `mekistudio serve` apres.
    """
    root = repo.resolve() if repo else paths.find_repo_root(Path.cwd())

    if pull and (root / ".git").exists():
        typer.secho(f"[mekistudio] git pull dans {root}", fg=typer.colors.CYAN)
        if subprocess.run(["git", "-C", str(root), "pull", "--ff-only"]).returncode != 0:
            typer.secho(
                "[mekistudio] git pull a echoue (pas de remote ?) — on continue",
                fg=typer.colors.YELLOW,
            )

    typer.secho(f"[mekistudio] uv tool install --force {root}", fg=typer.colors.CYAN)
    if subprocess.run(["uv", "tool", "install", "--force", str(root)]).returncode != 0:
        typer.secho("[mekistudio] reconstruction echouee.", fg=typer.colors.RED, err=True)
        raise typer.Exit(1)

    typer.secho(
        "[mekistudio] a jour. Relance `mekistudio serve`.", fg=typer.colors.GREEN
    )
