---
schema_version: 1
name: Repair voice3 generation closure, pool routing and complete episode bundles
status: todo
template: feature-impl
created_at: 2026-10-26T00:11:53.714Z
updated_at: "2026-10-26T00:13:35.991Z"
feature_id: G15
priority: P1
tags:
  - voice3-migration
  - migration-audit-20261025
estimate_hours: 10

ac_numbering: task-local
---

## 0329. Repair voice3 generation closure, pool routing and complete episode bundles

### Background

Operator request: file every migration finding as implementation-ready work for later delegation; do not implement or activate production in this filing. Source audit: .spur/reports/voice3-migration-review-2026-10-25.md. G15 is reopened for corrective work; original completed tasks remain history. Accepted decisions D1-D4 in docs/design/kk-daily-ai-voice3.md remain authoritative: split generation/publication, preset ownership, Chinese-only output, three windows. No new channels, locale pipeline, dependencies or toolchains. No changes to voice2 production scheduling, live credentials, installed packages, .env files or .github/workflows. Preparation of launchers/runbooks is in scope; installing schedules, publishing or changing production configuration needs separate explicit authorization.

Owned audit findings: F01, F02, F06, F15, F16, F21, F23. Priority reflects the highest owned severity; estimate 10 engineer-hours includes failure-first tests, docs and final checks.

- plugins/kk/workflows/kk-daily-ai-voice3.yaml:253 — select reads the sibling pool token without depending on pool-gate; the safe engine fixture completed without selecting.
- plugins/kk/scripts/daily-stages.ts:1801 — the episode builder exclusively reads the removed _13_publish-prep_content.json; fresh bundle reproduction froze article variants and failed podcast planning.
- plugins/kk/scripts/daily-stages.ts:660 — duration refusal empties candidates and returns success; the earlier PASS token is not refreshed.
- plugins/kk/workflows/kk-daily-ai-voice3.yaml:788 — bundle-variants omits notes/cards/cover producer edges; prepare at :141 validates voice2.
- plugins/kk/scripts/daily-stages.ts:2314 — dailyQualityReport logs failed/absent QC without rejection.

Environment/concurrency: Bun 1.4.3; pinned Biome via bun run lint/format; installed Spur observed at 0.4.20 (run latest bare CLI, do not pin). Existing uncommitted apps/cli/src/publish-matrix.ts and apps/cli/tests/publish-matrix.test.ts changes belong to concurrent work: inspect and preserve them, never revert. Only the main worktree and no wip tasks were observed during filing; recheck at implementation start. Multiple tasks touch workflow/stage/matrix files: obey dependencies and use isolated worktrees for concurrent execution. Production stage sources currently match checkout, but bundled CLI parity is unverified; tests must bind the checkout CLI and scripts through a local shim, never the installed live runner.

**Refine corrections (2026-10-25)**
- Findings were checked against the current tree, including concurrent matrix edits; none of this task's owned defects is already fixed. Preserve existing fixes rather than reopening them.
- Completed G15 work is historical, not proof of migration readiness. This task is new corrective implementation, not a completed verification.
- Operational constraints C01-C05 mean: explicit real/dummy/off inventory; manual live confirmation; opt-in auto_publish and prepared launchers; accepted zh-only locale parity; deterministic fixtures for wait/RSS. They are assigned as implementation/runbook work without authorizing production activation.

### Requirements

- [ ] R1. Use the kk-daily-ai-voice3 namespace for prepare, its work-dir anchor and store workflow label; all consumers run after an explicit current-run pool verdict. A successful non-empty run records its exact selection once.
- [ ] R2. Close initial empty/thin supply and post-synthesis minimum-duration refusal as no-content, with report and ledger evidence, no publishable bundle and no sends. A refusal must invalidate any earlier PASS token and same-day stale bundle.
- [ ] R3. Reintroduce a generation-owned episode-assemble DAG node using existing daily-publish-prep after final audio/duration/safety. Preserve audio, MP3, ID3, cover and episode metadata; never depend on a previous voice2 directory.
- [ ] R4. Wait for show-notes, cover-normalize and enabled cards-render producers; exclude disabled or stale assets. Freeze validates every selected required variant and all digests before writing an atomic bundle.
- [ ] R5. Preflight voice3, publish3 and nested safety stage compatibility before generation. Voice3 quality rejects explicit failed QC, critical issues and missing QC; keep voice2 report-only default unchanged.
- [ ] R6. Demonstrate fresh success, empty supply, duration refusal, failed/absent QC, producer failure/disabled assets and dirty same-day rerun with real dispatcher ordering and observable artifacts.

