# AI-news supply readiness — 2026-11-04

Task 0337 shipped a read-only diagnostic, not a supply remedy. This report separates repeatable
fixture evidence from live-store evidence. **No live store was read for this handoff**, so these
numbers do not establish a current 24h shortage or justify enrichment, extra model labeling,
reservation release, or a lower episode floor.

## Invocation and evidence

```bash
bun scripts/ai-news-supply-report.ts \
  --db <existing-path> \
  --config <existing-kk-config> \
  --profile plugins/kk/decisions/extract/ai-news.yaml \
  --at <ISO-8601-with-offset>

bun test scripts/tests/ai-news-supply-report.test.ts
```

The subprocess suite uses a disposable migrated SQLite fixture, a fixture config and a profile with
`limit: 2`. It verifies byte/schema preservation, deterministic JSON, missing-input and schema
failures, current-label maker priority/confidence/hash/replay behavior, exact window boundaries,
reservation partitioning, null stories, cap/order, and capped-id parity with
`ItemsDao.selectByProfile`. The machine-readable result and exact repeat command are in
`.spur/run/0337-supply-fixture.json`.

## Measured fixture attrition

Each cell is `items / distinct non-null stories`; `cap` is the profile limit, not eligible supply.

| Cumulative gate | 24h fixture | 168h fixture | Removed items (24h / 168h) |
| --- | ---: | ---: | ---: |
| seen | 14 / 12 | 16 / 14 | 0 / 0 |
| category | 13 / 11 | 15 / 13 | 1 / 1 |
| quality | 9 / 7 | 11 / 9 | 4 / 4 |
| importance | 8 / 6 | 10 / 8 | 1 / 1 |
| moderation | 7 / 5 | 9 / 7 | 1 / 1 |
| reservationExclusion | 5 / 3 | 7 / 5 | 2 / 2 |
| cap | 2 / 1 | 2 / 1 | 3 / 5 |

Both fixtures include one null-story item until the cap. Quality removes missing, stale-only and
policy-rejected labels as well as a below-threshold answer. Two AI-news reservations remain visible
as one `published` and one `selectedOnly` blocked story; dropped and other-topic rows do not block.
The capped ids equal the DAO result in both windows.

## Interpretation and decision

The fixture proves the report's semantics; it is not a sample of production supply. A live read must
use one explicit timestamp and report 24h separately from 168h before anyone diagnoses starvation.
Body buckets describe source depth only and must not be relabeled as model quality. Label coverage
uses precise states: `current` follows `labels_current`; `staleOnly` means observations exist but
none matches the current content hash; `missing` includes current-hash observations rejected by the
configured maker/confidence/replay policy.

**A separately scoped enrichment or labeling experiment is not supported by this fixture-only
evidence.** First run the diagnostic against an explicitly selected live store/config. A later task
may be proposed only if those measured gate counts and body/label coverage isolate a remedy; this
task does not implement one or promise that extraction-eligible items survive downstream QC or
duration checks.
