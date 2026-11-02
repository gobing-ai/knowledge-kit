---
schema_version: 1
name: Bind matrix receipts, links and RSS proof to the current bundle revision
status: todo
template: feature-impl
created_at: 2026-10-26T00:11:53.723Z
updated_at: "2026-10-26T00:13:42.740Z"
feature_id: G15
priority: P1
tags:
  - voice3-migration
  - migration-audit-20261025
estimate_hours: 10

dependencies: ["0331"]
ac_numbering: task-local
---

## 0332. Bind matrix receipts, links and RSS proof to the current bundle revision

### Background

Operator request: file every migration finding as implementation-ready work for later delegation; do not implement or activate production in this filing. Source audit: .spur/reports/voice3-migration-review-2026-10-25.md. G15 is reopened for corrective work; original completed tasks remain history. Accepted decisions D1-D4 in docs/design/kk-daily-ai-voice3.md remain authoritative: split generation/publication, preset ownership, Chinese-only output, three windows. No new channels, locale pipeline, dependencies or toolchains. No changes to voice2 production scheduling, live credentials, installed packages, .env files or .github/workflows. Preparation of launchers/runbooks is in scope; installing schedules, publishing or changing production configuration needs separate explicit authorization.

Owned audit findings: F11, F12, F13, F17, F19. Priority reflects the highest owned severity; estimate 10 engineer-hours includes failure-first tests, docs and final checks.

- apps/cli/src/itc-publish.ts:499 — successful receipts skip by filename without run, mode or payload identity checks; the offline probe reused an old draft for a different live send.
- apps/cli/src/publish-matrix.ts:729 — readLinkMap scans current-window plan rows only; :933 matches feed dates literally; :977 reads a guid absent from the normal receipt writer.
- plugins/kk/workflows/kk-daily-publish3.yaml:138 — missing run_date is first rejected after send; test hit at apps/cli/tests/kk-daily-publish3.test.ts:314 proves another date can unlock the bundle.
- plugins/kk/workflows/kk-daily-ai-voice3.yaml:781 checks only x.md; builder skips absent social files but composePlan at apps/cli/src/publish-matrix.ts:329 aborts the full window.

Environment/concurrency: Bun 1.4.3; pinned Biome via bun run lint/format; installed Spur observed at 0.4.20 (run latest bare CLI, do not pin). Existing uncommitted apps/cli/src/publish-matrix.ts and apps/cli/tests/publish-matrix.test.ts changes belong to concurrent work: inspect and preserve them, never revert. Only the main worktree and no wip tasks were observed during filing; recheck at implementation start. Multiple tasks touch workflow/stage/matrix files: obey dependencies and use isolated worktrees for concurrent execution. Production stage sources currently match checkout, but bundled CLI parity is unverified; tests must bind the checkout CLI and scripts through a local shim, never the installed live runner.

**Refine corrections (2026-10-25)**
- Findings were checked against the current tree, including concurrent matrix edits; none of this task's owned defects is already fixed. Preserve existing fixes rather than reopening them.
- Completed G15 work is historical, not proof of migration readiness. This task is new corrective implementation, not a completed verification.
- Operational constraints C01-C05 mean: explicit real/dummy/off inventory; manual live confirmation; opt-in auto_publish and prepared launchers; accepted zh-only locale parity; deterministic fixtures for wait/RSS. They are assigned as implementation/runbook work without authorizing production activation.

### Requirements

