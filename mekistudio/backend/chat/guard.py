"""Confinement des outils au dossier du repo via un hook PreToolUse (brique D).

Un hook PreToolUse voit TOUS les appels d'outils et s'exécute AVANT les règles de permission
(un `deny` gagne sur l'auto-allow) — contrairement à `can_use_tool`, qui n'est pas appelé pour
un outil auto-approuvé en `permission_mode="default"`. Posture **default-deny par outil**, et le
guard ne lève JAMAIS (tout doute = deny). `{}` = laisse l'in-repo passer (auto-approuvé par
`allowed_tools`)."""
from __future__ import annotations

from pathlib import Path

# Outil -> champ principal portant un chemin
READ_TOOLS = {"Read": "file_path", "LS": "path", "Glob": "path", "Grep": "path"}
# Champs ADDITIONNELS pouvant porter un chemin (Glob.pattern peut être absolu ; Grep.glob aussi).
# NB : Grep.pattern est une regex de CONTENU, pas un chemin -> non vérifié.
EXTRA_PATH = {"Glob": ["pattern"], "Grep": ["glob"]}
# Outils où le chemin principal est optionnel (absent -> défaut = cwd = repo, sûr car cwd fixé)
PATH_OPTIONAL = {"Glob", "Grep"}


def _inside(root: Path, candidate) -> bool:
    if not isinstance(candidate, str) or candidate == "":
        return False
    try:
        (root / candidate).resolve().relative_to(root)  # relatif (root==cwd), absolu, .., symlink suivi
        return True
    except (ValueError, TypeError, OSError):
        return False


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
            if not _inside(root, val):
                return _deny(f"« {val} » ({field}) est hors du dossier du projet.")
        return {}

    return pre_tool_use