### Acceptance Criteria

- [ ] AC1 — Fresh voice3 runs select current items and freeze complete validated bundles (req: R1, R2, R3, R4, R5, R6)

Given the current checkout and the isolated fixture conditions in Design, when the listed success/failure/replay cases run through the actual owned seam, then every R-item is observed through receipts, store state, artifact bytes and process/run status. Verification owner: this task's implementer; final cross-task rehearsal belongs to the rehearsal task. Concrete cases: Fresh article+audio and no 31-publish input; first consumer sees PASS; selection recorded once; empty pool; measured short episode after initial PASS; failed/missing QC; optional cards disabled with stale cards present; notes producer failure; required episode missing at freeze; rerun without stale bundle reuse.

### Q&A

Closed decisions (2026-10-25):
- Scope: implement the local correction described here; production publishing, scheduler installation and installed-package syncing remain separate operator actions.
- Compatibility: preserve voice2 and kk-itc behavior unless this task explicitly provides a voice3-only opt-in.
- Decisions D1-D4 remain accepted; Chinese-only parity is intentional and manual live confirmation is retained. Unsupported operations stay explicit dummy/off, never implicit live.
- Dependencies: none; handoff contracts and exact owned paths are in Design. No unresolved architecture or scope question remains for the implementer.
- Source audit findings owned here: F01, F02, F06, F15, F16, F21, F23. Failure cases must precede production edits; evidence uses isolated local fixtures.

### Design

**Ownership:** plugins/kk/workflows/kk-daily-ai-voice3.yaml; plugins/kk/scripts/daily-stages.ts; plugins/kk/scripts/kk-workflow-stages.ts; apps/cli/src/publish-matrix.ts (bundle freeze only); apps/cli/tests/voice3-dag.test.ts; apps/cli/tests/kk-workflow-stages.test.ts; docs/04_DESIGN.md. Own only this behavior; do not revert others' edits.

Use existing kk daily prepare --workflow kk-daily-ai-voice3 and .spur/runs/kk-daily-ai-voice3/work-dir.txt; do not rename voice2 anchors. No new top-level CLI API. Keep pool-gate tokens as an explicit graph result, declare it before its consumers and add actual dependency edges. Refresh the verdict after duration; no-content remains a successful reported outcome, while invalid QC is a failure with a report. A generation report must also be reachable from extract/QC/no-content, not only bundle-freeze. Reuse daily-publish-prep through node id episode-assemble so its checked MP3/ID3 assembly and existing draft safety check remain intact. Add the opt-in --strict argument only to the existing daily-quality-report stage; absence preserves legacy behavior. Bundle-required validation uses the selected preset (existing publish_preset/config selector), not a hard-coded channel list; optional variant omissions are handed to delivery recovery task. Leave a complete bundle with runDate, parentRunId, variants and runs[], and producer output paths unchanged. Handoff: safety task owns final-variant safety, delivery task owns optional-row handling, scheduling task consumes the canonical voice3 work root. Rejected: copying voice2 prep artifacts, adding a new generator plugin, treating absent QC as pass or hiding no-content by weakening checks.

**Dependencies:** none; runnable immediately. Dependency edges are persisted in frontmatter.

**Inbound handoff:** Current source contracts and audit reproductions; no upstream implementation prerequisite.

**Outbound handoff:** 0331 — Every real publish variant carries current platform-aware safety evidence; 0334 — Rendered migration schedules resolve the correct bundle and approval model.

