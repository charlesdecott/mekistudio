"""Résolution du shell à spawn pour un terminal : argv + cwd + env.

v1 : PowerShell réel (non sandboxé), cwd = racine du repo. Choix assumé (machine de
l'utilisateur, studio auto-hébergé) ; le confinement fort reste la brique Docker mise
de côté. Le profil utilisateur est chargé (vrai terminal) ; -NoLogo retire la bannière."""
from __future__ import annotations

from pathlib import Path

# -NoLogo : pas de bannière de version au démarrage (le reste = comportement par défaut,
# profil utilisateur inclus, pour un vrai terminal).
POWERSHELL_ARGV = ["powershell.exe", "-NoLogo"]


def build_spawn(repo_root: Path | None, shell: str = "powershell") -> dict:
    """argv/cwd/env pour `PtyProcess.spawn`. env=None -> hérite de l'environnement du
    serveur (PATH, etc.). cwd = repo (le shell démarre dans le projet)."""
    root = Path(repo_root) if repo_root is not None else Path.cwd()
    return {"argv": list(POWERSHELL_ARGV), "cwd": str(root), "env": None}
