"""Lanceur de serveur de test (brique G) : uvicorn sur un repo_root + port donnés.
Usage : uv run python scripts/_g_serve.py <repo_root> <port>. (Non destiné au commit.)"""
from __future__ import annotations

import sys
from pathlib import Path

import uvicorn

from mekistudio.frontend.app import create_app

root = Path(sys.argv[1]).resolve()
port = int(sys.argv[2])
uvicorn.run(create_app(repo_root=root), host="127.0.0.1", port=port, log_level="warning")
