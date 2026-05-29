from __future__ import annotations

import uuid
from collections.abc import Iterable
from pathlib import Path, PurePosixPath
from typing import Literal

from pydantic import BaseModel


# Plafond de taille pour lire/écrire un fichier dans l'éditeur (texte uniquement).
MAX_FILE_BYTES = 1_000_000


class FsEntry(BaseModel):
    """Une entrée du système de fichiers, telle qu'exposée au front."""

    name: str
    kind: Literal["dir", "file"]
    # Chemin relatif (posix) depuis la racine du repo, pour relister un dossier.
    path: str


def _resolve_in_root(root: Path, rel: str) -> Path:
    """Résout `root/rel` en refusant toute cible hors de `root` (sandbox)."""
    base = root.resolve()
    target = (base / rel).resolve()
    if target != base and base not in target.parents:
        raise ValueError("chemin hors de la racine du repo")
    return target


def is_file_in_root(root: Path, rel: str) -> bool:
    """True si `rel` désigne un fichier existant dans le repo (sans le lire)."""
    try:
        return _resolve_in_root(root, rel).is_file()
    except ValueError:
        return False


def read_file(root: Path, rel: str) -> str:
    """Lit un fichier texte du repo (sandbox + garde binaire/taille/UTF-8)."""
    target = _resolve_in_root(root, rel)
    if not target.is_file():
        raise ValueError("pas un fichier")
    if target.stat().st_size > MAX_FILE_BYTES:
        raise ValueError("fichier trop volumineux")
    data = target.read_bytes()
    if b"\x00" in data:
        raise ValueError("fichier binaire non éditable")
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise ValueError("encodage non UTF-8") from exc


def write_file(root: Path, rel: str, content: str) -> None:
    """Écrit (atomiquement) un fichier EXISTANT du repo. Ne crée pas de fichier."""
    target = _resolve_in_root(root, rel)
    if not target.is_file():
        raise ValueError("le fichier n'existe pas")
    if len(content.encode("utf-8")) > MAX_FILE_BYTES:
        raise ValueError("contenu trop volumineux")
    # Tmp à nom UNIQUE (pas de collision si deux écritures concurrentes) +
    # nettoyage si l'écriture/replace échoue (pas de .tmp orphelin bloquant).
    tmp = target.with_name(f"{target.name}.{uuid.uuid4().hex}.tmp")
    try:
        tmp.write_text(content, encoding="utf-8", newline="")  # pas de translation \n
        tmp.replace(target)
    except OSError:
        tmp.unlink(missing_ok=True)
        raise


def list_dir(root: Path, rel: str = "", excludes: Iterable[str] = ()) -> list[FsEntry]:
    """Liste le contenu de `root/rel`, dossiers d'abord puis fichiers (alpha).

    Sandbox : toute cible qui sort de `root` (ex. `..`) est refusée — on ne
    laisse jamais l'explorateur lire en dehors du repo. `excludes` : noms
    masqués (config du node, par défaut `__pycache__`).
    """
    base = root.resolve()
    target = (base / rel).resolve()
    if target != base and base not in target.parents:
        raise ValueError("chemin hors de la racine du repo")
    if not target.is_dir():
        raise ValueError("pas un dossier")

    hidden = set(excludes)
    # Chemin relatif posix dérivé de la cible RÉSOLUE (et non du `rel` brut) :
    # garantit une forme canonique quels que soient les séparateurs reçus.
    rel_base = PurePosixPath(*target.relative_to(base).parts)
    entries = sorted(
        (p for p in target.iterdir() if p.name not in hidden),
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
