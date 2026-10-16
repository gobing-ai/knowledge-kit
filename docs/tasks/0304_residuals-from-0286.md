---
schema_version: 1
name: Residuals from 0286
status: backlog
template: standard
created_at: 2026-10-16T16:55:00.112Z
updated_at: "2026-10-16T16:55:00.166Z"

---

## 0304. Residuals from 0286

### Background

Source task: 0286 (feature G9) — deferred residuals filed by residual-scan settle (unlinked: a deferral must not hold the completing feature open).

- review-finding:39618d88 — plugins/kk/skills/smart-seo/references/seo-geo-sources.md:15 vs plugins/kk/scripts/seo-report.ts:452, plugins/kk/scripts/seo-rules.ts:486, plugins/kk/scripts/seo-rules.ts:1543: One shipped fact carries two dates: the new skill reference states FAQ rich results stopped appearing 2026-05-07 (Google Search updates changelog), while the shipped report/rules prose still says Aug/Sep 2023 — a reader of the skill and of `report.md` sees different retirement dates.

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
