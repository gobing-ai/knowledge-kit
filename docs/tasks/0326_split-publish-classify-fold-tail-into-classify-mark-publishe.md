---
schema_version: 1
name: Split publish-classify --fold-tail into classify, mark-published and report nodes
status: done
template: feature-impl
created_at: 2026-10-22T18:41:33.110Z
updated_at: "2026-10-25T04:35:38.661Z"
feature_id: G15

dependencies: ["0321"]
priority: P2
estimate_hours: 4
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0326-verdict.json
---

## 0326. Split publish-classify --fold-tail into classify, mark-published and report nodes

### Background

publish3 needs its publish outcome (`full|partial|none`) computed from the 0321 receipts, not from voice2's two hard-coded result files.

**Refine corrections (2026-10-22)**

- The original premise was wrong. `publish-classify --fold-tail` (`apps/cli/src/commands/daily.ts:292-345`) does **not** include mark-published or the run report; those are already separate voice2 nodes (`kk-daily-ai-voice2.yaml:886` mark-published, `run-report`, `ledger`).
- What `--fold-tail` folds is three things: `daily-publish-partial` (marker), `daily-patch-surfdash` (cover and podcast cross-link patch, CMS re-sync), and `daily-publish-completeness`.
- The real coupling is the input: the classifier reads only `31-publish/<date>_14_publish-surfdash_result.json` and `_16_publish-podcast_result.json` (`daily.ts:311-312`). Those two names are also read by `kk-workflow-stages.ts`, `daily-stages.ts` and `board/manifest.ts`.
- The task is therefore re-scoped to a receipt-based classifier plus a legacy-path bridge. voice2 and `--fold-tail` stay untouched.

### Requirements

- [x] R1. `kk stage run publish-matrix-classify <workDir> --window <w> --run-date <stamp>` reads `4-publish/plan.<w>.json` plus the receipts and writes `4-publish/outcome.<w>.json` (`{status, rows:[{id, tier, required, status, effect, dummy}]}`) and `4-publish/publish-status.<w>.txt`. It always exits 0; routing belongs to the workflow.
- [x] R2. Status is computed over **non-dummy** rows only:
  - `full` when every row succeeded;
  - `partial` when at least one succeeded;
  - `none` when there are rows but none succeeded;
  - `dummy` when the window has no non-dummy rows.
  - Dummy receipts never count as published.
- [x] R3. For the `after-generate` window, a legacy bridge copies the tier-0 surfdash and podcast receipts' `aggregatePath` content to `31-publish/<date>_14_publish-surfdash_result.json` / `_16_publish-podcast_result.json`, only when non-dummy. The existing stages then work unchanged on a voice3 work dir: `daily-patch-surfdash`, `daily-publish-partial`, `run-report`, and the board's `manifest.ts`. The bridge also writes `publish-classify.summary.txt` (`{status, published, targets}`) for `kk ledger` (`apps/cli/src/ledger.ts:369`).
- [x] R4. voice2 behaviour unchanged: `kk daily publish-classify [--fold-tail]` and its tests (`apps/cli/tests/commands/daily.test.ts`, `voice2-dag.test.ts`) are not edited.
- Out of scope: retiring `--fold-tail` (after voice2 retirement); mark-published logic (reused as is, gated by the workflow in 0323).

### Acceptance Criteria

- [x] AC1 — Dummy mode exercises the full publish path without spawning plugins (req: R2)
- [x] AC2 — Receipt-based classification feeds the existing tail stages unchanged (req: R1, R3, R4)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-22T19:09:02.683Z

- **Q: Split `--fold-tail` itself?** Closed: no, because voice2 must stay untouched and the publish3 classifier is new. The fold is removed when voice2 retires.
- **Q: Rewrite run-report/board for receipts?** Closed: not now. The bridge keeps them working; rewrite only when the console task needs receipt-native views.

### Design

- `classifyPublishMatrix` lives in `apps/cli/src/publish-matrix.ts` (0321 module) and is pure over `(plan, receipts)`, so it is unit-checkable without fs.
- The bridge is a tiny writer with a `// ponytail: legacy 31-publish names kept so voice2-era stages run on voice3 dirs; drop when voice2 retires` comment.
- Workflow use (0323):
  - `classify` node, then `surfdash-patch` (condition: status ∈ full|partial and the surfdash receipt is non-dummy) → `kk stage run daily-patch-surfdash`;
  - `partial-marker` (status = partial) → `kk stage run daily-publish-partial`;
  - `mark-published` (after-generate status ∈ full|partial) → `kk store mark-published --topic ai-news --run <voice3 runId from bundle>`.
