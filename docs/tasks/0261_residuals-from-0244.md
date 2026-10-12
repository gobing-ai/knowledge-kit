---
schema_version: 1
name: Residuals from 0244
status: backlog
template: standard
created_at: 2026-10-12T06:39:09.010Z
updated_at: "2026-10-12T06:39:09.776Z"

---

## 0261. Residuals from 0244

### Background

Source task: 0244 (feature E94) — deferred residuals filed by residual-scan settle (unlinked: a deferral must not hold the completing feature open).

- review-finding:c7a66838 — plugins/publishings/weibo-pub/src/index.ts:54: Every selector ladder in this plugin is **provisional**: the 头条文章 editor URL, the `保存草稿` label and all composer/feed selectors come from the filed design, not from a measured live session. A wrong selector fails closed (a loud refusal naming the step and deadline, never silent success), but the article half of R2/R4 cannot be called live-verified. Owner and follow-up already exist: task 0246 measures and pins them, and re-scopes the article half through `spur feature update` if no draft control is found.

### Requirements

<!-- One R-item per line, exactly `- [ ] R1. <text>` (checkbox + `R<n>.`); `spur task check` flags any other form. Keep empty until requirements are known. -->

### Acceptance Criteria

<!-- Number items AC1, AC2, … (never R<n> — that is the Requirements namespace). Preferred: `Scenario: AC1 — <concrete outcome> (req: R1)` blocks with Given/When/Then, declaring both `ac_altitude: task-local` and `ac_numbering: task-local` for task-local regression criteria (altitude skips only the feature-subset check; numbering makes `(req: R<n>)` count toward requirement coverage). Parsed checkbox rows `- [ ] AC1 — <title>` are supported but never bind requirements — only `Scenario:` titles read `(req: R<n>)`. Bare `- AC1` bullets are legacy unparsed records, not a traceability bypass. Requirements use `- [ ] R1. <text>`, checked at close. Keep empty if this task has no objective AC yet. -->

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

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
