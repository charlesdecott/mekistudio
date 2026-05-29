from __future__ import annotations

import uuid

from pydantic import BaseModel, Field


class Manifest(BaseModel):
    """Identité du projet, persistée dans .mekistudio/manifest.json."""

    id: str = Field(default_factory=lambda: uuid.uuid4().hex)
    name: str
    schema_version: int = 1


class Viewport(BaseModel):
    x: float = 0.0
    y: float = 0.0
    zoom: float = 1.0


class CanvasState(BaseModel):
    """État du canvas. nodes/edges restent en list[dict] au Jalon 1 — c'est
    le seam : on typera les nodes quand on branchera le premier vrai node."""

    schema_version: int = 1
    nodes: list[dict] = Field(default_factory=list)
    edges: list[dict] = Field(default_factory=list)
    viewport: Viewport = Field(default_factory=Viewport)
