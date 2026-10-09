---
schema_version: 1
name: Residuals from 0225
status: backlog
template: standard
created_at: 2026-10-09T03:50:52.352Z
updated_at: "2026-10-09T03:50:52.834Z"

---

## 0231. Residuals from 0225

### Background

Source task: 0225 (feature G32) — deferred residuals filed by residual-scan settle (unlinked: a deferral must not hold the completing feature open).

- review-finding:957489fb — migrations.ts:167: `0003`'s `episode_usage`→`selections` copy is a plain `INSERT … SELECT`: two v1 rows sharing `(item_id, run_id)` across workflows (legal under v1's `(item_id, workflow, run_id)` UNIQUE) collide on `(topic, item_id, run_id)` and `0003` aborts. Probed: `UNIQUE constraint failed: selections.topic, selections.item_id, selections.run_id`; rollback is clean (journal stays `0001+0002`, no data loss) but `openStore` then throws with no repair path in `kk store migrate`. Unreachable on the live store (0 rows).
- review-finding:fa5ba5fb — tests/migrations.test.ts:99,400-417: R3's builder↔migration parity is pinned on column **name + type** only (`tests/migrations.test.ts:99-109`; AC1 sorts columns), so `.notNull()` / `.default()` / order drift passes CI; nothing asserts post-migration `run_id` NOT NULL or that the 4-column UNIQUE rejects a raw repeat (both verified by probe, not by test).
- review-finding:be1640f8 — dao/items.ts:289: The selected/published exclusion predicate is written three times (`migrations.ts:129`; `dao/selections.ts:126-131`; `dao/items.ts:289-294`) and `SELECTION_STATUSES` is not the single vocabulary for the SQL sites.
- review-finding:756f3230 — migrations.ts:92 vs :129; schema/labels.ts:36; dao/labels.ts (toLabelRecord): The closed `HIGH\|MEDIUM\|LOW` vocabulary is not enforced at the storage boundary: `labels.confidence` has no CHECK while the same migration gives `selections.status` one, and `toLabelRecord` casts any string to `LabelConfidence`. Probed: `'BOGUS'` and `'high'` are accepted and returned as levels; the documented refuse-guard (`dao/labels.ts:24-30`) covers only `null`. `0003` is unreleased — the last cheap moment; suggested `CHECK ("confidence" IN ('HIGH','MEDIUM','LOW') OR "confidence" IS NULL)` with the legacy copy wrapped in a `CASE`.

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
