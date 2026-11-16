---
schema_version: 1
name: Detect a stale loaded schedule in the running sync server
status: todo
template: issue
created_at: 2026-11-16T04:12:25.873Z
updated_at: "2026-11-16T04:12:45.230Z"

---

## 0382. Detect a stale loaded schedule in the running sync server

### Background

Observed 2026-11-15 on the production host during task 0376's scheduled-day observation.

The 04:30 `kk-daily-ai-voice` and 07:00 `kk-daily-publish3` ticks both issued
`bun scripts/daily-ai-news.ts …` and died with `error: Module not found "scripts/daily-ai-news.ts"` — a file that no
longer exists in the tree. `.spur/config.yaml` had already been updated to the `kk news` verbs (task 0373), but the
`spur self serve` process that served those ticks was started before that edit and kept the schedule it read at
startup. The server now running started at 16:16:30 (the config's own mtime), so the current schedule was never
exercised until the next day's tick — one lost production day, discovered only by reading `queue_jobs` afterwards.

Nothing in the system compared what the server holds against what the file says. The failure was silent at tick time
(a 15-minute timeout budget answered in seconds) and the operator only saw it as "no episode today".

Required shape: a deterministic, sub-second check that the loaded schedule agrees with the on-disk config (and that
each job's command entry point exists), surfaced at server start and available to a pre-tick caller, plus an explicit
preflight failure for a payload whose entry point is missing.

### Requirements

- [ ] R1. `spur self serve` reports at startup when the schedule it loaded disagrees with `.spur/config.yaml` on disk, naming the drifted job, the field and the file it read — refusing to start under a strict flag, warning otherwise.
- [ ] R2. Each scheduler tick runs a preflight that fails fast, naming the missing path, when its payload command references an entry point absent from the tree (no 15-minute timeout burned, no silent no-op).
- [ ] R3. The check is deterministic, model-free and under a second; when it cannot run it reports `unknown` instead of passing silently.
- [ ] R4. A regression test pins the 2026-11-15 incident: a config naming a deleted script fails the check, and a congruent config passes.

### Acceptance Criteria

<!-- Number items AC1, AC2, … (never R<n> — that is the Requirements namespace). Preferred: `Scenario: AC1 — <concrete outcome> (req: R1)` blocks with Given/When/Then, declaring both `ac_altitude: task-local` and `ac_numbering: task-local` for task-local regression criteria (altitude skips only the feature-subset check; numbering makes `(req: R<n>)` count toward requirement coverage). Parsed checkbox rows `- [ ] AC1 — <title>` are supported but never bind requirements — only `Scenario:` titles read `(req: R<n>)`. Bare `- AC1` bullets are legacy unparsed records, not a traceability bypass. Requirements use `- [ ] R1. <text>`, checked at close. Use a regression scenario proving the bug is fixed. -->

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

<!-- Fix approach and tradeoffs. Keep this short unless the issue changes architecture. -->

### Plan

<!-- Ordered debugging/fix checklist. Fill before moving to todo/wip. -->

### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History
