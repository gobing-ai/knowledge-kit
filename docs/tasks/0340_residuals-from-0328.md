---
schema_version: 1
name: Residuals from 0328
status: backlog
template: standard
created_at: 2026-11-04T09:15:30.360Z
updated_at: "2026-11-04T09:15:30.475Z"

---

## 0340. Residuals from 0328

### Background

Source task: 0328 (feature E9) — deferred residuals filed by residual-scan settle (unlinked: a deferral must not hold the completing feature open).

- review-finding:490f4275 — plugins/kk/workflows/kk-daily-ai-voice3.yaml:775: Stale count word in the changed prompt block: `kk-daily-ai-voice3.yaml:775` still says "Write three short zh posts, one per file:" while the diff added a fourth bullet (`26-social/linkedin.md` at line 779; the description at line 762 was updated to four platforms, the input count was not). The enumerated file list stays operative and a missing file skips the variant gracefully with a log line, so the worst case is one skipped LinkedIn variant for a run, never a failure
- review-finding:d84cc09e — scripts/bundle-plugins.test.ts:35: The remediation's expectation sweep missed a third sibling inventory: `CHECK_DECLARING_PLUGINS` enumerates the plugins whose manifest declares a TypeScript readiness check (per-task credits in its comment, 0249→0297) but omits the new check-declaring `linkedin-pub`, so the bundler's rewrite of its `check` to an existing `./dist/*.js` artifact is never asserted. The suite stays green (24 pass — the list is an input, not an exact-equality assertion), so this is a latent coverage gap of the same class a41335b fixed, not a red test

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
