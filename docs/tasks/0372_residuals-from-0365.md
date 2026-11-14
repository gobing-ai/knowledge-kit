---
schema_version: 1
name: Residuals from 0365
status: backlog
template: standard
created_at: 2026-11-14T10:21:34.734Z
updated_at: "2026-11-14T10:21:34.796Z"

---

## 0372. Residuals from 0365

### Background

Source task: 0365 (feature G61) — deferred residuals filed by residual-scan settle (unlinked: a deferral must not hold the completing feature open).

- review-finding:cab2266a — apps/cli/src/commands/content-launch.ts:409: Still live and reproduced: window/CN-consent validation runs after the auto-`generate`, so `publish --unattended --live-channels <token>` with a consent mismatch pays for a full generation (one `kk-news-generate` child, bundle written, receipt rewritten to `done`) and only then exits 5. Not a contract break — R7 and design §3.3 require validation before the *publish* lock (step 2), and `validateLiveTokens` at `:409` does precede the publish launch at `:431`
- review-finding:564322a1 — apps/cli/src/launch.ts:602: Still live: `spur workflow cancel` covers `runId` only; the ported block also cancelled `<runId>-safety`, the nested safety run design §5.1 nodes 12/19 create. Unreachable until the generation YAMLs land (0366–0368)

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
