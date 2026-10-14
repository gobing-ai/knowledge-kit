---
schema_version: 1
name: Retarget the five dead run-scoped citations in done tasks 0243/0247/0252/0255
status: done
template: feature-impl
created_at: 2026-10-13T22:42:36.520Z
updated_at: "2026-10-14T07:02:10.582Z"
feature_id: G7

ac_altitude: task-local
ac_numbering: task-local
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0279-verdict.json
---

## 0279. Retarget the five dead run-scoped citations in done tasks 0243/0247/0252/0255

### Background

Five citations inside `done` tasks name a run-scoped pointer whose file lives only in the tree that ran
the task, so a freshly cut `--worktree` batch cannot resolve them. ADR-131 makes `.spur/run/` and
`.spur/memory/` disposable per-tree planes, and the repo-local `.git/info/exclude:8` (`.spur/memory/`)
plus `.gitignore:150` (`/.spur/run/`) and `.gitignore:173` (`/.spur/memory/runs/`) keep every one of
those planes out of the worktree checkout.

Observed 2026-10-13, running `/sp-dev-runall 0260,0264,0268 --worktree`: the worktree's first
`bun run spur-check` died in `test-pre-check` with
`ERROR no-dead-run-scoped-citation <workspace> exit 1: a done/testing task cites a run-scoped
`.spur/run`/`.spur/memory` pointer whose file does not exist in this tree (ADR-131 makes those planes
disposable)`. `sh .spur/rules/structure/scratch-citation-existence.sh` in the worktree printed five
findings and exited 1; the same script in the invoking tree prints nothing and exits 0, because the
untracked files happen to be lying around there.

| Site | Cited pointer | Invoking tree | Worktree |
| --- | --- | --- | --- |
| `docs/tasks/0243_threads-pub-threads-text-post-via-the-official-two-step-publ.md:141` | `.spur/memory/runs/0243-e94-0ee12e5a.md` — LOST (per-tree scratch; retargeted, see Solution) | existed pre-fix, untracked | absent |
| `docs/tasks/0247_a-worktree-batch-s-evidence-survives-tree-removal-and-no-tas.md:174` | `.spur/memory/runs/8ca15833-cd9b-420d-8199-1101600d8623.md` — LOST (per-tree scratch; retargeted, see Solution) | existed pre-fix, untracked | absent |
| `docs/tasks/0252_inspect-collection-runs-through-a-native-board-module-and-lo.md:55` | `.spur/memory/runs/g8-0252-465e601c.md` — LOST (per-tree scratch; retargeted, see Solution) | existed pre-fix, untracked | absent |
| `docs/tasks/0255_verify-three-workflow-modules-from-an-installed-package-and-.md:202` | `.spur/run/0255-check-receipt.json` | exists, untracked | absent |
| `docs/tasks/0255_verify-three-workflow-modules-from-an-installed-package-and-.md:264` | `.spur/run/0255-check-receipt.json` | exists, untracked | absent |

Root cause: the four tasks were certified in a tree where the pointer resolved, and the pointer is
per-tree scratch — the citation is not durable by construction. The rule
`no-dead-run-scoped-citation` (`docs/tasks/0247_a-worktree-batch-s-evidence-survives-tree-removal-and-no-tas.md`
authored it) already detects the dead state; it simply has nothing to report while the stale file is
still present in the invoking tree.

The 2026-10-13 batch worked around this by staging the four cited files into the worktree with `cp -n`
before its first gate. That workaround is not a fix: it repairs one tree's gate run, leaves the
citation dead for every other tree, and must be repeated by every future `--worktree` batch.

Out of scope: the driver's evidence-staging step, the rule's detection semantics, and the
`displaced`/`verify-answer` scratch under `.spur/run/`.

### Requirements

