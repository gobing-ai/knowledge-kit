---
template: standard
schema_version: 1
name: "Harden karakeep-local: fail loud on zero-doc ingest and create --out parent dir"
description: ""
status: backlog
type: task
profile: standard
feature_id: null
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: "2026-08-02T23:29:27.561Z"
updated_at: "2026-08-02T23:29:58.652Z"
---

## 0029. Harden karakeep-local: fail loud on zero-doc ingest and create --out parent dir

### Background



### Requirements
- R1. Decide and document the empty-result contract, then fail loud when a non-empty source yields zero ingestible docs. Current behavior (`plugins/karakeep-local/src/index.ts:114-116`): a JSON entry missing string `body` logs a console warning and is skipped, so an all-rejected source exits 0 with `docs.json: []` — and the B5 chain then published a "No documents provided" Notice with `ok: true` (found in 0027 re-audit). A legitimately empty directory may stay a success; an all-rejected non-empty source must exit non-zero with a clear error.
- R2. Create the `--out` parent directory before writing (`plugins/karakeep-local/src/index.ts:149` — ENOENT on a fresh work dir; surfdash-pub already does this at `plugins/surfdash-pub/src/index.ts:164-167`).
- R3. Regression tests for both behaviors (all-rejected source fails loud; missing out dir is created); `bun run spur-check` green.
### Acceptance Criteria

<!-- Given/When/Then scenarios or a checklist derived from Requirements. Keep empty if this task has no objective AC yet. -->

### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design

<!-- Chosen approach, key tradeoffs, invariants, and impacted surfaces. Keep snippets short. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History
