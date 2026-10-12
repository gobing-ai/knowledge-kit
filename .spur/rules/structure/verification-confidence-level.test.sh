#!/bin/sh
# Falsification cases for `verification-confidence-level.sh` (rule
# `verification-block-carries-confidence-level`).
#
#   sh .spur/rules/structure/verification-confidence-level.test.sh   # 0 = every case behaved
#
# Each case is a fixture document with a `Verification (` block, plus the exit status the checker must
# produce for it. A case failing here means the rule stopped enforcing the earned-level contract.
set -u

checker="$(dirname "$0")/verification-confidence-level.sh"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

pass=0
fail=0

# case <name> <want-exit> <document>
case_check() {
    name="$1"
    want="$2"
    file="$tmp/$name.md"
    cat >"$file"
    if sh "$checker" "$file" >"$tmp/$name.out" 2>&1; then
        got=0
    else
        got=1
    fi
    if [ "$got" -eq "$want" ]; then
        pass=$((pass + 1))
        printf 'ok   %-28s exit=%s\n' "$name" "$got"
    else
        fail=$((fail + 1))
        printf 'FAIL %-28s want exit=%s got %s\n' "$name" "$want" "$got"
        sed 's/^/     /' "$tmp/$name.out"
    fi
}

# A HIGH claim must cite evidence.
case_check high-no-citation 1 <<'EOF'
<!--
Verification (2026-01-01, some-procedure): HIGH
- I ran the suite and it passed.
- Confidence: HIGH — everything reconciles.
-->
EOF

case_check high-with-path-line 0 <<'EOF'
<!--
Verification (2026-01-01, some-procedure): HIGH
- The guard is plugins/publishings/wechatmp-pub/src/flow.ts:657 and the test is tests/flow.test.ts:12.
- Confidence: HIGH — the citation is a checked-in path:line.
-->
EOF

case_check high-with-url 0 <<'EOF'
<!--
Verification (2026-01-01, some-procedure): HIGH
- See https://example.com/spec for the upstream contract.
- Confidence: HIGH — cited upstream.
-->
EOF

# A low-confidence claim must cite or name its gap.
case_check medium-empty 1 <<'EOF'
<!--
Verification (2026-01-01, some-procedure): MEDIUM
- Looks fine to me.
- Confidence: MEDIUM — reasons.
-->
EOF

case_check medium-names-gap 0 <<'EOF'
<!--
Verification (2026-01-01, some-procedure): MEDIUM
- The unit suite is green; the live path is unverified (needs an operator login).
- Confidence: MEDIUM — the untested path is named.
-->
EOF

case_check low-cites 0 <<'EOF'
<!--
Verification (2026-01-01, some-procedure): LOW
- Only plugins/kk/scripts/kk-workflow-stages.ts was read.
- Confidence: LOW — reading only.
-->
EOF

# The pre-existing contract still holds.
case_check missing-confidence-line 1 <<'EOF'
<!--
Verification (2026-01-01, some-procedure): HIGH
- src/a.ts:1 is the evidence.
-->
EOF

case_check two-confidence-lines 1 <<'EOF'
<!--
Verification (2026-01-01, some-procedure): HIGH
- src/a.ts:1 is the evidence.
- Confidence: HIGH — one.
- Confidence: LOW — two.
-->
EOF

case_check level-outside-enum 1 <<'EOF'
<!--
Verification (2026-01-01, some-procedure): SURE
- src/a.ts:1 is the evidence.
- Confidence: SURE — not an allowed level.
-->
EOF

# --- verification records (docs/tasks/**) — the level the pipeline writes into `## Testing` ---

case_check record-level-misspelled 1 <<'EOF'
# 0099 — a task file

## Testing

- Verdict: PASS
- Confidence: High — wrong case is not in the enum.
- Evidence: `plugins/kk/scripts/daily-stages.ts:583`.
EOF

case_check record-high-without-citation 1 <<'EOF'
# 0099 — a task file

## Testing

- Verdict: PASS
- Confidence: HIGH
- Everything passed and nothing else to say.
EOF

case_check record-medium-names-gap 0 <<'EOF'
# 0099 — a task file

## Testing

- Verdict: PARTIAL
- Confidence: MEDIUM — the live run was not run; see the gap above.
EOF

case_check record-bold-form-cited 0 <<'EOF'
# 0099 — a task file

## Testing

- Verdict: PASS
- **Confidence:** HIGH — verified at `apps/cli/tests/voice2-dag.test.ts:1`.
EOF

case_check record-minconfidence-is-not-a-level 0 <<'EOF'
# 0099 — a task file

## Testing

- Verdict: PASS
- The catalog `minConfidence: 0` stays, and `raw_confidence` is unaffected.
EOF

case_check record-level-outside-testing-is-not-judged 0 <<'EOF'
# 0099 — a task file

## Q&A

- A reviewer asked about Confidence: HIGH in prose, outside the verification record.
EOF

# --- mentions are not claims (check 2 strips inline code before matching) ---
case_check mention-in-inline-code-is-not-a-claim 0 <<'EOF'
### Background

The answer rule judges verification answers: an answer that asserts a verdict must carry exactly one
`Confidence:` line, and the review contract declares one too. Quote the token when describing it.
EOF

case_check bare-non-enum-claim-is-flagged 1 <<'EOF'
## Testing

Confidence: CERTAIN — every requirement was re-checked by hand.
EOF

# --- the level must BE a level, not merely contain one (measured 2026-10-12) ---
# The substring form read `HIGHWAY` as HIGH in both planes and certified the record; the whole-word
# guard is what refuses it. `exact-level-still-certifies` is the positive control for the tightening.
case_check block-level-with-suffix 1 <<'EOF'
<!--
Verification (2026-01-01, some-procedure): HIGH
- The guard is plugins/publishings/wechatmp-pub/src/flow.ts:657.
- Confidence: HIGHWAY — a suffix must not read as HIGH.
-->
EOF

case_check testing-level-with-suffix 1 <<'EOF'
## Testing

Confidence: MEDIUM-rare — the unit suite is green.
EOF

case_check exact-level-still-certifies 0 <<'EOF'
<!--
Verification (2026-01-01, some-procedure): HIGH
- The guard is plugins/publishings/wechatmp-pub/src/flow.ts:657.
- Confidence: HIGH — the citation is a checked-in path:line.
-->
EOF

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ] || exit 1
