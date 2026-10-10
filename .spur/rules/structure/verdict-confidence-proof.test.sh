#!/bin/sh
# Falsification cases for `verdict-confidence-proof.sh`
# (rule `durable-verdict-carries-confidence-proof`, task 1156).
#
#   sh .spur/rules/structure/verdict-confidence-proof.test.sh   # 0 = every case behaved
#
# Each case writes a fixture task file plus a fixture durable verdict artifact (under a temp
# artifacts root, so the real evidence plane is never touched) and asserts the checker's exit status.
# A failing case means the rule stopped enforcing — in either direction (a level admitted without its
# proof, or a legitimate artifact refused).
set -u

checker="$(cd "$(dirname "$0")" && pwd)/verdict-confidence-proof.sh"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/tasks" "$tmp/art"

pass=0
fail=0

# case <name> <want-exit> <wbs> <status> <artifact-json>
case_check() {
    name="$1"
    want="$2"
    wbs="$3"
    status="$4"
    artifact="$5"
    taskfile="$tmp/tasks/${wbs}_fixture.md"
    printf -- '---\nstatus: %s\n---\n\n## %s. fixture\n\n### Testing\n\n- Confidence: HIGH\n' "$status" "$wbs" >"$taskfile"
    if [ -n "$artifact" ]; then
        printf '%s\n' "$artifact" >"$tmp/art/${wbs}-verdict.json"
    else
        rm -f "$tmp/art/${wbs}-verdict.json"
    fi
    if sh "$checker" --artifacts-dir="$tmp/art" "$taskfile" >"$tmp/$name.out" 2>&1; then
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

HIGH_ROW='{"wbs":"0900","verdict":"PASS","confidence":"HIGH","requirements":[{"id":"R1","status":"MET","evidence":"x"}],"checks":[{"name":"confidence","status":"pass","evidence":"HIGH — 1/1 rows MET"}]}'
HIGH_NO_ROW='{"wbs":"0901","verdict":"PASS","confidence":"HIGH","requirements":[{"id":"R1","status":"MET","evidence":"x"}]}'
MEDIUM_NO_ROW='{"wbs":"0902","verdict":"PASS","confidence":"MEDIUM","requirements":[{"id":"R1","status":"MET","evidence":"x"}]}'
LOW_NO_ROW='{"wbs":"0903","verdict":"PARTIAL","confidence":"LOW","requirements":[{"id":"R1","status":"MET","evidence":"x"}]}'
BAD_STATUS='{"wbs":"0904","verdict":"PASS","confidence":"HIGH","checks":[{"name":"confidence","status":"broken","evidence":"HIGH"}]}'
BAD_EVIDENCE='{"wbs":"0905","verdict":"PASS","confidence":"HIGH","checks":[{"name":"confidence","status":"pass","evidence":"earned"}]}'
PROOF_EMPTY='{"wbs":"0906","verdict":"PASS","confidence":"HIGH","checks":[{"name":"confidence","status":"pass","evidence":"HIGH"}],"proof":{"digest":"","runId":"r1"}}'
PROOF_GOOD='{"wbs":"0907","verdict":"PASS","confidence":"HIGH","checks":[{"name":"confidence","status":"pass","evidence":"HIGH"}],"proof":{"digest":"sha256:0000000000000000000000000000000000000000000000000000000000000000","runId":"r1"}}'
PROOF_NO_RUNID='{"wbs":"0908","verdict":"PASS","confidence":"HIGH","checks":[{"name":"confidence","status":"pass","evidence":"HIGH"}],"proof":{"digest":"sha256:0000000000000000000000000000000000000000000000000000000000000000"}}'

case_check row-present 0 0900 done "$HIGH_ROW"
case_check high-without-row 1 0901 done "$HIGH_NO_ROW"
case_check medium-without-row 1 0902 testing "$MEDIUM_NO_ROW"
case_check low-out-of-scope 0 0903 done "$LOW_NO_ROW"
case_check no-artifact 0 0909 done ""
case_check not-done-status 0 0910 todo "$HIGH_NO_ROW"
case_check row-status-invalid 1 0904 done "$BAD_STATUS"
case_check row-evidence-unnamed-level 1 0905 done "$BAD_EVIDENCE"
case_check proof-empty-digest 1 0906 done "$PROOF_EMPTY"
case_check proof-good 0 0907 done "$PROOF_GOOD"
case_check proof-missing-runid 1 0908 done "$PROOF_NO_RUNID"
case_check malformed-artifact 1 0911 done '{"confidence":"HIGH",'
# the pre-rule backlog exempts a measured pair; 0183 is the first entry in the checker's list.
case_check backlogged-wbs 0 0183 done "$HIGH_NO_ROW"

printf '\n%s passed, %s failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ] || exit 1
exit 0
