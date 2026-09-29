---
schema_version: 1
name: Compose xhs-card text with real type at the declared canvas
status: backlog
template: feature-impl
created_at: 2026-09-29T02:28:56.039Z
updated_at: "2026-09-29T02:29:52.539Z"
feature_id: F616

---

## 0180. Compose xhs-card text with real type at the declared canvas

### Background

Captured from the creation title: "Compose xhs-card text with real type at the declared canvas".

### Requirements

- [ ] R1. Card copy is set with a real font by a deterministic text engine; no image-generation provider receives the on-card copy.
- [ ] R2. The composed card is exactly the declared 1080x1440 portrait canvas, with text inside a bounded safe area and a minimum rendered glyph size.
- [ ] R3. Identical input yields identical output, so a recorded artifact is reused on resume.
- [ ] R4. Copy containing a character absent from the font fails loud naming the character — never tofu or a silent substitute.

### Acceptance Criteria

- [ ] AC1 — Card copy is set with real type, not generated pixels (req: R1)
- [ ] AC2 — The declared canvas is the delivered canvas (req: R2)
- [ ] AC3 — Composition is deterministic and resumable (req: R3)
- [ ] AC4 — Missing font coverage fails loud (req: R4)

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
