"""État git du repo, en lecture seule (brique G — node « branch git »).

Aucune écriture, aucun accès réseau : on ne lit que l'état local via des
commandes git non mutantes (`cwd=root`). Tolérant : hors repo git ou git absent
→ branche `None` (jamais d'exception remontée au handler)."""
from __future__ import annotations

import subprocess
from pathlib import Path

_TIMEOUT = 5  # s : un git local doit répondre tout de suite ; borne anti-blocage.

# État « pas un repo git » (réponse 200 neutre côté API).
_NO_GIT = {"branch": None, "detached": False, "dirty": None, "ahead": None, "behind": None}


def _run(root: Path, *args: str) -> subprocess.CompletedProcess[str] | None:
    """Lance `git <args>` dans `root`. None si git est absent / timeout / erreur d'exec."""
    try:
        return subprocess.run(
            ["git", *args],
            cwd=str(root),
            capture_output=True,
            text=True,
            timeout=_TIMEOUT,
        )
    except (FileNotFoundError, OSError, subprocess.SubprocessError):
        return None


def branch_info(root: Path) -> dict:
    """`{branch, detached, dirty, ahead, behind}` pour le repo à `root`.

    - `branch` : nom de la branche courante (`None` si pas un repo / git absent) ;
      `detached=True` quand HEAD est détaché.
    - `dirty` : nombre d'entrées de `git status --porcelain` (working tree).
    - `ahead`/`behind` : avance/retard vs l'upstream, calculés EN LOCAL (pas de
      fetch). `None` si aucun upstream configuré.
    """
    head = _run(root, "rev-parse", "--abbrev-ref", "HEAD")
    if head is None or head.returncode != 0:
        return dict(_NO_GIT)
    branch = head.stdout.strip()
    detached = branch == "HEAD"

    dirty = None
    st = _run(root, "status", "--porcelain")
    if st is not None and st.returncode == 0:
        dirty = sum(1 for line in st.stdout.splitlines() if line.strip())

    ahead = behind = None
    # `@{upstream}...HEAD` avec --left-right --count : gauche = commits de l'upstream
    # absents de HEAD (retard), droite = commits de HEAD absents de l'upstream (avance).
    rl = _run(root, "rev-list", "--left-right", "--count", "@{upstream}...HEAD")
    if rl is not None and rl.returncode == 0 and rl.stdout.strip():
        parts = rl.stdout.split()
        if len(parts) == 2 and all(p.isdigit() for p in parts):
            behind, ahead = int(parts[0]), int(parts[1])

    return {"branch": branch, "detached": detached, "dirty": dirty, "ahead": ahead, "behind": behind}
