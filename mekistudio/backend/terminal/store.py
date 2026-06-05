"""Persistance d'un terminal : scrollback.txt (le tampon, écrit atomiquement) +
meta.json (shell, cols/rows, created). Tolérant à un fichier absent/corrompu (jamais
d'exception → défauts). Le PTY lui-même ne survit pas à un restart serveur ; seul le
scrollback texte est rejoué au reattach (voir spec §6)."""
from __future__ import annotations

import json
import time
from pathlib import Path


def _now_ms() -> int:
    return int(time.time() * 1000)


class TerminalStore:
    def __init__(self, root: Path, terminal_id: str) -> None:
        self._dir = Path(root) / ".mekistudio" / "terminals" / terminal_id
        self._scrollback = self._dir / "scrollback.txt"
        self._meta = self._dir / "meta.json"
        self._tid = terminal_id

    @property
    def terminal_id(self) -> str:
        return self._tid

    # --- scrollback ---
    def load_scrollback(self) -> str:
        # newline="" : AUCUNE traduction de saut de ligne — le scrollback PTY contient
        # des \r\n bruts (séquences ANSI/curseur) qu'il faut préserver à l'octet près.
        try:
            with self._scrollback.open("r", encoding="utf-8", newline="") as fh:
                return fh.read()
        except (OSError, UnicodeDecodeError):
            return ""

    def save_scrollback(self, text: str) -> None:
        self._write_atomic(self._scrollback, text)

    # --- meta ---
    def meta(self) -> dict:
        try:
            data = json.loads(self._meta.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                return data
        except (OSError, json.JSONDecodeError):
            pass
        return {"id": self._tid, "shell": "powershell", "cols": 80, "rows": 24,
                "created_at_ms": _now_ms()}

    def save_meta(self, meta: dict) -> None:
        self._write_atomic(self._meta, json.dumps(meta, ensure_ascii=False, indent=2))

    # --- écriture atomique (tmp du même dossier + replace) ---
    def _write_atomic(self, path: Path, text: str) -> None:
        self._dir.mkdir(parents=True, exist_ok=True)
        tmp = path.with_name(path.name + ".tmp")
        # newline="" : pas de traduction \n -> \r\n (sinon le scrollback PTY est corrompu).
        with tmp.open("w", encoding="utf-8", newline="") as fh:
            fh.write(text)
        tmp.replace(path)  # atomique (POSIX & Windows)
