from __future__ import annotations

import asyncio
import math
import time
from pathlib import Path
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel, Field

from mekistudio.backend import bootstrap, fs
from mekistudio.backend.components import (
    ChatComponent,
    EditorComponent,
    FileTreeComponent,
    iter_components,
)
from mekistudio.backend.models import Viewport
from mekistudio.backend.nodes import (
    FOLDER_KIND,
    NODE_BUILDERS,
    build_node,
    default_canvas,
    derive_source_id,
    reconcile_source_links,
)

router = APIRouter()

# Tailles minimales d'un node (mêmes valeurs côté JS pour le clamp pendant le drag).
MIN_W = 140.0
MIN_H = 80.0
# Garde-fou : nombre max de nodes (cohérent avec les autres bornes d'entrée).
MAX_NODES = 300
# Kinds built-in (toujours présents) : non supprimables via l'API.
_BUILTIN_KINDS = {n.kind for n in default_canvas().nodes}

# Sérialise les écritures canvas.json (load -> mutate -> save) : aujourd'hui les
# handlers sont atomiques (event-loop unique, pas d'await au milieu), mais ce
# verrou évite tout lost-update si ça change (workers multiples, threadpool...).
_canvas_lock = asyncio.Lock()


class NodeUpdate(BaseModel):
    """Patch partiel d'un node : position, taille, et/ou état réduit (collapsed)."""

    x: float | None = None
    y: float | None = None
    w: float | None = None
    h: float | None = None
    collapsed: bool | None = None  # brique G : node réduit (barre de titre seule)


# Un nom d'exclusion : borné (255 = longueur max usuelle d'un nom de fichier).
_ExcludeName = Annotated[str, Field(max_length=255)]


class NodeSettings(BaseModel):
    """Réglages d'un node configurable. `excludes` : noms masqués (fileExplorer).
    `spawn_*` : auto-spawn d'éditeurs (chat, F3b). Bornés pour ne pas gonfler canvas.json."""

    excludes: list[_ExcludeName] | None = Field(default=None, max_length=200)
    spawn_mode: Literal["ephemeral", "capped", "unlimited"] | None = None
    spawn_ttl_min: int | None = Field(default=None, ge=1, le=1440)
    spawn_cap: int | None = Field(default=None, ge=1, le=200)
    compact_chain: bool | None = None  # brique G : compaction des dossiers-en-nodes (explorateur)


class NodeOpen(BaseModel):
    """Ouvre un fichier dans un node éditeur (chemin relatif au repo)."""

    path: Annotated[str, Field(max_length=4096)]


class NodeCreate(BaseModel):
    """Crée un node d'un kind donné à une position. `source_id` : override optionnel
    du parent logique (sinon dérivé côté serveur). `ephemeral`/`expires_at_ms` : éditeur
    auto-spawné (brique F3, aperçu auto-supprimé au TTL)."""

    kind: str
    x: float = 0.0
    y: float = 0.0
    source_id: str | None = None
    ephemeral: bool = False
    expires_at_ms: int | None = None
    path: Annotated[str, Field(max_length=4096)] | None = None  # brique G : chemin d'un node dossier


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
    async with _canvas_lock:
        state = bootstrap.load_canvas(root)
        # Brique F3 : purge les éditeurs éphémères dont le TTL est dépassé (évite la résurrection
        # d'aperçus expirés après un redémarrage serveur / reload).
        now = int(time.time() * 1000)
        alive = [n for n in state.nodes if not (n.ephemeral and n.expires_at_ms is not None and n.expires_at_ms < now)]
        # Brique G : purge comptée-référence des nodes dossier ÉPHÉMÈRES sans enfant affiché.
        # Fixpoint : effondre une chaîne de dossiers vides de bas en haut (le retrait d'un
        # enfant peut vider son parent au tour suivant). Les dossiers ÉPINGLÉS sont conservés.
        while True:
            child_ids = {n.source_id for n in alive if n.source_id}
            survivors = [
                n for n in alive
                if not (n.kind == FOLDER_KIND and n.ephemeral and n.id not in child_ids)
            ]
            if len(survivors) == len(alive):
                break
            alive = survivors
        if len(alive) != len(state.nodes):
            state.nodes = alive
            bootstrap.save_canvas(root, state)
        return state.model_dump(mode="json")


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
        collapsing = upd.collapsed is not None
        if moving and not node.movable:
            raise HTTPException(status_code=422, detail="node non déplaçable")
        if resizing and not node.resizable:
            raise HTTPException(status_code=422, detail="node non redimensionnable")
        if not moving and not resizing and not collapsing:
            return node.model_dump(mode="json")  # rien à faire : pas d'écriture

        if upd.x is not None:
            node.x = upd.x
        if upd.y is not None:
            node.y = upd.y
        if upd.w is not None:
            node.w = _clamp(upd.w, MIN_W, node.max_w)
        if upd.h is not None:
            node.h = _clamp(upd.h, MIN_H, node.max_h)
        if upd.collapsed is not None:
            node.collapsed = upd.collapsed  # réduire/agrandir : sans contrainte movable/resizable

        bootstrap.save_canvas(root, state)
        return node.model_dump(mode="json")


