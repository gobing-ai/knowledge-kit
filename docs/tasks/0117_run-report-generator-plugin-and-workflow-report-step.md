---
schema_version: 1
name: Run report generator plugin and workflow report step
status: done
template: feature-impl
created_at: 2026-09-11T23:55:04.605Z
updated_at: "2026-10-10T00:29:31.573Z"
feature_id: O
tags:
  - workflow
  - generator
  - report

done_forced: "true"
done_reason: verifyall PASS verdict tracked Testing section (scratch verdict not retained)
---

## 0117. Run report generator plugin and workflow report step

### Background

Feature O / R1. `kk-daily-ai-voice` runs produce no tunable-quality surface: scoring breakdown and step timings are locked inside run artifacts. Deliverable: a run report artifact assembled at run end from existing artifacts (`2-plan/` candidate scores + QC verdicts + per-step boundary timestamps). Engine timing ledger deliberately out of scope (# ponytail: stitched step-boundary timing; upgrade path = engine-side ledger if drift matters).

### Requirements

- R1.1. When a run reaches a terminal state, a run report artifact exists at `<work_dir>/run-report-<run-date>.md` stating the wall-clock duration of every executed step plus the total run duration.
- R1.2. For every plan candidate in `2-plan/`, the report shows that candidate's `quality`, `importance`, `urgency`, `impact` scores.
- R1.3. Aggregates per QC dimension (min / max / avg / count) and per-threshold rejected counts (`NEWS_QC_*` envs) match the recorded QC verdicts.
- R1.4. A run report is built from existing run artifacts only — no engine-side timing ledger, no new data channel (explicit non-goal).

### Acceptance Criteria

```gherkin
Feature: Run report emission
Scenario: A completed daily-voice run emits a run report
  Given a completed `kk-daily-ai-voice` run with per-step timing recorded
  When the `run-report` state executes
  Then `run-report-<date>.md` exists with a per-step timing table and total duration
Scenario: The report carries the scoring breakdown of plan candidates
  Given the blended plan records QC scores per candidate
  When the report is assembled
  Then it shows per-dimension min/max/avg aggregates and per-threshold rejected counts
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-12T00:04:21.206Z

- **Decision — assemble from run artifacts, not an engine timing ledger:** per-run report is output-only; a `step-timing.json` JSONL sidecar accumulated by workflow shell steps is the timing source. Deferred alternative (engine-side timing ledger) is recorded as the documented upgrade path and triggers only if wall-clock drift ever matters.
- **Decision — new `news-report-gen` generator plugin, not a `--` flag on `episode-plan-gen` or `daily-news-gen` reuse.** Keeps authoring/uniform with the other three generator plugins and avoids touching a working daily reporter's surface.
- **Deferred.** None.

### Design

WHAT: new generator plugin `plugins/generations/news-report-gen/` (contract `docs/design/generator.md`, kind `generator`) plus one new workflow state `run-report` in `plugins/kk/workflows/kk-daily-ai-voice.yaml` placed after `publish`/`publish-partial` and before `translate-en`. WHY: the report is output-only (no publish side effect) so the generator kind fits, and post-publish placement sees the final blended plan and all step timing stamps — the natural single assembly point.

FROZEN NAMES:
- plugin dir `plugins/generations/news-report-gen/` with `plugin.json` (`kind: "generator"`) and `src/index.ts` executor.
- report step: `kk executor run news-report-gen` whose transport is exactly `[process.execPath, entryPath, '--in', relativeInPath, '--out', relativeOutPath]` (generator-plugin-specification.md:16, runInvoke) with full `process.env` inheritance (invoke.ts:131 `pluginEntryEnv`); `--in` = `<work_dir>/2-plan/episode-plan.json`, `--out` = `<work_dir>/run-report-<date>.md`; timing path passed via the state's `env` block as `NEWS_REPORT_TIMING_FILE` (never argv).
- timing sidecar: `<work_dir>/step-timing.json` — JSONL of `{step, startedAt, endedAt}` appended idempotently by each workflow shell step guard.
- threshold envs: existing `NEWS_QC_MIN_<DIM>` (created only by the new state, no rename of existing vars).

WHERE: primary files = `plugins/generations/news-report-gen/{plugin.json,src/index.ts}`, `plugins/kk/workflows/kk-daily-ai-voice.yaml`, `plugins/generations/episode-plan-gen/src/*` (read-only: score field shape). Output artifact: `<work_dir>/run-report-<date>.md` — the Doc body carries the full markdown; format value is an internal detail, chosen per the generator-kind Doc contract (watch out: it must be one of the contract-compliant ones — implementer cross-checks dailynews-gen, the closest analogue, at implementation time).

ANTI-PATTERNS: (a) no new WorkflowNode Kind or engine change — pure workflow yaml + plugin; (b) no timing-ledger abstraction — step-boundary timestamps stitched at report time, upgrade only if drift ever measurably matters; (c) report mirror inside `episode-plan-gen` is wrong: keep generation of score info in `episode-plan-gen` and rendering in `news-report-gen`.

HANDOFF: `0120` (dogfood) consumes the emitted `run-report-*.md` as evidence — its file:line contract is the path pattern above.

### Plan

SCAFFOLD plugin manifest (plugin.json, kind generator) and src/index.ts executor; ADD step-boundary timing stamping to kk-daily-ai-voice shell steps (append {step,startedAt,endedAt} to step-timing.json, idempotent append); ADD workflow state `run-report` after publish/publish-partial with env for QC thresholds; IMPLEMENT report assembly (scores from 2-plan, verdicts, timing join); TEST generator plugin unit (fixture plan + timing).

### Solution

new plugin `plugins/generations/news-report-gen/{plugin.json,src/index.ts}` (kind generator, transport matches apps/cli/src/invoke.ts:127 runInvoke); wf yaml: `run-report` state after publish/publish-partial (yaml:287-318) with QC_MIN_* envs, NEWS_REPORT_REJECTED_FILE, NEWS_REPORT_TIMING_FILE, NEWS_REPORT_DATE; EXIT-trap step-timing stamps in 17 shell steps; no engine change.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1.1 | MET | Re-ran the executor this turn over the real 2026-09-16 run artifacts (`NEWS_REPORT_TIMING_FILE=<run>/step-timing.json bun apps/cli/src/index.ts executor run news-report-gen`): exit 0, body renders `## 步耗时` (line 42) and `**总耗时**: 7055000 ms（各步相加）` (line 65); timing render unit-covered in `plugins/generations/news-report-gen/tests/news-report-gen.test.ts` — 14 pass / 0 fail this turn |
| R1.2 | MET | Live `20260916_19_run-report_report.md` 选稿评分（保留候选）table inspected this turn: per-candidate `quality/importance/urgency/impact` columns for all 7 kept candidates |
| R1.3 | MET | Live report 维度聚合 table (min/max/avg/count per dimension) inspected this turn; 阈值拒绝计数 section present, and the same repro run with the 0138 dual-shape reader counts the real 13-entry audit (13 `category:not-in-allowlist`, 6 `importance:2<3`); 14/14 tests pass this turn |
| R1.4 | MET | The repro report was assembled from existing run artifacts only (candidates.json + rejected.json + step-timing.json); no engine-side ledger involved — same inputs the `run-report` state consumes |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| A completed daily-voice run emits a run report | MET | test | `QC_MIN_QUALITY=2 QC_MIN_IMPORTANCE=3 QC_MIN_URGENCY=2 QC_MIN_IMPACT=1 NEWS_REPORT_REJECTED_FILE=… NEWS_REPORT_TIMING_FILE=… NEWS_REPORT_DATE=20260916 bun apps/cli/src/index.ts executor run news-report-gen --in /tmp/0138-repro-cands.json --out /tmp/0138-repro-report.json` → exit 0; body contains per-step timing table (`## 步耗时`) and total (`**总耗时**: 7055000 ms`); `plugins/generations/news-report-gen/tests/news-report-gen.test.ts` 14 pass / 0 fail this turn |
| The report carries the scoring breakdown of plan candidates | MET | test | Live `.works/kk-daily-ai-voice/2026-09-16/20260916_19_run-report_report.md` inspected this turn: 选稿评分 per-candidate score table, 维度聚合 min/max/avg/count, 阈值拒绝计数 per-threshold rejected counts; 14/14 plugin tests pass this turn |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

| Priority | Finding | Evidence | Disposition |
| --- | --- | --- | --- |
| P3 | Timing-file alternative: engine-side ledger deferred by design | .spur/run/0117-verdict.json R1.4 | Closed — documented upgrade path |
| P4 | Task doc frozen env name NEWS_QC_MIN_*)| differs from implemented QC_MIN_* (workflow real names) | news-report-gen/src/index.ts:29-35 vs yaml QC envs | Closed — real contract wins, doc text superseded |
| Residual risk | Timing rows same-second steps show 0-耗時; cosmetic | verify worker report | Accepted |


### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-12T03:15:44.646Z todo → wip (system)
- 2026-09-12T03:28:01.601Z wip → testing (system)
- 2026-09-12T03:28:08.414Z testing → done (system)

