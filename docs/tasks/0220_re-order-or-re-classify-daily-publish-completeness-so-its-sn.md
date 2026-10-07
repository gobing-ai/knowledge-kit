---
schema_version: 1
name: Re-order or re-classify daily publish-completeness so its snapshot reflects finished channels
status: backlog
template: feature-impl
created_at: 2026-10-07T22:09:50.052Z
updated_at: "2026-10-07T22:12:02.304Z"
feature_id: F61

---

## 0220. Re-order or re-classify daily publish-completeness so its snapshot reflects finished channels

### Background

Captured from the creation title: "Re-order or re-classify daily publish-completeness so its snapshot reflects finished channels".

### Requirements

- [ ] R1. Decide and document the ordering contract: either move the classify stage after the locales/patch/sync stages (late snapshot), or keep the early snapshot and emit a second terminal classification before `done`.
- [ ] R2. Implement the chosen contract in `kk-daily-ai-voice.yaml` (+ stage code if the terminal classification needs new inputs); the completeness json and warning must reflect channels that actually ran by snapshot time.
- [ ] R3. A unit test pins the ordering contract: with locale/sync artifacts present, the final snapshot records them as run; absent artifacts still warn.
- [ ] R4. Docs: the completeness behavior row in `docs/04_DESIGN.md` / `docs/design/kk-daily-ai-voice.md` updated in the same commit (T3).

### Acceptance Criteria

AC1. On a fixture work dir with 20_/23_/24_ artifacts present, the terminal completeness snapshot marks locales and cms-resync as run; removing them flips the fields and the warning.
AC2. No successful run emits a `not-run` warning for a channel whose artifact exists at snapshot time.
AC3. `bun run lint` and both stage test suites pass.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

`bun test plugins/kk/tests/kk-workflow-stages.test.ts` + `bun run lint`; ordering verified by artifact mtime comparison on a fixture (mtimes, not wall-clock assumptions).

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
