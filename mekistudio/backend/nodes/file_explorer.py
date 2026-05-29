from __future__ import annotations

from mekistudio.backend.components import (
    FileTreeComponent,
    HeaderComponent,
    LayoutComponent,
    NodeComponent,
)
from mekistudio.backend.models import Node

KIND = "fileexplorer"


def build_file_explorer_node(x: float = 300.0, y: float = 0.0) -> Node:
    """Node explorateur de fichiers (style VSCode) : un header + un FileTree
    monté sur la racine du repo. L'arbre se déplie paresseusement via /api/fs.

    Boîte 300x380 par défaut, déplaçable et redimensionnable (pour l'agrandir).
    """
    return Node(
        kind=KIND,
        x=x,
        y=y,
        w=300.0,
        h=380.0,
        root=NodeComponent(
            children=[
                LayoutComponent(
                    children=[
                        HeaderComponent(level=2, text="Explorer"),
                        FileTreeComponent(root_path=""),
                    ],
                )
            ],
        ),
    )
