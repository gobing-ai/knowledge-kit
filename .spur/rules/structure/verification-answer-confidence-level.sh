#!/bin/sh
# Verification-answer confidence check (rule `verification-answer-carries-confidence-level`).
#
# Runnable by hand — the rule's own message points here, because the `exit-code` evaluator reports
# only the exit status, not this script's output:
#
#   sh .spur/rules/structure/verification-answer-confidence-level.sh          # 0 = ok, 1 = findings
#   sh .spur/rules/structure/verification-answer-confidence-level.sh <file>…  # explicit files
#   sh .spur/rules/structure/verification-answer-confidence-level.sh --no-since  # judge pre-cutoff too
#   sh .spur/rules/structure/verification-answer-confidence-level.test.sh     # falsification cases
#
# WHY THIS EXISTS. Three sibling rules already cover a claimed confidence level: the `Verification (`
# block and the `## Testing` record (`verification-confidence-level`), the durable verdict artifact
# (`verdict-confidence-proof`), and the API/library claim table
# (`api-library-claim-cites-source-and-confidence`). The uncovered surface was the artifact the
# pipeline's own verify stage writes — the ANSWER file under `.spur/run/`. Measured in this repo on
# 2026-10-12: of 167 `*-verify-answer.txt` only 53 carried a `Confidence:` line. The verify grammar
# requires exactly one line and `spur task verdict` lints it at write time, but nothing read the file
# afterwards, so a hand-written or agent-written answer could assert `Verdict: PASS` with no level at
# all and no gate noticed — the same class the sibling rules close for every other surface.
#
# WHY REVIEW ANSWERS ARE NOT JUDGED. `*review-answer*` files were measured too (6 of 45 carried a
# level), but the review-stage artifact contract owns priority cells only and never declares a
# `Confidence:` line, so requiring one here would fail a compliant reviewer artifact. They are
# counted in a `review-answer` NOTE instead. Making a level mandatory for reviews is a contract
# change owned by the review stage itself (the sp plugin's reviewer contract), not a rule that can be
# smuggled in from this repository.
#
# SCOPE, two deliberate rules of construction.
#
#  1. PRESENCE IS NEVER REQUIRED. `.spur/run/` is a disposable plane (ADR-131), so a rule that
#     demanded an answer file would fail after any cleanup. This rule judges the files that are
#     there: an answer that asserts a verdict must declare its level and earn it. An absent or empty
#     answer is out of scope, and so is a file with no verdict line (a log, a partial scrap).
#
#  2. A CUTOFF, NOT A 212-ENTRY BACKLOG. The sibling `verdict-confidence-proof` rule grandfathers
#     pre-rule debt in an explicit list; that list would be unusable here (212 answer files today,
#     growing with every run). Answers written before the adoption timestamp are therefore reported as
#     a single count line and not judged — debt that may only shrink as old answers age out of the
#     run plane. `--no-since` removes the cutoff for the negative control and for an operator who
#     wants the full pre-rule set. The cutoff is an exact UTC timestamp, not a date, so answers a
#     concurrent session wrote earlier today are debt rather than findings.
#
# Contract, for each in-scope file:
#   * exactly one `Confidence: HIGH|MEDIUM|LOW` line, and no `Confidence:` line outside the enum;
#   * the level is EARNED: HIGH cites evidence (an http(s) URL, a `path:line`, or a repo path with a
#     code/doc extension); MEDIUM/LOW either cite evidence or name what is unverified. The citation
#     and gap heuristics are the ones the sibling confidence checker already uses — one vocabulary,
#     not a second dialect.
#
# Repair: the answer file is produced by the verify/review stage, so the repair is to re-run that
# stage (or, for a live run, to write the missing line into the answer before `spur task verdict`
# consumes it) — never to delete the evidence, and never by widening this rule.
set -u

SINCE="2026-10-12T02:30:00Z"   # adoption instant (UTC); earlier answers are debt, not findings
USE_SINCE=1
FILES=""
REVIEWS=""

for arg in "$@"; do
    case "$arg" in
        --no-since) USE_SINCE=0 ;;
        --since=*) SINCE="${arg#--since=}" ;;
        *) FILES="$FILES $arg" ;;
    esac
done

