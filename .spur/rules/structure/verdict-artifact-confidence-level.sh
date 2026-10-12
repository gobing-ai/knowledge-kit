#!/bin/sh
# Verdict-artifact confidence check (rule `verdict-artifact-asserts-confidence-level`).
#
# Runnable by hand — the rule's own message points here, because the `exit-code` evaluator reports
# only the exit status, not this script's output:
#
#   sh .spur/rules/structure/verdict-artifact-confidence-level.sh            # 0 = ok, 1 = findings
#   sh .spur/rules/structure/verdict-artifact-confidence-level.sh <file>…    # explicit artifacts (and .yaml workflow files)
#   sh .spur/rules/structure/verdict-artifact-confidence-level.sh --no-since # judge pre-cutoff artifacts too
#   sh .spur/rules/structure/verdict-artifact-confidence-level.sh --run-dir=<dir> --workflows=<dir>
#   sh .spur/rules/structure/verdict-artifact-confidence-level.test.sh       # falsification cases
#
# Engine-level smoke test (watched to fire, not just inspected): the checker self-discovers its
# corpus, so a fixture under `.spur/rules/fixtures/` needs a fixture-scoped rule copy that passes the
# fixture path as an argument — `sh` this checker with
# `.spur/rules/fixtures/verdict-artifact-asserts-confidence-level/should-{fire,pass}.json` and expect
# exit 1 then exit 0.
#
# WHY THIS EXISTS. Four sibling rules already gate a claimed confidence level: the `Verification (`
# block and the `## Testing` record (`verification-block-carries-confidence-level`), the durable
# verdict artifact (`durable-verdict-carries-confidence-proof`), the `.spur/run/` verification ANSWER
# (`verification-answer-carries-confidence-level`), and the API/library claim table
# (`api-library-claim-cites-source-and-confidence`). The uncovered surface is the VERDICT ARTIFACT
# itself — `.spur/run/**/*verdict*.json`, the machine-readable record `spur task verdict` writes and
# the kk judge writes (`verdict-<step>.json`, `.itc-verdict.json`, `*_judge_verdict.json`). Measured
# in this repo on 2026-10-12: 297 such artifacts, of which the 179 written before 2026-10-05 carry
# `{"verdict":"PASS"}` with no `confidence` field at all, while every artifact from 2026-10-09 onward
# carries one. So a PASS could be produced without a level and nothing re-read the artifact — the same
# class the sibling rules close for the surfaces they own.
#
# SCOPE, three deliberate rules of construction.
#
#  1. ONLY `PASS` IS JUDGED. A confidence level is what makes a PASS usable: the kk guards normalize
#     an out-of-contract PASS to `PASS!` and fail closed, and the verify grammar requires a level for
#     a PASS. `FAIL`/`NEEDS_REVISION` need no level to be actionable, so they are counted as
#     out-of-scope rather than judged — requiring one would fail compliant non-PASS artifacts.
#
#  2. PRESENCE IS NEVER REQUIRED. `.spur/run/` is a disposable plane (ADR-131), so demanding an
#     artifact would fail after any cleanup. This rule judges the files that exist: an artifact that
#     asserts PASS must declare its level. An absent file, an empty file, and a JSON document with no
#     `verdict` field are all out of scope.
#
#  3. A CUTOFF, NOT A 179-ENTRY BACKLOG. The sibling `durable-verdict-carries-confidence-proof` rule
#     grandfathers pre-rule debt in an explicit list; that list is useless for a plane with ~300
#     files and growing every run. Artifacts older than the adoption instant are reported as one count
#     line and not judged, so the rule is green on history and enforcing from adoption onward.
#     `--no-since` exposes the full pre-rule set. The cutoff is an exact UTC timestamp, not a date, so
#     an artifact a concurrent session wrote earlier today is debt rather than a finding.
#
# WHY THE DURABLE PLANE IS OUT OF SCOPE. `.spur/memory/evidence/<wbs>-verdict.json` is the sibling
# `durable-verdict-carries-confidence-proof` rule's surface, and its contract is different in kind
# (it requires the confidence CHECK ROW and the proof binding, not the top-level field). Both planes
# are written by the same producer, so a producer regression is caught here first, at the earlier
# plane; a second rule over the durable plane would duplicate that coverage at a different severity.
#
# WHY THE WORKFLOW CONSUMER GUARD IS IN SCOPE. A level on the artifact is worthless if the reader
# ignores it: each kk workflow guard reads a judge PASS through a confidence-aware `jq` filter that
# turns an out-of-contract PASS into `PASS!` so it cannot reach publish. That cross-module contract
# (`plugins/kk/skills/content-judge/SKILL.md` § confidence, enforced today by
# `plugins/kk/tests/verdict-confidence.test.ts`) is checked here as text, so a guard edited by hand
# is refused by the gate rather than by a reviewer. The byte-identical twins under
# `apps/cli/plugins/kk/workflows/` are generated and are covered by the repo's paired-file parity
# test, not duplicated here.
#
# Contract, for each in-scope artifact: `verdict` uppercases to `PASS` implies `confidence` is
# exactly one of `HIGH|MEDIUM|LOW` (uppercase — the same test the workflow guards apply, so this rule
# never green-lights a PASS the reader would refuse). For each in-scope workflow file: a line that
# reads a verdict with `jq` and compares it to `"PASS"` must also carry the `(HIGH|MEDIUM|LOW)` test.
#
# Named limitation: the consumer half is a per-LINE text check, so it catches the compact guard shape
# the corpus actually uses (read and compare in one `jq` filter) and a one-line `read; [ … = PASS ]`
# form. A guard that reads `.verdict` on one line and compares the variable to `PASS` on a later line
# is out of scope — catching it needs dataflow, not a text rule, and a rule that guessed would fire on
# unrelated reads.
#
# Repair: re-record the task so the harness writes the level (`spur task verdict`), or re-run the
# judge for a kk verdict — never delete the evidence, and never widen this rule.
set -u

