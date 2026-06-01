"""Node « dossier » (dynamique, brique G). Un mini-explorateur enraciné sur un
sous-dossier : ouvrir un sous-dossier le sort de l'explorateur parent et regroupe
ses fichiers ouverts sous lui. Le parentage (câble) est dérivé par préfixe de chemin
depuis `Node.path` (cf. parenting.py / reconcile_source_links).

Non built-in : supprimable. Cycle de vie compté-référence + épingle (réutilise
`Node.ephemeral` + l'endpoint pin + la purge de /api/canvas)."""
from __future__ import annotations

from mekistudio.backend.components import (
    FileTreeComponent,
    HeaderComponent,
    LayoutComponent,
    NodeComponent,
)
from mekistudio.backend.models import Node

KIND = "folder"


def build_folder_node(x: float = 0.0, y: float = 0.0, path: str = "") -> Node:
    """Mini-explorateur enraciné sur `path` (posix relatif au repo). Le header
    affiche le dernier segment du chemin. `path` est aussi porté au niveau Node
    (source de vérité du parentage par préfixe)."""
    name = path.split("/")[-1] if path else "/"
    return Node(
        kind=KIND,
        x=x,
        y=y,
        w=300.0,
        h=320.0,
        configurable=True,
        path=path,
        root=NodeComponent(
            children=[
                LayoutComponent(
                    children=[
                        HeaderComponent(level=2, text=name),
                        FileTreeComponent(root_path=path),
                    ],
                )
            ],
        ),
    )
