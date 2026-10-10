#!/bin/sh
# Scratch-citation existence check (rule `no-dead-run-scoped-citation`).
#
# Runnable by hand — the rule's own message points here, because the `exit-code` evaluator reports
# only the exit status, not this script's output:
#
#   sh .spur/rules/structure/scratch-citation-existence.sh      # 0 = ok, 1 = findings on stdout
#   sh .spur/rules/structure/scratch-citation-existence.test.sh # falsification cases
#
# ADR-131 makes `.spur/run/` and `.spur/memory/` disposable per-tree planes: a `--worktree` batch
# that is removed takes its copy with it, so the directory may be absent in any later run. A task's
# durable record must therefore not cite a run-scoped pipeline pointer whose file is gone — the
# 2026-10-09 incident (task 0247) left four such citations in tasks 0235/0236 after a worktree batch
# FF-merged its corpus writes but dropped its evidence plane (review answers, check receipt).
#
# Contract, for every task at `done` or `testing`, for every citation of a RUN-SCOPED PIPELINE
# POINTER — `.spur/run/<run-uuid>…`, `.spur/memory/runs/<run-record>`, `.spur/run/<wbs>-check-receipt.json`
# and `.spur/run/<wbs>-verify-answer.txt`, i.e. the files the pipeline itself writes per run:
#
#   1. the cited path must exist in the tree the check runs in (the tree is the resolution root — a
#      pointer that resolves only in the developer's own checkout is the broken reference this rule
#      is about);
#   2. a citation is EXEMPT when its own line carries `OWED` or `LOST` (case-insensitive, e.g.
#      "receipt was LOST with the worktree"), or when the same task file declares that exact path
#      OWED/LOST anywhere — a genuinely owed artifact must read as owed, not as a missing file
#      (task 0247 R4);
#   3. a (wbs, path) pair in the pre-rule backlog below is exempt. The backlog is debt, not a
#      licence: it may only shrink, and a pair is retired by repairing or marking the citation in
#      the same write that touches the task.
#
# Scope limits, deliberate:
#   * The task WBS is read from the first four characters of the file's basename, so the `<wbs>-…`
#     shapes assume the corpus' `NNNN_slug.md` naming.
#   * The run-scoped UUID shape matches lowercase hex run ids; an uppercase or shortened id (e.g.
#     `B7046686-…`) is not recognized as run-scoped and stays out of scope.
#   * Tasks at other statuses are out of scope — an in-flight task cites scratch it is still writing.
#   * Non-pointer narrative citations under `.spur/run/` (dogfood logs, discovery fixtures, ad-hoc
#     scratch) are out of scope. They are knowingly-scratch evidence of past runs, not the
#     machine-consumed pointers this rule protects; a repo-wide existence check over them would
#     carry 300+ pre-existing pairs and could not be maintained.
#   * Documents outside `docs/tasks*` are out of scope (design docs and source legitimately describe
#     what the pipeline writes under `.spur/`).
#
# Optional arguments: pass explicit task files to check instead of the repo sweep — the seam the
# self-test uses (`.test.sh`), and handy by hand for a single task.
set -u

# --- pre-rule backlog (2026-10-10): one `<wbs><TAB><path>` per line, run-scoped pointers only ----
# Every line is a real broken pointer that predates this rule (verified dead in the invoking tree AND
# in a fresh checkout — a pair that resolves only in one developer's checkout is dead by design here).
# Retire a pair when its task is touched; do not add to this list — repair the citation instead.
backlog="$(cat <<'EOF'
0032	.spur/run/0032-verify-answer.txt
0096	.spur/run/0096-verify-answer.txt
0098	.spur/run/0098-verify-answer.txt
0157	.spur/run/0157-verify-answer.txt
0158	.spur/run/0158-verify-answer.txt
0172	.spur/run/040c7887-c3a2-4ca1-b037-3193b9105dcf.md
0172	.spur/run/05d2535a-f7fe-433c-8056-e541754abd54.md
0175	.spur/memory/runs/refine0175-receipt-clean.md
0176	.spur/run/040c7887-c3a2-4ca1-b037-3193b9105dcf.md
0177	.spur/run/0177-check-receipt.json
0177	.spur/run/0177-verify-answer.txt
0178	.spur/run/0178-check-receipt.json
0178	.spur/run/0178-verify-answer.txt
0179	.spur/run/0179-verify-answer.txt
0191	.spur/memory/runs/runall-e91-8a7d8e-0191.md
0211	.spur/run/4606d18a-5223-46e1-9d8d-d8887db48807-implement-partial.md
0218	.spur/memory/runs/load-
0226	.spur/run/0226-check-receipt.json
EOF
)"

# The file list travels as argv, never as a word-split string: repo paths may contain spaces, and
# `awk ... $files` would silently shred such a path into fragments that each look like a task file.
if [ "$#" -gt 0 ]; then
    cites_input() { BACKLOG="$backlog" awk "$program" "$@"; }
else
    cites_input() { rg --files -0 -g 'docs/tasks*/**/*.md' . 2>/dev/null | BACKLOG="$backlog" xargs -0 awk "$program"; }
fi

