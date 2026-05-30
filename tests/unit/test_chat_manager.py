import asyncio

from mekistudio.backend.chat.manager import ChatManager
from mekistudio.backend.chat.store import ConversationStore


class FakeClient:
    def __init__(self, *_):
        self._stream = None

    async def connect(self, stream):
        self._stream = stream

    async def receive(self):
        if False:
            yield {}
        await asyncio.sleep(3600)  # ne produit rien

    async def interrupt(self):
        ...

    async def disconnect(self):
        ...


async def test_get_or_create_idempotent_and_clear(tmp_path):
    mgr = ChatManager(tmp_path, client_factory=lambda o: FakeClient())
    b1 = await mgr.get_or_create("conv-A")
    b2 = await mgr.get_or_create("conv-A")
    assert b1 is b2
    new_id = await mgr.clear("conv-A")
    assert new_id != "conv-A"
    b3 = await mgr.get_or_create(new_id)
    assert b3 is not b1
    await mgr.shutdown()


async def test_resume_passed_when_meta_has_session(tmp_path):
    captured = {}

    def factory(options):
        captured["resume"] = getattr(options, "resume", "MISSING")
        return FakeClient()

    s = ConversationStore(tmp_path, "conv-R")
    await s.set_session_id("sid-xyz")
    mgr = ChatManager(tmp_path, client_factory=factory)
    await mgr.get_or_create("conv-R")
    assert captured["resume"] == "sid-xyz"  # build_options lit meta.claude_session_id
    await mgr.shutdown()
