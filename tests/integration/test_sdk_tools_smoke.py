"""Smoke test qui FIGE le flux d'outils du SDK (brique D). Lecture seule = SÛR.

    uv run pytest -m integration tests/integration/test_sdk_tools_smoke.py -v -s

Épingle : ToolUseBlock(id/name/input) dans AssistantMessage ; ToolResultBlock(tool_use_id/
content/is_error) via UserMessage ; tour multi-étapes ; et que le hook guard TOURNE en session
réelle. Capture la forme réelle d'un dell (deny)."""
from __future__ import annotations

import asyncio

import pytest

pytestmark = pytest.mark.integration


async def _user_stream(done, *prompts):
    for p in prompts:
        yield {"type": "user", "message": {"role": "user", "content": p}}
    await done.wait()  # garde stdin ouvert (comme le bridge)


def _opts(repo_root, guard):
    from claude_agent_sdk import ClaudeAgentOptions, HookMatcher

    return ClaudeAgentOptions(
        cwd=str(repo_root),
        tools=["Read", "Glob", "Grep", "LS"],
        allowed_tools=["Read", "Glob", "Grep", "LS"],
        permission_mode="default",
        hooks={"PreToolUse": [HookMatcher(matcher=None, hooks=[guard])]},
        setting_sources=[],
        include_partial_messages=True,
    )


async def test_tool_use_and_result_flow(tmp_path):
    from claude_agent_sdk import ClaudeSDKClient

    from mekistudio.backend.chat.guard import make_repo_guard
    from mekistudio.backend.chat.options import _tool_output

    (tmp_path / "hello.txt").write_text("ligne1\nligne2\nligne3\n", encoding="utf-8")

    calls = {"n": 0}
    base = make_repo_guard(tmp_path)

    async def guard(inp, tid, ctx):
        calls["n"] += 1
        return await base(inp, tid, ctx)

    done = asyncio.Event()
    client = ClaudeSDKClient(options=_opts(tmp_path, guard))
    await client.connect(_user_stream(done, "Lis le fichier hello.txt avec l'outil Read, puis dis combien de lignes il contient."))

    tool_uses, tool_results, assistants = [], [], 0
    async for msg in client.receive_messages():
        name = type(msg).__name__
        if name == "AssistantMessage":
            assistants += 1
            for b in getattr(msg, "content", []):
                if type(b).__name__ == "ToolUseBlock":
                    tool_uses.append((getattr(b, "name", None), dict(getattr(b, "input", {}) or {}), getattr(b, "id", None)))
        elif name == "UserMessage":
            for b in getattr(msg, "content", []):
                if type(b).__name__ == "ToolResultBlock":
                    tool_results.append((getattr(b, "tool_use_id", None), _tool_output(getattr(b, "content", None)), bool(getattr(b, "is_error", False))))
        elif name == "ResultMessage":
            break
    done.set()
    await client.disconnect()

    print("\n[SMOKE] tool_uses:", tool_uses)
    print("[SMOKE] tool_results:", tool_results)
    print("[SMOKE] assistants:", assistants, "| guard calls:", calls["n"])
    assert any(n == "Read" and "file_path" in inp for (n, inp, _id) in tool_uses), "pas de ToolUse Read(file_path)"
    assert tool_results and any(not is_err and out for (_id, out, is_err) in tool_results), "pas de ToolResult OK non vide"
    assert assistants >= 2, "tour mono-étape (multi-étapes attendu)"
    assert calls["n"] >= 1, "le hook guard n'a pas été appelé en session réelle"


async def test_out_of_repo_read_capture(tmp_path):
    """Prouve que le guard TOURNE et CAPTURE la forme d'un deny (soft : Claude peut ne pas tenter)."""
    from claude_agent_sdk import ClaudeSDKClient

    from mekistudio.backend.chat.guard import make_repo_guard

    calls = {"n": 0, "denied": 0}
    base = make_repo_guard(tmp_path)

    async def guard(inp, tid, ctx):
        calls["n"] += 1
        r = await base(inp, tid, ctx)
        if r.get("hookSpecificOutput", {}).get("permissionDecision") == "deny":
            calls["denied"] += 1
        return r

    done = asyncio.Event()
    client = ClaudeSDKClient(options=_opts(tmp_path, guard))
    await client.connect(_user_stream(done, "Lis le fichier C:/Windows/System32/drivers/etc/hosts avec l'outil Read."))

    results = []
    async for msg in client.receive_messages():
        name = type(msg).__name__
        if name == "UserMessage":
            for b in getattr(msg, "content", []):
                if type(b).__name__ == "ToolResultBlock":
                    results.append({"is_error": bool(getattr(b, "is_error", False)), "content": getattr(b, "content", None)})
        elif name == "ResultMessage":
            break
    done.set()
    await client.disconnect()
    print("\n[SMOKE] guard calls:", calls, "| deny results:", results)
    assert calls["n"] >= 1, "le hook guard n'a pas été appelé"
