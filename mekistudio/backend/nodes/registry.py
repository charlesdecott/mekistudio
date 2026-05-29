from __future__ import annotations

from typing import Callable

from mekistudio.backend.models import CanvasState, Node
from mekistudio.backend.nodes import file_editor, file_explorer, kernel

# kind -> fabrique de node. Unique endroit qui connaît tous les kinds ; on
# grandira ce registre node après node (chat, git, ...).
NODE_BUILDERS: dict[str, Callable[..., Node]] = {
    kernel.KIND: kernel.build_kernel_node,
    file_explorer.KIND: file_explorer.build_file_explorer_node,
    file_editor.KIND: file_editor.build_file_editor_node,
}


def build_node(kind: str, **kwargs) -> Node:
    """Construit un node par son kind. `KeyError` si kind inconnu."""
    return NODE_BUILDERS[kind](**kwargs)


def reconcile_constraints(state: CanvasState) -> CanvasState:
    """Réimpose les contraintes intrinsèques au kind (movable / resizable /
    max_*) sur les nodes chargés. Ces contraintes ne doivent jamais provenir du
    JSON persisté : sinon un vieux canvas.json (écrit avant ces champs) rendrait
    p.ex. le kernel déplaçable via les défauts permissifs du modèle."""
    for node in state.nodes:
        builder = NODE_BUILDERS.get(node.kind)
        if builder is None:
            continue
        tmpl = builder()
        node.movable = tmpl.movable
        node.resizable = tmpl.resizable
        node.configurable = tmpl.configurable
        node.max_w = tmpl.max_w
        node.max_h = tmpl.max_h
    return state


def default_canvas() -> CanvasState:
    """Canvas initial : les nodes built-in (kernel + explorateur de fichiers),
    pour que le canvas ne soit jamais vide."""
    # Positions = défauts des fabriques (source unique), pas de duplication ici.
    return CanvasState(
        nodes=[
            kernel.build_kernel_node(),
            file_explorer.build_file_explorer_node(),
            file_editor.build_file_editor_node(),
        ]
    )
