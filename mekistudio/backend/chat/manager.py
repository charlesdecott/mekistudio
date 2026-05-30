"""Registre des ChatBridge par conversation_id (dans app.state). Création paresseuse
(resume si meta connue), rotation au clear, arrêt propre au shutdown du serveur."""
from __future__ import annotations

from pathlib import Path

from mekistudio.backend.chat import events
from mekistudio.backend.chat.bridge import ChatBridge, default_client_factory
from mekistudio.backend.chat.store import ConversationStore


class ChatManager:
    def __init__(self, repo_root: Path, client_factory=default_client_factory) -> None:
        self._root = Path(repo_root)
        self._factory = client_factory
        self._bridges: dict[str, ChatBridge] = {}

    async def get_or_create(self, conversation_id: str) -> ChatBridge:
        bridge = self._bridges.get(conversation_id)
        if bridge is None:
            store = ConversationStore(self._root, conversation_id)
            bridge = ChatBridge(conversation_id, store, self._factory)
            await bridge.start()
            self._bridges[conversation_id] = bridge
        return bridge

    async def clear(self, old_id: str) -> str:
        bridge = self._bridges.pop(old_id, None)
        if bridge is not None:
            await bridge.shutdown()
        new_id = events.new_id()
        await self.get_or_create(new_id)
        return new_id

    async def shutdown(self) -> None:
        for bridge in list(self._bridges.values()):
            await bridge.shutdown()
        self._bridges.clear()
