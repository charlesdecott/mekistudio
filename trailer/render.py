#!/usr/bin/env python3
"""render.py — sert le projet en HTTP local et capture chaque frame du trailer via Playwright.

GÉNÉRIQUE : à copier tel quel dans <projet>/trailer/. Aucune adaptation nécessaire.

Déterministe : pour chaque frame, on appelle window.seekFrame(t) qui (1) positionne toute la
motion comme fonction pure de t et (2) recale les @keyframes CSS d'ambiance à currentTime=t.
=> frames frame-exactes, reproductibles, indépendantes des perfs machine.

Usage :
    python trailer/render.py              # toutes les frames -> frames/f%05d.png
    python trailer/render.py 30           # 30 premières frames (smoke)
    python trailer/render.py --at 16000   # UNE frame a t=16000 ms -> frames/at.png
    python trailer/render.py --at 8000,16000,31000   # plusieurs -> frames/at_<ms>.png

Prérequis : pip install playwright ; python -m playwright install chromium
"""
from __future__ import annotations

import functools
import http.server
import socketserver
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent          # racine du projet (sert toute l'arbo)
TRAILER = Path(__file__).resolve().parent
FRAMES = TRAILER / "frames"
W, H = 1920, 1080                                       # 1080p ; passer en 1280x720 pour aller + vite


def _serve() -> tuple[socketserver.TCPServer, int]:
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(ROOT))
    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.TCPServer(("127.0.0.1", 0), handler)
    httpd.RequestHandlerClass.log_message = lambda *a, **k: None
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, httpd.server_address[1]


def _new_page(p, port):
    b = p.chromium.launch(args=["--force-color-profile=srgb", "--hide-scrollbars",
                                "--disable-lcd-text"])
    pg = b.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
    pg.goto(f"http://127.0.0.1:{port}/trailer/trailer.html", wait_until="networkidle")
    pg.wait_for_function("typeof window.seekFrame === 'function'")
    pg.wait_for_timeout(250)
    return b, pg


def render_one(at_spec: str) -> int:
    stamps = [int(x) for x in str(at_spec).split(",") if x.strip()]
    FRAMES.mkdir(parents=True, exist_ok=True)
    httpd, port = _serve()
    try:
        with sync_playwright() as p:
            b, pg = _new_page(p, port)
            for at_ms in stamps:
                pg.evaluate("(t)=>window.seekFrame(t)", at_ms)
                out = FRAMES / ("at.png" if len(stamps) == 1 else f"at_{at_ms}.png")
                pg.screenshot(path=str(out), animations="disabled")
                print(f"[render] frame @ {at_ms}ms -> {out}")
            b.close()
    finally:
        httpd.shutdown()
    return 0


def render(fps: int | None = None, dur_ms: int | None = None, limit: int | None = None) -> int:
    FRAMES.mkdir(parents=True, exist_ok=True)
    for old in FRAMES.glob("f*.png"):
        old.unlink()
    httpd, port = _serve()
    n_total = None
    try:
        with sync_playwright() as p:
            b, pg = _new_page(p, port)
            tl = pg.evaluate("window.TL")            # {FPS, DUR, SC} défini dans trailer.html
            fps = fps or tl["FPS"]
            dur_ms = dur_ms or tl["DUR"]
            n = int(dur_ms * fps / 1000)
            if limit:
                n = min(n, limit)
            n_total = n
            for i in range(n):
                t = round(i * 1000 / fps)
                pg.evaluate("(t)=>window.seekFrame(t)", t)
                pg.screenshot(path=str(FRAMES / f"f{i:05d}.png"), animations="disabled")
                if i % 60 == 0:
                    print(f"  … frame {i}/{n}")
            b.close()
    finally:
        httpd.shutdown()
    print(f"[render] {n_total} frames -> {FRAMES}")
    return 0


if __name__ == "__main__":
    args = sys.argv[1:]
    if args and args[0] == "--at":
        raise SystemExit(render_one(args[1]))
    lim = int(args[0]) if args else None
    raise SystemExit(render(limit=lim))
