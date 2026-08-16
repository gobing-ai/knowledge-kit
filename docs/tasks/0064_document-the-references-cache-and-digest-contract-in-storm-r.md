---
template: meta
schema_version: 1
name: "Document the references cache and digest contract in storm-research SKILL.md"
description: ""
status: todo
type: meta
profile: standard
feature_id: C5
parent_wbs: null
priority: P2
tags: ["storm-research", "docs"]
dependencies: []
ac_numbering: task-local
created_at: "2026-08-16T03:35:23.273Z"
updated_at: "2026-08-16T03:35:23.273Z"
---

## 0064. Document the references cache and digest contract in storm-research SKILL.md

### Background

Implements: C5 R8 — The works layout and skill document the references cache and digest contract.

Shipping obligation for C5 (design §0, §5, ADR-013): amend the storm-research SKILL.md 0056 tables — add the references/ works-layout row (written by ingest; audit trail + render-tail resolution target), the markitdown fail-loud row (live mode requires the binary), and the digest-don't-index practice under Better-report. Single owner of the SKILL.md file surface, keeping code diffs clean.

Lands last in the C5 batch — it documents the ingest and report-craft changes.
Rubric: E1 D1 L1 C0 R0 = 3 → task (kept: R8 is @core and needs AC coverage; folding it into a code task would mix docs into the code diff — rejected).

### Requirements
- [ ] R1. Add references/ to the 0056 works-layout table — written by ingest, consumed as audit trail and render-tail resolution target.
- [ ] R2. Record the markitdown fail-loud row — live mode requires the binary on PATH; missing → exit 1, no docs.json.
- [ ] R3. Add the digest-don't-index practice under Better-report — references are evidence, not the deliverable.
### Acceptance Criteria

<!-- Lightweight checklist or Given/When/Then if there is an observable completion condition. -->

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Approach and tradeoffs for process/docs/config changes. Keep this short. -->

### Plan

<!-- Ordered checklist. Fill before moving to todo/wip. -->

### Solution

<!-- Filled during implementation: changed files/sections and concise rationale. -->

### Testing

<!-- Filled during verification: commands/checks run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to docs, tasks, decisions, or external references. -->

### History
