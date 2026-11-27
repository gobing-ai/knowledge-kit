"""EchoMimicV2 half-body presenter worker (Colab GPU, A100 by default).

Turns a host portrait plus the episode's spoken audio into a half-body presenter MP4 for the
full-frame `avatar` mode. The local runner refuses T4 and this worker re-checks the device it
landed on. Follows 0451's cache
convention (`HF_HOME=$KK_COLAB_CACHE_DIR/hf` when writable) and prints one

    KK_COLAB_RESULT {"cache": "drive"|"local", "outputs": ["..."], "videos": 1}

line for the local runner. The portrait is the operator's own (or one with recorded consent); this
worker never fetches or discovers a face.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import wave
from pathlib import Path

RESULT_MARKER = "KK_COLAB_RESULT "
FPS = 24


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
            print(f"echomimic: Drive cache unusable ({error}); using VM-local HF_HOME", file=sys.stderr)
    return "local"


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="colab_echomimic_v2", description=__doc__)
    parser.add_argument("--portrait", required=True, help="host portrait image")
    parser.add_argument("--audio", required=True, help="spoken audio to lip-sync to")
    parser.add_argument("--out", default="/content/kk-video/presenter.mp4")
    parser.add_argument("--repo", default=os.environ.get("KK_ECHOMIMIC_REPO"), help="prepared EchoMimicV2 checkout")
    return parser.parse_args(argv)


def render_presenter(repo: Path, portrait: Path, audio: Path, out_path: Path) -> None:
    repo = repo.resolve()
    entry = repo / "infer_acc.py"
    if not entry.is_file():
        raise FileNotFoundError(f"prepared EchoMimicV2 checkout not found at {repo} (set KK_ECHOMIMIC_REPO)")

    # Upstream inference loads pickled pose frames. Use only the prepared upstream pose sequence.
    pose = repo / "assets" / "halfbody_demo" / "pose" / "01"
    frames = sorted((file for file in pose.glob("*.npy") if file.stem.isdecimal()), key=lambda file: int(file.stem))
    if not frames:
        raise FileNotFoundError(f"EchoMimicV2 pose sequence is missing at {pose}")
    motion = frames + frames[-2:0:-1]
    with wave.open(str(audio), "rb") as wav:
        length = max(1, wav.getnframes() * FPS // wav.getframerate())

    with tempfile.TemporaryDirectory(prefix="kk-echomimic-", dir=out_path.parent) as temp:
        scratch = Path(temp)
        for name in ("configs", "pretrained_weights"):
            (scratch / name).symlink_to(repo / name, target_is_directory=True)
        reference = scratch / "reference"
        reference.mkdir()
        portrait_path = reference / ("host" + portrait.suffix)
        portrait_path.symlink_to(portrait)
        staged_pose = scratch / "pose"
        staged_pose.mkdir()
        for frame in range(length):
            (staged_pose / f"{frame}.npy").symlink_to(motion[frame % len(motion)])
        env = os.environ.copy()
        ffmpeg = shutil.which("ffmpeg")
        if ffmpeg:
            env.setdefault("FFMPEG_PATH", str(Path(ffmpeg).parent))
        subprocess.run([
            sys.executable, str(entry), "-L", str(length),
            "--ref_images_dir", str(scratch), "--refimg_name", f"reference/{portrait_path.name}",
            "--audio_dir", str(audio.parent), "--audio_name", audio.name,
            "--pose_dir", str(scratch), "--pose_name", staged_pose.name,
        ], cwd=scratch, env=env, check=True)
        results = tuple((scratch / "outputs").rglob("*_sig.mp4"))
        if len(results) != 1:
            raise RuntimeError(f"expected one EchoMimicV2 presenter, got {len(results)}")
        results[0].replace(out_path)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    portrait = Path(args.portrait)
    audio = Path(args.audio)
    for label, path in (("portrait", portrait), ("audio", audio)):
        if not path.is_file():
            print(f"echomimic: {label} missing: {path}", file=sys.stderr)
            return 1

    import torch  # late: argument errors never pay the torch import

    if not torch.cuda.is_available():
        print("echomimic: no CUDA device on this runtime", file=sys.stderr)
        return 1

    name = torch.cuda.get_device_name(0)
    if "T4" in name:
        print(f"echomimic: refused on {name} — half-body synthesis needs an A100 (or an L4)", file=sys.stderr)
        return 1

    cache = choose_cache()
    out_path = Path(args.out).resolve()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        repo = Path(args.repo) if args.repo else Path(os.environ.get("HF_HOME", "/root")) / "echomimic-v2-repo"
        render_presenter(repo, portrait.resolve(), audio.resolve(), out_path)
    except Exception as error:  # noqa: BLE001 - the runner turns this into a hard failure
        print(f"echomimic: synthesis failed: {error}", file=sys.stderr)
        return 1

    if not out_path.is_file():
        print(f"echomimic: no output written at {out_path}", file=sys.stderr)
        return 1
    print(RESULT_MARKER + json.dumps({"cache": cache, "outputs": [str(out_path)], "videos": 1}))
    return 0


if __name__ == "__main__":
    remote_args = os.environ.get("KK_COLAB_ARGS")
    raise SystemExit(main(json.loads(remote_args) if remote_args is not None else sys.argv[1:]))
