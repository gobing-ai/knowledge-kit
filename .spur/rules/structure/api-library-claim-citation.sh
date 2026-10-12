#!/bin/sh
# API/library claim-block citation check (rule `api-library-claim-citations`).
#
# Runnable by hand — the rule's own message points here, because the `exit-code` evaluator reports
# only the exit status, not this script's output:
#
#   sh .spur/rules/structure/api-library-claim-citation.sh      # 0 = ok, 1 = findings on stdout
#   sh .spur/rules/structure/api-library-claim-citation.sh <file>…               # explicit files
#   sh .spur/rules/structure/api-library-claim-citation.sh --require-block=<path> # presence arm
#   sh .spur/rules/structure/api-library-claim-citation.test.sh # falsification cases for the above
#
# PRESENCE ARM (`--require-block`, rule `api-library-claim-block-required`). The contract below judges
# a block that EXISTS; a document asserting API/library claims with no block at all was therefore
# ungated. Measured 2026-10-12: 161 docs carry a strong claim signal (an installed `node_modules/`
# path, a scoped package, an `/api/` route or a host ABI token such as `apiVersion`) and only 4 carry
# a block — so requiring the block on that signal repo-wide would fail on 157 documents of history,
# the same trap the sibling confidence rule avoided. The arm is therefore a DECLARED REGISTRY: the
# operator names the documents whose claims are load-bearing (a delivery's design satellite and its
# task files), and the rule makes that declaration binding. It is a rule argument, so it stays
# reviewable in one place and extends to a new delivery with one line — never a prose heuristic over
# 400 documents.
#
# Contract, per `#### API/library claim sources and confidence` block:
#
#   1. the block holds at least one data row of the convention's 4-column table
#      (`Claim | Source | Local verification | Confidence`) — an empty block is what survives a
#      copy-paste from a template;
#   2. every row's Confidence cell BEGINS with HIGH|MEDIUM|LOW. A qualified tail is allowed
#      ("HIGH for the monorepo; MEDIUM for third-party layouts" — row 0155:348) because it carries
#      more truth than a single letter; the LEADING level is the claim, and a qualifier cannot
#      smuggle a claim past the enum;
#   3. that level is EARNED, judged ROW-scoped:
#        HIGH          -> the row cites evidence: an http(s) URL, a `path:line`, or a path carrying
#                         a code/doc extension;
#        MEDIUM / LOW  -> the row cites evidence, or names what is unverified (a gap marker such as
#                         "not re-fetched", "inferred", "unable to …").
#
# Why the earnedness arm exists. A row claiming HIGH with an empty Source cell is the claim-table
# equivalent of a PASS without evidence — the same argument the sibling
# `verification-confidence-level` rule makes for `Verification (` blocks. Scope is the ROW, not the
# block: one weak row must not be laundered by a cited neighbour three lines up (which is why the
# REPO's row format is per-claim, not per-document).
#
# Why a reproducible command is NOT a citation. A row whose evidence is a command ("rg -l …") names
# no artifact a reader can open, so it cannot carry HIGH; the honest repair is to append the path
# that command resolved to (task 0157's row did exactly that). The trade is deliberate: the rule
# prefers one honest `path:line` over accepting "I ran something".
#
# PRESENCE is deliberately not enforced, mirroring the sibling rule. Three documents in this repo
# carry the convention and hundreds assert API/library facts without it, so a presence requirement
# would fail the gate on history rather than on a defect: this rule judges what a block claims,
# never whether a document claims. Requiring the block is a task-AC decision — an API/library-bearing
# task's AC names it — and the sibling rule covers the close-out half of the pair (`Verification (`
# blocks already have to cite for HIGH). Together the two rules bound both surfaces; neither
# duplicates the other.
#
# Optional arguments: pass explicit markdown files to check instead of the repo sweep — the seam the
# self-test uses (`.test.sh`), and handy by hand for a single document.
set -u

# `--require-block=<path>` (repeatable) declares a claim-bearing document; every other argument is an
# explicit file to judge, and no argument at all means the repo sweep.
registry=""
explicit=""
for arg in "$@"; do
    case "$arg" in
        --require-block=*) registry="$registry ${arg#--require-block=}" ;;
        *) explicit="$explicit $arg" ;;
    esac
done

if [ -n "$explicit" ]; then
    files="$explicit"
else
    files="$(rg --files -g 'docs/**/*.md' -g '!**/node_modules/**' -g '!**/vendors/**' . 2>/dev/null || true)"
