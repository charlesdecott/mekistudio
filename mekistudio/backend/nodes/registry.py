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


# Parent logique attendu d'un kind (kind -> kind du parent). Source de vérité
# partagée par le spawn (create_node) et la réconciliation des liens.
CANONICAL_PARENT_KIND: dict[str, str] = {
    file_explorer.KIND: kernel.KIND,
    file_editor.KIND: file_explorer.KIND,
}


def canonical_parent_id(state: CanvasState, kind: str) -> str | None:
    """Id du parent canonique d'un node de ce kind, cherché PAR KIND dans l'état
    courant (jamais via default_canvas() qui régénère des ids aléatoires)."""
    parent_kind = CANONICAL_PARENT_KIND.get(kind)
    if parent_kind is None:
        return None
    return next((n.id for n in state.nodes if n.kind == parent_kind), None)


def reconcile_source_links(state: CanvasState) -> CanvasState:
    """Repose les liens parent ABSENTS ou CASSÉS (dangling) des built-in. Idempotent.
    N'utilise pas builder() et ne saute pas les kinds inconnus (juste la chaîne kind)."""
    ids = {n.id for n in state.nodes}
    for node in state.nodes:
        if node.kind == kernel.KIND:
            node.source_id = None
        elif node.source_id is None or node.source_id not in ids:
            node.source_id = canonical_parent_id(state, node.kind)
    return state


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
    """Canvas initial : kernel (racine) + explorateur relié au kernel."""
    k = kernel.build_kernel_node()
    e = file_explorer.build_file_explorer_node()
    e.source_id = k.id  # 1 câble par node : l'explorateur pend au kernel
    return CanvasState(nodes=[k, e])
