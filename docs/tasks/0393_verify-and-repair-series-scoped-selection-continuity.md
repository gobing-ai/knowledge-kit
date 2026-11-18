---
schema_version: 1
name: Verify and repair series-scoped selection continuity
status: done
template: feature-impl
created_at: 2026-11-18T04:42:14.702Z
updated_at: "2026-11-18T13:14:12.199Z"
feature_id: L3
priority: P1

estimate_hours: 8
done_forced: "false"
done_reason: unforced close
---

## 0393. Verify and repair series-scoped selection continuity

### Background

Existing kk store extract excludes selected or published story IDs by topic (apps/cli/src/commands/store.ts:1257 and packages/kk-store/src/dao/items.ts:502). Prepare reserves candidates before final curation (apps/cli/src/commands/content-generate.ts:864). The three locally matching titles in the Huang incident have distinct story IDs and no joined selections. Local artifacts do not establish what aired.

### Requirements

- [x] R1. Trace claimed repeats end-to-end and fix only demonstrated lifecycle or event-identity gaps. Preserve reuse by other series and replay semantics.

### Acceptance Criteria

- [ ] R15 — 每日节目按系列阻止重复使用已选新闻

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-18T04:50:05.163Z

**Ready decisions.** Own selection lifecycle and identity through the existing topic-specific ledger. Do not use the production db for fixture writes. Protect published items, release only unspent reservations and distinguish repeat stories from evidence-backed follow-up. Record evidence from the reproducer before changing event clustering. If actual incident evidence cannot be accessed, provide the trace and unresolved status alongside tested lifecycle behavior. Deliver stable final selected IDs and source proof to 0384.

**Source premise.** `packages/kk-store/src/dao/items.ts:502` and the L3 design's corresponding section were checked during refinement.

**Verification exit.** Replay two dated attempts and two topics, alternate titles/URLs, a materially updated event and a same-date retry. Check dropped, selected, published and missing-identity behavior against the DAO.

### Design

Use read-only report/bundle/ledger evidence from the actual producing host. Record episode dates, raw item IDs, URLs, story IDs, prior same-series status and actual final item IDs. Check same-day retries, dropped candidates and no-content releases, and parentRunId settlement. Preserve the existing topic/store ledger. If evidence demonstrates missed event identity, add deterministic canonical/reference matching plus bounded editorial duplicate review for ambiguous cross-source cases. Distinguish genuine event updates and corrections. Do not globally lower similarity or mutate production data.

### Plan

- [ ] Replay two episodes plus a second series with same original, syndication/paraphrase, material update and dropped versus published states. Retain a minimal reproduction for any bug. Verify retry, no-content and publish settlement against emitted content, and document the incident as unresolved if production evidence is unavailable.

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `apps/cli/tests/store-selections.test.ts:180` |
| `apps/cli/tests/store-selections.test.ts:860` |
| `packages/kk-store/src/dao/items.ts:505` |
| `packages/kk-store/src/dao/items.ts:513` |
| `apps/cli/.works/kk.db:1` |
| `apps/cli/.works/kk.db-shm:1` |
| `apps/cli/.works/kk.db-wal:1` |
| `apps/cli/.works/test-artifacts/0212/README.md:1` |
| `apps/cli/.works/test-artifacts/0212/cutover-fixtures.md:1` |
| `apps/cli/.works/tmp/test-content-nouns/summary.json:1` |
| `apps/cli/.works/tmp/test-daily-recovery/cache/summary.json:1` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 — trace claimed repeats end-to-end and fix only demonstrated lifecycle/event-identity gaps; preserve reuse by other series and replay semantics | MET | Trace: `apps/cli/src/commands/store.ts:1458` records `story_id` by value while `backfillFacts` re-derives it (`packages/kk-store/src/dao/items.ts:594-640` consumers) — incident half recorded UNRESOLVED on verified-inaccessible evidence (`.works/kk.db` = 0 items / 0 selections; `.spur/run/0393-implement-receipt.md:8-38`), which the binding Q&A permits. Only the *demonstrated* gap is fixed, one predicate (`packages/kk-store/src/dao/items.ts:513-515`); no clustering/threshold/migration change in the diff. Preservation proven by my own runs: reuse by another topic `apps/cli/tests/store-selections.test.ts:1035-1053`, `dropped` re-admit `:1046-1053`, replay determinism + zero writes `:1055-1090`, pre-existing 0228/0316 suites 36 pass / 0 fail. Failure-first verified by me: HEAD predicate → 19 pass / 3 fail (`:924,949,977`), fixed → 22 pass / 0 fail |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R15 — 每日节目按系列阻止重复使用已选新闻 | MET | test | Daily path: `daily-extract` calls `kk store extract --topic` (`plugins/kk/scripts/daily-stages.ts:671`), whose compiled query sets `excludeTopic` (`apps/cli/src/commands/store.ts:1257`; same in `apps/cli/src/itc-topic.ts:115`), landing on the topic-scoped `NOT EXISTS` that now matches item identity beside the story key (`packages/kk-store/src/dao/items.ts:513-515`). Series activity is bounded by `status IN ('selected','published')` with `dropped` free to re-enter, and only `selected` rows are releasable (`packages/kk-store/src/dao/selections.ts:93-103`). Behaviour pinned by `apps/cli/tests/store-selections.test.ts:924` (selected survives drift), `:949` (published survives drift, `release` refuses), `:977` (corrected headline re-clustered onto an earlier story), `:1035` (other series keeps reuse; release re-admits), `:1055` (deterministic, no-write replay) — 22 pass / 0 fail in my run, 3 of them failing on HEAD's predicate in my mutation |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-18T13:09:56.139Z todo → wip (system)
- 2026-11-18T13:14:11.601Z wip → testing (system)
- 2026-11-18T13:14:12.195Z testing → done (system)

