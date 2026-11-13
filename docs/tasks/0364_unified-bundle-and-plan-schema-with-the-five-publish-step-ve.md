---
schema_version: 1
name: Unified bundle and plan schema with the five publish step verbs
status: backlog
template: feature-impl
created_at: 2026-11-13T18:13:39.337Z
updated_at: "2026-11-13T18:32:57.462Z"
feature_id: G61

ac_altitude: task-local
ac_numbering: task-local
priority: P1
dependencies: ["0361", "0363"]
---

## 0364. Unified bundle and plan schema with the five publish step verbs

### Background

Phase 2 of G61 (ADR-053 §1, §2). Frozen contract: `docs/design/content-pipeline-consolidation.md` §1.2, §4.1, §4.2. Today the news matrix (`apps/cli/src/publish-matrix.ts`: `BundleSchema` L51, `PublishPlanRowSchema` L68, `PublishPlanSchema` L109) and ITC (`apps/cli/src/itc-plan.ts` `ItcPublishPlan`, `4-publish/publish-plan.json`) describe the same thing with two schemas, and every publish step is reachable only as `kk stage run publish-matrix-*` / `itc-*` with a positional work dir. This task makes one schema able to carry both content types and exposes the five publish step verbs on both nouns. The existing stage names keep working and call the same functions.

Out of scope: any workflow YAML, the launching `publish` verb (0365), converting ITC generation to write a bundle (0368), deleting any stage name.

### Requirements

- [ ] R1. `BundleSchema` gains optional `contentType` (default `'news'` on parse) and optional `title`; `episode` becomes optional. `schemaVersion` stays `1`. Every bundle under `apps/cli/tests/fixtures` still parses unchanged.
- [ ] R2. Code that needs `episode` (`runPublishMatrixRssGate`, podcast rows in `planPublishMatrix`) fails with an actionable error naming the missing field instead of a TypeError when it is absent.
- [ ] R3. `PublishPlanRowSchema` gains optional `transport: 'fanout' | 'browser'` (default `'fanout'`) and optional `metadata: record<string, unknown>`; `sendPublishMatrix` passes both through to `sendRows` (`apps/cli/src/publish-core.ts`, 0361), which already switches on `transport`.
- [ ] R4. New `apps/cli/src/commands/content-publish.ts` adds `publish-plan`, `publish-check`, `publish-send`, `publish-settle`, `publish-report` to the 0363 verb list for both nouns, with flags, exit codes, stdout and files exactly as design §1.2. Named flags only: `--work-dir` is required, a positional argument is a usage error (exit 2).
- [ ] R5. `publish-plan` = wait-until (window `cn-peak`) → rss-gate (window `overseas-rss`) → validate → plan, in that order, in one process, calling the existing functions. `--channels` with an id that matches no preset row exits 2 before any file is written.
- [ ] R6. `publish-settle` = classify → patch-surfdash (window `after-generate`, failure logged, non-fatal as today) → partial marker → settle (skipped for `overseas-rss`, as today; the script-resolved stages `publish-matrix-partial` and `publish-matrix-patch-surfdash` are invoked through the existing stage runner `apps/cli/src/stage.ts`, not re-implemented) → append the run id to `bundle.json` `runs[]` → assert; exit 1 exactly when a required non-dummy row is not `succeeded` — the predicate of today's `outcome-assert` jq in `kk-daily-publish3.yaml`, ported to TypeScript with the same truth table.
- [ ] R7. `publish-report` writes `5-report/publish-<window>.md` with the same content the inline `printf`/`jq` of publish3 node `report` produces, then runs `kk ledger sync` in-process.
- [ ] R8. Channel switchboard (design §2.1): new pure `applyChannelModes(preset, channels, liveChannels)` in `publish-matrix.ts`, called by `publish-plan` before `planPublishMatrix`. Row mode = `--live-channels` → `content_types.<type>.channels` (`<plugin>/<variant>` key beats `<plugin>` key) → preset `mode`; each plan row records `modeSource: 'flag' | 'config' | 'preset'` (optional field on `PublishPlanRowSchema`); a row switched off by config lands in `excluded[]` with reason `mode off (config)`. A `channels` key matching no preset row exits 2 naming the key and the preset, before any file is written. `kk stage run publish-matrix-plan` does not read `channels` (R9).
- [ ] R9. Every `kk stage run publish-matrix-*` name and its positional form behave byte-identically to the parent commit; no existing test assertion is edited.
- [ ] R10. `docs/04_DESIGN.md` §1.14 lists the five verbs as shipped; the "publish-matrix stages" section gains one line pointing at them. Same commit.

### Acceptance Criteria

