from __future__ import annotations

from mekistudio.backend.components import (
    HeaderComponent,
    LayoutComponent,
    NodeComponent,
)
from mekistudio.backend.models import Node

KIND = "kernel"


def build_kernel_node(x: float = 80.0, y: float = 80.0) -> Node:
    """kernelNode = NodeComponent > LayoutComponent > HeaderComponent(niveau 1, « Kernel »).

    Premier vrai node : volontairement minimal. Son seul rôle pour l'instant est
    de valider la chaîne complète modèle -> API -> rendu canvas.
    """
    return Node(
        kind=KIND,
        x=x,
        y=y,
        root=NodeComponent(
            children=[
                LayoutComponent(
                    children=[HeaderComponent(level=1, text="Kernel")],
                )
            ],
        ),
    )
