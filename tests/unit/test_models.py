from __future__ import annotations

from mekistudio.backend.components import NodeComponent
from mekistudio.backend.models import CanvasState, Manifest, Node, Viewport


def test_node_defaults():
    n = Node(kind="demo", root=NodeComponent())
    assert (n.x, n.y) == (0, 0)
    assert n.w is None and n.h is None
    assert n.movable is True and n.resizable is True
    assert n.max_w is None and n.max_h is None


def test_manifest_defaults():
    m = Manifest(name="demo")
    assert m.name == "demo"
    assert m.schema_version == 1
    assert isinstance(m.id, str) and len(m.id) > 0


def test_manifest_ids_are_unique():
    assert Manifest(name="a").id != Manifest(name="b").id


def test_canvas_state_defaults():
    c = CanvasState()
    assert c.schema_version == 1
    assert c.nodes == []
    assert c.edges == []
    assert c.viewport == Viewport(x=0, y=0, zoom=1)


def test_canvas_state_roundtrip():
    c = CanvasState(viewport=Viewport(x=10, y=-5, zoom=2))
    data = c.model_dump(mode="json")
    assert CanvasState.model_validate(data) == c
