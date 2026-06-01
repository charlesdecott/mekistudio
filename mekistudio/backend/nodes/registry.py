from __future__ import annotations

from typing import Callable

from mekistudio.backend.components import EditorComponent, iter_components
from mekistudio.backend.models import CanvasState, Node
from mekistudio.backend.nodes import chat, file_editor, file_explorer, folder, gitbranch, kernel
from mekistudio.backend.nodes.parenting import longest_prefix_id

# kind -> fabrique de node. Unique endroit qui connaît tous les kinds ; on
# grandira ce registre node après node (chat, git, ...).
NODE_BUILDERS: dict[str, Callable[..., Node]] = {
    kernel.KIND: kernel.build_kernel_node,
    gitbranch.KIND: gitbranch.build_gitbranch_node,
    file_explorer.KIND: file_explorer.build_file_explorer_node,
    file_editor.KIND: file_editor.build_file_editor_node,
    chat.KIND: chat.build_chat_node,
    folder.KIND: folder.build_folder_node,
}


def build_node(kind: str, **kwargs) -> Node:
    """Construit un node par son kind. `KeyError` si kind inconnu."""
    return NODE_BUILDERS[kind](**kwargs)


# Parent logique attendu d'un kind (kind -> kind du parent). Source de vérité du
# parentage PAR KIND. Brique G : git s'insère entre le kernel et chat/explorateur.
CANONICAL_PARENT_KIND: dict[str, str] = {
    gitbranch.KIND: kernel.KIND,
    file_explorer.KIND: gitbranch.KIND,  # G : était kernel
    chat.KIND: gitbranch.KIND,           # G : était kernel
    file_editor.KIND: file_explorer.KIND,  # fallback ; le path-aware prend le dessus s'il y a des dossiers
    folder.KIND: file_explorer.KIND,       # fallback ; idem
}

# Kinds dont le parent se dérive PAR CHEMIN (préfixe) plutôt que par kind.
PATH_BASED_KINDS = {folder.KIND, file_editor.KIND}


def canonical_parent_id(state: CanvasState, kind: str) -> str | None:
    """Id du parent canonique d'un node de ce kind, cherché PAR KIND dans l'état
    courant (jamais via default_canvas() qui régénère des ids aléatoires)."""
    parent_kind = CANONICAL_PARENT_KIND.get(kind)
    if parent_kind is None:
        return None
    return next((n.id for n in state.nodes if n.kind == parent_kind), None)


def node_effective_path(node: Node) -> str | None:
    """Chemin effectif d'un node pour le parentage par préfixe.

    - `folder` -> son `path` ("" si racine) ;
    - `fileeditor` -> le DOSSIER de son fichier ouvert ("" si à la racine du repo,
      `None` si aucun fichier ouvert -> pas de parentage par chemin) ;
    - autres -> `None` (parentage par kind)."""
    if node.kind == folder.KIND:
        return node.path or ""
    if node.kind == file_editor.KIND:
        editor = next(
            (c for c in iter_components(node.root) if isinstance(c, EditorComponent)),
            None,
        )
        if editor is None or not editor.file_path:
            return None
        segs = [p for p in editor.file_path.split("/") if p]
        return "/".join(segs[:-1])  # dossier du fichier ("" si à la racine)
    return None


def _path_candidates(state: CanvasState, exclude: Node | None = None) -> list[tuple[str, str]]:
    """Candidats parents path-aware : l'explorateur (path "") + les nodes dossier."""
    cands: list[tuple[str, str]] = []
    explorer = next((n for n in state.nodes if n.kind == file_explorer.KIND), None)
    if explorer is not None:
        cands.append(("", explorer.id))
    for n in state.nodes:
        if n.kind == folder.KIND and n is not exclude and n.path is not None:
            cands.append((n.path, n.id))
    return cands


def derive_source_id(state: CanvasState, node: Node) -> str | None:
    """Parent dérivé d'un node : par CHEMIN (folder/fileeditor) sinon par KIND.
    Utilisé par create_node (sans override) et par reconcile_source_links."""
    if node.kind == kernel.KIND:
        return None
    if node.kind in PATH_BASED_KINDS:
        ep = node_effective_path(node)
        if ep is None:  # éditeur pas encore ouvert -> fallback par kind (explorateur)
            return canonical_parent_id(state, node.kind)
        pid = longest_prefix_id(
            ep, _path_candidates(state, exclude=node), strict=(node.kind == folder.KIND)
        )
        return pid if pid is not None else canonical_parent_id(state, node.kind)
    return canonical_parent_id(state, node.kind)


def reconcile_source_links(state: CanvasState) -> CanvasState:
    """Repose les liens parent. Idempotent, déterministe. Brique G :
    - kinds path-aware (folder/fileeditor) : parent par plus-long-préfixe de chemin ;
    - kinds par kind : réparés si ABSENTS/CASSÉS *ou* si le parent courant est du
      MAUVAIS kind (migration — ex. chat/explorateur encore reliés au kernel après
      l'ajout de la node git)."""
    by_id = {n.id: n for n in state.nodes}
    for node in state.nodes:
        if node.kind == kernel.KIND:
            node.source_id = None
        elif node.kind in PATH_BASED_KINDS:
            node.source_id = derive_source_id(state, node)
        else:
            expected = CANONICAL_PARENT_KIND.get(node.kind)
            current = by_id.get(node.source_id) if node.source_id else None
            dangling = node.source_id is None or node.source_id not in by_id
            wrong_kind = (
                current is not None and expected is not None and current.kind != expected
            )
            if dangling or wrong_kind:
                node.source_id = canonical_parent_id(state, node.kind)
    return state


def reconcile_constraints(state: CanvasState) -> CanvasState:
    """Réimpose les contraintes intrinsèques au kind (movable / resizable /
    max_*) sur les nodes chargés. Ces contraintes ne doivent jamais provenir du
    JSON persisté : sinon un vieux canvas.json (écrit avant ces champs) rendrait
    p.ex. le kernel déplaçable via les défauts permissifs du modèle.

    Le node `folder` est paramétré (path) : on réimpose ses contraintes via un
    template construit avec son propre path."""
    for node in state.nodes:
        builder = NODE_BUILDERS.get(node.kind)
        if builder is None:
            continue
        tmpl = builder(path=node.path or "") if node.kind == folder.KIND else builder()
        node.movable = tmpl.movable
        node.resizable = tmpl.resizable
        node.configurable = tmpl.configurable
        node.max_w = tmpl.max_w
        node.max_h = tmpl.max_h
    return state


def default_canvas() -> CanvasState:
    """Canvas initial : kernel (racine) -> git -> { chat, explorateur }.
    Le kernel reste figé à (0,0) ; git en dessous, chat et explorateur plus bas."""
    k = kernel.build_kernel_node()
    g = gitbranch.build_gitbranch_node()
    g.source_id = k.id  # git pend au kernel
    e = file_explorer.build_file_explorer_node(x=300.0, y=240.0)
    e.source_id = g.id  # l'explorateur pend à git
    c = chat.build_chat_node(x=-440.0, y=240.0)
    c.source_id = g.id  # le chat pend aussi à git
    return CanvasState(nodes=[k, g, e, c])
