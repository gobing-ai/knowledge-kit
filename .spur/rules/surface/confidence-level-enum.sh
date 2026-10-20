#!/bin/sh
# Confidence-level vocabulary check (rule `confidence-level-vocabulary-consistent`).
#
# Runnable by hand — the rule's own message points here, because the `exit-code` evaluator reports
# only the exit status, not this script's output:
#
#   sh .spur/rules/surface/confidence-level-enum.sh            # 0 = ok, 1 = findings on stdout
#   sh .spur/rules/surface/confidence-level-enum.sh <file>…    # explicit files (the test fixtures)
#   sh .spur/rules/surface/confidence-level-enum.test.sh       # falsification cases for the above
#
# WHAT THIS ENFORCES. The content-judge and label confidence level is ONE closed vocabulary —
# HIGH|MEDIUM|LOW — and ADR-041 keeps that product contract explicitly ("`labels.confidence` keeps
# its closed `HIGH|MEDIUM|LOW` enum with the 0–1 mapping, the judge-verdict guards keep their
# confidence-aware read"). The vocabulary is nevertheless written by hand in three shapes across
# apps/cli, packages/kk-store, plugins/kk/scripts and the workflow YAML guards:
#
#   1. a declared array          LABEL_CONFIDENCE_LEVELS = ['HIGH', 'MEDIUM', 'LOW'] as const
#                                CONFIDENCE_LEVELS = ['HIGH', 'MEDIUM', 'LOW'] as const
#   2. a jq guard                test("^(HIGH|MEDIUM|LOW)$")
#   3. a comparison chain        x === 'HIGH' || x === 'MEDIUM' || x === 'LOW'
#
# Measured 2026-10-20: 10 sites across those shapes. Any ONE of them drifting breaks a gate
# silently and in opposite directions — a guard that drops `LOW` refuses every honest LOW answer
# (§ kk-collect's label guard), while a producer that adds a fourth level emits a verdict no guard
# accepts (fail-closed forever). Both are invisible to `tsc` and to the workflow tests, because each
# site is self-consistent; only their mutual agreement is the contract.
#
# SCOPE, deliberately narrow so it cannot fire on prose:
#  - shape 1 counts only a `*CONFIDENCE_LEVELS = [` declaration (identifier, uppercase, brackets);
#  - shape 2 counts only a single-line jq `test("^(…)$")` that reads a `confidence` field;
#  - shape 3 counts only a SINGLE-LINE chain that (a) mentions `onfidence` and (b) names at least
#    TWO levels — a one-level predicate (`x.confidence !== 'LOW'`) is a legitimate partial check and
#    is not a vocabulary declaration.
# A chain reformatted across lines therefore falls outside discovery; its own unit test is the
# check there. That is the honest limit of a text gate, and the vacuity arm below makes the limit
# loud rather than silent: if the idioms themselves change, the checker fails instead of passing
# over nothing.
#
# Exit status: 0 = every site names exactly HIGH|MEDIUM|LOW; 1 = a site disagrees, or no site was
# found at all; 2 = usage.
set -u

canon="HIGH LOW MEDIUM"   # sorted, so the comparison is order-independent
canon_display="HIGH|MEDIUM|LOW"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

files="$tmp/files"
hits="$tmp/hits"
: >"$files"
: >"$hits"

if [ "$#" -gt 0 ]; then
    for arg in "$@"; do
        [ -f "$arg" ] && printf '%s\n' "$arg" >>"$files"
    done
else
    find apps/cli/src packages/kk-store/src plugins/kk/scripts -name '*.ts' -type f 2>/dev/null >>"$files"
    find plugins/kk/workflows -name '*.yaml' -type f 2>/dev/null >>"$files"
fi

# One `<file>:<line>:<text>` record per candidate site, tagged with its shape.
while IFS= read -r file; do
    grep -nE "CONFIDENCE_LEVELS *= *\[" "$file" 2>/dev/null | sed "s|^|$file:array:|" >>"$hits"
    grep -nF 'test("^(' "$file" 2>/dev/null | grep -F 'confidence' | sed "s|^|$file:guard:|" >>"$hits"
    # Shape 3 with one line of context: the real site is `isConfidenceLevel(value) { return value
    # === 'HIGH' || … }`, so the identifier naming the vocabulary sits on the line ABOVE the chain.
    awk -v tag="$file:chain:" '
        /=== '\''(HIGH|MEDIUM|LOW)'\''|== '\''(HIGH|MEDIUM|LOW)'\''/ {
            if (($0 " " prev) ~ /onfidence/) print tag FNR ":" $0
        }
        { prev = $0 }
    ' "$file" >>"$hits"
done <"$files"

checked=0
bad=0

while IFS= read -r hit; do
    [ -n "$hit" ] || continue
    site_file="${hit%%:*}"
    rest="${hit#*:}"
    shape="${rest%%:*}"
    rest="${rest#*:}"
    lineno="${rest%%:*}"
    text="${rest#*:}"

    case "$shape" in
        guard)
            # `test("^(A|B|C)$")` -> A|B|C -> one level per line. Index-based, not a regex FS:
            # `awk -F'test("^('` reads that argument as a pattern and aborts.
            levels="$(printf '%s' "$text" |
                awk '{n = index($0, "test(\"^("); if (n == 0) { print ""; exit } s = substr($0, n + 8); m = index(s, ")"); print substr(s, 1, m - 1)}' |
                tr '|' '\n')"
            ;;
        *)
            levels="$(printf '%s\n' "$text" | grep -oE "'[A-Z]+'" | tr -d "'")"
            ;;
    esac

    got="$(printf '%s\n' "$levels" | sed '/^$/d' | sort -u | tr '\n' ' ' | sed 's/ *$//')"
    # Shape 3 is a site only when it names at least two levels (see SCOPE above).
    if [ "$shape" = "chain" ] && [ "$(printf '%s\n' "$got" | wc -w | tr -d ' ')" -lt 2 ]; then
        continue
    fi

    checked=$((checked + 1))
    if [ "$got" != "$canon" ]; then
        bad=$((bad + 1))
        printf '%s:%s: confidence vocabulary is {%s} — must be exactly {%s}\n' \
            "$site_file" "$lineno" "$got" "$canon_display"
    fi
done <"$hits"

if [ "$checked" -eq 0 ]; then
    printf 'confidence-level-enum: no HIGH|MEDIUM|LOW site found under apps/cli/src, packages/kk-store/src, plugins/kk/scripts or plugins/kk/workflows — the declaration shapes this checker matches have changed, so it can vouch for nothing\n'
    exit 1
fi

[ "$bad" -eq 0 ] || exit 1
