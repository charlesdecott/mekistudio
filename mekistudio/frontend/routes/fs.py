from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, Request

from mekistudio.backend import fs

router = APIRouter()


@router.get("/api/fs")
async def list_fs(
    request: Request, path: str = "", exclude: list[str] = Query(default=[])
) -> dict:
    """Liste un dossier du repo pour l'explorateur (chargement paresseux).
    `exclude` (répété) : noms masqués, fournis par le node appelant."""
    root = request.app.state.repo_root
    try:
        entries = fs.list_dir(root, path, exclude)
    except ValueError as exc:  # hors racine / pas un dossier
        raise HTTPException(status_code=422, detail=str(exc))
    return {"path": path, "entries": [e.model_dump() for e in entries]}
