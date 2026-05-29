from __future__ import annotations

import asyncio
import math
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel, Field

from mekistudio.backend import bootstrap
from mekistudio.backend.components import FileTreeComponent, iter_components
from mekistudio.backend.models import Viewport

router = APIRouter()

# Tailles minimales d'un node (mêmes valeurs côté JS pour le clamp pendant le drag).
MIN_W = 140.0
MIN_H = 80.0

# Sérialise les écritures canvas.json (load -> mutate -> save) : aujourd'hui les
# handlers sont atomiques (event-loop unique, pas d'await au milieu), mais ce
# verrou évite tout lost-update si ça change (workers multiples, threadpool...).
_canvas_lock = asyncio.Lock()


class NodeUpdate(BaseModel):
    """Patch partiel d'un node : position et/ou taille."""

    x: float | None = None
    y: float | None = None
    w: float | None = None
    h: float | None = None


# Un nom d'exclusion : borné (255 = longueur max usuelle d'un nom de fichier).
_ExcludeName = Annotated[str, Field(max_length=255)]


class NodeSettings(BaseModel):
    """Réglages d'un node configurable. `excludes` : noms masqués (fileExplorer).
    Borné (≤200) pour ne pas gonfler canvas.json ni la query line de /api/fs."""

    excludes: list[_ExcludeName] | None = Field(default=None, max_length=200)


def _clamp(value: float, lo: float, hi: float | None) -> float:
    value = max(lo, value)
    return min(value, hi) if hi is not None else value


def _reject_non_finite(*values: float | None) -> None:
    """422 propre si un NaN/Infinity est reçu (sinon il finirait en JSON non
    standard que le navigateur n'arrive plus à relire)."""
    if any(v is not None and not math.isfinite(v) for v in values):
        raise HTTPException(status_code=422, detail="valeur numérique non finie")

_TEMPLATES = Jinja2Templates(
    directory=str(Path(__file__).resolve().parent.parent / "templates")
)


@router.get("/healthz")
async def healthz() -> dict:
    return {"status": "ok"}


@router.get("/", response_class=HTMLResponse)
async def index(request: Request):
    root = request.app.state.repo_root
    manifest = bootstrap.ensure_meki_dir(root)
    return _TEMPLATES.TemplateResponse(
        request=request,
        name="canvas.html",
        context={"project_name": manifest.name},
    )


@router.get("/api/canvas")
async def get_canvas(request: Request) -> dict:
    root = request.app.state.repo_root
    # Assure le seed du canvas (kernelNode) même si /api/canvas est la 1re requête.
    bootstrap.ensure_meki_dir(root)
    return bootstrap.load_canvas(root).model_dump(mode="json")


@router.post("/api/canvas/viewport")
async def set_viewport(request: Request, viewport: Viewport) -> dict:
    root = request.app.state.repo_root
    _reject_non_finite(viewport.x, viewport.y, viewport.zoom)
    # Le bootstrap garantit que .mekistudio/ existe avant d'écrire canvas.json.
    bootstrap.ensure_meki_dir(root)
    async with _canvas_lock:
        state = bootstrap.load_canvas(root)
        state.viewport = viewport
        bootstrap.save_canvas(root, state)
    return {"status": "ok"}


@router.post("/api/canvas/nodes/{node_id}")
async def update_node(request: Request, node_id: str, upd: NodeUpdate) -> dict:
    """Déplace et/ou redimensionne un node en faisant respecter ses contraintes
    (on ne fait pas confiance au client). Persiste dans canvas.json."""
    root = request.app.state.repo_root
    _reject_non_finite(upd.x, upd.y, upd.w, upd.h)
    bootstrap.ensure_meki_dir(root)
    async with _canvas_lock:
        state = bootstrap.load_canvas(root)
        node = next((n for n in state.nodes if n.id == node_id), None)
        if node is None:
            raise HTTPException(status_code=404, detail="node introuvable")

        moving = upd.x is not None or upd.y is not None
        resizing = upd.w is not None or upd.h is not None
        if moving and not node.movable:
            raise HTTPException(status_code=422, detail="node non déplaçable")
        if resizing and not node.resizable:
            raise HTTPException(status_code=422, detail="node non redimensionnable")
        if not moving and not resizing:
            return node.model_dump(mode="json")  # rien à faire : pas d'écriture

        if upd.x is not None:
            node.x = upd.x
        if upd.y is not None:
            node.y = upd.y
        if upd.w is not None:
            node.w = _clamp(upd.w, MIN_W, node.max_w)
        if upd.h is not None:
            node.h = _clamp(upd.h, MIN_H, node.max_h)

        bootstrap.save_canvas(root, state)
        return node.model_dump(mode="json")


@router.post("/api/canvas/nodes/{node_id}/settings")
async def update_node_settings(
    request: Request, node_id: str, settings: NodeSettings
) -> dict:
    """Met à jour les réglages d'un node configurable. Pour le fileExplorer :
    la liste d'exclusions du FileTreeComponent."""
    root = request.app.state.repo_root
    bootstrap.ensure_meki_dir(root)
    async with _canvas_lock:
        state = bootstrap.load_canvas(root)
        node = next((n for n in state.nodes if n.id == node_id), None)
        if node is None:
            raise HTTPException(status_code=404, detail="node introuvable")
        if not node.configurable:
            raise HTTPException(status_code=422, detail="node non configurable")

        if settings.excludes is not None:
            tree = next(
                (c for c in iter_components(node.root) if isinstance(c, FileTreeComponent)),
                None,
            )
            if tree is not None:
                # normalise : trim, sans vides, dédoublonné (ordre conservé)
                clean: list[str] = []
                for raw in settings.excludes:
                    name = raw.strip()
                    if not name:
                        continue
                    if "/" in name or "\\" in name:
                        # filtrage par nom seulement : un séparateur ne matcherait
                        # jamais -> on rejette pour éviter une fausse impression.
                        raise HTTPException(
                            status_code=422,
                            detail="une exclusion est un nom simple, pas un chemin",
                        )
                    if name not in clean:
                        clean.append(name)
                tree.excludes = clean

        bootstrap.save_canvas(root, state)
        return node.model_dump(mode="json")
