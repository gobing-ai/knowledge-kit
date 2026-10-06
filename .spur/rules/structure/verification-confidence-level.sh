#!/bin/sh
# Verification-block confidence check (rule `verification-block-carries-confidence-level`).
#
# Runnable by hand — the rule's own message points here, because the `exit-code` evaluator reports
# only the exit status, not this script's output:
#
#   sh .spur/rules/structure/verification-confidence-level.sh     # 0 = ok, 1 = findings on stdout
#   sh .spur/rules/structure/verification-confidence-level.test.sh # falsification cases for the above
#
# Contract, per `Verification (...)` HTML-comment block in a markdown document:
#
#   1. the block carries exactly one `Confidence: HIGH|MEDIUM|LOW` line, and no `Confidence:` line
#      anywhere in the file falls outside the enum;
#   2. the claimed level is EARNED:
#        HIGH          -> the block cites evidence: a `path:line`, a repo path with a code/doc
#                         extension, or an http(s) URL;
#        MEDIUM / LOW  -> either cites evidence, or names what is unverified (a gap marker such as
#                         "unverified", "not run", "missing", "could not …"), so a low-confidence
#                         close-out states its gap instead of asserting nothing at all.
#
# Historical evidence records under docs/tasks and docs/features are out of scope (their verification
# blocks describe past runs, not this tree's close-outs).
#
# Optional arguments: pass explicit markdown files to check instead of the repo sweep — the seam the
# self-test uses (`.test.sh`), and handy by hand for a single document.
set -u

if [ "$#" -gt 0 ]; then
    files="$*"
else
    files="$(rg --files -g '*.md' -g '!docs/tasks/**' -g '!docs/features/**' -g '!**/node_modules/**' -g '!**/vendors/**' . 2>/dev/null | xargs rg -l 'Verification \(' 2>/dev/null || true)"
fi
if [ -z "$files" ]; then
    echo "INVALID: no 'Verification (' block found — the confidence contract has nothing to check (expected CHANGELOG.md)"
    exit 1
fi

# A line counts as a citation when it carries an http(s) URL, a `path:line`, or a dotted token with a
# known code/doc extension. Deliberately escape-free: BWK awk's dynamic-regex escape handling for `\.`
# is unreliable (it silently matched the word "bullets" while this was a regex), and the failure mode
# of over-accepting here is a weaker rule, not a wrong one.
gap_re='unverif|not (yet )?(run|verified|tested|checked|confirmed)|missing|could not|unable to|assumed|no evidence|unknown|not available|left untested'

errors=0
for f in $files; do
    awk -v file="$f" -v gap_re="$gap_re" '
        function is_cite(line,   i, exts, e) {
            if (index(line, "://") > 0) return 1
            if (line ~ /[A-Za-z0-9_.\/-]+:[0-9]+/) return 1
            e = "ts tsx js jsx mjs json yaml yml md sh py sql toml txt lock"
            n = split(e, exts, " ")
            for (i = 1; i <= n; i++) if (index(line, "." exts[i]) > 0) return 1
            return 0
        }
        !inb && /<!--/ { inb = 1; seen = 0; conf = 0; cites = 0; gaps = 0; level = "" }
        inb && /Verification \(/ { seen = 1 }
        inb && /Confidence: (HIGH|MEDIUM|LOW)/ {
            conf += 1
            line = $0
            if (match(line, /(HIGH|MEDIUM|LOW)/)) level = substr(line, RSTART, RLENGTH)
        }
        inb && is_cite($0) { cites += 1 }
        inb && tolower($0) ~ gap_re { gaps += 1 }
        inb && /-->/ {
            if (seen) {
                if (conf != 1) {
                    printf "INVALID: %s: verification block ending at line %d carries %d Confidence: HIGH|MEDIUM|LOW line(s) (want exactly 1)\n", file, NR, conf
                    bad = 1
                } else if (level == "HIGH" && cites == 0) {
                    printf "INVALID: %s: verification block ending at line %d claims HIGH but cites no evidence (want >=1 path:line, repo path, or URL)\n", file, NR
                    bad = 1
                } else if ((level == "MEDIUM" || level == "LOW") && cites == 0 && gaps == 0) {
                    printf "INVALID: %s: verification block ending at line %d claims %s, cites nothing and names no gap — state what is unverified\n", file, NR, level
                    bad = 1
                }
            }
            inb = 0
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
