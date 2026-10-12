#!/bin/sh
# Falsification cases for `review-record-confidence-level.sh` (rule
# `review-record-carries-confidence-level`).
#
#   sh .spur/rules/structure/review-record-confidence-level.test.sh   # 0 = every case behaved
#
# Each case is a fixture task record with (or without) a `## Review` section carrying a confidence
# claim, plus the exit status the checker must produce for it. A case failing here means the rule
# stopped refusing an invented or unearned review level, or started judging a record it must ignore.
set -u

checker="$(dirname "$0")/review-record-confidence-level.sh"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

pass=0
fail=0

# case <name> <want-exit> <record-body>
case_check() {
    name="$1"
    want="$2"
    file="$tmp/$name.md"
    cat >"$file"
    if sh "$checker" "$file" >"$tmp/$name.out" 2>&1; then got=0; else got=1; fi
    if [ "$got" -eq "$want" ]; then
        pass=$((pass + 1)); printf 'ok   %-30s exit=%s\n' "$name" "$got"
    else
        fail=$((fail + 1)); printf 'FAIL %-30s want exit=%s got %s\n' "$name" "$want" "$got"
        sed 's/^/     /' "$tmp/$name.out"
    fi
}

# --- the contract: an enum level, earned ---

case_check high-cited 0 <<'EOF'
### Review

- Verdict: PASS
- Confidence: HIGH — every finding is anchored at apps/cli/src/board/reader.ts:313 and the
  review's probes are quoted in .spur/run/0253-review-report.md.
EOF

case_check medium-names-gap 0 <<'EOF'
### Review

- Verdict: PARTIAL
- Confidence: MEDIUM — the browser mount was not exercised; only the reader HTTP surface was read.
EOF

case_check low-cites 0 <<'EOF'
### Review

- Confidence: LOW — one file was read, `apps/cli/src/board/itc.ts:307`; nothing was run.
EOF

case_check high-without-citation 1 <<'EOF'
### Review

- Verdict: PASS
- Confidence: HIGH — the review looked thorough and nothing came up.
EOF

case_check medium-neither-cite-nor-gap 1 <<'EOF'
### Review

- Verdict: PARTIAL
- Confidence: MEDIUM — reasons given above.
EOF

case_check level-outside-enum 1 <<'EOF'
### Review

- Verdict: PASS
- Confidence: SURE — not an allowed level.
EOF

case_check level-misspelled 1 <<'EOF'
### Review

- Verdict: PASS
- Confidence: High — wrong case is outside the enum.
EOF

case_check two-levels-takes-the-first 1 <<'EOF'
### Review

- Verdict: PASS
- Confidence: HIGH — apps/cli/tests/board/reader.test.ts:177
- Confidence: LOW — added later without evidence.
EOF

# --- records that are out of scope ---

case_check review-without-level-is-debt 0 <<'EOF'
### Review

- Verdict: PASS

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|---------|
| P4 | — | — | No findings |
EOF

case_check no-review-section-is-untouched 0 <<'EOF'
### Testing

- Verdict: PASS
- Confidence: SURE — this level is the Testing rule's business, not this one.
EOF

case_check testing-level-is-not-a-review-claim 0 <<'EOF'
### Testing

- Verdict: PASS
- Confidence: HIGH — apps/cli/tests/board/reader.test.ts:177

### Review

- Verdict: PASS
EOF

case_check review-level-needs-the-review-body 1 <<'EOF'
### Review

- Verdict: PASS
- Confidence: HIGH

### Testing

- Confidence: HIGH — apps/cli/tests/board/reader.test.ts:177
EOF

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ] || exit 1
