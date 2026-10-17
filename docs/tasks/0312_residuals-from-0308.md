---
schema_version: 1
name: Residuals from 0308
status: cancelled
template: standard
created_at: 2026-10-17T22:06:34.112Z
updated_at: "2026-10-17T23:54:01.944Z"

---

## 0312. Residuals from 0308

### Background

Source task: 0308 (feature G81) — deferred residuals filed by residual-scan settle (unlinked: a deferral must not hold the completing feature open).
- review-finding:7f4b5847 — apps/board/src/collect/index.tsx:349,300-312; apps/board/src/collect/panels.tsx:426,477-478: An out-of-range page renders a false empty claim. Switch runs while parked on page ≥ 2 and `itemFilters.page` survives (`index.tsx:349` changes `runId` only; `:300-312` reset the page only on a filter or pager click), the reader echoes `page` and refuses only `page=0`/an unknown `source` (`apps/cli/src/board/collect-store.ts:285-330`), so a 3-item run requested at page 2 renders **`No items match these filters.`** with no filter set and **`Page 2 of 1 · 3 items`** (reproduced by probe at `page=2, total=3, items=[]`). `Next` is correctly disabled, `Previous` is not — the operator can walk back, so it self-heals in one click. Fix: `page: 1` in the run selector's `onChange`. Pre-existing (the page state is not part of the fix under review).

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

Fixed directly in the G81 landing rather than deferred: the run selector now resets the page to 1 when the selected run changes, so an out-of-range page can no longer render a false "No items match these filters."
- 2026-10-17T23:54:01.944Z backlog → cancelled (system)

