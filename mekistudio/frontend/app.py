from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from mekistudio.frontend.routes import canvas, fs


def create_app(repo_root: Path | None = None) -> FastAPI:
    """Construit l'app FastAPI. `repo_root` est passé explicitement par la CLI
    (et par les tests) ; à défaut on lit MEKISTUDIO_REPO_ROOT, sinon le cwd —
    ainsi backend/ n'a jamais à connaître la CLI."""
    if repo_root is None:
        env = os.environ.get("MEKISTUDIO_REPO_ROOT")
        repo_root = Path(env) if env else Path.cwd()

    app = FastAPI(title="mekistudio-2")
    app.state.repo_root = repo_root

    static_dir = Path(__file__).resolve().parent / "static"
    app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")
    app.include_router(canvas.router)
    app.include_router(fs.router)
    return app
