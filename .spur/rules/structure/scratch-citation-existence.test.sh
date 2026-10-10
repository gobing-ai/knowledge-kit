#!/bin/sh
# Falsification cases for `scratch-citation-existence.sh` (rule
# `no-dead-run-scoped-citation`).
#
#   sh .spur/rules/structure/scratch-citation-existence.test.sh   # 0 = every case behaved
#
# Each case is a fixture task file plus the exit status the checker must produce for it. Fixtures use
# the reserved WBS 0999 (except the backlog case, which needs a real backlogged pair): a fixture must
# never cite a path the live run itself produces, or the case would pass for the wrong reason. A case
# failing here means the rule stopped enforcing the run-scoped-pointer contract — in either
# direction (a dead pointer admitted, or a legitimate citation/convention refused).
#
# Case 9/10 are the task-0247 negative control: the checker must fire on the PRE-repair 0235/0236
# corpus (from git HEAD) and pass on the repaired working tree.
set -u

checker="$(cd "$(dirname "$0")" && pwd)/scratch-citation-existence.sh"
tmp="$(mktemp -d)"
# Case 7 needs a citation that resolves: park it in the disposable scratch plane and clean it up.
live_pointer=".spur/run/00000000-0000-4000-8000-000000000000-review-answer.txt"
trap 'rm -rf "$tmp"; rm -f "$live_pointer"' EXIT

pass=0
fail=0

# case <name> <want-exit> <fixture-file-name>  — fixture body on stdin
case_check() {
    name="$1"
    want="$2"
    file="$tmp/$3"
    cat >"$file"
    if sh "$checker" "$file" >"$tmp/$name.out" 2>&1; then
        got=0
    else
        got=1
    fi
    if [ "$got" -eq "$want" ]; then
        pass=$((pass + 1))
        printf 'PASS %s (exit %s)\n' "$name" "$got"
    else
        fail=$((fail + 1))
        printf 'FAIL %s (want exit %s, got %s)\n' "$name" "$want" "$got"
        sed 's/^/     | /' "$tmp/$name.out"
    fi
}

# 1. dead check-receipt pointer in a done task -> fires (the 0236 shape)
case_check dead-check-receipt 1 0999-dead-receipt.md <<'EOF'
---
status: done
---
## 0999. fixture

### Testing

Gate receipt: `.spur/run/0999-check-receipt.json` reports PASS.
EOF

# 2. dead run-uuid pointer in a testing task -> fires (the 0235/0236 review-answer shape)
case_check dead-run-uuid 1 0999-dead-uuid.md <<'EOF'
---
status: testing
---
## 0999. fixture

### Review

Full report: `.spur/run/11111111-2222-4333-8444-555555555555-review-answer.txt`.
EOF

# 3. the same dead pointer, line marked OWED -> exempt
case_check line-owed 0 0999-line-owed.md <<'EOF'
---
status: done
---
## 0999. fixture

### Review

Full report `.spur/run/0999-check-receipt.json` is OWED (attended run still pending).
EOF

# 4. the same dead pointer, declared OWED/LOST on another line -> exempt file-wide
case_check file-level-owed 0 0999-file-owed.md <<'EOF'
---
status: done
---
## 0999. fixture

### Q&A

- **OWED (not lost).** `.spur/run/0999-check-receipt.json` is still owed: the operator-attended run
  has not happened.

### Testing

Gate receipt: `.spur/run/0999-check-receipt.json`.
EOF

# 5. dead pointer in a task that is not done/testing -> out of scope
case_check in-flight-task 0 0999-todo.md <<'EOF'
---
status: todo
---
## 0999. fixture

### Testing

Will write `.spur/run/0999-check-receipt.json` when the gate runs.
EOF

# 6. dead NON-run-scoped scratch citation -> out of the rule's scope by design
case_check non-run-scoped 0 0999-scratch-cite.md <<'EOF'
---
status: done
---
## 0999. fixture

### Testing

Dogfood log `.spur/run/dogfood/2026-09-06-r1.log` was the evidence for this run.
EOF

# 7. a run-scoped pointer that EXISTS -> passes
mkdir -p .spur/run && printf 'answer\n' >"$live_pointer"
case_check live-pointer 0 0999-live.md <<'EOF'
---
status: done
---
## 0999. fixture

### Review

Full report: `.spur/run/00000000-0000-4000-8000-000000000000-review-answer.txt`.
EOF

# 8. a backlog pair (pre-rule debt) -> exempt, so the gate is green on an unchanged corpus
case_check backlogged-pair 0 0226-backlogged.md <<'EOF'
---
status: done
---
## 0226. fixture

### Review

Gate receipt `.spur/run/0226-check-receipt.json` names the same digest.
EOF

# 9. a FAILED scan (awk cannot read its input — here a nonexistent explicit path) must fail closed,
#    never report a clean corpus. macOS BWK awk accepts a directory silently, so the trigger is an
#    unreadable path.
if sh "$checker" "$tmp/0999-scan-failure-missing.md" >"$tmp/scan-failure.out" 2>&1; then
    got=0
else
    got=1
fi
if [ "$got" -eq 1 ] && grep -q 'INVALID: citation scan failed' "$tmp/scan-failure.out"; then
    pass=$((pass + 1))
    printf 'PASS failed-scan-fails-closed (exit 1)\n'
else
    fail=$((fail + 1))
    printf 'FAIL failed-scan-fails-closed (want exit 1 + INVALID line, got exit %s)\n' "$got"
    sed 's/^/     | /' "$tmp/scan-failure.out"
fi

# --- task-0247 negative control: pre-repair corpus fires, repaired corpus passes ---------------
# Pinned to the parent of the repair commit (31f62375): reading HEAD stopped being "pre-repair" the
# moment the repair landed. A shallow clone without that commit SKIPs below.
pre_rev=31f62375^
pre=""
for f in $(git ls-files 'docs/tasks/0235_*.md' 'docs/tasks/0236_*.md' 2>/dev/null); do
    # keep the 4-digit WBS prefix the checker derives from the basename
    out="$tmp/$(basename "$f")"
    git show "$pre_rev:$f" >"$out" 2>/dev/null || continue
    pre="$pre $out"
done
if [ -n "$pre" ]; then
    if sh "$checker" $pre >"$tmp/pre.out" 2>&1; then
        fail=$((fail + 1))
        printf 'FAIL pre-repair-negative-control (want exit 1, got 0)\n'
        sed 's/^/     | /' "$tmp/pre.out"
    else
        pass=$((pass + 1))
        printf 'PASS pre-repair-negative-control (exit 1)\n'
        sed 's/^/     | /' "$tmp/pre.out" | head -6
    fi
    if sh "$checker" $(git ls-files 'docs/tasks/0235_*.md' 'docs/tasks/0236_*.md') >"$tmp/post.out" 2>&1; then
        pass=$((pass + 1))
        printf 'PASS repaired-corpus-passes (exit 0)\n'
    else
        fail=$((fail + 1))
        printf 'FAIL repaired-corpus-passes (want exit 0)\n'
        sed 's/^/     | /' "$tmp/post.out"
    fi
else
    printf 'SKIP pre-repair-negative-control (no git-tracked 0235/0236 in this tree)\n'
fi

printf '\n%s passed, %s failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ] || exit 1
exit 0
