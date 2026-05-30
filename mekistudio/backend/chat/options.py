"""Isole l'import du SDK Claude + l'adaptateur réel SDK -> protocole normalisé du bridge.

Le bridge ne dépend QUE d'events normalisés `{"kind": "init"|"message_start"|"delta"|
"assistant"|"result"}`. Tout le parsing des types SDK vit ici (figé par le smoke test, D14)."""
from __future__ import annotations

from typing import Any, AsyncIterator

from mekistudio.backend.chat.store import ConversationStore


def build_options(conversation_id: str, store: ConversationStore) -> Any:
    """ClaudeAgentOptions : outils OFF, streaming token-par-token, resume si connu.
    cwd non fixé -> hérite du cwd du process serveur (= racine repo quand `mekistudio serve`)."""
    from claude_agent_sdk import ClaudeAgentOptions

    return ClaudeAgentOptions(
        tools=[],  # outils OFF (built-in désactivés) -- PAS allowed_tools=[]
        permission_mode="dontAsk",
        include_partial_messages=True,
        resume=store.meta().get("claude_session_id"),
    )


class _SdkClient:
    """Adaptateur : ClaudeSDKClient (streaming-input) -> events normalisés du bridge."""

    def __init__(self, options: Any) -> None:
        from claude_agent_sdk import ClaudeSDKClient

        self._c = ClaudeSDKClient(options=options)

    async def connect(self, stream: AsyncIterator[dict]) -> None:
        await self._c.connect(stream)  # streaming-input : garde stdin ouvert (requis pour interrupt)

    async def receive(self):  # async generator
        async for msg in self._c.receive_messages():
            name = type(msg).__name__
            if name == "SystemMessage" and getattr(msg, "subtype", None) == "init":
                data = getattr(msg, "data", {}) or {}
                yield {"kind": "init", "session_id": data.get("session_id")}
            elif name == "StreamEvent":
                ev = getattr(msg, "event", {}) or {}
                t = ev.get("type")
                if t == "message_start":
                    yield {"kind": "message_start"}
                elif t == "content_block_delta" and ev.get("delta", {}).get("type") == "text_delta":
                    yield {"kind": "delta", "text": ev["delta"].get("text", "")}
            elif name == "AssistantMessage":
                text = "".join(
                    getattr(b, "text", "") for b in getattr(msg, "content", []) if type(b).__name__ == "TextBlock"
                )
                yield {"kind": "assistant", "text": text}
            elif name == "ResultMessage":
                yield {"kind": "result", "subtype": getattr(msg, "subtype", None), "session_id": getattr(msg, "session_id", None)}

    async def interrupt(self) -> None:
        await self._c.interrupt()

    async def disconnect(self) -> None:
        await self._c.disconnect()


def default_client_factory(options: Any) -> _SdkClient:
    return _SdkClient(options)
