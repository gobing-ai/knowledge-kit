---
schema_version: 1
name: Verify and repair series-scoped selection continuity
status: done
template: feature-impl
created_at: 2026-11-18T04:42:14.702Z
updated_at: "2026-11-19T23:20:13.431Z"
feature_id: L3
priority: P1

estimate_hours: 8
ac_altitude: graduating
ac_numbering: task-local
done_forced: "false"
done_reason: unforced close
---

## 0393. Verify and repair series-scoped selection continuity

### Background

`kk store extract` passes the topic as `excludeTopic`; `ItemsDao.selectByProfile` on main compares only the stored `selections.story_id` to the current `items.story_id`. `kk store select` captures the story key by value, while `backfill-facts` can recalculate it. The same item can therefore escape its prior selection when its story key changes. The separate L3 worktree commit `43308794` includes a fixture reproduction and an item-ID-or-story-ID fix. The [L3 incident notes](../design/daily-ai-news-editorial-delivery.md#系列账本与疑似重复) record three local matching titles with distinct story IDs and no joined selections. Production episode and publish evidence is needed to attribute the Huang repeat.

**Refine corrections (2026-11-18)**

- A story-only join protects a stable cluster, but it does not protect a previously selected item after its story key changes. Use the reproduced gap and the existing worktree fix as the implementation baseline.
- The prepare reservation happens before curation. Settlement currently calls `mark-published` by `parentRunId` without `--in`, which can promote candidates that were dropped by curation. Confirm with a final-subset fixture before changing settlement.
- Launch already recycles failed or bundle-less generation in the cases covered by its guard, but explicitly skips recycling a `no-content` status. Check an empty prepare and a later refusal separately because a later refusal can follow a successful reservation.

### Requirements

- [x] R1. Trace the reported repeat using episode and ledger evidence where available. Show the demonstrated re-clustering gap in a fixture and prevent previous same-topic selected or published items from re-entering after identity drift. Preserve dropped re-admission, reuse by another topic and deterministic replay.
- [x] R2. Replay reservation, final curation and publish settlement with a final subset of candidates. Preserve aired items, release only proven unspent reservations, and fix any reproduced lifecycle gap. Keep a material, sourced follow-up eligible and record unresolved incident attribution when producing-host evidence is unavailable.

Out of scope: production-store writes, blanket threshold changes, unproven event merges and publisher authorization changes.

### Acceptance Criteria

```gherkin
Scenario: AC1 — R15 — 每日节目按系列阻止重复使用已选新闻 (req: R1; R2)
  Given a disposable ledger with two dated runs and two topics, a previously aired original, a linked syndication, a re-rooted original, a dropped candidate and a sourced material follow-up
  When the production extraction and settlement entry points replay curation, same-day retry, no-content and publish outcomes
  Then the same topic excludes prior selected or published identities and evidence-backed repeats, the other topic can reuse the item, the follow-up carries the new fact, and each reservation disposition is traceable to the final IDs and run receipt
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-18T04:50:05.163Z

**Ready decisions.** Own selection lifecycle and identity through the existing topic-specific ledger. Do not use the production db for fixture writes. Protect published items, release only unspent reservations and distinguish repeat stories from evidence-backed follow-up. Record evidence from the reproducer before changing event clustering. If actual incident evidence cannot be accessed, provide the trace and unresolved status alongside tested lifecycle behavior. Deliver stable final selected IDs and source proof to 0384.

**Source premise.** `packages/kk-store/src/dao/items.ts:502` and the L3 design's corresponding section were checked during refinement.

**Verification exit.** Replay two dated attempts and two topics, alternate titles/URLs, a materially updated event and a same-date retry. Check dropped, selected, published and missing-identity behavior against the DAO.

#### Q&A entry — 2026-11-19T04:05:52.015Z

Closed decisions. Use the existing item-identity fix as the starting point. Historical incident attribution can stay unresolved with an evidence trace. A verified final subset is required for a candidate-level settlement correction, and uncertain delivery holds its rows. Treat ambiguous similarity as editorial review until a reliable event link is available.

### Design

Preserve the topic ledger from ADR-030. Start with the reproduced `43308794` predicate in `packages/kk-store/src/dao/items.ts`: within the existing topic and selected/published guard, match the item ID or story ID. Review direct callers `commands/store.ts` and `itc-topic.ts`; keep the replay opt-out. Reuse canonical/reference matching in `packages/kk-store/src/story.ts`. Treat a verified new fact as a follow-up in editorial evidence. Require a fixture and reliable source relationship before expanding event matching.

Trace `resolveRunId` and `STORE_PICK` in `content-generate.ts` through bundle `parentRunId`, `runPublishMatrixSettle` and `SelectionsDao.updateStatus`. Resolve final IDs from validated plan and rendered-content evidence, accounting for downstream drops. Bind that set to the frozen bundle identity before settlement. Current bundle metadata alone cannot prove the item list. For a reproduced over-promotion, scope `kk store mark-published --in` to those IDs, then release only proven unspent selected rows. Validate run ownership before touching rows. Missing final IDs, dummy/draft/uncertain receipts, and partial delivery hold pending reconciliation. Keep failed-generation recycling in `launch.ts` and prove whether a late no-content refusal reaches it. No new CLI or schema. Hand verified final IDs and source evidence to 0384.

### Plan

- [ ] R1: Compare `43308794` before starting implementation. Record producing-host evidence read-only when accessible: run date, final item IDs, original/reference URLs, story IDs, prior topic status and matching publish receipt. If unavailable, retain the local observations and the unresolved attribution.
- [ ] R1: Replay two dated extractions and a second topic via `apps/cli/tests/store-selections.test.ts` with a disposable SQLite store. Cover re-rooted original, linked syndication versus a sourced new fact, missing identity, dropped rows and a same-date retry. Confirm an unfixed predicate fails the identity case.
- [ ] R2: Use `apps/cli/tests/kk-news-generate.e2e.test.ts`, `apps/cli/tests/launch.test.ts` and `apps/cli/tests/publish-matrix-0333.test.ts` to replay a final subset, early/late no-content, and matching versus stale, partial, draft and confirmed receipt sets. Assert ledger rows after the real store operations. Fix only demonstrated lifecycle gaps and retain the replay command and redacted ledger/receipt evidence for 0384.

### Solution

**R1 — series identity across re-clustering (commit 43308794, already on main).**
`packages/kk-store/src/dao/items.ts:512-517` — the topic-scoped exclusion in `selectByProfile` matches
`s.item_id = i.id OR s.story_id = i.story_id` within the existing topic + `selected|published` guard, so an
item whose story key was re-derived (`backfill-facts`, threshold retune) cannot re-enter its series pool.
Dropped re-admission, other-topic reuse and replay determinism are unchanged. Failure-first suite
`apps/cli/tests/store-selections.test.ts:875` (19 pass / 3 fail before the fix, recorded in the commit).
Incident attribution stays **UNRESOLVED**: the producing host's artifacts were unreachable from this
checkout and no joined selection rows were available locally.

**R2 — reservation lifecycle (two reproduced gaps, fixed).**
1. *Over-promotion at settlement.* Prepare reserves the pre-curation pool (`store select --in candidates`),
   but `publish-matrix-settle` ran `kk store mark-published --topic --run` with no `--in`, and
   `SelectionsDao.updateStatus` with no item list promotes every `selected` row of the run — curation-dropped
   candidates were burned as aired. `apps/cli/src/publish-matrix.ts:1270-1316`: settlement now reads the
   validated plan `21-plan/<stamp>_03_plan_plan.json` (`readFinalItemIds`, `:1320`), promotes only those IDs
   (`mark-published --in <plan>`), then releases the run's remaining `selected` rows (`kk store release
   --run --topic`). The settlement artifact records `scope: "final"` + `finalItemIds[]` so every
   disposition is traceable to the final IDs and the receipt-gated `parentRunId`. A release failure is kept
   as `releaseError` without un-publishing the aired set. A run without a readable plan keeps the old
   whole-run promotion (`scope: "run"`) — over-protects, never re-airs.
2. *Stranded reservation on a late no-content.* `apps/cli/src/launch.ts:736-739`: the launcher skipped
   recycling for `no-content`, but a floor/duration refusal writes `no-content:` AFTER `store-select`
   reserved the pool (the 2026-11-13 class). A no-content generate cannot have sent anything, so it now
   releases like a failed launch; an early empty pool reserved nothing and the release is a no-op.

Follow-ups: a materially new, sourced fact titles into a different story and stays eligible while the
aired original and its syndicated copy stay excluded (characterization pin, `store-selections.test.ts`
"keeps a sourced follow-up…"). No threshold or event-merge change.

Not changed: legacy `kk-daily-ai-voice2.yaml` `mark-published` node (retired voice2 path, not the current
news settlement); ITC settlement already scopes by `chosen.itemIds` (`apps/cli/src/itc-topic.ts:410-424`).
Surface doc: `docs/04_DESIGN.md` publish-matrix `settle` paragraph.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/kk-store/src/dao/items.ts:512-517` excludes on `s.item_id = i.id OR s.story_id = i.story_id` within topic + selected/published; dropped re-admission and other-topic reuse preserved. Failure-first suite `apps/cli/tests/store-selections.test.ts:875` (re-derived selected `:924`, published `:949`, headline re-cluster `:977`, other topic + dropped `:1035`, replay determinism). Incident attribution recorded UNRESOLVED (producing-host evidence unavailable) in commit 43308794 and the Solution. |
| R2 | MET | Final-subset settlement: `apps/cli/src/publish-matrix.ts:1273-1316` promotes only the validated plan IDs (`mark-published --in 21-plan/<stamp>_03_plan_plan.json`) and releases the remaining `selected` reservations (`kk store release`), recording `scope: final` + `finalItemIds`; `readFinalItemIds` `:1320`. Proven against the real store CLI by `apps/cli/tests/publish-matrix-0333.test.ts:380` (F2c: 2 published, curation-dropped 1 released, idempotent re-settle) — failed before the fix. Late no-content release: `apps/cli/src/launch.ts:736-739`, proven by `apps/cli/tests/launch.test.ts:713` (failed before the fix). Receipt gating (draft/partial/stale/dummy hold, confirmed marks) unchanged: F1/F3/F4/F5/F11 at `publish-matrix-0333.test.ts:274-578`. Sourced follow-up stays eligible: `apps/cli/tests/store-selections.test.ts:1055`. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — R15 — 每日节目按系列阻止重复使用已选新闻 | MET | test | Identity half: `apps/cli/tests/store-selections.test.ts:875-1075` (prior selected/published excluded after re-clustering, other topic reuses, dropped re-admitted, follow-up eligible, replay writes nothing). Disposition half: `apps/cli/tests/publish-matrix-0333.test.ts:380` (settlement traceable to final IDs and the receipt-gated `parentRunId`) and `apps/cli/tests/launch.test.ts:713` (no-content returns the reservation). |
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

- 2026-11-19T22:50:47.203Z todo → wip (system)
- 2026-11-19T22:50:47.817Z wip → testing (system)
- 2026-11-19T23:20:13.349Z testing → done (system)

