---
schema_version: 1
name: Residuals from 0366
status: backlog
template: standard
created_at: 2026-11-14T12:00:57.453Z
updated_at: "2026-11-14T12:00:57.516Z"

---

## 0373. Residuals from 0366

### Background

Source task: 0366 (feature G61) — deferred residuals filed by residual-scan settle (unlinked: a deferral must not hold the completing feature open).

- review-finding:c8937af6 — plugins/kk/workflows/kk-publish.yaml:228: `report` cannot run on the day `settle` exits 1, so R3's "`report` runs after `settle` regardless of its result" is unmet in exactly that case — reproduced with the engine probe above, not inferred. It is also a behaviour change against the workflow being replaced, whose failing node (`outcome-assert`) sat *after* `report` and `ledger` (`plugins/kk/workflows/kk-daily-publish3.yaml:243-249`). Bounded: `settle` writes `outcome.<w>.json`, `settlement.<w>.json`, the partial marker and `runs[]` before it throws (`apps/cli/src/commands/content-publish.ts:370-375`), so only the page and the ledger sync are lost, and `kk <noun> publish-report --work-dir … --window …` re-renders the page
- review-finding:17eb869c — apps/cli/src/commands/content-launch.ts:432: `noun` is the **CLI word**, not the resolved content type. `kk article publish --type news` resolves a news run (`apps/cli/src/commands/content-launch.ts:467`, `:490`) but launches with `noun: article` (`:432`), so every node command runs `kk article publish-*`, which `apps/cli/src/commands/content.ts:452` registers on the article noun's own default type `itc` (`apps/cli/src/commands/content-publish.ts:455`). The plan never cross-checks the bundle's `contentType` (`apps/cli/src/publish-matrix.ts:59` is the only use), so the wrong switchboard block (`content_types.itc.channels`) is applied silently — worst case a channel the operator pinned `off`/`draft` under `content_types.news.channels` follows the preset mode on a live send

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
