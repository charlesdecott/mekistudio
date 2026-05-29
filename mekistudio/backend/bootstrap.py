from __future__ import annotations

import json
import logging
from pathlib import Path

from mekistudio.backend import paths
from mekistudio.backend.models import CanvasState, Manifest

log = logging.getLogger(__name__)


def ensure_meki_dir(root: Path) -> Manifest:
    """Crée .mekistudio/ + manifest + canvas si absents. Idempotent : ne
    réécrit jamais un fichier existant."""
    paths.meki_dir(root).mkdir(parents=True, exist_ok=True)

    mpath = paths.manifest_path(root)
    if mpath.exists():
        manifest = _load_manifest(root)
    else:
        manifest = Manifest(name=root.name)
        _write_json(mpath, manifest.model_dump(mode="json"))

    cpath = paths.canvas_path(root)
    if not cpath.exists():
        _write_json(cpath, CanvasState().model_dump(mode="json"))

    return manifest


def load_canvas(root: Path) -> CanvasState:
    cpath = paths.canvas_path(root)
    if not cpath.exists():
        return CanvasState()
    try:
        data = json.loads(cpath.read_text(encoding="utf-8"))
        return CanvasState.model_validate(data)
    except Exception as exc:  # JSON corrompu / schéma invalide
        log.warning("canvas.json illisible (%s) — valeurs par défaut", exc)
        return CanvasState()


def save_canvas(root: Path, state: CanvasState) -> None:
    _write_json(paths.canvas_path(root), state.model_dump(mode="json"))


def _load_manifest(root: Path) -> Manifest:
    try:
        data = json.loads(paths.manifest_path(root).read_text(encoding="utf-8"))
        return Manifest.model_validate(data)
    except Exception as exc:
        log.warning("manifest.json illisible (%s) — valeurs par défaut", exc)
        return Manifest(name=root.name)


def _write_json(path: Path, payload: dict) -> None:
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
