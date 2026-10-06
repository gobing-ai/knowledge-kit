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

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ] || exit 1
