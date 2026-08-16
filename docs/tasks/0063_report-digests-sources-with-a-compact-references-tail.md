---
template: feature-impl
schema_version: 1
name: "Report digests sources with a compact references tail"
description: ""
status: todo
type: task
profile: standard
feature_id: C5
parent_wbs: null
priority: P2
tags: ["storm-research", "report-craft"]
dependencies: []
ac_numbering: task-local
created_at: "2026-08-16T03:35:23.269Z"
updated_at: "2026-08-16T03:35:23.270Z"
---

## 0063. Report digests sources with a compact references tail

### Background

Implements: C5 R6 — The generated report digests sources instead of indexing them; R7 — Render resolves the references tail to cached files.

Report-craft half of C5 (design D7, ADR-013): content-gen's STORM article-stage prompt mandates synthesis — the body draws findings from across the supplied documents rather than listing them one per line — and the render tail stops appending the ## Outline replay block (content.outline stays in content.json, dropped only in the markdown tail). The compact ## References list keeps its shape; cite ids resolve to references/<doc-id>.md cache files written by the ingest task. Applied to both copies of the render function: packages/kk-core/src/render-md.ts and the byte-identical plugins/kk/scripts/render-md.ts, kept in sync by the SYNC comment.

Runs in parallel with the ingest task; the SKILL.md doc task lands last.
Rubric: E2 D2 L2 C0 R0 = 6 → task (a prompt-only split was rejected: the content-gen edit alone is below the 2h floor, and the brainstorm pairs prompt + render tail as one reshape under D7).

### Requirements
- [ ] R1. content-gen STORM article-stage prompt mandates synthesis — findings drawn from across the supplied documents, not one line per source.
- [ ] R2. renderContentMarkdown stops appending the ## Outline replay block; content.outline remains in content.json.
- [ ] R3. The ## References tail stays compact and its cite ids resolve to references/<doc-id>.md cache files.
- [ ] R4. Apply the outline removal to both render copies (packages/kk-core/src/render-md.ts and plugins/kk/scripts/render-md.ts, keeping the SYNC comment) and cover R1–R3 with tests.
### Acceptance Criteria

<!-- Copy or derive real scenarios from the linked feature. Do not leave placeholder AC here. -->

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

C5

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
