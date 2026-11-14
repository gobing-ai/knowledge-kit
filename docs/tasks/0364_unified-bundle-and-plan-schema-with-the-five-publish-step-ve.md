---
schema_version: 1
name: Unified bundle and plan schema with the five publish step verbs
status: done
template: feature-impl
created_at: 2026-11-13T18:13:39.337Z
updated_at: "2026-11-14T07:14:21.656Z"
feature_id: G61

ac_altitude: task-local
ac_numbering: task-local
priority: P1
dependencies: ["0361", "0363"]
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0364-verdict.json
---

## 0364. Unified bundle and plan schema with the five publish step verbs

### Background

Phase 2 of G61 (ADR-053 §1, §2). Frozen contract: `docs/design/content-pipeline-consolidation.md` §1.2, §4.1, §4.2. Today the news matrix (`apps/cli/src/publish-matrix.ts`: `BundleSchema` L51, `PublishPlanRowSchema` L68, `PublishPlanSchema` L109) and ITC (`apps/cli/src/itc-plan.ts` `ItcPublishPlan`, `4-publish/publish-plan.json`) describe the same thing with two schemas, and every publish step is reachable only as `kk stage run publish-matrix-*` / `itc-*` with a positional work dir. This task makes one schema able to carry both content types and exposes the five publish step verbs on both nouns. The existing stage names keep working and call the same functions.

Out of scope: any workflow YAML, the launching `publish` verb (0365), converting ITC generation to write a bundle (0368), deleting any stage name.

**Refine corrections (2026-11-14)**

R8 requires additive modeSource values on named-command plan rows while R9 preserves legacy stage output. AC1 therefore compares the shared plan fields after removing only modeSource from the named-command plan; the legacy writer remains byte compatible. Existing command inventory expectations must include the newly added verbs; existing publish/stage assertions are retained, and a new freeze assertion verifies that schema defaults do not leak into legacy serialized bundles. The parsed bundle type now truthfully marks episode optional. A scalar channels override is rejected instead of silently dropped.

### Requirements

- [x] R1. `BundleSchema` gains optional `contentType` (default `'news'` on parse) and optional `title`; `episode` becomes optional. `schemaVersion` stays `1`. Every bundle under `apps/cli/tests/fixtures` still parses unchanged.
- [x] R2. Code that needs `episode` (`runPublishMatrixRssGate`, podcast rows in `planPublishMatrix`) fails with an actionable error naming the missing field instead of a TypeError when it is absent.
- [x] R3. `PublishPlanRowSchema` gains optional `transport: 'fanout' | 'browser'` (default `'fanout'`) and optional `metadata: record<string, unknown>`; `sendPublishMatrix` passes both through to `sendRows` (`apps/cli/src/publish-core.ts`, 0361), which already switches on `transport`.
- [x] R4. New `apps/cli/src/commands/content-publish.ts` adds `publish-plan`, `publish-check`, `publish-send`, `publish-settle`, `publish-report` to the 0363 verb list for both nouns, with flags, exit codes, stdout and files exactly as design §1.2. Named flags only: `--work-dir` is required, a positional argument is a usage error (exit 2).
- [x] R5. `publish-plan` = wait-until (window `cn-peak`) → rss-gate (window `overseas-rss`) → validate → plan, in that order, in one process, calling the existing functions. `--channels` with an id that matches no preset row exits 2 before any file is written.
- [x] R6. `publish-settle` = classify → patch-surfdash (window `after-generate`, failure logged, non-fatal as today) → partial marker → settle (skipped for `overseas-rss`, as today; the script-resolved stages `publish-matrix-partial` and `publish-matrix-patch-surfdash` are invoked through the existing stage runner `apps/cli/src/stage.ts`, not re-implemented) → append the run id to `bundle.json` `runs[]` → assert; exit 1 exactly when a required non-dummy row is not `succeeded` — the predicate of today's `outcome-assert` jq in `kk-daily-publish3.yaml`, ported to TypeScript with the same truth table.
- [x] R7. `publish-report` writes `5-report/publish-<window>.md` with the same content the inline `printf`/`jq` of publish3 node `report` produces, then runs `kk ledger sync` in-process.
- [x] R8. Channel switchboard (design §2.1): new pure `applyChannelModes(preset, channels, liveChannels)` in `publish-matrix.ts`, called by `publish-plan` before `planPublishMatrix`. Row mode = `--live-channels` → `content_types.<type>.channels` (`<plugin>/<variant>` key beats `<plugin>` key) → preset `mode`; each plan row records `modeSource: 'flag' | 'config' | 'preset'` (optional field on `PublishPlanRowSchema`); a row switched off by config lands in `excluded[]` with reason `mode off (config)`. A `channels` key matching no preset row exits 2 naming the key and the preset, before any file is written. `kk stage run publish-matrix-plan` does not read `channels` (R9).
- [x] R9. Every `kk stage run publish-matrix-*` name and its positional form behave byte-identically to the parent commit; no existing publish/stage assertion is weakened or removed (command inventories are expanded for the new verbs).
- [x] R10. `docs/04_DESIGN.md` §1.14 lists the five verbs as shipped; the "publish-matrix stages" section gains one line pointing at them. Same commit.

