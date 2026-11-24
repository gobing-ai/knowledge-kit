---
schema_version: 1
name: Split heavy and browser tests into test:heavy while preserving 90% per-file function and line coverage
status: backlog
template: standard
created_at: 2026-11-24T22:48:33.200Z
updated_at: "2026-11-24T22:48:33.320Z"

---

## 0429. Split heavy and browser tests into test:heavy while preserving 90% per-file function and line coverage

### Background

Captured from the creation title: "Split heavy and browser tests into test:heavy while preserving 90% per-file function and line coverage".

### Requirements

- [ ] R1. Profile slow test files in `bun run test` (currently 1904s across 370 files; apps/cli ~1014s, wechatmp-pub ~355s) and split heavy/browser/Playwright/e2e suites into `bun run test:heavy`.\n- R2: Strictly preserve >= 90% per-file function coverage and >= 90% per-file line coverage (`bunfig.toml` `coverageThreshold = { lines = 0.9, functions = 0.9 }` and `.spur/rules/quality/coverage-gate.yaml`).\n- R3: Separate `spur-check` (fast unit + 90% coverage) from `spur-check-feature` (repo-wide + `test:heavy`, mirroring Spur ADR-119) in `package.json` and `.spur/config.yaml`.

### Acceptance Criteria

<!-- Number items AC1, AC2, … (never R<n> — that is the Requirements namespace). Preferred: `Scenario: AC1 — <concrete outcome> (req: R1)` blocks with Given/When/Then, declaring both `ac_altitude: task-local` and `ac_numbering: task-local` for task-local regression criteria (altitude skips only the feature-subset check; numbering makes `(req: R<n>)` count toward requirement coverage). Parsed checkbox rows `- [ ] AC1 — <title>` are supported but never bind requirements — only `Scenario:` titles read `(req: R<n>)`. Bare `- AC1` bullets are legacy unparsed records, not a traceability bypass. Requirements use `- [ ] R1. <text>`, checked at close. Keep empty if this task has no objective AC yet. -->

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Chosen approach, key tradeoffs, invariants, and impacted surfaces. Keep snippets short. -->

### Plan

- [ ] Measure per-file test durations across apps, packages, and plugins\n- [ ] Move slow/browser/e2e suites to `test:heavy` script without dropping coverage below 90% functions / 90% lines on unit-tested source\n- [ ] Update `package.json` and `.spur/config.yaml` `builder.actions.check-feature` to run `spur-check-feature`\n- [ ] Verify `bun run spur-check` completes in <3 min with 90%/90% coverage green and `bun run spur-check-feature` passes

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History
