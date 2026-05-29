from __future__ import annotations

from mekistudio.backend.components import (
    HeaderComponent,
    LayoutComponent,
    NodeComponent,
)
from mekistudio.backend.models import CanvasState
from mekistudio.backend.nodes import (
    KERNEL_KIND,
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


def test_build_node_by_kind():
    assert build_node(KERNEL_KIND).kind == KERNEL_KIND


def test_default_canvas_has_kernel():
    canvas = default_canvas()
    assert isinstance(canvas, CanvasState)
    assert len(canvas.nodes) == 1
    assert canvas.nodes[0].kind == KERNEL_KIND


def test_canvas_with_node_roundtrip():
    canvas = default_canvas()
    assert CanvasState.model_validate(canvas.model_dump(mode="json")) == canvas
