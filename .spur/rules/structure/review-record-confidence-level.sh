#!/bin/sh
# Review-record confidence check (rule `review-record-carries-confidence-level`).
#
# Runnable by hand — the rule's own message points here, because the `exit-code` evaluator reports
# only the exit status, not this script's output:
#
#   sh .spur/rules/structure/review-record-confidence-level.sh               # 0 = ok, 1 = findings
#   sh .spur/rules/structure/review-record-confidence-level.sh <file>…       # explicit files
#   sh .spur/rules/structure/review-record-confidence-level.test.sh          # falsification cases
#
# WHY. Every other confidence surface has a gate: the `Verification (` block and the `## Testing`
# record (`verification-block-carries-confidence-level`), the durable verdict artifact
# (`durable-verdict-carries-confidence-proof`), the run-plane verify/review answers
# (`verification-answer-carries-confidence-level`), and the claim table
# (`api-library-claim-cites-source-and-confidence`). The `## Review` record — what a task keeps of the
# review coordinator's verdict — had none. Measured 2026-10-12: of 258 task records carrying a
# `## Review` section, all 258 state a verdict or findings and only 4 carry a `Confidence:` line, so a
# review record could claim a level outside the enum, or an unearned HIGH, and no gate noticed.
#
# WHAT IT CHECKS, and what it deliberately does not.
#   1. Every `Confidence:` value inside a `## Review` section is inside the enum HIGH|MEDIUM|LOW — a
#      misspelled or invented level fails.
#   2. A claimed level is EARNED: HIGH cites evidence (an http(s) URL, a `path:line`, or a repo path
#      carrying a code/doc extension); MEDIUM/LOW either cite evidence or name what is unverified.
#   3. PRESENCE IS NOT ENFORCED, on measured evidence rather than taste: 254 of those 258 records
#      predate any review-level practice, and a review-record level cannot be retro-fitted honestly —
#      the level belongs to the review that produced it, and none of those reviews stated one. A
#      presence rule would therefore fail on history and invite invented levels. It becomes possible
#      once the record step copies the review answer's level into `## Review`; until then this rule
#      judges what a record claims, never whether it claims.
#
# Optional arguments: pass explicit markdown files to check instead of the repo sweep — the seam the
# self-test uses (`.test.sh`), and handy by hand for a single document.
set -u

if [ "$#" -gt 0 ]; then
    files="$*"
else
    files="$(rg --files -g 'docs/tasks*/**/*.md' -g 'docs/features/**/*.md' -g '!**/node_modules/**' -g '!**/vendors/**' . 2>/dev/null || true)"
fi

# PRE-RULE BACKLOG (may only shrink). Records written before this rule existed whose CLAIMED level is
# not earned: 0183 MEDIUM with neither citation nor gap, and 0184/0188/0225 HIGH with no citation.
# They retire by re-recording the task (which re-derives the level), never by editing the claim, and
# every one was found by this rule on its first run against the corpus.
PRE_RULE_BACKLOG='0183 0184 0188 0225'

gap_re='unverif|not (yet )?(run|verified|tested|checked|confirmed|reproduced|fetched|exercised|demonstrated|claimed)|needs a real|missing|could not|unable to|assumed|inferred|no evidence|unknown|not available|left untested'

errors=0
debt=0

for f in $files; do
    [ -f "$f" ] || continue
    # Only a record with a Review section is in scope; a section-less task is untouched.
    grep -qE '^### Review[ \t]*$' "$f" || continue
    wbs="$(basename "$f" | cut -c1-4)"
    case " $PRE_RULE_BACKLOG " in
        *" $wbs "*) debt=$((debt + 1)); continue ;;
    esac
    out="$(awk -v file="$f" -v gap_re="$gap_re" '
        # Escape-free by design: BWK awk dynamic-regex `\.` handling is unreliable, and
        # over-accepting here weakens one arm rather than producing a wrong finding.
        function is_cite(line,   i, exts, e) {
            if (index(line, "://") > 0) return 1
            if (line ~ /[A-Za-z0-9_.\/-]+:[0-9]+/) return 1
            e = "ts tsx js jsx mjs json yaml yml md sh py sql toml txt lock"
            n = split(e, exts, " ")
            for (i = 1; i <= n; i++) if (index(line, "." exts[i]) > 0) return 1
            return 0
        }
        function judge_claim(   ) {
            if (!in_review) return
            if (bad_enum > 0) { bad = 1; return }
            if (conf == 0) return
            if (level == "HIGH" && cites == 0) {
                printf "INVALID: %s:%d: `## Review` claims Confidence: HIGH but cites no evidence (want >=1 path:line, repo path, or URL)\n", file, conf_line
                bad = 1
            } else if ((level == "MEDIUM" || level == "LOW") && cites == 0 && gaps == 0) {
                printf "INVALID: %s:%d: `## Review` claims Confidence: %s, cites nothing and names no gap — state what is unverified\n", file, conf_line, level
                bad = 1
            }
        }
        /^### / {
            judge_claim()
            in_review = ($0 ~ /^### Review[ \t]*$/)
            conf = 0; cites = 0; gaps = 0; level = ""; bad_enum = 0
            next
        }
        /^## / { judge_claim(); in_review = 0; next }
        in_review && /(^|[^A-Za-z])Confidence: ?\** *HIGH|LOW|MEDIUM/ {
            # each claim is judged on its own evidence; never inherit the previous one
            judge_claim()
            conf = 0; cites = 0; gaps = 0; level = ""; bad_enum = 0
            line = $0
            if (match(line, /(HIGH|MEDIUM|LOW)/)) {
                if (conf == 0) { conf_line = NR }
                conf += 1
                level = substr(line, RSTART, RLENGTH)
            }
            if (is_cite(line)) cites += 1
            if (tolower(line) ~ gap_re) gaps += 1
            next
        }
        in_review && /(^|[^A-Za-z])Confidence:/ {
            printf "INVALID: %s:%d: `## Review` states a confidence outside HIGH|MEDIUM|LOW — %s\n", file, NR, substr($0, 1, 70)
            bad_enum += 1
            next
        }
        in_review && conf > 0 {
            if (is_cite($0)) cites += 1
            if (tolower($0) ~ gap_re) gaps += 1
        }
        END { judge_claim(); exit bad }
    ' "$f")" || errors=$((errors + 1))
    [ -n "$out" ] && printf '%s\n' "$out"
done

[ "$debt" -gt 0 ] && echo "NOTE: $debt pre-rule review record(s) claim an unearned level — debt that retires by re-recording the task, not by editing the claim"
[ "$errors" -eq 0 ] || exit 1
