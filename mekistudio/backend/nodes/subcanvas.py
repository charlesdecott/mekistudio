"""Node « subcanvas » (built-in, brique H). Cadre réductible GÉNÉRIQUE qui contient
d'autres nodes : il les sort de la collision du canvas principal (la passe principale
ne voit qu'UNE boîte) et peut les replier en une tuile. Ses bornes sont DÉRIVÉES du
sous-arbre (cf. front : MekiSubcanvas.derivedBounds) — pas de position propre.

Topologie (brique H) : pend à git ; l'explorateur (+ dossiers + éditeurs) pend à lui
(kernel → git → { chat, subcanvas → explorateur → … }). Pensé générique/imbricable
pour les futurs sous-canvas par worktree."""
from __future__ import annotations

from mekistudio.backend.components import HeaderComponent, LayoutComponent, NodeComponent
from mekistudio.backend.models import Node

KIND = "subcanvas"


def build_subcanvas_node(x: float = 300.0, y: float = 0.0) -> Node:
    """Cadre conteneur. Non déplaçable / non redimensionnable (bornes dérivées du
    contenu côté front) ; réductible (collapsed). Le header porte le titre du cadre."""
    return Node(
        kind=KIND,
        x=x,
        y=y,
        w=360.0,
        h=300.0,
        movable=False,
        resizable=False,
        configurable=False,
        root=NodeComponent(
            children=[LayoutComponent(children=[HeaderComponent(level=2, text="Fichiers")])],
        ),
    )
