---
schema_version: 1
name: A worktree batch's evidence survives tree removal and no task cites a dead path
status: todo
template: feature-impl
created_at: 2026-10-10T02:29:09.812Z
updated_at: "2026-10-10T02:29:28.143Z"
feature_id: G7

---

## 0247. A worktree batch's evidence survives tree removal and no task cites a dead path

### Background

On 2026-10-09 the batch `dev-runall --tasks 0235,0236 --auto --next --agent inline --worktree --wrap` implemented, verified, wrapped and FF-merged both tasks correctly (`main = 90e45811`, 28 files, G12 → done) — but its evidence plane did not survive the worktree removal, and the removal ran anyway.

**Confirmed, with evidence.**

- `inline-run-setup.ts --persist-out` refused fail-closed: `{"ok":false,"error":"persist-out: kk-itc run kk-itc-dryrun-1791591898421 is missing its run record `kk-itc-dryrun-1791591898421.md` in the worktree — failing closed before any row transfer (green-run evidence guarantee, 0984 R5 / 1043 R1)"}`, and the pre-removal check printed `persist-out-check: BLOCKED 58 missing, 0 divergent`.
- The delegate reports refusal as a JSON body on **stdout with exit 0**, so the driver's `|| exit 1` guard never fired and WT-4b removed the worktree and deleted the branch.
- **Lost with the tree** (its `/tmp`-free but gitignored `.spur` plane): the run records for `848ee451-…`, `574d1750-…` (task 0235), `703bf01b-…` (task 0236), `7890e622-…` (wrap) and `58193b7c-…` (feature verification), plus the `.spur/run/` scratch plane (gate logs, check receipts, review answer files).
- **Survived** (persisted before removal): `.spur/run/worktree-9c39-batch-report.md`, `.spur/run/worktree-9c39-verdicts/{0235,0236}-verdict.json` (both promoted to `.spur/memory/evidence/`), and the committed task files carrying `## Solution` / `## Testing` / `## Review` and the dated Q&A deferral entries.
- **Dangling citations in the committed corpus:** task 0235 `## Review` → `.spur/run/574d1750-9e6b-46ac-bff3-d5385cb11d8c-review-answer.txt`; task 0236 `## Review` → `.spur/run/703bf01b-b950-4b5e-a0d3-6834b977a3e0-review-answer.txt`; task 0236 `## Testing` → `.spur/run/0236-check-receipt.json`. Task 0236's Q&A also cites `.spur/run/discovery/xhs-podcast-postfile.json`, which is deliberately owed (R3 deferred, recorded 2026-10-09) and must stay absent.

**Unexplained anomaly (hypothesis, needs a repro).** The worktree DB carried a `kk-itc-dryrun-1791591898421` run row whose record file was absent, which is what tripped the fail-closed persistence. That run belongs to this project's earlier state; a freshly cut worktree should start with an empty DB. **Hypothesis:** the worktree's `.spur` DB was seeded from the invoking tree, or one `spur` invocation ran without the per-call tree pin and wrote into the worktree DB. Nothing in this session confirms which; the repro in AC1 R3 is the confirmation step and the fix premise must not be written before it.

**Already resolved in the same session:** the harness-side cause (the delegate's exit code) is **not** this project's surface — it belongs to the `sp` plugin and is recorded as a session-review note. The 0235/0236 code itself is verified and merged; this task owns only the residue in this repository.

### Requirements

- [ ] R1. **Repair the three dangling citations** in tasks 0235 and 0236 so every `.spur/...` path they cite resolves in this tree — or is rewritten to name the durable artifact that replaced it (`.spur/run/worktree-9c39-verdicts/<wbs>-verdict.json`, `.spur/memory/evidence/<wbs>-verdict.json`, `.spur/run/worktree-9c39-batch-report.md`). Lost evidence is marked as lost in place; it is never reconstructed from memory and no replacement file is fabricated. Entries are written through the CLI-gated section surface (`spur task update <wbs> --section <s> --from-file`), not by hand.
- [ ] R2. **This class cannot land silently again.** A repo-level check fails when a task at `done`/`testing` cites a `.spur/run/...` or `.spur/memory/...` path that does not exist in the tree. Deliver it as a constraint rule (`spur rule add`, preset-scoped) or extend `no-scratch-verdict-pointer`'s family, and prove it with a negative control: the rule fires on the pre-repair 0235/0236 citations and passes after R1.
- [ ] R3. **The `kk-itc-dryrun-1791591898421` anomaly is explained or fixed.** Record a reproducible check that distinguishes "the worktree DB starts empty" from "the worktree DB inherits rows": cut a fresh worktree, compare `.spur/memory/runs/` against the DB's run rows, and record which rows predate the tree. If a seeding path exists, fix it and pin it with a test; if the row is a legitimate cross-tree artefact, record why in the task's `## Testing`.
- [ ] R4. **The R3-deferred artifact stays visibly owed.** `xhs-podcast-postfile.json` is cited as the operator-attended measurement still to be produced; the citation must read as owed, not as a missing file. No live/attended run is performed by this task.

### Acceptance Criteria

- [ ] AC1 — A worktree batch's evidence survives tree removal and no task cites a dead path
  - Evidence (R1): `for w in 0235 0236; do grep -oE '\.spur/(run|memory)/[A-Za-z0-9._/-]+' docs/tasks/${w}_*.md | sort -u | while read -r p; do [ -e "$p" ] || echo "MISS $p"; done; done` reports **no** `MISS` line for a path that is not explicitly marked owed; and the durable replacements exist (`ls .spur/memory/evidence/0235-verdict.json .spur/memory/evidence/0236-verdict.json`).
  - Evidence (R2, negative control): the new/extended rule exits non-zero on the pre-repair citation set and `spur rule run --preset recommended-pre-check --fail-on warning` is clean afterwards; the rule's own smoke case is recorded in its `--json` output.
  - Evidence (R3): the recorded repro output (fresh worktree vs DB rows) is in `## Testing`, with either the fix + its regression test, or the explanation of why the row was present.
  - Evidence (R4): `grep -n 'xhs-podcast-postfile' docs/tasks/0236_*.md` shows the citation reads as owed (operator-attended, deferred), and `test ! -e .spur/run/discovery/xhs-podcast-postfile.json` still holds.

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
2. **A rule for the class (R2).** The shipped `no-scratch-verdict-pointer` rule already forbids one *shape* of scratch pointer (a `done_reason` line naming `.spur/run/<wbs>-verdict.json`). This finding is the same failure family one step wider: **any** citation to a `.spur/run/...` path that does not exist. Author it as a constraint rule with a negative-control smoke case rather than a bespoke script, so it runs at the same gate the other rules do.

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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-10T02:29:28.143Z backlog → todo (system)

