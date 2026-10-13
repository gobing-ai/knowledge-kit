---
schema_version: 1
name: Decide and encode the thin-day episode policy instead of closing the day silently
status: done
template: issue
created_at: 2026-10-12T21:45:46.907Z
updated_at: "2026-10-13T17:14:43.324Z"
feature_id: G11

ac_altitude: task-local
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0266-verdict.json
---

## 0266. Decide and encode the thin-day episode policy instead of closing the day silently

### Background

`docs/04_DESIGN.md` and the 2026-10-12 pre-spend floor gate make a thin news day close as `no-content`: `kk stage daily-qc-content` empties the pool when the kept set's estimated spoken length cannot reach `episode_min_minutes`, "instead of paying for a synthesis pass that `daily-episode-duration` then refuses". So on a quiet day the product publishes nothing, and the operator learns nothing actionable from the workflow exit alone.

Measured on 2026-10-12 after the label fix: `kk store extract --topic ai-news --window 24h` returned 3 items, and 4 with the importance-only backfill — every one of the day's other candidates failed a hard dimension (`kk-item-quality >= 2` on stub-length bodies, `kk-item-category` allowlist). The operator override `episode_min_minutes=8` was needed to publish anything that day.

The open question is a product decision, not a bug: on a genuinely thin day, is the right answer (a) a shorter episode, (b) a wider extract window (96h reaches 7 items, at the cost of 3-4 day old, never-published backlog), or (c) no episode — and in case (c) what the operator sees and can act on.

**Refine corrections (2026-10-12)**

- R3 "make the outcome observable in run-report" → confirmed gap, and narrower than stated: `kk daily run-report` already writes `no-content`, but when the floor gate empties the candidates it reports `content QC admitted zero of the pooled items` (`apps/cli/src/commands/daily.ts:413-417`) — it never reads the floor-refusal artifact `21-plan/<date>_04_quality-control-content_floor-refusal.json` (`plugins/kk/scripts/daily-stages.ts:251-263`), so the estimate, floor and counts are lost from the report → R3 keeps its scope, re-pointed at that artifact.
- AC2 "no run can pass the floor and then fail `daily-episode-duration`" → not achievable as worded: the floor is a heuristic estimate (`SPEAK_CHAR_EXPANSION = 1.4`, calibrated on two runs, `daily-stages.ts:221`) while the duration gate measures the rendered MP3 and `failWith(1)`s (`daily-stages.ts:478-483`), aborting the run before run-report/ledger. Agreement can only be bounded (estimate margin) or the post-spend refusal routed to run-report like a no-content close → AC2 must be restated once the policy decision (Q&A D1) is made.
- Live workflow: the 04:30 job runs `kk-daily-ai-voice2.yaml` (`episode_min_minutes: "15"`, `episode_max_minutes: "25"`, `qc_min_episode_items: "8"`, lines 70-83); the floor gate sits in `daily-qc-content`, the measured gate in node `duration` (line 537).

### Requirements

- [x] R1. Record the chosen thin-day policy as a dated decision in the design doc's episode-window surface (`docs/design/kk-collect-and-daily-voice2.md` §6, the `daily-qc-content` node paragraph that already documents the 2026-10-12 floor gate), stating that `episode_min_minutes` = 15 is the hard line between "short episode" and "no episode", and that a shorter threshold is a follow-up only if thin days recur weekly. Not an ADR: the seam is one pipeline's stage list, already owned by that doc.
- [x] R2. Encode policy (c) in the QC/floor and duration paths: the 15-min `episode_min_minutes` stays the hard pre-spend floor (estimate unchanged), and the residual post-spend `daily-episode-duration` refusal — a pool that passed the floor estimate but rendered short — must be classified and reported like a no-content close (measured vs estimated minutes, floor, pool/kept counts, in run-report and the ledger row) instead of aborting the run before run-report/ledger write their row. Exact estimate/measured agreement is not pursued: the floor is the calibrated estimate (`SPEAK_CHAR_EXPANSION = 1.4`, `daily-stages.ts:221`), the duration gate measures the rendered MP3 (`daily-stages.ts:478-483`).
- [x] R3. Make the outcome observable in `run-report`: when either refusal artifact exists (`21-plan/<date>_04_quality-control-content_floor-refusal.json`, pre-spend; `30-audio/<date>_11_generate_content_duration-refusal.json`, post-spend), the `no-content` reason line names the estimate (and, for the duration refusal, the measured minutes), the floor, and the eligible/kept counts — so an operator can tell a thin news day from a broken ingest without reading the store.
- [x] R4. Cover the chosen branch with a test that fails before the change — the floor gate is the only thing standing between a thin pool and a paid synthesis pass.

