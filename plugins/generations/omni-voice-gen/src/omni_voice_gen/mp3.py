"""VOICE_GEN_MP3 truthiness + ffmpeg transcode — Python port of voice-gen mp3.ts.

Same flags (`-y -hide_banner -loglevel error -i <wav> -codec:a libmp3lame -qscale:a 2`),
same fail-loud contract: missing input, missing ffmpeg, non-zero exit, or no output file
all raise with the voice-gen message text.
"""

from __future__ import annotations

import os
import subprocess
from collections.abc import Mapping

MP3_TRUTHY = frozenset({"1", "true", "yes", "on"})


def is_mp3_requested(env: Mapping[str, str] | None = None) -> bool:
    """True when the operator asked for a sibling MP3 (VOICE_GEN_MP3=true|1|yes|on)."""
    raw = (os.environ if env is None else env).get("VOICE_GEN_MP3")
    if raw is None or raw == "":
        return False
    return raw.strip().lower() in MP3_TRUTHY


def transcode_wav_to_mp3(wav_path: str, mp3_path: str, ffmpeg_bin: str = "ffmpeg") -> None:
    """WAV → MP3 via ffmpeg + libmp3lame (VBR -qscale:a 2). Fail-loud on any error."""
    if not os.path.exists(wav_path):
        raise RuntimeError(f"ffmpeg mp3 transcode failed: WAV input not found: {wav_path}")

    try:
        proc = subprocess.run(
            [
                ffmpeg_bin,
                "-y",
                "-hide_banner",
                "-loglevel",
                "error",
                "-i",
                wav_path,
                "-codec:a",
                "libmp3lame",
                "-qscale:a",
                "2",
                mp3_path,
            ],
            capture_output=True,
            text=True,
            check=False,
        )
    except FileNotFoundError as err:
        raise RuntimeError(
            f"ffmpeg is required for MP3 output (VOICE_GEN_MP3=true) but was not found on PATH ({err})"
        ) from err

    if proc.returncode != 0:
        detail = proc.stderr.strip() or proc.stdout.strip()
        raise RuntimeError(f"ffmpeg mp3 transcode failed (exit {proc.returncode}): {detail or 'no stderr'}")

    if not os.path.exists(mp3_path):
        raise RuntimeError(f"ffmpeg mp3 transcode produced no file: {mp3_path}")
