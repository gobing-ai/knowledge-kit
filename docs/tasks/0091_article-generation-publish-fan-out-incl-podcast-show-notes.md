---
schema_version: 1
name: "Article generation + publish fan-out incl. podcast show notes"
status: todo
template: feature-impl
created_at: 2026-09-03T04:21:27.667Z
updated_at: "2026-09-03T04:24:45.205Z"
feature_id: K
dependencies: ["0088"]
---

## 0091. Article generation + publish fan-out incl. podcast show notes

### Background

**Type:** `wayfinder:research` — evidence reading; no production code. Map: feature K. Blocked by 0088 (needs the gap plan).

**Sharp question:** which generator produces the templated article from core facts (extend `content-gen` vs new `article-gen`), which publish plugins cover the target platforms, can `podcast-pub` carry the article as episode show notes (decided on map K: yes, as show notes — verify the target platform supports it), and what fan-out shape does `docs/design/fan-in-and-fan-out-specification.md` prescribe?

**Note:** the article-platform list beyond surfdash is **Open question 1** on map K — proceed with shipped plugins (`surfdash-pub`, `emdash-pub`, `qiita-pub`, `zenn-pub`) and flag the open list rather than blocking on it.

### Requirements

- [ ] R1. Article generator home decided (extend `content-gen` vs new plugin) with the template approach named.
- [ ] R2. `podcast-pub` show-notes capability verified against its target platform; the gap named if missing.
- [ ] R3. Publish fan-out shape recommended (one kk fan-out subcommand vs sequential states) with a platform-coverage matrix vs shipped plugins.

### Acceptance Criteria

- [ ] R1–R3 answered with file-level evidence in `## Solution`.
- [ ] Open platform list explicitly flagged as pending operator decision.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

n/a — research ticket. Output is evidence + recommendation in `## Solution`.

### Plan

- [ ] Read `content-gen` + publish-plugin specs + `podcast-pub` transport.
- [ ] Verify show-notes support on the podcast target platform.
- [ ] Build platform-coverage matrix; recommend fan-out shape.
- [ ] Write `## Solution`; append gist line to map K Decisions so far.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