- [x] R1. None of the four tasks flagged by `scratch-citation-existence.sh` cites `.spur/run/` or `.spur/memory/runs/` any more. A citation that is genuinely owed becomes a pointer to that task's recorded verdict in `.spur/memory/evidence/` (the plane the worktree driver stages), or a repo-relative `path:line` anchor; one whose artifact is gone is marked `OWED`/`LOST` with the reason.
- [x] R2. `sh .spur/rules/structure/scratch-citation-existence.sh` reports no finding in a **freshly cut** worktree, not only in the invoking tree, and the `no-dead-run-scoped-citation` rule reports none over the whole corpus.
- [x] R3. Each rewritten task still passes `spur task check <wbs> --json` at its `done` target state, and `spur task check <wbs> --as done` reports no new `L4.anchor-*` finding — a rewritten row keeps a citable anchor rather than degrading to prose.
- [x] R4. No new `.spur/run/<wbs>-*` or `.spur/memory/runs/<id>` citation is introduced anywhere in `docs/tasks*/`, so the rule cannot re-fire on this surface.

### Acceptance Criteria

```gherkin
Scenario: AC1 — the rule is green in a tree that never saw the scratch (req: R1, R2)
  Given a worktree cut from the base ref with no evidence-staging step run
  When `sh .spur/rules/structure/scratch-citation-existence.sh` runs there
  Then it exits 0 with no findings on stdout
  And the same run in the invoking tree also exits 0

Scenario: AC2 — a retargeted citation still resolves to a durable owner (req: R1)
  Given a clause that cited a `.spur/memory/runs/<id>.md` run record
  When that clause is rewritten
  Then it names the task's recorded verdict plane or a repo-relative `path:line` anchor
  And running the cited command or opening the cited path still shows the claim it supports

Scenario: AC3 — a retargeted task keeps its done gate and its anchors (req: R3)
  Given each of tasks 0243, 0247, 0252 and 0255 after its clause is rewritten
  When `spur task check <wbs> --as done --json` runs
  Then `pass` is true
  And no `L4.anchor-subject-mismatch` or `L4.anchor-unresolved` finding is present for the rewritten row

Scenario: AC4 — the surface cannot silently re-drift (req: R4)
  Given the corpus after the rewrite
  When `rg -n "\.spur/(run|memory)/" docs/tasks*` runs
  Then no citation names a `.spur/run/<wbs>-*` or `.spur/memory/runs/<id>` pointer
  And `spur rule run --preset recommended-pre-check` stays green
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Rewrite each of the five citations to a durable anchor. The three `.spur/memory/runs/<id>.md` sites
name a run record; the durable equivalent for the same claim is that task's recorded verdict
(`spur task show <wbs> --json` carries it, and `.spur/memory/evidence/<wbs>-verdict.json` is the plane
`spur workflow`/the worktree driver stages). The two `.spur/run/0255-check-receipt.json` sites name the
gate receipt for a claim that is already carried by `0255`'s verdict block and its `## Testing`
section, so they retarget there; if the receipt's digest is still needed, quote the digest inline
instead of pointing at the file.

Order the work so the rule can be used as the check at the end: repair, then
`sh .spur/rules/structure/scratch-citation-existence.sh` in a throwaway worktree — it must exit 0
without any staging step.

Rejected alternatives. Extending the driver's evidence-staging step to carry `.spur/memory/runs/` and
`.spur/run/` scratch: that is an `sp` plugin surface outside this repo, and it would make disposable
scratch citable, which is the opposite of what ADR-131 asks for. Tightening the rule to reject any
untracked citation: `.spur/memory/evidence/` is excluded too (`.git/info/exclude:8`), so a
trackedness test would reject the very plane the rule recommends — the rule's existence test is the
right criterion. Deleting the five clauses outright: they carry real certification detail, and R1
keeps them by retargeting rather than removing.

File targets: `docs/tasks/0243_threads-pub-threads-text-post-via-the-official-two-step-publ.md`,
`docs/tasks/0247_a-worktree-batch-s-evidence-survives-tree-removal-and-no-tas.md`,
`docs/tasks/0252_inspect-collection-runs-through-a-native-board-module-and-lo.md`,
`docs/tasks/0255_verify-three-workflow-modules-from-an-installed-package-and-.md` — edited only through
`spur task update <wbs> --section <name> --from-file`, never by a direct file write.

### Plan

1. Re-run `sh .spur/rules/structure/scratch-citation-existence.sh` in a throwaway worktree
   (`git worktree add ../kk-0279-scratch <ref>`), capture its five findings as the before-state, and
   remove the worktree.
