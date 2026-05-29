from __future__ import annotations

from mekistudio.backend.components import (
    HeaderComponent,
    LayoutComponent,
    NodeComponent,
)
from mekistudio.backend.models import Node

KIND = "kernel"


def build_kernel_node(x: float = 0.0, y: float = 0.0) -> Node:
    """kernelNode = NodeComponent > LayoutComponent > HeaderComponent(niveau 1, « Kernel »).

    Ancre centrale fixe du canvas : ni déplaçable ni redimensionnable. Placé à
    l'origine (0,0) ; la vue se centre dessus au chargement.
    """
    return Node(
        kind=KIND,
        x=x,
        y=y,
        movable=False,
        resizable=False,
        root=NodeComponent(
            children=[
                LayoutComponent(
                    children=[HeaderComponent(level=1, text="Kernel")],
                )
            ],
        ),
    )
