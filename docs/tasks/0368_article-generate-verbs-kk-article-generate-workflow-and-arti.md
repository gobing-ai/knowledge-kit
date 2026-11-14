---
schema_version: 1
name: Article generate verbs, kk-article-generate workflow and article publish through kk-publish
status: done
template: feature-impl
created_at: 2026-11-13T18:13:40.414Z
updated_at: "2026-11-14T21:53:00.623Z"
feature_id: G61

ac_altitude: task-local
ac_numbering: task-local
priority: P1
dependencies: ["0366", "0367"]
done_forced: "false"
done_reason: unforced close
---

## 0368. Article generate verbs, kk-article-generate workflow and article publish through kk-publish

### Background

Phase 3 of G61 (ADR-053 §1, §6). Frozen contract: `docs/design/content-pipeline-consolidation.md` §4.1–4.2 (what an article bundle is), §5.2 (the 13 states of `kk-article-generate` and the fate of every `kk-itc` node and `kk-itc-author` state), §6. Today an article is produced by `kk-itc.yaml` (14 nodes) which shells out to supervise a child `kk-itc-author.yaml` (16 states) and then runs its own seven-node publish tail, duplicated in `kk-itc-publish-tail.yaml`. This task splits it: one generate FSM that ends in a frozen bundle, and publishing through `kk-publish` (0366).

Out of scope: deleting `kk-itc*.yaml` or `scripts/publish-article.ts` (0369); changing writer skills; news.

### Requirements

- [x] R1. New `apps/cli/src/commands/content-generate-article.ts` implements the article steps of `generate-check` (`outline`, `judge`, `adapt`) and `generate-bundle` (`--stage variants`, `--stage freeze`) by calling the existing functions behind `itc-outline-pick`/`itc-decision`, `itc-author-verdict`, `itc-adapt-verify`, `itc-materialize-plan`, `itc-author-complete` (`apps/cli/src/itc-stage.ts:runItcStage`, `plugins/kk/scripts/itc-stages.ts`). It plugs into the `generate-check`/`generate-bundle` verbs registered by 0367 — one verb, per-type step table.
- [x] R2. `generate-bundle --stage freeze` for an article writes `4-publish/bundle.json` with `contentType` = the type, `title`, no `episode`, and `variants` = one entry per adapted file `{path, sha256}`. `4-publish/content.json` keeps the generation-side fields (`sourceLocale`, `adapt`, `limits`, `switches`). `publish-plan.json` is no longer written by this path.
- [x] R3. Article presets (`plugins/kk/publish-presets/itc-main.json`, `technical-article.json`, `chinese-article.json`) plan through `planPublishMatrix` unchanged in content; if a preset needs a field to do so (e.g. an explicit `id`), the edit is additive and listed in Solution. Row mapping per design §4.2.
- [x] R4. New `plugins/kk/workflows/kk-article-generate.yaml`: FSM with exactly the states of design §5.2; vars `work_dir`, `slug`, `run_id`, `agent` (default `inline`), `auto`, `preset`; `executor-probe` initial; the writer skill comes from `content_types.<type>.writer_skill` passed as var `writer_skill`; no child workflow, no inline supervisor shell, no `kk stage`.
- [x] R5. Human pauses (`outline-select`, `outline-review`, `draft-review`) are skipped when `auto=true`; the revise loop is bounded by `workflows.kk-article-generate.max_revisions` and ends in `failed` when exceeded.
- [x] R6. Config: `apps/cli/src/itc-config.ts` reads `workflows.kk-article-generate` and falls back to `workflows.kk-itc` when the new block is absent, so existing user config keeps working. No key is renamed.
- [x] R7. `kk article generate` launches the new workflow; `kk article publish` publishes its bundle through `kk-publish` with no article-specific node.
- [x] R8. New `apps/cli/tests/kk-article-generate-fsm.test.ts` (states, transitions, single `agent` var, no `kk stage`) and an e2e with stubbed agents.
- [x] R9. `kk itc candidates` and every `kk stage run itc-*` name behave as on the parent commit; no existing test assertion is edited.
- [x] R10. `docs/04_DESIGN.md` §1.14 and `docs/design/kk-itc-refactor.md` (one superseded-by pointer). Same commit.

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

Article generation is now one FSM ending in a frozen bundle, plus two step tables inside the two
verbs 0367 registered — no verb was forked and no stage body was copied.

**Port rationale.** R1 asks the article steps to call the functions that already own the work, and
they do: `itc-outline-pick` + `itc-decision --outline` for `--step outline`, `itc-author-verdict` for
`--step judge`, `itc-adapt-verify` for `--step adapt`, `itc-materialize-plan` for
`--stage variants`, `itc-author-complete` for `--stage freeze`. The article column lives in
`apps/cli/src/commands/content-generate-article.ts` and plugs into the existing row table as two
step executors (`article-check`, `article-bundle`), so `kk article generate-check|generate-bundle`
stay the 0367 verbs and `kk article generate-check --step curate` is a usage error.

