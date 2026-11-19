---
schema_version: 1
name: Calibrate daily topic filters and report candidate losses
status: todo
template: feature-impl
created_at: 2026-11-18T04:42:14.699Z
updated_at: "2026-11-19T04:06:35.690Z"
feature_id: L3
priority: P1

estimate_hours: 7
ac_altitude: graduating
ac_numbering: task-local
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

- [ ] R1. Inventory the operative rules for selection and platform admission, including adult content, gambling, drugs, domestic politics and leadership. Replay historical and contrast fixtures. Admit AI-subject public-policy candidates that otherwise qualify and preserve verified mechanical and per-channel restrictions.
- [ ] R2. Produce retry-safe selection evidence covering raw pool, QC, mechanical boundary, title dedup, Agent curation and channel admission. Show the current attempt in the ordinary and no-content reports, including unique exclusions, rule hits, observed zero and unknown stages.

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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
