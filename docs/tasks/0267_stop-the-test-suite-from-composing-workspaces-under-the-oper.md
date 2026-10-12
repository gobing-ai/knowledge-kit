---
schema_version: 1
name: Stop the test suite from composing workspaces under the operator's home
status: todo
template: issue
created_at: 2026-10-12T21:45:47.258Z
updated_at: "2026-10-12T21:58:58.690Z"
feature_id: G11

ac_altitude: task-local
---

## 0267. Stop the test suite from composing workspaces under the operator's home

### Background

`apps/cli/src/commands/daily.ts` `prepareAction` composes `options.workDir || join(options.worksDir ?? resolveWorksDir(), options.workflow, dirDate)`, and `resolveWorksDir()` falls back to the compiled default `~/.config/kk/works` when neither `KK_WORKS_DIR` nor a config `works_dir` is present.

Observed on 2026-10-12 at 11:35 local, during a test run of the suite: an empty `~/.config/kk/works/kk-daily-ai-voice2/` directory appeared in the operator's home. It is the workflow child of that fallback, created by a test that exercises the daily prepare path without pinning `KK_WORKS_DIR`/`KK_CONFIG` to a temp dir. Nothing in the repo recreates the *date* child, so the artifact is a bare workflow directory — harmless in size, but it means tests write outside their sandbox into operator state, and any future prepare that gets one step further would compose a real run workspace there.

### Requirements

- [ ] R1. Find the test(s) that reach `prepareAction`/`resolveWorksDir` without pinning the works root, and isolate them (`KK_WORKS_DIR` or `KK_CONFIG` pointed at a temp dir, or an explicit `--work-dir`).
- [ ] R2. Leave the production fallback chain unchanged — `KK_WORKS_DIR` > config `works_dir` > `~/.config/kk/works` is the documented contract; the defect is the test, not the resolver.
- [ ] R3. Add a regression assertion that the suite creates nothing under the operator's home (a test that fails when the isolation is removed).
- [ ] R4. Remove the stray `~/.config/kk/works/kk-daily-ai-voice2` directory on this machine once the source is fixed, and state in the task's Testing section how it was verified absent again after a full suite run.

### Acceptance Criteria

- [ ] AC1 — A full `bun run test` leaves no new path under `$HOME/.config/kk/works`. (req: R1, R3)
- [ ] AC2 — The regression assertion fails when the isolation is removed and passes with it. (req: R3)
- [ ] AC3 — The production precedence chain is unchanged. (req: R2)

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
