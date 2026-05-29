from __future__ import annotations

import asyncio
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field

from mekistudio.backend import fs

router = APIRouter()

# Sérialise les écritures fichier (comme _canvas_lock pour canvas.json) :
# inoffensif aujourd'hui (event-loop unique), protège si workers/threadpool.
_file_write_lock = asyncio.Lock()


class FileWrite(BaseModel):
    path: Annotated[str, Field(max_length=4096)]
    # Garde-fou grossier (caractères) ; le vrai contrôle en OCTETS est dans
    # fs.write_file (qui lève -> 422), car max_length compte les points de code.
    content: Annotated[str, Field(max_length=fs.MAX_FILE_BYTES)]


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


@router.get("/api/file")
async def read_file(request: Request, path: str) -> dict:
    """Contenu texte d'un fichier du repo (pour l'éditeur)."""
    root = request.app.state.repo_root
    try:
        content = fs.read_file(root, path)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    return {"path": path, "content": content}


@router.post("/api/file")
async def write_file(request: Request, body: FileWrite) -> dict:
    """Sauvegarde le contenu d'un fichier EXISTANT du repo."""
    root = request.app.state.repo_root
    try:
        async with _file_write_lock:
            fs.write_file(root, body.path, body.content)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    return {"status": "ok"}