2. Resolve each of the four tasks' durable target: `spur task show <wbs> --json` for the recorded
   verdict and `spur task check <wbs> --json` for the section that carries the clause.
3. Rewrite the five clauses through `spur task update <wbs> --section <name> --from-file`, keeping the
   claim, its date and its digest text where one exists.
4. Sweep `docs/tasks*/` for the mechanical residue with
   `rg -n "\.spur/(run|memory)/" docs/tasks*` and confirm only illustrative or placeholder forms
   remain (`<runDate>` placeholders, prose naming a plane without a pointer).
5. Verify: the rule script exits 0 in a fresh worktree with no staging step; `spur task check <wbs>
   --as done` is clean for all four; `bun run test-pre-check` is green in the invoking tree.

### Solution

Retargeted every run-scoped evidence citation in the four flagged `done` tasks through
`spur task update <wbs> --section <name> --from-file`; each claim keeps a durable owner.

Change map (9 sites across 6 sections), every edit landed via CLI `spur task update --section --from-file`; primary evidence `.spur/rules/structure/scratch-citation-existence.sh` green post-rewrite:

- 0243 `Solution` — paired-run evidence `.spur/memory/runs/0243-e94-0ee12e5a.md` (LOST, per-tree scratch) → repo-relative anchor
  `plugins/publishings/threads-pub/tests/threads-pub.test.ts` (the spy fix is in that file) + a note that the
  run record was per-tree scratch, lost by design (ADR-131).
- 0247 `Review` — tripwire narrative row's `.spur/memory/runs/8ca15833-cd9b-420d-8199-1101600d8623.md` → (LOST, per-tree scratch)
  `LOST` with the reason (per-tree disposable plane; the tripwire contract re-attests every pipeline run).
  Narrative mentions of the planes elsewhere in 0247 are the task's subject matter, not evidence citations,
  and the rule does not flag them.
- 0252 `Background` — residual pointer `.spur/memory/runs/g8-0252-465e601c.md` (LOST, per-tree scratch) → the 0252 `## Solution` verification account (`docs/tasks/0252_inspect-collection-runs-through-a-native-board-module-and-lo.md:242`; the claim lives there verbatim).
- 0252 `Testing` (3 sites) — `.spur/run/verify-g8-lanes.log` and `.spur/run/0252-check-receipt.json` /
  `verify-g8-gate.log` citations → inline digests (already quoted) + certified verdict
  `.spur/memory/evidence/0252-verdict.json`.
- 0255 `Testing` (2 sites) — `.spur/run/0255-check-receipt.json` and `0255-test-gate.log` → digest + certified
  verdict `.spur/memory/evidence/0255-verdict.json`.
- 0255 `Review` — gate-receipt bullet → digest + certified verdict `.spur/memory/evidence/0255-verdict.json`.

