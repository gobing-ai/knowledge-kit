#!/bin/sh
# Verdict confidence proof check (rule `durable-verdict-carries-confidence-proof`).
#
# Runnable by hand — the rule's own message points here, because the `exit-code` evaluator reports
# only the exit status, not this script's output:
#
#   sh .spur/rules/structure/verdict-confidence-proof.sh                    # 0 = ok, 1 = findings
#   sh .spur/rules/structure/verdict-confidence-proof.sh --no-backlog       # negative control
#   sh .spur/rules/structure/verdict-confidence-proof.sh <task.md> …        # explicit files
#   sh .spur/rules/structure/verdict-confidence-proof.sh --artifacts-dir=<dir>  # alternate artifact root
#   sh .spur/rules/structure/verdict-confidence-proof.test.sh               # falsification cases
#
# The confidence level a verification asserts (HIGH/MEDIUM/LOW) is re-checkable only while the run is
# live: the verify-answer lint rejects an unearned HIGH and the completion guards apply the operator's
# LOW acknowledgement. The durable plane kept the LEVEL but not the row that certified it — measured
# 2026-10-10: 0 of 50 durable verdict artifacts carried a `confidence` check row, so a reader or a
# later gate could not re-check the claim. The harness now persists it (the verdict derivation owns
# the row; the record mirror injects an earned `pass` row into the copy it retains), and this rule
# keeps it that way.
#
# Contract, for every task at `done`/`testing` that HAS a durable verdict artifact:
#
#   1. when the artifact declares `confidence` HIGH or MEDIUM, a `confidence` check row must be
#      present, its `status` must be `pass` or `warn`, and its `evidence` must name the level;
#   2. when the artifact carries a `proof` object, `digest` must be `sha256:<64 hex>` and `runId`
#      non-empty — a half-bound proof is not evidence that the certification happened.
#
# Out of scope, deliberately:
#   * a LOW or absent level — retention may not restate what the completion guards refuse (an injected
#     `warn` row aggregates to PARTIAL and could contradict a stored PASS);
#   * tasks with no durable artifact — 176 of 226 done/testing tasks here predate the evidence plane,
#     and evidence recoverability is the feature check's invariant, not this rule's;
#   * tasks that are not `done`/`testing`.
#
# The pre-rule backlog below is debt, not a licence: it may only shrink, and a pair is retired by
# recording the task again (the harness then writes the row) — not by editing the artifact by hand.
set -u

ARTIFACTS_DIR=.spur/memory/evidence
USE_BACKLOG=1
ARGS=""
for arg in "$@"; do
    case "$arg" in
        --artifacts-dir=*) ARTIFACTS_DIR="${arg#--artifacts-dir=}" ;;
        --no-backlog) USE_BACKLOG=0 ;;
        *) ARGS="$ARGS
$arg" ;;
    esac
done

backlog="$(cat <<'EOF'
0183
0184
0185
0186
0187
0188
0191
0192
0193
0194
0199
0200
0201
0202
0203
0204
0205
0206
0207
0208
0209
0210
0211
0212
0213
0214
0215
0216
0217
0218
0219
0220
0221
0225
0226
0227
0228
0229
0230
0235
0236
0237
0238
0239
0240
0241
0242
EOF
)"
# `<wbs>` keys, space-joined for a case-match membership test.
backlog_keys="$(printf '%s' "$backlog" | tr '\n' ' ')"

findings=""
report() {
    findings="$findings$1
"
}

if [ -n "$ARGS" ]; then
    list="$(printf '%s' "$ARGS" | sed '/^$/d')"
else
    list="$(rg --files -g 'docs/tasks*/**/*.md' . 2>/dev/null || find docs -path 'docs/tasks*' -name '*.md' 2>/dev/null)"
fi
if [ -z "$list" ]; then
    echo "INVALID: no task files found — the confidence-proof contract has nothing to check (expected docs/tasks*/**/*.md)"
    exit 1
fi
command -v jq >/dev/null 2>&1 || {
    echo "INVALID: jq is not on PATH — refusing to report a clean corpus without the artifact reader"
    exit 1
}

while IFS= read -r f; do
    [ -n "$f" ] || continue
    wbs="$(basename "$f" | cut -c1-4)"
    case "$wbs" in
        [0-9][0-9][0-9][0-9]) ;;
        *) continue ;;
    esac
    status="$(awk 'BEGIN { fm = 1 } /^## / { fm = 0 } fm && /^status:/ { print $2; exit }' "$f" 2>/dev/null)"
    case "$status" in
        done|testing) ;;
        *) continue ;;
    esac
    artifact="$ARTIFACTS_DIR/$wbs-verdict.json"
    [ -f "$artifact" ] || continue
    if ! jq -e . "$artifact" >/dev/null 2>&1; then
        report "MALFORMED $wbs ($artifact is not readable JSON)"
        continue
    fi
    level="$(jq -r '.confidence // empty' "$artifact" 2>/dev/null)"
    case "$level" in
        HIGH|MEDIUM) ;;
        *) continue ;; # LOW/absent level: the completion guards' decision, not retention's
    esac
    if [ "$USE_BACKLOG" -eq 1 ]; then
        case " $backlog_keys " in
            *" $wbs "*) continue ;;
        esac
    fi
    row="$(jq -c '[.checks[]? | select(type == "object" and .name == "confidence")] | first // empty' "$artifact" 2>/dev/null)"
    if [ -z "$row" ]; then
        report "MISS $wbs no confidence check row ($artifact declares $level)"
    else
        row_status="$(printf '%s' "$row" | jq -r '.status // ""')"
        case "$row_status" in
            pass|warn) ;;
            *) report "MISS $wbs confidence row status '$row_status' is not pass|warn ($artifact)" ;;
        esac
        if ! printf '%s' "$row" | jq -r '.evidence // ""' | grep -q "$level"; then
            report "MISS $wbs confidence row does not name the level $level ($artifact)"
        fi
    fi
    if jq -e 'has("proof")' "$artifact" >/dev/null 2>&1; then
        digest="$(jq -r '.proof.digest // ""' "$artifact")"
        run_id="$(jq -r '.proof.runId // ""' "$artifact")"
        case "$digest" in
            sha256:*) [ "${#digest}" -eq 71 ] || report "MISS $wbs proof digest is not a full sha256 value ($artifact)" ;;
            *) report "MISS $wbs proof block carries no sha256 digest ($artifact)" ;;
        esac
        [ -n "$run_id" ] || report "MISS $wbs proof block carries no runId ($artifact)"
    fi
done <<EOF
$list
EOF

if [ -n "$findings" ]; then
    printf '%s' "$findings" | sed '/^$/d'
    echo "---" >&2
    echo "verdict-confidence-proof: $(printf '%s' "$findings" | sed '/^$/d' | wc -l | tr -d ' ') durable verdict(s) declare a confidence level without the proof that certified it (1156). Re-record the task so the harness writes the row, or add the task to the pre-rule backlog if it predates the fix." >&2
    exit 1
fi
exit 0
