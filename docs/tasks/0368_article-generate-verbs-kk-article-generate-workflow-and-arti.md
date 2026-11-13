---
schema_version: 1
name: Article generate verbs, kk-article-generate workflow and article publish through kk-publish
status: backlog
template: feature-impl
created_at: 2026-11-13T18:13:40.414Z
updated_at: "2026-11-13T18:42:37.238Z"
feature_id: G61

ac_altitude: task-local
ac_numbering: task-local
priority: P1
dependencies: ["0366", "0367"]
---

## 0368. Article generate verbs, kk-article-generate workflow and article publish through kk-publish

### Background

Phase 3 of G61 (ADR-053 §1, §6). Frozen contract: `docs/design/content-pipeline-consolidation.md` §4.1–4.2 (what an article bundle is), §5.2 (the 13 states of `kk-article-generate` and the fate of every `kk-itc` node and `kk-itc-author` state), §6. Today an article is produced by `kk-itc.yaml` (14 nodes) which shells out to supervise a child `kk-itc-author.yaml` (16 states) and then runs its own seven-node publish tail, duplicated in `kk-itc-publish-tail.yaml`. This task splits it: one generate FSM that ends in a frozen bundle, and publishing through `kk-publish` (0366).

Out of scope: deleting `kk-itc*.yaml` or `scripts/publish-article.ts` (0369); changing writer skills; news.

### Requirements

- [ ] R1. New `apps/cli/src/commands/content-generate-article.ts` implements the article steps of `generate-check` (`outline`, `judge`, `adapt`) and `generate-bundle` (`--stage variants`, `--stage freeze`) by calling the existing functions behind `itc-outline-pick`/`itc-decision`, `itc-author-verdict`, `itc-adapt-verify`, `itc-materialize-plan`, `itc-author-complete` (`apps/cli/src/itc-stage.ts:runItcStage`, `plugins/kk/scripts/itc-stages.ts`). It plugs into the `generate-check`/`generate-bundle` verbs registered by 0367 — one verb, per-type step table.
- [ ] R2. `generate-bundle --stage freeze` for an article writes `4-publish/bundle.json` with `contentType` = the type, `title`, no `episode`, and `variants` = one entry per adapted file `{path, sha256}`. `4-publish/content.json` keeps the generation-side fields (`sourceLocale`, `adapt`, `limits`, `switches`). `publish-plan.json` is no longer written by this path.
- [ ] R3. Article presets (`plugins/kk/publish-presets/itc-main.json`, `technical-article.json`, `chinese-article.json`) plan through `planPublishMatrix` unchanged in content; if a preset needs a field to do so (e.g. an explicit `id`), the edit is additive and listed in Solution. Row mapping per design §4.2.
- [ ] R4. New `plugins/kk/workflows/kk-article-generate.yaml`: FSM with exactly the states of design §5.2; vars `work_dir`, `slug`, `run_id`, `agent` (default `inline`), `auto`, `preset`; `executor-probe` initial; the writer skill comes from `content_types.<type>.writer_skill` passed as var `writer_skill`; no child workflow, no inline supervisor shell, no `kk stage`.
- [ ] R5. Human pauses (`outline-select`, `outline-review`, `draft-review`) are skipped when `auto=true`; the revise loop is bounded by `workflows.kk-article-generate.max_revisions` and ends in `failed` when exceeded.
- [ ] R6. Config: `apps/cli/src/itc-config.ts` reads `workflows.kk-article-generate` and falls back to `workflows.kk-itc` when the new block is absent, so existing user config keeps working. No key is renamed.
- [ ] R7. `kk article generate` launches the new workflow; `kk article publish` publishes its bundle through `kk-publish` with no article-specific node.
- [ ] R8. New `apps/cli/tests/kk-article-generate-fsm.test.ts` (states, transitions, single `agent` var, no `kk stage`) and an e2e with stubbed agents.
- [ ] R9. `kk itc candidates` and every `kk stage run itc-*` name behave as on the parent commit; no existing test assertion is edited.
- [ ] R10. `docs/04_DESIGN.md` §1.14 and `docs/design/kk-itc-refactor.md` (one superseded-by pointer). Same commit.

