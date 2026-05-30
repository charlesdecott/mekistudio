"""Confinement des outils au dossier du repo via un hook PreToolUse (brique D).

Un hook PreToolUse voit TOUS les appels d'outils et s'exécute AVANT les règles de permission
(un `deny` gagne sur l'auto-allow) — contrairement à `can_use_tool`, qui n'est pas appelé pour
un outil auto-approuvé en `permission_mode="default"`. Posture **default-deny par outil**, et le
guard ne lève JAMAIS (tout doute = deny). `{}` = laisse l'in-repo passer (auto-approuvé par
`allowed_tools`)."""
from __future__ import annotations

import re
from pathlib import Path

# Outil -> champ principal portant un chemin
READ_TOOLS = {"Read": "file_path", "LS": "path", "Glob": "path", "Grep": "path"}
# Champs ADDITIONNELS pouvant porter un chemin (Glob.pattern peut être absolu ; Grep.glob aussi).
# NB : Grep.pattern est une regex de CONTENU, pas un chemin -> non vérifié.
EXTRA_PATH = {"Glob": ["pattern"], "Grep": ["glob"]}
# Outils où le chemin principal est optionnel (absent -> défaut = cwd = repo, sûr car cwd fixé)
PATH_OPTIONAL = {"Glob", "Grep"}
# Champs qui sont des PATTERNS de glob : le moteur du SDK EXPANSE les accolades AVANT résolution,
# donc `{..,ok}/**` énumère hors-repo. `_inside` (résolution littérale via pathlib) ne le voit pas
# -> ces champs passent par `_glob_inside` (deny tout `..`, et _inside sur chaque arm expansé).
GLOB_PATTERN_FIELDS = {"pattern", "glob"}

# IMPORTANT : `_inside`/`_glob_inside` ne gardent que les CHEMINS DÉCLARÉS. La TRAVERSÉE d'un dossier
# in-repo par Glob/Grep (expansion `**`) suivant une junction/symlink SORTANTE plantée dans le repo
# n'est PAS gardée ici (elle dépend du moteur SDK) — hypothèse de confinement : aucun lien sortant
# n'est introduit dans le repo (brique lecture seule : l'agent ne peut pas en créer). Read, lui, est
# sûr : `resolve()` suit le lien et atterrit hors-repo -> deny.


def _inside(root: Path, candidate) -> bool:
    if not isinstance(candidate, str) or candidate == "":
        return False
    try:
        (root / candidate).resolve().relative_to(root)  # relatif (root==cwd), absolu, .., symlink suivi
        return True
    except (ValueError, TypeError, OSError):
        return False


def _expand_braces(p: str) -> list[str]:
    """Expanse récursivement les accolades comme le moteur glob (`{a,b}` -> `a`,`b`)."""
    m = re.search(r"\{([^{}]*)\}", p)
    if not m:
        return [p]
    pre, post = p[: m.start()], p[m.end() :]
    out: list[str] = []
    for arm in m.group(1).split(","):
        out.extend(_expand_braces(pre + arm + post))
    return out


def _glob_inside(root: Path, pattern) -> bool:
    """Confinement d'un PATTERN de glob, robuste à l'expansion des accolades."""
    if not isinstance(pattern, str) or pattern == "":
        return False
    if ".." in pattern:  # tout '..' (même piégé dans `{..,x}`) = remontée potentielle -> deny
        return False
    return all(_inside(root, arm) for arm in _expand_braces(pattern))


def _deny(msg: str) -> dict:
    return {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": msg,
        }
    }


def make_repo_guard(repo_root: Path):
    root = Path(repo_root).resolve()

    async def pre_tool_use(input_data, tool_use_id, context):
        name = input_data.get("tool_name")
        tool_input = input_data.get("tool_input") or {}
        if name not in READ_TOOLS:
            return _deny(f"Outil « {name} » non autorisé (lecture seule).")
        key = READ_TOOLS[name]
        primary = tool_input.get(key)
        if primary in (None, "") and name not in PATH_OPTIONAL:
            return _deny("Chemin manquant.")
        fields = ([key] if primary not in (None, "") else []) + EXTRA_PATH.get(name, [])
        for field in fields:
            val = tool_input.get(field)
            if val in (None, ""):
                continue
            check = _glob_inside if field in GLOB_PATTERN_FIELDS else _inside
            if not check(root, val):
                return _deny(f"« {val} » ({field}) est hors du dossier du projet.")
        return {}

    return pre_tool_use
