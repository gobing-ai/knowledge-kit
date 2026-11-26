---
schema_version: 1
name: Daily AI Voice Generation and Publishing detail tabs
status: done
template: feature-impl
created_at: 2026-11-26T00:29:45.935Z
updated_at: "2026-11-26T04:26:34.766Z"
feature_id: G83
priority: P2
tags:
  - board
  - daily-ai-voice
  - ui

dependencies: ["0440"]
estimate_hours: 6
done_forced: "false"
done_reason: unforced close
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

- [x] R1. Generation tab: run/attempt picker, node timeline with producer state, attempts and step durations from step-timing.json, engine fallback chain, artifacts with availability reasons, bounded diagnostics.
- [x] R2. Publishing tab: window × target matrix (tier, mode, status, effect, URL, error), per-window outcome and provenance checks; receipts and plan refs rendered as text.
- [x] R3. Missing evidence renders unknown with its reason.

### Acceptance Criteria

- [x] AC1 — Generation detail tab shows node-level evidence for debugging
- [x] AC2 — Publishing detail tab shows window by target evidence for debugging
- [x] AC3 — Unknowns and missing evidence stay explicit across the console

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

| File | Lines | What / why |
| --- | --- | --- |
| `apps/board/src/daily-voice/detail-view.ts` | 1-300 (new) | The two detail view models. `generationDetail` joins `NewsGenerationEvidence.progress.nodes`/`engines` with the day's `step-timing.json` durations (a voice fallback reads the same step's duration instead of inventing a gap), keeps a step the run never charted as `state unrecorded`, and bounds diagnostics at `NODE_DIAGNOSTIC_CAP`. `publishingDetail` builds the window × target matrix from the digest, adds the four-check provenance rows as `yes`/`no`/`not checked`, keeps a plan-without-receipt at `planned`, and only promotes a public http(s) URL to a link. |
| `apps/board/src/daily-voice/index.tsx` | Generation/Publishing panels | The Generation tab gains an attempt picker (newest first) that fetches exactly the selected attempt's `/evidence` on demand — never every attempt eagerly — and renders facts, the node timeline (state, attempts, timing, step duration, per-node recipe), the engine chain, artifacts with their availability reason, and the bounded diagnostics with a truncation line. The Publishing tab renders the matrix, the provenance row, the window's run id as text and receipts/plans as `<code>`, with the window's recipes beneath. Both reuse the shared `RecipeLine`; a row's recipe is the projection's own argv for that subject, so a copied and a clicked command cannot drift. |
| `apps/board/tests/daily-voice/detail-view.test.ts` | 1-330 (new) | AC1-AC3: the timeline join (including the fallback sharing the voice duration and an uncharted-but-timed step), the uncaptured attempt's `no-capture-record`, artifact availability reasons, the diagnostics cap, the matrix columns, three-state provenance, a not-run window, a plan-without-receipt, and the URL policy. |

Deliberate limits, recorded:

- **No new route.** Everything comes from `GET /api/workflows/kk-news-generate/runs/<id>/evidence`, the existing artifact route and the day digest (design §3), so the drill-down cannot disagree with the reader's own projection.
- **The node timeline is the union of what the run recorded.** A node with no recorded producer state is shown as `state unrecorded` rather than omitted, because the operator's question is "which step stopped"; a node that only `step-timing.json` knows still gets a duration.
- **Publishing does not drill into `kk-publish` runs** — `kk-publish` is not a reader `WorkflowName` and the day directory is authoritative (task Q&A). The window's run id is rendered as text for a terminal lookup.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 Generation tab: run/attempt picker, node timeline with producer state + attempts + `step-timing.json` durations, engine fallback chain, artifacts with availability reasons, bounded diagnostics | MET | `apps/board/src/daily-voice/index.tsx:300-470` (attempt picker, on-demand evidence fetch, timeline, engine chain, artifacts, diagnostics); `apps/board/src/daily-voice/detail-view.ts:96-140` (`generationDetail`, `stepIdOf` fallback sharing, `NODE_DIAGNOSTIC_CAP`); `apps/board/tests/daily-voice/detail-view.test.ts:150-240` |
| R2 Publishing tab: window × target matrix (tier, mode, status, effect, URL, error), per-window outcome and provenance checks, receipts/plans as text | MET | `apps/board/src/daily-voice/index.tsx:475-580` (`PublishingPanel`); `apps/board/src/daily-voice/detail-view.ts:150-240` (`publishingDetail`, `provenanceRows`/`provenanceWord`, `isPublicHttpUrl`); `apps/board/tests/daily-voice/detail-view.test.ts:245-330` |
| R3 Missing evidence renders unknown with its reason | MET | `apps/board/src/daily-voice/detail-view.ts:110-125` (uncharted step → `state unrecorded`; `no-capture-record`/`no-recorded-projection`), `:190` (`recorded` unknown), `:225` (`unknownReason` carried); `apps/board/tests/daily-voice/detail-view.test.ts:170,300,315` |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 Generation detail tab shows node-level evidence for debugging | MET | test | `apps/board/tests/daily-voice/detail-view.test.ts:150` (timeline join, fallback shares the step duration), `:200` (artifact availability reasons), `:225` (engine chain + diagnostics cap) |
| AC2 Publishing detail tab shows window by target evidence for debugging | MET | test | `apps/board/tests/daily-voice/detail-view.test.ts:245` (matrix columns, receipt as text, only a public URL linked), `:270` (provenance three-state) |
| AC3 Unknowns and missing evidence stay explicit | MET | test | `apps/board/tests/daily-voice/detail-view.test.ts:170` (uncharted step, `no-recorded-projection`), `:185` (`no-capture-record`), `:300` (not-run window), `:315` (plan without receipt stays `planned`) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

- Feature: `docs/features/G83_daily-ai-voice-ops-console-day-centric-digest-debug-tabs-and-guarded-redo-tools.md`
- Design satellite: `docs/design/daily-voice-ops-console.md` (index row `docs/04_DESIGN.md:64`)
- Decision: `docs/00_ADR.md:1417` (ADR-035 amendment 2026-11-25)
- Brainstorm: `docs/plans/2026-11-25-daily-ai-voice-ops-console-brainstorm.md`
- Code anchors: `apps/cli/src/board/reader.ts:666-724`, `apps/cli/src/board/news.ts:40,58-160,254,469`, `apps/cli/src/board/daily-voice.ts:308`, `apps/cli/src/board/capture.ts` (`BOARD_RUNS_REL`), `apps/cli/src/commands/content-launch.ts:525`, `apps/board/src/contracts.ts:11,44,250`
- Follow-ups: G84 (in-board artifact editor), G85 (digest push notification)

### History

- 2026-11-26T04:24:51.623Z todo → wip (system)
- 2026-11-26T04:26:32.824Z wip → testing (system)
- 2026-11-26T04:26:34.759Z testing → done (system)

