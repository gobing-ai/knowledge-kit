---
schema_version: 1
name: "Collect Summary tab: render the real channel yield (day x source) and per-plugin ingest counts"
status: done
template: feature-impl
created_at: 2026-10-22T17:52:34.011Z
updated_at: "2026-10-23T14:56:57.976Z"
feature_id: G81

ac_altitude: task-local
ac_numbering: task-local
priority: P2
estimate_hours: 8
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0319-verdict.json
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

- [x] R1. Summary renders new-item counts grouped by host-local day and items.source, with row totals, source totals and newest day first. Counts use first_seen_at within explicit [fromMs, untilMs), independent of the loaded Spur run page. The default is trailing 14d; boundary days are labelled partial when applicable.
- [x] R2. A separate per-day table shows COUNT(collect_runs) and sums of each recorded nonnegative integer source_counts_json value, filtered/grouped by collect_runs.started_at. Columns include aihot-ingest, last30days-ingest, horizon-ingest and other observed plugin keys. Absent keys in valid rows mean zero recorded contributions, with invocation health explicitly unknown. Invalid JSON/counts produce unknown plugin totals for the affected day plus a bounded diagnostic. Last-positive contribution time is available per plugin, or unknown if none is recorded.
- [x] R3. 24h/7d/14d/30d/All selection updates both tables and preserves range and tab in the URL. Invalid/missing range defaults to 14d. All starts at epoch 0; aggregate-day pagination bounds every response to 30 distinct days while totals cover the entire requested interval.
- [x] R4. One GET-only server aggregate returns both tables per page through the existing loopback KK reader security envelope. No raw item pagination/body payload, SQL from the browser, store writes, migrations or new dependency is introduced.
- [x] R5. Summary removes unsupported native-mode label/labeled/yield totals, ratios and trends rather than displaying fabricated zeros. Verified empty counts remain 0; unavailable/malformed evidence is —. A zero denominator never produces a percentage. Existing real loopback facts and non-Summary tabs retain their contracts.
- [x] R6. Missing/locked/unreadable/newer-schema store or offline reader degrades the new panels with bounded diagnostics; execution progress, workflow config, existing run selection and native run history still render. Responses for an old range cannot overwrite a newer selection.
- [x] R7. Update docs/04_DESIGN.md, docs/design/workflow-board-modules.md and the owning collect-store-views.md route contract with the change. Extend installed-package Chromium acceptance first and retain repeatable fixture results plus a timestamped live observation under docs/report/0319-collect-summary.md.

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

- [x] Step 0 (R1–R7): preserve the starting dirty tree; recheck DAO/CLI callers, pins and verified global Spur path. Capture fixed-clock fixture bounds, schema and row counts before writing implementation.
- [x] Step 1 (R1–R7): extend apps/board/tests/installed-board.test.ts first with real fixture stores and Chromium/network assertions for ranges, All pagination, unknowns, stale responses and unavailable reader/store; save expected/observed evidence under docs/report/0319-collect-summary.md. Use existing installed-package helpers. If isolated failure checks are necessary, enumerate failures first and add them before production edits to apps/cli/tests/board/reader.test.ts and collect-store.test.ts.
- [x] Step 2 (R1,R2,R4): extend collectView queries compatibly and add typed server projection with bound intervals, validated plugin counts, last-positive contribution times and 30-day aggregate pages.
- [x] Step 3 (R3,R4,R6): add the exact reader route/query parser and shared client method with a distinct loopback aggregate origin; retain native history access and read-only/error controls.
- [x] Step 4 (R1–R6): render shared tables on Collect Summary, persist range and aggregate page, guard stale responses, remove unsupported Summary label/yield tiles and keep other tabs intact.
- [x] Step 5 (R7): update docs/04_DESIGN.md, workflow-board-modules.md and collect-store-views.md; record the shared contract for 0320. Run installed-package Chromium against the real reader/store and append a timestamped live-store observation without freezing mutable production counts as assertions.
- [x] Step 6 (R1–R7): run bun run lint, bun run test, bun run build and applicable spur rule gates; task/feature structural checks; review only owned diff and retain evidence. This refine does not execute implementation or claim product verification PASS.

### Solution