**Execution scope:** This task specifies local implementation when delegated. The filing itself performed planning only. Shared-file tasks must respect these edges; independent initial tasks may run in separate worktrees.

**Batch order:** 0329 and 0330 may start independently; 0331 follows both; 0332 follows 0331; 0333 and 0334 follow 0332; 0335 follows both. Transitive prerequisites remain binding.

**Non-goals:** Operator request: file every migration finding as implementation-ready work for later delegation; do not implement or activate production in this filing. Source audit: .spur/reports/voice3-migration-review-2026-10-25.md. G15 is reopened for corrective work; original completed tasks remain history. Accepted decisions D1-D4 in docs/design/kk-daily-ai-voice3.md remain authoritative: split generation/publication, preset ownership, Chinese-only output, three windows. No new channels, locale pipeline, dependencies or toolchains. No changes to voice2 production scheduling, live credentials, installed packages, .env files or .github/workflows. Preparation of launchers/runbooks is in scope; installing schedules, publishing or changing production configuration needs separate explicit authorization.

**Failure-first matrix:** Fresh article+audio and no 31-publish input; first consumer sees PASS; selection recorded once; empty pool; measured short episode after initial PASS; failed/missing QC; optional cards disabled with stale cards present; notes producer failure; required episode missing at freeze; rerun without stale bundle reuse.

Verification contract: enumerate failure cases and create behavior/E2E regression checks BEFORE changing production code; no post-hoc unit tests. Use bun:test, the real Spur DAG dispatcher, deterministic fixture generators/transports and intercepted HTTP; no provider/model calls, credentials, browser publication or live store access. Write observed evidence to .works/tmp/test-voice3-migration/0329/summary.json (and referenced logs/receipts), deriving the summary from assertions rather than hard-coded prose. Focused tests may exit 1 from per-file coverage; distinguish that from assertion failures. Final implementation gates: bun run lint, bun run test, bun run build, and project rule presets through bun run test-pre-check / bun run test-post-check; record actual exit codes. Update docs/04_DESIGN.md with changed surfaces in the same implementation change, following docs/99_PROJECT_CONSTITUTION.md and ADR-022/ADR-031. No implementation PASS is asserted by this planning task.

### Plan

- [ ] Step 0 — Inspect worktree/status and owning task dependencies; read cited current code and ADR-022/031; preserve concurrent edits and identify checkout-bound CLI runner.
- [ ] Step 1 — Before production edits, add failing E2E/behavior cases for R1-R6: Fresh article+audio and no 31-publish input; first consumer sees PASS; selection recorded once; empty pool; measured short episode after initial PASS; failed/missing QC; optional cards disabled with stale cards present; notes producer failure; required episode missing at freeze; rerun without stale bundle reuse.
- [ ] Step 2 — Implement R1-R6 within the listed ownership and frozen design; keep upstream contracts and legacy voice2/kk-itc compatibility.
- [ ] Step 3 — Run the focused real-dispatcher cases; inspect receipts and measured artifacts for failures, no-content and resume, not only process exit.
- [ ] Step 4 — Update owning surface docs, run required project checks, review the diff against every R-item, and record exact verification evidence and remaining limitations through Spur.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Parent feature: G15, docs/features/G15_daily-ai-voice-v3-split-generate-and-publish-preset-driven-channel-matrix.md.
- Source audit: .spur/reports/voice3-migration-review-2026-10-25.md; all owned findings and current-code premises are embedded in Background so this task is self-contained.
- Authority: docs/00_ADR.md:957 (ADR-022), docs/00_ADR.md:1223 (ADR-031), docs/design/kk-daily-ai-voice3.md:227 (accepted operator decisions), docs/99_PROJECT_CONSTITUTION.md:160 (surface/status synchronization).
- Dependencies: none.
- Batch map and readiness evidence: .spur/reports/voice3-task-plan/handoff.md and readiness.json.
- Code/test targets and observable failure matrix: Design.

### History
