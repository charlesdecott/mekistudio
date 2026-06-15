#!/usr/bin/env python3
"""build.py — pipeline complet du trailer, 100% automatique.

GÉNÉRIQUE : copier dans <projet>/trailer/. Régler les 4 constantes ci-dessous si besoin.

    python trailer/build.py

Étapes : (polices best-effort) → render des frames (Playwright, déterministe) →
encodage MP4 (ffmpeg, H.264, muet) → poster.png + preview.gif.

Prérequis : ffmpeg sur le PATH ; playwright + chromium (cf. render.py).
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import render as render_mod  # noqa: E402

# ── CONFIG (adapter au trailer du projet) ───────────────────────────────────
FPS = 30                  # doit correspondre au FPS de trailer.html (window.TL.FPS)
POSTER_AT_SEC = 52.0      # matérialisation : comète + éditeurs qui spawnent (frame vendeuse)
GIF_START_SEC = 46.0      # début du slice animé pour preview.gif (matérialisation)
GIF_DUR_SEC = 4.0         # durée du slice gif
GIF_WIDTH = 960           # largeur du gif (downscale)
# ────────────────────────────────────────────────────────────────────────────

FRAMES = HERE / "frames"
OUT = HERE / "out"
MP4 = OUT / "trailer.mp4"
POSTER = OUT / "poster.png"
GIF = OUT / "preview.gif"


def _run(cmd: list[str]) -> None:
    print("[ffmpeg]", " ".join(cmd[1:7]), "…")
    subprocess.run(cmd, check=True)


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    # 1) polices (best-effort : si offline, le <link> reseau de trailer.html prend le relais)
    ff = HERE / "fetch_fonts.py"
    if ff.exists():
        subprocess.run([sys.executable, str(ff)], check=False)
    # 2) frames (déterministes)
    render_mod.render()
    pattern = str(FRAMES / "f%05d.png")
    # 3) MP4 muet (H.264, yuv420p, faststart) — l'utilisateur ajoute sa musique au montage
    _run(["ffmpeg", "-y", "-framerate", str(FPS), "-i", pattern,
          "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-preset", "slow",
          "-movflags", "+faststart", "-an", str(MP4)])
    # 4) poster (miniature) : la frame à POSTER_AT_SEC
    poster_frame = FRAMES / f"f{round(POSTER_AT_SEC * FPS):05d}.png"
    if poster_frame.exists():
        _run(["ffmpeg", "-y", "-i", str(poster_frame), str(POSTER)])
    # 5) preview.gif : slice animé, 15 fps, downscale, palette propre
    _run(["ffmpeg", "-y", "-ss", str(GIF_START_SEC), "-t", str(GIF_DUR_SEC), "-i", str(MP4),
          "-vf", f"fps=15,scale={GIF_WIDTH}:-1:flags=lanczos,split[s0][s1];"
                 "[s0]palettegen=stats_mode=diff[p];[s1][p]paletteuse=dither=bayer", str(GIF)])
    print(f"[build] OK\n  {MP4}\n  {POSTER}\n  {GIF}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