- Anti-patterns:
  - no edits to `publishClassifyAction`;
  - no second classifier for voice2;
  - no counting dummy rows as published.

### Plan

1. Failure list: an all-dummy window reporting `full`, a missing receipt for a planned row (counts as not succeeded), a bridge writing a dummy aggregate, and a classifier exiting non-zero on `none`. (R1–R3)
2. Implement `classifyPublishMatrix` and the stage wiring. (R1, R2)
3. Implement the bridge and summary file. (R3)
4. Extend `publish-matrix.test.ts`:
   - the four status cases;
   - the bridge files present and absent;
   - run `daily-publish-partial` against a bridged fixture dir to prove the reuse.
   (R1–R3)
5. Run `bun run lint && bun run test`, and confirm the voice2 suites are untouched (`git diff --stat apps/cli/tests/commands/daily.test.ts apps/cli/tests/voice2-dag.test.ts` is empty). (R4)

### Solution

| Change | What / why |
| --- | --- |
| `apps/cli/src/publish-matrix.ts:90` | `PublishOutcomeRowSchema` / `PublishOutcomeSchema`: the outcome contract R1 names (`{status, published, targets, rows:[{id, tier, required, status, effect?, dummy}]}`). |
| `apps/cli/src/publish-matrix.ts:119` | `classifyPublishMatrix(plan, receipts, runDate)` — pure over its inputs, so the four statuses are checkable without a filesystem. Status is computed over the **non-dummy** rows only and a planned row without a receipt is `missing`, counting as not succeeded (R2). |
| `apps/cli/src/publish-matrix.ts:562` | `runPublishMatrixClassify` — the `publish-matrix-classify` stage: reads the plan plus the receipts, writes `outcome.<window>.json`, `publish-status.<window>.txt` and the ledger's `publish-classify.summary.txt`. Always exits 0 once the plan is readable; a missing plan reports `none` (R1). |
| `apps/cli/src/publish-matrix.ts:600` | Legacy bridge for `after-generate`: the tier-0 surfdash/podcast receipt's `aggregatePath` bytes are copied to `31-publish/<runDate>_14_publish-surfdash_result.json` / `_16_publish-podcast_result.json`, only for a non-dummy row with a written aggregate (R3). Marked as the documented legacy seam that dies with voice2. |
| `apps/cli/src/publish-matrix-stage.ts:26` | Stage dispatch for `publish-matrix-classify` beside plan/check/send. |
| `apps/cli/tests/publish-matrix.test.ts:605` | The four statuses plus the missing-receipt and all-dummy edge cases, driven through the pure classifier. |
| `apps/cli/tests/publish-matrix.test.ts:645` | End-to-end: plan → send → classify writes the outcome, status file and summary, bridges both legacy names, and then **voice2's own** `kk daily publish-classify` runs unchanged on that work dir and exits 0. |
| `apps/cli/tests/publish-matrix.test.ts:707` | An all-dummy window classifies `dummy` and bridges nothing; a `cn-peak` window never writes legacy files. |
| `apps/cli/tests/publish-matrix.test.ts:763` | A window with no plan reports `none` and exits 0. |
| `docs/04_DESIGN.md:2053` | The classify surface, its status table, the bridge and its retirement condition (T3). |

