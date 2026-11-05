---
schema_version: 1
name: Make publish3 outcomes, retries and store settlement receipt-aware
status: done
template: feature-impl
created_at: 2026-10-26T00:11:53.724Z
updated_at: "2026-11-05T08:24:19.992Z"
feature_id: G15
priority: P1
tags:
  - voice3-migration
  - migration-audit-20261025
estimate_hours: 8

dependencies: ["0332"]
ac_numbering: task-local
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0333-verdict.json
---

## 0333. Make publish3 outcomes, retries and store settlement receipt-aware

### Background

Operator request: file every migration finding as implementation-ready work for later delegation; do not implement or activate production in this filing. Source audit: .spur/reports/voice3-migration-review-2026-10-25.md. G15 is reopened for corrective work; original completed tasks remain history. Accepted decisions D1-D4 in docs/design/kk-daily-ai-voice3.md remain authoritative: split generation/publication, preset ownership, Chinese-only output, three windows. No new channels, locale pipeline, dependencies or toolchains. No changes to voice2 production scheduling, live credentials, installed packages, .env files or .github/workflows. Preparation of launchers/runbooks is in scope; installing schedules, publishing or changing production configuration needs separate explicit authorization.

Owned audit findings: F07, F14, F18, F20. Priority reflects the highest owned severity; estimate 8 engineer-hours includes failure-first tests, docs and final checks.

- apps/cli/src/publish-matrix.ts:637 skips dummy aggregate bridges, while plugins/kk/scripts/kk-workflow-stages.ts:1416 requires both owned aggregates for patching.
- plugins/kk/workflows/kk-daily-publish3.yaml:176 marks store selections published for any full/partial status, not the required real owned delivery contract.
- apps/cli/src/publish-matrix.ts:881 returns zero despite failed required owned rows; workflow has no ordinary bounded retry.
- plugins/kk/scripts/kk-workflow-stages.ts:1373 reads _17_publish_result.json and suggests legacy retry, but publish3 bridges only _14/_16.

Environment/concurrency: Bun 1.4.3; pinned Biome via bun run lint/format; installed Spur observed at 0.4.20 (run latest bare CLI, do not pin). Existing uncommitted apps/cli/src/publish-matrix.ts and apps/cli/tests/publish-matrix.test.ts changes belong to concurrent work: inspect and preserve them, never revert. Only the main worktree and no wip tasks were observed during filing; recheck at implementation start. Multiple tasks touch workflow/stage/matrix files: obey dependencies and use isolated worktrees for concurrent execution. Production stage sources currently match checkout, but bundled CLI parity is unverified; tests must bind the checkout CLI and scripts through a local shim, never the installed live runner.

**Refine corrections (2026-10-25)**
- Findings were checked against the current tree, including concurrent matrix edits; none of this task's owned defects is already fixed. Preserve existing fixes rather than reopening them.
- Completed G15 work is historical, not proof of migration readiness. This task is new corrective implementation, not a completed verification.
- Operational constraints C01-C05 mean: explicit real/dummy/off inventory; manual live confirmation; opt-in auto_publish and prepared launchers; accepted zh-only locale parity; deterministic fixtures for wait/RSS. They are assigned as implementation/runbook work without authorizing production activation.

### Requirements

- [x] R1. Run exactly one ordinary automatic retry of failed effect-none rows after first send, preserving uncertain-live no-resend rules; required tier-0 failure blocks later tiers and makes the final workflow outcome fail after reporting.
- [x] R2. Always write per-window measured receipt report and ledger evidence for full, partial, none, dummy and incident paths. Optional failure is visible partial; no successful required delivery cannot finish as a successful publication.
- [x] R3. Invoke cross-link/cover/CMS patching only when real eligible Surfdash evidence exists, handling dummy/missing podcast without fabricating aggregates or failing an otherwise valid mixed rehearsal. Resolve the site root from real result/config instead of an unrelated shell variable.
- [x] R4. Mark store items published only when every required owned row has current-bundle live confirmed evidence; drafts, dummy success and optional-only success never satisfy that contract. Hold unresolved real selections visibly for reconciliation, and preserve existing explicit release semantics.
- [x] R5. Generate partial markers and recovery instructions from outcome/receipts for the exact window; no _17 aggregate dependency or legacy --retry-from suggestion.
- [x] R6. Cover both real/dummy owned permutations, all dummy, owned failures, optional failures, safe retry, uncertain live, excluded targets, dry drafts and report/ledger behavior with fake transports and an isolated store.