SINCE="2026-10-12T02:30:00Z"   # adoption instant (UTC), shared with the sibling confidence rules
USE_SINCE=1
RUN_DIR=".spur/run"
WF_DIR="plugins/kk/workflows"
FILES=""
WF_FILES=""
EXPLICIT=0

for arg in "$@"; do
    case "$arg" in
        --no-since) USE_SINCE=0 ;;
        --since=*) SINCE="${arg#--since=}" ;;
        --run-dir=*) RUN_DIR="${arg#--run-dir=}" ;;
        --workflows=*) WF_DIR="${arg#--workflows=}" ;;
        *.yaml|*.yml) WF_FILES="$WF_FILES $arg"; EXPLICIT=1 ;;
        *) FILES="$FILES $arg"; EXPLICIT=1 ;;
    esac
done

# Explicit arguments are the entire scope — a smoke test must be able to point both halves at a
# fixture without the repo corpus leaking into the result.
if [ "$EXPLICIT" = 0 ]; then
    if [ -d "$RUN_DIR" ]; then
        FILES="$(find "$RUN_DIR" -type f -name '*verdict*.json' 2>/dev/null | sort | tr '\n' ' ')"
    fi
    WF_FILES="$(ls "$WF_DIR"/*.yaml 2>/dev/null | tr '\n' ' ')"
fi

errors=0
judged=0
debt=0
nopass=0
unparsable=0

HAS_JQ=1
command -v jq >/dev/null 2>&1 || HAS_JQ=0

# Epoch seconds, BSD then GNU. An artifact whose mtime cannot be read is judged (fails closed).
mtime_of() {
    stat -f %m "$1" 2>/dev/null || stat -c %Y "$1" 2>/dev/null || echo 0
}
# Instant → epoch: ISO-8601 UTC first, then a bare date; an unparseable cutoff falls back to the
# compiled default rather than judging history.
cutoff_epoch() {
    date -j -f %Y-%m-%dT%H:%M:%SZ "$1" +%s 2>/dev/null || date -d "$1" +%s 2>/dev/null ||
        date -j -f %Y-%m-%d "$1" +%s 2>/dev/null || echo ""
}
CUTOFF=""
[ "$USE_SINCE" = 1 ] && CUTOFF="$(cutoff_epoch "$SINCE")"

