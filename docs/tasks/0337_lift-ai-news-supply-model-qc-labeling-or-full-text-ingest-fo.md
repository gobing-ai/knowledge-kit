---
schema_version: 1
name: "Lift ai-news supply: model QC labeling or full-text ingest for stub items"
status: backlog
template: standard
created_at: 2026-10-26T01:00:07.141Z
updated_at: "2026-10-26T01:01:00.889Z"

---

## 0337. Lift ai-news supply: model QC labeling or full-text ingest for stub items

### Background

Captured from the creation title: "Lift ai-news supply: model QC labeling or full-text ingest for stub items".

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

### Root Cause

2026-10-25 diagnostic (replicated-SQL over .works/kk.db): 168h gate ladder 135 items → 104 in-category → 35 q≥2 → 35 i≥2 → 34 cp≤1 → only 2 pool-eligible (32/34 already published). Live insert rate is 1-10 per 6-hourly collect; today's fresh items are q1 link-out stubs (45-1,105 body_chars) because production labels heuristic-only (kk-collect.yaml:162 runs `kk store label` without `--mode decision`), so the quality≥2 gate kills them. Net pool of 2-3 vs episode floor 15 min (~4.3 min/item) → recurring no-content risk (2026-10-25 refusal) or forced floor overrides.

Options (owner decides):
1. Add a decision-mode label pass (`kk store label --mode decision`) in kk-collect for quality/importance dims — honest q2 for substantive digests; stubs stay q1 (correct).
2. Full-text ingest enrichment for link-out stubs (fetch the linked page, store real body) — fixes the root starvation; bigger feature.
3. Revisit `episode_min_minutes` default (15) vs realistic daily supply; 2026-10-25 shipped with a runtime override of 8.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History
