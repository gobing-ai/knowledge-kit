---
schema_version: 1
name: Prepare correct voice3 migration schedules and an explicit safe channel preset
status: todo
template: feature-impl
created_at: 2026-10-26T00:11:53.725Z
updated_at: "2026-10-26T00:15:38.524Z"
feature_id: G15
priority: P1
tags:
  - voice3-migration
  - migration-audit-20261025
estimate_hours: 6

dependencies: ["0329", "0330", "0332"]
ac_numbering: task-local
---

## 0334. Prepare correct voice3 migration schedules and an explicit safe channel preset

### Background

Operator request: file every migration finding as implementation-ready work for later delegation; do not implement or activate production in this filing. Source audit: .spur/reports/voice3-migration-review-2026-10-25.md. G15 is reopened for corrective work; original completed tasks remain history. Accepted decisions D1-D4 in docs/design/kk-daily-ai-voice3.md remain authoritative: split generation/publication, preset ownership, Chinese-only output, three windows. No new channels, locale pipeline, dependencies or toolchains. No changes to voice2 production scheduling, live credentials, installed packages, .env files or .github/workflows. Preparation of launchers/runbooks is in scope; installing schedules, publishing or changing production configuration needs separate explicit authorization.

Owned audit findings: F08, F09, F10, C01, C02, C03, C04, C05. Priority reflects the highest owned severity; estimate 6 engineer-hours includes failure-first tests, docs and final checks.

- plugins/kk/schedules/kk-daily-publish3-cn-peak.cron.tmpl:20 and kk-daily-publish3-overseas.cron.tmpl:17 hard-code a nonproducer .works/kk-daily-publish3 path and contain cron-unescaped percent signs.
- apps/cli/src/publish-matrix.ts:295 rejects the cn schedule WeChat/XHS live tokens because preset cn rows contain only Weibo/X article operations.
- plugins/kk/workflows/kk-daily-ai-voice3.yaml:23 defaults auto_publish false; publish3 at :102 pauses for every real live plan.
- plugins/kk/publish-presets/daily-ai-voice.json:1 contains mostly real draft rows, one dummy operation and several off/absent deferred channels; design D3 at docs/design/kk-daily-ai-voice3.md:232 intentionally drops per-locale output.

Environment/concurrency: Bun 1.4.3; pinned Biome via bun run lint/format; installed Spur observed at 0.4.20 (run latest bare CLI, do not pin). Existing uncommitted apps/cli/src/publish-matrix.ts and apps/cli/tests/publish-matrix.test.ts changes belong to concurrent work: inspect and preserve them, never revert. Only the main worktree and no wip tasks were observed during filing; recheck at implementation start. Multiple tasks touch workflow/stage/matrix files: obey dependencies and use isolated worktrees for concurrent execution. Production stage sources currently match checkout, but bundled CLI parity is unverified; tests must bind the checkout CLI and scripts through a local shim, never the installed live runner.

**Refine corrections (2026-10-25)**
- Findings were checked against the current tree, including concurrent matrix edits; none of this task's owned defects is already fixed. Preserve existing fixes rather than reopening them.
- Completed G15 work is historical, not proof of migration readiness. This task is new corrective implementation, not a completed verification.
- Operational constraints C01-C05 mean: explicit real/dummy/off inventory; manual live confirmation; opt-in auto_publish and prepared launchers; accepted zh-only locale parity; deterministic fixtures for wait/RSS. They are assigned as implementation/runbook work without authorizing production activation.

### Requirements

