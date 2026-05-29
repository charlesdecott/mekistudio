from __future__ import annotations

from mekistudio.backend.components import (
    EditorComponent,
    LayoutComponent,
    NodeComponent,
)
from mekistudio.backend.models import Node

KIND = "fileeditor"


def build_file_editor_node(x: float = 640.0, y: float = 0.0) -> Node:
    """Node éditeur de fichier (CodeMirror côté front) : ouvre/édite/sauve un
    fichier. Boîte 520x440, déplaçable/redimensionnable. `file_path` vide au
    départ — un clic sur un fichier de l'explorateur l'ouvre ici."""
    return Node(
        kind=KIND,
        x=x,
        y=y,
        w=520.0,
        h=440.0,
        root=NodeComponent(
            children=[
                LayoutComponent(children=[EditorComponent(file_path="")]),
            ],
        ),
    )