| File | What / why |
| --- | --- |
| `apps/board/src/contracts.ts:237-273` | Frozen type-only `StoreChannelsQuery` + `CollectChannelYield` (`byDay`/`runsByDay`/`bySource`/`lastPositiveAt`) for the channels route. |
| `packages/kk-store/src/dao/collect-view.ts:70-83,226-247,394-483` | `channelYield(sinceMs, untilMs?)` keeps the legacy single-arg path and bounds the upper edge; new `channelRunYield(fromMs, untilMs)` groups `collect_runs` by local day and validates `source_counts_json` to nonnegative integers, nulling only a malformed day's plugin totals and computing `lastPositiveAt` over retained history. |
| `packages/kk-store/src/index.ts:30-44` | Export the two new DAO types. |
| `apps/cli/src/board/collect-store.ts:92-101,463-574` | `storeChannels` opens the store read-only (`migrate:false`, `finally` close) and composes the two aggregates into one 30-day page with zero-filled days and a bounded malformed-count diagnostic. |
| `apps/cli/src/board/reader.ts:794-950,620-622,658-696` | `parseChannelsQuery` enforces required `from<until` nonnegative safe integers + `page` (default 1), rejects duplicates/extra keys; the `store/channels` route reuses the loopback origin/host/method envelope. |
| `apps/board/src/shared/api.ts:92-98,114,144,254-257,789-792` | `BoardClient.storeChannels` always targets a distinct loopback `aggregateReaderOrigin` (default 4340), never the native Spur DB API, even in same-origin mode. |
| `apps/board/src/shared/channel-yield.tsx:1-143` | Two data-only presentational tables (day × source with totals; day × tick/plugin with last-positive times) plus honest partial-day labelling. |
| `apps/board/src/collect/panels.tsx:86-206` | SummaryPanel rewritten around the channels aggregate: range pills, both tables, aggregate pager, explicit unavailable/malformed states; the old KPI/chart/label/yield tiles are removed (R5). |
| `apps/board/src/collect/index.tsx:90-116,147-191,354-382,` plus the range URL-sync effect | Resolves a separate loopback aggregate origin, loads channels with a sequence token (stale range responses never win), persists `range` beside `tab`/`run`, resets the aggregate page on range change. |
| `apps/cli/tests/board/collect-store.test.ts`, `apps/cli/tests/board/reader.test.ts`, `apps/board/tests/shared/api.test.ts`, `apps/board/tests/collect/panels.test.tsx`, `apps/board/tests/installed-board.test.ts` | Real-DAO/reader/Chromium tests: both tables, day grouping + zero-fill, malformed-day unknowns, last-positive, 30-day paging, origin/method/query refusals, range persistence, missing-store degradation. |
| `docs/04_DESIGN.md`, `docs/design/workflow-board-modules.md`, `docs/design/collect-store-views.md`, `docs/report/0319-collect-summary.md` | Surface docs updated with the frozen route/shape and the aggregate-origin note; the report records fixture expectations and evidence. |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/kk-store/src/dao/collect-view.ts:394-421` channelYield groups first_seen_at by local day × source within [fromMs, untilMs); `apps/board/src/shared/channel-yield.tsx:52-92` row/source totals, newest-first, partial labels; `apps/board/src/collect/index.tsx:94-112` default 14d independent of the run page; `apps/board/tests/installed-board.test.ts:1392-1428` real reader route returns the bounded matrix |
| R2 | MET | `packages/kk-store/src/dao/collect-view.ts:226-240` validated nonnegative-integer source_counts parse; `packages/kk-store/src/dao/collect-view.ts:434-480` per-day ticks, malformed-day null plugins, last-positive; `apps/cli/src/board/collect-store.ts:497-576` zero-fill + bounded diagnostic; `apps/board/src/shared/channel-yield.tsx:104-106` invocation-health-unknown caption asserted at `apps/board/tests/collect/panels.test.tsx:731-732` |
| R3 | MET | `apps/board/src/collect/index.tsx:94-112` invalid/missing → 14d, All → epoch 0; `apps/board/src/collect/index.tsx:480-484` range persisted in the URL; `apps/cli/src/board/collect-store.ts:531-541` 30-day aggregate pages with full-interval totals; `apps/board/tests/installed-board.test.ts:1430-1446` range=7d survives reload; `apps/board/tests/installed-board.test.ts:1448-1464` All pages at 30 days |
| R4 | MET | `apps/cli/src/board/reader.ts:638-661` origin/host/GET-only envelope precedes routing; `apps/cli/src/board/reader.ts:699-703` channels route; `apps/cli/src/board/reader.ts:927-951` strict from/until/page parser; `apps/cli/src/board/collect-store.ts:122-125` openStore migrate:false; `apps/board/src/shared/api.ts:254-255` aggregate pinned to a validated loopback origin; `apps/cli/tests/board/collect-store.test.ts:89` missing DB never created |
| R5 | MET | `apps/board/src/collect/panels.tsx:94-206` SummaryPanel on the channels aggregate, no label/yield tiles or ratios; `apps/board/tests/collect/panels.test.tsx:734-738` absence asserted; `apps/board/tests/installed-board.test.ts:1430-1446` Label Decisions / Selection Yield absent in real Chromium |
| R6 | MET | `apps/cli/src/board/collect-store.ts:467-483` unavailable envelope, no fabricated zeros; `apps/board/src/collect/index.tsx:354-373` sequence-token stale-range guard tested `apps/board/tests/collect/panels.test.tsx:1300-1331`; `apps/board/tests/installed-board.test.ts:1466-1482` missing store degrades only the two panels, run selection intact |
| R7 | MET | `docs/04_DESIGN.md:394` channels route; `docs/design/collect-store-views.md:63-107` Summary contract; `docs/design/workflow-board-modules.md:378-384` module doc; `docs/report/0319-collect-summary.md:1-159` fixture/command/live evidence (interval totals `docs/report/0319-collect-summary.md:146-149`) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — The matrix matches kk store stats (req: R1) | MET | test | `apps/board/tests/installed-board.test.ts:1392-1428` route totals over the seeded store; partial-day labels `apps/board/tests/collect/panels.test.tsx:1258-1298`; bounded-SQL fixture in `apps/cli/tests/board/collect-store.test.ts:89` file suite; `bun run test` this run: 4189 pass, 0 fail, 3 skip, exit 0 |
| AC2 — A source that delivered nothing is visible as zero (req: R2) | MET | test | `apps/board/tests/collect/panels.test.tsx:731-732` zero recorded contributions + health unknown; caption `apps/board/src/shared/channel-yield.tsx:104-106`; malformed-day null plugins `packages/kk-store/src/dao/collect-view.ts:434-480` |
| AC3 — The range pills scope the data and survive reload (req: R3) | MET | test | `apps/board/tests/installed-board.test.ts:1430-1446` range=7d + tab=summary survive reload; `apps/board/tests/installed-board.test.ts:1448-1464` All pages 30 days/page |
| AC4 — One read-only projection, no raw item paging (req: R4) | MET | test | `apps/cli/tests/board/reader.test.ts:825-841` POST 405 / foreign origin 403 / malformed 400 / cross-workflow 404; `apps/cli/tests/board/reader.test.ts:776-799` duplicate/extra-key refusals; `apps/board/tests/installed-board.test.ts:1392-1428` one response carries both tables; `apps/cli/tests/board/collect-store.test.ts:89` missing DB not created |
| AC5 — No fabricated numbers remain in the tab (req: R5) | MET | test | `apps/board/tests/collect/panels.test.tsx:734-738`; `apps/board/tests/installed-board.test.ts:1430-1446`; zero-fill of known days `apps/cli/src/board/collect-store.ts:549-556` |
| AC6 — An unavailable store degrades only the two panels (req: R6) | MET | test | `apps/board/tests/installed-board.test.ts:1466-1482`; `apps/board/tests/collect/panels.test.tsx:1300-1331` stale range dropped; envelope `apps/cli/src/board/collect-store.ts:467-483` |
| AC7 — Surface docs and a verification artifact ship with the change (req: R7) | MET | command | `grep -c store/channels docs/04_DESIGN.md docs/design/collect-store-views.md docs/design/workflow-board-modules.md docs/03_ARCHITECTURE.md` → 1/2/1/1 this run, reports present (`test -f`); `docs/design/collect-store-views.md:63-173`; `docs/04_DESIGN.md:394`; `docs/design/workflow-board-modules.md:378-384`; `docs/report/0319-collect-summary.md:1-159` |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 0319 (round 3, final certification)
**Scope:** 0319 working-tree change set vs `a5605d3` — 19 files, +1638/−571; only change since round 2 is the interval-totals correction at `docs/report/0319-collect-summary.md:146-149`
**Dimensions:** functional, security, efficiency, correctness, usability, architecture
**Verdict:** PASS
**Confidence:** MEDIUM

Round 3 certified after round 2's PARTIAL (exactly one open P3). Round 2's single open finding — the
wrong interval-totals sentence — was re-verified fixed independently this round, then a final short
adversarial pass re-derived every number in the verification artifact from the frozen snapshot. No
new finding.

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P3 (minor) | correctness | round-2 finding, now fixed and verified three ways this round: (a) exact-window SQL `[1791496459000, 1792706059000)` against `.works/tmp/live-snapshot-20261022T215415Z.db` returns `76 \| 760 \| 2959 \| 480`; (b) Python column-sum of the published Table 2's 15 rows returns `[76, 760, 2959, 480]`; (c) per-day SQL rows are value-identical to Table 2's 15 rows. The sentence now states **76 ticks, aihot-ingest 760, last30days-ingest 2959, horizon-ingest 480** plus the 78-tick whole-store note (store count re-confirmed: 78, so "all but two"). Cause confirmed: the old numbers are exactly what the approximating lower bound `started_at >= 1792000000000` yields (re-run: `50 \| 500 \| 1920 \| 288`) | `docs/report/0319-collect-summary.md:146-149` | RESOLVED (fixed on tree; verified this run) |
| 2 | P4 (advisory) | efficiency | carried from round 1: `channelRunYield`'s last-positive scan loads every retained `collect_runs` row before `untilMs` into JS; bounded only by retained history, fine at current scale | `packages/kk-store/src/dao/collect-view.ts:456-471` | ACCEPTED |
| 3 | P4 (advisory) | correctness | carried from round 1: `hostTimeZone()` is typed `string` but `Intl.DateTimeFormat().resolvedOptions().timeZone` can be `undefined` on exotic runtimes (see `apps/cli/src/board/collect-store.ts:463-465`) | `apps/cli/src/board/collect-store.ts:463-465` | ACCEPTED |

##### Adversarial pass this round (all clean)

- Table 1 fully re-derived: day rows via SQL = `5,19,21,24,21,23,34,38,56,25,33,7,19,45,18` (matches the table and the report's `stats --days 14 --json` parenthetical); per-source SQL = grounding 13 / aihot 35 / github 5 / polymarket 28 / hackernews 45 / reddit 44 / rss 117 / youtube 101 (matches the stated line exactly); both sum to 388.
- `store stats --days 14 --json` re-run against the snapshot this round: byDay totals and bySource identical to the report's claims.
- Window arithmetic: 1792706059000 − 1791496459000 = 1,210,000,000 ms = exactly 14d; endpoints match the stated 2026-10-08T14:54:19 PDT .. 2026-10-22T14:54:19 PDT.
- Observed plugin keys in the store are exactly `aihot-ingest`, `last30days-ingest`, `horizon-ingest` (re-run).
- The "no `horizon-ingest` key" wording for 2026-10-21/22 is literal: 5/5 and 2/2 ticks on those days return NULL for that key (missing key, not recorded-0) — matches the R2/AC2 semantics the fixture pins.
- No other numeric claim in the artifact remains unverified; rounds 1–2 already swept the 19-file change set (DAO bounds/validation, reader envelope + parser, paging/zero-fill, loopback client origin, Summary rewrite, tests).

##### Verification run this round

- sqlite3 exact-window totals → `76|760|2959|480`, exit 0.
- sqlite3 per-day rows (15) → value-identical to Table 2, exit 0.
- sqlite3 whole-store tick count → 78, exit 0; distinct plugin keys → exactly the three stated, exit 0.
- sqlite3 Table 1 day rows + per-source breakdown → identical to the report; both total 388, exit 0.
- sqlite3 NULL-check on horizon-ingest for 2026-10-21/22 → 7/7 missing key, exit 0.
- sqlite3 cause check (bound `1792000000000`) → `50|500|1920|288`, exit 0.
- Python column-sum of Table 2 → `[76, 760, 2959, 480]`, exit 0.
- `bun apps/cli/src/index.ts store stats --days 14 --json --db <snapshot>` → byDay/bySource identical to the report, exit 0.
- Full tier (`bun run test`, `spur self exec check`) not re-run per brief — PASSed twice on this tree (receipt `.spur/run/0319-check-receipt.json` — LOST with the agent worktree per ADR-131; the inline sqlite3 evidence above stands); `bun run lint` exit 0 after the markdown edit.

##### Residual risk

Two accepted P4s (findings 2–3) ship as-is: a history-bounded last-positive scan and a `string`-typed timezone helper. Neither affects correctness at current scale; both were carried and accepted since round 1. The live-store snapshot is gitignored, disposable and never asserted in tests.

**Final disposition:** all P1–P3 findings closed across three rounds (round-1 P2 + two P3s closed in round 2; round-2 P3 closed and re-verified here); R1–R7 MET, AC1–AC7 MET.

**Next:** → `done` (approval decision).

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
- 2026-10-22T20:44:27.907Z todo → wip (system)
- 2026-10-22T22:41:12.939Z wip → testing (system)
- 2026-10-22T22:43:38.790Z testing → done (system)

