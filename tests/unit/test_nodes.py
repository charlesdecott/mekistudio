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
    # Built-in = kernel + git + explorateur + chat. L'éditeur/dossier sont dynamiques.
    canvas = default_canvas()
    assert isinstance(canvas, CanvasState)
    kinds = {n.kind for n in canvas.nodes}
    assert kinds == {KERNEL_KIND, "gitbranch", FILE_EXPLORER_KIND, "chat"}


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


def test_default_canvas_git_topology():
    # Brique G : kernel -> git -> { chat, explorateur }.
    from mekistudio.backend.nodes import default_canvas
    state = default_canvas()
    by = {n.kind: n for n in state.nodes}
    assert by["kernel"].source_id is None
    assert by["gitbranch"].source_id == by["kernel"].id
    assert by["fileexplorer"].source_id == by["gitbranch"].id
    assert by["chat"].source_id == by["gitbranch"].id


def test_reconcile_source_links_repairs_absent_and_dangling():
    from mekistudio.backend.nodes import default_canvas, reconcile_source_links
    state = default_canvas()
    g = next(n for n in state.nodes if n.kind == "gitbranch")
    e = next(n for n in state.nodes if n.kind == "fileexplorer")
    e.source_id = None                      # absent
    reconcile_source_links(state)
    assert e.source_id == g.id              # canonique = git (brique G)
    e.source_id = "ghost"                   # dangling
    reconcile_source_links(state)
    assert e.source_id == g.id
    before = e.source_id                     # idempotent
    reconcile_source_links(state)
    assert e.source_id == before


def test_reconcile_migration_reparents_chat_and_explorer_to_git():
    # Canvas legacy : chat & explorateur pendent encore au kernel (mauvais kind).
    from mekistudio.backend.models import CanvasState
    from mekistudio.backend.nodes import (
        build_chat_node,
        build_file_explorer_node,
        build_gitbranch_node,
        build_kernel_node,
        reconcile_source_links,
    )
    k = build_kernel_node()
    g = build_gitbranch_node()
    c = build_chat_node()
    e = build_file_explorer_node()
    g.source_id = k.id
    c.source_id = k.id  # legacy
    e.source_id = k.id  # legacy
    state = CanvasState(nodes=[k, g, c, e])
    reconcile_source_links(state)
    by = {n.kind: n for n in state.nodes}
    assert by["chat"].source_id == by["gitbranch"].id
    assert by["fileexplorer"].source_id == by["gitbranch"].id


def test_canonical_parent_id():
    from mekistudio.backend.nodes import canonical_parent_id, default_canvas
    state = default_canvas()
    k = next(n for n in state.nodes if n.kind == "kernel")
    g = next(n for n in state.nodes if n.kind == "gitbranch")
    assert canonical_parent_id(state, "fileexplorer") == g.id  # brique G : sous git
    assert canonical_parent_id(state, "gitbranch") == k.id
    assert canonical_parent_id(state, "kernel") is None


# --- brique G : node git, node dossier, parentage path-aware ---


def test_build_gitbranch_node_structure():
    from mekistudio.backend.components import GitBranchComponent
    from mekistudio.backend.nodes import build_gitbranch_node
    n = build_gitbranch_node()
    assert n.kind == "gitbranch"
    assert n.configurable is False and n.movable is True
    comp = n.root.children[0].children[1]
    assert isinstance(comp, GitBranchComponent)


def test_build_folder_node_structure():
    from mekistudio.backend.components import FileTreeComponent, HeaderComponent
    from mekistudio.backend.nodes import build_folder_node
    n = build_folder_node(path="docs/superpowers")
    assert n.kind == "folder" and n.path == "docs/superpowers"
    assert n.configurable is True
    header, tree = n.root.children[0].children
    assert isinstance(header, HeaderComponent) and header.text == "superpowers"  # dernier segment
    assert isinstance(tree, FileTreeComponent) and tree.root_path == "docs/superpowers"


def _editor_on(path: str):
    from mekistudio.backend.components import EditorComponent, iter_components
    from mekistudio.backend.nodes import build_file_editor_node
    ed = build_file_editor_node()
    comp = next(c for c in iter_components(ed.root) if isinstance(c, EditorComponent))
    comp.file_path = path
    return ed


def test_node_effective_path():
    from mekistudio.backend.nodes import build_folder_node, node_effective_path
    assert node_effective_path(build_folder_node(path="docs")) == "docs"
    assert node_effective_path(_editor_on("docs/superpowers/x.md")) == "docs/superpowers"
    assert node_effective_path(_editor_on("top.md")) == ""  # fichier à la racine
    assert node_effective_path(_editor_on("")) is None       # pas de fichier ouvert


def test_reconcile_path_aware_chain_and_idempotent():
    from mekistudio.backend.models import CanvasState
    from mekistudio.backend.nodes import (
        build_file_explorer_node,
        build_folder_node,
        reconcile_source_links,
    )
    e = build_file_explorer_node()
    d = build_folder_node(path="docs")
    s = build_folder_node(path="docs/superpowers")
    ed = _editor_on("docs/superpowers/x.md")
    state = CanvasState(nodes=[e, d, s, ed])
    reconcile_source_links(state)
    reconcile_source_links(state)  # idempotent
    assert ed.source_id == s.id          # éditeur sous son dossier direct
    assert s.source_id == d.id           # dossier sous son ancêtre (préfixe strict)
    assert d.source_id == e.id           # racine -> explorateur


def test_reconcile_editor_without_folder_falls_back_to_explorer():
    from mekistudio.backend.models import CanvasState
    from mekistudio.backend.nodes import build_file_explorer_node, reconcile_source_links
    e = build_file_explorer_node()
    ed = _editor_on("docs/superpowers/x.md")  # aucun node dossier
    state = CanvasState(nodes=[e, ed])
    reconcile_source_links(state)
    assert ed.source_id == e.id  # plus long préfixe = explorateur ("")
