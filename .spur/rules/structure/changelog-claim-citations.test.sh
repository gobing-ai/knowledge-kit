#!/bin/sh
# Falsification cases for `changelog-claim-citations.sh`
# (rules `changelog-claim-citations-resolve` and `changelog-records-no-confidence-level`).
#
#   sh .spur/rules/structure/changelog-claim-citations.test.sh   # 0 = every case behaved
#
# Each case is a small CHANGELOG-shaped fixture plus the exit status the checker must produce.  A case
# failing here means the gate stopped refusing an uncited or unresolvable claim, started refusing a
# filing bullet or an old release section, or lost the ADR-138 arm.
set -u

checker="$(dirname "$0")/changelog-claim-citations.sh"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

pass=0
fail=0

# case <name> <want-exit>  — fixture on stdin
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
    if [ "$got" = "$want" ]; then
        pass=$((pass + 1))
        printf 'ok   %s\n' "$name"
    else
        fail=$((fail + 1))
        printf 'FAIL %s: want exit %s, got %s\n' "$name" "$want" "$got"
        sed 's/^/     /' "$tmp/$name.out"
    fi
}

# 1. A claim bullet with a resolving anchor.
case_check cited-claim 0 <<'EOF'
## [0.1.6] - 2026-10-20

### Added

- feat(kk): add the `kk stage audio-quality` diagnostic (6381a52a)
<!-- src: .spur/rules/README.md:1 -->
EOF

# 2. The same bullet with no annotation — the defect the rule exists for.
case_check uncited-claim 1 <<'EOF'
## [0.1.6] - 2026-10-20

### Added

- feat(kk): add the `kk stage audio-quality` diagnostic (6381a52a)
EOF

# 3. A filing bullet carries no claim signal, so it needs no anchor.
case_check filing-bullet-needs-none 0 <<'EOF'
## [0.1.6] - 2026-10-20

### Changed

- docs: record the first live scheduled tick on the mac mini (c6f7ba24)
EOF

# 4. A date is not a semantic version: this filing must not be read as a claim.
case_check date-is-not-a-version 0 <<'EOF'
## [0.1.6] - 2026-10-20

### Changed

- docs(dogfood): index the 2026-10-20 daily-voice findings (868daba2)
EOF

# 5. An anchor naming a file that does not exist.
case_check unresolvable-anchor 1 <<'EOF'
## [0.1.6] - 2026-10-20

- fix(cli): keep the TypeSafe response readable (1ee84e1f)
<!-- src: apps/cli/src/no-such-file.ts:12 -->
EOF

# 6. A `:line` past the end of the cited file.
case_check line-out-of-range 1 <<'EOF'
## [0.1.6] - 2026-10-20

- fix(cli): keep the TypeSafe response readable (1ee84e1f)
<!-- src: .spur/rules/README.md:9999 -->
EOF

# 7. An external claim citing the official URL is acceptable.
case_check url-anchor 0 <<'EOF'
## [0.1.6] - 2026-10-20

- fix(cli): keep the TypeSafe response readable under `@typesafe-ai/sdk` 0.7.0 (1ee84e1f)
<!-- src: https://example.com/sdk-0.7.0/changelog -->
EOF

# 8. Two annotations under one bullet.
case_check duplicate-annotation 1 <<'EOF'
## [0.1.6] - 2026-10-20

- feat(kk): add the diagnostic stage (6381a52a)
<!-- src: .spur/rules/README.md:1 -->
<!-- src: .spur/rules/README.md:2 -->
EOF

# 9. An annotation floating free of any bullet.
case_check orphan-annotation 1 <<'EOF'
## [0.1.6] - 2026-10-20

### Added

<!-- src: .spur/rules/README.md:1 -->

- feat(kk): add the diagnostic stage (6381a52a)
<!-- src: .spur/rules/README.md:1 -->
EOF

# 10. One comment holding two anchors.
case_check multiple-anchors 1 <<'EOF'
## [0.1.6] - 2026-10-20

- feat(kk): add the diagnostic stage (6381a52a)
<!-- src: .spur/rules/README.md:1, .spur/rules/README.md:2 -->
EOF

# 11. ADR-138: no confidence level on a changelog claim.
case_check confidence-level-recorded 1 <<'EOF'
## [0.1.6] - 2026-10-20

- feat(kk): add the diagnostic stage (6381a52a)
<!-- src: .spur/rules/README.md:1 -->

- Confidence: HIGH — every claim cites a checked-in artifact.
EOF

# 12. Older sections are history, not defects: the pre-ADR-138 convention stays untouched.
case_check old-section-confidence-ignored 0 <<'EOF'
## [0.1.6] - 2026-10-20

- feat(kk): add the diagnostic stage (6381a52a)
<!-- src: .spur/rules/README.md:1 -->

## [0.1.5] - 2026-10-19

### Added

- feat(store): label items through an in-process decision hub (c68c2008)

- Confidence: HIGH — coverage and mapping reconcile against `git log`.
EOF

# 13. The two arms are independent: a confidence finding must not be reported by the citations arm.
file="$tmp/arm-split.md"
cat >"$file" <<'EOF'
## [0.1.6] - 2026-10-20

- feat(kk): add the diagnostic stage (6381a52a)
<!-- src: .spur/rules/README.md:1 -->

- Confidence: HIGH — every claim cites a checked-in artifact.
EOF
if sh "$checker" --citations-only "$file" >/dev/null 2>&1; then
    pass=$((pass + 1)); printf 'ok   arm-split-citations\n'
else
    fail=$((fail + 1)); printf 'FAIL arm-split-citations: the citations arm reported an ADR-138 issue\n'
fi
if sh "$checker" --confidence-only "$file" >/dev/null 2>&1; then
    fail=$((fail + 1)); printf 'FAIL arm-split-confidence: the confidence arm missed a recorded level\n'
else
    pass=$((pass + 1)); printf 'ok   arm-split-confidence\n'
fi

# 14. And an uncited claim must not be reported by the confidence arm.
file="$tmp/arm-split-2.md"
cat >"$file" <<'EOF'
## [0.1.6] - 2026-10-20

- feat(kk): add the `kk stage audio-quality` diagnostic (6381a52a)
EOF
if sh "$checker" --confidence-only "$file" >/dev/null 2>&1; then
    pass=$((pass + 1)); printf 'ok   arm-split-confidence-ignores-citations\n'
else
    fail=$((fail + 1)); printf 'FAIL arm-split-confidence-ignores-citations\n'
fi

# 15. POSITIVE CONTROL on the real file this rule ships against.
if sh "$checker" >"$tmp/repo.out" 2>&1; then
    pass=$((pass + 1))
    printf 'ok   real-changelog\n'
else
    fail=$((fail + 1))
    printf 'FAIL real-changelog: the shipped CHANGELOG.md does not satisfy its own rule\n'
    sed 's/^/     /' "$tmp/repo.out"
fi

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ] || exit 1
