"""Isole l'import du SDK Claude + l'adaptateur réel SDK -> protocole normalisé du bridge.

Le bridge ne dépend QUE d'events normalisés `{"kind": "init"|"message_start"|"delta"|
"assistant"|"tool_result"|"result"}`. Tout le parsing des types SDK vit ici (figé par le smoke).
Brique D : outils LECTURE SEULE, confinés au repo par un hook PreToolUse (guard.py)."""
from __future__ import annotations

from pathlib import Path
from typing import Any, AsyncIterator

from mekistudio.backend.chat.store import ConversationStore

READ_ONLY_TOOLS = ["Read", "Glob", "Grep", "LS"]


def make_hook_emitter(name: str, on_hook):
    """Hook 'émetteur' : signale le hook au bridge via on_hook(name, data), sans rien bloquer.
    Renvoie {} (n'influence pas la permission) et NE LÈVE JAMAIS. Même mécanisme HookMatcher que
    le guard (prouvé en brique D)."""
    async def emit(input_data, tool_use_id, context):
        try:
            if on_hook is not None:
                on_hook(name, input_data or {})
        except Exception:
            pass
        return {}

    return emit


def build_options(repo_root: Path, store: ConversationStore, on_hook=None) -> Any:
    """ClaudeAgentOptions : outils LECTURE SEULE confinés (hook PreToolUse), streaming, + hooks
    émetteurs (brique F) qui signalent les hooks au bridge via on_hook (transient, non persisté)."""
    from claude_agent_sdk import ClaudeAgentOptions, HookMatcher

    from mekistudio.backend.chat.guard import make_repo_guard

    root = Path(repo_root) if repo_root is not None else Path.cwd()
    # PreToolUse : le guard d'ABORD (confinement, un deny gagne), puis l'émetteur (visibilité).
    hooks = {
        "PreToolUse": [HookMatcher(matcher=None, hooks=[make_repo_guard(root), make_hook_emitter("PreToolUse", on_hook)])],
    }
    for hk in ("PostToolUse", "Stop", "Notification", "UserPromptSubmit", "SubagentStop", "PreCompact"):
        hooks[hk] = [HookMatcher(matcher=None, hooks=[make_hook_emitter(hk, on_hook)])]
    return ClaudeAgentOptions(
        cwd=str(root),
        tools=READ_ONLY_TOOLS,
        allowed_tools=READ_ONLY_TOOLS,
        permission_mode="default",
        hooks=hooks,
        setting_sources=[],
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
                elif t == "message_stop":
                    yield {"kind": "message_stop"}  # fin d'un GROUPE (peut contenir N AssistantMessage)
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
