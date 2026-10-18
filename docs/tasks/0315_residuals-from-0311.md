---
schema_version: 1
name: Residuals from 0311
status: cancelled
template: standard
created_at: 2026-10-18T01:12:57.921Z
updated_at: "2026-10-18T01:14:15.350Z"

---

## 0315. Residuals from 0311

### Background

Source task: 0311 (feature G21) — deferred residuals filed by residual-scan settle (unlinked: a deferral must not hold the completing feature open).

- review-finding:66972e40 — apps/cli/src/itc-publish.ts:352: R3's literal first clause ("no resolved config value appears in `itc-check-targets` stdout/stderr") is not met when the *probe* echoes the value in its `detail`: with the config value `http://plain.test`, the CLI printed `refused: error: substack publication URL must be https:, got 'http://plain.test'` — reproduced fresh this review. That passthrough is mandated by R4 ("the probe-authored `detail`") and carved out by R3's own parenthetical, and no shipped publish probe echoes a credential value (only key names: `plugins/publishings/qiita-pub/src/index.ts:126`, `plugins/publishings/emdash-pub/src/index.ts:293`), so nothing secret leaves the process; the over-broad clause is the defect, not the code.

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

Fixed directly in the G21 landing rather than deferred: R3's first clause is read to except the probe-authored `detail` passthrough that R4 requires; the carve-out is recorded as a closed Q&A decision with the reproduction and the probe evidence that only key names are ever printed.
- 2026-10-18T01:14:15.350Z backlog → cancelled (system)

