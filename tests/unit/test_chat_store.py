from mekistudio.backend.chat import events
from mekistudio.backend.chat.store import ConversationStore


async def test_append_seq_read_since_and_meta(tmp_path):
    s = ConversationStore(tmp_path, "c1")
    assert s.next_seq == 1
    r1 = await s.append(events.user_message("a"))
    r2 = await s.append(events.assistant_message("b", "success"))
    assert (r1["seq"], r2["seq"]) == (1, 2)
    assert s.next_seq == 3
    assert [r["text"] for r in await s.read_since(0)] == ["a", "b"]
    assert [r["seq"] for r in await s.read_since(1)] == [2]

    await s.set_session_id("sid-123")
    assert s.meta()["claude_session_id"] == "sid-123"

    # "restart" : un nouveau store sur le même dossier reprend le seq + la session
    s2 = ConversationStore(tmp_path, "c1")
    assert s2.next_seq == 3
    assert s2.meta()["claude_session_id"] == "sid-123"


async def test_tolerates_truncated_last_line(tmp_path):
    s = ConversationStore(tmp_path, "c2")
    await s.append(events.user_message("ok"))
    p = tmp_path / ".mekistudio" / "conversations" / "c2" / "messages.jsonl"
    with p.open("a", encoding="utf-8") as fh:
        fh.write('{"seq": 2, "type": "user_mess')  # ligne tronquée (crash simulé)
    s2 = ConversationStore(tmp_path, "c2")  # ne doit PAS lever
    assert s2.next_seq == 2
    assert [r["text"] for r in await s2.read_since(0)] == ["ok"]
