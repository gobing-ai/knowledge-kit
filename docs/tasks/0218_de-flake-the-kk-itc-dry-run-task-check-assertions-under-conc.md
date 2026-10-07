---
schema_version: 1
name: De-flake the kk-itc dry-run task-check assertions under concurrent load
status: backlog
template: feature-impl
created_at: 2026-10-07T20:52:27.448Z
updated_at: "2026-10-07T20:52:28.027Z"
feature_id: G2

---

## 0218. De-flake the kk-itc dry-run task-check assertions under concurrent load

### Background

Hit 2026-10-07 during G71's feature-verification pass on `main` (knowledge-kit), which recorded a FAIL receipt that was not a real regression.

The repo-wide gate reported:

```
(fail) kk-itc auto mode + revise loop + report (0149) > task check — the dry-run walk with auto=true reaches done [35104.36ms]
  ^ this test timed out after 30000ms.
```

A **timeout**, not an assertion failure: 35.1s against a 30s per-test limit. Two contextual signals say it is load-sensitive rather than broken — the whole gate took 363s in that run versus ~130s on the same tree inside an isolated worktree, and `main` was being edited concurrently at the time (several files dirty, an unrelated in-flight change to `packages/publish-harness` and two publish plugins). Re-running the same pass later produced the identical shape. The same test file has sibling cases that walk the same dry-run pipeline (`0149`, `0151`, `0152`), so whichever one is slowest will be the one that trips.

Impact: a feature's verification receipt records FAIL for an environmental flake. `feature check --strict --as done` then refuses a feature that is actually green, and the receipt must be re-produced on a quiet tree. This is the kind of red that trains people to ignore the gate.

### Requirements

- [ ] R1. Establish which of the itc dry-run walk cases actually consumes the time budget, with a measured breakdown (spawn + pipeline stages + assertions) rather than a guess.
- [ ] R2. Make the assertion robust to load rather than merely raising the limit: prefer asserting the reached terminal state over a wall-clock budget, or give the case an explicit, documented per-test timeout that reflects its real cost on a loaded machine.
- [ ] R3. If a raised timeout is the answer, state the measured headroom in the test so the next person can tell a slow run from a hung one.
- [ ] R4. Verify by running the gate while the repo is under concurrent use (the condition that exposed it), not only on an idle tree.

### Acceptance Criteria

<!-- Number items AC1, AC2, … (never R<n> — that is the Requirements namespace). Preferred: `Scenario: AC1 — <concrete outcome> (req: R1)` blocks with Given/When/Then, declaring both `ac_altitude: task-local` and `ac_numbering: task-local` for task-local regression criteria (altitude skips only the feature-subset check; numbering makes `(req: R<n>)` count toward requirement coverage). Parsed checkbox rows `- [ ] AC1 — <title>` are supported but never bind requirements — only `Scenario:` titles read `(req: R<n>)`. Bare `- AC1` bullets are legacy unparsed records, not a traceability bypass. Requirements use `- [ ] R1. <text>`, checked at close. Do not leave placeholder AC here. -->

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

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
