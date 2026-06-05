from __future__ import annotations

import asyncio
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

log = logging.getLogger(__name__)

from mekistudio.backend.chat.bridge import default_client_factory
from mekistudio.backend.chat.manager import ChatManager
from mekistudio.backend.terminal.manager import TerminalManager
from mekistudio.frontend.routes import canvas, chat_ws, fs, git, terminal_ws


@asynccontextmanager
async def _lifespan(app: FastAPI):
    # Les managers sont créés dans create_app (toujours disponibles) ; le lifespan
    # ne sert qu'à l'arrêt propre (sessions Claude + process PTY des terminaux).
    try:
        yield
    finally:
        # Chaque arrêt est ISOLÉ : un échec du chat ne doit pas empêcher le terminate()
        # des PTY (sinon des PowerShell orphelins fuient à chaque arrêt).
        results = await asyncio.gather(
            app.state.chat_manager.shutdown(),
            app.state.terminal_manager.shutdown(),
            return_exceptions=True,
        )
        for exc in results:
            if isinstance(exc, Exception):
                log.warning("erreur à l'arrêt d'un manager : %s", exc)


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
    app.state.terminal_manager = TerminalManager(repo_root)

    static_dir = Path(__file__).resolve().parent / "static"
    app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")
    app.include_router(canvas.router)
    app.include_router(fs.router)
    app.include_router(git.router)
    app.include_router(chat_ws.router)
    app.include_router(terminal_ws.router)
    return app
