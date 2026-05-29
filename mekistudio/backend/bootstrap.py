from __future__ import annotations

import json
import logging
from pathlib import Path

from mekistudio.backend import paths
from mekistudio.backend.models import CanvasState, Manifest
from mekistudio.backend.nodes import default_canvas, reconcile_constraints

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
        # Canvas neuf seedé avec le kernelNode : le canvas n'est jamais vide.
        _write_json(cpath, default_canvas().model_dump(mode="json"))

    return manifest


def load_canvas(root: Path) -> CanvasState:
    cpath = paths.canvas_path(root)
    if not cpath.exists():
        # Jamais de canvas vide : on retombe sur le canvas par défaut (kernelNode).
        return default_canvas()
    try:
        data = json.loads(cpath.read_text(encoding="utf-8"))
        state = CanvasState.model_validate(data)
    except Exception as exc:  # JSON corrompu / schéma invalide
        # On préserve le fichier fautif en .bak (sinon le prochain save l'écrase
        # en silence) puis on retombe sur le canvas par défaut — jamais vide.
        log.warning("canvas.json illisible (%s) — sauvegarde .bak + canvas par défaut", exc)
        try:
            cpath.replace(cpath.with_name(cpath.name + ".bak"))
        except OSError:
            pass
        return default_canvas()
    # Les contraintes (movable/resizable/max_*) sont intrinsèques au kind : on
    # les réimpose depuis la fabrique (un vieux canvas.json ne doit pas pouvoir
    # rendre le kernel déplaçable via des défauts permissifs).
    return reconcile_constraints(state)


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
    # Écriture atomique : on écrit un fichier temporaire du même dossier puis on
    # le renomme (rename atomique sur le même FS, POSIX comme Windows) — un crash
    # en cours d'écriture ne laisse jamais un canvas.json tronqué.
    # allow_nan=False : un NaN/Infinity lève ici plutôt que de produire du JSON
    # non standard qui casserait la relecture côté navigateur.
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(payload, indent=2, allow_nan=False), encoding="utf-8")
    tmp.replace(path)
