"""MuseTalk lip-sync worker (Colab GPU, T4 by default).

Turns a host portrait plus the episode's spoken audio into a lip-synced presenter MP4 that the
Remotion shell composites full-frame (`avatar`) or as the hybrid-PiP bubble. Follows 0451's cache
convention (`HF_HOME=$KK_COLAB_CACHE_DIR/hf` when writable) and prints one

    KK_COLAB_RESULT {"cache": "drive"|"local", "outputs": ["..."], "videos": 1}

line for the local runner. The portrait is the operator's own (or one with recorded consent); this
worker never fetches or discovers a face.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

RESULT_MARKER = "KK_COLAB_RESULT "
DEFAULT_REPO = "TMElyralab/MuseTalk"


def choose_cache() -> str:
    """Point HF_HOME at the Drive cache when writable; report which one we landed on."""
    cache_root = os.environ.get("KK_COLAB_CACHE_DIR", "").strip()
    if cache_root:
        hf_home = Path(cache_root) / "hf"
        try:
            hf_home.mkdir(parents=True, exist_ok=True)
            probe = hf_home / ".kk-write-probe"
            probe.write_text("ok", encoding="utf-8")
            probe.unlink()
            os.environ["HF_HOME"] = str(hf_home)
            return "drive"
        except OSError as error:
            print(f"musetalk: Drive cache unusable ({error}); using VM-local HF_HOME", file=sys.stderr)
    return "local"


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="colab_musetalk", description=__doc__)
    parser.add_argument("--portrait", required=True, help="host portrait image")
    parser.add_argument("--audio", required=True, help="spoken audio to lip-sync to")
    parser.add_argument("--out", default="/content/kk-video/presenter.mp4")
    parser.add_argument("--repo", default=os.environ.get("KK_MUSETALK_REPO", DEFAULT_REPO))
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    portrait = Path(args.portrait)
    audio = Path(args.audio)
    for label, path in (("portrait", portrait), ("audio", audio)):
        if not path.is_file():
            print(f"musetalk: {label} missing: {path}", file=sys.stderr)
            return 1

    import torch  # late: argument errors never pay the torch import

    if not torch.cuda.is_available():
        print("musetalk: no CUDA device on this runtime", file=sys.stderr)
        return 1

    cache = choose_cache()
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        # MuseTalk ships a realtime inference entry point; the repo is cloned/cached under HF_HOME.
        sys.path.insert(0, str(Path(os.environ.get("HF_HOME", "/root")) / "musetalk-repo"))
        from scripts.realtime_inference import run_lip_sync  # type: ignore[import-not-found]

        run_lip_sync(portrait_path=str(portrait), audio_path=str(audio), video_out=str(out_path))
    except Exception as error:  # noqa: BLE001 - the runner turns this into a hard failure
        print(f"musetalk: synthesis failed: {error}", file=sys.stderr)
        return 1

    if not out_path.is_file():
        print(f"musetalk: no output written at {out_path}", file=sys.stderr)
        return 1
    print(RESULT_MARKER + json.dumps({"cache": cache, "outputs": [str(out_path)], "videos": 1}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
