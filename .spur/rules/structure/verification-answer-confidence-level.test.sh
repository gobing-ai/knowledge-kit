#!/bin/sh
# Falsification cases for `verification-answer-confidence-level.sh` (rule
# `verification-answer-carries-confidence-level`).
#
#   sh .spur/rules/structure/verification-answer-confidence-level.test.sh   # 0 = every case behaved
#
# Each case is a fixture answer file, plus the exit status the checker must produce for it — with
# `--no-since` so the fixtures are judged regardless of their mtime. A case failing here means the
# rule stopped enforcing the answer-level contract, or started judging a file it must ignore.
set -u

checker="$(dirname "$0")/verification-answer-confidence-level.sh"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

pass=0
fail=0

# case <name> <want-exit> <answer-file-body>
case_check() {
    name="$1"
    want="$2"
    file="$tmp/$name-verify-answer.txt"
    cat >"$file"
    if sh "$checker" --no-since "$file" >"$tmp/$name.out" 2>&1; then
        got=0
    else
        got=1
    fi
    if [ "$got" -eq "$want" ]; then
        pass=$((pass + 1))
        printf 'ok   %-32s exit=%s\n' "$name" "$got"
    else
        fail=$((fail + 1))
        printf 'FAIL %-32s want exit=%s got %s\n' "$name" "$want" "$got"
        sed 's/^/     /' "$tmp/$name.out"
    fi
}

# --- the contract ---

case_check pass-with-high-cited 0 <<'EOF'
Verdict: PASS
Confidence: HIGH — every requirement rows carries a test; see apps/cli/tests/board/reader.test.ts:88.
### Per-Requirement Traceability
EOF

case_check partial-with-medium-gap 0 <<'EOF'
Verdict: PARTIAL
Confidence: MEDIUM — the browser proof was not run; only the reader HTTP surface was exercised.
EOF

case_check low-cites 0 <<'EOF'
Verdict: FAIL
**Confidence:** LOW — one file was read, `apps/cli/src/board/reader.ts:281`; nothing was executed.
EOF

case_check missing-level 1 <<'EOF'
Verdict: PASS
Confidence: n/a
EOF

case_check no-level-at-all 1 <<'EOF'
Verdict: PASS
| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | apps/cli/tests/board/reader.test.ts:1 |
EOF

case_check high-without-citation 1 <<'EOF'
Verdict: PASS
Confidence: HIGH — everything checked out and the rows look right.
EOF

case_check medium-neither-cite-nor-gap 1 <<'EOF'
Verdict: PARTIAL
Confidence: MEDIUM — reasons given above.
EOF

case_check level-outside-enum 1 <<'EOF'
Verdict: PASS
Confidence: SURE — this is not an allowed level.
EOF

case_check two-levels 1 <<'EOF'
Verdict: PASS
Confidence: HIGH — apps/cli/tests/board/reader.test.ts:1
Confidence: LOW — added later.
EOF

# --- files that are out of scope ---

# A review answer is counted, never judged (its contract declares no Confidence line).
review="$tmp/pipeline-0999-review-answer.txt"
printf 'Verdict: PASS\n## P1 (blocker)\nnone\n' >"$review"
if sh "$checker" --no-since "$review" >"$tmp/review.out" 2>&1; then
    pass=$((pass + 1))
    printf 'ok   %-32s exit=0\n' review-answer-not-judged
else
    fail=$((fail + 1))
    printf 'FAIL %-32s a review answer must not be judged (its contract declares no level)\n' review-answer-not-judged
    sed 's/^/     /' "$tmp/review.out"
fi

case_check no-verdict-line-is-out-of-scope 0 <<'EOF'
# Review log
The runner reported 0 failures; the diff was read.
EOF

case_check empty-file-is-out-of-scope 0 </dev/null

# A `minConfidence: 0` mention is not a level claim (the sibling rule's trap, kept here).
case_check min-confidence-is-not-a-level 0 <<'EOF'
Verdict: PASS
Confidence: HIGH — apps/board/src/shared/collect.ts:93 carries the projection.
The catalog keeps `minConfidence: 0` untouched.
EOF

# --- the cutoff ---
file="$tmp/old-verify-answer.txt"
cat >"$file" <<'EOF'
Verdict: PASS
EOF
touch -t 202001010000 "$file"
if sh "$checker" "$file" >"$tmp/cutoff.out" 2>&1; then    pass=$((pass + 1))
    printf 'ok   %-32s exit=0\n' pre-cutoff-is-debt
else
    fail=$((fail + 1))
    printf 'FAIL %-32s a pre-cutoff answer must be reported as debt, not judged\n' pre-cutoff-is-debt
    sed 's/^/     /' "$tmp/cutoff.out"
fi
if sh "$checker" --no-since "$file" >"$tmp/cutoff2.out" 2>&1; then
    fail=$((fail + 1))
    printf 'FAIL %-32s --no-since must judge the same file and refuse it\n' no-since-judges-debt
else
    pass=$((pass + 1))
    printf 'ok   %-32s exit=1\n' no-since-judges-debt
fi

# --- no artifacts at all: nothing to judge, never a failure ---
if sh "$checker" >"$tmp/none.out" 2>&1; then
    pass=$((pass + 1))
    printf 'ok   %-32s exit=0\n' no-artifacts-is-not-a-finding
else
    fail=$((fail + 1))
    printf 'FAIL %-32s an empty run plane must not fail (ADR-131)\n' no-artifacts-is-not-a-finding
    sed 's/^/     /' "$tmp/none.out"
fi

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ] || exit 1
