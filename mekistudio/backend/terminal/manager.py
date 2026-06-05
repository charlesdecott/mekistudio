"""Registre des TerminalBridge par terminal_id (dans app.state). Création paresseuse
(+ start qui spawn le PTY), arrêt propre au shutdown du serveur. Calque de ChatManager."""
from __future__ import annotations

from pathlib import Path

from mekistudio.backend.terminal.bridge import TerminalBridge
from mekistudio.backend.terminal.store import TerminalStore


class TerminalManager:
    def __init__(self, repo_root: Path) -> None:
        self._root = Path(repo_root)
        self._bridges: dict[str, TerminalBridge] = {}

    async def get_or_create(self, terminal_id: str) -> TerminalBridge:
        bridge = self._bridges.get(terminal_id)
        if bridge is None:
            store = TerminalStore(self._root, terminal_id)
            bridge = TerminalBridge(terminal_id, store, repo_root=self._root)
            await bridge.start()
            self._bridges[terminal_id] = bridge
        return bridge

    async def shutdown(self) -> None:
        for bridge in list(self._bridges.values()):
            await bridge.shutdown()
        self._bridges.clear()
