"""Node « branch git » (built-in, brique G). Affiche la branche courante + avance/
retard remote + modifs locales (données chargées par le front via /api/git/branch).

Topologie : pend au kernel ; le chat et l'explorateur pendent à elle
(kernel → git → { chat, explorateur }). Pensée pour grandir vers les worktrees."""
from __future__ import annotations

from mekistudio.backend.components import (
    GitBranchComponent,
    LayoutComponent,
    NodeComponent,
)
from mekistudio.backend.models import Node

KIND = "gitbranch"


def build_gitbranch_node(x: float = 0.0, y: float = 240.0) -> Node:
    """Sous le kernel (0,0) ; boîte compacte. Non configurable ; réductible (collapsed).
    Le GitBranchComponent porte lui-même sa ligne de titre (⎇ branche, vue minimale
    gardée quand le node est réduit) + le détail (ahead/behind/modifs)."""
    return Node(
        kind=KIND,
        x=x,
        y=y,
        w=240.0,
        h=96.0,
        configurable=False,
        root=NodeComponent(
            children=[LayoutComponent(children=[GitBranchComponent()])],
        ),
    )
