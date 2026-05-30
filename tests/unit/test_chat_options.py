from mekistudio.backend.chat.options import make_hook_emitter


async def test_hook_emitter_calls_on_hook_and_allows():
    seen = []
    emit = make_hook_emitter("PostToolUse", lambda name, data: seen.append((name, data)))
    out = await emit({"tool_name": "Read", "tool_input": {"file_path": "a.py"}}, "tid", None)
    assert out == {}  # n'influence pas la permission
    assert seen == [("PostToolUse", {"tool_name": "Read", "tool_input": {"file_path": "a.py"}})]


async def test_hook_emitter_never_raises():
    def boom(name, data):
        raise RuntimeError("x")
    emit = make_hook_emitter("Stop", boom)
    assert await emit({}, "tid", None) == {}  # avale l'erreur


async def test_hook_emitter_tolerates_none_on_hook():
    emit = make_hook_emitter("Stop", None)
    assert await emit({}, "tid", None) == {}