### Acceptance Criteria

```gherkin
Scenario: AC1 — Both content types publish through one workflow: one schema carries both (req: R1, R2, R3)
  Given a frozen news bundle fixture and an article bundle with contentType itc, a title, no episode, and a preset with one browser-transport target
  When `kk news publish-plan` and `kk article publish-plan` run with --dummy against each
  Then both write 4-publish/plan.after-generate.json that parses with PublishPlanSchema
  And the article row carries transport browser and its metadata, and the news plan matches the legacy stage plan after removing only the additive modeSource field from named-command rows; legacy stage serialization remains unchanged

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
  Then no existing publish/stage assertion is weakened or removed; command inventories include the new verbs and all three commands exit 0
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

Implemented the shared schema and named publish-step surface; existing stage spellings remain registered.

| File | Change and rationale |
| --- | --- |
| `apps/cli/src/publish-matrix.ts:54` | Article-compatible BundleSchema, truthful optional episode type, additive transport/metadata/mode source fields; readers validate episode only when needed. Legacy freeze serialization retains its previous fields. |
| `apps/cli/src/publish-matrix.ts:305` | Pure channel switchboard and selector validation before writes; specific variant config beats plugin config and live flags win. |
| `apps/cli/src/publish-matrix.ts:1357` | Transport and target metadata flow through shared sendRows; existing stage call signatures remain intact. |
| `apps/cli/src/publish-matrix.ts:1588` | Missing episode errors are actionable; an empty bundle-less QC day still records a conservative RSS miss. |
| `apps/cli/src/commands/content-publish.ts:1` | Five named-flag commands compose existing wait/RSS/validate/plan, check, send, classify/settle/stage hooks, report/ledger paths. Required non-dummy failures exit 1. |
| `apps/cli/src/commands/content.ts:440` | Both nouns register the same publish commands through their single registration owner. |
| `apps/cli/src/publish-core.ts:142` | Additive target transport/metadata fields consumed by the shared pipeline. |
| `apps/cli/tests/content-publish.e2e.test.ts:21` | Mode precedence, transport, named-flag dummy lifecycle, RSS refusal, usage errors and episode omission coverage. |
| `apps/cli/tests/voice3-dag.test.ts:70` | Additional assertion locks legacy bundle serialization; existing episode assertion remains, preceded by a type-safe presence guard. |
| `apps/cli/tests/main.test.ts:71` | Expected noun and leaf inventories include the intentionally added public commands. |
| `docs/04_DESIGN.md:1409` | Records new/status and the five publish-step commands as shipped, and preserves planned later generation/launch work. |

The named commands still accept the legacy root bundle location used by existing matrix functions and fixtures. Moving generated runs to the final workflow layout belongs to 0366/0368. The task's additive modeSource versus byte-parity conflict is reconciled in Background and AC1; old stage serialization itself is unchanged. No workflow YAML, publishing preset, live account, or production installation was modified.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | apps/cli/src/publish-matrix.ts:54 |
| R2 | MET | apps/cli/src/publish-matrix.ts:633 |
| R3 | MET | apps/cli/src/publish-matrix.ts:1454 |
| R4 | MET | apps/cli/src/commands/content-publish.ts:449 |
| R5 | MET | apps/cli/src/commands/content-publish.ts:176 |
| R6 | MET | apps/cli/src/commands/content-publish.ts:335 |
| R7 | MET | apps/cli/src/commands/content-publish.ts:409 |
| R8 | MET | apps/cli/src/publish-matrix.ts:305 |
| R9 | MET | apps/cli/tests/voice3-dag.test.ts:70 |
| R10 | MET | docs/04_DESIGN.md:1409 |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Both content types publish through one workflow: one schema carries both (req: R1, R2, R3) | MET | command | .spur/memory/evidence/0362-0364/publish-summary.json:1 — both nouns and browser metadata; parity after removing only additive modeSource |
| AC2 — The five step verbs complete a dummy window end to end (req: R4, R5, R6, R7, R8) | MET | command | .spur/memory/evidence/0362-0364/publish-summary.json:1 — both dummy windows, receipts, report, bundle runs and invalid channel/no writes |
| AC3 — Settlement fails the step when a required row is unsettled (req: R6) | MET | command | .spur/memory/evidence/0362-0364/publish-summary.json:1 — required live row marked failed gives exit 1 and outcome none without sending |
| AC5 — One config line turns a channel off (req: R8) | MET | test | apps/cli/tests/content-publish.e2e.test.ts:91 — config-off exclusions, variant precedence and flag promotion; retained acceptance covers invalid config keys |
| AC4 — Old stage spellings are untouched (req: R9, R10) | MET | test | apps/cli/tests/voice3-dag.test.ts:70 — old bundle bytes retained; existing matrix/stage assertions preserved, new command inventories explicitly expanded |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Verdict: PASS

Confidence: HIGH

Scope: integrated batch 0362–0364, retained commit 365011c8 plus the reviewed working tree.

#### Requirement Traceability

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | apps/cli/src/publish-matrix.ts:54 |
| R2 | MET | apps/cli/src/publish-matrix.ts:633 |
| R3 | MET | apps/cli/src/publish-matrix.ts:1454 |
| R4 | MET | apps/cli/src/commands/content-publish.ts:449 |
| R5 | MET | apps/cli/src/commands/content-publish.ts:176 |
| R6 | MET | apps/cli/src/commands/content-publish.ts:335 |
| R7 | MET | apps/cli/src/commands/content-publish.ts:409 |
| R8 | MET | apps/cli/src/publish-matrix.ts:305 |
| R9 | MET | apps/cli/tests/voice3-dag.test.ts:70 |
| R10 | MET | docs/04_DESIGN.md:1409 |

#### Acceptance Criteria Verification

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| AC1 — Both content types publish through one workflow: one schema carries both (req: R1, R2, R3) | MET | command | .spur/memory/evidence/0362-0364/publish-summary.json:1 — both nouns and browser metadata; parity after removing only additive modeSource |
| AC2 — The five step verbs complete a dummy window end to end (req: R4, R5, R6, R7, R8) | MET | command | .spur/memory/evidence/0362-0364/publish-summary.json:1 — both dummy windows, receipts, report, bundle runs and invalid channel/no writes |
| AC3 — Settlement fails the step when a required row is unsettled (req: R6) | MET | command | .spur/memory/evidence/0362-0364/publish-summary.json:1 — required live row marked failed gives exit 1 and outcome none without sending |
| AC5 — One config line turns a channel off (req: R8) | MET | test | apps/cli/tests/content-publish.e2e.test.ts:91 — config-off exclusions, variant precedence and flag promotion; retained acceptance covers invalid config keys |
| AC4 — Old stage spellings are untouched (req: R9, R10) | MET | test | apps/cli/tests/voice3-dag.test.ts:70 — old bundle bytes retained; existing matrix/stage assertions preserved, new command inventories explicitly expanded |

#### SECUA and Architecture Review

No open P1–P4 findings. New command composition reuses the matrix, stage, filesystem and ledger boundaries. Usage errors are checked before writes; typed schemas validate config and payloads. Dummy acceptance never dispatches a live publish. Optional episode typing is sound, malformed channel overrides are refused, legacy bundle serialization is preserved, and dummy rehearsal keeps disabled channels excluded. Existing behavioral assertions remain, with exact inventories expanded for the public commands. Scope remains within the accepted content pipeline design; workflow migration is deferred to the later G61 tasks.

#### Verification

Final integrated gate PASS at git tree 45fa9f14fb47a2ec0ea61183eed3505cc8476316: lint, 5178 tests passed / 0 failed, coverage thresholds, build, 58 pre-check and 2 post-check rules. Evidence: .spur/memory/evidence/0362-0364/integrated-gate.log:1 and integrated-check-receipt.json. Prior failed attempts remain historical, not passing evidence.

#### Findings

| # | Priority | Dimension | Finding | Location | Disposition |
| --- | --- | --- | --- | --- | --- |
| 1 | P4 | verification | Integration review corrections are verified by the final gate and retained regression evidence. | apps/cli/tests/content-publish.e2e.test.ts:91 | RESOLVED |

### References

- Design: `docs/design/content-pipeline-consolidation.md` §1.2, §4.1, §4.2. Decision: ADR-053 §1, §2; ADR-043.
- Depends on: 0361, 0363. Blocks: 0365, 0366.
- Parent feature: G61, scenario "Both content types publish through one workflow" (schema half; the workflow half is 0366 and 0368).

- Final batch verification, reproducible acceptance runner, and wrap learnings: `.spur/memory/evidence/0362-0364/`. The learning capture is retained as `wrap-learnings.md`; runtime metrics and final gate evidence are stored alongside it.

### History

- 2026-11-14T06:35:13.986Z backlog → todo (system)
- 2026-11-14T06:35:14.262Z todo → wip (system)
- 2026-11-14T06:58:44.244Z wip → testing (system)
- 2026-11-14T06:58:44.461Z testing → done (system)

