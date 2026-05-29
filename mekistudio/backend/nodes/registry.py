from __future__ import annotations

from typing import Callable

from mekistudio.backend.models import CanvasState, Node
from mekistudio.backend.nodes import file_explorer, kernel

# kind -> fabrique de node. Unique endroit qui connaît tous les kinds ; on
# grandira ce registre node après node (chat, git, ...).
NODE_BUILDERS: dict[str, Callable[..., Node]] = {
    kernel.KIND: kernel.build_kernel_node,
    file_explorer.KIND: file_explorer.build_file_explorer_node,
}


def build_node(kind: str, **kwargs) -> Node:
    """Construit un node par son kind. `KeyError` si kind inconnu."""
    return NODE_BUILDERS[kind](**kwargs)


def default_canvas() -> CanvasState:
    """Canvas initial : les nodes built-in (kernel + explorateur de fichiers),
    pour que le canvas ne soit jamais vide."""
    # Positions = défauts des fabriques (source unique), pas de duplication ici.
    return CanvasState(
        nodes=[
            kernel.build_kernel_node(),
            file_explorer.build_file_explorer_node(),
        ]
    )
