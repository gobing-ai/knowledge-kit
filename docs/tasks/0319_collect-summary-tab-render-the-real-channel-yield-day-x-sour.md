---
schema_version: 1
name: "Collect Summary tab: render the real channel yield (day x source) and per-plugin ingest counts"
status: todo
template: feature-impl
created_at: 2026-10-22T17:52:34.011Z
updated_at: "2026-10-22T18:47:20.752Z"
feature_id: G81

ac_altitude: task-local
ac_numbering: task-local
priority: P2
estimate_hours: 8
---

## 0319. Collect Summary tab: render the real channel yield (day x source) and per-plugin ingest counts

### Background

The Collect Summary must answer how many new items arrived by source and how many input documents were recorded by ingestion plugin. Current SummaryPanel sums only the loaded run page; its range state starts at 24h and is not an aggregate-store filter (apps/board/src/collect/index.tsx; collect/panels.tsx). Native mode uses nativeStoreOverview in shared/api.ts, hardcoding label/yield zeros and even returning availability=available on request failure. The loopback storeOverview already reads real label/selection aggregates; preserve that valid path.

CollectViewDao.channelYield(sinceMs) in packages/kk-store/src/dao/collect-view.ts groups items.first_seen_at by host-local day and items.source. statsAction in apps/cli/src/commands/store.ts computes Date.now() minus days*86400000 and prints ONLY that channel matrix, not a second per-plugin table. source_counts_json in collect_runs is plugin contribution provenance recorded at ingest, not proof of plugin invocation or failure. Store ticks and new-item counts measure different populations.

Live .works/kk.db is investigation evidence, not an immutable oracle: at this audit its 2026-10-22 item counts were aihot=1, github=1, grounding=2, polymarket=1 (total 5), differing from the filed snapshot. 2026-10-21 remains total 19. Implementation acceptance uses a fixed-clock fixture plus a timestamped live observation.

**Refine corrections (2026-10-22)**
- “Two tables printed by stats” → statsAction prints one matrix → implement the plugin table as a new projection.
- Calendar snapshot and moving --days query treated as stable expected values → live rows have changed and the CLI uses a trailing instant → freeze explicit [fromMs, untilMs) bounds and mark partial days.
- Transport left preferred/fallback → Collect defaults to native Board origin whereas Daily defaults to the loopback reader → explicitly use the configured loopback reader for aggregates in either mode, with no raw-item fallback.
- All plus a 30-day maximum payload → unbounded All contradicted the bound → paginate aggregate days, 30 days per page.
- Missing plugin key claimed a successful zero-doc call → only contribution provenance is stored → show zero recorded contributions with invocation health unknown; malformed evidence stays unknown.
- Empty labels/selections required unknown even on a successful aggregate read → actual COUNT=0 is valid → remove unsupported native Summary label/yield tiles; preserve measured zeros from the reader.
- Plan and metadata absent → freeze ownership, verification, P2 and 8h estimate below.

### Requirements

