---
schema_version: 1
name: Daily AI Voice Generation and Publishing detail tabs
status: todo
template: feature-impl
created_at: 2026-11-26T00:29:45.935Z
updated_at: "2026-11-26T01:09:16.605Z"
feature_id: G83
priority: P2
tags:
  - board
  - daily-ai-voice
  - ui

dependencies: ["0440"]
estimate_hours: 6
---

## 0441. Daily AI Voice Generation and Publishing detail tabs

### Background

Feature G83: drill-down tabs for debugging a generation run or a publish window of the selected day.

Implements: R5 — Generation detail tab shows node-level evidence for debugging; R6 — Publishing detail tab shows window by target evidence for debugging; R12 — Unknowns and missing evidence stay explicit across the console

Design: docs/design/daily-voice-ops-console.md §4.

**Refine corrections (2026-11-25)** — premises audited against the current tree:

1. The detail data already exists. `NewsGenerationEvidence` (engines, progress, gate), `NewsPublishWindow` (provenance, targets with `status`/`effect`/`url`/`error`/`evidence{plan,receipt}`) and `NewsPublishTarget` live in `apps/cli/src/board/news.ts:58-160` and are mirrored in `apps/board/src/contracts.ts` (`NewsSummaryEvidence`, line 250).
2. **Publishing is per day directory, not per kk-publish run** (see the 0439 correction). The Publishing tab renders the day's windows from the selected generation run's evidence, and the window run id comes from `4-publish/schedule-receipt.<window>.json`.
3. `step-timing.json` is an array of `{step, startedAt, endedAt}` (written at `plugins/kk/scripts/kk-workflow-stages.ts:561,2034`; shape confirmed on `.works/kk-news-generate/20261125/step-timing.json`). Durations are `endedAt - startedAt`. A missing `endedAt` means running or unknown, never 0.

### Requirements

- [ ] R1. Generation tab: run/attempt picker, node timeline with producer state, attempts and step durations from step-timing.json, engine fallback chain, artifacts with availability reasons, bounded diagnostics.
- [ ] R2. Publishing tab: window × target matrix (tier, mode, status, effect, URL, error), per-window outcome and provenance checks; receipts and plan refs rendered as text.
- [ ] R3. Missing evidence renders unknown with its reason.

### Acceptance Criteria

- [ ] AC1 — Generation detail tab shows node-level evidence for debugging
- [ ] AC2 — Publishing detail tab shows window by target evidence for debugging
- [ ] AC3 — Unknowns and missing evidence stay explicit across the console

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-26T01:08:57.466Z

- **Q: Where do window run ids come from in Publishing?** A: From `DailyDigest.windows[].runId`, which comes from `schedule-receipt.<window>.json`. They are shown as text. There is no kk-publish run drill-down (kk-publish is not a reader workflow).

### Design

**Chosen.** Render from the existing news evidence DTO and the per-run evidence and artifact routes. No new per-run route is added.

**Rejected.** Folding detail data into `DailyDigest`. It bloats the day payload, and drill-down is on demand.

**Frozen:**
- **Generation tab.** Attempt picker from `DailyDigest.generation.attempts` (newest first). It fetches `/api/workflows/kk-news-generate/runs/<runId>/evidence` and `…/artifacts/<id>`.
  - The node timeline joins `NewsGenerationEvidence.progress.nodes` (state, attempts) with `DailyDigest.generation.nodeDurations`, which comes from `step-timing.json`.
  - The engine chain is `NewsGenerationEvidence.engines`.
  - Diagnostics are bounded at 20 lines per node, with a "truncated" marker.
- **Publishing tab.** A window × target matrix from `DailyDigest.windows[]`, columns `target, tier, mode, status, effect, url, error`.
  - Each window has a provenance row: dateMatch, bundleMatch, parentMatch, digestMatch.
  - Receipt and plan refs render as `<code>` text.
  - Only `url` values passing `isPublicHttpUrl` become anchors.

**Anti-patterns:**
- Making a receipt path clickable.
- Showing an artifact whose producer did not succeed.
- Treating a missing `endedAt` as 0.
- Fetching every attempt eagerly. Fetch the selected one only.

**Depends on 0440:** the tab shell, day selection and recipe component. Each detail row with a recipe (failed node → `generate-from-node`, failed target → `publish-retry`) reuses the recipe component.

**Tests (`apps/board/tests/daily-voice/`):**

| AC | Covers |
| --- | --- |
| AC1 | generation render over a fixture evidence DTO: timeline, fallback chain, artifact availability reasons |
| AC2 | publishing render: matrix, provenance, receipt as text |
| AC3 | unknown-reason rendering for missing timing, missing window and a non-success producer |

### Plan

- Generation tab components over the per-run evidence route.
- Publishing matrix and provenance panel.
- Unknown/availability rendering for both.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Feature: `docs/features/G83_daily-ai-voice-ops-console-day-centric-digest-debug-tabs-and-guarded-redo-tools.md`
- Design satellite: `docs/design/daily-voice-ops-console.md` (index row `docs/04_DESIGN.md:64`)
- Decision: `docs/00_ADR.md:1417` (ADR-035 amendment 2026-11-25)
- Brainstorm: `docs/plans/2026-11-25-daily-ai-voice-ops-console-brainstorm.md`
- Code anchors: `apps/cli/src/board/reader.ts:666-724`, `apps/cli/src/board/news.ts:40,58-160,254,469`, `apps/cli/src/board/daily-voice.ts:308`, `apps/cli/src/board/capture.ts` (`BOARD_RUNS_REL`), `apps/cli/src/commands/content-launch.ts:525`, `apps/board/src/contracts.ts:11,44,250`
- Follow-ups: G84 (in-board artifact editor), G85 (digest push notification)

### History
