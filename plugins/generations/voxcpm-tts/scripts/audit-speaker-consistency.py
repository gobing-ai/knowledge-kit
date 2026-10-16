#!/usr/bin/env python3
"""Grade one rendered episode for speaker consistency (音色/音质 uniformity).

Why this exists: a profile whose ``mode`` is ``instruct`` carries no reference audio, so VoxCPM
samples a speaker per request and a multi-segment episode changes voice between segments. The
2026-10-15 episode drew 59 different speakers (within-item F0 swing up to 103 Hz) and nobody
noticed until a human listened. This script makes that measurable.

Usage (needs the plugin venv, which has librosa/numpy):

    plugins/generations/voxcpm-tts/.venv/bin/python \
        plugins/generations/voxcpm-tts/scripts/audit-speaker-consistency.py <content.json> [more.json ...]

Pass an episode content JSON (grouped per item when the sibling ``sections/<date>/`` dir exists)
or individual section JSONs. Exit code 1 means the thresholds below were missed.

Thresholds come from the two measured modes (2026-10-15, same three texts):
  reference/continuation anchored -> F0 spread 22-26 Hz  (one speaker)
  instruct (random speaker)       -> F0 spread 141 Hz    (three texts, three speakers)
Grade "pass" needs every item's F0 spread <= 45 Hz and the per-item median <= 30 Hz. Median pitch
is the honest signal here: it tracks the speaker register, not the sentence's intonation.
"""

from __future__ import annotations

import json
import pathlib
import sys
import warnings

import librosa
import numpy as np

warnings.filterwarnings('ignore')

SR = 16000
MAX_ITEM_F0_SPREAD = 45.0
MAX_ITEM_MEDIAN_SPREAD = 30.0


def measure(content_path: pathlib.Path) -> list[float]:
    """Per-segment median F0 (Hz) of one rendered Content."""
    content = json.loads(content_path.read_text())
    wav_path = content_path.parent / f'{content_path.stem}.wav'
    audio, _ = librosa.load(str(wav_path), sr=SR, mono=True)
    medians, offset = [], 0.0
    for segment in content['metadata']['segments']:
        start = int(offset * SR)
        offset += segment['duration']
        window = audio[start : int(offset * SR)]
        if len(window) < SR * 0.4:
            continue
        f0 = librosa.yin(window, fmin=70, fmax=350, sr=SR)
        voiced = f0[(f0 > 80) & (f0 < 340)]
        if len(voiced):
            medians.append(float(np.median(voiced)))
    return medians


def grouping(content_path: pathlib.Path) -> list[tuple[str, pathlib.Path]]:
    """Items to grade: the section JSONs when they sit next to the episode, else the file itself."""
    sections = content_path.parent / 'sections' / content_path.stem.split('_')[0]
    if content_path.name.endswith('_11_generate_content.json') and sections.is_dir():
        return sorted((p.stem, p) for p in sections.glob('*.json'))
    return [(content_path.stem, content_path)]


def main(argv: list[str]) -> int:
    if not argv:
        print(__doc__.strip().splitlines()[0], file=sys.stderr)
        print('usage: audit-speaker-consistency.py <content.json> [...]', file=sys.stderr)
        return 2

    failures: list[str] = []
    spreads: list[float] = []
    print(f'{"item":14s} {"segs":>4s} {"medF0":>6s} {"spread":>7s}  verdict')
    for target in argv:
        path = pathlib.Path(target)
        for name, section_path in grouping(path):
            medians = measure(section_path)
            if len(medians) < 2:
                continue
            spread = max(medians) - min(medians)
            spreads.append(spread)
            verdict = 'ok'
            if spread > MAX_ITEM_F0_SPREAD:
                verdict = f'unstable (> {MAX_ITEM_F0_SPREAD:.0f} Hz)'
                failures.append(f'{name}: F0 spread {spread:.0f} Hz across {len(medians)} segments')
            print(f'{name:14s} {len(medians):4d} {np.median(medians):6.0f} {spread:7.0f}  {verdict}')

    if not spreads:
        print('no item had enough segments to grade', file=sys.stderr)
        return 2

    median_spread = float(np.median(spreads))
    print(f'\nper-item F0 spread: median {median_spread:.0f} Hz, worst {max(spreads):.0f} Hz over {len(spreads)} items')
    if median_spread > MAX_ITEM_MEDIAN_SPREAD:
        failures.append(f'median per-item F0 spread {median_spread:.0f} Hz > {MAX_ITEM_MEDIAN_SPREAD:.0f} Hz')
    if failures:
        print('FAIL — the episode changes speaker between segments (check the profile mode):')
        for line in failures:
            print(f'  - {line}')
        return 1
    print('PASS — one speaker across every item')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