### Acceptance Criteria

- [x] AC1 — Receipt outcomes drive safe retries settlement and mixed dummy tails (req: R1, R2, R3, R4, R5, R6)

Given the current checkout and the isolated fixture conditions in Design, when the listed success/failure/replay cases run through the actual owned seam, then every R-item is observed through receipts, store state, artifact bytes and process/run status. Verification owner: this task's implementer; final cross-task rehearsal belongs to the rehearsal task. Concrete cases: Surfdash real/podcast dummy and reverse; missing KK_SURFDASH_ROOT; real owned partial failure; optional-only success with owned dummy; drafted owned results; one effect-none retry succeeds; second failure recorded/nonzero; uncertain live never resent; reports survive failure; excluded rows visible; matrix marker names exact failed target.

### Q&A

Closed decisions (2026-10-25):
- Scope: implement the local correction described here; production publishing, scheduler installation and installed-package syncing remain separate operator actions.
- Compatibility: preserve voice2 and kk-itc behavior unless this task explicitly provides a voice3-only opt-in.
- Decisions D1-D4 remain accepted; Chinese-only parity is intentional and manual live confirmation is retained. Unsupported operations stay explicit dummy/off, never implicit live.
- Dependencies: 0332; handoff contracts and exact owned paths are in Design. No unresolved architecture or scope question remains for the implementer.
- Source audit findings owned here: F07, F14, F18, F20. Failure cases must precede production edits; evidence uses isolated local fixtures.

### Design

**Ownership:** apps/cli/src/publish-matrix.ts (classification/outcome and retry integration); plugins/kk/workflows/kk-daily-publish3.yaml; plugins/kk/scripts/kk-workflow-stages.ts (matrix-specific tail behavior); apps/cli/src/commands/store.ts only if existing settlement cannot express policy; receipt/window E2E tests; docs/04_DESIGN.md. Own only this behavior; do not revert others' edits.

Keep existing outcome status vocabulary full|partial|none|dummy and add only additive row disposition/reason fields if required; do not redefine a draft as a published item. Stage send/classify may remain zero-return collectors, but the DAG must have an explicit final outcome assertion after report/ledger so required failures exit nonzero without losing evidence. Add one retry node using the existing --retry semantics, scoped by receipts; no unbounded back-edge. Derive patch input from real receipt aggregatePath and metadata, and skip impossible links explicitly; do not create fake success files for dummy channels. Existing legacy daily stages keep voice2 behavior; add matrix-specific entry behavior through existing stage registry when its contract differs. Store settlement is keyed to bundle.parentRunId, not publication run id, and requires live/effect confirmed for all required owned targets; draft preparation retains selection without claiming live publication. No automatic release of uncertain real selections. Handoff: integration task proves end-to-end exit/status, settlement and recovery artifacts. Rejected: || true around all failures, treating any partial success as owned completion, or making legacy file presence the delivery authority.

**Dependencies:** 0332. Dependency edges are persisted in frontmatter.

**Inbound handoff:** 0332 — Window sends bind receipts and RSS proof to one bundle revision.

**Outbound handoff:** 0335 — Offline migration rehearsal proves the complete voice3 replacement contract.

**Execution scope:** This task specifies local implementation when delegated. The filing itself performed planning only. Shared-file tasks must respect these edges; independent initial tasks may run in separate worktrees.

**Batch order:** 0329 and 0330 may start independently; 0331 follows both; 0332 follows 0331; 0333 and 0334 follow 0332; 0335 follows both. Transitive prerequisites remain binding.

**Non-goals:** Operator request: file every migration finding as implementation-ready work for later delegation; do not implement or activate production in this filing. Source audit: .spur/reports/voice3-migration-review-2026-10-25.md. G15 is reopened for corrective work; original completed tasks remain history. Accepted decisions D1-D4 in docs/design/kk-daily-ai-voice3.md remain authoritative: split generation/publication, preset ownership, Chinese-only output, three windows. No new channels, locale pipeline, dependencies or toolchains. No changes to voice2 production scheduling, live credentials, installed packages, .env files or .github/workflows. Preparation of launchers/runbooks is in scope; installing schedules, publishing or changing production configuration needs separate explicit authorization.

**Failure-first matrix:** Surfdash real/podcast dummy and reverse; missing KK_SURFDASH_ROOT; real owned partial failure; optional-only success with owned dummy; drafted owned results; one effect-none retry succeeds; second failure recorded/nonzero; uncertain live never resent; reports survive failure; excluded rows visible; matrix marker names exact failed target.

