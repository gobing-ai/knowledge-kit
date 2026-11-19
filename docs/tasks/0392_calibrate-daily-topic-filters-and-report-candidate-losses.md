---
schema_version: 1
name: Calibrate daily topic filters and report candidate losses
status: done
template: feature-impl
created_at: 2026-11-18T04:42:14.699Z
updated_at: "2026-11-19T23:20:12.483Z"
feature_id: L3
priority: P1

estimate_hours: 7
ac_altitude: graduating
ac_numbering: task-local
done_forced: "false"
done_reason: unforced close
---

## 0392. Calibrate daily topic filters and report candidate losses

### Background

The v2 mechanical boundary in `plugins/kk/scripts/topic-boundary.json` enforces `prc-leadership` and the future-date conflict. In the current news path, `plugins/kk/workflows/kk-news-generate.yaml` invokes the editorial skill for curate and curate-fix. The skill and its style contract still exclude entire public-affairs classes, including AI-relevant regulation and export controls. The reportable losses also include extraction and its window ladder, profile/QC admission, title dedup, duration/floor gates, Agent curation, and draft/final-variant channel review. See [L3 design](../design/daily-ai-news-editorial-delivery.md#过滤规则与执行报告).

**Refine corrections (2026-11-18)**

- The earlier policy citation covered one prompt only. The live workflow reads the skill plus its selection and style references, so calibrate the effective rule across both curate paths and audit the legacy voice flows for drift.
- The normal report is conditional on pool admission. The early path in `writePoolGate` writes a summary, so trace that path separately and exercise it through `kk news prepare`.
- A QC exclusion file records decisions where there were hits. It does not cover the stage inventory or prove zero hits. Capture observed counts at each stage and distinguish missing evidence.
- The separate L3 worktree has implementation commit `f6c4ce57`. It is absent from main and is the starting point for integration review. Its recorded stages stop at plan and floor, so verify coverage of the live curation and channel-review results before accepting R14.

### Requirements

- [x] R1. Inventory the operative rules for selection and platform admission, including adult content, gambling, drugs, domestic politics and leadership. Replay historical and contrast fixtures. Admit AI-subject public-policy candidates that otherwise qualify and preserve verified mechanical and per-channel restrictions.
- [x] R2. Produce retry-safe selection evidence covering raw pool, QC, mechanical boundary, title dedup, Agent curation and channel admission. Show the current attempt in the ordinary and no-content reports, including unique exclusions, rule hits, observed zero and unknown stages.

Out of scope: new policy categories without supporting evidence, publisher permissions, production schedule changes and cross-episode identity (0393).

### Acceptance Criteria

```gherkin
Scenario: AC1 — R14 — 过滤规则按内容风险校准并在最终报告留证 (req: R1; R2)
  Given a replay pool with a hard-rule hit, a future-dated item, an AI-relevant public-policy story, an incidental keyword, a duplicate title and an item with more than one rule hit
  When news preparation, curation and reporting run on fixture input, including an empty-pool attempt and a retry
  Then backed restrictions stay enforced, editorial and channel decisions retain their own reasons, and both report paths show reconciled attempt counts with observed zero distinct from skipped or missing evidence
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-18T04:50:04.953Z

**Ready decisions.** Own QC/curation rule calibration and the final report projection. Keep verified platform admission gates in place. Correct wide editorial category exclusions with tagged historical and counterexample samples. Keep one versioned per-attempt counts artifact and consume it on ordinary and no-content report paths. Document whether each counter is unique IDs or rule hits; leave missing stage evidence unknown. Hand the revised editorial policy to 0385.

**Source premise.** `plugins/kk/skills/news-editorial/SKILL.md:46` and the L3 design's corresponding section were checked during refinement.

**Verification exit.** Assert counts reconcile after retries, zero kept, multiple hits and skipped stages. Pair a relevant industry/public-policy item with a hard-rule hit.

#### Q&A entry — 2026-11-19T04:05:45.764Z

Closed decisions. Use the existing L3 worktree artifact and replay fixtures as integration inputs. Channel review remains target-specific. The early no-content summary and the completed report share the attempt projection. Publish only the inventory and replay evidence in this task's verification artifacts.

### Design

Use the existing `dailyExtract`, `dailyQcContent`, curate validator, and nested safety review as the sources of observed decisions. Read `10-collect/ladder.json` with its chosen window, count the chosen pool once, and capture QC/boundary/dedup inputs before mutation. Count one excluded ID per stage and one hit per distinct ID/rule pair. For each observed selection stage, input count equals kept plus distinct drops. Keep channel decisions keyed by target and scope, using candidate IDs only when the receipt identifies them. A channel-only outcome belongs in the target summary and does not change candidate totals. The curated plan and exclusions are authoritative only after validation or the recorded fallback. A skipped stage or missing/mismatched receipt is unknown.

Reuse the worktree implementation's versioned `21-plan/topic-selection-attempts.json` and `apps/cli/src/topic-attempts.ts` reader. Bind evidence to run date, `resolveRunId`, attempt, input digest and rule version. A cached result counts as observed only with matching provenance. Preserve previous attempts and expose only the selected attempt in report totals. Use `generateRunReport` / `news-report-gen` for report rendering and the same projection for the early pool-gate summary and later refusals. No new public CLI or platform policy. Give 0385 the calibrated editorial copy and report artifact location.

### Plan

- [ ] R1: Compare `f6c4ce57` with the integration branch before changing code. Replay its labeled calibration fixtures and audit the current curate/curate-fix skill references, legacy voice prompts, and the platform references invoked by the safety workflow. Record which rules run, their authority and any enforcement gaps.
- [ ] R2: Reuse the committed attempt writer and report reader. Add evidence only at missing boundaries and align the ordinary report and early/late no-content paths with the current generation entry point.
- [ ] R1/R2: Extend the fixture path in `apps/cli/tests/kk-news-generate.e2e.test.ts` and use the existing stage and report harnesses in `apps/cli/tests/kk-workflow-stages.test.ts` and `apps/cli/tests/commands/daily.test.ts`. Assert kept/excluded reasons, duplicate and multiple-hit arithmetic, zero kept, cached retry, skipped curation, and target decisions from fixture safety receipts. Retain the resulting Markdown and JSON with the replay command. Reconcile evidence before handing policy copy to 0385.

### Solution

Integrated the L3 worktree commit `f6c4ce57` onto `main` and closed the gap the refine note named — the
ported artifact stopped at `plan`/`floor`, so Agent curation and channel admission carried no evidence.

**R1 — inventory (all four filter layers, named class by class).**
1. Deterministic selection rules: `plugins/kk/scripts/topic-boundary.json` (v2, unmodified) — only the
   `prc-leadership` keyword rule and the future-date `dateConflict` check run in code
   (`plugins/kk/scripts/daily-stages.ts` (QC stage)), on a 200-char window. Nothing else is mechanical.
2. Editorial topic boundary (agent prose): `plugins/kk/skills/news-editorial/SKILL.md:46-55`, retuned here and
   calibrated 2026-11-18. The LIVE news path
   (`plugins/kk/workflows/kk-news-generate.yaml:90,128`) reads that skill plus `references/selection.md` and
   `references/style-contract.zh.md` for BOTH curate and curate-fix, so the skill is the single source. The
   legacy voice flows carry the same sentence verbatim (`kk-daily-ai-voice.yaml:236,264,301,485`,
   `kk-daily-ai-voice2.yaml:394,468,532,773`), and the contract narrowed the blanket public-policy
   exclusion (`news-editorial/references/style-contract.zh.md:12-15`).
3. Platform admission gates (content-safety): `plugins/kk/skills/content-safety/SKILL.md:39` category 2 plus
   the per-channel files (`references/platforms/{xiaoyuzhou,wechatmp,xhs}.md`). Inventoried and **kept** —
   they are platform rules, not editorial preference.
4. **黄赌毒 (adult content / gambling / drugs) — nothing enforces it anywhere.** No rule in
   `topic-boundary.json`, no row in the category table, no mention in any `references/platforms/*.md`; the
   class is not a sub-case of category 2. Recorded as the "Unpoliced class" note
   (`plugins/kk/skills/content-safety/SKILL.md:44-54`) with **no** new filter — no observed harmful miss, and
   an unvetted keyword list would block AI stories that only mention addiction treatment or betting models.

**R2 — six stages of evidence, one attempt per invocation.** Stage keying answer: the artifact is a single
artifact, `21-plan/topic-selection-attempts.json` (`version: 2`), whose `attempts[]` is append-only per
*invocation* — a retry is attempt 2. Later stages of the SAME invocation amend that attempt instead of
appending, so one run day keeps one attempt however deep the pipeline runs.
`plugins/kk/scripts/topic-selection-attempts.ts:34-46` now records one row per stage that actually ran
(`{stage, input, kept, dropped[]}`), and reconciliation is per stage
(`input === kept + dropped.length`) plus chain continuity (`next.input === previous.kept`),
`reconcileSelectionAttempts`. That replaces the single cross-stage sum, which could not prove which
stage lost what.
- Raw pool + QC: `daily-stages.ts` `dailyQcContent` records `qc` as `{input: plan-snapshot docs, kept: candidates,
  dropped: id difference}` — the drops are named by ID, not inferred.
- Mechanical boundary and title dedup: `topicBoundary` and `dedup` rows from the same writer.
- Floor: `daily-stages.ts` `applyFloorGate` records an admitted pool (`kept = input, dropped = []`) and a refusal
  (`kept = 0, dropped = all ids`), so a stage that ran and dropped nothing is evidence rather than silence.
- Agent curation: `daily-stages.ts` `dailyCurateCheck` amends after validation
  (`curation` = the agent's split as handed over, `plan` = the validated plan after the check's own
  near-duplicate pass). The editorial exclusions keep the agent's own reason
  (`curationExcluded[]`), separate from mechanical rule hits. The `--final` fallback is recorded too, so a
  fallback reads as observed evidence instead of a missing stage.
- Channel admission: `dailySafetyGate` records the review report's `platforms[]` decisions per target and
  scope with the gate's own status. A channel outcome is a target decision and never moves candidate
  totals; a missing report leaves the stage `unknown`.
Both report paths consume it: `apps/cli/src/topic-attempts.ts` (`selectionAttemptsSection` / `selectionAttemptsNote`) renders the funnel
(`qc 24→18 (-6) · …`), the editorial-exclusion count, the per-target channel line (or
`unknown (no safety receipt)`), and the unknown-stage list; `selectionAttemptsNote` carries the same facts
on the no-content reason line.

**Verified against main, not just against the branch.** `git merge-tree --merge-base` showed both commits'
code merging cleanly onto `main` (only the task file conflicted, resolved toward main's refined version), and
the ported modules import nothing outside `main` except the sibling boundary engine — so this run integrates
the commits rather than replaying the branch.

**Handed to 0385** (board editorial projection) and 0384: the calibrated policy text and the artifact
location. Not implemented here.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Inventory of all four layers: mechanical rules only `prc-leadership` + `dateConflict` in `plugins/kk/scripts/topic-boundary.json`; editorial boundary calibrated at `plugins/kk/skills/news-editorial/SKILL.md:51-55` (AI-subject public policy admitted, hard line never re-admitted); style contract `plugins/kk/skills/news-editorial/references/style-contract.zh.md:12-15`; platform gates kept; unpoliced 黄赌毒 class recorded without a new filter at `plugins/kk/skills/content-safety/SKILL.md:44-54`. Replay fixtures: `plugins/kk/tests/topic-selection-calibration.test.ts:40` (calibration fixtures suite). |
| R2 | MET | Per-stage rows with `input = kept + dropped` and chain continuity: `plugins/kk/scripts/topic-selection-attempts.ts:281` (`reconcileSelectionAttempts`). Stage writers pinned: QC/dedup `apps/cli/tests/kk-workflow-stages.test.ts:961`, curation+plan `:1072`, `--final` fallback `:1124`, channel admission without moving totals `:1154`. Retry appends a new attempt `plugins/kk/tests/topic-selection-calibration.test.ts:305`; multiple hits `:328`; unknown stages `:272`, `:370`. Both report paths: ordinary report `apps/cli/src/commands/daily.ts:747` (`appendSelectionAttempts`); no-content line `apps/cli/src/commands/daily.ts:548` reached from the early pool gate `apps/cli/src/commands/content-generate.ts:423` and the late refusal `apps/cli/tests/commands/daily.test.ts:427`. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — R14 — 过滤规则按内容风险校准并在最终报告留证 | MET | test | Fixture pool with hard-rule hit, future-dated item, AI public-policy item, duplicate and multi-hit: `plugins/kk/tests/topic-selection-calibration.test.ts:40,116,305,328`; empty-pool attempt closes done/no-content `apps/cli/tests/kk-news-generate.e2e.test.ts:529`; report rendering with observed zero vs unknown `apps/cli/tests/topic-attempts.test.ts:71,124`. Repository test run exit 0. |
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

- 2026-11-19T22:50:46.058Z todo → wip (system)
- 2026-11-19T22:50:46.658Z wip → testing (system)
- 2026-11-19T23:20:12.394Z testing → done (system)