- [ ] R1. Summary renders new-item counts grouped by host-local day and items.source, with row totals, source totals and newest day first. Counts use first_seen_at within explicit [fromMs, untilMs), independent of the loaded Spur run page. The default is trailing 14d; boundary days are labelled partial when applicable.
- [ ] R2. A separate per-day table shows COUNT(collect_runs) and sums of each recorded nonnegative integer source_counts_json value, filtered/grouped by collect_runs.started_at. Columns include aihot-ingest, last30days-ingest, horizon-ingest and other observed plugin keys. Absent keys in valid rows mean zero recorded contributions, with invocation health explicitly unknown. Invalid JSON/counts produce unknown plugin totals for the affected day plus a bounded diagnostic. Last-positive contribution time is available per plugin, or unknown if none is recorded.
- [ ] R3. 24h/7d/14d/30d/All selection updates both tables and preserves range and tab in the URL. Invalid/missing range defaults to 14d. All starts at epoch 0; aggregate-day pagination bounds every response to 30 distinct days while totals cover the entire requested interval.
- [ ] R4. One GET-only server aggregate returns both tables per page through the existing loopback KK reader security envelope. No raw item pagination/body payload, SQL from the browser, store writes, migrations or new dependency is introduced.
- [ ] R5. Summary removes unsupported native-mode label/labeled/yield totals, ratios and trends rather than displaying fabricated zeros. Verified empty counts remain 0; unavailable/malformed evidence is —. A zero denominator never produces a percentage. Existing real loopback facts and non-Summary tabs retain their contracts.
- [ ] R6. Missing/locked/unreadable/newer-schema store or offline reader degrades the new panels with bounded diagnostics; execution progress, workflow config, existing run selection and native run history still render. Responses for an old range cannot overwrite a newer selection.
- [ ] R7. Update docs/04_DESIGN.md, docs/design/workflow-board-modules.md and the owning collect-store-views.md route contract with the change. Extend installed-package Chromium acceptance first and retain repeatable fixture results plus a timestamped live observation under docs/report/0319-collect-summary.md.

### Acceptance Criteria

