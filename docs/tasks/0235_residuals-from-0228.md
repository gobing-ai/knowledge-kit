---
schema_version: 1
name: Residuals from 0228
status: backlog
template: standard
created_at: 2026-10-09T06:36:29.876Z
updated_at: "2026-10-09T06:36:30.128Z"

---

## 0235. Residuals from 0228

### Background

Source task: 0228 (feature G32) — deferred residuals filed by residual-scan settle (unlinked: a deferral must not hold the completing feature open).

- review-finding:2f4d5156 — packages/kk-store/src/dao/selections.ts:143; duplicate rule at packages/kk-store/src/dao/items.ts:441; only callers are tests (packages/kk-store/tests/dao/selections.test.ts:91): `SelectionsDao.excludedStories` has **no production caller**: R4's exclusion is inline SQL inside `ItemsDao.selectByProfile`, so the accessor 0225 R6 handed over is kept alive only by its own DAO tests. It is the only uncovered code in this task's run (`dao/selections.ts` 93.33% lines / 81.82% funcs; `:143-150` uncovered). Either delete it or route the R4 `NOT EXISTS` through it, so the topic/story/status rule has one home rather than two.

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
