from __future__ import annotations

from pathlib import Path, PurePosixPath
from typing import Literal

from pydantic import BaseModel


# Bruit jamais montré dans l'explorateur : régénéré par les outils, sans intérêt.
# (set extensible — on pourra y ajouter .git, .DS_Store, etc. au besoin.)
HIDDEN_NAMES = {"__pycache__"}


class FsEntry(BaseModel):
    """Une entrée du système de fichiers, telle qu'exposée au front."""

    name: str
    kind: Literal["dir", "file"]
    # Chemin relatif (posix) depuis la racine du repo, pour relister un dossier.
    path: str


def list_dir(root: Path, rel: str = "") -> list[FsEntry]:
    """Liste le contenu de `root/rel`, dossiers d'abord puis fichiers (alpha).

    Sandbox : toute cible qui sort de `root` (ex. `..`) est refusée — on ne
    laisse jamais l'explorateur lire en dehors du repo.
    """
    base = root.resolve()
    target = (base / rel).resolve()
    if target != base and base not in target.parents:
        raise ValueError("chemin hors de la racine du repo")
    if not target.is_dir():
        raise ValueError("pas un dossier")

    # Chemin relatif posix dérivé de la cible RÉSOLUE (et non du `rel` brut) :
    # garantit une forme canonique quels que soient les séparateurs reçus.
    rel_base = PurePosixPath(*target.relative_to(base).parts)
    entries = sorted(
        (p for p in target.iterdir() if p.name not in HIDDEN_NAMES),
        key=lambda p: (not p.is_dir(), p.name.lower()),
    )
    return [
        FsEntry(
            name=p.name,
            kind="dir" if p.is_dir() else "file",
            path=str(rel_base / p.name),
        )
        for p in entries
    ]