- [ ] R1. Validate work_dir, valid window, bundle identity and run_date before side effects; omitted run_date derives from bundle, provided compact/ISO dates must normalize to the same valid calendar day.
- [ ] R2. Reuse a successful receipt only for the same parent bundle revision, target/operation, requested mode and delivered payload; preserve unchanged-row idempotence if only unrelated plan rows changed. Dummy-to-real dispatches once; draft-to-live must not be silently satisfied.
- [ ] R3. Fail a stale/different real receipt closed with an actionable reconciliation error, without overwrite/resend. Never automatically resend an unknown-effect live receipt, including malformed or unreadable evidence that may hide a live attempt.
- [ ] R4. Resolve article/podcast links using current-bundle tier-0 receipts across all windows, excluding dummy/draft URLs from real public links. Resolve article links before podcast notes dispatch and retain reviewed payload provenance.
- [ ] R5. Persist a stable podcast episode guid in the receipt from the plugin result and bind RSS hit/miss to bundle date and episode identity. Wrong dates, wrong episodes, timeout/HTTP failure and malformed XML do not authorize overseas sends.
- [ ] R6. Missing required variants refuse planning; missing optional variants yield explicit per-target failed effect-none receipts without cancelling unrelated targets. Failed dummy payload preparation remains dummy in all outcome accounting.
- [ ] R7. Exercise unchanged replay, draft promotion, dummy promotion, changed content/parent, corrupt receipts, cross-window links, date normalization/mismatch, feed errors and optional missing variants through the shared send path and ITC regression fixtures.

### Acceptance Criteria

- [ ] AC1 — Window sends bind receipts and RSS proof to one bundle revision (req: R1, R2, R3, R4, R5, R6, R7)

Given the current checkout and the isolated fixture conditions in Design, when the listed success/failure/replay cases run through the actual owned seam, then every R-item is observed through receipts, store state, artifact bytes and process/run status. Verification owner: this task's implementer; final cross-task rehearsal belongs to the rehearsal task. Concrete cases: Old successful draft versus live request; same row but unrelated plan change; different parent/date/payload; corrupted prior live receipt; dummy then real; after-generate links consumed by cn/overseas; podcast notes use article URL; compact date hit ISO feed; wrong-date bundle; guid proof; fetch timeout/503; missing optional Weibo with X valid; failed dummy prepare; kk-itc unaffected.

### Q&A

Closed decisions (2026-10-25):
- Scope: implement the local correction described here; production publishing, scheduler installation and installed-package syncing remain separate operator actions.
- Compatibility: preserve voice2 and kk-itc behavior unless this task explicitly provides a voice3-only opt-in.
- Decisions D1-D4 remain accepted; Chinese-only parity is intentional and manual live confirmation is retained. Unsupported operations stay explicit dummy/off, never implicit live.
- Dependencies: 0331; handoff contracts and exact owned paths are in Design. No unresolved architecture or scope question remains for the implementer.
- Source audit findings owned here: F11, F12, F13, F17, F19. Failure cases must precede production edits; evidence uses isolated local fixtures.

### Design

**Ownership:** apps/cli/src/publish-matrix.ts (plan/send/link/RSS identity); apps/cli/src/itc-publish.ts (shared receipt guards); plugins/kk/workflows/kk-daily-publish3.yaml (early validation); plugins/publishings/podcast-pub/src/index.ts (identity metadata only if needed); matrix/ITC/window E2E tests; docs/04_DESIGN.md. Own only this behavior; do not revert others' edits.

No new top-level commands. Keep current target ids and receipt locations for ITC compatibility. Add optional receipt guid/source identity fields as needed to ItcReceiptSchema, and enforce existing parentRunId, target, mode and payloadDigest plus bundle variant identity before a skip. A whole-plan digest alone is insufficient: row-local identity must survive adding an unrelated target. Safe default for an existing successful draft promoted to live is an explicit reconciliation-required failure, never silent skip or duplicate creation; remote update/promotion APIs are out of scope. Receipts with unknown live effect remain operator-reconciled. Plan must validate dates from Bundle.runDate before any payload write; re-freezing a different revision cannot silently inherit successes. Read all relevant owned receipts, verify source identity, and resolve only the two declared URL placeholders; no global content rewriting. RSS takes canonical ISO date, guid when present, and same-date title fallback only for the current bundle; no arbitrary caller-date authorization. On optional omission keep a planned identity and write failed/effect:none evidence with an actionable missing-variant error; classification continues. Dummy status derives from plan intent even on prepare failure. Handoff: outcome task consumes these receipts and normal retry eligibility; scheduling task relies on date derivation and canonical bundle validation. Rejected: deleting old receipts to resend, making retry resend unknown effects, sharing dummy:// links with real channels, and swallowing missing variants.

