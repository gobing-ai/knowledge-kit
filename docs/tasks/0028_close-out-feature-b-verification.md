---
template: feature-impl
schema_version: 1
name: "Close out feature B verification"
description: ""
status: todo
type: task
profile: standard
feature_id: B
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: "2026-08-02T23:29:27.421Z"
updated_at: "2026-08-02T23:29:58.521Z"
---

## 0028. Close out feature B verification

### Background



### Requirements
- R1. Repair verdict artifacts for `0003`/`0004`/`0005`: add `acceptanceCriteria` rows whose ids match feature scenario titles (status MET, evidence from their existing Testing sections) — currently `L4.scenario-unverified` under B's rollup (same shape defect fixed in 0024/0025/0026/0027).
- R2. Resolve B's uncovered rollup scenarios so `spur feature check B` reports zero uncovered findings: B4 copies ("List shows discovered plugins", "Doctor surfaces discovery diagnostics", "Plugins root is consistent with invoke", "Surface is documented in the same commit"), B5 copies ("R1 — Vertical run publishes Surfdash from Karakeep-local", "R2 — Acceptance is platform composition, not a new plugin kind"), and B-own R1–R3 (discovered-and-invoked E2E, three kinds compose, orchestration in spur workflow). Coverage is title-matched against AC of tasks with `feature_id: B`; the B4/B5 work lives in 0020/0021/0026/0027 (linked to B4/B5). Pick the DD-09-sanctioned resolution (do not repoint feature_id away from B4/B5).
- R3. Transition B `verifying → done` via `spur feature update B done` with the guard passing — no bypass, no guard weakening.
### Acceptance Criteria

<!-- Copy or derive real scenarios from the linked feature. Do not leave placeholder AC here. -->

### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

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

B

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
