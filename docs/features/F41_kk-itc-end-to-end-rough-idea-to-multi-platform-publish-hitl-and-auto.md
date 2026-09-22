---
schema_version: 1
id: "F41"
name: "kk-itc end-to-end: rough idea to multi-platform publish (HITL and auto)"
status: backlog
priority: P2
tags: []
created_at: "2026-09-22T07:00:20.511Z"
updated_at: "2026-09-22T07:08:48.283Z"
---

# F41: kk-itc end-to-end: rough idea to multi-platform publish (HITL and auto)

## Goal

Turn a rough IT-content idea into researched, judged, illustrated and platform-adapted articles
published as drafts (or live, on explicit operator opt-in) to multiple platforms, in one `kk-itc`
run. The run is operator-steered by default and AI-driven under `auto`, and it reuses the shipped
kk skills, publish plugins and `kk executor fan-out` rather than building a parallel pipeline.

## Scope

**In scope**

- Extend `plugins/kk/workflows/kk-itc.yaml` (no new workflow file). All new behaviour is opt-in
  through workflow vars, so current kk-itc invocations behave identically.
- An `auto` mode:
  - The AI picks the outline from the writer's options and records its rationale.
  - The human draft review is skipped, and the `kk:content-judge` gate becomes mandatory.
  - NEEDS_REVISION goes through an agent revise loop capped by `max_revisions`.
  - A FAIL or an exhausted budget ends the run with a report.
- A `kk:content-judge` revise loop on the interactive path too: NEEDS_REVISION routes back to
  revision instead of straight to failure.
- A de-slop pass through `kk:taste-unslop` (var `unslop`).
- Research evidence (`docs.json` from `kk:storm-research`) passed to the judge for fact-checking.
- An optional cover and inline illustrations through `kk:image-authoring`. The var `cover_enabled`
  is the spend approval.
- Per-platform adaptation (locale en/zh/ja and channel format) through a new `kk:article-adapt`
  skill and a static target profile table.
- New deterministic `kk stage itc-*` helpers in a sibling `itc-stages.ts` module, dispatched from
  `kk-workflow-stages.ts`:
  - `itc-outline-pick`: validates the auto outline pick.
  - `itc-materialize`: draft plus evidence → `ContentSchema` JSON.
  - `itc-publish-plan`: targets → transport class plus variant groups.
  - `itc-publish-fanout`: one `kk executor fan-out` per variant group.
  - `itc-publish-next`: cursor for the browser targets.
  - `itc-report`: aggregates the per-target Results and writes the run report.
- A multi-platform publish tail that is enabled only by a non-empty `publish_targets`:
  - A pre-publish confirmation. It is skipped only when `auto` is on and the mode is draft.
  - API and file-cli targets go through `kk executor fan-out`.
  - Browser targets go through `agent.run kk:publish`.
  - Failed targets retry through `--retry-from`.
- Publish results default to **drafts**. Live publish requires an explicit `publish_live=true`, and
  `auto` never implies live.
- A `/workflow-run` end-to-end profile for `kk-itc`: research on, judge on, `auto`, targets.
- Deterministic tests in `bun run gate`:
  - a `spur workflow run --dry-run` walk of the auto path
  - an integration test of the publish tail on fake transports
  - Agent-bearing states are not executed in CI.
- Docs:
  - an ADR amendment for the widened kk-itc contract and the draft-default / auto-never-live rule
  - the kk-itc and itc-generating design docs
  - `04_DESIGN` surface, the `01_PRD` deferral row and `05_FEATURES`

**Out of scope**

- Information collection or ingestion. It belongs to a separate workflow.
- A new workflow file, generator plugin, first-layer `kk` noun (including `kk publish`) or new
  slash command.
- A generic reusable publish workflow for other generators. It can be extracted later at the
  `itc-materialize` seam.
- New publish plugins or publish-harness transport changes. E1–E7 already own those.
- Changes to the `topic`, `itc-generating`, `storm-research` or `content-judge` skill contracts
  beyond passing new inputs.
