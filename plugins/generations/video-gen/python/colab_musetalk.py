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
import subprocess
import sys
import tempfile
from pathlib import Path

RESULT_MARKER = "KK_COLAB_RESULT "


def choose_cache() -> str:
    """Point HF_HOME at the Drive cache when writable; report which one we landed on."""
    cache_root = os.environ.get("KK_COLAB_CACHE_DIR", "").strip()
    drive = Path("/content/drive")
    if cache_root and Path(cache_root).is_relative_to(drive) and not drive.is_mount():
        return "local"
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
    parser.add_argument("--repo", default=os.environ.get("KK_MUSETALK_REPO"), help="prepared MuseTalk checkout")
    return parser.parse_args(argv)


def render_presenter(repo: Path, portrait: Path, audio: Path, out_path: Path) -> None:
    if not (repo / "scripts" / "inference.py").is_file():
        raise FileNotFoundError(f"prepared MuseTalk checkout not found at {repo} (set KK_MUSETALK_REPO)")
    with tempfile.TemporaryDirectory(prefix="kk-musetalk-", dir=out_path.parent) as work_dir:
        scratch = Path(work_dir)
        config = scratch / "inference.json"
        config.write_text(json.dumps({"presenter": {
            "video_path": str(portrait), "audio_path": str(audio), "result_name": out_path.name,
        }}), encoding="utf-8")
        result_dir = scratch / "results"
        subprocess.run([
            sys.executable, "-m", "scripts.inference",
            "--inference_config", str(config),
            "--result_dir", str(result_dir),
            "--unet_model_path", "models/musetalkV15/unet.pth",
            "--unet_config", "models/musetalkV15/musetalk.json",
            "--version", "v15", "--use_float16",
        ], cwd=repo, check=True)
        (result_dir / "v15" / out_path.name).replace(out_path)


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
    out_path = Path(args.out).resolve()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        repo = Path(args.repo) if args.repo else Path(os.environ.get("HF_HOME", "/root")) / "musetalk-repo"
        render_presenter(repo, portrait.resolve(), audio.resolve(), out_path)
    except Exception as error:  # noqa: BLE001 - the runner turns this into a hard failure
        print(f"musetalk: synthesis failed: {error}", file=sys.stderr)
        return 1

    if not out_path.is_file():
        print(f"musetalk: no output written at {out_path}", file=sys.stderr)
        return 1
    print(RESULT_MARKER + json.dumps({"cache": cache, "outputs": [str(out_path)], "videos": 1}))
    return 0


if __name__ == "__main__":
    remote_args = os.environ.get("KK_COLAB_ARGS")
    raise SystemExit(main(json.loads(remote_args) if remote_args is not None else sys.argv[1:]))