# --- half A: the verdict artifacts themselves ---

level_of() {
    jq -r 'if type == "object" then (.confidence // "") else "" end' "$1" 2>/dev/null
}

if [ "$HAS_JQ" = 0 ]; then
    echo "SKIP: jq not on PATH — verdict artifacts not judged (the workflow guard half still runs)"
else
    for f in $FILES; do
        [ -f "$f" ] || continue
        [ -s "$f" ] || continue
        # Only a JSON object that asserts a verdict is in scope; anything else is out of scope.
        if v="$(jq -r 'if type == "object" then (.verdict // "") else "" end' "$f" 2>/dev/null)"; then
            :
        else
            unparsable=$((unparsable + 1))
            continue
        fi
        upper="$(printf '%s' "$v" | tr '[:lower:]' '[:upper:]')"
        [ "$upper" = "PASS" ] || { nopass=$((nopass + 1)); continue; }
        if [ -n "$CUTOFF" ]; then
            m="$(mtime_of "$f")"
            if [ "$m" -lt "$CUTOFF" ] 2>/dev/null; then
                debt=$((debt + 1))
                continue
            fi
        fi
        judged=$((judged + 1))
        c="$(level_of "$f")"
        case "$c" in
            HIGH|MEDIUM|LOW) ;;
            "")
                printf 'INVALID: %s: artifact asserts PASS but declares no `confidence` — a PASS is only usable with a HIGH|MEDIUM|LOW level\n' "$f"
                errors=$((errors + 1))
                ;;
            *)
                printf 'INVALID: %s: artifact asserts PASS with confidence %s, outside HIGH|MEDIUM|LOW\n' "$f" "$c"
                errors=$((errors + 1))
                ;;
        esac
    done
fi

# --- half B: the workflow consumer guards ---

# Literal `index()` probes only: no regex dialect to get wrong, and the guard text checked for is the
# exact string the workflows use (`.confidence … test("^(HIGH|MEDIUM|LOW)$")`).
if [ -n "$WF_FILES" ]; then
    b_out="$(awk '
        /^[[:space:]]*#/ { next }
        {
            if (index($0, "jq") == 0) next
            if (index($0, ".verdict") == 0) next
            if (index($0, "\"PASS\"") == 0) next
            if (index($0, "(HIGH|MEDIUM|LOW)") != 0) next
            printf "INVALID: %s:%d: reads a judge verdict and compares it to \"PASS\" without the confidence guard — a PASS whose confidence is missing or outside HIGH|MEDIUM|LOW would be accepted here\n", FILENAME, FNR
            bad++
        }
        END { exit (bad > 0) }
    ' $WF_FILES 2>/dev/null)" || true
    if [ -n "$b_out" ]; then
        printf '%s\n' "$b_out"
        b_err="$(printf '%s\n' "$b_out" | grep -c '^INVALID')"
        errors=$((errors + b_err))
    fi
    WF_JUDGED=0
    for y in $WF_FILES; do [ -f "$y" ] && WF_JUDGED=$((WF_JUDGED + 1)); done
else
    WF_JUDGED=0
fi

# --- report ---

[ "$debt" -gt 0 ] && echo "NOTE: $debt pre-cutoff PASS artifact(s) (older than $SINCE) reported as debt, not judged — run with --no-since for the full pre-rule set"
[ "$nopass" -gt 0 ] && echo "NOTE: $nopass artifact(s) assert a non-PASS verdict — out of scope (a level is required for a PASS)"
[ "$unparsable" -gt 0 ] && echo "NOTE: $unparsable file(s) under the run plane are not valid JSON — not verdict artifacts, not judged"

[ "$errors" -eq 0 ] || exit 1
if [ "$judged" -eq 0 ] && [ "$WF_JUDGED" -eq 0 ]; then
    echo "NOTE: no verdict artifact or workflow file present — nothing to judge"
    exit 0
fi
echo "OK: $judged PASS artifact(s) and $WF_JUDGED workflow file(s) judged, every PASS declaring a HIGH|MEDIUM|LOW confidence and every PASS read confidence-aware"
