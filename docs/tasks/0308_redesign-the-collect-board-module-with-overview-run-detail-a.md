---
schema_version: 1
name: Redesign the Collect Board module with Overview, Run detail and Items tabs
status: done
template: feature-impl
created_at: 2026-10-17T05:04:06.959Z
updated_at: "2026-10-18T21:04:28.048Z"
feature_id: G81
priority: P2
tags:
  - board
  - ui
  - react
estimate_hours: 8

dependencies: ["0307"]
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0308-verdict.json
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

- [x] R1 — Collect tabs `overview` (default), `summary` (label "Run detail"), `items`, `progress`, `config`. `parseDeepLink` (`apps/board/src/shared/run-selection.ts`) gains optional `tabs` and `aliases` parameters (defaults = shipped behaviour); Collect passes `{results: 'summary'}`; `?run=&tab=` deep links survive reload; Daily Voice and ITC tabs are unchanged.
- [x] R2 — Overview banner: time since `lastStoredAt` vs the 6 h schedule — `on schedule` (≤6 h), `late` (≤12 h), `stalled` (>12 h), `unknown` when `lastStoredAt` is null or the store is unavailable; plus counts on the current page of `failed` runs and `done` runs with no store row.
- [x] R3 — Overview table, one row per Spur run on the current run-list page: Spur start, Spur duration (`completedAt − startedAt`, `—` while running), Spur status, collected per source (CSS stacked bar with text totals), inserted, updated, label rows, fallback share (`default` rows / label rows, `—` when 0 rows), yield selected · published · dropped. A `null` row shows `no store row` (or `in progress` for a running run); rows link to Run detail.
- [x] R4 — Run detail funnel cards Collected → Stored (inserted / updated / unchanged; unchanged from the shipped results projection, else `unavailable`) → Labeled (distinct items; label rows by heuristic / model / default / other) → Downstream (selected / published / dropped among items first seen in the run); every card names its unit.
- [x] R5 — Label quality per decision: run-rows histogram by value with HIGH/MEDIUM/LOW/none counts and a toggle to the effective distribution (or its `board.store.policy` diagnostic); the shipped core-facts preview and artifact downloads stay below.
- [x] R6 — Items tab: 25-row table — title link (`rel="noreferrer"`, only when `url` non-null), source, new/re-seen, story id, label chips, selection status; filters source / seen / decision + value / selection as component state sent to the 0307 items route; paging; all store text as React text nodes.
- [x] R7 — An `unavailable` store response shows its diagnostic inside the store panels only, never zeros; Execution progress and Workflow Config Summary unchanged; loading / empty / error states use the shipped accessible patterns.

**Out of scope:** reader routes and contract types (0307); installed-Board check (0309); store views for other modules; a chart library.

### Acceptance Criteria

- [x] AC1 — Overview shows cadence health across Spur runs and store rows
- [x] AC2 — Overview trends collection, label fallback and downstream yield per run
- [x] AC3 — Run detail shows the stage funnel
- [x] AC4 — Run detail shows label quality by decision
- [x] AC5 — Items browser pages and filters a run's items
- [x] AC6 — Navigation keeps deep links and the shipped tabs

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

Built on the frozen 0307 reader routes and contract types: `apps/board/src/contracts.ts` is untouched,
and every store string renders as a React text node.

