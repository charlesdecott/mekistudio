from __future__ import annotations

from mekistudio.backend.components import (
    FileTreeComponent,
    HeaderComponent,
    LayoutComponent,
    NodeComponent,
)
from mekistudio.backend.models import CanvasState
from mekistudio.backend.nodes import (
    FILE_EXPLORER_KIND,
    KERNEL_KIND,
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


def test_build_node_by_kind():
    assert build_node(KERNEL_KIND).kind == KERNEL_KIND
    assert build_node(FILE_EXPLORER_KIND).kind == FILE_EXPLORER_KIND


def test_default_canvas_has_builtin_nodes():
    canvas = default_canvas()
    assert isinstance(canvas, CanvasState)
    kinds = {n.kind for n in canvas.nodes}
    assert kinds == {KERNEL_KIND, FILE_EXPLORER_KIND}


def test_canvas_with_node_roundtrip():
    canvas = default_canvas()
    assert CanvasState.model_validate(canvas.model_dump(mode="json")) == canvas
