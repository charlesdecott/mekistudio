"""Builders d'events du chat : records DURABLES (persistés, reçoivent un `seq` du store)
et events TRANSIENTS (wire only, jamais persistés). Source unique du vocabulaire d'events
partagé entre le bridge, le router WS et le front (chat-model.js / chat-view.js)."""
from __future__ import annotations

import time

from mekistudio.backend.components.base import new_id  # ré-export (id stable, même helper)

__all__ = ["new_id", "now_ms", "DURABLE_TYPES"]

DURABLE_TYPES = {"user_message", "assistant_message", "session", "error"}


def now_ms() -> int:
    return int(time.time() * 1000)


# --- durables (persistés ; le store assigne le seq) ---
def user_message(text: str) -> dict:
    return {"type": "user_message", "ts": now_ms(), "text": text}


def assistant_message(text: str, status: str) -> dict:
    return {"type": "assistant_message", "ts": now_ms(), "text": text, "status": status}


def session_event(claude_session_id: str) -> dict:
    return {"type": "session", "ts": now_ms(), "claude_session_id": claude_session_id}


def error_event(message: str) -> dict:
    return {"type": "error", "ts": now_ms(), "message": message}


# --- transients (wire only, pas de seq durable) ---
def message_start(message_id: str) -> dict:
    return {"type": "message_start", "message_id": message_id}


def text_delta(message_id: str, text: str) -> dict:
    return {"type": "text_delta", "message_id": message_id, "text": text}


def message_stop(message_id: str, seq: int, status: str) -> dict:
    return {"type": "message_stop", "message_id": message_id, "seq": seq, "status": status}


def queued(items: list[dict]) -> dict:
    return {"type": "queued", "items": items}


def cleared(conversation_id: str) -> dict:
    return {"type": "cleared", "conversation_id": conversation_id}
