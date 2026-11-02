---
schema_version: 1
name: Enforce operation-specific draft and live boundaries for matrix publishing
status: todo
template: feature-impl
created_at: 2026-10-26T00:11:53.720Z
updated_at: "2026-10-26T00:15:39.056Z"
feature_id: G15
priority: P1
tags:
  - voice3-migration
  - migration-audit-20261025
estimate_hours: 8

ac_numbering: task-local
---

## 0330. Enforce operation-specific draft and live boundaries for matrix publishing

### Background

Operator request: file every migration finding as implementation-ready work for later delegation; do not implement or activate production in this filing. Source audit: .spur/reports/voice3-migration-review-2026-10-25.md. G15 is reopened for corrective work; original completed tasks remain history. Accepted decisions D1-D4 in docs/design/kk-daily-ai-voice3.md remain authoritative: split generation/publication, preset ownership, Chinese-only output, three windows. No new channels, locale pipeline, dependencies or toolchains. No changes to voice2 production scheduling, live credentials, installed packages, .env files or .github/workflows. Preparation of launchers/runbooks is in scope; installing schedules, publishing or changing production configuration needs separate explicit authorization.

Owned audit findings: F03, C01. Priority reflects the highest owned severity; estimate 8 engineer-hours includes failure-first tests, docs and final checks.

- apps/cli/src/publish-matrix.ts:346 — matrix payload mode is expressed only as metadata.publishStatus.
- plugins/publishings/surfdash-pub/src/index.ts:129 — Surfdash reads metadata.published; plugins/publishings/podcast-pub/src/map.ts:115 reads metadata.status and defaults published.
- plugins/publishings/x-pub/src/index.ts:109 and plugins/publishings/threads-pub/src/index.ts:150 — short-post transports proceed to live HTTP without a draft refusal.
- plugins/publishings/weibo-pub/src/index.ts:299 — Weibo short posts already refuse drafts; preserve that behavior.

Environment/concurrency: Bun 1.4.3; pinned Biome via bun run lint/format; installed Spur observed at 0.4.20 (run latest bare CLI, do not pin). Existing uncommitted apps/cli/src/publish-matrix.ts and apps/cli/tests/publish-matrix.test.ts changes belong to concurrent work: inspect and preserve them, never revert. Only the main worktree and no wip tasks were observed during filing; recheck at implementation start. Multiple tasks touch workflow/stage/matrix files: obey dependencies and use isolated worktrees for concurrent execution. Production stage sources currently match checkout, but bundled CLI parity is unverified; tests must bind the checkout CLI and scripts through a local shim, never the installed live runner.

**Refine corrections (2026-10-25)**
- Findings were checked against the current tree, including concurrent matrix edits; none of this task's owned defects is already fixed. Preserve existing fixes rather than reopening them.
- Completed G15 work is historical, not proof of migration readiness. This task is new corrective implementation, not a completed verification.
- Operational constraints C01-C05 mean: explicit real/dummy/off inventory; manual live confirmation; opt-in auto_publish and prepared launchers; accepted zh-only locale parity; deterministic fixtures for wait/RSS. They are assigned as implementation/runbook work without authorizing production activation.

### Requirements

- [ ] R1. Map matrix draft/live to each selected operation native fields: Surfdash metadata.published false/true, podcast metadata.status unpublished/published, and publishStatus draft/public for operations using that contract. Remove contradictory inherited mode fields.
- [ ] R2. Refuse X and Threads short-post draft requests before credential lookup or HTTP dispatch; absent or unknown mode in matrix payloads fails closed. Preserve direct plugin legacy behavior outside an explicitly supplied draft request.
- [ ] R3. Preset files remain off|dummy|draft only; live requires a matching launch token and existing send-confirm boundary. No skip_review, auto_publish or dummy flag may promote a real send.
- [ ] R4. Dummy rows never construct a publishing transport. Unsupported draftless operations in a safe migration preset remain dummy/off unless explicitly launched live.
- [ ] R5. Prove real mapping/transport behavior with intercepted HTTP and native mapping output for Surfdash, podcast, X, Threads, WeChat, XHS and Weibo; no live request occurs from draft or dummy input.

### Acceptance Criteria

- [ ] AC1 — Draft and dummy launches never publish live on any selected operation (req: R1, R2, R3, R4, R5)

Given the current checkout and the isolated fixture conditions in Design, when the listed success/failure/replay cases run through the actual owned seam, then every R-item is observed through receipts, store state, artifact bytes and process/run status. Verification owner: this task's implementer; final cross-task rehearsal belongs to the rehearsal task. Concrete cases: Source metadata public but requested draft; Surfdash frontmatter draft true; podcast mapped status unpublished; X/Threads draft intercepted before HTTP; unknown mode; real explicit live under fake transport; global dummy no transport; dummy+live token refusal; unaffected kk-itc fixture.

### Q&A

