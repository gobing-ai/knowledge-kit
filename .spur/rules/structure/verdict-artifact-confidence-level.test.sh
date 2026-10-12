#!/bin/sh
# Falsification cases for `verdict-artifact-confidence-level.sh` (rule
# `verdict-artifact-asserts-confidence-level`).
#
#   sh .spur/rules/structure/verdict-artifact-confidence-level.test.sh   # 0 = every case behaved
#
# Each case is a fixture artifact (or workflow fragment), plus the exit status the checker must
# produce for it — with `--no-since` so the fixtures are judged regardless of their mtime. A case
# failing here means the rule stopped refusing a level-less PASS, or started judging an artifact it
# must ignore.
set -u

checker="$(dirname "$0")/verdict-artifact-confidence-level.sh"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

pass=0
fail=0

# case <name> <want-exit> [<args…>] — the artifact body arrives on stdin.
case_check() {
    name="$1"
    want="$2"
    shift 2
    file="$tmp/$name-verdict.json"
    cat >"$file"
    if sh "$checker" --no-since "$@" "$file" >"$tmp/$name.out" 2>&1; then
        got=0
    else
        got=1
    fi
    if [ "$got" -eq "$want" ]; then
        pass=$((pass + 1))
        printf 'ok   %-34s exit=%s\n' "$name" "$got"
    else
        fail=$((fail + 1))
        printf 'FAIL %-34s want exit=%s got %s\n' "$name" "$want" "$got"
        sed 's/^/     /' "$tmp/$name.out"
    fi
}

# --- the artifact contract ---

case_check pass-high 0 <<'EOF'
{"verdict":"PASS","confidence":"HIGH","requirements":[{"id":"R1","status":"MET"}]}
EOF

case_check pass-medium 0 <<'EOF'
{"verdict":"PASS","confidence":"MEDIUM","requirements":[{"id":"R1","status":"PARTIAL"}]}
EOF

case_check pass-low 0 <<'EOF'
{"verdict":"PASS","confidence":"LOW","requirements":[]}
EOF

case_check pass-without-level 1 <<'EOF'
{"verdict":"PASS","requirements":[{"id":"R1","status":"MET"}]}
EOF

case_check level-outside-enum 1 <<'EOF'
{"verdict":"PASS","confidence":"SURE","requirements":[]}
EOF

# The workflow guard tests `^(HIGH|MEDIUM|LOW)$` case-sensitively, so a lowercase level is a PASS the
# reader would refuse — this rule must refuse it too, or it green-lights a run that then fails.
case_check lowercase-level 1 <<'EOF'
{"verdict":"PASS","confidence":"high"}
EOF

case_check empty-level 1 <<'EOF'
{"verdict":"PASS","confidence":""}
EOF

# The sibling checker's trap: a `minConfidence`/`rawconfidence` key is not a level claim.
case_check min-confidence-is-not-a-level 1 <<'EOF'
{"verdict":"PASS","minConfidence":0,"rawconfidence":{"value":"HIGH"}}
EOF

# --- artifacts that are out of scope ---

case_check non-pass-needs-no-level 0 <<'EOF'
{"verdict":"NEEDS_REVISION","feedback":"tighten the intro"}
EOF

case_check fail-needs-no-level 0 <<'EOF'
{"verdict":"FAIL"}
EOF

case_check no-verdict-field-is-out-of-scope 0 <<'EOF'
{"runId":"wf_123","status":"done","nodes":["precheck"]}
EOF

case_check non-object-json-is-out-of-scope 0 <<'EOF'
["PASS","HIGH"]
EOF