### Acceptance Criteria

- [x] AC1 — A day whose kept set cannot reach the floor follows the recorded policy end to end, with the run-report naming the reason and the counts. (req: R1, R2, R3)
- [x] AC2 — When `daily-episode-duration` refuses an episode that passed the pre-spend floor (measured minutes < `episode_min_minutes`), the run does not abort: the stage writes `30-audio/<run_date>_11_generate_content_duration-refusal.json` (fields: `measuredMinutes`, `estimatedMinutes`, `minMinutes`, `keptCount`, `candidateChars`), empties the candidates file, and exits 0; the publish subtree is skipped (`publish-prep`, `show-notes` and `xhs-render` pool-gated on the candidates file, mirroring the QC-zero guards); and `kk daily run-report` closes the run as `no-content` with a `run-report.summary.txt` line naming the measured vs estimated minutes, the floor, and the pool/kept counts (the ledger's Result cell). (req: R2)
- [x] AC3 — The regression test fails against the pre-change code. (req: R4)

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

#### Q&A entry — 2026-10-13T02:47:00.851Z

- **D1 (OPEN — operator decision, blocks Design/Plan).** On a day whose kept set estimates below `episode_min_minutes` (15), what ships?
  - (a) **Short episode** — lower the floor to a "short-episode" threshold (e.g. 8 min, the 2026-10-12 manual override) and keep 15 as the target, not the gate. Cost: a thinner product some days; the duration gate's minimum moves with it.
  - (b) **Wider window fallback** — re-extract with a wider `--window` (96h reached 7 items on 2026-10-12) before giving up. Cost: 3–4-day-old items in a "daily" show; one extra extract per thin day.
  - (c) **No episode (status quo)** — keep 15 as a hard floor; only fix R3 observability and the post-spend abort. Cost: silent product days continue, but they are now explained.
  - Refiner recommendation: **(c) + R3**, with (a) as the follow-up if thin days recur weekly — it is the only option that needs no new product judgment and fixes the "operator learns nothing" half today. Not closed under `--auto`: this is a product policy, not an evidence question.
- D2 (deferred to D1) — Restate AC2: estimate margin vs routing a post-spend `daily-episode-duration` refusal into run-report/ledger.

#### Q&A entry — 2026-10-13T05:31:21Z

- **D1 (CLOSED — operator decision, Robin Min, 2026-10-13).** Option **(c) — no episode (status quo)**: `episode_min_minutes` (15) stays the hard pre-spend floor; a thin day closes as `no-content`. Operator's words: "R1 decision: 15 min stays the gate. R2: estimate and measured daily-episode-duration agree -> a day cannot pass the floor and then be refused after the spend. R3: run-report: no-content + reason + eligible/kept counts." Consequence: the work is R3 observability (run-report reads the refusal artifacts) plus routing the residual post-spend `daily-episode-duration` refusal to a classified no-content close. Option (a) — a shorter "short-episode" threshold — is explicitly **not** taken now; it is the documented follow-up if thin days recur weekly. Option (b) — wider-window backfill — is **not** taken.
- **D2 (CLOSED).** Exact estimate/measured agreement is impossible, so AC2 is restated (see Acceptance Criteria): the floor is a heuristic estimate (`SPEAK_CHAR_EXPANSION = 1.4`, `plugins/kk/scripts/daily-stages.ts:221`) while `daily-episode-duration` measures the rendered MP3 (`daily-stages.ts:478-483`). The enforceable form of R2 under policy (c): the post-spend refusal must be **classified and reported** like a no-content close — measured vs estimated minutes, floor, pool/kept counts — instead of aborting the run before run-report/ledger write their row.

### Design

Policy (c), decided 2026-10-13 (Q&A D1): `episode_min_minutes` = 15 stays the hard floor; a thin day closes as `no-content`. This is a bug-shaped observability + routing change, not an architecture change — three narrow edits on the existing floor-gate pattern.

**R1 owner — design doc, not ADR.** `docs/design/kk-collect-and-daily-voice2.md` §6 node map already owns the floor gate (the `daily-qc-content` paragraph, which documents the 2026-10-12 gate and its refusal artifact). The implementer extends that paragraph with the dated policy: 15 min is the hard line between "short episode" and "no episode"; option (a) short-episode is a documented follow-up only if thin days recur weekly; option (b) wider-window backfill was rejected (imports 3–4-day-old items into a "daily" show). No ADR — the seam is one pipeline's stage list.

**Edit 1 — classify the post-spend refusal instead of aborting.** `plugins/kk/scripts/daily-stages.ts`, `dailyEpisodeDuration` (today `daily-stages.ts:478-483`): the under-minutes branch stops calling `failWith(1)` and instead does what `applyFloorGate` (`daily-stages.ts:233-266`) does pre-spend — write `30-audio/<run_date>_11_generate_content_duration-refusal.json` (sibling of the `_11_generate_content.json` it reads, named like the floor refusal) carrying `{reason, measuredMinutes, estimatedMinutes, minMinutes, keptCount, candidateChars}`, then empty the candidates file's `metadata.docs` (same `sted('write', …)`/`writeJsonText` pattern) and exit 0. The estimate is recomputed from the still-non-empty candidates with the same `SPEAK_CHAR_EXPANSION`/`spokenCharRate` arithmetic, so the stage gains a 5th `vdriver` argument. Idempotency guard first: if the refusal artifact already exists, log and exit 0 (a rerun must not recompute an estimate from the emptied candidates). The over-max branch (> 25 min) keeps `failWith(1)` — trimming is a different problem and out of scope.

**Edit 2 — pool-gate the publish fan after `duration`.** `.spur/workflows/kk-daily-ai-voice2.yaml`: pass `"${vars.vdriver}"` as the duration stage's 5th argument, and prepend `kk store pool-count <candidates> --min 1 &&` to the conditions of `publish-prep` (now pool-count + `publish_enabled`) and `xhs-render` (now pool-count + `xhs_enabled`), and add that pool-count condition to `show-notes` (today it has none — its only skip path is dependency cascade). This mirrors the existing QC-zero guards: on a refusal, the emptied candidates skip the publish/XHS/show-notes subtree (`publish-podcast`, `xhs-publish`, `wechat-publish`, `translate-*`, `publish-classify` skip by dependency cascade), `mark-published` already carries the guard (rows stay `selected`, freed next run), `quality` still audits the refused MP3 (done+skipped mix proceeds — informative, read-only), and `run-report`/`ledger` still run through their `extract` edge. `xhs-write` runs before `duration`, so its plan/cards are already written on a refusal path; the `xhs-render` guard is what stops that channel, and the stale plan is harmless (date-stamped, unused).

**Edit 3 — run-report reads the refusal artifacts.** `apps/cli/src/commands/daily.ts`, `runReportAction` (today `daily.ts:413-421`): in the `poolCount === 0 || candidateCount === 0` branch, before the existing two-line reason choice, read the refusal artifacts in priority order — `30-audio/<run_date>_11_generate_content_duration-refusal.json` first, then `21-plan/<run_date>_04_quality-control-content_floor-refusal.json` — and build the reason from their fields plus the already-computed `poolCount`: floor refusal → `no-content: a <kept>-item pool estimated <estimatedMinutes> min of speech, below the <minMinutes> min floor — pre-spend refusal (pool <poolCount>, kept <ids.length>)`; duration refusal → `no-content: the episode ran <measuredMinutes> min (pre-spend estimate <estimatedMinutes> min), below the <minMinutes> min floor — duration refusal after synthesis (pool <poolCount>, kept <keptCount>)`. A missing/unparsable artifact falls through to today's lines unchanged. The reason goes into the report body, `run-report.summary.txt` (the ledger's Result cell) and the stdout JSON's `reason` field.

