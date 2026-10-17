---
name: Collect store views
kind: design
status: accepted-design
feature_id: G81
related: [G8, G31, G32, ADR-035]
created_at: 2026-10-16
updated_at: 2026-10-16
---

# Collect store views

Accepted design for G81, not a shipped surface. ADR-035 (amendment 2026-10-16) owns the decision;
[Workflow Board modules](workflow-board-modules.md) still owns the shell, run selection, reader
security envelope, capture and the other two modules. This document only adds the Collect module's
read-only view of `.works/kk.db`.

## 1. What the operator needs to see

`kk-collect` runs every 6 h: lock → collect (fan-in 3 sources) → store (`kk store ingest`) → label
(`kk store label`) → release. The daily voice workflow later selects from the store. The shipped
module shows that run's artifact files; it cannot answer:

| Question | Source of truth |
| --- | --- |
| Is collection keeping cadence? Which ticks failed or stored nothing? | Spur run history (status, timing) |
| What did this run add — per source, new vs updated? | `collect_runs` (+ `store-result.json` for `unchanged`) |
| How were the items labelled, and how often did the model fall back? | `labels` rows with `run_id = <run>` |
| What is each item's effective label now? | `LabelsDao.currentFor(ids, policy)` (`labels_current`) |
| What became of the items — selected, published, dropped? | `selections` joined on `items.first_seen_run` |

Live evidence (2026-10-16): 47 `collect_runs` (all `done`), 333 items / 322 stories, 5225 label rows
(heuristic/LOW 2995, model HIGH 1314 / MEDIUM 493 / LOW 188, default/LOW 235), 138 selections
(56 published, 82 dropped, all `kk-daily-ai-voice2`, topic `ai-news`).

**Recorded facts the design must not misread.**

1. `collect_runs.started_at == finished_at` (max spread 167 ms): stamped at ingest. Never present it
   as duration; duration is Spur `completedAt − startedAt`.
2. Only runs that reach `store` write a row; failed ticks exist only in Spur. A missing row is
   shown as `no store row` with the Spur outcome.
3. `inserted + updated` counts items written; "labeled" counts distinct items with a label row in the
   run; "label rows" counts observations (one per item × decision × maker). Every funnel stage names
   its unit.

## 2. Module layout

Tabs (deep-linkable `?run=&tab=`, shipped run selector and 25-row paging unchanged):

| Tab id | Label | Content |
| --- | --- | --- |
| `overview` (default) | Overview | cadence banner + per-run table for the current run-list page |
| `summary` | Run detail | funnel, per-source counts, label quality, artifact downloads (shipped Results folds in here) |
| `items` | Items | paged items browser for the selected run |
| `progress` | Execution progress | shipped |
| `config` | Workflow Config Summary | shipped |

Shipped `?tab=results` links resolve to `summary` (no dead links): `parseDeepLink` takes optional
`tabs` and `aliases` (defaults = shipped `BOARD_TABS`, no aliases), so Daily Voice and ITC are unchanged.

**Overview.** Banner: time since the last stored collection vs the 6 h schedule — `on schedule`
(≤ 6 h), `late` (≤ 12 h), `stalled` (> 12 h), `unknown` without `lastStoredAt`; plus counts of `failed`
runs and `done` runs with no store row on the page. Spur records no distinct "skipped" state, so none
is counted; a running run without a row shows `in progress`. Table, one row per Spur run on the current page: started (Spur), duration (Spur), Spur status,
collected per source (stacked inline bar, plain CSS), inserted, updated, label rows, fallback share
(`default` rows / label rows), yield `selected · published · dropped`. Rows link to Run detail.

**Run detail.** Funnel cards left-to-right: Collected (sum + per source) → Stored (inserted / updated /
unchanged, `unchanged` from the shipped artifact projection or `unavailable`) → Labeled (distinct
items; label rows by source heuristic / model / default) → Downstream (items first seen in this run
that were selected / published / dropped). Below: label quality — per decision, a value histogram of
this run's own rows with HIGH/MEDIUM/LOW counts; a toggle shows the effective (`labels_current`)
distribution over the same items. Then the shipped core-facts preview and artifact downloads.

**Items.** Table of items with `last_seen_run = run` or `first_seen_run = run`: title (link to
`canonical_url`, `rel="noreferrer"`), source, `new`/`re-seen`, story id, effective labels as chips,
selection status (`none` when no row). Filters: source, seen, decision + value, selection. 25 per page.
All text rendered as React text nodes; no HTML from the store.

No chart library: bars are CSS widths, consistent with the board's "no new UI framework" rule.

## 3. Reader routes

All GET/HEAD, loopback, origin-checked, `schemaVersion: 1`, same refusal codes as §9 of the board
design. The store is opened per request with `openStore({path: <project>/.works/kk.db,
migrate:false})` and closed in `finally` (ponytail: per-request open; add a cached handle if reader
latency is measured to matter). The label policy is `readStoreConfig(resolveKkConfigPath()).labels`,
the same one `kk store` uses.