```gherkin
Scenario: AC1 — Both content types publish through one workflow: one schema carries both (req: R1, R2, R3)
  Given a frozen news bundle fixture and an article bundle with contentType itc, a title, no episode, and a preset with one browser-transport target
  When `kk news publish-plan` and `kk article publish-plan` run with --dummy against each
  Then both write 4-publish/plan.after-generate.json that parses with PublishPlanSchema
  And the article row carries transport browser and its metadata, and the news plan is byte-identical to the one `kk stage run publish-matrix-plan` writes for the same inputs

Scenario: AC2 — The five step verbs complete a dummy window end to end (req: R4, R5, R6, R7, R8)
  Given the two work dirs from AC1 under .works/tmp/test-publish-verbs
  When publish-plan, publish-check, publish-send, publish-settle, publish-report run in order with --dummy for each
  Then every command prints one JSON object and exits 0
  And both dirs hold receipts of the same schema (ReceiptSchema), outcome.after-generate.json with status dummy, and 5-report/publish-after-generate.md
  And bundle.json runs[] grew by one in each
  And `publish-plan --channels nope` exits 2 and writes nothing
  And the test writes .works/tmp/test-publish-verbs/summary.json

Scenario: AC3 — Settlement fails the step when a required row is unsettled (req: R6)
  Given a plan with one required non-dummy row and a receipt marking it failed
  When `kk news publish-settle` runs
  Then it exits 1 and outcome.<window>.json has status none or partial

Scenario: AC5 — One config line turns a channel off (req: R8)
  Given the news preset where xhs-pub rows are live and a config with content_types.news.channels {"xhs-pub": "off", "wechatmp-pub/article": "draft"}
  When `kk news publish-plan` runs, then again with --live-channels wechatmp-pub, then with channels {"nope-pub": "off"}
  Then the first plan excludes every xhs-pub row with reason "mode off (config)" and the wechatmp article row is draft with modeSource config
  And the second plan has that row live with modeSource flag, and untouched rows carry modeSource preset
  And the third run exits 2 naming nope-pub and the preset, and writes nothing

Scenario: AC4 — Old stage spellings are untouched (req: R9, R10)
  Given the change is applied
  When `git diff --stat -- apps/cli/tests` and `bun run lint && bun run test && bun run build` run
  Then no existing test file has a changed assertion and all three commands exit 0
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-13T18:17:28.522Z

- **Why relax `episode` instead of bumping `schemaVersion`?** Every change is additive or a relaxation, so yesterday's bundle still parses and a re-send of an old day keeps working. A version bump would need a migration for zero benefit.
- **Is the ITC `publish-plan.json` deleted here?** No. ITC keeps writing it until 0368 switches article generation to a bundle. This task only makes the matrix schema able to hold an article.
- **Where does `--channels` get recorded?** In `plan.excluded[]` with reason `not in --channels list` (`publish-matrix.ts:488`) — already implemented; do not add a second record.
- **Tests first.** The AC1–AC3 test files are written and failing before any source edit.

### Design

Owned files:

| File | Change |
| --- | --- |
| `apps/cli/src/publish-matrix.ts` | R1–R3, R6 (new exported `settlePublishWindow` composing the existing functions) |
| `apps/cli/src/publish-core.ts` | only if `sendRows` needs the `metadata` pass-through typed |
| `apps/cli/src/commands/content-publish.ts` | new |
| `apps/cli/src/commands/content.ts` | append five entries to the verb list (shared with 0363 — hence the dependency) |
| `apps/cli/tests/content-publish.e2e.test.ts`, `apps/cli/tests/publish-settle.test.ts` | new |
| `docs/04_DESIGN.md` | R10 |

Each verb's `run` is a thin composition: parse flags → call the existing `publish-matrix.ts` functions with `workDir` → print the summary object. The existing functions take `<work_dir>` positional + argv; call them with a built argv rather than refactoring their signatures (ponytail: no signature churn across 1,700 lines).

### Plan

1. Write the three test files; confirm they fail.
2. Schema relaxations (R1–R3) and the two actionable errors (R2).
3. `settlePublishWindow` + the report writer (R6, R7).
4. `content-publish.ts` and the verb-list entries (R4, R5, R6 stage-runner calls, R8 `applyChannelModes`).
5. Run the full existing publish-matrix, publish3 and itc suites; confirm zero assertion edits (R9).
6. Docs (R10); `bun run lint && bun run test && bun run build`; paste outputs into Testing.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Design: `docs/design/content-pipeline-consolidation.md` §1.2, §4.1, §4.2. Decision: ADR-053 §1, §2; ADR-043.
- Depends on: 0361, 0363. Blocks: 0365, 0366.
- Parent feature: G61, scenario "Both content types publish through one workflow" (schema half; the workflow half is 0366 and 0368).

### History
