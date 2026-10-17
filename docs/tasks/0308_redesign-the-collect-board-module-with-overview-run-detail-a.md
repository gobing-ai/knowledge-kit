---
schema_version: 1
name: Redesign the Collect Board module with Overview, Run detail and Items tabs
status: todo
template: feature-impl
created_at: 2026-10-17T05:04:06.959Z
updated_at: "2026-10-17T05:19:41.753Z"
feature_id: G81
priority: P2
tags:
  - board
  - ui
  - react
estimate_hours: 8

dependencies: ["0307"]
---

## 0308. Redesign the Collect Board module with Overview, Run detail and Items tabs

### Background

Implements: R3 — Overview shows cadence health across Spur runs and store rows; R4 — Overview trends collection, label fallback and downstream yield per run; R5 — Run detail shows the stage funnel; R6 — Run detail shows label quality by decision; R7 — Items browser pages and filters a run's items; R9 — Navigation keeps deep links and the shipped tabs.

Operator ask (run 5f03d609-ece9-4f6f-9555-dba2a7b0cb2b): help the end user understand the result and progress of kk-collect from collect_runs, items, labels and selections, redesigning both UI and functionality. Consumes the reader routes from the preceding task. Design: docs/design/collect-store-views.md §2.

**Refine corrections (2026-10-16)**
- "tabs `overview`/`summary`/`items`/… with `?tab=results` → `summary`" → `BoardTab` is a closed shared union and `parseDeepLink` turns unknown tabs into a diagnostic (`apps/board/src/shared/run-selection.ts:11-14,46,54-75`), used by all three modules (`collect/index.tsx:87`, `daily-voice/index.tsx:91`, `itc/index.tsx:91`) → `parseDeepLink(search, tabs = BOARD_TABS, aliases = {})`; Collect passes its five tabs and `{results: 'summary'}`; the other modules keep calling it with defaults and behave unchanged.
- "banner counts failed, skipped and no-store runs" → Spur's run statuses here are done/failed/running (live `.spur/spur.db`: 59/1/3); a skipped tick has no distinct terminal state → count `failed` and `done without store row`; a `running` run without a row shows `in progress`, never `no store row`.
- "rows by heuristic/model/default" → `labelRowsBySource` is keyed by `labels.maker` and may include other makers → render the three named makers plus `other` when present.
- Dependency contract: 0307 freezes routes and types; this task changes neither.

### Requirements

- [ ] R1 — Collect tabs `overview` (default), `summary` (label "Run detail"), `items`, `progress`, `config`. `parseDeepLink` (`apps/board/src/shared/run-selection.ts`) gains optional `tabs` and `aliases` parameters (defaults = shipped behaviour); Collect passes `{results: 'summary'}`; `?run=&tab=` deep links survive reload; Daily Voice and ITC tabs are unchanged.
- [ ] R2 — Overview banner: time since `lastStoredAt` vs the 6 h schedule — `on schedule` (≤6 h), `late` (≤12 h), `stalled` (>12 h), `unknown` when `lastStoredAt` is null or the store is unavailable; plus counts on the current page of `failed` runs and `done` runs with no store row.
- [ ] R3 — Overview table, one row per Spur run on the current run-list page: Spur start, Spur duration (`completedAt − startedAt`, `—` while running), Spur status, collected per source (CSS stacked bar with text totals), inserted, updated, label rows, fallback share (`default` rows / label rows, `—` when 0 rows), yield selected · published · dropped. A `null` row shows `no store row` (or `in progress` for a running run); rows link to Run detail.
- [ ] R4 — Run detail funnel cards Collected → Stored (inserted / updated / unchanged; unchanged from the shipped results projection, else `unavailable`) → Labeled (distinct items; label rows by heuristic / model / default / other) → Downstream (selected / published / dropped among items first seen in the run); every card names its unit.
- [ ] R5 — Label quality per decision: run-rows histogram by value with HIGH/MEDIUM/LOW/none counts and a toggle to the effective distribution (or its `board.store.policy` diagnostic); the shipped core-facts preview and artifact downloads stay below.
- [ ] R6 — Items tab: 25-row table — title link (`rel="noreferrer"`, only when `url` non-null), source, new/re-seen, story id, label chips, selection status; filters source / seen / decision + value / selection as component state sent to the 0307 items route; paging; all store text as React text nodes.
- [ ] R7 — An `unavailable` store response shows its diagnostic inside the store panels only, never zeros; Execution progress and Workflow Config Summary unchanged; loading / empty / error states use the shipped accessible patterns.

**Out of scope:** reader routes and contract types (0307); installed-Board check (0309); store views for other modules; a chart library.

### Acceptance Criteria

- [ ] AC1 — Overview shows cadence health across Spur runs and store rows
- [ ] AC2 — Overview trends collection, label fallback and downstream yield per run
- [ ] AC3 — Run detail shows the stage funnel
- [ ] AC4 — Run detail shows label quality by decision
- [ ] AC5 — Items browser pages and filters a run's items
- [ ] AC6 — Navigation keeps deep links and the shipped tabs

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-17T05:19:04.439Z

- Q: Change the shared `BoardTab` union or parameterise `parseDeepLink`? → A: parameterise with defaults; the other two modules stay byte-identical in behaviour. Closed 2026-10-16 (refine).
- Q: How to show "skipped" ticks? → A: not countable — Spur records no skipped terminal state; banner counts `failed` and `done without store row`. Closed 2026-10-16 (refine).

### Design

- WHAT/WHY: turn the store projections into an operator view of cadence, per-run yield and item outcomes. WHERE: `apps/board/src/shared/run-selection.ts` (tab list + aliases), `apps/board/src/shared/api.ts` (three client calls), `apps/board/src/shared/collect.ts` (view-model helpers: `cadenceState`, `fallbackShare`, `funnelCards`, `bannerCounts`), `apps/board/src/collect/index.tsx` (Overview, Run detail, Items panels), `apps/board/src/board.css` (bars, chips).
- Frozen names: tab ids `overview|summary|items|progress|config`; alias `results → summary`; cadence states `on schedule|late|stalled|unknown`; contract types from `apps/board/src/contracts.ts` (0307).
- Data flow: Overview passes the run ids of the current Spur run-list page to `/store/overview?runs=`; Run detail and Items call the per-run routes; Spur status/timing always come from the shipped run list/detail, never from `collect_runs`.
- Rejected: a chart library (board rule: no new UI framework); widening `BoardTab` for all modules (would change Daily Voice/ITC deep links); keeping a separate Results tab (folded into Run detail).
- Anti-patterns: rendering store strings as HTML; showing 0 for unavailable data; deriving duration from `collect_runs`.

### Plan

1. Tests first in `apps/board/tests/`: `parseDeepLink` with tabs/aliases (and defaults unchanged); `collect.ts` helpers (cadence thresholds incl. null, fallback share with 0 rows, banner counts for failed / done-no-row / running-no-row, funnel units). (R1–R4)
2. Extend `parseDeepLink`; wire Collect tab list + alias. (R1)
3. `api.ts` client calls; `collect.ts` helpers. (R2–R4)
4. Overview, Run detail (funnel + label quality + shipped preview/downloads), Items panels with unavailable/loading/empty states; CSS. Component tests for unavailable → diagnostic, items filters → query string, title rendered as text. (R2–R7)
5. `bun run lint`, `bun run test` (per-file ≥90%), `bun run build`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
