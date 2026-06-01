from __future__ import annotations

from mekistudio.backend.nodes.parenting import is_prefix, longest_prefix_id


def test_is_prefix_segment():
    assert is_prefix("docs", "docs/superpowers")
    assert is_prefix("docs/superpowers", "docs/superpowers")  # égalité incluse
    assert not is_prefix("doc", "docs")                       # pas un préfixe-segment
    assert is_prefix("", "docs/x")                            # racine préfixe tout
    assert is_prefix("", "")
    assert not is_prefix("docs/superpowers", "docs")          # plus long que la cible


def test_longest_prefix_editor_includes_equality():
    cand = [("", "EXP"), ("docs", "D"), ("docs/superpowers", "S")]
    # éditeur dont le dossier = "docs/superpowers" -> parent = S (égalité permise)
    assert longest_prefix_id("docs/superpowers", cand, strict=False) == "S"


def test_longest_prefix_folder_is_strict():
    cand = [("", "EXP"), ("docs", "D"), ("docs/superpowers", "S")]
    # dossier "docs/superpowers" -> parent = D (on exclut l'homonyme S)
    assert longest_prefix_id("docs/superpowers", cand, strict=True) == "D"


def test_longest_prefix_fallback_explorer():
    assert longest_prefix_id("a/b/c", [("", "EXP")], strict=True) == "EXP"


def test_longest_prefix_none_when_no_candidate():
    assert longest_prefix_id("a/b", [("x", "X")], strict=False) is None


def test_longest_prefix_tiebreak_deterministic():
    # deux candidats même path -> id le plus petit (déterministe)
    assert longest_prefix_id("docs/x", [("docs", "B"), ("docs", "A")], strict=True) == "A"
