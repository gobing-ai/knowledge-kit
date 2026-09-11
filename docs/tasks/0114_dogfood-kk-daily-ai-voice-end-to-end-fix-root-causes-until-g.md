---
schema_version: 1
name: Dogfood kk-daily-ai-voice end-to-end; fix root causes until green
status: todo
template: feature-impl
created_at: 2026-09-11T05:55:57.578Z
updated_at: "2026-09-11T05:56:27.624Z"
feature_id: N
priority: P2
tags:
  - kk
  - dogfood
  - workflows

---

## 0114. Dogfood kk-daily-ai-voice end-to-end; fix root causes until green

### Background

The adapted workflow must be driven as a real user once, both without the image gate (regression) and through the cover state, fixing any root causes (e.g. envelope schema, env visibility into skill, artifact naming) and re-running until the full run passes.

### Requirements

- R1. Run the workflow end-to-end via the harness (kk executor / workflow run per the runbook) with cover_enabled=true and modest limits.
- R2. Triage every failure to root cause; fix at the seam that owns it (workflow YAML in-repo; skill/parser issues reported upstream in-repo too).
- R3. Re-run after each fix; iterate within a bounded retry policy, no loop without change.
- R4. Record the green run evidence (logs/artifacts) and any fixes in the task.

### Acceptance Criteria

```gherkin
Scenario: R1 — dogfood run exercises the non-interactive cover contract
    Given the adapted workflow is driven end-to-end with cover_enabled=true
    When the cover state executes
    Then the skill runs non-interactively and the artifact normalization produces the canonical cover file

  Scenario: R2 — root causes are fixed at the owning seam and evidence recorded
    Given every failure tripped during the run
    When triage completes
    Then each is fixed at root cause in the owning file and the fix is recorded in the task with re-run evidence

  Scenario: R3 — final full run is green
    Given all fixes applied
    When the workflow is re-run
    Then the run completes PASS with the cover artifact present and no skipped gates
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

1. Smoke-cover-only dry check of the new state. 2. Full run. 3. Root-cause + fix failures. 4. Re-run to green. 5. Record verify PASS evidence.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