Closed decisions (2026-10-25):
- Scope: implement the local correction described here; production publishing, scheduler installation and installed-package syncing remain separate operator actions.
- Compatibility: preserve voice2 and kk-itc behavior unless this task explicitly provides a voice3-only opt-in.
- Decisions D1-D4 remain accepted; Chinese-only parity is intentional and manual live confirmation is retained. Unsupported operations stay explicit dummy/off, never implicit live.
- Dependencies: none; handoff contracts and exact owned paths are in Design. No unresolved architecture or scope question remains for the implementer.
- Source audit findings owned here: F03, C01. Failure cases must precede production edits; evidence uses isolated local fixtures.

### Design

**Ownership:** apps/cli/src/publish-matrix.ts (payload-mode preparation); plugins/publishings/surfdash-pub/src/index.ts; plugins/publishings/podcast-pub/src/map.ts; plugins/publishings/x-pub/src/index.ts; plugins/publishings/threads-pub/src/index.ts; affected plugin tests and apps/cli/tests/publish-matrix.test.ts; docs/04_DESIGN.md. Own only this behavior; do not revert others' edits.

No new public CLI flags or preset enum values. Add operation-aware payload preparation at the matrix boundary using existing publisher contracts; platform-native interpretation stays in each plugin. Matrix-generated payloads always carry an explicit mode, even if a caller's source variant claims published/public. API-only draftless transports must reject an explicit draft themselves as defense in depth. Do not invent a remote draft endpoint. Use exactly status unpublished for podcast drafts and published for live, and published boolean for Surfdash; verify these local mapper contracts before edits. Do not move browser logic into the workflow. Handoff: delivery identity consumes truthful plan mode; scheduling owns the migration preset and launch examples. Preserve kk-itc direct plugin defaults unless explicitly supplied draft; run its shared publish E2E regression. Rejected: merely asserting plan.mode, marking fake API results as drafts, and granting implicit live consent to owned publishers.

**Dependencies:** none; runnable immediately. Dependency edges are persisted in frontmatter.

**Inbound handoff:** Current source contracts and audit reproductions; no upstream implementation prerequisite.

**Outbound handoff:** 0331 — Every real publish variant carries current platform-aware safety evidence; 0334 — Rendered migration schedules resolve the correct bundle and approval model.

**Execution scope:** This task specifies local implementation when delegated. The filing itself performed planning only. Shared-file tasks must respect these edges; independent initial tasks may run in separate worktrees.

**Batch order:** 0329 and 0330 may start independently; 0331 follows both; 0332 follows 0331; 0333 and 0334 follow 0332; 0335 follows both. Transitive prerequisites remain binding.

**Non-goals:** Operator request: file every migration finding as implementation-ready work for later delegation; do not implement or activate production in this filing. Source audit: .spur/reports/voice3-migration-review-2026-10-25.md. G15 is reopened for corrective work; original completed tasks remain history. Accepted decisions D1-D4 in docs/design/kk-daily-ai-voice3.md remain authoritative: split generation/publication, preset ownership, Chinese-only output, three windows. No new channels, locale pipeline, dependencies or toolchains. No changes to voice2 production scheduling, live credentials, installed packages, .env files or .github/workflows. Preparation of launchers/runbooks is in scope; installing schedules, publishing or changing production configuration needs separate explicit authorization.

**Failure-first matrix:** Source metadata public but requested draft; Surfdash frontmatter draft true; podcast mapped status unpublished; X/Threads draft intercepted before HTTP; unknown mode; real explicit live under fake transport; global dummy no transport; dummy+live token refusal; unaffected kk-itc fixture.

Verification contract: enumerate failure cases and create behavior/E2E regression checks BEFORE changing production code; no post-hoc unit tests. Use bun:test, the real Spur DAG dispatcher, deterministic fixture generators/transports and intercepted HTTP; no provider/model calls, credentials, browser publication or live store access. Write observed evidence to .works/tmp/test-voice3-migration/0330/summary.json (and referenced logs/receipts), deriving the summary from assertions rather than hard-coded prose. Focused tests may exit 1 from per-file coverage; distinguish that from assertion failures. Final implementation gates: bun run lint, bun run test, bun run build, and project rule presets through bun run test-pre-check / bun run test-post-check; record actual exit codes. Update docs/04_DESIGN.md with changed surfaces in the same implementation change, following docs/99_PROJECT_CONSTITUTION.md and ADR-022/ADR-031. No implementation PASS is asserted by this planning task.

### Plan

- [ ] Step 0 — Inspect worktree/status and owning task dependencies; read cited current code and ADR-022/031; preserve concurrent edits and identify checkout-bound CLI runner.
- [ ] Step 1 — Before production edits, add failing E2E/behavior cases for R1-R5: Source metadata public but requested draft; Surfdash frontmatter draft true; podcast mapped status unpublished; X/Threads draft intercepted before HTTP; unknown mode; real explicit live under fake transport; global dummy no transport; dummy+live token refusal; unaffected kk-itc fixture.
- [ ] Step 2 — Implement R1-R5 within the listed ownership and frozen design; keep upstream contracts and legacy voice2/kk-itc compatibility.
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
