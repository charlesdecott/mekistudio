"""Backend du node terminal (brique I) : PTY PowerShell détaché + relay temps réel.

Calque le backend du chat (manager dans app.state, bridge détaché, store disque,
WebSocket attach/replay) — mais le bridge pilote un PTY (pywinpty) au lieu du SDK.
Modules : ring (tampon scrollback pur), store (persistance), bridge (PTY détaché),
manager (registre par terminal_id), options (résolution shell/cwd/env)."""
from __future__ import annotations
