# 0319 — Collect Summary channel-yield + plugin-count aggregate

Verification artifact for task 0319 (`Collect Summary tab: render the real channel yield (day ×
source) and per-plugin ingest counts`). Frozen design: `docs/design/collect-store-views.md` §2/§3.

## What shipped

- `GET /api/workflows/kk-collect/store/channels?from=<ms>&until=<ms>&page=<n>` — one read-only
  aggregate returning BOTH tables per page (`byDay` day × source, `runsByDay` day × plugin),
  plus `bySource` and `totalDays` over the whole interval, `lastPositiveAt` per plugin over retained
  history, and a 30-day page bound.
- `CollectViewDao.channelYield(sinceMs, untilMs?)` (legacy single-arg callers preserved) and
  `CollectViewDao.channelRunYield(fromMs, untilMs)` (daily ticks + validated nonnegative-integer
  plugin counts; a malformed row nulls that day's plugin totals, keeps the tick count).
- `BoardClient.storeChannels(query)` targets a distinct loopback `aggregateReaderOrigin` (default
  `http://127.0.0.1:4340`), never the native Spur database API; the Collect module resolves a valid
  `kkApi` override for it independently.
- `shared/channel-yield.tsx`: the two presentational tables (data-only; modules own fetching).
- Collect Summary: range pills `24h/7d/14d/30d/All` (default 14d), `range` persisted beside `tab`/
  `run` in the URL, aggregate page reset on range change, stale-response sequence guard, and removal
  of the unsupported native label/yield totals, ratios and trends.

## Fixture expectations (real DAOs, no mocked aggregate)

`apps/cli/tests/board/collect-store.test.ts` seeds, per the frozen contract:

- Day A (`now − 1d`): items `aihot × 2`, `github × 1`; tick `c-1` with
  `{aihot-ingest: 3, horizon-ingest: 1}`.
- Day B (`now`): item `github × 1`; tick `c-2` with `{aihot-ingest: 2, last30days-ingest: 4}`.
- Expected (page 1, `[now−2d, now+1d)`): `sources = [aihot, github]`,
  `bySource = {aihot: 2, github: 2}`, newest day first, `plugins =
  [aihot-ingest, horizon-ingest, last30days-ingest]`, and
  `lastPositiveAt = {aihot-ingest: now, horizon-ingest: now−1d, last30days-ingest: now}`.
- A malformed `c-1` `source_counts_json` (`'not json'`) → that day `plugins: null`,
  `diagnostics = [board.store.channel-invalid]`, tick count intact, item counts intact, and
  `lastPositiveAt.horizon-ingest = null`.
- 35 distinct tick days → `totalDays: 35`, page 1 has 30 day rows, page 2 has 5.

The installed-package Chromium fixture (`apps/board/tests/installed-board.test.ts`) seeds the store
through the real DAOs (r-a: 27 items `aihot-ingest 20 / horizon-ingest 7`, one tick with the same
source counts) plus 35 extra empty tick days, then asserts over the reader route and the rendered
Summary: both tables present, label/yield tiles absent, `range` survives reload, All paginates at 30
days, and a missing store degrades only the two panels.

## Commands and evidence

| Command | Result |
| --- | --- |
| `bun run lint` (biome 2.5.15 + full typecheck) | exit 0 |
| `bun run build` (all workspaces with a build script) | exit 0 |
| `bun test apps/cli/tests/board/collect-store.test.ts` | 23 pass, 0 fail |
| `bun test apps/cli/tests/board/reader.test.ts` | 31 pass, 0 fail |
| `bun test apps/board/tests/shared/api.test.ts` | 24 pass, 0 fail |
| `bun test apps/board/tests/collect/panels.test.tsx` | 44 pass, 0 fail |
| `bun test apps/board/tests/installed-board.test.ts` (real Chromium, real reader, real packed install) | 24 pass, 0 fail |
| `bun run test` (full suite) | 4076 pass / 3 skip / 0 fail (exit 0) |

Chromium was available in this environment (`chromium-1194`), so the installed-package acceptance
ran for real; no assertion was weakened or skipped.

## Read-only evidence

`storeChannels` opens `.works/kk.db` through `openStore({ migrate: false })` after `stat`-ing the
path (a missing path is never opened), closes in `finally`, and never writes. The
`leaves sqlite_master and row counts unchanged` test (collect-store.test.ts) pins the digest before
and after the read; the missing-store test asserts the file is never created.

## Live-store observation

Snapshot observation taken **2026-10-22T21:54:19Z** (UTC; local 14:54:19 PDT), host `darwin`,
reader zone `America/Los_Angeles`. Window is the half-open interval
`[1791496459000, 1792706059000)` = 2026-10-08T14:54:19 PDT .. 2026-10-22T14:54:19 PDT (trailing 14d).

This worktree carries no live `.works/kk.db`, so the investigation store named in the task body was
copied **once, read-only, into a scratch path inside this tree** and queried there. Nothing in the
main checkout was opened for writing, and the snapshot is mutable evidence — never an assertion:

```
$ cp ~/xprojects/knowledge-kit/.works/kk.db .works/tmp/live-snapshot-20261022T215415Z.db
$ bun apps/cli/src/index.ts store stats --days 14 --json --db .works/tmp/live-snapshot-20261022T215415Z.db
```

### Table 1 — new items per host-local day (bounded SQL on `items.first_seen_at`)

```
sqlite3 .works/tmp/live-snapshot-20261022T215415Z.db \
  "select date(first_seen_at/1000,'unixepoch','localtime') d, count(*) total
     from items where first_seen_at >= 1791496459000 and first_seen_at < 1792706059000
     group by d order by d desc"
```

| day | new items |
| --- | --- |
| 2026-10-22 | 5 |
| 2026-10-21 | 19 |
| 2026-10-20 | 21 |
| 2026-10-19 | 24 |
| 2026-10-18 | 21 |
| 2026-10-17 | 23 |
| 2026-10-16 | 34 |
| 2026-10-15 | 38 |
| 2026-10-14 | 56 |
| 2026-10-13 | 25 |
| 2026-10-12 | 33 |
| 2026-10-11 | 7 |
| 2026-10-10 | 19 |
| 2026-10-09 | 45 |
| 2026-10-08 | 18 |

Per-source totals over the same interval, from `store stats` (run at the same frozen clock):
`grounding 13, aihot 35, github 5, polymarket 28, hackernews 45, reddit 44, rss 117, youtube 101`.
The per-day totals above are **identical** to `stats --days 14 --json`'s `byDay[].total` for the same
window (5, 19, 21, 24, 21, 23, 34, 38, 56, 25, 33, 7, 19, 45, 18) — the two paths agree on live data,
not only on the fixed-clock fixture.

### Table 2 — per-day tick counts and recorded plugin contributions (`collect_runs`)

```
sqlite3 .works/tmp/live-snapshot-20261022T215415Z.db \
  "select date(started_at/1000,'unixepoch','localtime') d, count(*) runs,
          coalesce(sum(json_extract(source_counts_json,'$\"aihot-ingest\"')),0) aihot,
          coalesce(sum(json_extract(source_counts_json,'$\"last30days-ingest\"')),0) last30days,
          coalesce(sum(json_extract(source_counts_json,'$\"horizon-ingest\"')),0) horizon
     from collect_runs where started_at >= 1791496459000 and started_at < 1792706059000
     group by d order by d desc"
```

| day | ticks | aihot-ingest | last30days-ingest | horizon-ingest |
| --- | --- | --- | --- | --- |
| 2026-10-22 | 2 | 20 | 80 | **0** |
| 2026-10-21 | 5 | 50 | 200 | **0** |
| 2026-10-20 | 5 | 50 | 120 | 20 |
| 2026-10-19 | 4 | 40 | 160 | 22 |
| 2026-10-18 | 5 | 50 | 200 | 20 |
| 2026-10-17 | 8 | 80 | 320 | 40 |
| 2026-10-16 | 8 | 80 | 320 | 56 |
| 2026-10-15 | 8 | 80 | 320 | 70 |
| 2026-10-14 | 8 | 80 | 320 | 84 |
| 2026-10-13 | 4 | 40 | 160 | 26 |
| 2026-10-12 | 5 | 50 | 200 | 30 |
| 2026-10-11 | 2 | 20 | 80 | 8 |
| 2026-10-10 | 4 | 40 | 160 | 24 |
| 2026-10-09 | 6 | 60 | 240 | 66 |
| 2026-10-08 | 2 | 20 | 79 | 14 |

Interval totals (the column sums of the table above, verifiable with the same SQL): **76 ticks,
aihot-ingest 760, last30days-ingest 2959, horizon-ingest 480**. The whole store outside the window
holds 78 ticks, so the interval covers all but two. Observed plugin keys in the store are exactly
`aihot-ingest`, `last30days-ingest`, `horizon-ingest`.

2026-10-22 and 2026-10-21 each carry ticks with **no `horizon-ingest` key**. Per R2/AC2 those render
as **0 recorded contributions with invocation health unknown** — the live rows are a real instance of
the case the fixture pins, and they are not evidence that the plugin failed or never ran. Both days
are partial: the window's last day (2026-10-22) ends at the 14:54:19 PDT clock, and 2026-10-08 starts
mid-day at 14:54:19 PDT.

No production count above is frozen as an assertion; deterministic cells/totals stay on the
fixed-relative-clock fixture. The snapshot file lives under gitignored `.works/tmp/` and is
disposable.