```gherkin
Scenario: AC1 — The matrix matches kk store stats (req: R1)
  Given a fixed-clock store fixture with source rows inside and outside a trailing 14d interval, including a local-day boundary
  When installed-package Chromium opens Collect Summary
  Then cells and totals equal direct bounded SQL and statsAction run at the same frozen clock for that fixture
  And descending local-day groups and partial-day labels are visible regardless of loaded run history

Scenario: AC2 — A source that delivered nothing is visible as zero (req: R2)
  Given valid tick rows omitting horizon-ingest and one malformed-count day
  When the plugin table renders
  Then the valid day shows horizon-ingest 0 recorded contributions with its tick count and invocation health unknown
  And last-positive contribution time or unknown is shown
  And malformed-day plugin totals are unknown with a diagnostic

Scenario: AC3 — The range pills scope the data and survive reload (req: R3)
  Given a store spanning more than 30 distinct days and the default 14d Summary
  When Chromium selects 7d, reloads, then selects All and advances the aggregate page
  Then range=7d survives the reload with Summary selected
  And All totals cover all data while each response has at most 30 day keys

Scenario: AC4 — One read-only projection, no raw item paging (req: R4)
  Given the real KK reader and a fixture database with recorded schema and table counts
  When Chromium loads one Summary aggregate page
  Then one channels response supplies both tables without any items paging request or item bodies
  And schema/table counts remain unchanged and a missing database is not created
  And reader tests reject non-GET, invalid origin and malformed/extra query keys

Scenario: AC5 — No fabricated numbers remain in the tab (req: R5)
  Given native Board mode whose collect_runs response contains no label or selection facts
  When Summary renders
  Then unsupported label/yield tiles and trends are absent or explicitly unknown
  And a successful real reader count of zero remains zero and no zero-denominator ratio renders

Scenario: AC6 — An unavailable store degrades only the two panels (req: R6)
  Given missing, busy-timeout or newer-schema stores, an offline reader, and reversed range response order
  When Chromium renders Summary and changes range
  Then bounded diagnostics replace affected aggregates while execution/config/history remain usable
  And the old range response never replaces the current range

Scenario: AC7 — Surface docs and a verification artifact ship with the change (req: R7)
  Given passing installed-package fixture acceptance
  When the implementation is reviewed
  Then the three owning surface documents describe the frozen contract
  And docs/report/0319-collect-summary.md records commands, fixture expectations, network/read-only evidence and timestamped live tables
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-22T18:47:18.921Z

Closed 2026-10-22: choose server-side aggregation in the KK reader. Browser-side native database pagination is rejected because it cannot bound input rows and would expose unnecessary item data. No upstream Spur server extension is required.

Closed: 0319 owns the reusable contract, DAO queries, transport and presentational tables; 0320 owns episode context and funnel. Implement 0319 before 0320. No task merge or feature relink is proposed.

Closed: missing plugin keys measure zero recorded contributions, not successful execution; plugin health and omitted failed invocations cannot be reconstructed from collect_runs. Actual historical plugin execution telemetry is out of scope.

Closed: preserve valid zeros, use unknown for absent evidence, remove unsupported native Summary label/yield metrics. Do not broaden into fixing nativeStoreRun, Items or Selections.

### Design

**WHAT/WHY/WHERE.** Extend the existing read-only reader/DAO seam; do not add a service, dependency, migration or generic browser SQL path. Primary targets: packages/kk-store/src/dao/collect-view.ts and src/index.ts; apps/cli/src/board/collect-store.ts and reader.ts; apps/board/src/contracts.ts, shared/api.ts, collect/index.tsx and collect/panels.tsx. Add shared/channel-yield.tsx for the two reusable presentational tables. 0320 consumes this contract and component; no upstream task is required. ADR-035 already authorizes Collect read-only store projections; document the added route without widening its authorization.

**Frozen HTTP contract.** GET /api/workflows/kk-collect/store/channels?from=<ms>&until=<ms>&page=<n>. Require from/until as nonnegative safe integer epoch ms with from < until, page as positive safe integer (default 1); reject duplicates and extra keys with board.query.invalid/400. Use existing method/origin/project checks, openStore({migrate:false}), unknown-migration detection and finally-close behavior. No caller-selected DB path. Export CollectChannelYield and StoreChannelsQuery; BoardClient.storeChannels(query) always targets its configured loopback aggregate origin. Add aggregateReaderOrigin to BoardClientOptions, defaulting to DEFAULT_READER_ORIGIN; the Collect module resolves a valid kkApi override through readerOriginFrom using the loopback default independently of its native client. Other existing methods keep their origin behavior. Same-origin mode never silently redirects aggregates to the native database API. A remote browser must have a reachable configured local reader; offline means unavailable.

Response: {schemaVersion:1, availability:'available'|'unavailable', fromMs, untilMs, timeZone, page, pageSize:30, totalDays, sources:string[], plugins:string[], byDay:[{day,total,sources:Record<string,number>}], bySource:Record<string,number>, runsByDay:[{day,runs,plugins:Record<string,number>|null}], lastPositiveAt:Record<string,number|null>, diagnostics:BoardDiagnostic[]}. timeZone is the reader host's IANA zone, consistent with SQLite localtime; render it explicitly. sources is the union of observed channels over the requested interval, sorted; plugins is the three named defaults plus observed keys, sorted. bySource covers the full interval, not just the page. totalDays and pagination use the union of item/tick local-day keys sorted descending; zero-fill the missing side of a known day. No synthetic empty calendar days are required. Unavailable replies carry empty arrays/maps and a diagnostic, never usable zero totals. Page beyond the last is an empty page with correct totals. lastPositiveAt is the last valid positive tick timestamp before untilMs over retained history, not just this page; null means no recorded contribution.

**Queries.** Preserve channelYield(sinceMs)'s existing callers by adding optional untilMs; absent upper bound keeps legacy behavior. Use bound first_seen_at >= fromMs AND first_seen_at < untilMs for this route. Add channelRunYield(fromMs, untilMs) for daily plugin counts and tick counts, using started_at as an ingest timestamp, never a duration. Validate source_counts_json maps and nonnegative integer values before summing; a malformed row invalidates the plugin totals of its day, without losing that day's tick count or unrelated item counts. Avoid interpolating plugin names into JSON paths; reuse existing parsing conventions or guarded json_each. Extend DAO export types explicitly. Aggregate in SQL/bounded per-day projection, not browser item scans. Last-positive query ignores invalid rows and reports their diagnostic.

**Range and rendering.** A single captured Date.now() provides untilMs per load; fromMs = untilMs - N*86400000 for 24h/7d/14d/30d, and 0 for All. Persist range alongside existing tab/run URL state, reset aggregate page on range changes, preserve requestSequence-style stale-response protection. Label trailing instant windows honestly (partial first/last days); do not promise N complete calendar days. Aggregate paging is independent of Spur run-history paging. Shared tables take data only; modules own fetching and degradation.

**Concurrency/preconditions.** Audit baseline main acfc90b has substantial pre-existing source/doc changes, including collect-view.ts, store.ts and tests; preserve them and re-read their diff at implementation start. git worktree list shows only the main checkout; spur task list --status wip returned []. Bun 1.4.3 and Biome 2.5.15 match pins. Explicit bun-global Spur 0.4.20 is the audit CLI; tools:fresh detects stale duplicate resolution inside Bun subprocesses. Step 0 uses the verified bun-global CLI without deleting or changing host installs.

**Non-goals/anti-patterns.** No store writes, current config guessed as historical fact, chart library, plugin health claim from absent keys, broad native-client repairs, runtime install sync or workflow edit. Tables do not depend on store availability for unrelated UI. Verification uses actual reader/store, not a mocked aggregate collaborator.

### Plan

- [ ] Step 0 (R1–R7): preserve the starting dirty tree; recheck DAO/CLI callers, pins and verified global Spur path. Capture fixed-clock fixture bounds, schema and row counts before writing implementation.
- [ ] Step 1 (R1–R7): extend apps/board/tests/installed-board.test.ts first with real fixture stores and Chromium/network assertions for ranges, All pagination, unknowns, stale responses and unavailable reader/store; save expected/observed evidence under docs/report/0319-collect-summary.md. Use existing installed-package helpers. If isolated failure checks are necessary, enumerate failures first and add them before production edits to apps/cli/tests/board/reader.test.ts and collect-store.test.ts.
- [ ] Step 2 (R1,R2,R4): extend collectView queries compatibly and add typed server projection with bound intervals, validated plugin counts, last-positive contribution times and 30-day aggregate pages.
- [ ] Step 3 (R3,R4,R6): add the exact reader route/query parser and shared client method with a distinct loopback aggregate origin; retain native history access and read-only/error controls.
- [ ] Step 4 (R1–R6): render shared tables on Collect Summary, persist range and aggregate page, guard stale responses, remove unsupported Summary label/yield tiles and keep other tabs intact.
- [ ] Step 5 (R7): update docs/04_DESIGN.md, workflow-board-modules.md and collect-store-views.md; record the shared contract for 0320. Run installed-package Chromium against the real reader/store and append a timestamped live-store observation without freezing mutable production counts as assertions.
- [ ] Step 6 (R1–R7): run bun run lint, bun run test, bun run build and applicable spur rule gates; task/feature structural checks; review only owned diff and retain evidence. This refine does not execute implementation or claim product verification PASS.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

Parent feature: G81 (Collect module redesign: store-backed run results, progress and yield).

Prior art in this checkout:
- `kk store stats` — `apps/cli/src/commands/store.ts` (`statsAction`, `renderChannelTable`) and `apps/cli/tests/commands/store.test.ts`.
- `CollectViewDao.channelYield` — `packages/kk-store/src/dao/collect-view.ts`.
- Reader surface and its security envelope — `apps/cli/src/board/reader.ts`, `apps/cli/src/board/collect-store.ts`, tasks 0307/0308/0309.
- Module surface — `apps/board/src/collect/index.tsx`, `apps/board/src/collect/panels.tsx` (`SummaryPanel`), `apps/board/src/shared/api.ts` (`nativeStoreOverview`), `apps/board/src/shared/collect.ts`.
- Evidence for the investigation that produced this task: `.works/kk-daily-ai-voice2/20261022/` (no-content run), `.works/kk.db` (`items`, `collect_runs`).

### History

- 2026-10-22T17:54:08.204Z backlog → todo (system)

