from __future__ import annotations

import os
import shutil
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

    # PID écrit pour que `update --restart` puisse arrêter cette instance.
    pid_file = paths.meki_dir(root) / "serve.pid"
    pid_file.write_text(str(os.getpid()), encoding="utf-8")
    try:
        uvicorn.run(create_app(repo_root=root), host=host, port=port)
    finally:
        pid_file.unlink(missing_ok=True)


def _kill(pid: int) -> None:
    """Termine le process `pid` (et ses enfants sur Windows)."""
    if sys.platform == "win32":
        subprocess.run(
            ["taskkill", "/PID", str(pid), "/F", "/T"],
            capture_output=True,
        )
    else:
        import signal

        try:
            os.kill(pid, signal.SIGTERM)
        except (ProcessLookupError, PermissionError):
            pass


def _stop_running(root: Path) -> bool:
    """Arrête l'instance `serve` de ce repo via son fichier PID. Retourne True
    si une instance a été arrêtée."""
    pid_file = paths.meki_dir(root) / "serve.pid"
    if not pid_file.exists():
        return False
    try:
        pid = int(pid_file.read_text(encoding="utf-8").strip())
    except (ValueError, OSError):
        pid_file.unlink(missing_ok=True)
        return False
    _kill(pid)
    pid_file.unlink(missing_ok=True)
    return True


@app.command()
def update(
    repo: Path = typer.Option(
        None, help="Chemin du repo source (defaut : repo git courant)."
    ),
    pull: bool = typer.Option(True, "--pull/--no-pull", help="git pull la source."),
    restart: bool = typer.Option(
        False, "--restart", help="Arrête l'instance en cours puis relance `serve`."
    ),
    port: int = typer.Option(8777, help="Port pour le `serve` relancé (--restart)."),
) -> None:
    """Met a jour le studio depuis la source.

    L'outil global est installe en *editable* (`uv tool install --editable`) :
    il lit le code en direct depuis le repo. Un `git pull` suffit donc — pas de
    rebuild, pas d'exe a reecrire. Sans `--restart` c'est pris en compte au
    prochain `mekistudio serve` ; avec `--restart` on arrete l'instance en cours
    et on relance un `serve` frais (qui reimporte le nouveau code). Si les
    dependances (pyproject) ont change, relance `uv tool install --editable
    --force .` studio arrete.
    """
    root = repo.resolve() if repo else paths.find_repo_root(Path.cwd())

    if pull and (root / ".git").exists():
        typer.secho(f"[mekistudio] git pull dans {root}", fg=typer.colors.CYAN)
        if subprocess.run(["git", "-C", str(root), "pull", "--ff-only"]).returncode != 0:
            typer.secho(
                "[mekistudio] git pull a echoue (pas de remote / non fast-forward).",
                fg=typer.colors.YELLOW,
            )

    if not restart:
        typer.secho(
            "[mekistudio] a jour — pris en compte au prochain `mekistudio serve`.",
            fg=typer.colors.GREEN,
        )
        return

    if _stop_running(root):
        typer.secho("[mekistudio] instance en cours arretee.", fg=typer.colors.YELLOW)

    # Relance un process *frais* : l'install editable lui fait réimporter le
    # code à jour. On enchaîne en avant-plan (ce terminal devient le serveur).
    exe = shutil.which("mekistudio") or "mekistudio"
    typer.secho("[mekistudio] redemarrage de serve…", fg=typer.colors.CYAN)
    proc = subprocess.run([exe, "serve", "--no-open", "--port", str(port)], cwd=str(root))
    raise typer.Exit(proc.returncode)
