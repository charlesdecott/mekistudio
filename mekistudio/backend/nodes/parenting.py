"""Parentage par préfixe de chemin (brique G — cœur path-aware).

Pur, sans dépendance au modèle : on raisonne sur des chemins posix et des paires
`(path, id)`. C'est la pièce porteuse de l'organisation par dossier — testée à part
(esprit cables.js/collision.js) avant de toucher routes/front.

Préfixe = par SEGMENTS : `"docs"` préfixe `"docs/superpowers"` mais `"doc"` non.
La racine `""` préfixe tout.
"""
from __future__ import annotations


def _segments(path: str) -> list[str]:
    return [p for p in path.split("/") if p]


def is_prefix(prefix: str, path: str) -> bool:
    """True si `prefix` est un préfixe-segment de `path` (égalité incluse)."""
    pp = _segments(prefix)
    sp = _segments(path)
    return pp == sp[: len(pp)]


def longest_prefix_id(
    target_path: str, candidates: list[tuple[str, str]], *, strict: bool
) -> str | None:
    """Id du candidat dont le `path` est le PLUS LONG préfixe de `target_path`.

    `candidates` = liste `(path, id)` (inclure l'explorateur avec path `""`).
    `strict=True` exclut l'égalité de chemin (un dossier ne se parente pas lui-même
    ni un homonyme) ; `strict=False` l'autorise (un éditeur se parente au node
    dossier de son répertoire). Tie-break déterministe : id le plus petit. `None`
    si aucun candidat ne préfixe la cible.
    """
    target_segs = _segments(target_path)
    best_id: str | None = None
    best_len = -1
    for path, cid in candidates:
        segs = _segments(path)
        if strict and segs == target_segs:
            continue
        if not is_prefix(path, target_path):
            continue
        n = len(segs)
        if n > best_len or (n == best_len and best_id is not None and cid < best_id):
            best_id, best_len = cid, n
    return best_id
