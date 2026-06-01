from mekistudio.backend.bootstrap import ensure_meki_dir, load_canvas, save_canvas
from mekistudio.backend.components import LayoutComponent, NodeComponent
from mekistudio.backend.components.primitives import ChatComponent
from mekistudio.backend.models import Node
from mekistudio.backend.nodes.chat import KIND, build_chat_node
from mekistudio.backend.nodes.registry import (
    CANONICAL_PARENT_KIND,
    NODE_BUILDERS,
    default_canvas,
)


def test_chatcomponent_roundtrip_and_in_node():
    c = ChatComponent()
    assert c.type == "chat" and c.title == "chat" and c.placeholder
    assert isinstance(c.conversation_id, str) and len(c.conversation_id) > 0
    node = Node(kind="chat", root=NodeComponent(children=[LayoutComponent(children=[c])]))
    back = Node.model_validate(node.model_dump(mode="json"))
    inner = back.root.children[0].children[0]
    assert inner.type == "chat" and inner.conversation_id == c.conversation_id


def test_build_chat_node():
    n = build_chat_node()
    assert n.kind == KIND == "chat"
    assert (n.x, n.y, n.w, n.h) == (-440.0, 0.0, 400.0, 520.0)
    assert n.movable and n.resizable
    chat = n.root.children[0].children[0]
    assert chat.type == "chat" and chat.conversation_id


def test_chat_in_default_canvas_linked_to_git():
    # Brique G : le chat pend désormais à la node git (kernel -> git -> chat).
    state = default_canvas()
    kinds = {n.kind for n in state.nodes}
    assert {"kernel", "gitbranch", "fileexplorer", "chat"} <= kinds
    assert NODE_BUILDERS["chat"]
    assert CANONICAL_PARENT_KIND["chat"] == "gitbranch"
    git = next(n for n in state.nodes if n.kind == "gitbranch")
    chat = next(n for n in state.nodes if n.kind == "chat")
    assert chat.source_id == git.id


def test_conversation_id_survives_load_reconcile_save(tmp_path):
    state = default_canvas()
    chat = next(n for n in state.nodes if n.kind == "chat")
    cid = chat.root.children[0].children[0].conversation_id
    ensure_meki_dir(tmp_path)  # crée .mekistudio/ (save_canvas y écrit le .tmp)
    save_canvas(tmp_path, state)
    reloaded = load_canvas(tmp_path)  # déclenche reconcile_constraints + reconcile_source_links
    chat2 = next(n for n in reloaded.nodes if n.kind == "chat")
    assert chat2.root.children[0].children[0].conversation_id == cid