Verification contract: enumerate failure cases and create behavior/E2E regression checks BEFORE changing production code; no post-hoc unit tests. Use bun:test, the real Spur DAG dispatcher, deterministic fixture generators/transports and intercepted HTTP; no provider/model calls, credentials, browser publication or live store access. Write observed evidence to .works/tmp/test-voice3-migration/0333/summary.json (and referenced logs/receipts), deriving the summary from assertions rather than hard-coded prose. Focused tests may exit 1 from per-file coverage; distinguish that from assertion failures. Final implementation gates: bun run lint, bun run test, bun run build, and project rule presets through bun run test-pre-check / bun run test-post-check; record actual exit codes. Update docs/04_DESIGN.md with changed surfaces in the same implementation change, following docs/99_PROJECT_CONSTITUTION.md and ADR-022/ADR-031. No implementation PASS is asserted by this planning task.

### Plan

- [x] Step 0 — Inspect worktree/status and owning task dependencies; read cited current code and ADR-022/031; preserve concurrent edits and identify checkout-bound CLI runner.
- [x] Step 1 — Before production edits, add failing E2E/behavior cases for R1-R6: Surfdash real/podcast dummy and reverse; missing KK_SURFDASH_ROOT; real owned partial failure; optional-only success with owned dummy; drafted owned results; one effect-none retry succeeds; second failure recorded/nonzero; uncertain live never resent; reports survive failure; excluded rows visible; matrix marker names exact failed target.
- [x] Step 2 — Implement R1-R6 within the listed ownership and frozen design; keep upstream contracts and legacy voice2/kk-itc compatibility.
- [x] Step 3 — Run the focused real-dispatcher cases; inspect receipts and measured artifacts for failures, no-content and resume, not only process exit.
- [x] Step 4 — Update owning surface docs, run required project checks, review the diff against every R-item, and record exact verification evidence and remaining limitations through Spur.

### Solution

**Change map (0333, receipt-aware outcomes/retries/settlement):**

- `apps/cli/src/publish-matrix.ts`
  - `runPublishMatrixSettle` — apps/cli/src/publish-matrix.ts:1010 — settlement keyed to `plan.parentRunId`; per-row blockers (no receipt / parentRunId mismatch / dummy / `status ≠ succeeded` / `effect ≠ confirmed` / `mode ≠ live`) hold the selection with `unresolved[]` reasons; empty required-real set → explicit `no required real owned rows in this window` hold, exit 0; store mark failure → `marked:false` + exit 1; success → `marked:true`; writes `4-publish/settlement.<window>.json`.
  - Frozen-plan payload integrity in `sendPublishMatrix` apps/cli/src/publish-matrix.ts:1294, apps/cli/src/publish-matrix.ts:1299 — every sent row's payload must exist on disk and match `row.payloadDigest` (sha256), else refuse with a re-run-plan pointer.
  - Policy-drop visibility — plan/outcome carry `excluded[]` apps/cli/src/publish-matrix.ts:484 area; reasons `excluded by bundle safety` | `mode off` | `not in --channels list`), distinct from variant-missing `omitted`; `PublishPlanExcludedSchema`/`PublishPlanExcluded` — apps/cli/src/publish-matrix.ts:93, apps/cli/src/publish-matrix.ts:106.
  - `--retry` contract enforced in `sendPublishMatrix` — only live/draft failures with `effect: none` resend; succeeded rows skipped; uncertain-effect live rows never replayed; dummy rows never spawn a plugin.
- `apps/cli/src/publish-matrix-stage.ts` — apps/cli/src/publish-matrix-stage.ts:42 — registered `publish-matrix-settle` in the native dispatch switch (was falling through to the generic runner → rc=1).
- `plugins/kk/scripts/kk-workflow-stages.ts`
  - `publishMatrixPartial` — plugins/kk/scripts/kk-workflow-stages.ts:1456 — outcome `full` deletes a stale marker; else `partial-marker.<window>.txt` names the exact failed ids and the receipt-scoped rerun (`kk stage run publish-matrix-send <work_dir> --window <w> --retry`; never `--retry-from`).
  - `publishMatrixPatchSurfdash` — plugins/kk/scripts/kk-workflow-stages.ts:1505 — payload derived only from the real surfdash receipt's `aggregatePath` → `metadata.postPath`; dummy/missing podcast → explicit empty links (never fabricated); no real tier-0 post evidence → recorded skip, exit 0; artifacts `patch-surfdash.{result,payload}.json`.
