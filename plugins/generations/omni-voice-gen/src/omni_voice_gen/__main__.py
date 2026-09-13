"""CLI entry (kk executor spawn seam): --in Doc[] JSON -> --out Content JSON.

Exit codes mirror voice-gen main(): 0 success; 1 on any failure with
`omni-voice-gen failed: <msg>` on stderr. pipeline.run (0125) is imported lazily
so the empty-input notice path never loads the model stack (torch/omnivoice).
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from .contract import NOTICE_CONTENT, Content, content_to_json, parse_doc_list


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
        raw = Path(args.in_path).read_text(encoding="utf-8")
    except OSError as exc:
        return _fail(f"cannot read input {args.in_path}: {exc.strerror or exc}")

    try:
        docs = parse_doc_list(raw)
    except ValueError as exc:
        return _fail(f"Invalid DocList input: {exc}")

    if docs:
        # Lazy import: keeps torch/omnivoice off the empty-input notice path.
        from .pipeline import run

        content: Content = run(docs)
    else:
        content = NOTICE_CONTENT

    out_path = Path(args.out_path)
    try:
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(content_to_json(content), encoding="utf-8")
    except OSError as exc:
        return _fail(f"cannot write output {args.out_path}: {exc.strerror or exc}")
    return 0


if __name__ == "__main__":  # pragma: no cover — `python -m` entry guard
    sys.exit(main())
