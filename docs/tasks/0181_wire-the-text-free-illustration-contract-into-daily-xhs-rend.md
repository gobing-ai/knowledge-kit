---
schema_version: 1
name: Wire the text-free illustration contract into daily-xhs-render and xhs-card
status: backlog
template: feature-impl
created_at: 2026-09-29T02:28:56.271Z
updated_at: "2026-09-29T02:29:52.724Z"
feature_id: F616

---

## 0181. Wire the text-free illustration contract into daily-xhs-render and xhs-card

### Background

Captured from the creation title: "Wire the text-free illustration contract into daily-xhs-render and xhs-card".

### Requirements

- [ ] R1. Every `image-gen` envelope the XHS flow builds carries a text-free prompt: no headline, bullet, or Chinese character from the card plan.
- [ ] R2. A composed card stays legible when the model illustration is absent, so the illustration is decoration, not a legibility dependency.
- [ ] R3. `daily-xhs-render` and the `kk:xhs-images` skill both use the composing path, so no caller can regress to model-rendered text.
- [ ] R4. The existing per-card artifacts (`cards.json`, `cards/NN.json`, `cards/NN.prompt.txt`) keep their order and resume semantics.

### Acceptance Criteria

- [ ] AC1 — The illustration layer stays text-free (req: R5)

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
