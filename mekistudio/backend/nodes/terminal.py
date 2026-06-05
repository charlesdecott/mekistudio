"""Node terminal (built-in, brique I). Shell PowerShell interactif via PTY
(pywinpty). Assemblé en primitives : NodeComponent > LayoutComponent >
TerminalComponent. Le scrollback vit hors canvas.json (.mekistudio/terminals/<id>/)
et se charge via la WebSocket /ws/term (comme le chat via /ws/chat).

Topologie (brique I) : pend à git (kernel → git → { chat, terminal, subcanvas }).
Pensé pour grandir vers le spawn multi / worktree-aware."""
from __future__ import annotations

from mekistudio.backend.components import LayoutComponent, NodeComponent, TerminalComponent
from mekistudio.backend.models import Node

KIND = "terminal"


def build_terminal_node(x: float = -440.0, y: float = 560.0) -> Node:
    """x=-440 (sous le chat, même colonne à gauche du kernel) : place de départ ;
    la collision douce le relogera dans un trou libre si besoin. movable/resizable
    comme le chat/l'éditeur ; non configurable en v1 (pas de réglages)."""
    return Node(
        kind=KIND,
        x=x,
        y=y,
        w=560.0,
        h=340.0,
        movable=True,
        resizable=True,
        configurable=False,
        root=NodeComponent(children=[LayoutComponent(children=[TerminalComponent()])]),
    )
