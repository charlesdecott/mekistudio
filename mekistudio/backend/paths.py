from __future__ import annotations

import re
from pathlib import Path

# Id de session OPAQUE et sûr (conversation chat / terminal). `new_id()` produit un
# uuid4 hex (32 car. [0-9a-f]) qui satisfait ce motif. Bloque tout ce qui pourrait
# servir de traversée de chemin (`.`, `/`, `\`, `:`, espaces) quand l'id arrive d'une
# URL WebSocket et sert à construire un dossier sur disque.
_SAFE_ID_RE = re.compile(r"\A[A-Za-z0-9_-]{1,64}\Z")


def is_safe_id(value: str) -> bool:
    """Vrai si `value` est un id de session sûr à utiliser dans un chemin de fichier."""
    return isinstance(value, str) and bool(_SAFE_ID_RE.match(value))


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
