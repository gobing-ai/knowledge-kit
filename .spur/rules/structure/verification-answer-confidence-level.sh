#!/bin/sh
# Verification-answer confidence check (rule `verification-answer-carries-confidence-level`).
#
# Runnable by hand — the rule's own message points here, because the `exit-code` evaluator reports
# only the exit status, not this script's output:
#
#   sh .spur/rules/structure/verification-answer-confidence-level.sh          # 0 = ok, 1 = findings
#   sh .spur/rules/structure/verification-answer-confidence-level.sh <file>…  # explicit files
#   sh .spur/rules/structure/verification-answer-confidence-level.sh --no-since  # judge pre-cutoff too
#   sh .spur/rules/structure/verification-answer-confidence-level.test.sh     # falsification cases
#
# WHY THIS EXISTS. Three sibling rules already cover a claimed confidence level: the `Verification (`
# block and the `## Testing` record (`verification-confidence-level`), the durable verdict artifact
# (`verdict-confidence-proof`), and the API/library claim table
# (`api-library-claim-cites-source-and-confidence`). The uncovered surface was the artifact the
# pipeline's own verify stage writes — the ANSWER file under `.spur/run/`. Measured in this repo on
# 2026-10-12: of 167 `*-verify-answer.txt` only 53 carried a `Confidence:` line. The verify grammar
# requires exactly one line and `spur task verdict` lints it at write time, but nothing read the file
# afterwards, so a hand-written or agent-written answer could assert `Verdict: PASS` with no level at
# all and no gate noticed — the same class the sibling rules close for every other surface.
#
# WHY REVIEW ANSWERS ARE NOW JUDGED TOO (extended 2026-10-12). They were excluded at first: the
# review-stage contract owned priority cells only and declared no `Confidence:` line, so requiring one
# here would have failed a compliant reviewer artifact. That contract changed — the sp plugin's
# reviewer (`plugins/sp/agents/super-reviewer.md`, spur-new `78cf054e`) now requires exactly one
# `Confidence: HIGH | MEDIUM | LOW` line with the same earning rule — so this rule's net widened to the
# review answer. A separate rule was the other option and was rejected: the concern is identical and
# only the glob differs, which the rule-authoring doctrine classifies as EXTEND, not ADD. Measured
# before the extension: 48 review answers, 38 asserting a verdict, 6 of those carrying a level.
#
# NAMING: the id and this filename keep `verification-answer` because a rule id is never renamed (a
# rename silently breaks every suppression and report reference). The id is narrower than the rule now
# is; the `description` and this header are the authority on scope.
#
# SCOPE, two deliberate rules of construction.
#
#  1. PRESENCE IS NEVER REQUIRED. `.spur/run/` is a disposable plane (ADR-131), so a rule that
#     demanded an answer file would fail after any cleanup. This rule judges the files that are
#     there: an answer that asserts a verdict must declare its level and earn it. An absent or empty
#     answer is out of scope, and so is a file with no verdict line (a log, a partial scrap).
#
#  2. A CUTOFF, NOT A BACKLOG. The sibling `verdict-confidence-proof` rule grandfathers pre-rule debt
#     in an explicit list; that list would be unusable here (~218 answer files today across both
#     planes, growing with every run). Answers written before the adoption timestamp are therefore
#     reported as a single count line and not judged — debt that may only shrink as old answers age
#     out of the run plane. `--no-since` removes the cutoff for the negative control and for an
#     operator who wants the full pre-rule set. The cutoff is an exact UTC timestamp, not a date, so
#     answers a concurrent session wrote earlier today are debt rather than findings. It is
#     `2026-10-12T04:00:00Z` — immediately after the newest pre-adoption artifact (03:34:49Z, measured
#     across both planes' 218 artifacts), while the review contract itself landed at 07:09Z. Placing it
#     at the newest legacy artifact rather than at the contract's own instant makes the rule enforce
#     from the moment it is committed. The first attempt used 07:15Z and silently grandfathered
#     everything written before it — including the proof artifact, which is how that was caught.
#
# Contract, for each in-scope file:
#   * exactly one `Confidence: HIGH|MEDIUM|LOW` line, and no `Confidence:` line outside the enum;
#   * ONLY A DECLARATION COUNTS. A declaration is the line's own statement — `Confidence: HIGH`,
#     `**Confidence**: MEDIUM`, `- Confidence: LOW`. A MENTION inside prose or backticks ("the
#     `Confidence: HIGH` line the guard asks for") is neither counted nor an enum violation.
#     Measured 2026-10-12 before this distinction existed: a substring count let an answer with NO
#     declared level satisfy "exactly one" whenever it merely talked about a level, so the rule
#     could not see the thing it exists to verify; and one declaration plus one mention read as
#     "2 line(s)" and refused a valid answer. Both directions are pinned in the suite
#     (`mention-is-not-a-declaration`, `declaration-plus-mention-is-one`).
#   * the level is EARNED: HIGH cites evidence (an http(s) URL, a `path:line`, or a repo path with a
#     code/doc extension); MEDIUM/LOW either cite evidence or name what is unverified. The citation
#     and gap heuristics are the ones the sibling confidence checker already uses — one vocabulary,
#     not a second dialect.
#
# Repair: the answer file is produced by the verify/review stage, so the repair is to re-run that
# stage (or, for a live run, to write the missing line into the answer before `spur task verdict`
# consumes it) — never to delete the evidence, and never by widening this rule.
set -u

