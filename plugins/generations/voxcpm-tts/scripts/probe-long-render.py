#!/usr/bin/env python3
"""Reproduce the long-form voxcpm "echo / hollow" artifact in ~2.5 minutes.

Why this exists: the 2026-10-20 operator report ("回声感、瓮声瓮气") is not reproducible on a short
sentence — a 10 s render comes out clean — but it IS reproducible on a paragraph of ~450 Chinese
characters, which is the length the daily pipeline actually renders per section. Measured 2026-10-20
with `kk stage audio-quality` (real-cepstrum echo probe + pause floor):

    short render (~10 s)      cepstrum 22 ms @ 19 dB   pause floor -22.5 dB   clean
    long render  (~72 s)      cepstrum 40 ms @ 30 dB   pause floor -16.1 dB   reproduced
    shipped 2026-10-20 §00    cepstrum 40 ms @ 23 dB   pause floor -15.7 dB   reproduced

So the artifact is duration-dependent, and a knob experiment has to use a LONG text or it measures
nothing. The same run measured `inference_timesteps=20` (29.6 dB) and `cfg_value=2.5` (31.5 dB) against
the default's 30 dB: none of the exposed sampler knobs remove the 40 ms periodicity.

Usage (needs the plugin venv):

    plugins/generations/voxcpm-tts/.venv/bin/python \
        plugins/generations/voxcpm-tts/scripts/probe-long-render.py [--out /tmp/voxcpm-probe]

    kk stage audio-quality /tmp/voxcpm-probe/long-baseline.wav   # then read cepstrum + pauseFloor

Options: `--text-file <path>` (default: the built-in paragraph below), `--ref <wav>` (default: the
operator's `robin-news` clip), `--steps N`, `--cfg F`, `--normalize`, `--name <label>`.

The verdict vocabulary lives in `plugins/kk/scripts/audio-quality.ts` (`kk stage audio-quality`);
this script only renders.
"""

from __future__ import annotations

import argparse
import contextlib
import os
import sys
import time
import wave

DEFAULT_TEXT = (
    "大家好，今天是2026年10月20日，星期二。这里是由Robin为你带来的咸话咸说之每日AI乱炖。"
    "今天聊两件跟动手有关的事，一位自称几乎不懂游戏开发的作者，靠编程智能体把一款手机端的即时战略游戏"
    "一路做到能离线运行；另一件是 Google 开源了让 PyTorch 跑上 TPU 的项目。两条线索都指向同一件事："
    "工具链的边界在移动，真正决定成败的不是模型榜单，而是谁能把验收口径写清楚。"
    "先说游戏那条，作者的说法很朴素，他不写引擎，只把需求拆成可以验证的小步，让智能体一步一步改，"
    "每一步都跑一次构建，坏了自己回滚。这种做法听起来笨，但它把不确定性压到了单步之内，"
    "出问题的时候能立刻定位到底层接口还是生成逻辑。我更在意的是这套流程对工程团队的启示："
    "当生成成本降到几乎为零，稀缺的就不是代码，而是判断哪一步值得交给机器、哪一步必须留给人验。"
)
DEFAULT_REF = os.path.expanduser("~/.config/kk/voices/robin-news.wav")


def main() -> int:
    parser = argparse.ArgumentParser(description="Render one long-form voxcpm sample for echo triage.")
    parser.add_argument("--text-file", default=None, help="UTF-8 text to render (default: built-in paragraph)")
    parser.add_argument("--ref", default=DEFAULT_REF, help="reference clip (default: %(default)s)")
    parser.add_argument("--out", default="/tmp/voxcpm-probe", help="output directory (default: %(default)s)")
    parser.add_argument("--name", default="long-baseline", help="output file stem (default: %(default)s)")
    parser.add_argument("--steps", type=int, default=10, help="inference_timesteps (default 10, the plugin's)")
    parser.add_argument("--cfg", type=float, default=2.0, help="cfg_value (default 2.0, the plugin's)")
    parser.add_argument("--normalize", action="store_true", help="pass normalize=True")
    parser.add_argument(
        "--mode",
        choices=["reference", "continuation", "instruct"],
        default="reference",
        help="reference cloning (VoxCPM2 only), prompt continuation, or instruct-only (default reference)",
    )
    parser.add_argument("--prompt-text", default=None, help="transcript of --ref, required by --mode continuation")
    parser.add_argument(
        "--denoise",
        action="store_true",
        help="load the ZipEnhancer denoiser and pass denoise=True (the plugin ships load_denoiser=False)",
    )
    parser.add_argument("--model", default="openbmb/VoxCPM2", help="hub id or local snapshot")
    args = parser.parse_args()

    text = open(args.text_file, encoding="utf-8").read().strip() if args.text_file else DEFAULT_TEXT
    if not text:
        print("probe: empty text", file=sys.stderr)
        return 2
    if not os.path.isfile(args.ref):
        print(f"probe: reference clip not found: {args.ref}", file=sys.stderr)
        return 2
    os.makedirs(args.out, exist_ok=True)

    # The model prints its own progress on stdout; keep this script's stdout for the summary.
    with contextlib.redirect_stdout(sys.stderr):
        import numpy as np
        import voxcpm

        model = voxcpm.VoxCPM.from_pretrained(
            args.model, load_denoiser=args.denoise, optimize=False, device=None
        )
    sample_rate = int(model.tts_model.sample_rate)

    if args.mode == "continuation" and not args.prompt_text:
        print("probe: --mode continuation needs --prompt-text (the transcript of --ref)", file=sys.stderr)
        return 2
    # Only VoxCPM2 accepts `reference_wav_path`; every other checkpoint clones through a prompt pair.
    anchoring = {
        "reference": {"reference_wav_path": args.ref},
        "continuation": {"prompt_wav_path": args.ref, "prompt_text": args.prompt_text or ""},
        "instruct": {},
    }[args.mode]

    started = time.time()
    with contextlib.redirect_stdout(sys.stderr):
        waveform = model.generate(
            text=text,
            cfg_value=args.cfg,
            inference_timesteps=args.steps,
            normalize=args.normalize,
            denoise=args.denoise,
            **anchoring,
        )
    samples = np.clip(np.asarray(waveform).squeeze(), -1.0, 1.0)
    path = os.path.join(args.out, f"{args.name}.wav")
    with wave.open(path, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(sample_rate)
        handle.writeframes((samples * 32767).astype(np.int16).tobytes())

    seconds = len(samples) / sample_rate
    print(
        f"{path}  {seconds:.1f}s  sr={sample_rate}  chars={len(text)}  "
        f"mode={args.mode} steps={args.steps} cfg={args.cfg} normalize={args.normalize} denoise={args.denoise}  render={time.time() - started:.1f}s"
    )
    print("measure it with: kk stage audio-quality " + path, file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
