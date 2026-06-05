from __future__ import annotations

import asyncio

import pytest

winpty = pytest.importorskip("winpty")  # PTY natif Windows ; skip propre si absent

from mekistudio.backend.terminal.bridge import TerminalBridge
from mekistudio.backend.terminal.manager import TerminalManager
from mekistudio.backend.terminal.store import TerminalStore


async def _drain_until(queue: asyncio.Queue, needle: str, timeout: float = 12.0) -> str:
    """Draine la queue en accumulant les `output` jusqu'à voir `needle` (ou timeout)."""
    buf = ""
    loop = asyncio.get_running_loop()
    end = loop.time() + timeout
    while loop.time() < end:
        remaining = end - loop.time()
        try:
            ev = await asyncio.wait_for(queue.get(), timeout=remaining)
        except asyncio.TimeoutError:
            break
        if ev.get("type") == "output":
            buf += ev["data"]
            if needle in buf:
                return buf
    return buf


async def test_bridge_spawns_streams_and_persists(tmp_path):
    store = TerminalStore(tmp_path, "t1")
    bridge = TerminalBridge("t1", store, repo_root=tmp_path)
    await bridge.start()
    assert bridge.state == "running"
    q: asyncio.Queue = asyncio.Queue(maxsize=1000)
    await bridge.attach(q, 0)
    bridge.write("Write-Output meki-smoke\r\n")
    buf = await _drain_until(q, "meki-smoke")
    assert "meki-smoke" in buf
    bridge.resize(100, 30)  # ne lève pas
    await bridge.shutdown()
    # le scrollback a été persisté (flush au shutdown)
    assert "meki-smoke" in store.load_scrollback()


async def test_bridge_attach_replays_ring(tmp_path):
    store = TerminalStore(tmp_path, "t2")
    bridge = TerminalBridge("t2", store, repo_root=tmp_path)
    await bridge.start()
    q1: asyncio.Queue = asyncio.Queue(maxsize=1000)
    await bridge.attach(q1, 0)
    bridge.write("Write-Output replay-me\r\n")
    await _drain_until(q1, "replay-me")
    # une 2e attache (since_seq=0) rejoue tout le scrollback déjà produit
    q2: asyncio.Queue = asyncio.Queue(maxsize=1000)
    await bridge.attach(q2, 0)
    buf = await _drain_until(q2, "replay-me", timeout=3.0)
    assert "replay-me" in buf
    await bridge.shutdown()


async def test_manager_get_or_create_same_bridge(tmp_path):
    mgr = TerminalManager(tmp_path)
    b1 = await mgr.get_or_create("x")
    b2 = await mgr.get_or_create("x")
    assert b1 is b2
    await mgr.shutdown()