**Tradeoffs rejected.** (a) Short-episode floor — product decision explicitly deferred (Q&A D1 follow-up). (b) Wider-window backfill — stale items in a daily show. (c) `onError: continue` on the `duration` node instead of exiting 0 — a continued failure still admits dependents (the engine's done+skipped-mix rule), so `publish-prep` would publish the sub-floor episode. (d) Teaching each publish stage to refuse — spreads one gate across five stages. (e) Bound the estimate with a safety margin (e.g. floor + 2 min) — trades thin days away from publication more often without removing the residual case, and the operator chose explained silent days over fewer of them.

### Plan

Ordered checklist. Tests first (they must fail against the pre-change code), then the three edits, then docs and gates. Work in `/Users/robin/xprojects/knowledge-kit-runall-g11-74ac` on the batch branch; leave the task at `todo` transitions to the batch driver.

1. **Regression tests — stage.** `apps/cli/tests/daily-generate-sections.test.ts` (the `runStage(['daily-episode-duration', …])` harness, ~line 868): add cases — (i) under-minutes with a non-empty candidates fixture → exit 0, `30-audio/<date>_11_generate_content_duration-refusal.json` written with `measuredMinutes`/`estimatedMinutes`/`minMinutes`/`keptCount`/`candidateChars`, candidates `metadata.docs` emptied; (ii) refusal artifact already present → exit 0, artifact and candidates untouched (idempotency); (iii) over-max → still exit 1 (unchanged behavior pinned).
2. **Regression tests — run-report.** `apps/cli/tests/commands/daily.test.ts`, `describe('kk daily run-report')` (~line 170): add cases — floor-refusal artifact present → `noContent: true`, summary line names estimated minutes, floor, pool/kept counts; duration-refusal artifact present → summary names measured vs estimated minutes, floor, counts; neither artifact → today's two fallback lines byte-identical.
3. **Regression tests — DAG.** `apps/cli/tests/voice2-dag.test.ts`: extend the publish-gate loop (the `must be publish-gated` list, ~line 504) or add a focused case — `publish-prep` and `xhs-render` conditions contain `kk store pool-count … candidates.json --min 1` and still contain `publish_enabled`/`xhs_enabled`; `show-notes` gains the pool-count condition; the `duration` node command passes `${vars.vdriver}` as the 5th argument; `run-report`/`ledger` stay un-gated (existing assertion).
4. **Edit 1.** `plugins/kk/scripts/daily-stages.ts` `dailyEpisodeDuration`: under-minutes branch per Design Edit 1 (refusal artifact + emptied candidates + exit 0 + idempotency guard; 5th `vdriver` arg; over-max unchanged).
5. **Edit 2.** `.spur/workflows/kk-daily-ai-voice2.yaml`: duration node gains `"${vars.vdriver}"`; pool-count guard prepended to `publish-prep` and `xhs-render` conditions; pool-count condition added to `show-notes`. Update the `duration` node description ("fail loud" → refuse-and-close) and the header comment if it still says the gate aborts the run.
6. **Edit 3.** `apps/cli/src/commands/daily.ts` `runReportAction`: refusal-artifact reason precedence per Design Edit 3 (duration refusal > floor refusal > existing lines); `reason` lands in the report body, `run-report.summary.txt` and the stdout JSON.
7. **Docs (R1).** Extend the `daily-qc-content` paragraph in `docs/design/kk-collect-and-daily-voice2.md` §6 with the dated 2026-10-13 policy (15 = hard line; (a) is a follow-up only if thin days recur weekly; (b) rejected), and note the duration-refusal close + run-report precedence in the same paragraph or the node-map rows for `duration`/`publish-prep`/`show-notes`/`xhs-render`.
8. **Narrow tests (judge by pass/fail counts — a single-file `bun test` can exit 1 on the coverage threshold, not failures):** `bun test apps/cli/tests/daily-generate-sections.test.ts apps/cli/tests/commands/daily.test.ts apps/cli/tests/voice2-dag.test.ts`
9. **Gates:** `bun run lint` → `bun run test` → `bun run build`; then `spur task check 0266`. Record outcomes in Testing.
10. Leave `git status` showing only intentional files; the batch driver promotes the task.

### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution

Implementation change map (thin-day policy (c), Q&A D1, 2026-10-13). Tests were written first and captured failing against the pre-change code (3 fail in `daily-generate-sections.test.ts`, 2 fail in `commands/daily.test.ts`, 2 fail in `voice2-dag.test.ts`; see AC3).

- `plugins/kk/scripts/daily-stages.ts:229` — new shared `estimateSpokenMinutes(docs, vdriver)`: title+body characters x `SPEAK_CHAR_EXPANSION` (1.4) over `spokenCharRate(vdriver)` + the 8 s intro sting; returns rounded minutes, unrounded seconds and chars — the pre-spend floor gate and the post-spend refusal now report the same arithmetic.
- `plugins/kk/scripts/daily-stages.ts:249` — `applyFloorGate` refactored onto that helper; external contract unchanged (the 0265 floor-gate suite stays green).
- `plugins/kk/scripts/daily-stages.ts:470` — `dailyEpisodeDuration` gains the 5th `vdriver` argument; the under-minutes branch no longer calls `failWith(1)`: idempotency guard on an existing refusal, writes `30-audio/<date>_11_generate_content_duration-refusal.json` (`measuredMinutes`, `estimatedMinutes`, `minMinutes`, `keptCount`, `candidateChars`, `reason`), empties the candidates file's `metadata.docs`, exits 0. The over-max branch still fails loud; voice1's 4-argument call still works (`vdriver` defaults empty -> voicebox rate).
- `plugins/kk/workflows/kk-daily-ai-voice2.yaml:562` — `duration` node passes `"${vars.vdriver}"` as the 5th argument; description rewritten from "fail loud" to refuse-and-close semantics. (The `.spur/workflows/` copy is the same inode — a hardlink — so both views carry the edit.)
- `plugins/kk/workflows/kk-daily-ai-voice2.yaml:577` — `publish-prep` condition gains the candidates `kk store pool-count ... --min 1` guard ahead of the existing `publish_enabled` test, mirroring the QC-zero guards.
- `plugins/kk/workflows/kk-daily-ai-voice2.yaml:618` — `show-notes` gains the same pool-count condition (it had none; its only skip path was dependency cascade).
- `plugins/kk/workflows/kk-daily-ai-voice2.yaml:674` — `xhs-render` condition gains the pool-count guard ahead of `xhs_enabled` (xhs-write runs before duration, so the stale plan/cards are already on disk when a refusal lands).
- `apps/cli/src/commands/daily.ts:402` — new `noContentReason(workDir, runDate, poolCount)`: reads the duration-refusal artifact first (later, more specific fact), then the floor refusal, validating the numeric fields; anything missing/unparsable falls through to today's lines unchanged.
- `apps/cli/src/commands/daily.ts:456` — `runReportAction`'s no-content branch uses it; the reason lands in the report body, `run-report.summary.txt` (the ledger Result cell) and the stdout JSON `reason` field.
- `docs/design/kk-collect-and-daily-voice2.md:248` — R1: the `daily-qc-content` paragraph now records the dated 2026-10-13 policy (15 = the hard line between short episode and no episode; option (a) short-episode only as a follow-up if thin days recur weekly; option (b) wider-window backfill rejected) plus the duration-refusal close and the run-report artifact precedence.
- `apps/cli/tests/daily-generate-sections.test.ts:945` — new 0266 describe: under-floor close (exit 0, refusal artifact fields, emptied candidates), idempotent rerun (bytes unchanged), over-max still exit 1 with no artifact; the existing 0257 merged-length test tail updated to the classified close (exit 0 + refusal records the merged length).
- `apps/cli/tests/commands/daily.test.ts:217` — run-report: no-artifact fallback byte-identical, floor-refusal naming (estimate, floor, pool/kept), duration-refusal naming (measured vs estimated) with precedence over the floor artifact.
- `apps/cli/tests/voice2-dag.test.ts:607` — DAG: `duration` command passes `vdriver`; `publish-prep`/`xhs-render` pool-gated and flag-gated; `show-notes` pool-gated; the 0236 xhs gate test updated to the folded two-part condition.
- `plugins/kk/tests/kk-workflow-stages.test.ts:732` — standing 4-argument duration test updated to the 0266 contract: under-floor now asserts exit 0 and the refusal artifact fields `measuredMinutes`/`minMinutes` (8.3 / 15); over-max, missing-duration and invalid-bounds pins unchanged.
- `plugins/kk/tests/verdict-confidence.test.ts` (unmodified) — collateral confidence-contract verification over this task's workflow edit: 61 pass / 0 fail (exit 0), every HIGH/MEDIUM/LOW routing case of the live guards intact against the edited `kk-daily-ai-voice2.yaml`; the three new node conditions are pool-count + enable-flag tests only, so no new confidence-aware verdict consumer was introduced.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `docs/design/kk-collect-and-daily-voice2.md:248` — dated 2026-10-13 thin-day policy recorded: episode_min_minutes 15 is the hard line between short episode and no episode; a shorter threshold is a documented follow-up only if thin days recur weekly; wider-window backfill rejected |
| R2 | MET | `plugins/kk/scripts/daily-stages.ts:497-531` — under-floor branch writes the duration-refusal artifact (measuredMinutes, estimatedMinutes, minMinutes, keptCount, candidateChars), empties the candidates file, exits 0; over-max still fails loud at `plugins/kk/scripts/daily-stages.ts:529`; shared estimate helper `plugins/kk/scripts/daily-stages.ts:229`; duration passes vdriver at `plugins/kk/workflows/kk-daily-ai-voice2.yaml:562`; publish fan pool-gated `plugins/kk/workflows/kk-daily-ai-voice2.yaml:577,618,674`; guard predicate `apps/cli/src/commands/store.ts:1433` |
| R3 | MET | `apps/cli/src/commands/daily.ts:402-441` — noContentReason reads the duration-refusal artifact first, then the floor refusal, then the two fallback lines; call site `apps/cli/src/commands/daily.ts:456`; the reason lands in the report body, run-report.summary.txt and the stdout reason field |
| R4 | MET | `apps/cli/tests/daily-generate-sections.test.ts:945-993` — 0266 describe (under-floor close exit 0 + refusal fields + emptied candidates; idempotent rerun; over-max still exit 1) — plus `apps/cli/tests/commands/daily.test.ts:217-321` and `apps/cli/tests/voice2-dag.test.ts:607`; all pass this run; the assertions demand an exit-0 refusal artifact the pre-change failWith(1) code could not produce |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — A day whose kept set cannot reach the floor follows the recorded policy end to end, with the run-report naming the reason and the counts. (req: R1, R2, R3) | MET | command | real CLI `kk daily run-report` over a fixture with the floor-refusal artifact present -> exit 0, noContent:true, summary `no-content: a 3-item pool estimated 9.4 min of speech, below the 15 min floor — pre-spend refusal (pool 3, kept 3)`; code `apps/cli/src/commands/daily.ts:402-441` |
| AC2 — When `daily-episode-duration` refuses an episode that passed the pre-spend floor (measured minutes < `episode_min_minutes`), the run does not abort: the stage writes `30-audio/<run_date>_11_generate_content_duration-refusal.json` (fields: `measuredMinutes`, `estimatedMinutes`, `minMinutes`, `keptCount`, `candidateChars`), empties the candidates file, and exits 0; the publish subtree is skipped (`publish-prep`, `show-notes` and `xhs-render` pool-gated on the candidates file, mirroring the QC-zero guards); and `kk daily run-report` closes the run as `no-content` with a `run-report.summary.txt` line naming the measured vs estimated minutes, the floor, and the pool/kept counts (the ledger's Result cell). (req: R2) | MET | command | real CLI `kk stage daily-episode-duration` on a throwaway fixture -> exit 0, refusal artifact measuredMinutes 8.5, estimatedMinutes 0.4, minMinutes 15, keptCount 2, candidateChars 54, candidates emptied; idempotent rerun unchanged; over-max exit 1 no artifact; code `plugins/kk/scripts/daily-stages.ts:497-531` |
| AC3 — The regression test fails against the pre-change code. (req: R4) | MET | test | `apps/cli/tests/daily-generate-sections.test.ts:945-993` 0266 describe passes this run; its exit-0 + refusal-artifact assertions cannot pass against the pre-change under-floor failWith(1) branch shown in the diff |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 0266

**Scope:** 0266 working tree — `plugins/kk/scripts/daily-stages.ts`, `apps/cli/src/commands/daily.ts`, `plugins/kk/workflows/kk-daily-ai-voice2.yaml` (hardlinked `.spur/workflows/` copy, same inode 485039744), `docs/design/kk-collect-and-daily-voice2.md`, and the four test files; plus the in-range harness commit `741a0cb5` (`apps/cli/tests/commands/stage.test.ts` child-process build). Pre-existing commits `25137d53`, `008792ad`, `4b0d633b` in the range are not 0266 requirements.

**Dimensions:** functional, security, efficiency, correctness, usability, architecture

**Verdict:** PASS

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P4 (advisory) | robustness | The idempotency guard keys only on the refusal artifact: a hard kill between the refusal write (`daily-stages.ts:508`) and the candidates-empty write (`daily-stages.ts:519`) — or a candidates-write failure — leaves the refusal present while the candidates stay non-empty; a rerun then takes the early return (`daily-stages.ts:499`) and never re-empties, so the pool-count-gated publish subtree would package a sub-floor episode. Hard-kill-only window, non-blocking; a one-line hardening (re-empty when the refusal exists but the candidates still hold docs) would close it. | `plugins/kk/scripts/daily-stages.ts:499` | ACCEPTED |

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `docs/design/kk-collect-and-daily-voice2.md:248` — dated 2026-10-13 policy recorded: 15 = hard line between short episode and no episode; (a) short-episode follow-up only if thin days recur weekly; (b) wider-window backfill rejected |
| R2 | MET | `plugins/kk/scripts/daily-stages.ts:497-531` — under-floor branch writes the refusal artifact (measured/estimated/min/kept/chars), empties candidates, exits 0; over-max still `failWith(1)` at `:528-531`; `plugins/kk/workflows/kk-daily-ai-voice2.yaml:562,577,618,674` — duration passes `${vars.vdriver}`, publish-prep/show-notes/xhs-render pool-gated `--min 1` |
| R3 | MET | `apps/cli/src/commands/daily.ts:402-441` — `noContentReason` reads the duration refusal first, then the floor refusal, then the two fallback lines; `:456` call site; reason lands in the body, `run-report.summary.txt`, and the stdout `reason` field |
| R4 | MET | `apps/cli/tests/daily-generate-sections.test.ts:945` (under-floor/idempotent/over-max), `apps/cli/tests/commands/daily.test.ts:217` (byte-identical fallback + refusal naming/precedence), `apps/cli/tests/voice2-dag.test.ts:607` (DAG guards) — all green this run; the assertions demand exit-0 + a refusal artifact the pre-change `failWith(1)` code cannot produce (AC3) |

**Next:** no remediation required; the P4 crash-window is accepted as-is.

**Confidence:** HIGH

**Why this level:** re-ran all five narrow suites green this run (24 + 21 + 41 + 115 + 55 tests, 0 fail) and re-read every anchor (`plugins/kk/scripts/daily-stages.ts:229,249,497-531`, `apps/cli/src/commands/daily.ts:402-456`, `plugins/kk/workflows/kk-daily-ai-voice2.yaml:562-824`, `apps/cli/src/commands/store.ts:1417-1446`); byte-compatibility and the unchanged floor-gate arithmetic verified by diff; AC3 verified by inspection (new-only assertions) — no revert performed (read-only review).

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History

- 2026-10-13T06:02:28.624Z todo → wip (system)
- 2026-10-13T17:14:08.518Z wip → testing (system)
- 2026-10-13T17:14:43.308Z testing → done (system)

