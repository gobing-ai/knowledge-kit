---
schema_version: 1
name: Split publish-classify --fold-tail into classify, mark-published and report nodes
status: todo
template: feature-impl
created_at: 2026-10-22T18:41:33.110Z
updated_at: "2026-10-22T19:09:50.983Z"
feature_id: G15

dependencies: ["0321"]
priority: P2
estimate_hours: 4
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

- [ ] R1. `kk stage run publish-matrix-classify <workDir> --window <w> --run-date <stamp>` reads `4-publish/plan.<w>.json` plus the receipts and writes `4-publish/outcome.<w>.json` (`{status, rows:[{id, tier, required, status, effect, dummy}]}`) and `4-publish/publish-status.<w>.txt`. It always exits 0; routing belongs to the workflow.
- [ ] R2. Status is computed over **non-dummy** rows only:
  - `full` when every row succeeded;
  - `partial` when at least one succeeded;
  - `none` when there are rows but none succeeded;
  - `dummy` when the window has no non-dummy rows.
  - Dummy receipts never count as published.
- [ ] R3. For the `after-generate` window, a legacy bridge copies the tier-0 surfdash and podcast receipts' `aggregatePath` content to `31-publish/<date>_14_publish-surfdash_result.json` / `_16_publish-podcast_result.json`, only when non-dummy. The existing stages then work unchanged on a voice3 work dir: `daily-patch-surfdash`, `daily-publish-partial`, `run-report`, and the board's `manifest.ts`. The bridge also writes `publish-classify.summary.txt` (`{status, published, targets}`) for `kk ledger` (`apps/cli/src/ledger.ts:369`).
- [ ] R4. voice2 behaviour unchanged: `kk daily publish-classify [--fold-tail]` and its tests (`apps/cli/tests/commands/daily.test.ts`, `voice2-dag.test.ts`) are not edited.
- Out of scope: retiring `--fold-tail` (after voice2 retirement); mark-published logic (reused as is, gated by the workflow in 0323).

### Acceptance Criteria

- [ ] AC1 — Dummy mode exercises the full publish path without spawning plugins (req: R2)
- [ ] AC2 — Receipt-based classification feeds the existing tail stages unchanged (req: R1, R3, R4)

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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-22T18:59:28.584Z feature_id Q → G15 (system)
- 2026-10-22T19:09:50.983Z backlog → todo (system)

