---
schema_version: 1
name: Prove voice3 replacement with a fresh offline multi-window migration rehearsal
status: todo
template: feature-impl
created_at: 2026-10-26T00:11:53.727Z
updated_at: "2026-10-26T00:13:49.781Z"
feature_id: G15
priority: P2
tags:
  - voice3-migration
  - migration-audit-20261025
estimate_hours: 8

dependencies: ["0333", "0334"]
ac_numbering: task-local
---

## 0335. Prove voice3 replacement with a fresh offline multi-window migration rehearsal

### Background

Operator request: file every migration finding as implementation-ready work for later delegation; do not implement or activate production in this filing. Source audit: .spur/reports/voice3-migration-review-2026-10-25.md. G15 is reopened for corrective work; original completed tasks remain history. Accepted decisions D1-D4 in docs/design/kk-daily-ai-voice3.md remain authoritative: split generation/publication, preset ownership, Chinese-only output, three windows. No new channels, locale pipeline, dependencies or toolchains. No changes to voice2 production scheduling, live credentials, installed packages, .env files or .github/workflows. Preparation of launchers/runbooks is in scope; installing schedules, publishing or changing production configuration needs separate explicit authorization.

Owned audit findings: F22, C01, C02, C03, C04, C05. Priority reflects the highest owned severity; estimate 8 engineer-hours includes failure-first tests, docs and final checks.

- apps/cli/tests/voice3-dag.test.ts:138 checks YAML shape and freezes preseeded variants instead of executing fresh generation.
- apps/cli/tests/kk-daily-publish3.test.ts:55 shims readiness/feed/wait/legacy tails; :276 checks later-window membership without asserting all delivered receipts.
- apps/cli/tests/kk-daily-publish3.test.ts:411 writes a static windows.md summary, which is not measured whole-flow evidence.
- The audit reproduced skipped selection, missing episode, unsafe draft mapping, receipt reuse and scheduler token rejection despite green focused assertions; concrete reproductions are retained in the audit report.

Environment/concurrency: Bun 1.4.3; pinned Biome via bun run lint/format; installed Spur observed at 0.4.20 (run latest bare CLI, do not pin). Existing uncommitted apps/cli/src/publish-matrix.ts and apps/cli/tests/publish-matrix.test.ts changes belong to concurrent work: inspect and preserve them, never revert. Only the main worktree and no wip tasks were observed during filing; recheck at implementation start. Multiple tasks touch workflow/stage/matrix files: obey dependencies and use isolated worktrees for concurrent execution. Production stage sources currently match checkout, but bundled CLI parity is unverified; tests must bind the checkout CLI and scripts through a local shim, never the installed live runner.

**Refine corrections (2026-10-25)**
- Findings were checked against the current tree, including concurrent matrix edits; none of this task's owned defects is already fixed. Preserve existing fixes rather than reopening them.
- Completed G15 work is historical, not proof of migration readiness. This task is new corrective implementation, not a completed verification.
- Operational constraints C01-C05 mean: explicit real/dummy/off inventory; manual live confirmation; opt-in auto_publish and prepared launchers; accepted zh-only locale parity; deterministic fixtures for wait/RSS. They are assigned as implementation/runbook work without authorizing production activation.

### Requirements

- [ ] R1. Execute the actual voice3 and publish3 DAG definitions from an empty isolated work root with isolated store selections, real stage orchestration and deterministic local provider/agent/transport fixtures. Do not preseed the assembled episode, variants or bundle.
- [ ] R2. Run all three windows using the explicit migration preset, both all-dummy and mixed draft/dummy operation sets, and validate every expected row receipt, artifact digest, safety exclusion, store disposition and terminal status.
- [ ] R3. Exercise empty supply, duration/QC refusal, unsafe/stale final variant, required/optional failure, bounded retry, unknown live outcome, changed revision, dummy-to-real, draft promotion refusal, RSS miss/hit/date mismatch and resume without duplicate delivery.
- [ ] R4. Execute rendered schedule commands through a cron-compatible parser and recording command double; test configured works root, date/DST and manual live-confirmation behavior without changing host schedules.
- [ ] R5. Generate machine-readable measured summary, per-case logs/receipts, artifact hashes and replay commands under .works/tmp/test-voice3-migration/<wbs>/; derive documentation tables from those outputs, not literal expected prose.
- [ ] R6. Publish a local migration-readiness runbook mapping all F01-F23 and C01-C05 to evidence, stating zh-only parity, manual live approval, selected real/dummy/off inventory, exact prepared cutover/rollback commands and remaining limitations. Never claim live browser readiness or activate production.

### Acceptance Criteria

- [ ] AC1 — Offline migration rehearsal proves the complete voice3 replacement contract (req: R1, R2, R3, R4, R5, R6)

Given the current checkout and the isolated fixture conditions in Design, when the listed success/failure/replay cases run through the actual owned seam, then every R-item is observed through receipts, store state, artifact bytes and process/run status. Verification owner: this task's implementer; final cross-task rehearsal belongs to the rehearsal task. Concrete cases: Fresh complete flow; all three disjoint windows; all-dummy; mixed draft/dummy; missing optional social; excluded platform; stale safety; no-content; QC/duration refusal; owned/optional failure and retry; unknown live; unchanged replay; changed parent/payload; dummy-to-real; draft promotion reconciliation; wrong RSS episode/date; schedule parsing and explicit resume.

### Q&A