@router.post("/api/canvas/nodes")
async def create_node(request: Request, body: NodeCreate) -> dict:
    """Crée un node (ex. un éditeur spawné au double-clic) et le persiste."""
    if body.kind not in NODE_BUILDERS:
        raise HTTPException(status_code=422, detail="kind de node inconnu")
    _reject_non_finite(body.x, body.y)
    root = request.app.state.repo_root
    bootstrap.ensure_meki_dir(root)
    async with _canvas_lock:
        state = bootstrap.load_canvas(root)
        if len(state.nodes) >= MAX_NODES:
            raise HTTPException(status_code=422, detail="trop de nodes sur le canvas")
        # Un node dossier porte un chemin (mini-explorateur enraciné + parentage par préfixe).
        # Le chemin est VALIDÉ/normalisé côté serveur (sandbox repo) : pas de `..`/absolu qui
        # casserait l'arbre de parentage ou ferait pointer le mini-explorateur hors du repo.
        if body.kind == FOLDER_KIND:
            try:
                folder_path = fs.repo_relpath(root, body.path or "")
            except ValueError:
                raise HTTPException(status_code=422, detail="chemin de dossier invalide")
            node = build_node(body.kind, x=body.x, y=body.y, path=folder_path)
        else:
            node = build_node(body.kind, x=body.x, y=body.y)
        # source_id dérivé côté serveur (le client n'a rien à envoyer) ; override
        # accepté seulement s'il référence un node existant. Sinon : path-aware
        # (folder/fileeditor par préfixe de chemin) ou par kind.
        if body.source_id and any(n.id == body.source_id for n in state.nodes):
            node.source_id = body.source_id
        else:
            node.source_id = derive_source_id(state, node)
        node.ephemeral = body.ephemeral
        node.expires_at_ms = body.expires_at_ms
        state.nodes.append(node)
        # Brique G : insérer un node dossier peut re-parenter par préfixe des nodes existants
        # (un dossier plus profond créé AVANT son ancêtre lors d'une rafale, ou un point de
        # branchement en mode compact) -> on réconcilie tout l'arbre dans l'état persisté.
        if body.kind == FOLDER_KIND:
            reconcile_source_links(state)
        bootstrap.save_canvas(root, state)
        return node.model_dump(mode="json")


@router.post("/api/canvas/nodes/{node_id}/pin")
async def pin_node(request: Request, node_id: str) -> dict:
    """Épingle un éditeur auto-spawné (brique F3) -> permanent : ephemeral=False,
    expires_at_ms=None (plus de purge au TTL). Persiste."""
    root = request.app.state.repo_root
    bootstrap.ensure_meki_dir(root)
    async with _canvas_lock:
        state = bootstrap.load_canvas(root)
        node = next((n for n in state.nodes if n.id == node_id), None)
        if node is None:
            raise HTTPException(status_code=404, detail="node introuvable")
        node.ephemeral = False
        node.expires_at_ms = None
        bootstrap.save_canvas(root, state)
        return node.model_dump(mode="json")


@router.delete("/api/canvas/nodes/{node_id}")
async def delete_node(request: Request, node_id: str) -> dict:
    """Supprime un node (ex. fermeture d'un éditeur). Les built-in (toujours
    présents) ne sont PAS supprimables."""
    root = request.app.state.repo_root
    bootstrap.ensure_meki_dir(root)
    async with _canvas_lock:
        state = bootstrap.load_canvas(root)
        node = next((n for n in state.nodes if n.id == node_id), None)
        if node is None:
            raise HTTPException(status_code=404, detail="node introuvable")
        if node.kind in _BUILTIN_KINDS:
            raise HTTPException(status_code=422, detail="node built-in non supprimable")
        state.nodes = [n for n in state.nodes if n.id != node_id]
        bootstrap.save_canvas(root, state)
        return {"status": "ok"}


@router.post("/api/canvas/nodes/{node_id}/open")
async def open_in_editor(request: Request, node_id: str, body: NodeOpen) -> dict:
    """Ouvre un fichier dans le node éditeur : valide le chemin (fichier du repo)
    puis fixe file_path sur son EditorComponent. Persiste."""
    root = request.app.state.repo_root
    if not fs.is_file_in_root(root, body.path):
        raise HTTPException(status_code=422, detail="chemin invalide (pas un fichier du repo)")
    bootstrap.ensure_meki_dir(root)
    async with _canvas_lock:
        state = bootstrap.load_canvas(root)
        node = next((n for n in state.nodes if n.id == node_id), None)
        if node is None:
            raise HTTPException(status_code=404, detail="node introuvable")
        editor = next(
            (c for c in iter_components(node.root) if isinstance(c, EditorComponent)),
            None,
        )
        if editor is None:
            raise HTTPException(status_code=422, detail="node sans éditeur")
        editor.file_path = body.path
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

        # Brique G : compaction des dossiers-en-nodes (sur le FileTreeComponent de l'explorateur).
        if settings.compact_chain is not None:
            tree = next(
                (c for c in iter_components(node.root) if isinstance(c, FileTreeComponent)),
                None,
            )
            if tree is not None:
                tree.compact_chain = settings.compact_chain

        # F3b : réglages d'auto-spawn sur le ChatComponent du node chat.
        chat = next((c for c in iter_components(node.root) if isinstance(c, ChatComponent)), None)
        if chat is not None:
            if settings.spawn_mode is not None:
                chat.spawn_mode = settings.spawn_mode
            if settings.spawn_ttl_min is not None:
                chat.spawn_ttl_min = settings.spawn_ttl_min
            if settings.spawn_cap is not None:
                chat.spawn_cap = settings.spawn_cap

        bootstrap.save_canvas(root, state)
        return node.model_dump(mode="json")