# Phase 1 (awk): emit every in-scope, non-exempt citation as a CITE row. Phase 2 (shell): report the
# ones whose path does not exist. The existence test stays in the shell so it cannot depend on an
# awk `system()` exit-status convention.
# The backlog travels through the environment: `awk -v` interprets escape sequences, so a literal
# tab/newline list arrives corrupted.
program='
    function basename4(fullpath,   n, parts) {
        n = split(fullpath, parts, "/")
        return substr(parts[n], 1, 4)
    }
    # `.spur/(run|memory)/…` token at/after `pos` in `line`, or "" when there is none.
    function extract(line, out,   pos, s, tok, n) {
        n = 0
        pos = 1
        while (match(substr(line, pos), /\.spur\/(run|memory)\/[A-Za-z0-9._\/-]+/)) {
            s = RSTART
            tok = substr(substr(line, pos), s, RLENGTH)
            out[++n] = tok
            pos = pos + s + RLENGTH - 1
        }
        return n
    }
    # The pipeline writes these per run; they are the pointers a durable record may not dangle on.
    function run_scoped(tok, wbs) {
        if (tok ~ /^\.spur\/run\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/) return 1
        if (tok ~ /^\.spur\/memory\/runs\/.+/) return 1
        if (tok == ".spur/run/" wbs "-check-receipt.json") return 1
        if (tok == ".spur/run/" wbs "-verify-answer.txt") return 1
        return 0
    }
    function flush(   y, i, n, toks, otoks, wbs, status, ymldone, line, owed, n2) {
        if (prev == "") return
        wbs = basename4(prev)
        status = ""
        ymldone = 0
        owed = ""
        # pass A: status (frontmatter only) + file-level OWED/LOST declarations
        for (y = 1; y <= nl; y++) {
            line = lines[y]
            if (!ymldone && line ~ /^## /) ymldone = 1
            if (!ymldone && line ~ /^status:[ \t]/) {
                status = line
                sub(/^status:[ \t]*/, "", status)
                sub(/[ \t].*$/, "", status)
            }
            if (toupper(line) ~ /OWED|LOST/) {
                n2 = extract(line, otoks)
                for (i = 1; i <= n2; i++) owed = owed "\t" otoks[i] "\t"
            }
        }
        if (status != "done" && status != "testing") return
        # pass B: in-scope citations not exempted by the line marker, the file declaration, or the backlog
        for (y = 1; y <= nl; y++) {
            line = lines[y]
            n = extract(line, toks)
            if (n == 0) continue
            for (i = 1; i <= n; i++) {
                if (!run_scoped(toks[i], wbs)) continue
                if (index(owed, "\t" toks[i] "\t") > 0) continue
                if ((wbs "\t" toks[i]) in skip) continue
                if (toupper(line) ~ /OWED|LOST/) continue
                printf "CITE\t%s\t%s\t%s\t%d\n", wbs, toks[i], prev, y
            }
        }
    }
    BEGIN {
        n = split(ENVIRON["BACKLOG"], g, "\n")
        for (i = 1; i <= n; i++) {
            sub(/[ \t]+$/, "", g[i])
            if (g[i] != "") skip[g[i]] = 1
        }
        prev = ""
    }
    FNR == 1 { flush(); prev = FILENAME; nl = 0 }
    { lines[++nl] = $0 }
    END { flush() }
'
# The helper takes the file list as its own arguments — a POSIX function does not inherit the
# caller's positional parameters.
# The scanner's exit status is load-bearing: an empty result from a FAILED scan (awk error, an
# unreadable file, an xargs failure) must fail closed. Reading it as a clean corpus would be the
# exact silent-evidence-loss failure this rule exists to stop.
cites="$(cites_input "$@")"
scan_status=$?
if [ "$scan_status" -ne 0 ]; then
    echo "INVALID: citation scan failed (status $scan_status) — refusing to report a clean corpus from a failed scan"
    exit 1
fi
# A sweep that matched nothing is a broken invocation (wrong cwd / missing corpus), not a clean pass.
if [ "$#" -eq 0 ] && [ -z "$(rg --files -g 'docs/tasks*/**/*.md' . 2>/dev/null || find docs -path 'docs/tasks*' -name '*.md' 2>/dev/null)" ]; then
    echo "INVALID: no task files found — the citation contract has nothing to check (expected docs/tasks*/**/*.md)"
    exit 1
fi

findings=""
[ -z "$cites" ] || findings="$(printf '%s\n' "$cites" | while IFS="$(printf '\t')" read -r _tag wbs tok file line; do
    [ -e "$tok" ] || printf 'MISS %s %s (%s:%s)\n' "$wbs" "$tok" "$file" "$line"
done)"

if [ -n "$findings" ]; then
    printf '%s\n' "$findings"
    echo "---" >&2
    echo "scratch-citation-existence: $(printf '%s\n' "$findings" | wc -l | tr -d ' ') dead run-scoped .spur/... pointer(s) in done/testing tasks (ADR-131). Retarget at .spur/memory/evidence/<wbs>-verdict.json, mark the line OWED/LOST when the artifact is genuinely owed or gone, or retire the pre-rule backlog entry after repairing it." >&2
    exit 1
fi
exit 0
