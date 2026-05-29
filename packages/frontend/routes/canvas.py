from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates

from packages.backend import bootstrap
from packages.backend.models import Viewport

router = APIRouter()

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
    return bootstrap.load_canvas(root).model_dump(mode="json")


@router.post("/api/canvas/viewport")
async def set_viewport(request: Request, viewport: Viewport) -> dict:
    root = request.app.state.repo_root
    # Bootstrap guarantees .mekistudio/ exists before we write canvas.json.
    bootstrap.ensure_meki_dir(root)
    state = bootstrap.load_canvas(root)
    state.viewport = viewport
    bootstrap.save_canvas(root, state)
    return {"status": "ok"}
