from __future__ import annotations

import pytest
from pydantic import TypeAdapter, ValidationError

from mekistudio.backend.components import (
    Component,
    EditorComponent,
    FileTreeComponent,
    HeaderComponent,
    LayoutComponent,
    NodeComponent,
    TerminalComponent,
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


def test_filetree_defaults_and_in_union():
    ft = FileTreeComponent()
    assert ft.type == "filetree"
    assert ft.root_path == ""
    assert ft.excludes == ["__pycache__"]  # exclusion par défaut
    # parsable via l'union discriminée
    obj = TypeAdapter(Component).validate_python({"type": "filetree", "root_path": "sub"})
    assert isinstance(obj, FileTreeComponent)
    assert obj.root_path == "sub"


def test_filetree_nested_in_layout_roundtrip():
    tree = NodeComponent(children=[LayoutComponent(children=[FileTreeComponent()])])
    again = NodeComponent.model_validate(tree.model_dump(mode="json"))
    assert again == tree
    assert isinstance(again.children[0].children[0], FileTreeComponent)


def test_editor_defaults_and_in_union():
    ed = EditorComponent()
    assert ed.type == "editor"
    assert ed.file_path == ""
    obj = TypeAdapter(Component).validate_python({"type": "editor", "file_path": "a.py"})
    assert isinstance(obj, EditorComponent)
    assert obj.file_path == "a.py"


def test_terminal_defaults_and_in_union():
    t = TerminalComponent()
    assert t.type == "terminal"
    assert t.shell == "powershell"
    assert t.cols == 80
    assert t.rows == 24
    assert t.title == "terminal"
    assert t.terminal_id  # id auto-généré, non vide
    # parsable via l'union discriminée
    obj = TypeAdapter(Component).validate_python(
        {"type": "terminal", "terminal_id": "abc", "cols": 120, "rows": 40}
    )
    assert isinstance(obj, TerminalComponent)
    assert obj.terminal_id == "abc"
    assert obj.cols == 120


def test_terminal_cols_rows_bounds():
    TerminalComponent(cols=1, rows=1)        # bornes basses ok
    TerminalComponent(cols=1000, rows=1000)  # bornes hautes ok
    with pytest.raises(ValidationError):
        TerminalComponent(cols=0)
    with pytest.raises(ValidationError):
        TerminalComponent(rows=1001)


def test_terminal_nested_in_layout_roundtrip():
    tree = NodeComponent(children=[LayoutComponent(children=[TerminalComponent()])])
    again = NodeComponent.model_validate(tree.model_dump(mode="json"))
    assert again == tree
    assert isinstance(again.children[0].children[0], TerminalComponent)
