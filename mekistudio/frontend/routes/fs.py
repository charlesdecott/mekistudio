from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request

from mekistudio.backend import fs

router = APIRouter()


@router.get("/api/fs")
async def list_fs(request: Request, path: str = "") -> dict:
    """Liste un dossier du repo pour l'explorateur (chargement paresseux)."""
    root = request.app.state.repo_root
    try:
        entries = fs.list_dir(root, path)
    except ValueError as exc:  # hors racine / pas un dossier
        raise HTTPException(status_code=422, detail=str(exc))
    return {"path": path, "entries": [e.model_dump() for e in entries]}
