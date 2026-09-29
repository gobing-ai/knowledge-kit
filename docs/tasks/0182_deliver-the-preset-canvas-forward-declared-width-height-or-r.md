---
schema_version: 1
name: "Deliver the preset canvas: forward declared width/height or record the delivered size"
status: backlog
template: feature-impl
created_at: 2026-09-29T02:28:56.497Z
updated_at: "2026-09-29T02:31:39.341Z"
feature_id: F618

---

## 0182. Deliver the preset canvas: forward declared width/height or record the delivered size

### Background

Captured from the creation title: "Deliver the preset canvas: forward declared width/height or record the delivered size".

### Requirements

- [ ] R1. Declared preset dimensions reach a provider whose API accepts an explicit size, and the emitted artifact matches them.
- [ ] R2. For a provider that accepts only an aspect ratio, the delivered artifact size is recorded so a preset cannot silently claim a canvas.
- [ ] R3. The measured `xhs-card` regression is pinned: 1080x1440, not 864x1152.

### Acceptance Criteria

- [ ] AC1 — A declared preset canvas reaches the provider (req: R1)
- [ ] AC2 — A provider that cannot honour the canvas is honest about it (req: R2)
- [ ] AC3 — The measured regression stays fixed (req: R3)

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
