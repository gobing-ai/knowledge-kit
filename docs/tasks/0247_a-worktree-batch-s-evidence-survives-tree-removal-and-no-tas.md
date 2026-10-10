---
schema_version: 1
name: A worktree batch's evidence survives tree removal and no task cites a dead path
status: done
template: feature-impl
created_at: 2026-10-10T02:29:09.812Z
updated_at: "2026-10-10T03:44:55.202Z"
feature_id: G7

ac_altitude: task-local
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0247-verdict.json
---

## 0247. A worktree batch's evidence survives tree removal and no task cites a dead path

### Background

On 2026-10-09 the batch `dev-runall --tasks 0235,0236 --auto --next --agent inline --worktree --wrap` implemented, verified, wrapped and FF-merged both tasks correctly (`main = 90e45811`, 28 files, G12 → done) — but its evidence plane did not survive the worktree removal, and the removal ran anyway.

**Confirmed, with evidence.**

- `inline-run-setup.ts --persist-out` refused fail-closed: `{"ok":false,"error":"persist-out: kk-itc run kk-itc-dryrun-1791591898421 is missing its run record `kk-itc-dryrun-1791591898421.md` in the worktree — failing closed before any row transfer (green-run evidence guarantee, 0984 R5 / 1043 R1)"}`, and the pre-removal check printed `persist-out-check: BLOCKED 58 missing, 0 divergent`.
- The delegate reports refusal as a JSON body on **stdout with exit 0**, so the driver's `|| exit 1` guard never fired and WT-4b removed the worktree and deleted the branch.
- **Lost with the tree** (its `/tmp`-free but gitignored `.spur` plane): the run records for `848ee451-…`, `574d1750-…` (task 0235), `703bf01b-…` (task 0236), `7890e622-…` (wrap) and `58193b7c-…` (feature verification), plus the `.spur/run/` scratch plane (gate logs, check receipts, review answer files).
- **Survived** (persisted before removal): the batch report and the per-batch verdict copies, both persisted into the invoking tree's scratch plane and the verdicts promoted into `.spur/memory/evidence/`, plus the committed task files carrying `## Solution` / `## Testing` / `## Review` and the dated Q&A deferral entries.
- **Dangling citations in the committed corpus:** task 0235 `## Review` → the run-scoped review-answer file `574d1750-…-review-answer.txt`; task 0236 `## Review` → `703bf01b-…-review-answer.txt`; task 0236 `## Testing` → the gate receipt `0236-check-receipt.json` (all three under the disposable `.spur/run/` plane, which died with the worktree). Task 0236's Q&A also cites the owed attended measurement `xhs-podcast-postfile.json`, deliberately deferred (recorded 2026-10-09) and required to stay absent.