- Unattended live publishing, and scheduling or cron triggers.

## Acceptance Criteria

```gherkin
Feature: kk-itc end-to-end from rough idea to multi-platform publish

  @core
  Scenario: R1 — kk-itc with default vars keeps its current states and pauses
    # covers: I1, I5, I8
    Given kk-itc.yaml with auto false, unslop false, cover_enabled false and publish_targets empty
    When the workflow runs from a topic with no ingested documents
    Then the run visits prepare, outline-write, outline-select, draft-write and draft-review as it does today
    And no illustrate, adapt, materialize or publish state is entered

  @core
  Scenario: R2 — Auto mode commits the writer-recommended outline without pausing
    # covers: I9
    Given auto true and an empty outline var
    When outline-write finishes
    Then 2-outline/outline-recommendation.json names option a, b or c with a one-line rationale
    And the run commits that option without entering outline-select
    And the run does not pause at draft-review

  @core
  Scenario: R3 — Auto mode revises on judge feedback up to max_revisions
    # covers: I9, I11
    Given auto true and max_revisions 2
    When content-judge returns NEEDS_REVISION
    Then an agent revise step applies the verdict feedback to the draft and the judge runs again
    And after 2 revisions without PASS the run ends in failed with the run report written

  @core
  Scenario: R4 — Interactive runs route NEEDS_REVISION back to draft revision
    # covers: I8, I11
    Given auto false and judge true
    When content-judge returns NEEDS_REVISION
    Then the run returns to draft-revise with the verdict feedback shown to the operator
    And the run does not end in failed on that verdict

  @core
  Scenario: R5 — Judge receives research evidence when research ran
    # covers: I6, I7
    Given research true produced docs.json in the work dir
    When the judge state runs with rubric tech-accuracy
    Then the judge input names the docs.json path as evidence
    And the verdict JSON parses with a content_ref pointing at the judged draft

  @core
  Scenario: R6 — Unslop pass edits the draft before the judge runs
    # covers: I3, I7
    Given unslop true
    When draft-write finishes
    Then kk:taste-unslop edits the draft article in place
    And the judge state reads the edited draft

  @core
  Scenario: R7 — Cover generation runs only when cover_enabled is true
    # covers: I3, I7
    Given cover_enabled true and a non-empty publish_targets
    When the illustrate state runs
    Then kk:image-authoring writes a cover under 4-illustrations with KK_NONINTERACTIVE=1
    And the materialized Content metadata.coverImage points at that cover
    And with cover_enabled false no image command runs

  @core
  Scenario: R8 — itc-materialize writes ContentSchema JSON from the final draft
    # covers: I7, I10
    Given a final draft, the committed outline and an optional docs.json
    When kk stage itc-materialize runs
    Then 4-publish/content.json parses against ContentSchema
    And title comes from the draft H1, outline from the committed outline and references from docs.json
    And metadata.published is false unless publish_live is true

  @core
  Scenario: R9 — article-adapt writes one Content variant per target profile
    # covers: I2, I10
    Given publish_targets medium-pub, juejin-pub and zenn-pub
    When the adapt state runs
    Then kk:article-adapt writes one Content variant per distinct locale and format profile
    And each variant parses against ContentSchema
    And targets that share a profile share one variant file

  @core
  Scenario: R10 — itc-publish-plan splits targets into fan-out groups and browser targets
    # covers: I2, I10, I11
    Given publish_targets naming both API or file-cli channels and browser channels
    When kk stage itc-publish-plan runs
    Then the plan JSON lists fan-out groups keyed by variant and a separate browser target list
    And an unknown target fails the stage with an error naming that target

  @core
  Scenario: R11 — Interactive publish pauses for an operator answer before sending
    # covers: I8
    Given auto false and a non-empty publish_targets
    When the run reaches publish-confirm
    Then the prompt lists every target and the draft or live mode
    And answering no ends the run without any publish call
    And with auto true and publish_live true the run still pauses at publish-confirm

  @core
  Scenario: R12 — Auto mode sends drafts unless publish_live was set at launch
    # covers: I2, I9
    Given auto true and publish_live false
    When the publish tail runs
    Then every Content variant sent sets its target's draft switch explicitly to draft
    And the run does not pause at publish-confirm
    And a target with no draft mode such as x-pub fails itc-publish-plan with an error naming it
    And with publish_live true set at launch every variant sets its target's switch to live

  @core
  Scenario: R13 — API and file-cli targets publish through kk executor fan-out
    # covers: I2, I3
    Given a publish plan with fan-out groups
    When publish-fanout runs
    Then kk executor fan-out runs once per variant with one --target per group member
    And the aggregate Result JSON is written under 4-publish

  @core
  Scenario: R14 — Browser targets publish through kk:publish agent steps
    # covers: I2, I3
    Given a publish plan whose browser list contains juejin-pub
    When publish-agent runs
    Then agent.run invokes kk:publish once per browser target with that target's Content variant
    And each browser target writes a Result JSON under 4-publish

  @core
  Scenario: R15 — Failed fan-out targets are re-sent once through --retry-from
    # covers: I11
    Given an aggregate Result where one target has ok false
    When publish-retry runs
    Then kk executor fan-out runs with --retry-from naming the prior aggregate Result
    And only the failed target is re-sent

  @core
  Scenario: R16 — itc-report summarizes the verdict, revisions and per-target outcomes
    # covers: I7, I11
    Given a run that reached done or failed after the draft existed
    When kk stage itc-report runs
    Then 5-report/report.md and 5-report/report.json list the verdict, revision count and each target's ok, url or error
    And the stage exits nonzero only when the report cannot be written

  @core
  Scenario: R17 — workflow-run binds an end-to-end kk-itc profile
    # covers: I5, I6, I9, I10
    Given /workflow-run kk-itc with a rough idea, publish targets and --auto
    When the command binds workflow vars
    Then research, judge, unslop and auto are true and publish_targets comes from the request
    And publish_live stays false unless the operator passes it explicitly

  @core
  Scenario: R18 — Fixture run of the publish tail reaches platform drafts on fake transports
    # covers: I1, I2, I7, I11
    Given a seeded work dir with a final draft and KNOWLEDGE_KIT_PUBLISH_TRANSPORT=fake
    When the tail stages run from itc-materialize through itc-report for zenn-pub, qiita-pub and surfdash-pub
    Then content.json, one ok Result per target in draft mode and the run report are written
    And a dry-run walk of kk-itc with auto true and publish_targets set reaches done
    And both checks run inside bun run test

  @core
  Scenario: R19 — The feature adds no workflow file, kk noun or slash command
    # covers: I3, I10
    Given the feature's change set
    When the plugin tree and CLI surface are inspected
    Then kk --help lists the same top-level commands as before
    And plugins/kk/workflows and plugins/kk/commands gain no new files

  @core
  Scenario: R20 — Docs record the widened kk-itc contract and the draft-default publish rule
    # covers: I3, I12
    Given the implemented feature
    When the numbered docs are updated
    Then docs/00_ADR.md has a dated entry for the kk-itc end-to-end contract, draft default and auto never implying live
    And docs/04_DESIGN.md lists the new vars and stages and docs/01_PRD.md no longer defers these families
```

## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0149 | kk-itc auto mode, judge revise loop and run report | todo |
| 0150 | itc-materialize and itc-publish-plan with the target profile table | todo |
| 0151 | kk-itc publish tail: fan-out, browser loop, retry and operator confirm | todo |
| 0152 | Cover illustration and kk:article-adapt per-platform variants | todo |
| 0153 | /workflow-run kk-itc end-to-end profile flags | todo |
| 0154 | Docs sync for the kk-itc end-to-end contract | todo |
<!-- END AUTO-GENERATED -->

## Notes

## History
