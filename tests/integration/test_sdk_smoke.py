"""Smoke test qui FIGE l'API réelle du SDK installé (D14).

Lancer explicitement (exclu de la suite par défaut via le marker `integration`) :
    uv run pytest -m integration tests/integration/test_sdk_smoke.py -v -s

Nécessite la CLI `claude` installée + authentifiée (héritée de la session courante).
Reproduit le chemin EXACT du bridge : mode streaming-input via connect(async_iterable).
"""
from __future__ import annotations

import pytest

pytestmark = pytest.mark.integration


async def _user_stream(prompts: list[str]):
    for p in prompts:
        yield {"type": "user", "message": {"role": "user", "content": p}}


def _opts():
    from claude_agent_sdk import ClaudeAgentOptions

    return ClaudeAgentOptions(tools=[], permission_mode="dontAsk", include_partial_messages=True)


async def test_streaming_text_and_session_id():
    from claude_agent_sdk import ClaudeSDKClient

    client = ClaudeSDKClient(options=_opts())
    await client.connect(_user_stream(["Réponds exactement: bonjour"]))

    deltas: list[str] = []
    session_id = None
    saw_tool_use = False
    async for msg in client.receive_messages():
        name = type(msg).__name__
        if name == "SystemMessage" and getattr(msg, "subtype", None) == "init":
            data = getattr(msg, "data", {}) or {}
            session_id = data.get("session_id") or session_id
            print(f"\n[SMOKE] SystemMessage(init).data keys = {list(data.keys())}")
        elif name == "StreamEvent":
            ev = getattr(msg, "event", {}) or {}
            if ev.get("type") == "content_block_delta" and ev.get("delta", {}).get("type") == "text_delta":
                deltas.append(ev["delta"].get("text", ""))
        elif name == "AssistantMessage":
            for b in getattr(msg, "content", []):
                if type(b).__name__ == "ToolUseBlock":
                    saw_tool_use = True
        elif name == "ResultMessage":
            session_id = session_id or getattr(msg, "session_id", None)
            break
    await client.disconnect()

    print(f"[SMOKE] deltas joined = {''.join(deltas)!r}")
    print(f"[SMOKE] session_id = {session_id!r}")
    assert "".join(deltas).strip(), "aucun text_delta reçu"
    assert session_id, "aucun session_id"
    assert not saw_tool_use, "tools=[] devrait empêcher tout ToolUseBlock"


async def test_interrupt_returns_result_subtype():
    """FIGE le subtype renvoyé après interrupt() (attendu vers 'error_during_execution').

    CONTRAT confirmé : interrupt() exige que le flux d'entrée reste OUVERT. On utilise donc
    un générateur PERSISTANT (yield le prompt puis attend), exactement comme le bridge
    (`while True: await queue.get()`). Un générateur fini ferme stdin -> CLIConnectionError.
    """
    import asyncio

    from claude_agent_sdk import ClaudeSDKClient

    done = asyncio.Event()

    async def gen():
        yield {"type": "user", "message": {"role": "user", "content": "Compte lentement de 1 à 500, un nombre par ligne, sans rien d'autre."}}
        await done.wait()  # garde stdin ouvert (comme le bridge)

    client = ClaudeSDKClient(options=_opts())
    await client.connect(gen())

    subtype = None
    interrupted = False
    async for msg in client.receive_messages():
        name = type(msg).__name__
        if name == "StreamEvent" and not interrupted:
            ev = getattr(msg, "event", {}) or {}
            if ev.get("type") == "content_block_delta" and ev.get("delta", {}).get("type") == "text_delta":
                await client.interrupt()
                interrupted = True
        if name == "ResultMessage":
            subtype = getattr(msg, "subtype", None)
            break
    done.set()
    await client.disconnect()

    print(f"\n[SMOKE] subtype après interrupt = {subtype!r}")
    assert interrupted, "jamais reçu de text_delta à interrompre"
    assert subtype is not None
