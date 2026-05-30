"""Persistance d'une conversation : meta.json (autoritatif pour resume) + messages.jsonl
(append-only, source de vérité du `seq`). Tolérant à une dernière ligne tronquée (crash)."""
from __future__ import annotations

import asyncio
import json
from pathlib import Path

from mekistudio.backend.chat import events


class ConversationStore:
    def __init__(self, root: Path, conversation_id: str) -> None:
        self._dir = Path(root) / ".mekistudio" / "conversations" / conversation_id
        self._jsonl = self._dir / "messages.jsonl"
        self._meta = self._dir / "meta.json"
        self._cid = conversation_id
        self._lock = asyncio.Lock()
        self._next_seq = self._scan_next_seq()

    @property
    def conversation_id(self) -> str:
        return self._cid

    @property
    def next_seq(self) -> int:
        return self._next_seq

    def _scan_next_seq(self) -> int:
        last = 0
        if self._jsonl.exists():
            for line in self._jsonl.read_text(encoding="utf-8").splitlines():
                try:
                    last = max(last, int(json.loads(line)["seq"]))
                except (json.JSONDecodeError, KeyError, ValueError, TypeError):
                    continue  # dernière ligne tronquée -> ignorée
        return last + 1

    async def append(self, record: dict) -> dict:
        async with self._lock:
            stored = {"seq": self._next_seq, **record}
            self._dir.mkdir(parents=True, exist_ok=True)
            with self._jsonl.open("a", encoding="utf-8") as fh:
                fh.write(json.dumps(stored, ensure_ascii=False) + "\n")
            self._next_seq += 1
            return stored

    async def read_since(self, seq: int) -> list[dict]:
        if not self._jsonl.exists():
            return []
        out: list[dict] = []
        for line in self._jsonl.read_text(encoding="utf-8").splitlines():
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                continue
            if not isinstance(rec, dict):
                continue  # ligne JSON valide mais non-objet (ex. nombre nu) -> ignorée (#10)
            if int(rec.get("seq", 0)) > seq:
                out.append(rec)
        return out

    def meta(self) -> dict:
        if self._meta.exists():
            return json.loads(self._meta.read_text(encoding="utf-8"))
        return {"id": self._cid, "created_at_ms": events.now_ms(), "claude_session_id": None}

    async def set_session_id(self, claude_session_id: str) -> None:
        async with self._lock:
            self._dir.mkdir(parents=True, exist_ok=True)
            meta = self.meta()
            meta["claude_session_id"] = claude_session_id
            tmp = self._meta.with_suffix(".json.tmp")
            tmp.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
            tmp.replace(self._meta)  # atomique (POSIX & Windows)