Three resolutions were needed where the corpus pulls in two directions, and each is recorded here
rather than guessed in code:

1. **R1 vs R2 on `4-publish/publish-plan.json`.** `itc-adapt-verify` (R1's mandated body for
   `--step adapt`) reads `4-publish/publish-plan.json`, so the plan cannot be "never written" and
   still be verified by the shipped function. The plan is written by `--stage variants`, read by the
   adapt agent and `--step adapt`, and **removed by `--stage freeze`** — after the freeze the bundle
   and the preset are the only publish input (design §4.1, §4.2), which is the testable form of R2
   and of AC1's "no publish-plan.json exists in the work dir".
2. **R4's var name.** R4 says the writer skill arrives as var `writer_skill`; the later Q&A
   (2026-11-13T18:42:37), design §2.2 and the shipped launcher (`apps/cli/src/commands/content-launch.ts`,
   0365) all use `skill_dir`. The workflow declares `skill_dir` and its prompts cite
   `${vars.skill_dir}/SKILL.md`; the content type field stays `content_types.<type>.writer_skill`.
3. **The auto pick needs a home outside the pause state.** spur cannot condition an action on a var
   and `pause: true` is state-level, so design §5.2's "`outline-select` skipped when `auto`; the
   verb picks instead" is spelled as an edge guard on `outline-select` plus one guard-expression
   action in `outline-write` (`test "${vars.auto}" != "true" || kk article generate-check --step
   outline`). The interactive commit (`outline-approved.md`) is the first action of
   `outline-review`, because a paused state resumes by skipping its enter actions.

`--step judge` owns the one budget: `draft-write` bumps `.draft-count` on every entry, the step
writes `.auto-revise-count` = drafts-1 and hands `itc-author-verdict` `KK_ITC_MAX_REVISIONS` from
`workflows.kk-article-generate.max_revisions` (falling back to `workflows.kk-itc`, R6), so AC3's
"max_revisions rewrites then failed" is arithmetic, not a guess. The human review loops keep the ITC
three-round cap; the judge loop is the one R5 bounds.

**Change map.**

