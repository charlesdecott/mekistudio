from __future__ import annotations

import os
import subprocess
import sys
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


def _schedule_reinstall(root: Path) -> bool:
    """Reconstruit l'outil global `mekistudio` depuis la source `root`.

    Sur Windows, le lanceur `mekistudio.exe` qui exécute *cette* commande
    verrouille son propre fichier : `uv tool install` ne peut pas l'écraser
    (os error 32). On délègue donc à un process **détaché** qui attend la
    sortie du process courant, puis fait l'install — le swap se fait une fois
    l'exe libéré.

    Retourne True si la réinstallation est différée (asynchrone, Windows),
    False si elle a été faite de façon synchrone (POSIX). Lève sur échec POSIX.
    """
    # --reinstall : sans lui, uv ressert un wheel en cache pour la même
    # version et le nouveau code n'est jamais pris en compte.
    cmd = ["uv", "tool", "install", "--reinstall", "--force", str(root)]

    if sys.platform == "win32":
        # PowerShell détaché : petite attente que l'exe courant se libère,
        # puis install (sortie loggée). Path en guillemets simples (pas
        # d'échappement des backslashes).
        script = (
            "Start-Sleep -Seconds 2; "
            f"uv tool install --reinstall --force '{root}' "
            '*> "$env:TEMP\\mekistudio-update.log"'
        )
        subprocess.Popen(
            ["powershell", "-NoProfile", "-NonInteractive", "-Command", script],
            creationflags=subprocess.DETACHED_PROCESS
            | subprocess.CREATE_NEW_PROCESS_GROUP,
            close_fds=True,
        )
        return True

    if subprocess.run(cmd).returncode != 0:
        raise RuntimeError("uv tool install a échoué")
    return False


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
    reconstruit l'outil global isole via `uv tool install --force`. Sur Windows
    le swap est differe (un .exe en cours ne peut etre ecrase) — relance
    `mekistudio serve` apres.
    """
    root = repo.resolve() if repo else paths.find_repo_root(Path.cwd())

    if pull and (root / ".git").exists():
        typer.secho(f"[mekistudio] git pull dans {root}", fg=typer.colors.CYAN)
        if subprocess.run(["git", "-C", str(root), "pull", "--ff-only"]).returncode != 0:
            typer.secho(
                "[mekistudio] git pull a echoue (pas de remote ?) — on continue",
                fg=typer.colors.YELLOW,
            )

    typer.secho(f"[mekistudio] reconstruction de l'outil global depuis {root}", fg=typer.colors.CYAN)
    try:
        deferred = _schedule_reinstall(root)
    except Exception as exc:
        typer.secho(f"[mekistudio] reconstruction echouee : {exc}", fg=typer.colors.RED, err=True)
        raise typer.Exit(1) from exc

    if deferred:
        typer.secho(
            "[mekistudio] mise a jour planifiee en arriere-plan — relance "
            "`mekistudio serve` dans ~5 s. (log : %TEMP%\\mekistudio-update.log)",
            fg=typer.colors.GREEN,
        )
    else:
        typer.secho(
            "[mekistudio] a jour. Relance `mekistudio serve`.", fg=typer.colors.GREEN
        )
