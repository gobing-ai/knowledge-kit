"""Word-level caption alignment for the video-gen plugin.

Runs `faster-whisper` locally (CPU int8) over the sliced teaser and writes a JSON track the Remotion
shell consumes:

    {"model": "small", "language": "zh", "words": [{"word": "...", "startSec": 0.12, "endSec": 0.36}]}

An empty track or an unreadable input is a hard error: rendering a video with no captions would ship
a silent-looking reel to three channels.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

TARGET_SAMPLE_RATE = 16000

DEFAULT_MODEL = "small"


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="align_captions", description=__doc__)
    parser.add_argument("--audio", required=True, help="teaser WAV to align")
    parser.add_argument("--out", required=True, help="word-track JSON destination")
    parser.add_argument(
        "--model",
        default=os.environ.get("KK_CAPTION_MODEL", DEFAULT_MODEL),
        help="faster-whisper model size or path (default: env KK_CAPTION_MODEL or 'small')",
    )
    parser.add_argument(
        "--language",
        default=os.environ.get("KK_CAPTION_LANGUAGE") or None,
        help="force a language code (default: autodetect)",
    )
    return parser.parse_args(argv)


def load_audio(audio: Path) -> "np.ndarray":
    """Decode to 16 kHz mono float32 with ffmpeg.

    WHY not pass the path to `transcribe`: faster-whisper then decodes through PyAV
    (`av.open(..., metadata_errors="ignore")`), a keyword PyAV 19 no longer accepts, so the whole
    worker dies on the installed decoder. ffmpeg is already a hard dependency of this plugin.
    """
    import numpy as np

    with tempfile.TemporaryDirectory() as tmp:
        raw = Path(tmp) / "audio.s16le"
        subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-loglevel",
                "error",
                "-i",
                str(audio),
                "-ac",
                "1",
                "-ar",
                str(TARGET_SAMPLE_RATE),
                "-f",
                "s16le",
                str(raw),
            ],
            check=True,
        )
        return np.fromfile(raw, dtype=np.int16).astype(np.float32) / 32768.0


def transcribe(audio: Path, model_name: str, language: str | None) -> dict:
    # Imported late so `--help` and argument errors never pay the model-stack import.
    from faster_whisper import WhisperModel

    model = WhisperModel(model_name, device="cpu", compute_type="int8")
    segments, info = model.transcribe(
        load_audio(audio),
        language=language,
        word_timestamps=True,
        vad_filter=True,
        beam_size=1,
    )
    words: list[dict] = []
    for segment in segments:
        for word in segment.words or []:
            text = (word.word or "").strip()
            if not text:
                continue
            words.append(
                {"word": text, "startSec": round(float(word.start), 3), "endSec": round(float(word.end), 3)}
            )
    return {"model": model_name, "language": getattr(info, "language", None) or "", "words": words}


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    audio = Path(args.audio)
    if not audio.is_file():
        print(f"align_captions: audio not found: {audio}", file=sys.stderr)
        return 1
    try:
        payload = transcribe(audio, args.model, args.language)
    except Exception as error:  # noqa: BLE001 - operator-actionable failure, not a crash report
        print(f"align_captions: transcription failed: {error}", file=sys.stderr)
        return 1
    if not payload["words"]:
        print("align_captions: transcription produced no words", file=sys.stderr)
        return 1
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"align_captions: {len(payload['words'])} words -> {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
