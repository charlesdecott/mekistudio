from __future__ import annotations

from pydantic import BaseModel, Field

from mekistudio.backend.components import NodeComponent, new_id


class Manifest(BaseModel):
    """Identité du projet, persistée dans .mekistudio/manifest.json."""

    id: str = Field(default_factory=new_id)
    name: str
    schema_version: int = 1


class Viewport(BaseModel):
    x: float = 0.0
    y: float = 0.0
    zoom: float = 1.0


class Node(BaseModel):
    """Un node positionné sur le canvas. `root` est l'arbre de composants
    (un NodeComponent qui contient layout, header, ...)."""

    id: str = Field(default_factory=new_id)
    kind: str
    x: float = 0.0
    y: float = 0.0
    root: NodeComponent


class CanvasState(BaseModel):
    """État du canvas. `nodes` est désormais typé (seam branché au premier vrai
    node) ; `edges` reste en list[dict] tant qu'on n'a pas de câbles/wires."""

    schema_version: int = 1
    nodes: list[Node] = Field(default_factory=list)
    edges: list[dict] = Field(default_factory=list)
    viewport: Viewport = Field(default_factory=Viewport)
