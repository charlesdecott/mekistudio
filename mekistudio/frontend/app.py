from __future__ import annotations

import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from mekistudio.backend.chat.bridge import default_client_factory
from mekistudio.backend.chat.manager import ChatManager
from mekistudio.frontend.routes import canvas, chat_ws, fs


@asynccontextmanager
async def _lifespan(app: FastAPI):
    # Le ChatManager est créé dans create_app (toujours disponible) ; le lifespan
    # ne sert qu'à l'arrêt propre (interrupt + disconnect des sessions Claude).
    try:
        yield
    finally:
        await app.state.chat_manager.shutdown()


def create_app(repo_root: Path | None = None, *, chat_client_factory=None) -> FastAPI:
    """Construit l'app FastAPI. `repo_root` est passé explicitement par la CLI
    (et par les tests) ; à défaut on lit MEKISTUDIO_REPO_ROOT, sinon le cwd —
    ainsi backend/ n'a jamais à connaître la CLI. `chat_client_factory` permet
    aux tests d'injecter un faux client SDK."""
    if repo_root is None:
        env = os.environ.get("MEKISTUDIO_REPO_ROOT")
        repo_root = Path(env) if env else Path.cwd()

    app = FastAPI(title="mekistudio-2", lifespan=_lifespan)
    app.state.repo_root = repo_root
    app.state.chat_client_factory = chat_client_factory or default_client_factory
    app.state.chat_manager = ChatManager(repo_root, app.state.chat_client_factory)

    static_dir = Path(__file__).resolve().parent / "static"
    app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")
    app.include_router(canvas.router)
    app.include_router(fs.router)
    app.include_router(chat_ws.router)
    return app
