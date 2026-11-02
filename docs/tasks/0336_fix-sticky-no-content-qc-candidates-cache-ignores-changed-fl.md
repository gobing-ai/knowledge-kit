---
schema_version: 1
name: "Fix sticky no-content: QC candidates cache ignores changed floor vars"
status: backlog
template: standard
created_at: 2026-10-26T01:00:06.595Z
updated_at: "2026-10-26T01:01:00.294Z"

---

## 0336. Fix sticky no-content: QC candidates cache ignores changed floor vars

### Background

Captured from the creation title: "Fix sticky no-content: QC candidates cache ignores changed floor vars".

### Requirements

<!-- One R-item per line, exactly `- [ ] R1. <text>` (checkbox + `R<n>.`); `spur task check` flags any other form. Keep empty until requirements are known. -->

### Acceptance Criteria

## Evidence

2026-10-25 daily run: 04:30 PDT refused no-content (2-item pool, 8.6 min est < 15 min floor). Re-runs with runtime overrides (`spur workflow run --vars '{"episode_min_minutes":"8"}'`) at 15:52 and 22:52Z STILL refused — trace shows `candidates cached` and run-report replayed the morning's "below the 15 min floor" text with the NEW pool (3).

Root cause: `dailyQcContent` (plugins/kk/scripts/daily-stages.ts ~line 136) short-circuits on `isFile(candidates)` — the EMPTY/kept-2 candidates file written by the refusal is reused verbatim regardless of new vars/pool; `dailyPlan` does the same on `_03_plan_content.json`. A refused day is sticky until an operator deletes `21-plan/<date>_03_plan_content.json` + `_04_quality-control-content_*`.

Manual workaround applied 2026-10-25: cleared the 6 artifacts, re-ran with `episode_min_minutes=8`, extract took a fresh 24h pool of 3 (14.6 min) and QC passed ("estimated 11.7 min from 2576 chars — above the 8 min floor").

## Acceptance Criteria

- Re-running the workflow after a floor refusal, with changed `episode_min_minutes` or a changed pool, re-evaluates plan+QC instead of replaying the refusal.
- The cache key includes the inputs that determine the outcome (pool digest + QC thresholds + floor), or a `--force`/fresh flag exists and is documented in the daily runbook.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Chosen approach, key tradeoffs, invariants, and impacted surfaces. Keep snippets short. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Root Cause

2026-10-25 daily run: 04:30 PDT refused no-content (2-item pool, 8.6 min est < 15 min floor). Re-runs with runtime overrides (`spur workflow run --vars '{"episode_min_minutes":"8"}'`) at 15:52 and 22:52Z STILL refused — trace shows `candidates cached` and run-report replayed the morning's "below the 15 min floor" text with the NEW pool (3).

Root cause: `dailyQcContent` (plugins/kk/scripts/daily-stages.ts ~line 136) short-circuits on `isFile(candidates)` — the kept-2 candidates file written by the refusal is reused verbatim regardless of new vars/pool; `dailyPlan` does the same on `_03_plan_content.json`. A refused day is sticky until an operator deletes `21-plan/<date>_03_plan_content.json` + `_04_quality-control-content_*`.

Manual workaround applied 2026-10-25: cleared the 6 artifacts, re-ran with `episode_min_minutes=8`, extract took a fresh 24h pool of 3 (14.6 min) and QC passed ("estimated 11.7 min from 2576 chars — above the 8 min floor").

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History
