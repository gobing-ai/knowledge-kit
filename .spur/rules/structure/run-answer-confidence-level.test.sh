#!/bin/sh
# Falsification cases for `run-answer-confidence-level.sh` (rule
# `run-answer-carries-earned-confidence-level`). One case = one fixture + the exit status the checker
# must return. A case that starts passing means the rule stopped catching what it exists to catch.
#
#   sh .spur/rules/structure/run-answer-confidence-level.test.sh
set -u

CHECK="$(cd "$(dirname "$0")" && pwd)/run-answer-confidence-level.sh"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/run-answer-confidence.XXXXXX")" || exit 1
trap 'rm -rf "$TMP"' EXIT INT TERM

pass=0
fail=0

# expect <name> <want-exit> <file-content>
expect() {
    name="$1"
    want="$2"
    body="$3"
    f="$TMP/case.txt"
    printf '%s\n' "$body" > "$f"
    sh "$CHECK" "$f" > "$TMP/out.txt" 2>&1
    got=$?
    if [ "$got" -eq "$want" ]; then
        pass=$((pass + 1))
        printf 'ok   %s\n' "$name"
    else
        fail=$((fail + 1))
        printf 'FAIL %s (want exit %s, got %s)\n' "$name" "$want" "$got"
        sed 's/^/     /' "$TMP/out.txt"
    fi
}

# ── must PASS ────────────────────────────────────────────────────────────────
expect "cited HIGH passes" 0 'Verdict: PASS
Confidence: HIGH — verified against apps/cli/src/byte-output.ts:27 and a live probe'

expect "cited HIGH with a URL passes" 0 'Confidence: HIGH — see https://example.com/docs#section'

expect "MEDIUM naming its gap passes" 0 'Confidence: MEDIUM — the browser seam is not verified on a real launch'

expect "LOW with a citation passes" 0 'Confidence: LOW — packages/publish-harness/src/browser.ts:1395 is reasoned, not reproduced'

expect "no level at all passes (presence optional)" 0 'Verdict: PASS
| AC1 | MET | test | packages/publish-harness/tests/bot-session.test.ts:996 |'

expect "a prose/inline-code mention is not a claim" 0 'No asserted level is written here.
Do not write a `Confidence:` line: a model that can write PASS can write HIGH.
The enum is HIGH|MEDIUM|LOW and it is documented in prose, not claimed.'

expect "empty file passes" 0 ''

expect "bold-wrapped cited HIGH passes" 0 '**Confidence:** HIGH — apps/cli/src/commands/bot.ts:180'

expect "the documented enum quoted back is not a claim" 0 'Confidence: HIGH|MEDIUM|LOW is the only accepted shape.'

# ── must FAIL ────────────────────────────────────────────────────────────────
expect "uncited HIGH fails" 1 'Verdict: PASS
Confidence: HIGH'

expect "level outside the enum fails" 1 'Confidence: VERY HIGH — apps/cli/src/byte-output.ts:27'

expect "MEDIUM with neither citation nor gap fails" 1 'Confidence: MEDIUM — verified carefully'

expect "uncited LOW fails" 1 'Confidence: LOW'

# ── discovery window (ADR-131: the plane keeps dead answers) ─────────────────
# A run's own answer must be judged; a leftover from a finished run must age out.
disc="$TMP/disc"
mkdir -p "$disc/.spur/run"
printf 'Confidence: HIGH\n' > "$disc/.spur/run/9999-verify-answer.txt"
printf 'Confidence: HIGH\n' > "$disc/.spur/run/9998-verify-answer.txt"
touch -t 202001010000 "$disc/.spur/run/9998-verify-answer.txt"
( cd "$disc" && sh "$CHECK" > "$TMP/out.txt" 2>&1 )
got=$?
if [ "$got" -eq 1 ] && grep -q '9999-verify-answer.txt' "$TMP/out.txt" && ! grep -q '9998-verify-answer.txt' "$TMP/out.txt"; then
    pass=$((pass + 1))
    printf 'ok   fresh answer judged, aged answer ignored\n'
else
    fail=$((fail + 1))
    printf 'FAIL discovery window (want only the fresh file judged)\n'
    sed 's/^/     /' "$TMP/out.txt"
fi

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ] || exit 1