- [ ] R1. Render generation and all publish-window launchers that resolve the canonical voice3 bundle from effective works_dir and the correct local run date, including configured root and DST boundaries; never infer a publish3 output directory as a generation source.
- [ ] R2. Remove cron percent parsing hazards by moving date/JSON calculation into the checkout launcher or correctly escaping it; test actual command parsing/execution with a recording spur double.
- [ ] R3. CN launch tokens must be a subset of the selected window and explicit operator intent; preserve manual send-confirm resume. Rendered schedules must clearly disclose a live launch pauses and must not claim unattended live delivery.
- [ ] R4. Provide daily-ai-voice-migration preset covering the existing matrix operation inventory with real draft owned/draft-capable operations, dummy draftless/unfinished operations and explicitly off unavailable media. No preset may encode live. Do not add nonexistent new plugins.
- [ ] R5. Document exact generation flags auto_publish=true, publish_preset=daily-ai-voice-migration and publish_dummy=true for rehearsal, plus the deliberate operator changes for a later real launch. Preserve accepted zh-only scope and list locale loss.
- [ ] R6. Produce reviewable schedule/runbook artifacts only; do not edit .spur/config.yaml scheduled jobs, install crontab/launchd, sync installed package code or run a real publication. Provide rollback instructions retaining voice2.
- [ ] R7. Declare voice3 launch var publish_live_channels with empty default and forward it only to nested publish3 live_channels. Explicit live launches preserve send-confirm pause/resume; defaults and preset/config values never imply live consent.

### Acceptance Criteria

- [ ] AC1 — Rendered migration schedules resolve the correct bundle and approval model (req: R1, R2, R3, R4, R5, R6, R7)

Given the current checkout and the isolated fixture conditions in Design, when the listed success/failure/replay cases run through the actual owned seam, then every R-item is observed through receipts, store state, artifact bytes and process/run status. Verification owner: this task's implementer; final cross-task rehearsal belongs to the rehearsal task. Concrete cases: Rendered commands through cron-percent parser; configured works root with spaces; today/yesterday date; PDT/PST CN target; missing bundle; mismatched date; exact CN token set; live launch stops for resume; auto_publish rehearsal path; migration preset operation inventory; no actual scheduler mutation.

### Q&A

Closed decisions (2026-10-25):
- Scope: implement the local correction described here; production publishing, scheduler installation and installed-package syncing remain separate operator actions.
- Compatibility: preserve voice2 and kk-itc behavior unless this task explicitly provides a voice3-only opt-in.
- Decisions D1-D4 remain accepted; Chinese-only parity is intentional and manual live confirmation is retained. Unsupported operations stay explicit dummy/off, never implicit live.
- Dependencies: 0329, 0330, 0332; handoff contracts and exact owned paths are in Design. No unresolved architecture or scope question remains for the implementer.
- Source audit findings owned here: F08, F09, F10, C01, C02, C03, C04, C05. Failure cases must precede production edits; evidence uses isolated local fixtures.

### Design

**Ownership:** plugins/kk/workflows/kk-daily-ai-voice3.yaml (launch variable forwarding only); plugins/kk/schedules/kk-daily-publish3-*.cron.tmpl; apps/cli/src/commands/schedule.ts; plugins/kk/publish-presets/daily-ai-voice-migration.json (new); plugins/kk/scripts/voice3-publish-window.ts (new launcher if needed); apps/cli/tests/commands/schedule.test.ts or existing schedule test owner; docs/design/kk-daily-ai-voice3.md; docs/04_DESIGN.md. Own only this behavior; do not revert others' edits.

Depend on generation's kk-daily-ai-voice3 root and delivery's date normalization. Reuse resolveWorksDir/config precedence and existing kk schedule render; add kk-daily-ai-voice3 as a render target, not a new scheduling service. A checkout launcher, if used, is plugins/kk/scripts/voice3-publish-window.ts and receives --window and --run-date; it computes JSON with JSON.stringify rather than shell concatenation and rejects bundle/date mismatch before starting Spur. Keep cn peak 09:00 Asia/Shanghai and overseas 07:00 America/Los_Angeles unless a documented existing design says otherwise. The generation schedule carries auto_publish=true; defaults stay safe and no launch bypasses send-confirm. Migration preset stable ids identify operations; WeChat article/audio and XHS podcast may stay real draft only where supported, X/Threads short posts and unsupported long operations are dummy, unavailable media is off. Full dummy rehearsal uses publish_dummy=true. Chinese-only replacement is accepted D3, not an unresolved implementation decision. No production schedule activation is part of this task. Handoff: integration executes rendered commands with recording binaries and a configured works root containing spaces; future operator receives concrete artifacts to authorize. Rejected: changing a live scheduler job during implementation, hard-coded ~/ paths, adding live to preset schema, silently skipping live confirmation.