### Acceptance Criteria

```gherkin
Scenario: AC1 — Both content types publish through one workflow: a generated article (req: R1, R2, R3, R4, R7)
  Given `kk article new --slug demo --topic <t>` and `kk article generate --slug demo --auto` with stubbed agents
  When `kk article publish --slug demo --dummy` runs
  Then generate ends with a frozen bundle.json of contentType itc with no episode
  And publish runs kk-publish.yaml and produces receipts of the same schema as a news dummy publish, in the article's own work dir
  And no publish-plan.json exists in the work dir

Scenario: AC2 — One channel is re-sent without regenerating (req: R3, R7)
  Given the settled article bundle from AC1 with one channel's receipt replaced by a failed one
  When `kk article publish --slug demo --channels <that channel> --retry --dummy` runs
  Then only that row is dispatched, in the same work dir, and the plan records the override
  And bundle.json variants and content/ are byte-identical to before

Scenario: AC3 — Authoring gates and loops behave (req: R4, R5, R6, R8)
  Given stubbed agents where the judge fails max_revisions + 1 times
  When `kk article generate --slug loop --auto` runs
  Then the run ends in state failed after exactly max_revisions draft rewrites and the receipt status is failed
  And with auto false the run pauses at outline-select
  And a config carrying only workflows.kk-itc is honoured
  And the test writes .works/tmp/test-article-generate/summary.json

Scenario: AC4 — Gate (req: R9, R10)
  Given the change is applied
  When `bun run lint && bun run test && bun run build` run
  Then all exit 0 and no existing file under apps/cli/tests has a changed assertion
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-13T18:17:35.671Z

- **Why inline the author states instead of keeping the child workflow?** The child existed to get an FSM inside a DAG; its supervisor is 60 lines of shell with trap/cancel in a node (design §3.3). With publishing moved out, the parent has nothing left but the author flow.
- **`draft-autorevise` is gone — where does auto-revision happen?** The `judge` fail edge returns to `draft-write` with the verdict file as input, bounded by `max_revisions` (design §5.2).
- **What about SEO export?** It is part of `publish-report` (0364) for types whose workflow config sets `seo.mode`.
- **Preset edits.** Additive only; a preset that already works with the ITC path must still work with it until 0369.
- **Tests first.** FSM test and e2e exist and fail before the YAML or the step table is written.

#### Q&A entry — 2026-11-13T18:42:37.237Z

- **How does the writer prompt reach the skill?** Through `${vars.skill_dir}/SKILL.md`, passed by `kk article generate` from `content_types.<type>.writer_skill` (design §2.2). Never copy the skill into the run directory and never rely on skill discovery.

### Design

Owned files:

| File | Change |
| --- | --- |
| `apps/cli/src/commands/content-generate-article.ts` | new |
| `apps/cli/src/commands/content-generate.ts` | register the article step table (shared with 0367 — dependency) |
| `apps/cli/src/itc-config.ts` | R6 fallback only |
| `plugins/kk/workflows/kk-article-generate.yaml` | new |
| `plugins/kk/publish-presets/*.json` | additive, only if R3 needs it |
| `apps/cli/tests/kk-article-generate-fsm.test.ts`, `apps/cli/tests/kk-article.e2e.test.ts` | new |
| `docs/04_DESIGN.md`, `docs/design/kk-itc-refactor.md` | R10 |

### Plan

1. Write the FSM test and the e2e (AC1–AC3); confirm they fail.
2. Article step table for `generate-check` / `generate-bundle` (R1, R2).
3. Preset check through `planPublishMatrix` (R3).
4. `kk-article-generate.yaml` from design §5.2 (R4, R5); config fallback (R6).
5. Run the existing `itc-*` and `kk-itc-*` suites unchanged (R9).
6. Docs; `bun run lint && bun run test && bun run build`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Design: `docs/design/content-pipeline-consolidation.md` §4.1, §4.2, §5.2, §6. Decision: ADR-053 §1, §6. Prior design: `docs/design/kk-itc-refactor.md`.
- Depends on: 0366, 0367. Blocks: 0369.
- Parent feature: G61, scenarios "Both content types publish through one workflow", "One channel is re-sent without regenerating".

### History
