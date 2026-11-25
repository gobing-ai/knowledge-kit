---
schema_version: 1
name: Extract ladder projects the pool while the floor gate projects the admitted set
status: done
template: issue
created_at: 2026-11-24T21:55:06.445Z
updated_at: "2026-11-25T17:06:34.505Z"
feature_id: L3

ac_altitude: task-local
ac_numbering: task-local
done_forced: "false"
done_reason: unforced close
---

## 0434. Extract ladder projects the pool while the floor gate projects the admitted set

### Background

Two gates estimate the same episode with two different denominators, and the numbers a human reads
during recovery disagree by 10x.

2026-11-24 measured on one run (`.works/kk-news-generate/20261124`):

| Artifact | What it says | Arithmetic |
|---|---|---|
| `10-collect/ladder.json` | `items 63, chars 42925, minutes 22.8, clears: true` at the 168h rung | poolChars x 0.165 (yesterday's spoken/pool ratio) |
| `21-plan/…_floor-refusal` inputs (gate) | 12,937 kept chars -> 13.1 min | keptChars x 0.313 (yesterday's spoken/kept ratio) |
| `30-audio/…_duration-refusal.json` | `measuredMinutes: 12.6`, `estimatedMinutes: 58.2` | keptChars x **1.4** (the pre-2026-11-16 raw-script expansion) |

So the ladder said 22.8 min, the pre-spend gate said 13.1, the writer delivered 12.6, and the
post-spend refusal printed 58.2 next to it.

The 58.2 is fixed (commit ecf5cb1e: `dailyEpisodeDuration` now passes `readKeptRatio(workDir).ratio`,
so both gates share one arithmetic and a test at
`plugins/kk/tests/daily-publish-path-0329.test.ts` pins it).

What remains is the ladder-vs-gate gap. The ladder multiplies the *raw pool* by a *pool-denominated*
ratio, which is only equivalent to the gate's kept-set arithmetic when today's QC keep rate matches
the day the ratio was recorded. Meantime the keep rate moved 7 points (53% -> 46%), so 63 pool items
(42.9k chars) forecast 22.8 min while the admitted 18 items (12.9k chars) could only make 13.1 — the
run cleared the floor by 0.1 min and then measured 12.6, i.e. under it. Raising `plan_max_items`
40 -> 64 for this run bought 225 chars of kept content, because QC kept the same 18 docs.

Consequence: the widen ladder is not a usable predictor of the episode's length, and the day's
recovery decision (re-curate? lower the floor? re-voice?) has to be made from numbers that contradict
each other.

### Requirements

- [x] R1. The extract ladder and the floor gate must estimate with the same denominator: either the ladder projects the admitted set (pool chars x the recorded keep rate x the recorded kept ratio) or it states the keep-rate assumption it used.
- [x] R2. Every estimate artifact must print the ratio, its source path and the assumed keep rate, so two artifacts can be compared without recomputation.
- [x] R3. A keep-rate drift beyond a stated bound (the QC admission rate moving several points from the day the ratio was recorded) must be reported, not silently absorbed into the estimate.
- [x] R4. A test pins the ladder/gate/settle arithmetic on one fixture, so a future change to either side fails the suite.

### Acceptance Criteria

```gherkin
Scenario: AC1 — ladder and gate agree on one fixture (req: R1, R4)
Given a pool fixture and a recorded `21-plan/<date>_09_spoken-ratio.json` with both `ratio` and `keptRatio`
When the ladder and the floor gate both estimate
Then both artifacts report minutes that differ by no more than the fixture's keep-rate uncertainty, and the test fails if either side switches denominator

Scenario: AC2 — a keep-rate shift is named (req: R3)
Given a run whose QC admission rate is 7 points below the recorded day
Then the ladder artifact records the assumption and the run reports the drift on stderr
```

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

<!-- Fix approach and tradeoffs. Keep this short unless the issue changes architecture. -->

### Plan

<!-- Ordered debugging/fix checklist. Fill before moving to todo/wip. -->

### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution

One arithmetic, one denominator. Every estimate now converts the set QC will **admit**, at the ratio
measured on that set, through a single `spokenLength` helper — and the one number a pre-spend estimate
cannot know (today's admission rate) is measured at the floor gate and **reported** when it has moved
off the recorded day, instead of being absorbed.

| File | Change (what / why) |
| --- | --- |
| `plugins/kk/scripts/daily-stages.ts:393-437` | `KEEP_RATE_FLOOR = 0.30` + `KEEP_RATE_DRIFT_BOUND = 0.05` (R1/R3): the cold-start admission rate is the *lowest measured* (0.37 on 2026-11-16, 0.30 on 2026-11-24) because a rung too many is the cheap error and an admitted set that never arrives is the expensive one; the record docstring now names the third measure (`keepRate`). |
| `plugins/kk/scripts/daily-stages.ts:439-470` | `SpokenCalibration` — one struct carrying `poolRatio`, `keptRatio`, `keepRate` and a source string per measure, so no consumer can silently pick a different denominator (R1/R2). |
| `plugins/kk/scripts/daily-stages.ts:472-566` | `ratioRecords` + `recordKeepRate`: **one** sibling scan for all three measures, replacing the two scans `readSpokenRatio`/`readKeptRatio` ran with two different size guards (a large workspace could calibrate the ladder from one run and the gate from another). Admission rate = kept/pool, else `ratio ÷ keptRatio`, else a stamped rate — a pre-2026-11-16 record yields none, which is correct: it never measured one. |
| `plugins/kk/scripts/daily-stages.ts:568-600` | `readSpokenCalibration`: newest record per measure, each fallback carrying a `default …` provenance (R2). |
| `plugins/kk/scripts/daily-stages.ts:602-658` | `assumedKeepRate` (the rate the ladder projected with, read from `ladder.json`), `observedKeepRate` (this run's kept/pool, sourced at `10-collect/pool.json`), `keepRateDrift` (delta + the stderr report past the bound) — R3. |
| `plugins/kk/scripts/daily-stages.ts:660-713` | `recordSpokenRatio` stamps `keepRate` into `21-plan/<date>_09_spoken-ratio.json` (so tomorrow's ladder projects from a measured admission rate) and compares the delivered pool ratio against the ladder's `spokenPerPoolChar` projection instead of the raw `ratioUsed`. |
| `plugins/kk/scripts/daily-stages.ts:727-765` | `spokenLength` is **the** arithmetic (chars × ratio ÷ char rate + 8 s intro); `estimateSpokenMinutes` delegates to it and `projectKeptChars` is the pool→admitted-set bridge, so there is no third formula (R1/R4). |
| `plugins/kk/scripts/daily-stages.ts:767-864` | `applyFloorGate`: unchanged kept-set estimate at the shared `keptRatio`, the drift report emitted **before** the verdict (a passing gate reports drift too), and the refusal artifact gains `keepRate`, `keepRateSource`, `keepRateAssumed`, `keepRateAssumedSource`, `keepRateDrift` (R2/R3). |
| `plugins/kk/scripts/daily-stages.ts:903-1018` | `dailyExtract`: every rung now estimates `round(poolChars × keepRate)` chars at `keptRatio` — the gate's arithmetic — prints the projection on stderr, and `ladder.json` gains `keptRatio`, `keptRatioSource`, `keepRate`, `keepRateSource`, `spokenPerPoolChar` and `rungs[].keptChars`; `ratioUsed`/`ratioSource`/`rungs[].chars` keep their old meaning (additive, no schema break). |
| `plugins/kk/scripts/daily-stages.ts:1404-1432` | `dailyEpisodeDuration` refusal gains `expansion`, `expansionSource`, `keepRate`, `keepRateSource`, `keepRateAssumed`, `keepRateAssumedSource` — the same three measures as the other two artifacts, so all three compare without recomputation (R2). |
| `plugins/kk/tests/daily-estimate-denominator-0434.test.ts:1-370` | New pin (AC1/AC2/R4): one fixture drives extract → floor gate → post-spend refusal and asserts all three report 19.9 min (a denominator switch on any side breaks it), the cold-start case (10.9 min vs the old pool-denominated 36.0), the 20-point drift being reported on stderr, the in-bound 3-point drift not being reported, and every artifact's provenance fields. |
| `plugins/kk/tests/daily-extract-ladder.test.ts:16-215` | 0377's ladder pins moved to the new denominator: `--limit` on every rung, a rich rung that needs 55,600 pool chars (raw chars alone no longer clear the floor), the projection pinned in both directions (a 33%-admission day clears, a 10% one does not), and the artifact test asserting the new fields. |
| `apps/cli/src/commands/daily.ts:626-660` | Run report: "Driving measure" prints `spokenPerPoolChar` with keep rate × kept ratio, plus one line per measure carrying its source path — the report and the refusal artifact compare without recomputation (R2). |
| `apps/cli/tests/commands/daily.test.ts:330-375` | The existing ladder-report test now seeds `keepRate`/`keptRatio`/`spokenPerPoolChar` and asserts the new report lines. |
| `apps/cli/tests/kk-workflow-stages.test.ts:1203-1222` | The 2026-10-19 widen fixture rescaled: the rich rung is 8 × 6,950 = 55,600 pool chars; the old 16,880-char "rich" pool is exactly the 2026-11-24 shape that forecast 22.8 min for a 12.6-min episode and must no longer clear the floor. |

Notes: `plugins/kk/scripts/daily-stages.ts` already carried uncommitted 0433 edits in this worktree, so
its diff is wider than these rows. `apps/cli/plugins/` is build output (`bun scripts/bundle-plugins.ts`)
and was regenerated, never hand-edited.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 — ladder and gate share one denominator (or the ladder states its keep-rate assumption) | MET | One arithmetic `spokenLength` (`plugins/kk/scripts/daily-stages.ts:730-738`), one bridge `projectKeptChars` (`:763-765`). Ladder: `keptChars = round(poolChars × keepRate)` then `spokenLength(keptChars, keptRatio)` (`:973-976`); gate: `estimateSpokenMinutes(docs, vdriver, calibration.keptRatio)` over the admitted chars (`:805-810`); post-spend: same call (`:1404-1405`). The assumption is stated, not implied: `keepRate` + `keepRateSource` in `ladder.json` (`:1007-1008`), printed per rung on stderr (`:988`). Pinned by `plugins/kk/tests/daily-estimate-denominator-0434.test.ts:206,245,334` and `plugins/kk/tests/daily-extract-ladder.test.ts:170` |
| R2 — every estimate artifact prints the ratio, its source path and the assumed keep rate | MET | `ladder.json`: `ratioUsed`/`ratioSource`, `keptRatio`/`keptRatioSource`, `keepRate`/`keepRateSource`, `spokenPerPoolChar`, `rungs[].keptChars` (`plugins/kk/scripts/daily-stages.ts:1003-1010`). Floor refusal: `expansion`/`expansionSource`, `keepRate`/`keepRateSource`, `keepRateAssumed`/`keepRateAssumedSource`, `keepRateDrift` (`:844-852`). Post-spend refusal: the same measures (`:1418-1423`). Run report: "Driving measure" + one line per measure with its source (`apps/cli/src/commands/daily.ts:653-656`). Asserted at `plugins/kk/tests/daily-estimate-denominator-0434.test.ts:245-282,334-386`, `apps/cli/tests/commands/daily.test.ts:369-376` |
| R3 — drift beyond a stated bound is reported, not absorbed | MET | Stated bound `KEEP_RATE_DRIFT_BOUND = 0.05` with its rationale (`plugins/kk/scripts/daily-stages.ts:416-422`); `keepRateDrift` prints on stderr with the observed %, the assumed % and its source, and the direction word (`:647-662`), called before the verdict branch so a **passing** gate reports it too (`:815`, `:826-833`); the refusal records the delta (`:852`). Observed measured from `10-collect/pool.json` vs the admitted candidates (`:626-634`), i.e. today's rate, never the assumed one. Pinned by `plugins/kk/tests/daily-estimate-denominator-0434.test.ts:283` (fires at −20 pts) and `:313` (quiet at −3 pts) |
| R4 — one test pins ladder/gate/settle arithmetic so a future change on either side fails | MET | `plugins/kk/tests/daily-estimate-denominator-0434.test.ts:334` drives extract → floor gate → post-spend refusal on one fixture and asserts all three report 19.9 min. Verified by mutation: switching the ladder to pool chars fails 3/5 tests (`66.2` vs `19.9`), the gate to the pool ratio fails 2/5 (`6.1` vs `19.9`), the settle to the 1.4 default fails 1/5 (`54` vs `19.9`); source restored byte-identical (`md5 ba7bc40e96472491f3e6600c053d58ad`) and the suite re-run green |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — ladder and gate agree on one fixture, and the test fails if either side switches denominator | MET | test | Cold-start fixture: ladder `rungs[0].keptChars = 12,000` of 40,000 pool at 0.30, both artifacts 10.9 min vs the pool-denominated 36.0 (`plugins/kk/tests/daily-estimate-denominator-0434.test.ts:206-243`); recorded-rate fixture: both 19.9 min, `refusal.candidateChars === rung.keptChars` (`:245-282`, `:334-386`). Mutation runs prove the failure direction (see R4). `bun test plugins/kk/tests/daily-estimate-denominator-0434.test.ts plugins/kk/tests/daily-extract-ladder.test.ts` → 11 pass / 0 fail |
| AC2 — a keep-rate shift is named: the ladder records the assumption and the run reports the drift on stderr | MET | test | `ladder.keepRate = 0.5` with `keepRateSource` pointing at the recorded sibling file (`plugins/kk/tests/daily-estimate-denominator-0434.test.ts:283-311`), and the gate's stderr carries `keep rate drifted … 30% … 50%`. Quiet case at −3 pts (`:313-332`). Manual probe on a scratch workspace: recorded 20%, admitted 77%, gate **passed** (49.7 min > 15) and still printed `keep rate drifted: QC admitted 77% of the pool, the ladder estimate assumed 20% (…kept 0.20 of pool) — the estimate under-predicts the episode by ~285%` |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 0434
**Scope:** `plugins/kk/scripts/daily-stages.ts` (estimate / calibration / ladder / floor-gate / duration-refusal hunks only — the 0433 `cn-lead-gate` hunks in the same file are out of scope), `apps/cli/src/commands/daily.ts` (ladder report), `plugins/kk/tests/daily-estimate-denominator-0434.test.ts` (new), `plugins/kk/tests/daily-extract-ladder.test.ts`, `apps/cli/tests/commands/daily.test.ts`, `apps/cli/tests/kk-workflow-stages.test.ts` (ladder fixture)
**Dimensions:** functional, security, efficiency, correctness, usability, architecture
**Verdict:** PASS

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P4 (advisory) | architecture | `estimateSpokenMinutes` still defaults `expansion` to `SPEAK_CHAR_EXPANSION` (1.4) — the exact constant that produced the 58.2 min post-spend estimate. No live caller relies on the default (both pass `calibration.keptRatio`), but the dead default is the only remaining way to resurrect the third variant; making the parameter required would remove it | `plugins/kk/scripts/daily-stages.ts:750-756` | ACCEPTED — no live path; both call sites (`:810`, `:1405`) are pinned by mutation-verified tests |
| 2 | P4 (advisory) | usability | The same key name carries opposite roles across the two artifacts R2 says must be comparable: `ladder.json`'s `keepRate` IS the assumption, while the floor refusal's `keepRate` is the observed rate (the assumption is `keepRateAssumed`). Values, sources and the `keepRateAssumedSource → ladder.keepRateSource` chain are correct, so the comparison is possible — only the label invites the "assumed vs today's" mix-up | `plugins/kk/scripts/daily-stages.ts:1007` vs `:848-851` | ACCEPTED — correct by value and by provenance; naming is cosmetic |
| 3 | P4 (advisory) | usability | The run report's rung table still prints raw pool `Characters` beside an `Estimated minutes` that now derives from projected kept chars, with no kept-chars column, so the row is not self-checkable without the "Driving measure" line above it | `apps/cli/src/commands/daily.ts:643`, `:662` | ACCEPTED — documented tradeoff (`rungs[].chars` keeps its old meaning, Solution table row `903-1018`); the keep-rate line above states the multiplication |
| 4 | P4 (advisory) | functional | `kk news status`'s gate projection still advertises `ratioUsed` as the ladder's ratio and drops `keepRate` / `keptRatio` / `spokenPerPoolChar`, so that JSON surface cannot rebuild a rung's minutes — the one estimate-facing surface left without the assumption | `apps/cli/src/status-progress.ts:111-114` | ACCEPTED — read-only projection; the on-disk artifacts carry the measures |
| 5 | P4 (advisory) | correctness | `readSpokenCalibration` takes each measure from the newest record that carries it, so `keepRate` and `keptRatio` (and their product `spokenPerPoolChar`) can come from different runs and `poolRatio === keepRate × keptRatio` need not hold for the calibration as assembled. Each measure prints its own source path, so this is disclosed rather than silent | `plugins/kk/scripts/daily-stages.ts:570-600`, `:1009` | ACCEPTED — per-measure provenance is printed; mixing only arises when older records carry subsets |
| 6 | P4 (advisory) | usability | Artifact symmetry: the floor refusal records `keepRateDrift`, but the post-spend duration refusal records the two rates without the delta, emits no drift line, and neither refusal records the 5-point bound it was compared against — a reader sees `keepRateDrift: -0.03` with no rule explaining its silence | `plugins/kk/scripts/daily-stages.ts:852` vs `:1414-1424`, bound at `:422` | ACCEPTED — R3's reporting obligation is discharged at the pre-spend gate |
| 7 | P4 (advisory) | correctness | Residual coverage gap: `observedKeepRate` needs `10-collect/pool.json`. The legacy `kk-daily-ai-voice` DAG calls `daily-qc-content` without an extract node (its pool is `10-ingest/<date>_02_collect_blended.json`), so there `keepRate` is `null` and no drift is ever reported. Both live DAGs (`kk-news-generate`, `kk-daily-ai-voice2`) do write `pool.json` | `plugins/kk/scripts/daily-stages.ts:626-634`; `plugins/kk/workflows/kk-daily-ai-voice.yaml:209` | ACCEPTED — null is stated as null, never guessed; production DAGs covered |
| 8 | P4 (advisory) | architecture | Interaction with in-flight work: `daily-stages.ts` also carries 0433's `cn-lead-gate` import + `dailyCurateCheck` rules, and `apps/cli/tests/kk-workflow-stages.test.ts` carries 0433's `cnLeadGate` copy beside 0434's rescaled fixture — committing 0434 lands 0433's changes in the same files. No behavioural overlap found (`checkCnLeadPlan`/`enforceCnLead` are called only from `dailyCurateCheck`, which the 0434 fixtures never invoke); 0431/0432's `publish-matrix` and `surfdash-pub` edits touch no surface this task estimates from | `plugins/kk/scripts/daily-stages.ts:70`, `:5836`, `:5978`; `apps/cli/tests/kk-workflow-stages.test.ts:38-39` | ACCEPTED — flagged for the commit split, not a defect in 0434 |

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 — ladder and gate share one denominator (or the ladder states its keep-rate assumption) | MET | One arithmetic `spokenLength` (`plugins/kk/scripts/daily-stages.ts:730-738`), one bridge `projectKeptChars` (`:763-765`). Ladder: `keptChars = round(poolChars × keepRate)` then `spokenLength(keptChars, keptRatio)` (`:973-976`); gate: `estimateSpokenMinutes(docs, vdriver, calibration.keptRatio)` over the admitted chars (`:805-810`); post-spend: same call (`:1404-1405`). The assumption is stated, not implied: `keepRate` + `keepRateSource` in `ladder.json` (`:1007-1008`), printed per rung on stderr (`:988`). Pinned by `plugins/kk/tests/daily-estimate-denominator-0434.test.ts:206,245,334` and `plugins/kk/tests/daily-extract-ladder.test.ts:170` |
| R2 — every estimate artifact prints the ratio, its source path and the assumed keep rate | MET | `ladder.json`: `ratioUsed`/`ratioSource`, `keptRatio`/`keptRatioSource`, `keepRate`/`keepRateSource`, `spokenPerPoolChar`, `rungs[].keptChars` (`plugins/kk/scripts/daily-stages.ts:1003-1010`). Floor refusal: `expansion`/`expansionSource`, `keepRate`/`keepRateSource`, `keepRateAssumed`/`keepRateAssumedSource`, `keepRateDrift` (`:844-852`). Post-spend refusal: the same measures (`:1418-1423`). Run report: "Driving measure" + one line per measure with its source (`apps/cli/src/commands/daily.ts:653-656`). Asserted at `plugins/kk/tests/daily-estimate-denominator-0434.test.ts:245-282,334-386`, `apps/cli/tests/commands/daily.test.ts:369-376` |
| R3 — drift beyond a stated bound is reported, not absorbed | MET | Stated bound `KEEP_RATE_DRIFT_BOUND = 0.05` with its rationale (`plugins/kk/scripts/daily-stages.ts:416-422`); `keepRateDrift` prints on stderr with the observed %, the assumed % and its source, and the direction word (`:647-662`), called before the verdict branch so a **passing** gate reports it too (`:815`, `:826-833`); the refusal records the delta (`:852`). Observed measured from `10-collect/pool.json` vs the admitted candidates (`:626-634`), i.e. today's rate, never the assumed one. Pinned by `plugins/kk/tests/daily-estimate-denominator-0434.test.ts:283` (fires at −20 pts) and `:313` (quiet at −3 pts) |
| R4 — one test pins ladder/gate/settle arithmetic so a future change on either side fails | MET | `plugins/kk/tests/daily-estimate-denominator-0434.test.ts:334` drives extract → floor gate → post-spend refusal on one fixture and asserts all three report 19.9 min. Verified by mutation: switching the ladder to pool chars fails 3/5 tests (`66.2` vs `19.9`), the gate to the pool ratio fails 2/5 (`6.1` vs `19.9`), the settle to the 1.4 default fails 1/5 (`54` vs `19.9`); source restored byte-identical (`md5 ba7bc40e96472491f3e6600c053d58ad`) and the suite re-run green |

##### Acceptance Criteria

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| AC1 — ladder and gate agree on one fixture, and the test fails if either side switches denominator | MET | test + command | Cold-start fixture: ladder `rungs[0].keptChars = 12,000` of 40,000 pool at 0.30, both artifacts 10.9 min vs the pool-denominated 36.0 (`plugins/kk/tests/daily-estimate-denominator-0434.test.ts:206-243`); recorded-rate fixture: both 19.9 min, `refusal.candidateChars === rung.keptChars` (`:245-282`, `:334-386`). Mutation runs prove the failure direction (see R4). `bun test plugins/kk/tests/daily-estimate-denominator-0434.test.ts plugins/kk/tests/daily-extract-ladder.test.ts` → 11 pass / 0 fail |
| AC2 — a keep-rate shift is named: the ladder records the assumption and the run reports the drift on stderr | MET | test + command + manual-review | `ladder.keepRate = 0.5` with `keepRateSource` pointing at the recorded sibling file (`plugins/kk/tests/daily-estimate-denominator-0434.test.ts:283-311`), and the gate's stderr carries `keep rate drifted … 30% … 50%`. Quiet case at −3 pts (`:313-332`). Manual probe on a scratch workspace: recorded 20%, admitted 77%, gate **passed** (49.7 min > 15) and still printed `keep rate drifted: QC admitted 77% of the pool, the ladder estimate assumed 20% (…kept 0.20 of pool) — the estimate under-predicts the episode by ~285%` |

##### Evidence notes and gaps

- **One formula, checked by call graph.** `estimateSpokenMinutes` → `spokenLength` (`plugins/kk/scripts/daily-stages.ts:750-756`) and `projectKeptChars` → `spokenLength` (`:976`) are the only conversions in the estimate family; `readSpokenRatio`/`readKeptRatio` are gone from the tree (repo-wide grep: no remaining caller). The one adjacent estimate that keeps its own `8 + chars/rate` shape is `dailyGenerate`'s authored-script floor gate (`:1689-1694`) — a different denominator (the VoiceScript, ratio 1.0) with a deliberately opposite safety direction, pre-existing and untouched here.
- **Cold-start behaviour for an older record.** Probed with a sibling `21-plan/<date>_09_spoken-ratio.json` carrying only `ratio` (pre-0377 shape): the ladder emitted `keptRatioSource: "default 0.28 (no recorded kept ratio)"` and `keepRateSource: "default 0.30 (no recorded keep rate)"` while `ratioUsed: 0.5` kept its own source — the fallbacks are stated per measure, not guessed. Consequence worth knowing: such a workflow's ladder estimate drops from its own recorded 0.5 spoken/pool to 0.084, i.e. it walks to the widest rung (the documented cheap-error direction, `:407-414`). Records written since 0377 (`poolChars` + `keptChars`) need no fallback — `recordKeepRate` derives the rate (`:543-559`), which is what both AC2 fixtures exercise.
- **AC2's literal wording.** The suite pins a 20-point drift (fires) and a 3-point drift (quiet) around the stated 5-point bound rather than the AC's literal "7 points"; a 7-point shift fires by construction (`Math.abs(delta) > 0.05`, `:651`). The boundary case itself is unpinned: exactly 5.0 points is silent (`>` not `>=`), which matches "beyond" but has no test.
- **No new security surface.** The change adds JSON writes and stderr lines over paths already read by these stages; no shell interpolation, no new external input, and `clampKeepRate`/`clampRatio` bound a corrupt record to a plausible band (`:455-462`).
- **Efficiency.** The two sibling-directory scans became one (`:475-537`), so the QC stage walks a large workspace once instead of twice; the >5,000-entry glob guard is preserved.
- Test runs (repo root, `NODE_ENV=test`): `bun test plugins/kk/tests/daily-estimate-denominator-0434.test.ts plugins/kk/tests/daily-extract-ladder.test.ts` → 11 pass; `plugins/kk/tests/daily-floor-gate.test.ts plugins/kk/tests/daily-publish-path-0329.test.ts` → 17 pass; `apps/cli/tests/commands/daily.test.ts` → 26 pass; `apps/cli/tests/kk-workflow-stages.test.ts` → 181 pass; `apps/cli/tests/status-progress.test.ts apps/cli/tests/content-status-progress.test.ts apps/cli/tests/daily-cache-recovery.test.ts` → 16 pass; `npx biome check` on the six changed files → clean; `apps/cli` `tsc --noEmit` → clean.
- No requirement or AC row is left PARTIAL: every P4 above is an accepted observation, a documented tradeoff, or an out-of-scope interaction.

**Next:** no fix required for 0434; when committing, split 0433's `cn-lead-gate` hunks out of `daily-stages.ts` (finding 8) and consider making `estimateSpokenMinutes`'s `expansion` parameter required (finding 1).

Verdict: PASS

### References

- `plugins/kk/scripts/daily-stages.ts`: `dailyExtract` (ladder), `applyFloorGate`, `estimateSpokenMinutes`, `readKeptRatio`, `recordSpokenRatio`
- Measured artifacts: `.works/kk-news-generate/20261124/10-collect/ladder.json`, `30-audio/20261124_11_generate_content_duration-refusal.json`
- Prior fix for the same class: task 0377 (double discount), commit ecf5cb1e (post-spend ratio)
- `.spur/context/learnings.md` 2026-11-16: "One ratio, two denominators is a silent double discount"

### History

- 2026-11-25T16:57:35.991Z todo → wip (system)
- 2026-11-25T17:06:32.640Z wip → testing (system)
- 2026-11-25T17:06:34.496Z testing → done (system)

