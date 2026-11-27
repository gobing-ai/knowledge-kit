"""Wan2.1 I2V motion-loop worker (Colab GPU).

Runs on the rented VM. It turns each input still into a 3-5s 9:16 vertical
motion loop with `Wan-AI/Wan2.1-I2V-14B-480P-Diffusers`, writes the MP4s into `--out-dir`, and
prints one machine-readable line the local runner parses:

    KK_COLAB_RESULT {"cache": "drive"|"local", "outputs": ["..."], "videos": N}

Weight caching (0451 R2): `HF_HOME` points at `$KK_COLAB_CACHE_DIR/hf` when that directory is
writable (a mounted Google Drive), otherwise the VM-local default is kept and `cache: "local"` is
reported so the local ledger can warn about the cold-download cost.

The 14B checkpoint needs an A100 (or an L4 with CPU offload); the local runner refuses T4 before
launching, and this worker re-checks the device it actually landed on.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

RESULT_MARKER = "KK_COLAB_RESULT "
DEFAULT_MODEL = "Wan-AI/Wan2.1-I2V-14B-480P-Diffusers"
CLIP_SECONDS = 4
MODEL_WIDTH = 432


def choose_cache() -> str:
    """Point HF_HOME at the Drive cache when it is writable; report which one we got."""
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
        except OSError as error:  # a read-only or unmounted Drive is a cost warning, not a failure
            print(f"wan21: Drive cache unusable ({error}); falling back to VM-local HF_HOME", file=sys.stderr)
    return "local"


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="colab_wan21_i2v", description=__doc__)
    parser.add_argument("--images", nargs="+", required=True, help="input stills (9:16 preferred)")
    parser.add_argument("--out-dir", default="/content/kk-video", help="where the MP4 loops land")
    parser.add_argument("--model", default=os.environ.get("KK_WAN21_MODEL", DEFAULT_MODEL))
    parser.add_argument("--seconds", type=int, default=CLIP_SECONDS)
    parser.add_argument("--steps", type=int, default=int(os.environ.get("KK_WAN21_STEPS", "40")))
    return parser.parse_args(argv)


def load_pipeline(model_id: str):
    import torch
    from diffusers import AutoencoderKLWan, WanImageToVideoPipeline
    from transformers import CLIPVisionModel

    image_encoder = CLIPVisionModel.from_pretrained(model_id, subfolder="image_encoder", torch_dtype=torch.float32)
    vae = AutoencoderKLWan.from_pretrained(model_id, subfolder="vae", torch_dtype=torch.float32)
    pipe = WanImageToVideoPipeline.from_pretrained(
        model_id, vae=vae, image_encoder=image_encoder, torch_dtype=torch.bfloat16
    )
    pipe.enable_model_cpu_offload()
    return pipe


def render_clip(pipe, image: Path, out_path: Path, seconds: int, steps: int) -> None:
    """One image → one vertical motion loop."""
    from diffusers.utils import export_to_video, load_image
    from PIL import ImageOps

    stride = pipe.vae_scale_factor_spatial * pipe.transformer.config.patch_size[1]
    scale = MODEL_WIDTH // (9 * stride) * stride
    width, height = 9 * scale, 16 * scale
    frames = seconds * 8 + 1
    result = pipe(
        image=ImageOps.fit(load_image(str(image)), (width, height)),
        prompt="subtle cinematic camera push, crisp product lighting, vertical short-form look",
        num_inference_steps=steps,
        num_frames=frames,
        height=height,
        width=width,
    )
    export_to_video(result.frames[0], str(out_path), fps=8)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    images = [Path(path) for path in args.images]
    missing = [str(path) for path in images if not path.is_file()]
    if missing:
        print(f"wan21: input image(s) missing: {', '.join(missing)}", file=sys.stderr)
        return 1

    import torch  # imported here so argument errors never pay the torch import

    if not torch.cuda.is_available():
        print("wan21: no CUDA device on this runtime", file=sys.stderr)
        return 1
    name = torch.cuda.get_device_name(0)
    if "T4" in name:
        print(f"wan21: refused on {name} — the 14B checkpoint needs an A100 (or an L4 with offload)", file=sys.stderr)
        return 1

    cache = choose_cache()
    pipe = load_pipeline(args.model)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    outputs: list[str] = []
    for index, image in enumerate(images):
        out_path = out_dir / f"clip-{index}.mp4"
        try:
            render_clip(pipe, image, out_path, args.seconds, args.steps)
        except Exception as error:  # noqa: BLE001 - the local runner turns this into a fallback
            print(f"wan21: rendering {image.name} failed: {error}", file=sys.stderr)
            return 1
        outputs.append(str(out_path))

    print(RESULT_MARKER + json.dumps({"cache": cache, "outputs": outputs, "videos": len(outputs)}))
    return 0


if __name__ == "__main__":
    remote_args = os.environ.get("KK_COLAB_ARGS")
    raise SystemExit(main(json.loads(remote_args) if remote_args is not None else sys.argv[1:]))