**Dependencies:** 0331. Dependency edges are persisted in frontmatter.

**Inbound handoff:** 0331 — Every real publish variant carries current platform-aware safety evidence.

**Outbound handoff:** 0333 — Receipt outcomes drive safe retries settlement and mixed dummy tails; 0334 — Rendered migration schedules resolve the correct bundle and approval model.

**Execution scope:** This task specifies local implementation when delegated. The filing itself performed planning only. Shared-file tasks must respect these edges; independent initial tasks may run in separate worktrees.

**Batch order:** 0329 and 0330 may start independently; 0331 follows both; 0332 follows 0331; 0333 and 0334 follow 0332; 0335 follows both. Transitive prerequisites remain binding.

**Non-goals:** Operator request: file every migration finding as implementation-ready work for later delegation; do not implement or activate production in this filing. Source audit: .spur/reports/voice3-migration-review-2026-10-25.md. G15 is reopened for corrective work; original completed tasks remain history. Accepted decisions D1-D4 in docs/design/kk-daily-ai-voice3.md remain authoritative: split generation/publication, preset ownership, Chinese-only output, three windows. No new channels, locale pipeline, dependencies or toolchains. No changes to voice2 production scheduling, live credentials, installed packages, .env files or .github/workflows. Preparation of launchers/runbooks is in scope; installing schedules, publishing or changing production configuration needs separate explicit authorization.

**Failure-first matrix:** Old successful draft versus live request; same row but unrelated plan change; different parent/date/payload; corrupted prior live receipt; dummy then real; after-generate links consumed by cn/overseas; podcast notes use article URL; compact date hit ISO feed; wrong-date bundle; guid proof; fetch timeout/503; missing optional Weibo with X valid; failed dummy prepare; kk-itc unaffected.

Verification contract: enumerate failure cases and create behavior/E2E regression checks BEFORE changing production code; no post-hoc unit tests. Use bun:test, the real Spur DAG dispatcher, deterministic fixture generators/transports and intercepted HTTP; no provider/model calls, credentials, browser publication or live store access. Write observed evidence to .works/tmp/test-voice3-migration/0332/summary.json (and referenced logs/receipts), deriving the summary from assertions rather than hard-coded prose. Focused tests may exit 1 from per-file coverage; distinguish that from assertion failures. Final implementation gates: bun run lint, bun run test, bun run build, and project rule presets through bun run test-pre-check / bun run test-post-check; record actual exit codes. Update docs/04_DESIGN.md with changed surfaces in the same implementation change, following docs/99_PROJECT_CONSTITUTION.md and ADR-022/ADR-031. No implementation PASS is asserted by this planning task.

### Plan

- [ ] Step 0 — Inspect worktree/status and owning task dependencies; read cited current code and ADR-022/031; preserve concurrent edits and identify checkout-bound CLI runner.
- [ ] Step 1 — Before production edits, add failing E2E/behavior cases for R1-R7: Old successful draft versus live request; same row but unrelated plan change; different parent/date/payload; corrupted prior live receipt; dummy then real; after-generate links consumed by cn/overseas; podcast notes use article URL; compact date hit ISO feed; wrong-date bundle; guid proof; fetch timeout/503; missing optional Weibo with X valid; failed dummy prepare; kk-itc unaffected.
- [ ] Step 2 — Implement R1-R7 within the listed ownership and frozen design; keep upstream contracts and legacy voice2/kk-itc compatibility.
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
- Dependencies: 0331.
- Batch map and readiness evidence: .spur/reports/voice3-task-plan/handoff.md and readiness.json.
- Code/test targets and observable failure matrix: Design.

### History
