"""Isole l'import du SDK Claude + l'adaptateur réel SDK -> protocole normalisé du bridge.

Le bridge ne dépend QUE d'events normalisés `{"kind": "init"|"message_start"|"delta"|
"assistant"|"tool_result"|"result"}`. Tout le parsing des types SDK vit ici (figé par le smoke).
Brique D : outils LECTURE SEULE, confinés au repo par un hook PreToolUse (guard.py)."""
from __future__ import annotations

from pathlib import Path
from typing import Any, AsyncIterator

from mekistudio.backend.chat.store import ConversationStore

READ_ONLY_TOOLS = ["Read", "Glob", "Grep", "LS"]


def build_options(repo_root: Path, store: ConversationStore) -> Any:
    """ClaudeAgentOptions : outils LECTURE SEULE, confinés au repo (hook PreToolUse), streaming.
    `allowed_tools` auto-approuve l'in-repo (zéro popup) ; le hook bloque l'hors-repo (il tourne
    AVANT les règles de permission). `cwd=repo_root` borne les patterns relatifs (obligatoire)."""
    from claude_agent_sdk import ClaudeAgentOptions, HookMatcher

    from mekistudio.backend.chat.guard import make_repo_guard

    root = Path(repo_root) if repo_root is not None else Path.cwd()  # None -> cwd (tests faux client)
    return ClaudeAgentOptions(
        cwd=str(root),
        tools=READ_ONLY_TOOLS,
        allowed_tools=READ_ONLY_TOOLS,
        permission_mode="default",
        hooks={"PreToolUse": [HookMatcher(matcher=None, hooks=[make_repo_guard(root)])]},
        setting_sources=[],  # isole des settings utilisateur/repo (confirmé par le smoke)
        include_partial_messages=True,
        resume=store.meta().get("claude_session_id"),
    )


def _tool_output(content) -> str:
    """ToolResultBlock.content peut être str | list[dict] | None -> toujours str (tronqué)."""
    if content is None:
        return ""
    if isinstance(content, str):
        return content[:4000]
    return "".join(b.get("text", "") for b in content if isinstance(b, dict))[:4000]


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
                content = getattr(msg, "content", []) or []
                text = "".join(getattr(b, "text", "") for b in content if type(b).__name__ == "TextBlock")
                tools = [
                    {"id": getattr(b, "id", ""), "name": getattr(b, "name", ""), "input": getattr(b, "input", {}) or {}}
                    for b in content
                    if type(b).__name__ == "ToolUseBlock"
                ]
                yield {"kind": "assistant", "text": text, "tools": tools}
            elif name == "UserMessage":
                for b in getattr(msg, "content", []) or []:
                    if type(b).__name__ == "ToolResultBlock":
                        yield {
                            "kind": "tool_result",
                            "id": getattr(b, "tool_use_id", ""),
                            "output": _tool_output(getattr(b, "content", None)),
                            "is_error": bool(getattr(b, "is_error", False)),
                        }
            elif name == "ResultMessage":
                yield {"kind": "result", "subtype": getattr(msg, "subtype", None), "session_id": getattr(msg, "session_id", None)}

    async def interrupt(self) -> None:
        await self._c.interrupt()

    async def disconnect(self) -> None:
        await self._c.disconnect()


def default_client_factory(options: Any) -> _SdkClient:
    return _SdkClient(options)
