from __future__ import annotations

from typing import Annotated, Literal, Union

from pydantic import Field

from mekistudio.backend.components.base import ComponentBase, new_id


class HeaderComponent(ComponentBase):
    """Titre de niveau 1 à 4 (rendu en h1..h4 côté front)."""

    type: Literal["header"] = "header"
    text: str
    level: int = Field(default=1, ge=1, le=4)


class LayoutComponent(ComponentBase):
    """Conteneur qui empile (`column`) ou aligne (`row`) ses enfants."""

    type: Literal["layout"] = "layout"
    direction: Literal["column", "row"] = "column"
    gap: int = 8
    children: list[Component] = Field(default_factory=list)


class NodeComponent(ComponentBase):
    """Cadre racine d'un node : la carte qui contient tout le reste."""

    type: Literal["node"] = "node"
    children: list[Component] = Field(default_factory=list)


class FileTreeComponent(ComponentBase):
    """Explorateur de fichiers (style VSCode). Point de montage seulement : le
    contenu de l'arbre n'est PAS dans l'état — le front le charge paresseusement
    via /api/fs au fur et à mesure des dépliages (le FS change, donc pas de cache
    dans canvas.json).

    `excludes` : noms de fichiers/dossiers masqués (config utilisateur, éditable
    via la modale de réglages). Le front les passe à /api/fs."""

    type: Literal["filetree"] = "filetree"
    root_path: str = ""  # racine relative au repo (posix) ; "" = racine du repo
    excludes: list[str] = Field(default_factory=lambda: ["__pycache__"])


class EditorComponent(ComponentBase):
    """Éditeur de fichier (CodeMirror côté front). Porte le chemin du fichier
    ouvert (relatif au repo, posix) ; le contenu est lu/écrit via /api/file."""

    type: Literal["editor"] = "editor"
    file_path: str = ""


class ChatComponent(ComponentBase):
    """Surface de chat (conversation Claude). Ne porte que l'identité de la
    conversation : les messages ne sont PAS dans canvas.json — ils vivent dans
    .mekistudio/conversations/<id>/ et se chargent via la WebSocket /ws/chat
    (comme le filetree via /api/fs). `conversation_id` est stable et persisté ;
    il tourne au clear (nouvelle session)."""

    type: Literal["chat"] = "chat"
    conversation_id: str = Field(default_factory=new_id)
    title: str = "chat"
    placeholder: str = "Écris à Claude…"
    # F3b : réglages de l'auto-spawn d'éditeurs (brique F3). ephemeral = aperçus TTL épinglables ;
    # capped = persistants plafonnés (FIFO) ; unlimited = persistants sans limite.
    spawn_mode: Literal["ephemeral", "capped", "unlimited"] = "ephemeral"
    spawn_ttl_min: int = Field(default=10, ge=1, le=1440)
    spawn_cap: int = Field(default=20, ge=1, le=200)


# Union discriminée : le champ `type` sélectionne la classe au parsing. C'est
# ce qui permet de (dé)sérialiser un arbre hétérogène sans perdre les types.
Component = Annotated[
    Union[
        NodeComponent,
        LayoutComponent,
        HeaderComponent,
        FileTreeComponent,
        EditorComponent,
        ChatComponent,
    ],
    Field(discriminator="type"),
]

# `from __future__ import annotations` => les annotations sont des chaînes ;
# on résout les références récursives (`children: list[Component]`) une fois
# l'union `Component` définie dans le module.
LayoutComponent.model_rebuild()
NodeComponent.model_rebuild()


def iter_components(component):
    """Parcourt en profondeur un composant et tous ses descendants."""
    yield component
    for child in getattr(component, "children", None) or []:
        yield from iter_components(child)
