from __future__ import annotations

from pathlib import Path


def find_repo_root(start: Path) -> Path:
    """Remonte depuis `start` jusqu'au premier dossier contenant `.git`.

    Sans `.git` trouvé, on renvoie `start` : l'appelant décide quoi en faire
    (afficher un avertissement), mais on ne bloque jamais le démarrage.
    """
    start = start.resolve()
    for candidate in (start, *start.parents):
        if (candidate / ".git").exists():
            return candidate
    return start


def meki_dir(root: Path) -> Path:
    return root / ".mekistudio"


def manifest_path(root: Path) -> Path:
    return meki_dir(root) / "manifest.json"


def canvas_path(root: Path) -> Path:
    return meki_dir(root) / "canvas.json"