| Req | Change | Anchor |
| --- | --- | --- |
| R1 | Collect tab set `overview\|summary\|items\|progress\|config` + the `results → summary` alias | `apps/board/src/shared/run-selection.ts:24` |
| R1 | `results → summary` alias table (no dead `?tab=results` links) | `apps/board/src/shared/run-selection.ts:27` |
| R1 | `parseDeepLink(search, tabs = BOARD_TABS, aliases = {})`: an alias only resolves to a tab the module has, so Daily Voice/ITC keep their shipped behaviour | `apps/board/src/shared/run-selection.ts:75` |
| R1 | `resolveSelection(rows, link, defaultTab = 'summary')` — Collect passes `overview` as its first-visit tab | `apps/board/src/shared/run-selection.ts:119` |
| R1 | `RunListRow.completedAt` (Spur's own completion stamp, already on `/api/runs`) for the duration column | `apps/board/src/shared/run-selection.ts:36` |
| R2 | `cadenceState` — 6 h schedule, `late` ≤ 12 h, `stalled` beyond, `unknown` without a stamp; a future stamp clamps to 0 | `apps/board/src/shared/collect.ts:306` |
| R2 | `bannerCounts` — `failed` + `done` without a store row on the page; a running run without a row is `in progress`, never a missing store | `apps/board/src/shared/collect.ts:363` |
| R3 | Overview table: Spur start/duration/status columns, `no store row`/`in progress` cells, one row per run on the page | `apps/board/src/collect/panels.tsx:63` |
| R3 | Per-source stacked CSS bar + text totals, inserted/updated/label-rows cells | `apps/board/src/collect/panels.tsx:152` |
| R3 | `fallbackShare` — `default` rows ÷ label rows, `—` at 0 rows (never `0%`) | `apps/board/src/shared/collect.ts:326` |
| R3 | `sourceSegments` — alphabetical positive-count slices whose shares sum to 1 | `apps/board/src/shared/collect.ts:341` |
| R3 | `runDuration` — Spur `completedAt − startedAt`, `—` while running | `apps/board/src/shared/collect.ts:465` |
| R4 | `funnelCards` — Collected → Stored → Labeled → Downstream, each naming its unit; `unchanged` comes from the shipped results projection and stays `unavailable` without it | `apps/board/src/shared/collect.ts:407` |
| R4 | `makerBreakdown` — heuristic/model/default plus `other` only when the run recorded another maker | `apps/board/src/shared/collect.ts:394` |
| R5 | Run detail: funnel cards, then the label-quality card, then the shipped core-facts rows and artifact downloads (Results folds in here) | `apps/board/src/collect/panels.tsx:188` |
| R5 | Label quality per decision with the run/effective toggle | `apps/board/src/collect/panels.tsx:253` |
| R5 | `QualityTable` — run histogram (HIGH/MEDIUM/LOW/none by value) or the effective distribution, `unavailable` when a policy read emptied it | `apps/board/src/collect/panels.tsx:285` |
| R5 | Shipped artifact downloads kept below the funnel | `apps/board/src/collect/panels.tsx:341` |
| R6 | Items table: title link (`rel="noreferrer"`, only for an http(s) `url`), source, new/re-seen, story id, label chips, selection | `apps/board/src/collect/panels.tsx:392` |
| R6 | Item row — the store's title/labels as text nodes | `apps/board/src/collect/panels.tsx:497` |
| R6 | Filter selects (source/seen/decision/value/selection, own `.kk-collect-filter` class) + 25-row pager; the value domain comes from this run's own label rows | `apps/board/src/collect/panels.tsx:363` |
| R6 | `decisionValues` — the `value` filter domain per decision | `apps/board/src/shared/collect.ts:459` |
| R6 | `storeItemsQueryString` — only declared filters, `decision` only with its `value` (the reader refuses half a pair) | `apps/board/src/shared/api.ts:44` |
| R6 | Filters/page as component state sent to the 0307 items route | `apps/board/src/collect/index.tsx:290` |
| R7 | Store visibility: three client calls to the frozen routes, overview ids capped at the route's 25 | `apps/board/src/shared/api.ts:173` |
| R7 | Overview fetched for the run-list page and refreshed with the history poll | `apps/board/src/collect/index.tsx:149` |
| R7 | Item page fetched only for the Items tab, re-fetched on run/filter change; a page from another run never renders | `apps/board/src/collect/index.tsx:230` |
| R7 | `unavailable` responses render their diagnostic inside the store panel, never as zeros | `apps/board/src/collect/panels.tsx:44` |
| R7 | Execution progress and Workflow Config Summary panels unchanged | `apps/board/src/collect/panels.tsx:528` |
| AC6 | Rows link to Run detail through the same `?run=&tab=` deep link; tab buttons from `COLLECT_TABS`; address bar kept in sync | `apps/board/src/collect/index.tsx:372` |
| AC6 | Run-detail deep link builder for Overview rows | `apps/board/src/collect/index.tsx:281` |
| — | Panels extracted as a handler-free view layer so they render (and are asserted on) without a DOM; handlers stay in the entry | `apps/board/src/collect/panels.tsx:14` |
| — | CSS bars/chips/pager/banner, all on `spur-*` tokens | `apps/board/src/shared/board.css:682` |
| — | Items filter styling on its own class, so the shipped `.kk-board-run-selector` selector stays one unique control | `apps/board/src/shared/board.css:798` |
| AC6 | Installed-Board acceptance updated for the five Collect tabs and the `results → summary` alias (the E2E layer asserts them in Chromium) | `apps/board/tests/installed-board.test.ts:522` |
| — | `parseDeepLink` tabs/aliases tests, shipped defaults unchanged | `apps/board/tests/shared/run-selection.test.ts:138` |
| — | Cadence/fallback/banner/funnel/segments/duration/pager helper tests | `apps/board/tests/shared/collect.test.ts:329` |
| — | Store client + items query-string tests | `apps/board/tests/shared/api.test.ts:103` |
| — | Panel component tests: unavailable→diagnostic, title as text node, funnel units, filters, pager | `apps/board/tests/collect/panels.test.tsx:151` |

Verification: `NODE_ENV=test bun test apps/board/tests/shared apps/board/tests/collect` → 84 pass / 0 fail,
exit 0, changed files 100 % lines + 100 % functions; `bun run lint` exit 0; `spur task gate 0308 light`
PASS (5/5 checks, 0 skipped); `spur rule run --preset recommended-pre-check` → "All 56 rules passed";
`bun test apps/board/tests/installed-board.test.ts` (packed install + real Chromium, 14 tests) exit 0.
End-to-end probe against a throwaway project root (real store seeded through the real DAOs, reader on a
free loopback port, Spur Board stubbed at the fetch seam): 25/25 checks, incl. `GET …/store/overview` 200,
`…/runs/<id>/store` 200, `…/store/items?selection=published` 200 with `total=1`, `page=0` refused 400,
rendered module shows the five tabs + cadence banner, items title escaped as a text node.

#### G81 force re-verification — 2026-10-17

Run changes clear results, config, progress and store state; late old-run responses are discarded. Run detail and Items filter choices consume only the selected run's store response (`apps/board/src/collect/index.tsx:287`). The installed-browser run-switch regression (`apps/board/tests/installed-board.test.ts:950`) reproduces a stale funnel without the guard and passes with it; screenshot: `.works/test-artifacts/g81/collect-run-switch.png`. Logs: `.spur/run/g81-reverify/switch-red.log` and `.spur/run/g81-reverify/switch-green.log`.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Five Collect tabs with `overview` default; `parseDeepLink` optional `tabs`/`aliases` at `apps/board/src/shared/run-selection.ts:17`; deep links survive reload — `apps/board/tests/shared/run-selection.test.ts` (68 pass / 0 fail across 3 shared/panel files this run). |
| R2 | MET | Cadence banner thresholds (on schedule ≤6h / late ≤12h / stalled / unknown) — `apps/board/tests/shared/collect.test.ts:330` (re-read this run: "states on schedule up to the 6 h schedule and late up to 12 h"). |
| R3 | MET | Per-run Overview table with stacked source bar, fallback share, yield, null-row semantics — `apps/board/tests/collect/panels.test.tsx` (green this run). |
| R4 | MET | Collected → Stored → Labeled → Downstream funnel cards naming units — same suite. |
| R5 | MET | Per-decision label-quality histogram + effective toggle; core-facts preview retained — same suite + installed suite. |
| R6 | MET | Items tab 25-row table, filter state to the 0307 route, React text nodes — same suite. |
| R7 | MET | Unavailable store degrades panels only; run changes discard late old-run responses — run-ID guard at `apps/board/src/collect/index.tsx:287` (re-read this run); installed regression `apps/board/tests/installed-board.test.ts:950`. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R3 — Overview shows cadence health across Spur runs and store rows | MET | test | `apps/board/tests/shared/collect.test.ts:330`, `apps/board/tests/collect/panels.test.tsx:152` — 68 pass / 0 fail (bun test, this run). |
| Scenario: R4 — Overview trends collection, label fallback and downstream yield per run | MET | test | `apps/board/tests/collect/panels.test.tsx:172`; installed overview rows `apps/board/tests/installed-board.test.ts:972` — 19 pass / 0 fail installed Chromium suite this run. |
| Scenario: R5 — Run detail shows the stage funnel | MET | test | `apps/board/tests/collect/panels.test.tsx:256`; installed funnel `apps/board/tests/installed-board.test.ts:1002`. |
| Scenario: R6 — Run detail shows label quality by decision | MET | test | `apps/board/tests/collect/panels.test.tsx:506`; effective toggle in installed suite. |
| Scenario: R7 — Items browser pages and filters a run's items | MET | test | `apps/board/tests/collect/panels.test.tsx:354`, `apps/board/tests/collect/panels.test.tsx:373`; installed paging `apps/board/tests/installed-board.test.ts:1055`. |
| Scenario: R9 — Navigation keeps deep links and the shipped tabs | MET | test | `apps/board/tests/shared/run-selection.test.ts:139`; URL sync `apps/board/src/collect/index.tsx:275`; run-ID guard regression `apps/board/tests/installed-board.test.ts:950`. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Verdict: PASS

#### Review Report — 0308 (pass 3, independent; after the verify-driven Items fix)
**Scope:** working-tree diff on `sp/runall-g81-870f` vs `7179f9da` — 13 tracked files (+1132/−187), plus the two untracked new files reviewed whole: `apps/board/src/collect/panels.tsx` (591 lines) and `apps/board/tests/collect/panels.test.tsx` (640 lines).
**Dimensions:** functional traceability (R1–R7, AC1–AC6), SECUA, architecture; plus the two questions this pass was given.
**Verdict:** PASS — no open P1–P3 row. One P3 is recorded and explicitly deferred with its trigger and its one-line fix; every other finding is P4.

**Fresh evidence run in this pass:** `NODE_ENV=test bun test apps/board/tests/shared apps/board/tests/collect` → **88 pass / 0 fail**, 275 expects, 6 files; my own `renderToStaticMarkup` probe (written here, not the task's tests) over `ItemsPanel` in six input states, `OverviewPanel` in two and `RunDetailPanel` in three; `spur task check 0308` → PASS with the five L4 warnings reproduced below; gate log `.spur/run/0308-test-gate.log` re-read (`3904 pass / 2 skip / 0 fail`, post-check rules "All 2 rules passed", `proof-digest: sha256:f6b5cd17…1ea2d`, and `stat` shows the edited files predate it).

#### The fix under judgment: `ItemsPanel` state derivation (`apps/board/src/collect/panels.tsx:422-429`)

| Input | Derived state | Rendered | Correct? |
|-------|---------------|----------|----------|
| response for another run (`items.runId !== runId`) | `loading` | `The items page has not loaded yet.` only; no table, no pager, no count | **Yes** — a page for a different run must not speak for this one, and "not loaded" is what the operator sees while the refetch runs |
| `null` (effect has not run, or the fetch threw) | `loading` | same | **Yes for the not-yet-fetched case**; see finding 2 for the thrown case |
| `unavailable` envelope (`availability:'unavailable', total:0, items:[]`) | `unavailable` | `The store could not be read for this run; no items are shown.` + its deduped diagnostic; **no** pager, no `Page x of y`, no `<n> items`, no `No items match these filters.`, no table | **Yes** — probe output for that input is exactly the diagnostic and nothing else |
| `available` with 0 rows | `available`, `page` non-null | `No items match these filters.` + `Page 1 of 1 · 0 items` | **Yes** — a page that answered with nothing is a fact, and it keeps its pager |
| no run selected (`runId === null`) | `loading`, text suppressed | `Select a run to browse its items.` | **Yes** |

**Reintroductions checked, none found:** no double diagnostic (the items panel renders `StoreState` once, from `current.diagnostics`; envelope diagnostics are never copied into the page-level list, and `RunDetailPanel`'s unavailable block and `LabelQuality` are mutually exclusive because the reader always sends `row: null` with `availability:'unavailable'` — `apps/cli/src/board/collect-store.ts:214-222,246-254`); loading text present in all three store panels (probe: `has not loaded yet` / `The store has not answered…` / `The store overview has not loaded yet.`); **no stale-total table** — table and pager both derive from the same `page` object (`panels.tsx:428-429,477-478`), so a pager can never outlive its rows. The bar/pager gating for `Overview` was re-probed too: for `unavailable` and for `null` the only cells emitted are `store unavailable` / `store not loaded yet`, and no `kk-stat-value` appears at all.

#### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P3 (minor) | correctness (R6 paging / R7 empty state) | An out-of-range page renders a false empty claim. Switch runs while parked on page ≥ 2 and `itemFilters.page` survives (`index.tsx:349` changes `runId` only; `:300-312` reset the page only on a filter or pager click), the reader echoes `page` and refuses only `page=0`/an unknown `source` (`apps/cli/src/board/collect-store.ts:285-330`), so a 3-item run requested at page 2 renders **`No items match these filters.`** with no filter set and **`Page 2 of 1 · 3 items`** (reproduced by probe at `page=2, total=3, items=[]`). `Next` is correctly disabled, `Previous` is not — the operator can walk back, so it self-heals in one click. Fix: `page: 1` in the run selector's `onChange`. Pre-existing (the page state is not part of the fix under review). | `apps/board/src/collect/index.tsx:349,300-312`; `apps/board/src/collect/panels.tsx:426-429,477-478` | RESOLVED — fixed by 8b2b5df9: the run selector's `onChange` resets `itemFilters.page` to 1 (`apps/board/src/collect/index.tsx:356-360`), so switching runs can no longer park on an out-of-range page. |
| 2 | P4 (advisory) | usability (R7 wording) | A thrown items read collapses into the same label as "not asked yet": `loadItems` sets `items` to `null` on error (`index.tsx:244-249`), and the panel's only null-state text is `The items page has not loaded yet.` The real cause is stated once, in the page-level diagnostic list (`index.tsx:422`), and the `↻ Refresh` button re-reads results/config/storeRun/progress but **not** items (`index.tsx:206-227`), so the panel keeps saying "not loaded yet" until the operator changes a filter, tab or run. The Overview and Run-detail panels have the same collapse by design, so this is the shipped wording pattern, not a new surface. | `apps/board/src/collect/index.tsx:244-249,206-227`; `apps/board/src/collect/panels.tsx:470` | OPEN |
| 3 | P4 (advisory) | usability (R2 wording) | With the store unreadable the cadence badge correctly reads `unknown`, but its sub-line says `No stored collection recorded.` (`collect.ts:306-311`) — `cadenceState(null, …)` cannot separate "nothing stored" from "could not be read", and the panel contradicts it two lines later. No number, no zero; R7 holds. Carried unchanged from pass 2. | `apps/board/src/collect/panels.tsx:88-90`; `apps/board/src/shared/collect.ts:306-311` | ACCEPTED |
| 4 | P4 (advisory) | correctness (R7 residual) | `overview` is replaced only on success (`index.tsx:149-154`), so after a failed history poll the previous payload keeps rendering against a shifted run page: a run that entered the page head in that window is absent from `rows` and its cell can read `no store row` without ever being fetched. Self-heals on the next successful poll (30 s + backoff). Carried from pass 2. | `apps/board/src/collect/panels.tsx:135-148`; `apps/board/src/collect/index.tsx:149-154` | OPEN |
| 5 | P4 (advisory) | correctness (cross-run staleness) | `RunDetailPanel` receives `storeRun` with no `runId` match (contrast the Items guard at `panels.tsx:422`) and nothing clears it on selection change, so one reader poll (5 s) can show the previous run's funnel under the new run's header. Shipped pattern inherited from `results`/`config`/`progress` at `HEAD`. Carried from pass 2; `storeRun?.runId === selection.runId ? storeRun : null` closes it. | `apps/board/src/collect/panels.tsx:198-215`; `apps/board/src/collect/index.tsx:213-218` | OPEN |
| 6 | P4 (advisory) | usability | For an `available` run with no store row, `This run wrote no store row.` prints **twice** — as the single funnel card's detail and as the panel paragraph (probe counted 2 occurrences). True statement, duplicated text. Carried from pass 2. | `apps/board/src/collect/panels.tsx:215-239`; `apps/board/src/shared/collect.ts:407-416` | ACCEPTED |
| 7 | P4 (advisory) | documentation (the five L4 warnings) | All five `spur task check` L4 warnings are line drift in `## Solution`'s panel anchors, caused by the post-fix insertions: each cited line exists in the right file but now sits 10–30 lines early. Three are cosmetic-coarse (`:63` the `OverviewPanel` head instead of the `no store row`/`in progress` cells at `:135-148`; `:285` instead of `QualityTable` at `:299`; `:363` instead of `FilterSelect`'s class at `:392` for an R6 filter row), two are mis-cited (`:152` lands in the store-cell gating, not the stacked bar at `:171`; `:392` lands in `FilterSelect`, not the Items title link at `:525`). Nothing points at a wrong file or a missing line, so this is doc hygiene, not a code defect; re-point the five when the doc is next touched. | `docs/tasks/0308_…-a.md` `## Solution` anchor column vs `apps/board/src/collect/panels.tsx` | ACCEPTED |

Pass-2's remaining accepted advisories are unchanged and still stand: the Overview covers only the newest 25 runs without saying so (`panels.tsx:75`, `api.ts:25,174`), and the `Decision` select alone sends no request by design (`api.ts:44-55`, `panels.tsx:437-451`).

#### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 tabs / alias / deep links | MET | `COLLECT_TABS` `apps/board/src/shared/run-selection.ts:24`; `COLLECT_TAB_ALIASES = { results: 'summary' }` `:27`; `parseDeepLink(search, tabs, aliases)` `:75`, alias resolves only to a tab the module has `:89-97`; `resolveSelection(…, 'overview')` `:119`; Collect passes its list and defaults to Overview `apps/board/src/collect/index.tsx:108,121,268`; Daily Voice / ITC calls unchanged (`daily-voice/index.tsx:91`, `itc/index.tsx:91`); tests `apps/board/tests/shared/run-selection.test.ts:138-166` |
| R2 cadence banner | MET | `cadenceState` 6 h / 12 h / `unknown`, future stamp clamped to 0 `apps/board/src/shared/collect.ts:306-322`; `bannerCounts` — failed + `done` without a row, a running run counted `in progress`, a run with a row skipped `:363-381`; the banner prints counts only on an `available` store `apps/board/src/collect/panels.tsx:79,92-101`; tests `apps/board/tests/shared/collect.test.ts:329`, `apps/board/tests/collect/panels.test.tsx` |
| R3 Overview table | MET | Spur `startedAt`/`completedAt`/`status` from the run list `panels.tsx:135-139`; `runDuration` = `completedAt − startedAt`, `—` while running `collect.ts:465-471`; stacked bar + text totals + inserted/updated/label rows `panels.tsx:162-195`; `fallbackShare` `—` at 0 rows `collect.ts:326-330`; `sourceSegments` shares sum to 1 `:341-352`; `no store row`/`in progress` reachable only from an available overview `panels.tsx:143-148` |
| R4 Run detail funnel | MET | `funnelCards` Collected → Stored → Labeled → Downstream, each with `unit`, `unchanged` from the shipped results projection or `unavailable` `collect.ts:407-457`; `makerBreakdown` adds `other` only when present `:394-401`; cards computed only for a loaded available store `panels.tsx:215` |
| R5 label quality | MET | run histogram by value with the four level columns and the effective toggle `panels.tsx:267-296,299-352`; an emptied `effective` states unavailability, never 0 `:308-310`; shipped facts and artifact downloads stay below the funnel `:249-262,355-374` |
| R6 Items browser | MET | 25-row route paging `collect.ts:474-476`; title as a text node, link only for a non-null http(s) `url` with `rel="noreferrer"` `panels.tsx:517-530`; five route-backed filters `api.ts:44-55`, `index.tsx:300-312`; per-run and per-request guards `panels.tsx:422`, `index.tsx:234-249`; escaping asserted `apps/board/tests/collect/panels.test.tsx:354-371` (finding 1 is the one paging gap) |
| R7 unavailable ≠ zeros / shipped tabs intact | MET | `StoreState` renders deduped diagnostics as `role="status"` `panels.tsx:43-55`; three distinct states per store panel `:79,103-109` (Overview), `:215,230-238` (Run detail), `:426-429,470-475` (Items); no `0` for an unreadable store (probe: no `kk-stat-value` in any non-available state); `ProgressPanel`/`ConfigPanel` strings identical to `HEAD` (`panels.tsx:549,571,585,587` vs `git show HEAD:apps/board/src/collect/index.tsx:383,405,409,419,421`) |
| AC1 cadence health | MET | banner + per-run table; store-derived numbers only from a store that answered |
| AC2 per-run trends | MET | per-source bar/totals, fallback share `—` at 0 rows, per-run yield |
| AC3 stage funnel | MET | as R4 |
| AC4 label quality | MET | as R5 |
| AC5 items pager + filters | MET | as R6, with finding 1 recorded and deferred |
| AC6 deep links + shipped tabs | MET | five tabs with `aria-current="page"` `index.tsx:382-392`; address bar kept in sync `index.tsx:273-276`; `?tab=results` → Run detail proven in Chromium `apps/board/tests/installed-board.test.ts:551-563` and unit `run-selection.test.ts:140`; five-tab assertion `installed-board.test.ts:522-527` |

#### The two questions this pass was given

- **Is the `ItemsPanel` derivation correct for all four inputs?** Yes for the three envelope-shaped inputs and for the never-fetched `null`; see the table above, each state probed. The one gap is not in the derivation but in the state it is fed: a *thrown* read and a genuinely un-fetched read are indistinguishable to the component (finding 2), and an out-of-range page is presented as "no matches" (finding 1).
- **Does it reintroduce anything (double diagnostics, missing loading text, a table with a stale `total`)?** No. One `StoreState` per panel with `dedupeDiagnostics` inside it; the three loading texts are textually distinct and each asserted; `page` and `count` are both derived from the single `page` object, so no table can render against a `total` from another envelope or another run.

#### SECUA and architecture

- **Injection:** no HTML sink in `apps/board/src` (`rg 'dangerouslySetInnerHTML|innerHTML|insertAdjacentHTML|eval\('` → no matches); the store title `<script>alert(1)</script>` renders as `&lt;script&gt;` (`panels.test.tsx:354-371`); `item.url` is http(s)-only at the reader (`collect-store.ts:260-264`), so `rel="noreferrer"` links carry no `javascript:` target.
- **Types/robustness:** no `as any`, `@ts-ignore` or `@ts-expect-error` in `apps/board/src/{collect,shared}`; the new race guard is the shared `requestSequence` (`apps/board/src/shared/refresh.ts:32-50`), exercised by `apps/board/tests/shared/refresh.test.ts:53-84`.
- **Accessibility:** diagnostics `role="status"`; `scope="col"` on every header; the CSS bar is `aria-hidden` with the same numbers as adjacent text (`panels.tsx:169-183`); the cadence tone is a class **plus** the state word; tabs are buttons with `aria-current`; pager buttons disable at both ends (probe: `page=1/1` both disabled, `page=2/2` next disabled).
- **Depth:** `shared/collect.ts` stays a DOM-free helper module (thresholds, shares, funnel units, pager) and `panels.tsx` is a handler-free view layer whose only inputs are props — testable without a DOM, which is why these render assertions exist at all. `panels.tsx` is 591 lines across five panels: acceptable now, will want splitting at a sixth surface.

#### Evidence basis (re-checkable, per claim)

| Claim | Basis | How to re-check |
|-------|-------|-----------------|
| Items derivation correct for the four inputs; no pager/count/no-matches/table from an `unavailable` envelope | **First-hand** — my own `renderToStaticMarkup(<ItemsPanel …/>)` over six states (other-run, `null`, `unavailable`, `available`-0-rows, `available` page 2 of 26, no run selected) | a throwaway `bun` script rendering `ItemsPanel` with each envelope and printing the pager/no-matches/table markers |
| Out-of-range page renders `Page 2 of 1 · 3 items` + `No items match these filters.` | **First-hand** — same probe at `page=2, total=3, items=[]`; reachability argued from `index.tsx:349` (run change keeps `page`) and `collect-store.ts:285-330` (the reader echoes `page`) | the same probe with `page:2, total:3`; then read `index.tsx:349` and `:300-312` |
| No stale-`total` table | **First-hand** — `panels.tsx:428-429` derives `page` and `count` from one object; probe shows the pager and rows always agree | read `panels.tsx:422-429,477-478` |
| No double diagnostic | **First-hand** — read of the three panels' `StoreState` call sites + the reader's `row: null` on every unavailable envelope (`collect-store.ts:214-222,246-254`); probe shows one diagnostic line per panel | grep `StoreState` in `panels.tsx`; render `RunDetailPanel` at `{unavailable, row:null}` |
| Targeted suites 88 pass / 0 fail | **First-hand** — re-run in this pass (275 expects, 6 files) | `NODE_ENV=test bun test apps/board/tests/shared apps/board/tests/collect` |
| Full gate PASS on this tree, digest `f6b5cd17…1ea2d` | **Read, not re-run** (the brief pins it as known-good) — `.spur/run/0308-test-gate.log`: 3904 pass / 2 skip / 0 fail, post-check rules pass, digest line at `:308`; `stat` shows the edited sources and tests predate that log | `tail -25 .spur/run/0308-test-gate.log`; `grep -n proof-digest .spur/run/0308-test-gate.log` |
| Five L4 warnings are anchor drift, not mis-citation of the wrong subject matter | **First-hand** — re-ran `spur task check 0308` and compared each cited line with the code at that line | `bun …/spur.js task check 0308`, then `sed -n '<n>p' apps/board/src/collect/panels.tsx` for each of the five |
| Findings 4 and 5 (stale overview payload, cross-run `storeRun`) | **Read from code**, not reproduced — both need effects and timers a static-markup probe cannot drive; the mechanism and its self-heal bound are stated | `index.tsx:149-154,213-218`; `panels.tsx:135-148,198-215,422` |

**Next:** record PASS and let the pipeline advance to verify; the wrap residual is finding 1 (deferred one-line page reset) plus the P4 rows above.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-17T06:57:16.610Z todo → wip (system)
- 2026-10-17T16:18:05.165Z wip → testing (system)
- 2026-10-17T16:19:06.391Z testing → done (system)