| Route | Query | Identity |
| --- | --- | --- |
| `/api/workflows/kk-collect/store/overview` | `runs=<id>,…` (1–25 ids, each matching the reader's `^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$` run-id rule) | ids only select rows; no Spur call |
| `/api/workflows/kk-collect/runs/<id>/store` | none | `authorizeRun` (project + Spur run workflow; no capture needed) |
| `/api/workflows/kk-collect/runs/<id>/store/items` | `page` (≥1), `source`, `seen` (`new\|reseen`), `decision`+`value`, `selection` (`selected\|published\|dropped\|none`) | `authorizeRun` |

`source` must be one of the store's distinct `items.source` values; `decision` one of
`ITEM_DECISION_IDS`; `value` ≤ 64 chars of `[A-Za-z0-9._-]`; anything else → 400
`board.query.invalid`. Query parsing moves after route matching, so the shipped "no query parameters"
refusal stays for every other route. `authorizeRun` is the project and run-detail half of the shipped
`authorize()` (which now delegates to it); store rows exist for runs that predate capture, so the
store routes do not require a capture record. Any
workflow other than `kk-collect` on a store route → 404 `board.route.unknown`.

```ts
interface CollectStoreAvailability { availability: 'available' | 'unavailable'; diagnostics: BoardDiagnostic[] }

interface CollectRunStoreRow {
    runId: string;
    sourceCounts: Record<string, number>;
    inserted: number;
    updated: number;
    labelRows: number;
    labeledItems: number;
    labelRowsBySource: Record<'heuristic' | 'model' | 'default' | string, number>;
    yield: { selected: number; published: number; dropped: number };
}

interface CollectStoreOverview extends CollectStoreAvailability {
    schemaVersion: 1;
    lastStoredAt: string | null;   // max(collect_runs.finished_at), RFC 3339
    rows: Record<string, CollectRunStoreRow | null>; // null = no store row for that Spur run
}

interface CollectRunStore extends CollectStoreAvailability {
    schemaVersion: 1;
    runId: string;
    row: CollectRunStoreRow | null;
    labelQuality: {
        decisionId: string;
        run: { value: string; HIGH: number; MEDIUM: number; LOW: number; none: number }[];
        effective: { value: string; count: number }[];
    }[];
}

interface CollectStoreItem {
    id: string; title: string; url: string | null; source: string; storyId: string | null;
    seen: 'new' | 'reseen'; labels: Record<string, string>;
    selection: 'selected' | 'published' | 'dropped' | 'none';
}
interface CollectStoreItems extends CollectStoreAvailability {
    schemaVersion: 1; runId: string; page: number; pageSize: 25; total: number; items: CollectStoreItem[];
    sources: string[];            // filter domain, from the store
}
```

Yield counts distinct items with `first_seen_run = run`, taking each item's strongest status
(`published` > `selected` > `dropped`) across selection rows. `selection` on an item uses the same
rule. Title is capped at 300 chars; `url` is `canonical_url` only when `http(s)`.

**Store access.** `Store` exposes only DAOs (the adapter is protected), so the aggregate SQL lives in a
read-only `CollectViewDao` (`packages/kk-store/src/dao/collect-view.ts`, `Store.collectView`).

**Availability.** File missing → `board.store.missing` (checked with `lstat` before `openStore`, which
would otherwise create an empty file); open/busy failure → `board.store.unreadable`; a
`__kk_store_migrations` id unknown to this build (`unknownKkMigrationIds`, shared with the migration
guard) → `board.store.newer`;
each is 200 with `availability: 'unavailable'` and empty `rows`/`row: null`/`items: []` — the UI shows
the diagnostic, not zeros. A label-policy read failure only empties `effective`
(`board.store.policy`). Messages are bounded, never raw SQLite errors or paths outside the project.

## 4. Ownership

| Owner | Change |
| --- | --- |
| `apps/board/src/contracts.ts` | the types above (type-only export) |
| `apps/cli/src/board/collect-store.ts` (new) | store open, three projections, availability mapping |
| `packages/kk-store/src/dao/collect-view.ts` (new), `migrations.ts`, `db.ts` | read-only aggregates, `unknownKkMigrationIds`, `Store.collectView` |
| `apps/cli/src/board/reader.ts` | three routes, `authorizeRun`, per-route query parsing |
| `apps/board/src/shared/run-selection.ts` | `parseDeepLink` tabs/aliases parameters |
| `apps/board/src/shared/api.ts`, `shared/collect.ts` | client calls and view-model helpers |
| `apps/board/src/collect/index.tsx`, `board.css` | Overview / Run detail / Items tabs |
| `docs/04_DESIGN.md` `kk board` | routes and shapes, same commit (T3) |
| `workflow-board-modules.md` §2, §9 | point Collect to this document; artifacts-only kept for the others |

No new dependency, no store schema change, no change to `kk-collect.yaml`.

## 5. Verification

- Projection tests against a temp store built through the real DAOs (`openStore` on a tmp path):
  funnel units, no-store rows, yield precedence, filter refusal, `migrate:false` leaves the journal
  and `sqlite_master` unchanged, missing/newer store → unavailable.
- Reader route tests: envelope refusals, query only on declared routes.
- Installed-Board browser check (`apps/board/tests/installed-board.test.ts`): the throwaway project's
  store is seeded through the real DAOs for fixture run `r-a` (none for `r-b`), plus a missing-store case.
- Operator-run live check (`apps/board/scripts/verify-collect-live.ts`) over this checkout's real store:
  screenshots, checked run ids and before/after `sqlite_master` + row-count digests under
  `.works/.board/verify/<stamp>/`. A copy of the live store cannot be used: its run ids never match fixtures.

## Sources

Verified 2026-10-16: `plugins/kk/workflows/kk-collect.yaml` (states lock…release);
`packages/kk-store/src/db.ts:58-66` (`migrate:false`); `apps/cli/src/commands/daily.ts:150`
(read-only precedent); `packages/kk-store/src/dao/labels.ts:71,325` (`labels_current`, `currentFor`);
`packages/kk-store/src/dao/items.ts:497` (`idsByRun`); `packages/kk-store/src/schema/*.ts`;
`apps/cli/src/board/reader.ts:566-612` (routes, query refusal); `apps/board/src/collect/index.tsx:283-286`
(tabs); `apps/board/src/shared/api.ts:124` (browser lists Spur runs); live `.works/kk.db` read with
`sqlite3 -readonly`.
