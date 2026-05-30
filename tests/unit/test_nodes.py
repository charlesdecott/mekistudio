from __future__ import annotations

from mekistudio.backend.components import (
    EditorComponent,
    FileTreeComponent,
    HeaderComponent,
    LayoutComponent,
    NodeComponent,
)
from mekistudio.backend.models import CanvasState
from mekistudio.backend.nodes import (
    FILE_EDITOR_KIND,
    FILE_EXPLORER_KIND,
    KERNEL_KIND,
    build_file_editor_node,
    build_file_explorer_node,
    build_kernel_node,
    build_node,
    default_canvas,
)


def test_build_kernel_node_structure():
    node = build_kernel_node(x=10, y=20)
    assert node.kind == KERNEL_KIND
    assert (node.x, node.y) == (10, 20)
    assert isinstance(node.root, NodeComponent)

    layout = node.root.children[0]
    assert isinstance(layout, LayoutComponent)

    header = layout.children[0]
    assert isinstance(header, HeaderComponent)
    assert header.level == 1
    assert header.text == "Kernel"


def test_build_file_explorer_node_structure():
    node = build_file_explorer_node(x=10, y=20)
    assert node.kind == FILE_EXPLORER_KIND
    assert (node.x, node.y) == (10, 20)
    layout = node.root.children[0]
    assert isinstance(layout, LayoutComponent)
    header, tree = layout.children
    assert isinstance(header, HeaderComponent) and header.text == "Explorer"
    assert isinstance(tree, FileTreeComponent) and tree.root_path == ""


def test_kernel_is_fixed_anchor():
    n = build_kernel_node()
    assert n.movable is False
    assert n.resizable is False


def test_file_explorer_is_movable_resizable_box():
    n = build_file_explorer_node()
    assert n.movable is True and n.resizable is True
    assert n.configurable is True  # a un engrenage de réglages
    assert n.w and n.h  # taille par défaut (boîte)


def test_kernel_is_not_configurable():
    assert build_kernel_node().configurable is False


def test_build_file_editor_node_structure():
    node = build_file_editor_node()
    assert node.kind == FILE_EDITOR_KIND
    assert node.movable is True and node.resizable is True
    editor = node.root.children[0].children[0]
    assert isinstance(editor, EditorComponent)
    assert editor.file_path == ""


def test_build_node_by_kind():
    assert build_node(KERNEL_KIND).kind == KERNEL_KIND
    assert build_node(FILE_EXPLORER_KIND).kind == FILE_EXPLORER_KIND
    assert build_node(FILE_EDITOR_KIND).kind == FILE_EDITOR_KIND


def test_default_canvas_has_builtin_nodes():
    # Built-in = kernel + explorateur + chat. L'éditeur est dynamique (spawné au double-clic).
    canvas = default_canvas()
    assert isinstance(canvas, CanvasState)
    kinds = {n.kind for n in canvas.nodes}
    assert kinds == {KERNEL_KIND, FILE_EXPLORER_KIND, "chat"}


def test_canvas_with_node_roundtrip():
    canvas = default_canvas()
    assert CanvasState.model_validate(canvas.model_dump(mode="json")) == canvas


def test_node_has_source_id_default_none():
    from mekistudio.backend.nodes import build_kernel_node
    assert build_kernel_node().source_id is None


def test_canvas_roundtrip_preserves_source_id():
    from mekistudio.backend.models import CanvasState, Node
    from mekistudio.backend.components import NodeComponent
    n = Node(kind="fileeditor", source_id="abc", root=NodeComponent(children=[]))
    state = CanvasState(nodes=[n])
    assert CanvasState.model_validate(state.model_dump(mode="json")).nodes[0].source_id == "abc"


def test_default_canvas_links_explorer_to_kernel():
    from mekistudio.backend.nodes import default_canvas
    state = default_canvas()
    k = next(n for n in state.nodes if n.kind == "kernel")
    e = next(n for n in state.nodes if n.kind == "fileexplorer")
    assert k.source_id is None
    assert e.source_id == k.id


def test_reconcile_source_links_repairs_absent_and_dangling():
    from mekistudio.backend.nodes import default_canvas, reconcile_source_links
    state = default_canvas()
    k = next(n for n in state.nodes if n.kind == "kernel")
    e = next(n for n in state.nodes if n.kind == "fileexplorer")
    e.source_id = None                      # absent
    reconcile_source_links(state)
    assert e.source_id == k.id
    e.source_id = "ghost"                   # dangling
    reconcile_source_links(state)
    assert e.source_id == k.id
    before = e.source_id                     # idempotent
    reconcile_source_links(state)
    assert e.source_id == before


def test_canonical_parent_id():
    from mekistudio.backend.nodes import canonical_parent_id, default_canvas
    state = default_canvas()
    k = next(n for n in state.nodes if n.kind == "kernel")
    assert canonical_parent_id(state, "fileexplorer") == k.id
    assert canonical_parent_id(state, "kernel") is None
