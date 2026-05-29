from __future__ import annotations

from typing import Callable

from mekistudio.backend.models import CanvasState, Node
from mekistudio.backend.nodes import kernel

# kind -> fabrique de node. Unique endroit qui connaît tous les kinds ; on
# grandira ce registre node après node (chat, git, ...).
NODE_BUILDERS: dict[str, Callable[..., Node]] = {
    kernel.KIND: kernel.build_kernel_node,
}


def build_node(kind: str, **kwargs) -> Node:
    """Construit un node par son kind. `KeyError` si kind inconnu."""
    return NODE_BUILDERS[kind](**kwargs)


def default_canvas() -> CanvasState:
    """Canvas initial : un kernelNode, pour que le canvas ne soit jamais vide."""
    return CanvasState(nodes=[kernel.build_kernel_node()])
