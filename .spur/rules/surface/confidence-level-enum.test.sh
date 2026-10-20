#!/bin/sh
# Falsification cases for `confidence-level-enum.sh` (rule
# `confidence-level-vocabulary-consistent`).
#
#   sh .spur/rules/surface/confidence-level-enum.test.sh   # 0 = every case behaved
#
# Each case is a fixture naming the closed HIGH|MEDIUM|LOW vocabulary in one of the three shapes the
# checker discovers, plus the exit status it must produce. A case failing here means the rule stopped
# refusing a drifted vocabulary, started refusing a legitimate partial predicate, or lost its
# vacuity arm (the one that catches the checker's own idioms going stale).
set -u

checker="$(dirname "$0")/confidence-level-enum.sh"
repo="$(cd "$(dirname "$0")/../../.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

pass=0
fail=0

# case <name> <want-exit> <extension>   — fixture body on stdin
case_check() {
    name="$1"
    want="$2"
    ext="$3"
    file="$tmp/$name.$ext"
    cat >"$file"
    if sh "$checker" "$file" >"$tmp/$name.out" 2>&1; then
        got=0
    else
        got=1
    fi
    if [ "$got" = "$want" ]; then
        pass=$((pass + 1))
        printf 'ok   %s\n' "$name"
    else
        fail=$((fail + 1))
        printf 'FAIL %s: want exit %s, got %s\n' "$name" "$want" "$got"
        sed 's/^/     /' "$tmp/$name.out"
    fi
}

# 1. The healthy declaration — the shape both real vocabularies use.
case_check declared-all-three 0 ts <<'EOF'
export const CONFIDENCE_LEVELS = ['HIGH', 'MEDIUM', 'LOW'] as const;
EOF

# 2. A declaration that drops a level: the fail-closed-forever producer.
case_check declared-two-only 1 ts <<'EOF'
export const LABEL_CONFIDENCE_LEVELS = ['HIGH', 'MEDIUM'] as const;
EOF

# 3. A declaration that invents a fourth level: a verdict no guard accepts.
case_check declared-extra-level 1 ts <<'EOF'
export const CONFIDENCE_LEVELS = ['HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'] as const;
EOF

# 4. The jq guard this repo's label and judge accept-edges use.
case_check guard-all-three 0 yaml <<'EOF'
          test "$(jq -r 'if (.verdict // "") == "PASS" then (.verdict + (if ((.confidence // "") | test("^(HIGH|MEDIUM|LOW)$")) then "" else "!" end)) else (.verdict // "") end' "${vars.f}" 2>/dev/null)" = PASS ||
EOF

# 5. A guard narrowed to two levels refuses every honest LOW answer — the kk-collect regression.
case_check guard-two-only 1 yaml <<'EOF'
          test "$(jq -r 'if (.verdict // "") == "PASS" then (.verdict + (if ((.confidence // "") | test("^(HIGH|MEDIUM)$")) then "" else "!" end)) else (.verdict // "") end' "${vars.f}" 2>/dev/null)" = PASS ||
EOF

# 6. The comparison chain in the guard helpers, with its identifier on the line above (the real
# shape: `isConfidenceLevel(value) { return value === 'HIGH' || … }`).
case_check chain-all-three 0 ts <<'EOF'
export function isConfidenceLevel(value: unknown): boolean {
    return value === 'HIGH' || value === 'MEDIUM' || value === 'LOW';
}
EOF

# 7. A chain missing a level.
case_check chain-two-only 1 ts <<'EOF'
export function isConfidenceLevel(value: unknown): boolean {
    return value === 'HIGH' || value === 'MEDIUM';
}
EOF

# 8. NEGATIVE CONTROL — a one-level predicate is a legitimate partial check, not a vocabulary.
case_check chain-single-level-is-not-a-site 1 ts <<'EOF'
    const needsLevel = verdictJson.confidence !== 'LOW';
EOF

# 9. VACUITY ARM — no recognisable site means the checker can vouch for nothing.
case_check vacuous 1 ts <<'EOF'
export const SOMETHING_ELSE = 1;
EOF

# 10. POSITIVE CONTROL on the real corpus: the tree this rule ships in must pass.
if sh "$checker" >"$tmp/repo.out" 2>&1; then
    pass=$((pass + 1))
    printf 'ok   real-corpus\n'
else
    fail=$((fail + 1))
    printf 'FAIL real-corpus: the working tree does not satisfy its own rule\n'
    sed 's/^/     /' "$tmp/repo.out"
fi

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ] || exit 1
