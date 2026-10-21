#!/bin/sh
# CHANGELOG claim-citation check (rules `changelog-claim-citations-resolve` and
# `changelog-records-no-confidence-level`).
#
# Runnable by hand — the rules' message points here, because the `exit-code` evaluator reports only
# the exit status:
#
#   sh .spur/rules/structure/changelog-claim-citations.sh          # 0 = ok, 1 = findings on stdout
#   sh .spur/rules/structure/changelog-claim-citations.sh <file>…  # explicit files (the test fixtures)
#   sh .spur/rules/structure/changelog-claim-citations.test.sh     # falsification cases for the above
#
# WHY THIS EXISTS. `sp-dev-changelog` requires one `<!-- src: <anchor> -->` per claim bullet and
# re-checks it by hand at the end of the run (dev-operations §8, steps 7-8).  That is a procedure, not
# a gate: nothing stopped the next release from shipping bullets with no anchor, an anchor pointing at
# a file that was later deleted, or a `:line` that outlived the code.  The 0.1.6 section generated on
# 2026-10-20 happened to be correct (17 bullets, 14 annotations, every anchor resolving) and checking
# it took a throwaway script — the shape of check that belongs in the gate.  That section is this
# rule's first corpus.
#
# CONTRACT, newest section only (`## [` up to the next `## [`):
#
#   1. an annotation sits on the line DIRECTLY under its bullet, holds exactly one anchor, and that
#      anchor is an `http(s)://` URL or a repo `path` (optionally `:line`) that exists — an anchor
#      naming something a reader cannot open is not a citation;
#   2. a bullet asserting a code/API/library/version fact must carry one.  The claim signal is narrow
#      and mechanical on purpose: a scoped package (`@scope/name`), a semantic version (`1.2.3`), the
#      words `kk stage` or `spur `, or a backticked token containing `.` or `/`.  A date
#      (`2026-10-20`), a status move or an evidence filing carries no signal, which is how the
#      procedure's "skip bookkeeping bullets" stays automatic instead of a judgement call;
#   3. an annotation may not float free of a bullet, and no bullet may carry two;
#   4. ADR-138 forbids recording a confidence level on a changelog claim, so a
#      `Confidence: HIGH|MEDIUM|LOW` assertion anywhere in the file is a finding too — the level
#      belongs in the ADR claim tables that `api-library-claim-citation` gates.
#
# OLDER SECTIONS ARE NOT RETRO-FITTED: anchors arrived with the 0.1.6 section, so judging every past
# release would fail on history instead of on a defect (the call `api-library-claim-citation` made for
# its presence arm).  The newest section is the one a release can still fix.
#
# Exit status: 0 = clean; 1 = findings on stdout; 2 = usage.
set -u

# Claim signal for a bullet that asserts a code/API/library/version fact (rule 2).
SIGNAL="@[a-z0-9_-]+/[a-z0-9_-]+|(^|[^0-9])v?[0-9]+\.[0-9]+\.[0-9]+|kk stage|(^|[^a-z])spur |\`[^\`]*[./][^\`]*\`"

anchor_resolves() {
    anchor="$1"
    case "$anchor" in
        http://*|https://*) return 0 ;;
        *' '*) return 1 ;;
    esac
    path="$anchor"
    line=""
    case "$anchor" in
        *:[0-9]*)
            path="${anchor%:*}"
            line="${anchor##*:}"
            ;;
    esac
    [ -e "$path" ] || return 1
    if [ -n "$line" ]; then
        total="$(wc -l <"$path" 2>/dev/null | tr -d ' ')"
        [ -n "$total" ] || return 1
        [ "$line" -le "$total" ] || return 1
    fi
    return 0
}