- `plugins/kk/workflows/kk-daily-publish3.yaml` — `send` carries action-level `onError: continue` so evidence survives; new `send-retry` node — plugins/kk/workflows/kk-daily-publish3.yaml:144 (one bounded hop, non-overseas); `classify` depends on `[send-retry, send]`; `patch-surfdash` — plugins/kk/workflows/kk-daily-publish3.yaml:175 (after-generate only, condition = window check — the stage self-gates on real receipt evidence, keeping the 0323 no-channel-names invariant); `partial-marker` — plugins/kk/workflows/kk-daily-publish3.yaml:195 (on `partial|none` outcomes); `settle` — plugins/kk/workflows/kk-daily-publish3.yaml:213 (non-overseas); `outcome-assert` — plugins/kk/workflows/kk-daily-publish3.yaml:231 (after `ledger`) — a partial window with failed required real targets exits nonzero after report/ledger are written; gated-miss days (no outcome file) stay done. Engine schema: `onError` is action-level only (node-level is rejected by the DAG schema).
- `apps/cli/tests/publish-matrix-0333.test.ts` — failure-first matrix written before the fixes: F1–F10 + E1–E6 + F5b (native settle dispatch regression) = 18 cases; real Spur DAG runs via `spur workflow run` shim, deterministic fixture plugins (distinct plugin ids for repeat behavior; seeded real payloads + sha256 digests matching the frozen plan), intercepted transports, isolated store.
- `docs/04_DESIGN.md` — publish3 node table updated (send-retry / patch-surfdash / settle / outcome-assert) + new "Outcomes, retries and settlement (task 0333)" paragraph (same change as the surface, per 99 §160).

**Rationale:** the receipt is the only publication authority (ADR-022/ADR-031): drafts and rehearsals hold, live-confirmed required sets promote, and every hold names why. Retries are receipt-scoped and bounded by construction — one workflow hop plus targeted operator reruns — and the run's honest exit lives in `outcome-assert`, after all evidence is written, so a partial window never masquerades as done and never loses its incident trail.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | test: apps/cli/tests/publish-matrix-0333.test.ts:897 (one effect-none retry succeeds — attempt-1 failed, retry-1 succeeded, run exits 0), :934 (second failure recorded, run exits nonzero with report intact), :739 (uncertain live receipt never resent — attemptId stays attempt-1); static-ref: apps/cli/src/publish-matrix.ts:1087 (sendPublishMatrix --retry contract: only live/draft failures with effect none resend), plugins/kk/workflows/kk-daily-publish3.yaml:144 (single bounded send-retry hop, no back-edge), :231 (outcome-assert after ledger fails the run on failed required real rows) |
| R2 | MET | test: apps/cli/tests/publish-matrix-0333.test.ts:962 (all-dummy rehearsal succeeds, settlement holds, report lists every row including excluded), :934 (report survives the failing outcome assertion); static-ref: apps/cli/src/publish-matrix.ts:146 (classify always exits 0 and writes the outcome), :484 (excluded[] policy-drop visibility with typed reasons), plugins/kk/scripts/kk-workflow-stages.ts:1456 (report node consumes outcome rows + excluded[]); command: bun test apps/cli/tests/publish-matrix-0333.test.ts 18/0 |
| R3 | MET | test: apps/cli/tests/publish-matrix-0333.test.ts:564 (real surfdash + dummy podcast derives payload with empty links, honest offline skip), :621 (dummy-only surfdash skips explicitly, no patch payload), :650 (missing podcast receipt patches with empty links), :689 (runs without KK_SURFDASH_ROOT — site root from plugin config); static-ref: plugins/kk/scripts/kk-workflow-stages.ts:1505 (payload only from real receipt aggregatePath → metadata.postPath), plugins/kk/workflows/kk-daily-publish3.yaml:175 (after-generate gate = window check; stage self-gates on real receipt evidence, preserving the 0323 no-channel-names invariant) |
| R4 | MET | test: apps/cli/tests/publish-matrix-0333.test.ts:249 (drafted owned success holds, never marks published), :287 (live-confirmed required owned rows mark published keyed to bundle parentRunId), :355 (partial failure holds with exact failed target named), :392 (optional-only + owned dummy never settles), :421 (stale-parent receipt is not evidence), :450 (native dispatcher routes settle); static-ref: apps/cli/src/publish-matrix.ts:1010 (runPublishMatrixSettle per-row blockers + unresolved[] reasons), apps/cli/src/publish-matrix-stage.ts:42 (registered settle in the native switch) |
| R5 | MET | test: apps/cli/tests/publish-matrix-0333.test.ts:465 (marker names exact failed targets, receipt-scoped rerun pointer, no _17/--retry-from), :512 (full window removes the stale marker); static-ref: plugins/kk/scripts/kk-workflow-stages.ts:1456 (publishMatrixPartial) |
| R6 | MET | test: apps/cli/tests/publish-matrix-0333.test.ts (18 cases F1–F10/E1–E6/F5b over real/dummy permutations, all-dummy, owned failures, safe retry, uncertain live, excluded targets, drafts, report/ledger via fake transports + isolated store + real spur workflow DAG runs); command: bun run test 4523 pass / 0 fail; command: bun run lint / build / test-pre-check (58 rules) / test-post-check (2 rules) all exit 0 |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Receipt outcomes drive safe retries settlement and mixed dummy tails (req: R1, R2, R3, R4, R5, R6) | MET | test | apps/cli/tests/publish-matrix-0333.test.ts:249,287,355,392,421,450,465,512,564,621,650,689,739,897,934,962,977 cover the declared concrete cases (real+dummy and reverse, missing site root, partial failure, optional-only success, drafted results, effect-none retry, second failure, uncertain live, surviving reports, excluded visibility, exact failed-target marker) through the real seam (real spur workflow DAG, intercepted transports, isolated store); re-verified 2026-11-05 (bun run lint exit 0; bun run build exit 0; bun run test exit 0, 4613 pass / 3 skip / 0 fail across 236 files) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

