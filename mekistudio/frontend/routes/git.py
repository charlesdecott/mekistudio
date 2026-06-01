"""Route lecture seule de l'état git (brique G — node « branch git »)."""
from __future__ import annotations

from fastapi import APIRouter, Request

from mekistudio.backend import git

router = APIRouter()


@router.get("/api/git/branch")
async def git_branch(request: Request) -> dict:
    """État git du repo : `{branch, detached, dirty, ahead, behind}`. Tolérant
    (hors repo git / git absent -> branch=None), jamais d'erreur 500."""
    root = request.app.state.repo_root
    return git.branch_info(root)
