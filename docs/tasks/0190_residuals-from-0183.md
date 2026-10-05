---
schema_version: 1
name: Residuals from 0183
status: cancelled
template: feature-impl
created_at: 2026-10-05T07:01:08.709Z
updated_at: "2026-10-05T22:13:38.475Z"
feature_id: E91

---

## 0190. Residuals from 0183

### Background

Source task: 0183 (feature E91) — deferred residuals filed by residual-scan settle.

- review-finding:8e326537 — packages/publish-harness/src/browser.ts:287: The `keyboard` branch of `fillCodeMirror` has no post-condition: `keyboard.insertText` is awaited and the function returns `void` without confirming the editor received the text — unlike `pasteHtml`, which polls the editor non-empty. A stolen-focus no-op is reported as success, and a downstream flow that then clicks "save draft" can observe a draft id for an empty body. The task's frozen surface does not require this check, so 0185/0186 must assert the body (or the flow is a false-success path for AC4).
- review-finding:57393658 — packages/publish-harness/src/browser.ts:311: `expectOutcome` advertises a Result-shaped return (`{ ok: false, error }`) but propagates probe exceptions: a `probe()` that rejects (e.g. `page.evaluate` while the page navigates) rejects `expectOutcome` instead of yielding `{ ok: false }`. Channel flows 0185-0188 must wrap the probe, or a transient DOM read turns the "never report unseen success" rail into an unhandled rejection.

### Requirements

<!-- One R-item per line, exactly `- [ ] R1. <text>` (checkbox + `R<n>.`); `spur task check` flags any other form. Derive from the linked feature or refined task scope. -->

### Acceptance Criteria

<!-- Number items AC1, AC2, … (never R<n> — that is the Requirements namespace). Preferred: `Scenario: AC1 — <concrete outcome> (req: R1)` blocks with Given/When/Then, declaring both `ac_altitude: task-local` and `ac_numbering: task-local` for task-local regression criteria (altitude skips only the feature-subset check; numbering makes `(req: R<n>)` count toward requirement coverage). Parsed checkbox rows `- [ ] AC1 — <title>` are supported but never bind requirements — only `Scenario:` titles read `(req: R<n>)`. Bare `- AC1` bullets are legacy unparsed records, not a traceability bypass. Requirements use `- [ ] R1. <text>`, checked at close. Do not leave placeholder AC here. -->

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-05T22:13:38.475Z backlog → cancelled (system)

