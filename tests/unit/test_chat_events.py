from mekistudio.backend.chat import events


def test_durable_and_transient_builders():
    um = events.user_message("salut")
    assert um == {"type": "user_message", "ts": um["ts"], "text": "salut"} and isinstance(um["ts"], int)
    am = events.assistant_message("ok", "success")
    assert am["type"] == "assistant_message" and am["text"] == "ok" and am["status"] == "success"
    assert events.session_event("sid")["claude_session_id"] == "sid"
    assert events.error_event("boom")["message"] == "boom"
    assert events.message_start("m1") == {"type": "message_start", "message_id": "m1"}
    assert events.text_delta("m1", "x") == {"type": "text_delta", "message_id": "m1", "text": "x"}
    assert events.message_stop("m1", 3, "success") == {"type": "message_stop", "message_id": "m1", "seq": 3, "status": "success"}
    assert events.queued([{"index": 0, "text": "a"}])["items"][0]["text"] == "a"
    assert events.cleared("c2") == {"type": "cleared", "conversation_id": "c2"}
    assert events.DURABLE_TYPES == {"user_message", "assistant_message", "session", "error"}
    assert isinstance(events.new_id(), str) and len(events.new_id()) > 0
