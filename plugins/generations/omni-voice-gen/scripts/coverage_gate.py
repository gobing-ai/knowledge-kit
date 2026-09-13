"""Per-file coverage gate: line AND function coverage >= 90% over the .coverage data.

Function coverage has no native coverage.py metric, so the gate derives it: a
function counts as covered when its `def` line executed AND at least one body
line executed (def/body line sets from ast; measured lines from the coverage.py
API). Line coverage uses coverage.py's own per-file analysis. Exit 1 listing
every offender below threshold.
"""

from __future__ import annotations

import ast
import sys
from pathlib import Path

THRESHOLD = 0.90


def function_map(path: Path) -> list[tuple[int, set[int]]]:
    """(def_lineno, {body linenos}) for every function/method in a source file."""
    tree = ast.parse(path.read_text(encoding="utf-8"))
    out: list[tuple[int, set[int]]] = []
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            body = {child.lineno for child in ast.walk(node) if hasattr(child, "lineno") and child.lineno != node.lineno}
            out.append((node.lineno, body))
    return out


def main() -> int:
    from coverage import Coverage

    cov = Coverage(data_file=".coverage")
    cov.load()
    measured = cov.get_data().measured_files()
    if not measured:
        print("coverage_gate: no coverage data found; run `make coverage` first", file=sys.stderr)
        return 1

    offenders: list[str] = []
    for measured_path in sorted(measured):
        try:
            rel = Path(measured_path).relative_to(Path.cwd())
        except ValueError:
            continue
        # Gate scope: package sources only (src/omni_voice_gen/<module>.py).
        if len(rel.parts) < 3 or rel.parts[-3:-1] != ("src", "omni_voice_gen"):
            continue
        executed = set(cov.get_data().lines(measured_path) or [])
        _, statements, _, missing, _ = cov.analysis2(str(rel))
        if not statements:
            continue
        line_pct = (len(statements) - len(missing)) / len(statements)

        funcs = function_map(rel)
        func_pct = 1.0
        if funcs:
            covered = sum(1 for def_line, body in funcs if def_line in executed and body & executed)
            func_pct = covered / len(funcs)

        if line_pct < THRESHOLD or func_pct < THRESHOLD:
            offenders.append(f"{rel}: line {line_pct:.1%}, function {func_pct:.1%} (both must be >= 90%)")

    if offenders:
        print("coverage_gate: FAIL (threshold 90% line and function, per file)", file=sys.stderr)
        for line in offenders:
            print(f"  {line}", file=sys.stderr)
        return 1
    print("coverage_gate: PASS (line and function coverage >= 90% per file)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