case_check unparsable-is-not-a-verdict-artifact 0 <<'EOF'
{"verdict":"PASS", "confidence"
EOF

case_check not-json-at-all-is-out-of-scope 0 <<'EOF'
label-result.txt: verdict PASS confidence HIGH
EOF

case_check empty-file-is-out-of-scope 0 </dev/null

# --- the cutoff ---
old="$tmp/old-verdict.json"
printf '{"verdict":"PASS"}\n' >"$old"
touch -t 202001010000 "$old"
if sh "$checker" "$old" >"$tmp/cutoff.out" 2>&1; then
    pass=$((pass + 1))
    printf 'ok   %-34s exit=0\n' pre-cutoff-passes-are-debt
else
    fail=$((fail + 1))
    printf 'FAIL %-34s a pre-cutoff PASS artifact must be debt, not a finding\n' pre-cutoff-passes-are-debt
    sed 's/^/     /' "$tmp/cutoff.out"
fi
if sh "$checker" --no-since "$old" >"$tmp/cutoff2.out" 2>&1; then
    fail=$((fail + 1))
    printf 'FAIL %-34s --no-since must judge the same artifact and refuse it\n' no-since-judges-debt
else
    pass=$((pass + 1))
    printf 'ok   %-34s exit=1\n' no-since-judges-debt
fi

# --- half B: the workflow consumer guard ---

wf_case() {
    name="$1"
    want="$2"
    file="$tmp/$name.yaml"
    cat >"$file"
    if sh "$checker" --no-since "$file" >"$tmp/$name.out" 2>&1; then
        got=0
    else
        got=1
    fi
    if [ "$got" -eq "$want" ]; then
        pass=$((pass + 1))
        printf 'ok   %-34s exit=%s\n' "$name" "$got"
    else
        fail=$((fail + 1))
        printf 'FAIL %-34s want exit=%s got %s\n' "$name" "$want" "$got"
        sed 's/^/     /' "$tmp/$name.out"
    fi
}

wf_case guard-reads-confidence 0 <<'EOF'
states:
  gate:
    onEnter:
      - type: shell
        command: |
          v="$(jq -r 'if (.verdict // "") == "PASS" then (.verdict + (if ((.confidence // "") | test("^(HIGH|MEDIUM|LOW)$")) then "" else "!" end)) else (.verdict // "") end' ${vars.verdictFile} 2>/dev/null)";
EOF

wf_case guard-ignores-confidence 1 <<'EOF'
states:
  gate:
    onEnter:
      - type: shell
        command: |
          v="$(jq -r '.verdict // ""' ${vars.verdictFile} 2>/dev/null)"; [ "$v" = "PASS" ] || exit 1
EOF

# Writing a judge verdict is not reading one — an echo may legitimately carry the level without the guard.
wf_case echo-writing-a-verdict 0 <<'EOF'
states:
  generate:
    onEnter:
      - type: shell
        command: 'echo ''{"verdict":"PASS","confidence":"HIGH"}'' > ${vars.verdictFile}'
EOF

# A commented example must not be enforced.
wf_case commented-pass-read 0 <<'EOF'
states:
  gate:
    onEnter:
      - type: shell
        command: |
          # was: jq -r 'if (.verdict // "") == "PASS" then .verdict else "" end'
          v="$(jq -r 'if (.verdict // "") == "PASS" then (.verdict + (if ((.confidence // "") | test("^(HIGH|MEDIUM|LOW)$")) then "" else "!" end)) else (.verdict // "") end' ${vars.verdictFile})";
EOF

# Prose in a description that mentions a PASS read is not a read.
wf_case prose-mentions-a-pass-read 0 <<'EOF'
states:
  gate:
    description: "Catch-all: a PASS whose confidence is missing or outside HIGH/MEDIUM/LOW reads as PASS! and lands here"
EOF

# --- empty scope is never a failure ---
mkdir -p "$tmp/empty-run" "$tmp/empty-workflows"
if sh "$checker" --no-since --run-dir="$tmp/empty-run" --workflows="$tmp/empty-workflows" >"$tmp/none.out" 2>&1; then
    pass=$((pass + 1))
    printf 'ok   %-34s exit=0\n' empty-scope-is-not-a-finding
else
    fail=$((fail + 1))
    printf 'FAIL %-34s an empty run plane must not fail (ADR-131)\n' empty-scope-is-not-a-finding
    sed 's/^/     /' "$tmp/none.out"
fi

# --- discovery honours --run-dir ---
mkdir -p "$tmp/run-dir/nested"
printf '{"verdict":"PASS"}\n' >"$tmp/run-dir/nested/0001-verdict.json"
if sh "$checker" --no-since --run-dir="$tmp/run-dir" --workflows="$tmp/empty-workflows" >"$tmp/disc.out" 2>&1; then
    fail=$((fail + 1))
    printf 'FAIL %-34s --run-dir must discover a nested level-less PASS\n' run-dir-discovery
    sed 's/^/     /' "$tmp/disc.out"
else
    pass=$((pass + 1))
    printf 'ok   %-34s exit=1\n' run-dir-discovery
fi

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ] || exit 1
