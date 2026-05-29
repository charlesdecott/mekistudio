from __future__ import annotations

import uuid

from pydantic import BaseModel, Field


def new_id() -> str:
    """Identifiant court et unique pour un composant."""
    return uuid.uuid4().hex


class ComponentBase(BaseModel):
    """Socle commun à tous les composants : un id stable.

    Le champ `type` (discriminant de l'union) est porté par chaque composant
    concret, pas ici — sinon Pydantic ne pourrait pas distinguer les classes.
    """

    id: str = Field(default_factory=new_id)