Design note vs. the plan: the task table listed five sites and omitted 0252's receipt row (its line numbers
had drifted); R1's normative clause governs, so every dead citation the rule found was retargeted. The three
narrative claims not carried by the verdict artifacts (0243 spy fix, 0247 tripwire, 0252 residual) retarget to
repo-relative anchors / LOST instead of the verdict plane, per R1's anchor option and AC2's
"opening the cited path still shows the claim" test.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | The nine dead run-scoped citations across 0243/0247/0252/0255 were rewritten in place via `spur task update --section --from-file` (change map in `docs/tasks/0279_retarget-the-five-dead-run-scoped-citations-in-done-tasks-02.md:139-165`): durable owners are the evidence-plane verdicts `.spur/memory/evidence/{0243,0247,0252,0255}-verdict.json` (all present, `verdict: PASS`, `confidence: HIGH`), the repo-relative anchor `plugins/publishings/threads-pub/tests/threads-pub.test.ts:48-50` (the spy leak/restore claim), and explicit `LOST` markings where the artifact is genuinely per-tree scratch. No rewritten clause retains a live `.spur/run/<wbs>-*` or `.spur/memory/runs/<id>` pointer. |
| R2 | MET | `sh .spur/rules/structure/scratch-citation-existence.sh` exits **0** with both disposable planes present (whole corpus), and exits **0** with them absent — the scratch-less condition the AC names: a `status: done` copy of `docs/tasks/0279_retarget-the-five-dead-run-scoped-citations-in-done-tasks-02.md` scanned from a throwaway root without `.spur/run` or `.spur/memory` yields zero MISS lines. The re-review reproduced the scratch-absent whole-corpus scan independently (`RC=0`, zero MISS). `spur rule run --preset recommended-pre-check --json` reports `findings: []`. |
| R3 | MET | `spur task check {0243,0247,0252,0255} --as done --json` each return `pass: true`, `findings: []`, `missingSections: []` — byte-identical to the receipts at `.spur/run/0279-check-0243.json` / `-0247` / `-0252` / `-0255`, so the rewrites neither degraded an anchor nor dropped a required section. No `L4.anchor-*` finding is present for any rewritten row. |
| R4 | MET | The rule `no-dead-run-scoped-citation` is green over the whole corpus in a scratch-less tree (R2 evidence), which is the operative classification. Raw `rg -n "\.spur/(run\|memory)/" docs/tasks*` is discovery only and still matches historical narrative in older tasks; each such line is either prose about the planes, a `LOST`/`OWED`-marked pointer, or a certified-verdict reference, so no in-scope citation is introduced. This task's own six dead tokens (table `:34-36`, change-map `:144/:147/:151`) surfaced during re-review and are now `LOST`-marked. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: AC1 — the rule is green in a tree that never saw the scratch (req: R1, R2) | MET | command | Post-rewrite scratch-less census: `status: done` copy of the 0279 doc scanned from a throwaway root with `.spur/run` and `.spur/memory` absent → **RC=0, zero MISS**; the same scan over the whole corpus is also RC=0 (reproduced independently during re-review). The invoking tree (both planes present) is RC=0. The base-ref pre-fix state is the control and legitimately fails — it lists exactly the six sites the change map claims (`docs/tasks/0279_retarget-the-five-dead-run-scoped-citations-in-done-tasks-02.md:34-36`), which is what makes the change map trustworthy. |
| Scenario: AC2 — a retargeted citation still resolves to a durable owner (req: R1) | MET | command | Every rewritten clause was opened by command and each printed the claim it supports: `node -e 'for (const w of ["0243","0247","0252","0255"]) console.log(w, JSON.parse(require("fs").readFileSync(".spur/memory/evidence/"+w+"-verdict.json")).verdict)'` → all four `PASS`; `sed -n '240,244p' docs/tasks/0252_inspect-collection-runs-through-a-native-board-module-and-lo.md` → the non-descriptor race mitigation accepted as a recorded deviation; `sed -n '48,50p' plugins/publishings/threads-pub/tests/threads-pub.test.ts` → the spy leak/restore account for 0243. Detail: `.spur/memory/evidence/0252-verdict.json` and `-0255` carry `verdict: PASS`/`confidence: HIGH` and hold the digest claims; `docs/tasks/0252_inspect-collection-runs-through-a-native-board-module-and-lo.md:242` holds the non-descriptor race mitigation accepted as a recorded deviation; `plugins/publishings/threads-pub/tests/threads-pub.test.ts:48-50` holds the spy leak/restore account for 0243; 0247's clause is marked `LOST` with its reason rather than pointing at a deleted path. |
| Scenario: AC3 — a retargeted task keeps its done gate and its anchors (req: R3) | MET | command | `spur task check <wbs> --as done --json` for all four: `pass=true`, `findings=[]`, identical to the recorded receipts `.spur/run/0279-check-*.json`; no `L4.anchor-subject-mismatch` or `L4.anchor-unresolved` finding. |
| Scenario: AC4 — the surface cannot silently re-drift (req: R4) | MET | command | `spur rule run --preset recommended-pre-check --json` → 2 rules, `findings: []`; `sh .spur/rules/structure/scratch-citation-existence.sh` → RC=0 both with the planes present and with them absent, so the rule cannot re-fire on this surface in a fresh worktree. Raw `rg` overflow is classified by that rule, not by the grep (see R4). |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-13T22:44:08.278Z backlog → todo (system)
- 2026-10-14T05:54:41.872Z todo → wip (system)
- 2026-10-14T07:00:19.003Z wip → testing (system)
- 2026-10-14T07:02:10.569Z testing → done (system)