**Anomaly — RESOLVED (2026-10-10, this task's R3).** The worktree DB carried a `kk-itc-dryrun-1791591898421` run row whose record file was absent, which tripped the fail-closed persistence. Cause, reproduced live: this project's own quality-gate test suite executes real `kk-itc` workflows against the tree DB (`apps/cli/tests/kk-itc-workflow.test.ts:276-284` builds run ids as `kk-itc-dryrun-<Date.now()>`; `apps/cli/tests/kk-itc-publish-tail.test.ts:57` likewise for `kk-itc-tail-*`) and inserts run rows **without** writing `.spur/memory/runs/<id>.md`. A freshly cut worktree starts empty and inherits nothing — it *creates* these rows when its gate runs. Repro and numbers in `## Testing` (R3); the fix (isolating the suite's DB, or recording those rows) belongs to the plugin/test surface and is out of this task's scope.

**Already resolved in the same session:** the harness-side cause (the delegate's exit code) is **not** this project's surface — it belongs to the `sp` plugin and is recorded as a session-review note. The 0235/0236 code itself is verified and merged; this task owns only the residue in this repository.

### Requirements

- [x] R1. **Repair the three dangling citations** in tasks 0235 and 0236 so every `.spur/...` path they cite resolves in this tree — or is rewritten to name the durable artifact that replaced it (`.spur/memory/evidence/<wbs>-verdict.json`, or the batch report persisted into the invoking tree). Lost evidence is marked as lost in place; it is never reconstructed from memory and no replacement file is fabricated. Entries are written through the CLI-gated section surface (`spur task update <wbs> --section <s> --from-file`), not by hand.
- [x] R2. **This class cannot land silently again.** A repo-level check fails when a task at `done`/`testing` cites a run-scoped path under the disposable `.spur/run/` or `.spur/memory/` planes that does not exist in the tree. Deliver it as a constraint rule (`spur rule add`, preset-scoped) or extend `no-scratch-verdict-pointer`'s family, and prove it with a negative control: the rule fires on the pre-repair 0235/0236 citations and passes after R1.
- [x] R3. **The `kk-itc-dryrun-1791591898421` anomaly is explained or fixed.** Record a reproducible check that distinguishes "the worktree DB starts empty" from "the worktree DB inherits rows": cut a fresh worktree, compare `.spur/memory/runs/` against the DB's run rows, and record which rows predate the tree. If a seeding path exists, fix it and pin it with a test; if the row is a legitimate cross-tree artefact, record why in the task's `## Testing`.
- [x] R4. **The R3-deferred artifact stays visibly owed.** `xhs-podcast-postfile.json` is cited as the operator-attended measurement still to be produced; the citation must read as owed, not as a missing file. No live/attended run is performed by this task.

### Acceptance Criteria

- [x] AC1 — A worktree batch's evidence survives tree removal and no task cites a dead path
  - Evidence (R1): `for w in 0235 0236; do grep -oE '\.spur/(run|memory)/[A-Za-z0-9._/-]+' docs/tasks/${w}_*.md | sort -u | while read -r p; do [ -e "$p" ] || echo "MISS $p"; done; done` reports **no** `MISS` line for a path that is not explicitly marked owed; and the durable replacements exist (`ls .spur/memory/evidence/0235-verdict.json .spur/memory/evidence/0236-verdict.json`).
  - Evidence (R2, negative control): the new/extended rule exits non-zero on the pre-repair citation set and `spur rule run --preset recommended-pre-check --fail-on warning` is clean afterwards; the rule's own smoke case is recorded in its `--json` output.
  - Evidence (R3): the recorded repro output (fresh worktree vs DB rows) is in `## Testing`, with either the fix + its regression test, or the explanation of why the row was present.
  - Evidence (R4): `grep -n 'xhs-podcast-postfile' docs/tasks/0236_*.md` shows the citation reads as owed (operator-attended, deferred), and the owed artifact is still absent (`test ! -e` on its path under the disposable plane) still holds.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-10T02:29:12.558Z

#### Q&A entry — 2026-10-09

- **Why a task and not a direct fix?** Repairing the citations edits sections owned by other pipeline stages (the review coordinator and the deterministic `record` step) and the correct durable pointer is a small content decision plus a new rule — past the "one-to-two-line, no-shared-write-path" bar for an inline fix.
- **Why is the R3-deferred artifact inside this task?** It is cited in 0236's Q&A as the measurement still owed; the repair must keep it visibly owed rather than treat it as a missing file. No attended run happens here.
- **What is explicitly out of scope?** The `sp` plugin's refusal-signalling (`{"ok":false}` with exit 0) and the batch driver's removal gating; those are recorded in the session review as a note for the plugin owner.

#### Q&A entry — 2026-10-09 (tracing note)

- **Known WARN:** `spur task check` reports `L4 Acceptance Criteria: Task scenario … is not in feature "G7"'s AC (DD-09 subset rule)`. Expected: G7 is a home feature whose single AC scenario is `R1 — Work on kk workflow run ledger has a home node`, which is about ownership, not about this capability. The check still PASSes. Clear it either by extending G7's AC with an evidence-retention scenario (a feature-scope decision for the operator) or by accepting the WARN.

### Design

**Seam.** Two changes, no production code.

1. **Citation repair (R1).** Rewrite the three pointers in place, in the sections that own them (`## Review` for both tasks, `## Testing` for 0236), to the durable artifacts that exist: the per-batch verdict copies, the promoted `.spur/memory/evidence/<wbs>-verdict.json`, and the batch report. Where the cited file is genuinely gone (the review answers and the check receipt), the citation says so and names the durable record that carries the same verdict — an honest dangling note beats a pointer at a deleted path.
2. **A rule for the class (R2).** The shipped `no-scratch-verdict-pointer` rule already forbids one *shape* of scratch pointer (a `done_reason` line naming a run-scoped verdict pointer). This finding is the same failure family one step wider: **any** citation to a run-scoped path under the disposable `.spur/run/` plane that does not exist. Author it as a constraint rule with a negative-control smoke case rather than a bespoke script, so it runs at the same gate the other rules do.

`docs/99_PROJECT_CONSTITUTION.md` is untouched: this is a corpus-hygiene rule plus a corpus edit, not a process change.

**Rejected.**
- **Regenerating the lost artifacts** (review answers, gate logs, receipts) from the session transcript or from the verdict: fabrication of evidence, and it would defeat the fail-closed guarantee that made the loss visible.
- **Deleting the citations outright**: it hides that the evidence exists somewhere and would erase the pointer to the deferred `xhs-podcast-postfile.json`.
- **Making the repo check a bespoke script**: a rule is cheaper, runs in the existing preset, and gets the negative-control discipline for free.
- **Fixing the sp-plugin driver here** (gate removal on the delegate's JSON `ok`): the wrong repository — recorded as a session-review note for the `sp` plugin owner.

**Bounded execution.** Classification plus corpus edits only: `mutationPolicy: docs`. The R2 rule is a corpus artefact; the R3 investigation is read-only plus a recorded repro. No source, no gate-script, no workflow change.

### Plan

1. R1: repair the three citations through the CLI section surface; re-run the citation sweep to prove no unjustified `MISS` remains (AC1 evidence 1).
2. R2: author the citation-existence rule, run its negative control against the pre-repair text, then `spur rule run --preset recommended-pre-check --fail-on warning`.
3. R3: cut a throwaway worktree, compare `.spur/memory/runs/` with the DB's run rows, record the result; fix + pin only if a seeding path is confirmed.
4. R4: make the deferred-artifact citation read as owed; confirm the file is still absent.
5. `bun run lint` + `spur task check <wbs> --as done` on the changed corpus; no source tests are expected to change.

### Solution

**Seam.** Two changes, no production code (`mutationPolicy: docs`). One anchor per row (L4 anchor rule).

**1. Citation repair (R1/R4).** Every dead pointer in tasks 0235/0236 was rewritten to the durable artifact that survives a worktree removal, and the genuinely lost ones are marked lost **in place**. No evidence file was reconstructed and no replacement artifact was fabricated.

- The deferred-live-evidence Q&A entry now records the loss and cites the durable verdict record. `docs/tasks/0235_the-note-pairs-each-generated-image-with-its-text.md:82`
- The 0235 review narration records the run-scoped answer file as LOST and names the durable PASS record. `docs/tasks/0235_the-note-pairs-each-generated-image-with-its-text.md:176`
- The 0235 review limitation records the gate receipt as LOST and points at the digest preserved in the durable record. `docs/tasks/0235_the-note-pairs-each-generated-image-with-its-text.md:190`
- The 0236 Background describes the earlier modal-open capture as scratch under the disposable plane. `docs/tasks/0236_the-note-uploads-the-episode-mp3-and-cover-as-one-episode.md:30`
- The 0236 Q&A carries the single authoritative OWED declaration for the deferred attended measurement (R4). `docs/tasks/0236_the-note-uploads-the-episode-mp3-and-cover-as-one-episode.md:76`
- The 0236 review narration records the run-scoped answer as LOST and names the durable PASS record. `docs/tasks/0236_the-note-uploads-the-episode-mp3-and-cover-as-one-episode.md:199`
- The 0236 review history records the check receipt as LOST with the digest preserved in the durable record. `docs/tasks/0236_the-note-uploads-the-episode-mp3-and-cover-as-one-episode.md:212`

**2. A rule for the class (R2).**

- Registered as a constraint rule in the shipped preset. `.spur/rules/structure/scratch-citation-existence.yaml:28`
- The evaluator kind that runs the checker. `.spur/rules/structure/scratch-citation-existence.yaml:39`
- The corpus scope the evaluator reads. `.spur/rules/structure/scratch-citation-existence.yaml:45`
- The run-scoped pointer predicate `run_scoped`: which citations are in scope. `.spur/rules/structure/scratch-citation-existence.sh:105`
- The pre-rule backlog block of 18 task/path pairs, shrink-only. `.spur/rules/structure/scratch-citation-existence.sh:52`
- The sweep passes the file list through `xargs -0`, so a path containing a space cannot be shredded. `.spur/rules/structure/scratch-citation-existence.sh:79`
- The OWED/LOST exemption is collected per file and matched against each cited path. `.spur/rules/structure/scratch-citation-existence.sh:129`
- The scanner's exit status is captured into `scan_status`. `.spur/rules/structure/scratch-citation-existence.sh:165`
- A failed scan refuses to report a clean corpus. `.spur/rules/structure/scratch-citation-existence.sh:167`
- Falsification case: a failed scan must fail closed. `.spur/rules/structure/scratch-citation-existence.test.sh:159`
- Falsification case: the pre-repair corpus must fire. `.spur/rules/structure/scratch-citation-existence.test.sh:181`

**Scope decision (why not every `.spur/...` citation).** A repo-wide existence check over all `.spur/run|memory` citations cannot be green: the corpus already carries ~500 such citations (~340 unique task/path pairs), mostly narrative references to disposable scratch (dogfood logs, discovery fixtures) that are dead in any fresh checkout. The rule therefore covers the pointers the pipeline writes per run — the class the 2026-10-09 incident produced — and enumerates the 18 pre-rule pairs of that class as visible, shrink-only debt.

**AC altitude.** `spur task update 0247 --ac-altitude task-local` declares this task's AC task-scoped, which is the check's own escape from the DD-09 subset rule: G7 is a home node whose single AC scenario is about run-ledger ownership, not about evidence retention. The task's Q&A already recorded this choice (extend G7's AC — a feature-scope decision for the operator — or accept the WARN); the non-destructive declaration is used here and G7 is left untouched.

**Blast radius.** 3 new files (rule + checker + cases), 2 edited corpus files. No source, test, workflow, or `docs/00`–`05` change; `docs/99_PROJECT_CONSTITUTION.md` is untouched.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | The three pre-repair citations in 0235/0236 were rewritten through the CLI section surface. Sweep `for w in 0235 0236; do grep -oE '\.spur/(run\|memory)/[A-Za-z0-9._/-]+' docs/tasks/${w}_*.md \| sort -u \| while read -r p; do [ -e "$p" ] \|\| echo "MISS $w $p"; done; done` reports exactly one line — one MISS line naming the R4-owed attended measurement (declared OWED in task 0236, deliberately absent) — and no unexplained MISS. Repaired sections: `docs/tasks/0235_the-note-pairs-each-generated-image-with-its-text.md:82` and `:176` (both now record the loss and cite `.spur/memory/evidence/0235-verdict.json`), `docs/tasks/0236_the-note-uploads-the-episode-mp3-and-cover-as-one-episode.md:199` and `:212` (same against `.spur/memory/evidence/0236-verdict.json`). The durable replacements exist in this tree: `ls .spur/memory/evidence/0235-verdict.json .spur/memory/evidence/0236-verdict.json` exits 0. `spur task check 0235` and `spur task check 0236` both PASS. Nothing was reconstructed: the section text names the lost run-scoped files as LOST and points at the promoted verdict artifacts. |
| R2 | MET | Rule `no-dead-run-scoped-citation` (severity `error`, `exit-code` evaluator) is registered in the shipped preset — `spur rule list --preset recommended-pre-check` prints `source=preset:recommended-pre-check`, and the project gate runs it (`bun run spur-check` → `test-pre-check`; the gate log records `All 53 rules passed — no violations found`). Negative control: `sh .spur/rules/structure/scratch-citation-existence.test.sh` reports 11 passed / 0 failed, including `PASS pre-repair-negative-control (exit 1)` — the checker fires on the PRE-repair 0235/0236 text read from git HEAD, printing `MISS 0235 574d1750-…-review-answer.txt`, `MISS 0236 703bf01b-…-review-answer.txt` and the pre-repair check-receipt pointer quoted in task 0236's own evidence — and `PASS repaired-corpus-passes (exit 0)` on the working tree. The scanner's own failure path is pinned: `PASS failed-scan-fails-closed (exit 1)`. `spur rule run --preset recommended-pre-check --fail-on warning` is clean. |
| R3 | MET | Recorded repro in a freshly cut throwaway worktree: before any command `ls .spur/spur.db` fails (no DB); after tooling created it, `select count(*) from runs` on `.spur/spur.db` returns 0; the tree's own run row and its record file are written together (`select id from runs` → `r3-probe-1`, and the record file for that id is present in the tree's run-record directory); deleting that record file leaves the row (`select count(*) from runs where id='r3-probe-1'` → 1 while the file is gone) — the incident's row-without-record shape, reachable in a per-tree DB with no inheritance. Rows appear only when the DB FILE is copied in (`cp` of the invoking tree's `.spur/spur.db` → 4100 rows). No seeding path exists: greps for `spur.db` across `apps/ packages/ plugins/ scripts/ config/` and across the `sp` plugin scripts return 0 hits, and `.gitignore` covers the DB and both evidence planes, so `git worktree add` cannot materialise rows. The specific `kk-itc-dryrun-1791591898421` row is unrecoverable: 0 hits in the invoking tree DB, the run worktree DB and the still-existing runall worktree DB, and 0 record files anywhere under `~/xprojects` — the holding worktree was removed. Conclusion: the worktree DB starts empty and does not inherit rows; the row was that tree's own kk-itc dry-run artefact whose record file was absent, which is exactly what the fail-closed persistence guard reported. **Delegate exit-status correction (verified 2026-10-10):** `persist-out` today prints the refusal as `{"ok":false,"error":…}` on stdout and **exits 1** (re-measured against a synthetic dead citation in this run), so the Background's "refusal … with exit 0" observation no longer reproduces on the delegate itself — the residual risk is now confined to the driver's pre-removal guard consuming that status, which stays the plugin owner's check. **Root cause confirmed in this run (post-certification correction, 2026-10-10):** the record-less row is created by the quality-gate test suite itself — `apps/cli/tests/kk-itc-workflow.test.ts:276-284` (run ids `kk-itc-dryrun-<Date.now()>`) and `apps/cli/tests/kk-itc-publish-tail.test.ts:57` (`kk-itc-tail-*`) execute real workflows against the tree DB and leave rows with no record file. Repro in this run's worktree after each gate: 9 `kk-itc-*` plus 1 `run_*` record-less rows (created 2026-10-10T03:12:44Z, 03:31:04Z, 03:35:42Z — one cluster per gate run), and `persist-out` refused verbatim `kk-itc run kk-itc-dryrun-1791601964676 is missing its run record … failing closed before any row transfer (0984 R5 / 1043 R1)` — the incident's exact error shape. Removing only those record-less test-residue rows let the same command succeed (`{"ok":true,"persisted":14,"skipped":[]}`), which also confirms the property this task certifies: the batch's own provenance persists. Out of scope here: isolating the suite's DB (or writing records for those rows) is a plugin/test fix. |
| R4 | MET | `grep -c 'OWED' docs/tasks/0236_*.md` → 3, including the single authoritative declaration at `docs/tasks/0236_the-note-uploads-the-episode-mp3-and-cover-as-one-episode.md:76` (`OWED (not missing, not lost)`), with the `## Testing` rows reading `OWED`/`DEFERRED` rather than missing. a `test ! -e` on the owed artifact's path under the disposable plane holds — the attended measurement stays visibly owed and is not claimed. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — A worktree batch's evidence survives tree removal and no task cites a dead path | MET | test | R1: the sweep above reports no unexplained MISS; `ls .spur/memory/evidence/0235-verdict.json .spur/memory/evidence/0236-verdict.json` exits 0. R2: `spur rule list --preset recommended-pre-check` shows the rule enabled; the rule's suite is 11 passed / 0 failed with the pre-repair negative control firing (exit 1) and the repaired corpus passing (exit 0); the preset is clean at `--fail-on warning`; the gate log carries `All 53 rules passed` plus `Ran 2361 tests across 129 files … 0 fail`. R3: the recorded transcript above (fresh tree → 0 rows; own row + record; record removed → row retained; inheritance only via an explicit DB copy; 0 seeding hits; the anomaly row absent from every surviving plane). R4: the OWED declaration is present and the artifact is still absent. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Verdict: PASS

| Priority | Finding | Location | Disposition |
| --- | --- | --- | --- |
| P1 (blocker) | None. | — | — |
| P2 (major) | None. The run-2 review's P2 (the checker discarded the scanner's exit status, so a failed scan reported a clean corpus) is FIXED in the bounded repair hop: a non-zero scan status now exits 1 with `INVALID: citation scan failed`, pinned by the new `failed-scan-fails-closed` falsification case (11/11 cases pass). | `.spur/rules/structure/scratch-citation-existence.sh:172` | FIXED; re-certified on the fresh digest `sha256:eb28484b…` by `spur-check` (2361 tests, 0 fail; 53 rules passed). |
| P3 (minor) | None. | — | — |
| P4 (advisory) | Run-scoped UUID shapes match lowercase hex run ids only; an uppercase or shortened id (e.g. the `B7046686-…` citation in task 0137) stays out of scope. | `.spur/rules/structure/scratch-citation-existence.sh:33-36` (scope block) | Recorded and now documented in the checker header. |
| P4 (advisory) | Non-run-scoped narrative citations under `.spur/run/` (dogfood logs, discovery fixtures — ~340 pre-existing task/path pairs) remain out of scope by design; a future dead pointer of that shape still lands silently. | `.spur/rules/structure/scratch-citation-existence.sh:38-46` | Recorded; deliberate scope decision, stated in the header, the rule description, and the task's Q&A. |
| P4 (advisory) | Resolution is tree-relative and the durable target is itself gitignored, so no evidence-plane citation is resolvable in a fresh clone; the rule keeps the class visible but cannot make the plane durable. | `.spur/rules/structure/scratch-citation-existence.sh:169` | Recorded; tracking the durable plane is a follow-up beyond this task. |
| P4 (advisory) | The 18-pair pre-rule backlog (`.spur/rules/structure/scratch-citation-existence.sh:50-70`) is debt and only shrinks when a task is touched. | same | Recorded; shrink-only policy stated in the header and the rule description. |
| P4 (advisory) | The worktree delegate reports `{"ok":false}` on stdout with exit 0, so a caller-side `|| exit 1` guard never fires — the run-1 incident's root cause. Out of this repository's surface. | session note; task 0247 Q&A | Recorded for the `sp` plugin owner (out of scope per the task's Q&A). |
| P4 (advisory) | Run 1 of this task was halted by the review-entry proof tripwire after the checker was patched post-capture; run 2 re-certified on a fresh digest from the same tree. | `.spur/memory/runs/8ca15833-cd9b-420d-8199-1101600d8623.md` | Recorded; the tripwire behaved as designed (stale certification refused, never reconciled). |

**Residual risk.** The AC1 evidence bullets are certified on executable evidence in this tree; the deferred attended measurement (`xhs-podcast-postfile.json`) stays OWED in task 0236 and is explicitly not claimed here (task 0247 R4). The rule's scope limits are documented rather than silent.

**Review limitation.** Reviewed read-only against the frozen digest `sha256:eb28484b…`: the final three rule files and the two repaired corpus files were re-read, the rule's 11 falsification cases were re-run (11 passed, 0 failed), and the recheck gate log was re-read. No production source is touched by this task.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-10T02:29:28.143Z backlog → todo (system)
- 2026-10-10T03:10:42.347Z todo → wip (system)
- 2026-10-10T03:39:15.458Z wip → testing (system)
- 2026-10-10T03:40:05.483Z testing → done (system)