**Verification:** `bun run lint` clean; `bun test apps/cli/tests/publish-matrix.test.ts apps/cli/tests/publish-matrix-stage.test.ts apps/cli/tests/itc-publish.test.ts` → 69 pass, 0 fail. R4: `git diff --stat apps/cli/src/commands/daily.ts apps/cli/tests/commands/daily.test.ts apps/cli/tests/voice2-dag.test.ts` is empty.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `apps/cli/src/publish-matrix.ts:566` runPublishMatrixClassify, outcome schema `apps/cli/src/publish-matrix.ts:84-96`; `apps/cli/tests/publish-matrix.test.ts:860`, `apps/cli/tests/publish-matrix.test.ts:978` |
| R2 | MET | `apps/cli/src/publish-matrix.ts:120` classifyPublishMatrix over non-dummy rows; `apps/cli/tests/publish-matrix.test.ts:820`, `apps/cli/tests/publish-matrix.test.ts:842`, `apps/cli/tests/publish-matrix.test.ts:922` |
| R3 | MET | `apps/cli/src/publish-matrix.ts:166` LEGACY_RESULT_FILES, bridge `apps/cli/src/publish-matrix.ts:636-641`, summary `apps/cli/src/publish-matrix.ts:603`; `apps/cli/tests/publish-matrix.test.ts:860` |
| R4 | MET | `git log bf1c45a^..HEAD -- apps/cli/src/commands/daily.ts apps/cli/tests/voice2-dag.test.ts` → empty this run; voice2 suites 200 pass / 0 fail |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Dummy mode exercises the full publish path without spawning plugins (req: R2) | MET | test | `apps/cli/tests/publish-matrix.test.ts:820`, `apps/cli/tests/publish-matrix.test.ts:922` |
| AC2 — Receipt-based classification feeds the existing tail stages unchanged (req: R1, R3, R4) | MET | test | `apps/cli/tests/publish-matrix.test.ts:860` |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Confidence: HIGH
Verdict: PASS

**Scope:** `classifyPublishMatrix` + the `publish-matrix-classify` stage and its legacy bridge (`apps/cli/src/publish-matrix.ts`), the stage dispatch entry, five new tests, and the `docs/04_DESIGN.md` surface note. voice2's `kk daily publish-classify` is untouched by contract (R4).

| Priority | Finding | Disposition |
| --- | --- | --- |
| P3 | The bridge copied `aggregatePath` verbatim; on a receipt whose aggregate was written for a different target the legacy file would carry foreign rows. | Fixed — only a non-dummy receipt with `status: succeeded` and a readable aggregate is bridged (`apps/cli/src/publish-matrix.ts:600`). |
| P4 | `publish-classify.summary.txt` is shared with voice2's classifier, so a voice3 run and a voice2 run over the same work dir overwrite each other's ledger row. | Accepted — the two pipelines never share a work dir; when voice2 retires the summary becomes single-writer. Noted in the design entry. |

**SECUA / architecture**

- **Security** — the bridge copies bytes between two paths it computes from `runDate` and plan rows; no shell, no caller-supplied path.
- **Efficiency** — one plan read, one receipt read per planned row, no directory scan.
- **Correctness** — the classifier is pure, so all four statuses plus `missing` are unit-proven without fs; dummy receipts are excluded from both the numerator and the denominator, which is the difference between a rehearsal and a publish. A missing plan is `none`, never `full` — the same failure masking the voice2 rule exists to prevent (`apps/cli/src/commands/daily.ts:311`).
- **Usability** — the stage prints the status token and exits 0, matching voice2's contract so the workflow routes on the file, not on an exit code.
- **Architecture** — no edit to `publishClassifyAction`, no second classifier; the bridge is a named legacy seam with a retirement condition (`// ponytail:` comment + design entry), so its removal is scheduled rather than forgotten.

**Residual risk**

- The bridge inherits voice2's file-name contract; if a channel is added to tier 0 the legacy `31-publish` names cover only surfdash and podcast, which is exactly voice2's set.
- `publish-status.<window>.txt` is per-window while voice2's is global; the workflow (0323) reads the window it launched, so the difference is contained.
- Mark-published and the run report stay voice2 stages on a bridged dir; 0323 gates them.

**Verification:** `bun run lint` clean; `bun test` matrix + stage + itc suites → 69 pass, 0 fail; `spur task gate 0326` PASS; `git diff --stat apps/cli/src/commands/daily.ts apps/cli/tests/commands/daily.test.ts apps/cli/tests/voice2-dag.test.ts` empty (R4).

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-22T18:59:28.584Z feature_id Q → G15 (system)
- 2026-10-22T19:09:50.983Z backlog → todo (system)
- 2026-10-22T22:05:36.546Z todo → wip (system)
- 2026-10-22T22:27:34.563Z wip → testing (system)
- 2026-10-22T22:27:36.378Z testing → done (system)

