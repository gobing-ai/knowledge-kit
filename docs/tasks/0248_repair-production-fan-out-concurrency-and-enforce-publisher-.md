---
schema_version: 1
name: Repair production fan-out concurrency and enforce publisher process deadlines
status: todo
template: feature-impl
created_at: 2026-10-10T07:14:32.123Z
updated_at: "2026-10-10T07:16:02.092Z"
feature_id: B6

priority: P1
ac_numbering: task-local
ac_altitude: task-local
estimate_hours: 4
---

## 0248. Repair production fan-out concurrency and enforce publisher process deadlines

### Background

Review finding F1 (P1, correctness/efficiency), confirmed 2026-10-10. Production fan-out blocks the event loop in apps/cli/src/fanout.ts:431, despite the concurrent pool and timeout race at apps/cli/src/fanout.ts:135. Two real publisher fixtures each sleeping 250ms, with --target-timeout 50, returned exit 0 / two published outcomes after 591ms; their start/end stamps did not overlap. Evidence: .spur/run/review-repro.json in review run dev-review-packages-and-4-a71c. No existing non-terminal task owns this defect. The review separately fixed probe verdict mismatch in apps/cli/src/invoke.ts:241; preserve it. Feature B6 was reopened because dispatch, aggregation and retry remain its owned surface.

### Requirements

- [ ] R1. Production pluginDispatch uses the existing spawnPluginEntryAsync seam in apps/cli/src/invoke.ts:371 so independent publishers overlap, while jobs, serial and serialTargets preserve their documented scheduling.
- [ ] R2. Forward the per-target budget into the production spawn, terminate/reap its owned process tree on timeout, and await completion before reading or deleting its temporary output. A timed-out target fails with its name and budget; siblings still finish.
- [ ] R3. Preserve ordered aggregation, failure exit codes, Result validation, metadata round-trip, retry skipping and temporary-file cleanup.
- [ ] R4. Add offline real-process regression coverage in apps/cli/tests/fanout.test.ts and run bun run gate; no external publishers or credentials.

### Acceptance Criteria

- [ ] AC1. Two real fixture publisher processes overlap with jobs=2; jobs=1, --serial and --serial-target fixtures do not overlap when their scheduling requires isolation. (req: R1)
- [ ] AC2. A hanging fixture that spawns a child is terminated within its budget plus bounded reaping overhead, leaves no live owned descendant or late output, and yields one failed entry while a fast sibling succeeds. (req: R2)
- [ ] AC3. Existing order, retry, metadata and invalid-Result cases remain green; temporary outputs are removed after success and failure; the project gate passes. (req: R3) (req: R4)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Use the existing asynchronous spawn seam, matching collectSourceDocs in apps/cli/src/fanin.ts:284. Thread targetTimeoutMs from runFanout into pluginDispatch and pass it as timeoutMs; inspect timedOut and report a named timeout. Ensure the production timeout waits for subprocess termination/reaping before cleanup; do not let the generic Promise.race settle production dispatch before cleanup is safe. Keep the injected async-dispatch timeout behavior for existing callers, but avoid a competing race for owned subprocesses (apply the generic race only to injected dispatch if needed). Read Result only after the child completes. Keep cleanup in finally. Tests must invoke runFanout without deps.dispatch and generate local sleeping/hanging publisher fixtures, recording timestamps/markers rather than relying on total runtime alone. Reuse the invoke cancellation test pattern for descendant checks. Rejected: keeping spawnSync and changing pool size (cannot overlap or run timers), or Promise.race alone (leaves side effects running after a reported timeout). Targets: apps/cli/src/fanout.ts, apps/cli/tests/fanout.test.ts; apps/cli/src/invoke.ts and its tests only if the existing completion/reaping guarantee requires a bounded adjustment. Out of scope: workflow-engine concurrency, new flags, generic process framework, actual publishing. No new dependency or public schema. Existing ADR-007/019 execution boundaries govern; update owning surface docs only if documented behavior needs correction.

### Plan

- [ ] 1. Reproduce with real-process fixtures and add failing overlap, scheduling and descendant-timeout assertions.
- [ ] 2. Thread the budget to asynchronous production dispatch and keep validation/cleanup after owned process completion (R1/R2).
- [ ] 3. Verify aggregate/retry/metadata compatibility and cleanup with the existing suite (R3).
- [ ] 4. Run targeted tests, bun run gate, and record evidence (R4).

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- apps/cli/src/fanout.ts:431 — blocking production spawn.
- apps/cli/src/invoke.ts:371 — existing async spawn seam.
- apps/cli/src/fanin.ts:284 — async caller pattern.
- docs/03_ARCHITECTURE.md:267 — execution boundary integrity.
- Review run dev-review-packages-and-4-a71c, .spur/run/review-repro.json.
- Feature B6; ADR-007 concurrency amendment and ADR-019.

### History

- 2026-10-10T07:15:49.444Z backlog → todo (system)

