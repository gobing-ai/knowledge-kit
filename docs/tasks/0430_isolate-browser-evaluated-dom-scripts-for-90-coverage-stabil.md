---
schema_version: 1
name: Isolate browser-evaluated DOM scripts for 90% coverage stability and automate worktree plugin bundling
status: backlog
template: standard
created_at: 2026-11-24T22:48:34.634Z
updated_at: "2026-11-24T22:48:34.731Z"

---

## 0430. Isolate browser-evaluated DOM scripts for 90% coverage stability and automate worktree plugin bundling

### Background

Captured from the creation title: "Isolate browser-evaluated DOM scripts for 90% coverage stability and automate worktree plugin bundling".

### Requirements

- [ ] R1. Preserve the >= 90% per-file function and line coverage floor; extract uninstrumentable Chromium `page.evaluate(...)` DOM scripts from publish adapters (starting with `plugins/publishings/wechatmp-pub/src/flow.ts`) into dedicated browser-side script modules/fixtures ignored in `bunfig.toml` `coveragePathIgnorePatterns` (matching existing `*-dom-runner.ts` convention).\n- R2: Run `bun scripts/bundle-plugins.ts` automatically when `plugins/kk/{scripts,workflows}` has changes in a worktree (or in preflight/prepare hooks) so `apps/cli/plugins` never drifts and triggers launch preflight refusals.

### Acceptance Criteria

<!-- Number items AC1, AC2, … (never R<n> — that is the Requirements namespace). Preferred: `Scenario: AC1 — <concrete outcome> (req: R1)` blocks with Given/When/Then, declaring both `ac_altitude: task-local` and `ac_numbering: task-local` for task-local regression criteria (altitude skips only the feature-subset check; numbering makes `(req: R<n>)` count toward requirement coverage). Parsed checkbox rows `- [ ] AC1 — <title>` are supported but never bind requirements — only `Scenario:` titles read `(req: R<n>)`. Bare `- AC1` bullets are legacy unparsed records, not a traceability bypass. Requirements use `- [ ] R1. <text>`, checked at close. Keep empty if this task has no objective AC yet. -->

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Chosen approach, key tradeoffs, invariants, and impacted surfaces. Keep snippets short. -->

### Plan

- [ ] Identify `page.evaluate(...)` callbacks causing uninstrumentable function-coverage drops in `wechatmp-pub` and sibling publish adapters\n- [ ] Extract browser-side DOM scripts into dedicated modules and register them in `bunfig.toml` `coveragePathIgnorePatterns` while keeping >= 90% function and line coverage on all Node/Bun code\n- [ ] Automate `bun scripts/bundle-plugins.ts` on worktree plugin edits and add a regression check\n- [ ] Verify `bun run spur-check` passes with >= 90% function and line coverage

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History
