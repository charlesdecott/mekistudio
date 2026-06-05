"""TerminalBridge — moteur détaché d'une session terminal (1 par terminal_id, dans
app.state). Possède le process PTY (pywinpty) et relaie sa sortie aux abonnés WebSocket.

Modèle de concurrence : un SEUL thread fait du bloquant (`PtyProcess.read`) et ne mute
RIEN partagé — il poste les chunks vers la boucle asyncio via `call_soon_threadsafe`.
Tout l'état (ring, abonnés, persistance, write, resize) est muté SUR la boucle →
mono-thread, pas de verrou. La déconnexion du WS NE détruit pas le bridge (modèle
« screen », comme le chat). `PtyProcess.read()` rend un `str` décodé incrémentalement
(UTF-8 multi-octets à cheval géré) → on transporte le `str` tel quel (pas de base64)."""
from __future__ import annotations

import asyncio
import threading
import time
from typing import Callable

from mekistudio.backend.terminal.options import build_spawn
from mekistudio.backend.terminal.ring import ScrollbackRing
from mekistudio.backend.terminal.store import TerminalStore

READ_SIZE = 4096
FLUSH_INTERVAL = 1.0  # s : persistance disque débouncée (scrollback borné -> écriture brève)

SpawnFactory = Callable[[object], dict]


class TerminalBridge:
    def __init__(self, terminal_id: str, store: TerminalStore, repo_root=None,
                 spawn_factory: SpawnFactory | None = None) -> None:
        self._tid = terminal_id
        self._store = store
        self._repo_root = repo_root
        self._spawn_factory = spawn_factory or build_spawn
        self._ring = ScrollbackRing()
        self._subscribers: set[asyncio.Queue] = set()
        self._drop_events: dict = {}  # queue -> asyncio.Event, signalé sur QueueFull
        self._pty = None
        self._reader: threading.Thread | None = None
        self._loop: asyncio.AbstractEventLoop | None = None
        self._alive = False
        self._state = "idle"  # idle | running | error | exited
        self._error_message: str | None = None
        self._cols = 80
        self._rows = 24
        self._dirty = False
        self._last_flush = 0.0
        self._closed = False

    @property
    def state(self) -> str:
        return self._state

    # --- cycle de vie ---
    async def start(self) -> None:
        self._loop = asyncio.get_running_loop()
        # Rejoue l'historique persisté (survit à un restart serveur ; le PTY, lui, est neuf).
        prev = self._store.load_scrollback()
        if prev:
            self._ring.load(prev)
        meta = self._store.meta()
        self._cols = int(meta.get("cols") or 80)
        self._rows = int(meta.get("rows") or 24)
        try:
            self._spawn()
        except Exception as exc:  # pywinpty absent / shell introuvable -> dégradé, pas d'exception
            self._state = "error"
            self._error_message = str(exc)
            self._append_synthetic(f"\r\n[terminal indisponible : {exc}]\r\n")

    def _spawn(self) -> None:
        from winpty import PtyProcess  # import ici : un échec reste local (état error)

        spec = self._spawn_factory(self._repo_root)
        self._pty = PtyProcess.spawn(
            spec["argv"], cwd=spec.get("cwd"), env=spec.get("env"),
            dimensions=(self._rows, self._cols),
        )
        self._alive = True
        self._state = "running"
        self._reader = threading.Thread(target=self._read_loop, args=(self._pty,),
                                        name=f"pty-{self._tid}", daemon=True)
        self._reader.start()

    # --- THREAD lecteur : seul bloquant ; ne mute rien partagé (poste vers la boucle) ---
    def _read_loop(self, pty) -> None:
        while True:
            try:
                data = pty.read(READ_SIZE)
            except EOFError:
                self._post(self._on_exit, _exit_code(pty))
                return
            except Exception:
                self._post(self._on_exit, None)
                return
            if data:
                self._post(self._on_output, data)
            elif not pty.isalive():
                self._post(self._on_exit, _exit_code(pty))
                return

    def _post(self, fn, *args) -> None:
        loop = self._loop
        if loop is not None and not loop.is_closed():
            try:
                loop.call_soon_threadsafe(fn, *args)
            except RuntimeError:
                pass  # boucle en cours d'arrêt

    # --- callbacks SUR la boucle ---
    def _on_output(self, data: str) -> None:
        self._broadcast(self._ring.append(data))
        self._schedule_flush()

    def _on_exit(self, code) -> None:
        self._alive = False
        self._state = "exited"
        self._broadcast({"type": "exit", "code": code})
        self._flush_now()

    def _append_synthetic(self, text: str) -> None:
        """Sortie synthétique (message d'erreur) injectée dans le scrollback."""
        self._broadcast(self._ring.append(text))
        self._schedule_flush()

    def _broadcast(self, ev: dict) -> None:
        for q in list(self._subscribers):
            try:
                q.put_nowait(ev)
            except asyncio.QueueFull:
                # Socket trop lent : désabonner + signaler la fermeture (le client se reconnecte
                # et rattrape par replay). Calque D17 du chat.
                self._subscribers.discard(q)
                d = self._drop_events.pop(q, None)
                if d is not None:
                    d.set()

    # --- persistance débouncée ---
    def _schedule_flush(self) -> None:
        self._dirty = True
        if time.monotonic() - self._last_flush >= FLUSH_INTERVAL:
            self._flush_now()

    def _flush_now(self) -> None:
        if not self._dirty:
            return
        try:
            self._store.save_scrollback(self._ring.text())
            self._store.save_meta({"id": self._tid, "shell": "powershell",
                                   "cols": self._cols, "rows": self._rows})
        except OSError:
            pass
        self._dirty = False
        self._last_flush = time.monotonic()

    # --- reattach (calque chat) ---
    async def attach(self, queue: asyncio.Queue, since_seq: int,
                     on_drop: asyncio.Event | None = None) -> None:
        # Shell frais si la session précédente s'est terminée (`exit` tapé) : on relance au
        # prochain attach (reload) plutôt que de laisser un terminal mort. Synchrone -> pas de
        # course entre deux attach concurrents (spawn pose alive=True avant tout await).
        if not self._closed and not self._alive and self._state == "exited":
            try:
                self._spawn()
            except Exception as exc:
                self._state = "error"
                self._append_synthetic(f"\r\n[relance impossible : {exc}]\r\n")
        # Replay (put bloquant hors section critique) puis abonnement live.
        for ev in self._ring.since(since_seq):
            await queue.put(ev)
        queue.put_nowait({"type": "attached"})
        self._subscribers.add(queue)
        if on_drop is not None:
            self._drop_events[queue] = on_drop

    def unsubscribe(self, queue: asyncio.Queue) -> None:
        self._subscribers.discard(queue)
        self._drop_events.pop(queue, None)

    # --- entrées clavier / redimension ---
    def write(self, data: str) -> None:
        if self._pty is not None and self._alive:
            try:
                self._pty.write(data)
            except Exception:
                pass

    def resize(self, cols: int, rows: int) -> None:
        self._cols = int(cols)
        self._rows = int(rows)
        self._dirty = True
        if self._pty is not None and self._alive:
            try:
                self._pty.setwinsize(self._rows, self._cols)
            except Exception:
                pass

    async def shutdown(self) -> None:
        self._closed = True
        self._flush_now()
        if self._pty is not None:
            try:
                self._pty.terminate(force=True)
            except Exception:
                pass
        self._alive = False


def _exit_code(pty) -> int | None:
    try:
        return pty.exitstatus
    except Exception:
        return None
