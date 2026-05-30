"""Smoke RÉEL (API Claude) : quels hooks émettent en session lecture seule + forme de leur data.
Pinne l'API hooks de la brique F (comme le smoke outils pinne l'API tool). Déselectionné par défaut
(`-m integration`). Documente le réel via les prints ; assertions minimales sur ce qu'on garantit."""
from __future__ import annotations

import asyncio
from pathlib import Path

import pytest

from mekistudio.backend.chat.bridge import ChatBridge
from mekistudio.backend.chat.options import default_client_factory
from mekistudio.backend.chat.store import ConversationStore

REPO = Path(__file__).resolve().parents[2]

pytestmark = pytest.mark.integration


async def _run(tmp_path):
    store = ConversationStore(tmp_path, "hooks")
    seen_hooks = []  # (name, keys)
    bridge = ChatBridge("hooks", store, default_client_factory, repo_root=REPO)
    # intercepte on_hook : enregistre nom + clés de data
    orig_emit = bridge._emit_hook

    def spy(name, data):
        seen_hooks.append((name, sorted((data or {}).keys())))
        orig_emit(name, data)

    bridge._emit_hook = spy
    await bridge.start()
    assert bridge.state != "error", bridge._error_message
    q = asyncio.Queue()
    await bridge.attach(q, 0)
    await bridge.submit_prompt("Avec l'outil Read, lis le fichier CLAUDE.md. Puis réponds en un mot.")
    for _ in range(240):
        await asyncio.sleep(0.5)
        if bridge.state == "idle":
            break
    await bridge.shutdown()
    return seen_hooks


def test_hooks_api_shapes(tmp_path):
    seen = asyncio.run(_run(tmp_path))
    print("\n=== HOOKS REÇUS (name, clés de data) ===")
    for name, keys in seen:
        print(f"  {name}: {keys}")
    names = {n for n, _ in seen}
    # Ce qu'on GARANTIT : au moins PreToolUse émet (l'émetteur tourne à côté du guard).
    assert "PreToolUse" in names, f"hooks vus: {names}"
    # Documente (sans bloquer) si PostToolUse / Stop émettent réellement.
    print("PostToolUse émis:", "PostToolUse" in names, "| Stop émis:", "Stop" in names)
