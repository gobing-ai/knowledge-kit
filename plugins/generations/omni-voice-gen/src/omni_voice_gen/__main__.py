"""CLI entry (kk executor spawn seam): --in Doc[] JSON -> --out Content JSON.

Exit codes mirror voice-gen main(): 0 success; 1 on any failure with
`omni-voice-gen failed: <msg>` on stderr. IO, cleanup, and the empty-input notice live in
pipeline.run; torch/omnivoice import only inside OmnivoiceBackend methods, so the
empty-input notice path never loads the model stack.
"""

from __future__ import annotations

import argparse
import sys


def _fail(msg: str) -> int:
    print(f"omni-voice-gen failed: {msg}", file=sys.stderr)
    return 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="omni-voice-gen")
    parser.add_argument("--in", dest="in_path")
    parser.add_argument("--out", dest="out_path")
    args = parser.parse_args(argv)

    if not args.in_path or not args.out_path:
        return _fail("Missing required arguments: --in and --out")

    try:
        from .pipeline import run  # lazy: argument errors never import the render stack

        run(args.in_path, args.out_path)
    except Exception as exc:  # noqa: BLE001 — every failure maps onto the single fail-loud exit (voice-gen main parity)
        return _fail(str(exc))
    return 0


if __name__ == "__main__":  # pragma: no cover — `python -m` entry guard
    sys.exit(main())