if [ -z "$FILES" ]; then
    for d in .spur/run/ .spur/run/*/; do
        [ -d "$d" ] || continue
        for f in "$d"*-verify-answer.txt; do
            [ -f "$f" ] && FILES="$FILES $f"
        done
        # Counted, never judged — the review contract declares no Confidence line (see header).
        for f in "$d"*review-answer*.txt; do
            [ -f "$f" ] && REVIEWS="$REVIEWS $f"
        done
    done
fi
N_REVIEWS=0
# A review answer is classified by name, whether it was discovered or passed explicitly — the
# exemption must not depend on how the file reached the checker.
if [ -n "$FILES" ]; then
    KEEP=""
    for f in $FILES; do
        case "$f" in
            *review-answer*) REVIEWS="$REVIEWS $f" ;;
            *) KEEP="$KEEP $f" ;;
        esac
    done
    FILES="$KEEP"
fi
for f in $REVIEWS; do [ -f "$f" ] && N_REVIEWS=$((N_REVIEWS + 1)); done
[ "$N_REVIEWS" -gt 0 ] && echo "NOTE: $N_REVIEWS review answer(s) present but not judged — the review contract declares no Confidence line; requiring one is a review-contract change, not this rule's"
[ -n "$FILES" ] || { echo "NOTE: no verification answer present — nothing to judge (ADR-131: the run plane is disposable)"; exit 0; }

# Epoch seconds, BSD then GNU. A file whose mtime cannot be read is judged (fails closed).
mtime_of() {
    stat -f %m "$1" 2>/dev/null || stat -c %Y "$1" 2>/dev/null || echo 0
}
# Instant → epoch: ISO-8601 UTC first, then a bare date; an unparseable cutoff falls back to the
# compiled default rather than judging history.
cutoff_epoch() {
    date -j -f %Y-%m-%dT%H:%M:%SZ "$1" +%s 2>/dev/null || date -d "$1" +%s 2>/dev/null || \
        date -j -f %Y-%m-%d "$1" +%s 2>/dev/null || echo ""
}
CUTOFF=""
[ "$USE_SINCE" = 1 ] && CUTOFF="$(cutoff_epoch "$SINCE")"

gap_re='unverif|not (yet )?(run|verified|tested|checked|confirmed|reproduced)|missing|could not|unable to|assumed|inferred|no evidence|unknown|not available|left untested'

errors=0
judged=0
debt=0

for f in $FILES; do
    [ -f "$f" ] || continue
    [ -s "$f" ] || continue
    # Only an answer that ASSERTS an outcome is in scope.
    grep -qiE '^[[:space:]]*\**Verdict:\**' "$f" || continue
    if [ -n "$CUTOFF" ]; then
        m="$(mtime_of "$f")"
        if [ "$m" -lt "$CUTOFF" ] 2>/dev/null; then
            debt=$((debt + 1))
            continue
        fi
    fi
    judged=$((judged + 1))
    out="$(awk -v file="$f" -v gap_re="$gap_re" '
        # Escape-free by design: BWK awk dynamic-regex `\.` handling is unreliable, and
        # over-accepting here weakens one arm rather than producing a wrong finding.
        function is_cite(line,   i, exts, e) {
            if (index(line, "://") > 0) return 1
            if (line ~ /[A-Za-z0-9_.\/-]+:[0-9]+/) return 1
            e = "ts tsx js jsx mjs json yaml yml md sh py sql toml txt lock"
            n = split(e, exts, " ")
            for (i = 1; i <= n; i++) if (index(line, "." exts[i]) > 0) return 1
            return 0
        }
        {
            line = $0
            if (tolower(line) ~ /(^|[^a-z])confidence:/) {
                if (match(line, /(HIGH|MEDIUM|LOW)/)) {
                    conf += 1
                    if (level == "") { level = substr(line, RSTART, RLENGTH); levelline = NR }
                } else {
                    bad_enum += 1
                    printf "INVALID: %s:%d: `Confidence:` line is outside HIGH|MEDIUM|LOW — %s\n", file, NR, substr(line, 1, 70)
                }
            }
            if (is_cite(line)) cites += 1
            if (tolower(line) ~ gap_re) gaps += 1
        }
        END {
            if (bad_enum > 0) bad = 1
            if (conf != 1) {
                printf "INVALID: %s: answer asserts a verdict but carries %d Confidence: HIGH|MEDIUM|LOW line(s) (want exactly 1)\n", file, conf
                bad = 1
            } else if (level == "HIGH" && cites == 0) {
                printf "INVALID: %s:%d: answer claims Confidence: HIGH but cites no evidence (want >=1 path:line, repo path, or URL)\n", file, levelline
                bad = 1
            } else if ((level == "MEDIUM" || level == "LOW") && cites == 0 && gaps == 0) {
                printf "INVALID: %s:%d: answer claims Confidence: %s, cites nothing and names no gap — state what is unverified\n", file, levelline, level
                bad = 1
            }
            exit bad
        }
    ' "$f")" || errors=$((errors + 1))
    [ -n "$out" ] && printf '%s\n' "$out"
done

[ "$debt" -gt 0 ] && echo "NOTE: $debt pre-cutoff answer(s) (older than $SINCE) reported as debt, not judged — run with --no-since for the full pre-rule set"
[ "$errors" -eq 0 ] || exit 1
echo "OK: $judged answer artifact(s) judged, all declaring an earned confidence level"