**Dependencies:** 0329, 0330, 0332. Dependency edges are persisted in frontmatter.

**Inbound handoff:** 0329 — Fresh voice3 runs select current items and freeze complete validated bundles; 0330 — Draft and dummy launches never publish live on any selected operation; 0332 — Window sends bind receipts and RSS proof to one bundle revision.

**Outbound handoff:** 0335 — Offline migration rehearsal proves the complete voice3 replacement contract.

**Execution scope:** This task specifies local implementation when delegated. The filing itself performed planning only. Shared-file tasks must respect these edges; independent initial tasks may run in separate worktrees.

**Batch order:** 0329 and 0330 may start independently; 0331 follows both; 0332 follows 0331; 0333 and 0334 follow 0332; 0335 follows both. Transitive prerequisites remain binding.

**Non-goals:** Operator request: file every migration finding as implementation-ready work for later delegation; do not implement or activate production in this filing. Source audit: .spur/reports/voice3-migration-review-2026-10-25.md. G15 is reopened for corrective work; original completed tasks remain history. Accepted decisions D1-D4 in docs/design/kk-daily-ai-voice3.md remain authoritative: split generation/publication, preset ownership, Chinese-only output, three windows. No new channels, locale pipeline, dependencies or toolchains. No changes to voice2 production scheduling, live credentials, installed packages, .env files or .github/workflows. Preparation of launchers/runbooks is in scope; installing schedules, publishing or changing production configuration needs separate explicit authorization.

**Failure-first matrix:** Rendered commands through cron-percent parser; configured works root with spaces; today/yesterday date; PDT/PST CN target; missing bundle; mismatched date; exact CN token set; live launch stops for resume; auto_publish rehearsal path; migration preset operation inventory; no actual scheduler mutation.

Verification contract: enumerate failure cases and create behavior/E2E regression checks BEFORE changing production code; no post-hoc unit tests. Use bun:test, the real Spur DAG dispatcher, deterministic fixture generators/transports and intercepted HTTP; no provider/model calls, credentials, browser publication or live store access. Write observed evidence to .works/tmp/test-voice3-migration/0334/summary.json (and referenced logs/receipts), deriving the summary from assertions rather than hard-coded prose. Focused tests may exit 1 from per-file coverage; distinguish that from assertion failures. Final implementation gates: bun run lint, bun run test, bun run build, and project rule presets through bun run test-pre-check / bun run test-post-check; record actual exit codes. Update docs/04_DESIGN.md with changed surfaces in the same implementation change, following docs/99_PROJECT_CONSTITUTION.md and ADR-022/ADR-031. No implementation PASS is asserted by this planning task.

**Frozen live launch handoff:** Add publish_live_channels: "" to voice3 launch vars and forward it verbatim to nested publish3 live_channels. It is launch-only, never a config/preset default. The production runbook must choose either an initial explicit live owned launch followed by manual send-confirm resume, or remote operator reconciliation of an existing real draft. It must not draft first and then assume the receipt can silently promote to live; 0332 deliberately refuses that unsafe reuse. Rehearsal launch remains auto_publish=true, publish_preset=daily-ai-voice-migration, publish_dummy=true, publish_live_channels empty.

### Plan

- [ ] Step 0 — Inspect worktree/status and owning task dependencies; read cited current code and ADR-022/031; preserve concurrent edits and identify checkout-bound CLI runner.
- [ ] Step 1 — Before production edits, add failing E2E/behavior cases for R1-R7: Rendered commands through cron-percent parser; configured works root with spaces; today/yesterday date; PDT/PST CN target; missing bundle; mismatched date; exact CN token set; live launch stops for resume; auto_publish rehearsal path; migration preset operation inventory; no actual scheduler mutation.
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
- Dependencies: 0329, 0330, 0332.
- Batch map and readiness evidence: .spur/reports/voice3-task-plan/handoff.md and readiness.json.
- Code/test targets and observable failure matrix: Design.

### History
