"""Node chat (built-in). Pilote une conversation Claude ; assemblé en primitives :
NodeComponent > LayoutComponent > ChatComponent. La position par défaut le place à
gauche du kernel pour éviter le chevauchement initial."""
from __future__ import annotations

from mekistudio.backend.components import ChatComponent, LayoutComponent, NodeComponent
from mekistudio.backend.models import Node

KIND = "chat"


def build_chat_node(x: float = -440.0, y: float = 0.0) -> Node:
    """x=-440 (w=400 -> bord droit à -40) : pas de chevauchement avec le kernel (0,0).
    movable/resizable comme l'éditeur."""
    return Node(
        kind=KIND,
        x=x,
        y=y,
        w=400.0,
        h=520.0,
        movable=True,
        resizable=True,
        configurable=True,  # F3b : engrenage -> réglages de l'auto-spawn d'éditeurs
        root=NodeComponent(children=[LayoutComponent(children=[ChatComponent()])]),
    )
