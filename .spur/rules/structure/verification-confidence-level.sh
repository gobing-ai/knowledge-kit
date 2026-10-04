#!/bin/sh
# Verification-block confidence check (rule `verification-block-carries-confidence-level`).
#
# Runnable by hand — the rule's own message points here, because the `exit-code` evaluator reports
# only the exit status, not this script's output:
#
#   sh .spur/rules/structure/verification-confidence-level.sh     # 0 = ok, 1 = findings on stdout
#
# Every markdown document that claims a `Verification (...)` block must carry exactly one
# `Confidence: HIGH|MEDIUM|LOW` line inside that same HTML-comment block, and no `Confidence:` line
# anywhere may fall outside the enum. Historical evidence records under docs/tasks and docs/features
# are out of scope (their verification blocks describe past runs, not this tree's close-outs).
set -u

files="$(rg --files -g '*.md' -g '!docs/tasks/**' -g '!docs/features/**' -g '!**/node_modules/**' -g '!**/vendors/**' . 2>/dev/null | xargs rg -l 'Verification \(' 2>/dev/null || true)"
if [ -z "$files" ]; then
    echo "INVALID: no 'Verification (' block found — the confidence contract has nothing to check (expected CHANGELOG.md)"
    exit 1
fi

errors=0
for f in $files; do
    awk -v file="$f" '
        !inblock && /<!--/ { inblock = 1; seen = 0; conf = 0 }
        inblock && /Verification \(/ { seen = 1 }
        inblock && /Confidence: (HIGH|MEDIUM|LOW)/ { conf += 1 }
        inblock && /-->/ {
            if (seen && conf != 1) {
                printf "INVALID: %s: verification block ending at line %d carries %d Confidence: HIGH|MEDIUM|LOW line(s) (want exactly 1)\n", file, NR, conf
                bad = 1
            }
            inblock = 0
        }
        END { exit bad }
    ' "$f" || errors=$((errors + 1))

    out_of_enum="$(rg -n 'Confidence:' "$f" 2>/dev/null | rg -v 'Confidence: (HIGH|MEDIUM|LOW)' || true)"
    if [ -n "$out_of_enum" ]; then
        printf 'INVALID: %s: confidence level outside HIGH|MEDIUM|LOW:\n%s\n' "$f" "$out_of_enum"
        errors=$((errors + 1))
    fi
done

[ "$errors" -eq 0 ] || exit 1
