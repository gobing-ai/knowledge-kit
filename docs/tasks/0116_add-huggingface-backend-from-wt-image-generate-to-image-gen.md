---
schema_version: 1
name: Add huggingface backend from wt-image-generate to image-gen
status: todo
template: feature-impl
created_at: 2026-09-11T16:54:52.908Z
updated_at: "2026-09-11T16:55:17.924Z"
feature_id: K

---

## 0116. Add huggingface backend from wt-image-generate to image-gen

### Background

wt-image-generate (cc-agents, Python `scripts/image_generator.py`) has a HuggingFace Inference backend; union coverage wants it in kk image-gen.

### Requirements

- R1. Add a `huggingface` registry row (`HUGGINGFACE_API_TOKEN`, default model + `AUTO_ORDER` placement per baoyu/baoyu-frozen order rules) and an adapter ported from wt's `HuggingFaceBackend.generate()`.
- R2. Mocked-fetch tests mirroring wt's request/response shape.
- R3. wt plugin keeps its own runtime (Python skill untouched) — no behavioral coupling beyond the shared backend contract.

#### Acceptance Criteria
```gherkin
Scenario: R1 — huggingface is first-class
  Given HUGGINGFACE_API_TOKEN is set and other provider keys absent
  When a generation runs
  Then huggingface is selected and emits bytes via the wt-derived wire call
```

### Acceptance Criteria

```gherkin
Scenario: R1 — huggingface is first-class
  Given HUGGINGFACE_API_TOKEN is set and other provider keys absent
  When a generation runs
  Then huggingface is selected and emits bytes via the wt-derived wire call
```

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

- 2026-09-11T16:55:17.924Z backlog → todo (system)

