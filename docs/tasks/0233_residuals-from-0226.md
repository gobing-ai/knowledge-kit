---
schema_version: 1
name: Residuals from 0226
status: backlog
template: standard
created_at: 2026-10-09T05:02:13.144Z
updated_at: "2026-10-09T05:02:13.374Z"

---

## 0233. Residuals from 0226

### Background

Source task: 0226 (feature G32) — deferred residuals filed by residual-scan settle (unlinked: a deferral must not hold the completing feature open).

- review-finding:e7189224 — packages/kk-store/src/dao/labels.ts:145: R4's model-row gate is a numeric comparison, so a **migrated** `source 'model'` row can never be current and its `(item, decision)` pair ends up with no current label. Every pre-v2 row is copied with the five raw columns as literal `NULL`s while `content_hash` is backfilled from `items` (`packages/kk-store/src/migrations.ts:153-159`), and `NULL >= 0.8` is not true — 0225 deliberately made migrated rows usable, but the threshold defeats that for model rows. Probed on a copy of the live store (68 items / 340 labels): 340/340 rows keep a `content_hash` yet only **320 are current**; the 20 exceptions are exactly the 12 `source 'model'` rows (plus the 8 `source 'default'` rows this rule refuses by design). Those pairs then have no current label, so a `where` predicate on that decision excludes the item (`packages/kk-store/src/dao/items.ts:252`) and only new/edited ids are ever re-labelled. The same gate refuses a **new** row whenever spur answers `source 'model'` with no numeric confidence — coherent with `labelConfidence('model', null) === 'LOW'`, but nowhere stated. R4's letter is implemented exactly; this is the letter meeting 0225's backfill.

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