fi

errors=0

# Presence arm: a declared claim-bearing document must carry the block (and then joins the judgement
# list, so its rows face the same contract as every other block). A declared file that is absent from
# disk is a NOTE, never a finding — a renamed task must not break the gate.
for f in $registry; do
    if [ ! -f "$f" ]; then
        echo "NOTE: declared claim-bearing document is absent: $f"
        continue
    fi
    if grep -qiE '^#{2,4}[ \t]+API[ \t]*/?[ \t]*library claim sources and confidence' "$f"; then
        files="$files $f"
    else
        printf 'INVALID: %s: declared API/library claim-bearing but carries no `API/library claim sources and confidence` block — add the cited claim table, or drop it from the registry (rule api-library-claim-block-required)\n' "$f"
        errors=$((errors + 1))
    fi
done

gap_re='unverif|not (yet )?(re-)?(run|verified|tested|checked|confirmed|fetched|reproduced|demonstrated)|missing|could not|unable to|assumed|inferred|no evidence|unknown|not available|left untested'

for f in $files; do
    [ -f "$f" ] || continue
    out="$(awk -v file="$f" -v gap_re="$gap_re" '
        # A citation needs an openable artifact: a URL, a `path:line`, or a path with a code/doc
        # extension. Escape-free by design — BWK awk dynamic-regex `\.` handling is unreliable (the
        # sibling rule hit that: `\.` silently matched the word "bullets"), and over-accepting here
        # weakens one arm instead of producing a wrong finding.
        function is_cite(s,   i, exts, e) {
            if (index(s, "://") > 0) return 1
            if (s ~ /[A-Za-z0-9_.\/-]+:[0-9]+/) return 1
            e = "ts tsx js jsx mjs json yaml yml md sh py sql toml txt lock css html"
            n = split(e, exts, " ")
            for (i = 1; i <= n; i++) if (index(s, "." exts[i]) > 0) return 1
            return 0
        }
        # A row cell may contain an ESCAPED pipe (`\|`, used by task 0157 to quote `data \| error`
        # inline); swapping it out before the field split is what keeps such a row 4 cells wide.
        function cells(line, arr,   s) {
            s = line
            gsub(/\\\|/, "\001", s)
            return split(s, arr, "|")
        }
        function judge(   level) {
            if (!inb) return
            if (rows == 0) {
                printf "INVALID: %s: `%s` block has no data row — an empty claim table asserts nothing\n", file, head
                bad = 1
            }
            inb = 0
        }
        /^#{1,6}[ \t]/ {
            judge()
            head = $0
            inb = ($0 ~ /^#{2,4}[ \t]+API[ \t]*\/?[ \t]*[Ll]ibrary claim sources and confidence/ && $0 ~ /confidence/)
            rows = 0
            next
        }
        inb && /^\|/ {
            n = cells($0, c)
            if (n != 6) {
                printf "INVALID: %s:%d: claim row has %d cells (want the convention'\''s 4) — %s\n", file, NR, n - 2, substr($0, 1, 60)
                bad = 1
                next
            }
            conf = c[5]
            sub(/^[ \t]*\**[ \t]*/, "", conf)
            if (c[2] ~ /^[ \t]*:?-+:?[ \t]*$/ || c[2] ~ /^[ \t]*Claim/) next   # separator / header row
            rows += 1
            if (conf !~ /^(HIGH|MEDIUM|LOW)([^A-Za-z]|$)/) {
                printf "INVALID: %s:%d: claim row confidence %s is outside HIGH|MEDIUM|LOW\n", file, NR, (conf == "" ? "is empty" : "\"" substr(conf, 1, 24) "\"")
                bad = 1
                next
            }
            level = conf
            sub(/[^A-Za-z].*$/, "", level)   # the leading level is the claim; a qualifier tail is allowed
            cited = (is_cite(c[3]) || is_cite(c[4]))
            gapped = (tolower(c[3] " " c[4] " " c[5]) ~ gap_re)
            if (!cited && (level == "HIGH" || !gapped)) {
                printf "INVALID: %s:%d: %s claim cites no source", file, NR, level
                if (level == "HIGH") print " (HIGH must cite a URL, path:line, or path with an extension)"
                else print " and names no gap — cite evidence or state what is unverified"
                bad = 1
            }
        }
        END { judge(); exit bad }
    ' "$f")" || errors=$((errors + 1))
    [ -n "$out" ] && printf '%s\n' "$out"
done

[ "$errors" -eq 0 ] || exit 1
