#!/bin/sh
# Run-plane answer confidence check (rule `run-answer-carries-earned-confidence-level`).
#
# Runnable by hand — the rule's own message points here, because the `exit-code` evaluator reports
# only the exit status, not this script's output:
#
#   sh .spur/rules/structure/run-answer-confidence-level.sh            # 0 = ok, 1 = findings on stdout
#   sh .spur/rules/structure/run-answer-confidence-level.test.sh       # falsification cases for the above
#
# WHY. A review/verify answer (`.spur/run/<runId>-review-answer.txt`, `.spur/run/<wbs>-verify-answer.txt`)
# is the artifact the pipeline reads before it certifies a task, and an agent writing one has been
# observed to close it with `Confidence: HIGH|MEDIUM|LOW` — a claim nothing judged. The two sibling
# rules cover the durable copies (a task's `## Testing` / `## Review`) but not the run-plane answer the
# durable copy is derived from, so an unearned HIGH could ride into a recorded verdict unread.
#
# WHAT IT CHECKS, and what it deliberately does not.
#   1. Every level the file CLAIMS is inside the enum HIGH|MEDIUM|LOW — a misspelled or invented
#      level (`Confidence: VERY HIGH`) fails.
#   2. A claimed level is EARNED: HIGH cites evidence (an http(s) URL, a `path:line`, or a repo path
#      carrying a code/doc extension); MEDIUM/LOW either cite evidence or name what is unverified.
#   3. A claim is a line that OPENS with `Confidence:` (optionally bold-wrapped, indented). Prose that
#      mentions the token — `Do not write a \`Confidence:\` line` — is documentation, not a claim, and
#      is never judged; this is the false-positive class that made an earlier sibling rule fire on a
#      sentence quoting its own enum.
#   4. PRESENCE IS NOT ENFORCED. The line is optional: an answer with no level is normal, and a
#      presence requirement would manufacture levels rather than verify them (the same doctrine as
#      `review-record-confidence-level.yaml`).
#   5. `path:line` citations are resolved BY A HUMAN, not here: this rule judges citation FORM, and
#      `scratch-citation-existence` owns whether a cited run artifact exists.
#   6. SCOPE IS A WINDOW, not the whole plane. `.spur/run/` is execution scratch (ADR-131) and keeps
#      every finished run's answer, so judging all of them would judge dead artifacts and invite
#      falsifying them. Discovery takes answers modified within the last
#      `RUN_ANSWER_WINDOW_MINUTES` (default 240), so a run's own answer is judged while it is live and
#      a leftover ages out with no maintenance.
#
# Optional arguments: pass explicit files to check instead of the plane sweep — the seam the
# self-test uses (`.test.sh`), and handy by hand for a single answer.
set -u

# Window, in minutes: `.spur/run/` is execution scratch (ADR-131), so the plane accumulates every
# finished run's answer. Judging those is judging dead artifacts — and mass-editing them would be
# falsifying history rather than verifying it. The rule therefore judges the answers a RECENT run
# produced; a leftover ages out on its own. Override with `--since-minutes <n>` for a by-hand sweep.
window="${RUN_ANSWER_WINDOW_MINUTES:-240}"
if [ "$#" -gt 0 ] && [ "$1" = "--since-minutes" ]; then
    window="$2"
    shift 2
fi

if [ "$#" -gt 0 ]; then
    files="$*"
else
    files="$(find .spur/run -type f \( -name '*-review-answer.txt' -o -name '*-verify-answer.txt' \) \
        -mmin "-$window" 2>/dev/null | sort || true)"
fi

gap_re='unverif|not (yet )?(run|verified|tested|checked|confirmed|reproduced|fetched|exercised|demonstrated|claimed)|needs a real|missing|could not|unable to|assumed|inferred|no evidence|unknown|not available|left untested'

errors=0

for f in $files; do
    [ -f "$f" ] || continue
    out="$(awk -v file="$f" -v gap_re="$gap_re" '
        # Escape-free by design (same rationale as the sibling checkers): over-accepting here weakens
        # one arm rather than producing a wrong finding.
        function is_cite(line,   i, exts, e, n) {
            if (index(line, "://") > 0) return 1
            if (line ~ /[A-Za-z0-9_.\/-]+:[0-9]+/) return 1
            e = "ts tsx js jsx mjs json yaml yml md sh py sql toml txt lock"
            n = split(e, exts, " ")
            for (i = 1; i <= n; i++) if (index(line, "." exts[i]) > 0) return 1
            return 0
        }
        # A claim OPENS the line: optional indent, optional bold wrapper, `Confidence:`.
        # A mention mid-sentence or inside inline code never matches, so it is never judged.
        /^[[:space:]]*\**Confidence:/ {
            rest = $0
            sub(/^[[:space:]]*\**Confidence:[[:space:]]*/, "", rest)
            sub(/^\**[[:space:]]*/, "", rest)
            # A line that opens with the documented enum (`HIGH|MEDIUM|LOW`) is the contract quoted
            # back, not a claim — same mention-vs-claim distinction the sibling rules make.
            if (rest ~ /^(HIGH|MEDIUM|LOW)\|/) next
            # The claimed level is the first word; `VERY HIGH` must fail as out-of-enum, so the
            # match is anchored rather than a search for any enum word on the line.
            if (match(rest, /^[A-Za-z]+/) == 0 || (level = substr(rest, 1, RLENGTH)) == "") {
                printf "INVALID: %s:%d: claims a confidence level outside HIGH|MEDIUM|LOW — %s\n", file, NR, substr($0, 1, 70)
                bad = 1
                next
            }
            if (level != "HIGH" && level != "MEDIUM" && level != "LOW") {
                printf "INVALID: %s:%d: claims `%s`, outside HIGH|MEDIUM|LOW — %s\n", file, NR, level, substr($0, 1, 70)
                bad = 1
                next
            }
            cites = is_cite(rest)
            gaps = (tolower(rest) ~ gap_re)
            if (level == "HIGH" && !cites) {
                printf "INVALID: %s:%d: `Confidence: HIGH` cites no evidence (want a path:line, a repo path, or a URL)\n", file, NR
                bad = 1
            } else if ((level == "MEDIUM" || level == "LOW") && !cites && !gaps) {
                printf "INVALID: %s:%d: `Confidence: %s` cites nothing and names no gap — state what is unverified\n", file, NR, level
                bad = 1
            }
        }
        END { exit bad }
    ' "$f")" || errors=$((errors + 1))
    [ -n "$out" ] && printf '%s\n' "$out"
done

[ "$errors" -eq 0 ] || exit 1