SINCE="2026-10-12T04:00:00Z"   # adoption instant (UTC); earlier answers are debt, not findings
USE_SINCE=1
FILES=""

for arg in "$@"; do
    case "$arg" in
        --no-since) USE_SINCE=0 ;;
        --since=*) SINCE="${arg#--since=}" ;;
        *) FILES="$FILES $arg" ;;
    esac
done

if [ -z "$FILES" ]; then
    for d in .spur/run/ .spur/run/*/; do
        [ -d "$d" ] || continue
        for f in "$d"*-verify-answer.txt; do
            [ -f "$f" ] && FILES="$FILES $f"
        done
        # Judged since 2026-10-12: the review contract now declares the Confidence line (see header).
        for f in "$d"*review-answer*.txt; do
            [ -f "$f" ] && FILES="$FILES $f"
        done
    done
fi
[ -n "$FILES" ] || { echo "NOTE: no answer artifact present — nothing to judge (ADR-131: the run plane is disposable)"; exit 0; }

# Epoch seconds, GNU then BSD — order is load-bearing: GNU `stat -f` is filesystem mode and,
# given the BSD format, exits nonzero while STILL printing the fs table to stdout, which the
# command substitution then captures as the mtime (measured 2026-10-14 on CI: a 2020-mtime
# answer was judged instead of grandfathered). BSD `stat -c` is an error with empty stdout,
# so it falls through cleanly. A file whose mtime cannot be read is judged (fails closed).
mtime_of() {
    stat -c %Y "$1" 2>/dev/null || stat -f %m "$1" 2>/dev/null || echo 0
}
# Instant → epoch: ISO-8601 UTC first, then a bare date; an unparseable cutoff falls back to the
# compiled default rather than judging history.
#
# `-u` is load-bearing. BSD `date` without it parses the UTC instant as LOCAL time, which silently
# moves the adoption boundary +7h in this timezone and grandfathers answers written after it (measured
# 2026-10-12: `2026-10-12T04:00:00Z` parsed to 11:00Z, so a fresh answer read as debt and the rule
# enforced nothing for hours). GNU `date -d` already reads the trailing Z as UTC, so that fallback is
# correct without the flag. The `post-cutoff-is-judged` case in the suite pins this.
cutoff_epoch() {
    date -u -j -f %Y-%m-%dT%H:%M:%SZ "$1" +%s 2>/dev/null || date -d "$1" +%s 2>/dev/null || \
        date -u -j -f %Y-%m-%d "$1" +%s 2>/dev/null || echo ""
}
CUTOFF=""
[ "$USE_SINCE" = 1 ] && CUTOFF="$(cutoff_epoch "$SINCE")"

gap_re='unverif|not (yet )?(run|verified|tested|checked|confirmed|reproduced)|missing|could not|unable to|assumed|inferred|no evidence|unknown|not available|left untested'

errors=0
judged=0
debt=0

for f in $FILES; do
    [ -f "$f" ] || continue
    [ -s "$f" ] || continue
    # Only an answer that ASSERTS an outcome is in scope.
    grep -qiE '^[[:space:]]*\**Verdict:\**' "$f" || continue
    if [ -n "$CUTOFF" ]; then
        m="$(mtime_of "$f")"
        if [ "$m" -lt "$CUTOFF" ] 2>/dev/null; then
            debt=$((debt + 1))
            continue
        fi
    fi
    judged=$((judged + 1))
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
        # A DECLARATION is the statement the line itself makes; a MENTION in prose or backticks is not.
        # See the contract note at the top: counting mentions both hid a missing level and refused a
        # valid one.
        function is_decl(line,   s, t, c, pre) {
            s = line
            sub(/^[ \t]+/, "", s)
            sub(/^[-*][ \t]+/, "", s)
            t = tolower(s)
            c = index(t, ":")
            if (c <= 0 || c > 24) return 0
            pre = substr(t, 1, c)
            gsub(/\*/, "", pre)
            gsub(/[ \t]/, "", pre)
            return (pre == "confidence:")
        }
        # The level must be a WHOLE word: `HIGHWAY`, `HIGHly` and `MEDIUM-rare` are not levels, and a
        # substring match accepted each of them as one (the same class as the mention bug above).
        function level_of(line,   s) {
            s = line
            if (s ~ /(^|[^A-Za-z0-9_-])HIGH([^A-Za-z0-9_-]|$)/) return "HIGH"
            if (s ~ /(^|[^A-Za-z0-9_-])MEDIUM([^A-Za-z0-9_-]|$)/) return "MEDIUM"
            if (s ~ /(^|[^A-Za-z0-9_-])LOW([^A-Za-z0-9_-]|$)/) return "LOW"
            return ""
        }
        {
            line = $0
            if (is_decl(line)) {
                lvl = level_of(line)
                if (lvl != "") {
                    conf += 1
                    if (level == "") { level = lvl; levelline = NR }
                } else {
                    bad_enum += 1
                    printf "INVALID: %s:%d: `Confidence:` line is outside HIGH|MEDIUM|LOW — %s\n", file, NR, substr(line, 1, 70)
                }
            }
            if (is_cite(line)) cites += 1
            if (tolower(line) ~ gap_re) gaps += 1
        }
        END {
            if (bad_enum > 0) bad = 1
            if (conf != 1) {
                printf "INVALID: %s: answer asserts a verdict but carries %d Confidence: HIGH|MEDIUM|LOW line(s) (want exactly 1)\n", file, conf
                bad = 1
            } else if (level == "HIGH" && cites == 0) {
                printf "INVALID: %s:%d: answer claims Confidence: HIGH but cites no evidence (want >=1 path:line, repo path, or URL)\n", file, levelline
                bad = 1
            } else if ((level == "MEDIUM" || level == "LOW") && cites == 0 && gaps == 0) {
                printf "INVALID: %s:%d: answer claims Confidence: %s, cites nothing and names no gap — state what is unverified\n", file, levelline, level
                bad = 1
            }
            exit bad
        }
    ' "$f")" || errors=$((errors + 1))
    [ -n "$out" ] && printf '%s\n' "$out"
done

[ "$debt" -gt 0 ] && echo "NOTE: $debt pre-cutoff answer(s) (older than $SINCE) reported as debt, not judged — run with --no-since for the full pre-rule set"
[ "$errors" -eq 0 ] || exit 1
echo "OK: $judged answer artifact(s) judged, all declaring an earned confidence level"
