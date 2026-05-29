from __future__ import annotations

import pytest
from pydantic import TypeAdapter, ValidationError

from mekistudio.backend.components import (
    Component,
    HeaderComponent,
    LayoutComponent,
    NodeComponent,
)


def test_header_defaults():
    h = HeaderComponent(text="Kernel")
    assert h.type == "header"
    assert h.level == 1
    assert h.text == "Kernel"
    assert h.id  # id auto-généré, non vide


def test_header_level_bounds():
    HeaderComponent(text="x", level=4)  # bornes ok
    with pytest.raises(ValidationError):
        HeaderComponent(text="x", level=0)
    with pytest.raises(ValidationError):
        HeaderComponent(text="x", level=5)


def test_layout_defaults():
    layout = LayoutComponent()
    assert layout.type == "layout"
    assert layout.direction == "column"
    assert layout.children == []


def test_nested_tree_roundtrip_preserves_types():
    tree = NodeComponent(
        children=[LayoutComponent(children=[HeaderComponent(level=2, text="Hi")])]
    )
    again = NodeComponent.model_validate(tree.model_dump(mode="json"))
    assert again == tree
    # l'union discriminée doit reconstruire les bons types, pas des dicts
    assert isinstance(again.children[0], LayoutComponent)
    assert isinstance(again.children[0].children[0], HeaderComponent)


def test_discriminated_union_parses_by_type():
    obj = TypeAdapter(Component).validate_python(
        {"type": "header", "text": "Z", "level": 3}
    )
    assert isinstance(obj, HeaderComponent)
    assert obj.level == 3
