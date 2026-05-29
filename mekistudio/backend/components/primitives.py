from __future__ import annotations

from typing import Annotated, Literal, Union

from pydantic import Field

from mekistudio.backend.components.base import ComponentBase


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
    dans canvas.json)."""

    type: Literal["filetree"] = "filetree"
    root_path: str = ""  # racine relative au repo (posix) ; "" = racine du repo


# Union discriminée : le champ `type` sélectionne la classe au parsing. C'est
# ce qui permet de (dé)sérialiser un arbre hétérogène sans perdre les types.
Component = Annotated[
    Union[NodeComponent, LayoutComponent, HeaderComponent, FileTreeComponent],
    Field(discriminator="type"),
]

# `from __future__ import annotations` => les annotations sont des chaînes ;
# on résout les références récursives (`children: list[Component]`) une fois
# l'union `Component` définie dans le module.
LayoutComponent.model_rebuild()
NodeComponent.model_rebuild()