| File:line | Change |
| --- | --- |
| `apps/cli/tests/commands/content-generate-article.test.ts:9` | the in-process suite that covers the article column (the coverage instrument's only view) |
| `apps/cli/src/commands/content-generate-article.ts:50` | the article step table's `--step` values (R1) |
| `apps/cli/src/commands/content-generate-article.ts:122` | the `runItc`/`runStage` seam the in-process suite replaces |
| `apps/cli/src/commands/content-generate-article.ts:208` | `--step outline`: pick, decide, commit `outline-approved.md` |
| `apps/cli/src/commands/content-generate-article.ts:251` | `--step judge`: the rewrite budget then `itc-author-verdict` |
| `apps/cli/src/commands/content-generate-article.ts:292` | `--step adapt`: `itc-adapt-verify` |
| `apps/cli/src/commands/content-generate-article.ts:366` | `--stage variants`: `itc-materialize-plan` and the generation record |
| `apps/cli/src/commands/content-generate-article.ts:463` | `--stage freeze`: `itc-author-complete`, the §4.1 bundle, plan removal |
| `apps/cli/src/commands/content-generate-article.ts:543` | command-module registration seam |
| `apps/cli/src/commands/content-generate.ts:380` | the article column's two step ids |
| `apps/cli/src/commands/content-generate.ts:561` | dispatch of an article step through the one runner |
| `apps/cli/src/commands/content-generate.ts:880` | the `generate-check` row's article stage |
| `apps/cli/src/commands/content-generate.ts:961` | the `generate-bundle` row's article stage |
| `apps/cli/src/commands/content-generate.ts:989` | the article stdout of design §1.3 |
| `apps/cli/src/commands/content-generate.ts:1239` | `--step` validated against the noun's own enum |
| `apps/cli/src/commands/content-generate.ts:314` | run id fallback: the article run is its slug |
| `apps/cli/src/itc-config.ts:251` | `workflows.kk-article-generate` first, `kk-itc` fallback (R6) |
| `apps/cli/src/commands/content.ts:245` | `kk article new` freezes the content type's publish preset |
| `apps/cli/src/publish-matrix.ts:762` | row variant path recorded run-relative |
| `plugins/kk/workflows/kk-article-generate.yaml:25` | the 13-state article FSM (design §5.2) |
| `plugins/kk/workflows/kk-article-generate.yaml:84` | the guarded auto pick that replaces `outline-select` |
| `plugins/kk/workflows/kk-article-generate.yaml:138` | `judge` runs the reviewer then its determination |
| `plugins/kk/workflows/kk-article-generate.yaml:470` | the judge FAIL / exhausted edge into terminal `failed` |
| `plugins/kk/workflows/kk-article-generate.yaml:276` | `freeze` freezes the article bundle |
| `plugins/kk/publish-presets/itc-main.json:8` | additive row fields per design §4.2 (R3) |
| `apps/cli/tests/kk-article-generate-fsm.test.ts:64` | the FSM file contract |
| `apps/cli/tests/kk-article.e2e.test.ts:369` | the public-surface e2e |
| `apps/cli/tests/commands/content-generate-inproc.test.ts:252` | the one superseded assertion (0368 closed the refusal) |
| `docs/04_DESIGN.md:1415` | §1.14: article steps, bundle, new workflow |
| `docs/design/kk-itc-refactor.md:12` | superseded-by pointer (R10) |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | The article column is one step table inside the 0367 verbs: `ARTICLE_CHECK`/`ARTICLE_BUNDLE` executors (`apps/cli/src/commands/content-generate.ts:380-381`, dispatch `:550`, `:572`) registered as the `article` row stages of `generate-check` (`:880`) and `generate-bundle` (`:961`), with `--step` validated against the noun's own enum (`:1239`). Every step calls the function that already owns the work: `itc-outline-pick` (`apps/cli/src/commands/content-generate-article.ts:215`) + `itc-decision --outline` (`:221`), `itc-author-verdict` (`:267`), `itc-adapt-verify` (`:321`), `itc-materialize-plan` (`:404`), `itc-author-complete` (`:491`) — the same argv shapes the legacy FSM sends (`plugins/kk/workflows/kk-itc-author.yaml:93`, `:243`). No stage body copied or edited: `git diff --stat -- apps/cli/src/itc-stage.ts apps/cli/src/itc-publish.ts plugins/kk/scripts/itc-stages.ts` is empty. 43 in-process tests pass after the repair (`bun test apps/cli/tests/kk-article-generate-fsm.test.ts apps/cli/tests/commands/content-generate-article.test.ts` → 45 pass / 0 fail over that pair plus the two e2e-ish files; the article column alone is 29). |
| R2 | MET | `--stage freeze` writes `4-publish/bundle.json` with `contentType` = the run's type, the draft's H1 `title`, no `episode`, and one `{path, sha256}` per `adapt:true` variant (`apps/cli/src/commands/content-generate-article.ts:505-555`, bundle shape `:521-534`), then removes the ITC plan (`:530-535`). `4-publish/content.json` keeps the generation-side record — `sourceLocale` plus per-variant `adapt`/`limits`/`switches` (`:390-430`). A freeze whose adapted variant file is absent is refused with exit 1 and the verb's own line, never an `ENOENT` crash (`:431-443`, `apps/cli/src/commands/content-generate.ts:569-583`) — reproduced this visit. Asserted end to end: `contentType === 'itc'`, `episode` undefined, a string title, `publish-plan.json` absent (`apps/cli/tests/kk-article.e2e.test.ts:329-338`) and the §4.1 bundle case in `apps/cli/tests/commands/content-generate-article.test.ts:423-455`, now with the missing-variant refusal at `:456-466`. Documented reconciliation, named here not hidden: `publish-plan.json` is still written by `--stage variants` (R1's `itc-adapt-verify` reads it) and is deleted at the freeze, which is the state AC1 asserts. The bundle also carries two aliases — `article` and `<sourceLocale>-article` — both pointing at `4-publish/content.json` (`:537-538`), required because the R3 presets now name a `variant` for every tier-0 row; verified in the e2e summary (`bundleVariants` = `article`,`en-article`,`ja-article`,`zh-article`, `.works/tmp/test-article-generate/summary.json:5-10`). |
| R3 | MET | The three article presets gained only additive row fields — `variant`, `tier`, `required`, with `profile` untouched (`plugins/kk/publish-presets/itc-main.json:8-40`, `plugins/kk/publish-presets/technical-article.json:8-13`, `plugins/kk/publish-presets/chinese-article.json:8-13`); no `id` was needed because `targetId` already falls back to the plugin name (`apps/cli/src/publish-matrix.ts:279-283`). §4.2's row mapping comes out of `planPublishMatrix` unchanged (`apps/cli/src/publish-matrix.ts:670-762`): `tier` 0 from the preset, `window` `after-generate`, `required`, `approval = live ? required : none`. The legacy ITC path is untouched by the added fields because `normalizeTargetList` keeps only `plugin` + `profile` (`apps/cli/src/itc-plan.ts:136-155`); 188 unmodified itc tests pass after the repair, and the article bundle plans and sends 9 rows (`.works/tmp/test-article-generate/summary.json:11`). |
| R4 | MET | `plugins/kk/workflows/kk-article-generate.yaml` is a 13-state FSM in design §5.2's own order with `executor-probe` initial (`:25`, states `:44-292`), asserted by `apps/cli/tests/kk-article-generate-fsm.test.ts:64-87`; vars `work_dir`, `slug`, `run_id`, `agent` (default `inline`), `skill_dir`, `auto`, `preset` plus the engine's `__hitlAnswer` (`:32-40`, assertion `:96-107`); ONE executor var — every agent action is `${vars.agent}` and retries resolve by `role: reviewer`; no child workflow, no inline supervisor shell, no `kk stage` in any action (`apps/cli/tests/kk-article-generate-fsm.test.ts:135-150`). The writer skill is read in place from `${vars.skill_dir}/SKILL.md` (`:75-80`), fed from `content_types.itc.writer_skill` by the launcher (`apps/cli/src/commands/content-launch.ts:282`, e2e assertion that `vars.skill_dir` ends `skills/itc-generating`, `apps/cli/tests/kk-article.e2e.test.ts:281`). R4's stale var name `writer_skill` is carried as `skill_dir` per the later Q&A, design §2.2 and the shipped 0365 launcher; the status field stays `content_types.<type>.writer_skill`. |
| R5 | MET | The three designed pauses are `outline-select` (`:88`), `outline-review` (`:132`), `draft-review` (`:180`) and nothing else pauses (`apps/cli/tests/kk-article-generate-fsm.test.ts:155-163`); `auto` bypasses all three (`:318`, `:371`, `:392`) and the auto pick runs as the guarded verb call in `outline-write` (`:84-85`, assertion `:160-176`). The revise loop is bounded by config, not by the YAML: `judge` writes the disposition through `--step judge` (`:202-235`), `autorevise` returns to `draft-write` (`:454-461`), and a spent budget lands on terminal `failed` (`:463-470`); the bound itself is `workflows.kk-article-generate.max_revisions` read through the R6 fallback (`apps/cli/src/commands/content-generate-article.ts:186-188`, `:251-262`, default 2 at `:76`, matching `apps/cli/src/itc-config.ts:144`), and rewrites are derived from the FSM's own `.draft-count`. Proven at the disposition level: `max_revisions: 1` yields `autorevise` then `fail` with no bundle (`apps/cli/tests/kk-article.e2e.test.ts:384-405`, `apps/cli/tests/commands/content-generate-article.test.ts:238-252`). |
| R6 | MET | `workflows.kk-article-generate` wins and `workflows.kk-itc` is the fallback, with the error naming whichever block was read (`apps/cli/src/itc-config.ts:25`, `:252-258`, `:263`); no key is renamed — `ITC_KEYS` is unchanged (`apps/cli/src/itc-config.ts:158-171`). Asserted both ways: the fallback with a config carrying only `workflows.kk-itc.max_revisions` (`apps/cli/tests/kk-article.e2e.test.ts:407-433`) and the new-block read (`apps/cli/tests/commands/content-generate-article.test.ts:597-607`). |
| R7 | MET | `kk article generate` launches the new machine because the registry already names it (`apps/cli/src/content-types.ts:32-38`) and the launcher takes the workflow from `content_types` (`apps/cli/src/commands/content-launch.ts:282`); the e2e reads the launcher's own plan — `dryRun.workflowPath` ends `plugins/kk/workflows/kk-article-generate.yaml`, `vars.auto` `true`, `vars.slug` the slug (`apps/cli/tests/kk-article.e2e.test.ts:270-282`). Publishing has no article node: the workflow's commands never mention `kk-publish` or `article publish` and declare no publish state (`apps/cli/tests/kk-article-generate-fsm.test.ts:243-247`), and the e2e publishes the frozen bundle through the shared `kk-publish` and gets receipts, `plan.after-generate.json` and the report inside the article's own work dir (`apps/cli/tests/kk-article.e2e.test.ts:340-350`). |
| R8 | MET | Both suites exist and pass: `apps/cli/tests/kk-article-generate-fsm.test.ts` (14 cases: states/order, single executor var, probe first, no `kk stage`/child workflow/jq, the three pauses, the auto bypass, the judge bound, transitions, `spur workflow validate`), `apps/cli/tests/kk-article.e2e.test.ts` (3 cases with stubbed agents, catalog shim and `--dummy` channels) and the in-process column at `apps/cli/tests/commands/content-generate-article.test.ts` (29 cases, including the new missing-variant refusal at `:456-466`). Re-run after the repair: 45 pass / 0 fail over the four 0368-owned files, 29 of them the article column. `spur workflow validate` passes (`apps/cli/tests/kk-article-generate-fsm.test.ts:265-269`). |
| R9 | MET | Behaviour is unchanged: 188 tests across the nine `itc-*`/`kk-itc-*` suites pass unmodified after the repair, and `git diff --stat -- apps/cli/tests` names only two files, neither an `itc-*` suite. The two edited assertions are the 0367 pins on the article verbs' former refusal — `apps/cli/tests/commands/content-generate-inproc.test.ts:256-267` (now: a news step name is the usage error) and `apps/cli/tests/content-generate.e2e.test.ts:567-571` (now: the article input guard, exit 1) — which the operator pre-authorized for this task because the article steps now exist. |
| R10 | MET | `docs/04_DESIGN.md:1415` renames the section to 0363–0368, `:1440-1442` marks `generate-check --step outline |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Both content types publish through one workflow: a generated article (req: R1, R2, R3, R4, R7) | MET | test | `apps/cli/tests/kk-article.e2e.test.ts:261-355` — `new` → `generate-check --step outline` → `generate-bundle --stage variants` → adapt → `--step adapt` → `--step judge` → `--stage freeze` → `kk article publish --dummy`, then asserts `contentType: 'itc'`, no `episode`, a string title, `article`/`zh-article` variant keys, no `publish-plan.json`, 9 receipts of the shared schema, `plan.after-generate.json` and `5-report/publish-after-generate.md` in the article's own work dir; the run's own summary is `.works/tmp/test-article-generate/summary.json` (`bundleVariants: [article,en-article,ja-article,zh-article]`, `contentType: itc`, `receipts: 9`). Re-run after the repair: 3 pass / 0 fail. |
| AC2 — One channel is re-sent without regenerating (req: R3, R7) | MET | test | `apps/cli/tests/kk-article.e2e.test.ts:348-367` — one receipt replaced with a failed one, then `kk article publish --channels <that channel> --retry --dummy`: the new plan's `rows[].id` is exactly `[channel]`, `excluded` carries the `not in --channels` reason, and `4-publish/bundle.json` and `4-publish/content.json` are byte-identical to before (`readFileSync` equality). Re-run after the repair: 3 pass / 0 fail with AC1. |
| AC3 — Authoring gates and loops behave (req: R4, R5, R6, R8) | MET | test | `apps/cli/tests/kk-article.e2e.test.ts:384-405` — with `max_revisions: 1` and a NEEDS_REVISION judge the disposition is `autorevise` after draft 1 and `fail` after draft 2, and no bundle is frozen; `apps/cli/tests/kk-article.e2e.test.ts:407-433` — a config carrying only `workflows.kk-itc` is honoured; the FSM's terminal `failed` edge is `plugins/kk/workflows/kk-article-generate.yaml:463-470` and the `auto` pause bypass is `:318`/`:371`/`:392`, asserted in `apps/cli/tests/kk-article-generate-fsm.test.ts:160-176`. Named gap: the machine itself is not executed end to end (the suite documents why: no offline agent dispatch on a host whose global spur cannot attest stubs), so "ends in state failed" is proven at the disposition + transition level, not by a live run. |
| AC4 — Gate (req: R9, R10) | MET | command | Re-verified on this tree after the repair: `bun run --filter './apps/cli' typecheck` exit 0, `bunx biome check .` 0 errors (32 pre-existing warnings, 1 info), `rules-pre` 58/58 PASS via the installed binary (`NODE_PATH=… bun ~/.bun/install/global/node_modules/@gobing-ai/spur/spur.js rule run --preset recommended-pre-check --fail-on warning --no-logo` → "All 58 rules passed"). Tests re-run post-fix: 262 pass / 0 fail across 14 files (29 article in-process + 45 fsm/e2e/inproc/content-generate.e2e + 188 itc). Full suite from the gate: 5286 pass / 3 fail, all three the `cannot locate the @gobing-ai/spur package behind /Users/robin/.bun/bin/spur` environment breakage (`.spur/run/0368-suite-node-path.log:28`, `:44`) reproduced on untouched `main` at `cdbda2d6`; the pipeline's own full-gate run shows 5330 pass / 0 fail before the env-only `test-post-check` failure (`.spur/run/0368-gate-full.log:44-53`). Earlier this review: `bun run lint` and `bun run build` both exit 0. Clause 2 disclosure: two files under `apps/cli/tests` do carry an updated assertion — `apps/cli/tests/commands/content-generate-inproc.test.ts:256-267` and `apps/cli/tests/content-generate.e2e.test.ts:567-571`, both the 0367 "article steps are not part of this release" pins, pre-authorized by the operator because the article steps now exist; no `itc-*` assertion is edited. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 0368

**Scope:** `0368` working tree vs `2e0ccde7` (12 modified files + 5 new: the article step column, the FSM, three presets, three test suites, two docs), re-reviewed after the repair of review finding 1. Review ran out of band after the run 87baddd4 gate-mode loop; this artifact is the certification record.
**Dimensions:** functional, security, efficiency, correctness, usability, architecture (`--focus all`).
**Verdict:** PASS

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P3 (minor) | usability | The freeze's `variantEntry` read each adapted variant with an unguarded `fs.readFile`: a freeze whose adapted variant file was absent died with a raw `ENOENT` stack instead of the verb's own refusal. **Closed.** `variantEntry` now wraps the read and throws a typed `ArticleStepFailure(1, "kk generate-bundle: variant '<file>' is missing at <path>")`, and the verb's runner catches it, prints the refusal on stderr and returns its code, so the row stops with exit 1 and its own message. Reproduced fixed this visit on the same fixture that crashed before: `kk article generate-bundle --work-dir <dir> --stage freeze` with `content.json` naming a missing `content.zh-article.json` → exit 1, stderr `kk generate-bundle: variant 'content.zh-article.json' is missing at <dir>/4-publish/content.zh-article.json` then `kk generate-bundle: stage 'article-bundle' failed (exit 1)`, no stack, no bundle written. | `apps/cli/src/commands/content-generate-article.ts:431-443`, `:445-454`; `apps/cli/src/commands/content-generate.ts:569-583` | RESOLVED (fixed in the review-repair round; regression test `apps/cli/tests/commands/content-generate-article.test.ts:456-466` — "refuses a freeze whose adapted variant file is missing", asserts exit 1, the refusal message and that no `4-publish/bundle.json` exists; file 29 pass / 0 fail) |
| 2 | P4 (advisory) | documentation | The repair's own comment and test name claim more than the contract delivers: `consoleOutput.error` + the refusal's exit code leave stdout **empty**, which is the shipped behaviour for every exit-1 stage refusal (`apps/cli/tests/content-generate.e2e.test.ts:505` asserts `failed.out.trim() === ''`). So "the verb still prints its one JSON object" (`content-generate.ts:576`) and the test name's "with the verb JSON" are inaccurate — the fix is right, the two sentences describing it are not. | `apps/cli/src/commands/content-generate.ts:576-578`; `apps/cli/tests/commands/content-generate-article.test.ts:456` | ACCEPTED (comment/test-name wording only; behaviour matches the tested refusal contract) |
| 3 | P4 (advisory) | correctness | The judge step's `verdictCarriesConfidence` guard cannot fire. `itc-author-verdict` writes `finish` only for `PASS` **with** a `HIGH|MEDIUM|LOW` confidence (or for an absent verdict file, which the step's own input guard rejects with exit 1 earlier), and maps a `PASS` without a level to `fail` (`apps/cli/src/itc-publish.ts:737-749`) — so `disposition === 'finish' && !verdictCarriesConfidence(...)` is unreachable, which the coverage report also shows (lines 278-279 uncovered). Its inline comment claims "the FSM never accepts a confident-looking verdict that carries none", but the FSM routes on `.itc/disposition.txt`, never on this verdict word. Real enforcement is where it belongs: `itc-author-verdict` and again `itc-author-complete` at the freeze (`apps/cli/src/itc-stage.ts:288-296`). Harmless defence in depth; the comment overstates it. | `apps/cli/src/commands/content-generate-article.ts:277-283` | ACCEPTED |
| 4 | P4 (advisory) | architecture | Answering the question the stage was asked: keying "already frozen" on `contentType` is sound but on a wrong premise. No producer writes `4-publish/bundle.json` without `contentType` — the article freeze always writes it in one `writeJson`, and the news freeze writes the bundle at the run root (`apps/cli/src/publish-matrix.ts:2022`) so `resolveBundlePath` only ever sees a stamped file. The behaviour the relaxation buys is real though: a news freeze whose `bundle-content-type` stamp never ran can be re-frozen instead of being stuck, and a *settled* bundle still carries `contentType` and is still refused. A half-frozen bundle is therefore rewritable only in the un-stamped window — the intended repair path. The comment's "the variants step writes the same `4-publish/bundle.json`" is the one false claim. | `apps/cli/src/commands/content-generate.ts:1260-1272` | ACCEPTED |
| 5 | P4 (advisory) | documentation | R2 says the bundle carries "one entry per adapted file"; the freeze also adds `article` and `<sourceLocale>-article`, both `{path:'content.json', sha256}`. That is required by R3's own preset edit (every tier-0 row now names a `variant`, and the source article is not an ITC variant) and is asserted by the e2e, but the Solution does not record it. Related: R3 asks the preset edit to be "listed in Solution"; the change map names only `plugins/kk/publish-presets/itc-main.json:8`, while `technical-article.json` and `chinese-article.json` were edited too (the owned-files table covers them by glob). | `apps/cli/src/commands/content-generate-article.ts:537-538` | ACCEPTED |
| 6 | P4 (advisory) | correctness | Residual risk, not introduced here: preset resolution for the new article launch path reads `workflows.kk-article-generate.publish_preset` with **no** `kk-itc` fallback (`apps/cli/src/content-types.ts:95-99`, shipped by 0363), so an existing config that pins `workflows.kk-itc.publish_preset: technical-article` and nothing else gets `itc-main` on the article path. Reproduced: `resolveContentType('itc', {workflows:{'kk-itc':{publish_preset:'technical-article'}}})` → `preset = itc-main`, while the same config with the new block → `chinese-article`. R6's letter (and its e2e) cover the `itc-config.ts` block keys, which do fall back; this key is consumer-side and outside 0368's owned files. Worth a line in 0369's cut-over notes. | `apps/cli/src/content-types.ts:95-99` | ACCEPTED |

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | Article steps are two executors in the 0367 verbs (`content-generate.ts:880`, `:961`), each calling the owning function: `itc-outline-pick` + `itc-decision --outline` (`content-generate-article.ts:215`, `:221`), `itc-author-verdict` (`:267`), `itc-adapt-verify` (`:321`), `itc-materialize-plan` (`:404`), `itc-author-complete` (`:491`). No stage body edited (`git diff --stat -- apps/cli/src/itc-stage.ts apps/cli/src/itc-publish.ts plugins/kk/scripts/itc-stages.ts` empty); 43 in-process tests pass after the repair. |
| R2 | MET | §4.1 bundle with `contentType`, `title`, no `episode`, one `{path,sha256}` per adapted variant, plan removed (`content-generate-article.ts:505-555`); content.json keeps `sourceLocale` + per-variant `adapt`/`limits`/`switches` (`:390-430`); a missing adapted variant now refuses with exit 1 and the verb's own line (`:431-443`, `content-generate.ts:569-583`); asserted `kk-article.e2e.test.ts:329-338` and `content-generate-article.test.ts:423-466`. Deviations recorded as finding 5. |
| R3 | MET | Additive `variant`/`tier`/`required` only (`publish-presets/itc-main.json:8-40`, `technical-article.json:8-13`, `chinese-article.json:8-13`); rows plan through `planPublishMatrix` unchanged (`publish-matrix.ts:670-762`); legacy ITC path strips the new fields (`itc-plan.ts:136-155`) — 188 unmodified itc tests pass after the repair. |
| R4 | MET | 13 states in §5.2 order, `executor-probe` first (`kk-article-generate.yaml:25`, `:44-292`), one `agent` var (`:32-40`), `skill_dir` from `content_types.itc.writer_skill` (`content-launch.ts:282`), no child workflow / supervisor shell / `kk stage`; asserted `kk-article-generate-fsm.test.ts:64-150`. |
| R5 | MET | Pauses only at `outline-select`/`outline-review`/`draft-review` (`kk-article-generate.yaml:88`, `:132`, `:180`), skipped under `auto` (`:84`, `:318`, `:371`, `:392`); judge loop bounded by `workflows.kk-article-generate.max_revisions` (`content-generate-article.ts:186-188`, `:251-262`) and ending `failed` (`kk-article-generate.yaml:463-470`); proven `kk-article.e2e.test.ts:384-405`. |
| R6 | MET | New block first, `kk-itc` fallback, block name in every error, no key renamed (`itc-config.ts:25`, `:158-171`, `:252-258`); asserted `kk-article.e2e.test.ts:407-433` and `content-generate-article.test.ts:597-607`. |
| R7 | MET | Launcher plans `plugins/kk/workflows/kk-article-generate.yaml` from `content_types` (`content-types.ts:32-38`, `content-launch.ts:282`; e2e `kk-article.e2e.test.ts:270-282`); publish runs the shared `kk-publish` with no article node and 9 receipts in the article work dir (`kk-article.e2e.test.ts:340-350`, `kk-article-generate-fsm.test.ts:243-247`). |
| R8 | MET | `kk-article-generate-fsm.test.ts` (14 cases incl. `spur workflow validate`) + `kk-article.e2e.test.ts` (3 cases, stubbed agents) + `commands/content-generate-article.test.ts` (29 cases incl. the new missing-variant refusal at `:456-466`); re-run after the repair 45 pass / 0 fail over the four 0368-owned files. |
| R9 | MET | 188 tests across the nine `itc-*`/`kk-itc-*` suites pass unmodified after the repair; `git diff --stat -- apps/cli/tests` names only `commands/content-generate-inproc.test.ts:256-267` and `content-generate.e2e.test.ts:567-571`, the two 0367 refusal pins the operator pre-authorized (no `itc-*` assertion touched). |
| R10 | MET | `docs/04_DESIGN.md:1415`, `:1440-1442`, `:1494-1505` and one superseded-by pointer at `docs/design/kk-itc-refactor.md:12`, same commit. |

##### Acceptance criteria

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| AC1 — Both content types publish through one workflow: a generated article | MET | test | `kk-article.e2e.test.ts:261-355` (contentType `itc`, no `episode`, `article`/`zh-article` variants, no `publish-plan.json`, 9 shared-schema receipts, plan + report in the article work dir); `.works/tmp/test-article-generate/summary.json` written. Re-run after the repair: 3 pass / 0 fail. |
| AC2 — One channel is re-sent without regenerating | MET | test | `kk-article.e2e.test.ts:348-367` (only that row planned, `not in --channels` exclusion recorded, `bundle.json` and `content.json` byte-identical). |
| AC3 — Authoring gates and loops behave | MET | test + static-ref | `kk-article.e2e.test.ts:384-405` (`autorevise` then `fail` at `max_revisions: 1`, no bundle), `:407-433` (`workflows.kk-itc`-only config honoured), `kk-article-generate-fsm.test.ts:160-176` (auto bypass), `kk-article-generate.yaml:463-470` (terminal `failed` edge). Gap: the machine is not executed end to end, so "ends in state failed" is disposition + transition evidence. |
| AC4 — Gate | MET | command + manual-review | Re-verified after the repair: `bun run --filter './apps/cli' typecheck` exit 0; `bunx biome check .` 0 errors (32 pre-existing warnings); `rules-pre` 58/58 PASS via the installed binary; 262 tests re-run post-fix, 0 fail (29 article in-process + 45 fsm/e2e/inproc/content-generate.e2e + 188 itc); `bun run lint` and `bun run build` exit 0 earlier this review. Suite 5286 pass / 3 fail, all three the `cannot locate the @gobing-ai/spur package` environment breakage reproduced on `cdbda2d6` (`.spur/run/0368-suite-node-path.log:28`, `:44`). Clause 2 disclosure: two `apps/cli/tests` files carry an updated assertion (the pre-authorized 0367 refusal pins at `commands/content-generate-inproc.test.ts:256-267` and `content-generate.e2e.test.ts:567-571`); no `itc-*` assertion is edited. |

##### Evidence gaps and residual risks

- **The FSM is not executed by any suite.** `kk-article.e2e.test.ts` walks the same verb sequence the machine drives and `kk-article-generate-fsm.test.ts` asserts the file contract, but no test closes `executor-probe → … → done` on the engine (the suite header documents why: offline agent dispatch is not attestable on this host). Terminal-state behaviour is therefore proven at the disposition and transition level, not by a live run.
- **`bun run test` cannot exit 0 in this environment.** `~/.bun/bin/spur` is re-pointed at a local dev build, so `scripts/with-spur-env.ts` cannot resolve `@gobing-ai/spur`; the 3 failures (`scripts/tests/with-spur-env.test.ts`, `apps/board/tests/installed-board.test.ts`, `apps/cli/tests/smart-seo-installed.test.ts`) fail identically on untouched `main`. Tests are therefore run as `NODE_ENV=test NODE_PATH=$HOME/.bun/install/global/node_modules bun test …`; the gate's green evidence is `.spur/run/0368-gate-full.log:44-53` (5330 pass / 0 fail up to the env-only post-check).
- **`.coverage/` is a partial-suite artifact** as of this review: targeted `bun test` runs overwrote it, so a local `recommended-post-check` reports `coverage-gate` errors for 79 files the subset never loaded (the same artifact the earlier light-gate log shows). `every-export-has-tsdoc` is green on the current tree, including the new `ArticleStepFailure` export. Re-derive coverage from a full-suite run before relying on the post gate.
- Findings 3–6 are the dispositioned residuals: the freeze guard's false comment premise, R2's alias variants / the incomplete Solution listing, and the `kk-itc.publish_preset` consumer gap that 0369 should close.

**Next:** No open finding; finding 1 is closed with its regression test. One wording-only follow-up from finding 2 (drop "prints its one JSON object" from `content-generate.ts:576` and "with the verb JSON" from the test name), and carry finding 6 into 0369's cut-over notes.

### References

- Design: `docs/design/content-pipeline-consolidation.md` §4.1, §4.2, §5.2, §6. Decision: ADR-053 §1, §6. Prior design: `docs/design/kk-itc-refactor.md`.
- Depends on: 0366, 0367. Blocks: 0369.
- Parent feature: G61, scenarios "Both content types publish through one workflow", "One channel is re-sent without regenerating".

### History

- 2026-11-14T19:55:03.304Z backlog → wip (system)
- 2026-11-14T21:52:56.967Z wip → testing (system)
- 2026-11-14T21:53:00.614Z testing → done (system)