check_file() {
    file="$1"
    section="$(awk '/^## \[/ { if (seen) exit; seen = 1 } seen { print }' "$file")"
    # ENVIRON, not `-v`: awk unescapes `-v` values, so the signal's `\.` became a wildcard and
    # matched a date (`2026-10-20`) as a semantic version (measured while wiring this rule up).
    printf '%s' "$section" | SIGNAL="$SIGNAL" awk -v file="$file" '
        BEGIN { signal = ENVIRON["SIGNAL"] }
        function flush(    ) {
            if (!pending) return
            if (n == 0 && bullet ~ signal) {
                printf "%s:%d: missing-anchor: a claim bullet carries no `<!-- src: … -->` comment\n", file, bullet_ln
                bad = 1
            }
            if (n > 1) {
                printf "%s:%d: duplicate-annotation: a bullet carries more than one `<!-- src: … -->` comment\n", file, bullet_ln
                bad = 1
            }
            pending = 0
            n = 0
            bullet = ""
        }
        /^<!-- src:/ {
            if (pending) { n++ } else {
                printf "%s:%d: orphan-annotation: a `<!-- src: … -->` must sit directly under a claim bullet\n", file, NR
                bad = 1
            }
            next
        }
        /^- / { flush(); pending = 1; n = 0; bullet = $0; bullet_ln = NR; next }
        { flush() }
        END { flush(); exit (bad ? 1 : 0) }
    '
    structure_status=$?
    if [ "$do_citations" -eq 1 ] && [ "$structure_status" -ne 0 ]; then
        return 1
    fi

    # Rule 1, anchors: exactly one per annotation, and it must resolve.
    [ "$do_citations" -eq 1 ] || {
        # citations arm disabled: fall through to the confidence arm only
        :
    }
    has_bad=0
    while IFS= read -r line; do
        [ -n "$line" ] || continue
        anchor="$(printf '%s\n' "$line" | sed -n 's/^<!-- src: \(.*\) -->$/\1/p')"
        if [ -z "$anchor" ]; then
            printf '%s: malformed-annotation: `%s` is not `<!-- src: <anchor> -->`\n' "$file" "$line"
            has_bad=1
            continue
        fi
        case "$anchor" in
            *,*|*';'*)
                printf '%s: multiple-anchors: `%s` holds more than one anchor; one comment carries one\n' "$file" "$anchor"
                has_bad=1
                continue
                ;;
        esac
        if ! anchor_resolves "$anchor"; then
            printf '%s: unresolvable-anchor: `%s` is not an http(s) URL and not an existing repo path:line\n' \
                "$file" "$anchor"
            has_bad=1
        fi
    done <<EOF
$(printf '%s' "$section" | grep '^<!-- src:' || true)
EOF
    if [ "$do_citations" -eq 1 ] && [ "$has_bad" -ne 0 ]; then
        return 1
    fi

    # Rule 4, ADR-138: no confidence level is recorded on a changelog claim.  The newest section only —
    # sections written before ADR-138 (2026-10-17) do record `Confidence: HIGH` blocks by the old
    # convention, and judging them would fail on history rather than on a defect.
    [ "$do_confidence" -eq 1 ] || return 0
    start="$(grep -n '^## \[' "$file" | head -1 | cut -d: -f1)"
    if printf '%s' "$section" | grep -nEi '(^|[^a-z])confidence[^a-z]{0,4}[:=]?[^a-z]{0,3}(high|medium|low)([^a-z]|$)' >/tmp/.cl-inner 2>/dev/null; then
        while IFS= read -r hit; do
            n="${hit%%:*}"
            printf '%s:%d: confidence-level-recorded: ADR-138 records no confidence level on a changelog claim\n' \
                "$file" "$((start + n - 1))"
        done </tmp/.cl-inner
        rm -f /tmp/.cl-inner
        return 1
    fi
    rm -f /tmp/.cl-inner
    return 0
}

# Each rule reports its own concern: `--citations-only` / `--confidence-only` select one arm.
do_citations=1
do_confidence=1
files=""
for arg in "$@"; do
    case "$arg" in
        --citations-only) do_confidence=0 ;;
        --confidence-only) do_citations=0 ;;
        --*) printf 'unknown option: %s\n' "$arg" >&2; exit 2 ;;
        *) files="$files $arg" ;;
    esac
done
[ -n "$files" ] || files="CHANGELOG.md"

status=0
for f in $files; do
    [ -f "$f" ] || continue
    check_file "$f" >/tmp/.changelog-citations.out 2>&1 || {
        cat /tmp/.changelog-citations.out
        status=1
    }
done
rm -f /tmp/.changelog-citations.out
exit "$status"
