from __future__ import annotations

from mekistudio.backend.terminal.ring import ScrollbackRing


def test_append_assigns_increasing_seq_and_shape():
    ring = ScrollbackRing()
    a = ring.append("hello")
    b = ring.append("world")
    assert a == {"type": "output", "seq": 1, "data": "hello"}
    assert b["seq"] == 2 and b["data"] == "world"


def test_since_returns_only_newer_chunks():
    ring = ScrollbackRing()
    ring.append("a")  # seq 1
    ring.append("b")  # seq 2
    ring.append("c")  # seq 3
    out = ring.since(1)
    assert [o["seq"] for o in out] == [2, 3]
    assert [o["data"] for o in out] == ["b", "c"]
    assert ring.since(99) == []  # rien de plus récent


def test_text_concatenates_in_order():
    ring = ScrollbackRing()
    for s in ("foo", "bar", "baz"):
        ring.append(s)
    assert ring.text() == "foobarbaz"


def test_eviction_bounds_total_and_keeps_newest():
    ring = ScrollbackRing(cap_chars=10)
    for s in ("aaa", "bbb", "ccc", "ddd"):  # 12 chars total > cap
        ring.append(s)
    assert len(ring.text()) <= 10
    assert ring.text().endswith("ddd")     # le plus récent conservé
    assert "aaa" not in ring.text()        # le plus ancien évincé
    # le seq reste monotone après éviction (pas de réindexation)
    assert [o["seq"] for o in ring.since(0)] == [2, 3, 4]


def test_eviction_always_keeps_at_least_last_chunk():
    ring = ScrollbackRing(cap_chars=2)
    ring.append("a-very-long-single-chunk")  # > cap mais seul chunk -> conservé
    assert ring.text() == "a-very-long-single-chunk"


def test_load_seeds_ring_and_continues():
    ring = ScrollbackRing()
    ring.load("previous session log\n")
    assert ring.text() == "previous session log\n"
    assert ring.since(0)[0]["data"] == "previous session log\n"
    nxt = ring.append("live")
    assert nxt["seq"] == 2  # reprend après le chunk chargé (seq 1)


def test_load_truncates_to_cap_tail():
    ring = ScrollbackRing(cap_chars=5)
    ring.load("0123456789")  # 10 chars > cap 5 -> on garde la fin
    assert ring.text() == "56789"