Closed decisions (2026-10-25):
- Scope: implement the local correction described here; production publishing, scheduler installation and installed-package syncing remain separate operator actions.
- Compatibility: preserve voice2 and kk-itc behavior unless this task explicitly provides a voice3-only opt-in.
- Decisions D1-D4 remain accepted; Chinese-only parity is intentional and manual live confirmation is retained. Unsupported operations stay explicit dummy/off, never implicit live.
- Dependencies: 0333, 0334; handoff contracts and exact owned paths are in Design. No unresolved architecture or scope question remains for the implementer.
- Source audit findings owned here: F22, C01, C02, C03, C04, C05. Failure cases must precede production edits; evidence uses isolated local fixtures.

### Design

**Ownership:** apps/cli/tests/voice3-migration.e2e.test.ts (new); apps/cli/tests/voice3-dag.test.ts; apps/cli/tests/kk-daily-publish3.test.ts; apps/cli/tests/fixtures/voice3-migration/ (new deterministic doubles); scripts/voice3-migration-rehearsal.ts (new repeatable entry if needed); docs/design/kk-daily-ai-voice3.md; docs/04_DESIGN.md. Own only this behavior; do not revert others' edits.

This task verifies the combined behavior delivered by upstream work and may fix only fixture/rehearsal plumbing; newly discovered product defects are reported or routed back to their owning task, never hidden with looser assertions. Use checkout CLI/stage runners in the fixture PATH, actual Spur dispatcher and temporary DB/workspace, intercept HTTP and supply deterministic agent files. Double only external boundaries; do not replace the selection, assembly, safety validator, mode mapping, receipt guard, classifier or tail whose behavior is being asserted. Use fixture clock/feed injection to exercise real wait/RSS arithmetic without hours of waiting or real network. Real draft means the production dispatch path reaches a local fake transport, not an actual browser account. No automatic live promotion; a separate fake live case proves the pause/resume contract under explicit launch intent. Replace static rehearsal artifacts with measured output. Accepted parity is zh-only; missing new channel implementations stay explicit dummy/off. Handoff is a concrete production cutover recommendation with evidence, not authority to execute it. Rejected: happy-path-only YAML text tests, summary.md with hard-coded statuses, provider credits, live account probes, or preexisting voice2 files in the fixture.

**Dependencies:** 0333, 0334. Dependency edges are persisted in frontmatter.

**Inbound handoff:** 0333 — Receipt outcomes drive safe retries settlement and mixed dummy tails; 0334 — Rendered migration schedules resolve the correct bundle and approval model.

**Outbound handoff:** Measured migration-readiness recommendation and prepared operator cutover/rollback artifacts.

**Execution scope:** This task specifies local implementation when delegated. The filing itself performed planning only. Shared-file tasks must respect these edges; independent initial tasks may run in separate worktrees.

**Batch order:** 0329 and 0330 may start independently; 0331 follows both; 0332 follows 0331; 0333 and 0334 follow 0332; 0335 follows both. Transitive prerequisites remain binding.

**Non-goals:** Operator request: file every migration finding as implementation-ready work for later delegation; do not implement or activate production in this filing. Source audit: .spur/reports/voice3-migration-review-2026-10-25.md. G15 is reopened for corrective work; original completed tasks remain history. Accepted decisions D1-D4 in docs/design/kk-daily-ai-voice3.md remain authoritative: split generation/publication, preset ownership, Chinese-only output, three windows. No new channels, locale pipeline, dependencies or toolchains. No changes to voice2 production scheduling, live credentials, installed packages, .env files or .github/workflows. Preparation of launchers/runbooks is in scope; installing schedules, publishing or changing production configuration needs separate explicit authorization.

**Failure-first matrix:** Fresh complete flow; all three disjoint windows; all-dummy; mixed draft/dummy; missing optional social; excluded platform; stale safety; no-content; QC/duration refusal; owned/optional failure and retry; unknown live; unchanged replay; changed parent/payload; dummy-to-real; draft promotion reconciliation; wrong RSS episode/date; schedule parsing and explicit resume.

Verification contract: enumerate failure cases and create behavior/E2E regression checks BEFORE changing production code; no post-hoc unit tests. Use bun:test, the real Spur DAG dispatcher, deterministic fixture generators/transports and intercepted HTTP; no provider/model calls, credentials, browser publication or live store access. Write observed evidence to .works/tmp/test-voice3-migration/0335/summary.json (and referenced logs/receipts), deriving the summary from assertions rather than hard-coded prose. Focused tests may exit 1 from per-file coverage; distinguish that from assertion failures. Final implementation gates: bun run lint, bun run test, bun run build, and project rule presets through bun run test-pre-check / bun run test-post-check; record actual exit codes. Update docs/04_DESIGN.md with changed surfaces in the same implementation change, following docs/99_PROJECT_CONSTITUTION.md and ADR-022/ADR-031. No implementation PASS is asserted by this planning task.

### Plan

- [ ] Step 0 — Inspect worktree/status and owning task dependencies; read cited current code and ADR-022/031; preserve concurrent edits and identify checkout-bound CLI runner.
- [ ] Step 1 — Before production edits, add failing E2E/behavior cases for R1-R6: Fresh complete flow; all three disjoint windows; all-dummy; mixed draft/dummy; missing optional social; excluded platform; stale safety; no-content; QC/duration refusal; owned/optional failure and retry; unknown live; unchanged replay; changed parent/payload; dummy-to-real; draft promotion reconciliation; wrong RSS episode/date; schedule parsing and explicit resume.
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
- Dependencies: 0333, 0334.
- Batch map and readiness evidence: .spur/reports/voice3-task-plan/handoff.md and readiness.json.
- Code/test targets and observable failure matrix: Design.

### History