| Severity | Finding | Resolution |
| --- | --- | --- |
| P3 | 0323-era node whitelist test pinned old node ids (`surfdash-patch`, `mark-published`) and the no-channel-names grep flagged the new jq condition | Contract updated in the same change to the designed 0333 graph (17 nodes incl. `send-retry`, `settle`, `outcome-assert`); the no-channel-names invariant is preserved by moving the surfdash gating into the stage itself (yaml condition = window check only) — `apps/cli/tests/kk-daily-publish3.test.ts:344`, yaml :181 |
| P3 | Native dispatch for `publish-matrix-settle` was missing (E1) and had no in-process coverage | Registered `apps/cli/src/publish-matrix-stage.ts:42`; regression case F5b drives the dispatcher directly |
| P3 | Coverage: `publish-matrix-stage.ts` dipped to 88.89% lines after adding the settle case (child-process runs don't count toward bun coverage) | F5b in-process dispatch test restores ≥90% (file now covered); full-suite coverage exit 0 |
| P4 | Post-check TSDoc rule flagged exported `PublishPlanExcluded` | Doc comment added (`apps/cli/src/publish-matrix.ts:106`) |

**Residual risk:** low — settlement marks the store only on live-confirmed, current-parent receipts; every hold is explicit with reasons; uncertain-effect live rows are never replayed. The production schedule installation and any live sending remain separate operator actions (out of scope per Non-goals).

Confidence: HIGH — Verdict: PASS

### References

- Parent feature: G15, docs/features/G15_daily-ai-voice-v3-split-generate-and-publish-preset-driven-channel-matrix.md.
- Source audit: .spur/reports/voice3-migration-review-2026-10-25.md; all owned findings and current-code premises are embedded in Background so this task is self-contained.
- Authority: docs/00_ADR.md:957 (ADR-022), docs/00_ADR.md:1223 (ADR-031), docs/design/kk-daily-ai-voice3.md:227 (accepted operator decisions), docs/99_PROJECT_CONSTITUTION.md:160 (surface/status synchronization).
- Dependencies: 0332.
- Batch map and readiness evidence: .spur/reports/voice3-task-plan/handoff.md and readiness.json.
- Code/test targets and observable failure matrix: Design.

### History

- 2026-11-04T08:27:05.085Z todo → wip (system)
- 2026-11-04T08:48:17.054Z wip → testing (system)
- 2026-11-04T08:55:54.496Z testing → wip (system)
- 2026-11-04T09:09:53.249Z wip → testing (system)
- 2026-11-04T09:12:37.706Z testing → wip (system)
- 2026-11-04T09:12:54.613Z wip → testing (system)
- 2026-11-04T09:12:56.664Z testing → done (system)

