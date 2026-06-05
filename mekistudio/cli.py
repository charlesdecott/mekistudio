from __future__ import annotations

import os
import shutil
import socket
import subprocess
import sys
import time
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


def _detached_kwargs() -> dict:
    """Flags pour lancer un process TOTALEMENT détaché : pas de console attachée, propre
    groupe de process, ne meurt pas avec son parent. Indispensable au redémarrage lancé
    DEPUIS un terminal mekistudio (enfant du serveur) — sinon l'arrêt du serveur (taskkill
    /T sur tout l'arbre) tuerait aussi le relanceur avant qu'il ait relancé `serve`."""
    if sys.platform == "win32":
        flags = (
            subprocess.DETACHED_PROCESS
            | subprocess.CREATE_NEW_PROCESS_GROUP
            | subprocess.CREATE_NO_WINDOW
        )
        return {"creationflags": flags, "close_fds": True}
    return {"start_new_session": True, "close_fds": True}


def _wait_port_free(port: int, host: str = "127.0.0.1", timeout: float = 12.0) -> bool:
    """Attend que `port` se libère (l'ancien serve relâche le socket). True si libre."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(0.5)
            if s.connect_ex((host, port)) != 0:  # connexion refusée -> port libre
                return True
        time.sleep(0.3)
    return False


@app.command("restart-helper", hidden=True)
def restart_helper(
    port: int = typer.Option(8777, help="Port du serve relancé."),
    old_pid: int = typer.Option(0, "--old-pid", help="PID de l'instance à arrêter."),
) -> None:
    """INTERNE (ne pas appeler à la main). Lancé DÉTACHÉ par `update --restart` : arrête
    l'ancienne instance (old_pid) puis relance un `serve` frais. Détaché = survit au
    taskkill /T de l'ancienne instance même quand la commande vient d'un terminal mekistudio
    (qui est un enfant de ce serveur)."""
    if old_pid > 0:
        _kill(old_pid)
    _wait_port_free(port)
    serve(host="127.0.0.1", port=port, open_browser=False)


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

    # Le redémarrage est délégué à un process DÉTACHÉ (`restart-helper`) : il arrête
    # l'ancienne instance PUIS relance un serve frais. Pourquoi détaché : `update --restart`
    # est souvent lancé DEPUIS un terminal mekistudio, lui-même enfant du serveur à arrêter.
    # Si on arrêtait le serveur ici (taskkill /T = tout l'arbre), on se tuerait nous-mêmes
    # AVANT d'avoir relancé -> le serveur principal "crash" et rien ne repart. Détaché, le
    # relanceur survit à l'arrêt de l'arbre et démarre la nouvelle instance.
    pid_file = paths.meki_dir(root) / "serve.pid"
    old_pid = 0
    if pid_file.exists():
        try:
            old_pid = int(pid_file.read_text(encoding="utf-8").strip())
        except (ValueError, OSError):
            old_pid = 0
    exe = shutil.which("mekistudio") or "mekistudio"
    typer.secho(
        f"[mekistudio] redemarrage detache sur le port {port}…", fg=typer.colors.CYAN
    )
    subprocess.Popen(
        [exe, "restart-helper", "--port", str(port), "--old-pid", str(old_pid)],
        cwd=str(root),
        **_detached_kwargs(),
    )
    typer.secho(
        f"[mekistudio] nouvelle instance sur http://127.0.0.1:{port}/ "
        "(quelques secondes). Ce terminal va s'arreter avec l'ancienne instance.",
        fg=typer.colors.GREEN,
    )
