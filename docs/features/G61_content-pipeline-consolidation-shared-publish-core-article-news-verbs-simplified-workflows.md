---
schema_version: 1
id: "G61"
name: "Content pipeline consolidation: shared publish core, article/news verbs, simplified workflows"
status: active
priority: P1
tags: []
created_at: "2026-11-13T17:30:35.983Z"
updated_at: "2026-11-22T22:31:01.351Z"
---

# G61: Content pipeline consolidation: shared publish core, article/news verbs, simplified workflows

## Goal

Make the daily-news and article (ITC and later types) pipelines reliable enough for unattended daily use by
removing the boundary drift between them: one neutral publish core, one publish workflow, operator verbs on
`kk article` / `kk news`, and workflows reduced to the nodes that earn a retry boundary. The one publish
workflow is `kk-publish.yaml` (nine nodes, both content nouns; shipped by task 0366); the news
generate side is `kk-news-generate.yaml` (twenty nodes, one executor var; shipped by task 0367); the article
generate side is `kk-article-generate.yaml` (thirteen states, one executor var; shipped by task 0368). Decision record:
ADR-053 (accepted 2026-11-13). Supersedes the remaining scope of G21 where they overlap.

## Scope

- In: news — the consolidated `kk news` generate/publish commands and their owning workflows.

**In scope**

- Phase 0 (task 0360) — launch safety: one `agent` var per workflow (default `inline`; the engine rejects an
  empty value) as the single source for every primary agent node and every nested launch; retry nodes are
  role-resolved; the executor traffic probe also covers `inline`; single-flight lock per workflow + run day;
  receipts name the checkout commit. The template fallback after a failed writer (F613, 0345 R9/R10) is kept.
- Phase 1 (task 0361) — neutral publish core `apps/cli/src/publish-core.ts` (send loop, plugin probe, receipt
  and preset schemas, config path) imported by both the ITC and matrix paths; pure move, no behaviour change.
- Design freeze (task 0362) — verb set, `content_types` config, node maps; produces the Phase 2–4 tasks.
- Phase 2 — CLI and config: `kk article new|generate|publish|status --type <t>`, `kk news
  prepare|generate|publish|status|report`, shared step verbs `publish-plan|publish-check|publish-send|
  publish-settle|publish-report` on both nouns, `--channels` override recorded in the plan, a
  `content_types` config block mapping type → workflow, writer skill, publish preset. `kk itc`, `kk daily`
  and `kk stage` spellings stay as hidden compatibility routes (ADR-037).
- Phase 3 — workflows: one shared `kk-publish.yaml`; `kk-article-generate.yaml` (author FSM as child) and
  `kk-news-generate.yaml` in their own namespaces; ITC adopts the frozen `bundle.json` + matrix plan; a node
  survives only if it is an agent call, a human pause, or a retry boundary worth minutes.
- Phase 4 (task 0369) — scheduler lines call `kk news generate|publish` and start no entry script; `kk itc`
  and `kk daily` become hidden routes; Board and triage accept the new workflow names. Deleting
  the old launcher and publisher scripts, the old launchers and the old workflows waits for
  one proven production day and is task 0372, outside this feature (operator decision 2026-11-14).

**Out of scope**

- Spur Board modules (G8x) — only the single bundle/receipt schema they will read.
- New publish channels and per-channel UI repairs (E9x).
- `kk-daily-ai-voice.yaml` and `kk-daily-ai-voice2.yaml`: not edited by any G61 task; deleted later, once
  nothing references them.
- Moving agent authoring into `plugins/generations`; generation plugins stay deterministic renderers.

## Acceptance Criteria

```gherkin
Feature: Content pipeline consolidation: shared publish core, article/news verbs, simplified workflows

  Scenario: One executor variable drives every agent node
    Given an in-scope workflow launched with agent set to a named executor
    When the run and its nested workflows dispatch agent nodes
    Then every primary agent node uses that executor and no second executor variable exists

  Scenario: A dead executor stops the run before it costs anything
    Given the configured executor cannot answer a one-line prompt
    When the scheduled generate launch is issued
    Then the launch exits non-zero within 3 minutes and no workflow node has started

  Scenario: A second launch for the same workflow and day is refused
    Given a generate run for today is in flight
    When the same launch is issued again
    Then it exits non-zero naming the holder and touches no work dir

  Scenario: The news publish path imports no ITC-named module
    Given the publish-matrix source files
    When their imports are listed
    Then none resolves to a file named itc-* and every existing publish suite passes unchanged

  Scenario: Both content types publish through one workflow
    Given a frozen news bundle and a frozen article bundle
    When each is published in dummy mode through `kk-publish.yaml`
    Then both produce receipts of the same schema in their own work dirs

  Scenario: One channel is re-sent without regenerating
    Given a settled article bundle with one failed channel
    When `kk article publish --channels <that channel>` runs
    Then only that row is dispatched, in the same work dir, and the plan records the override

  Scenario: The scheduler runs without padding scripts
    Given the scheduler entries for generate and both publish windows
    When a scheduled run executes
    Then no process under `scripts/` or `plugins/kk/scripts/` appears in its process tree
```

## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0369 | Scheduler cut-over and retirement of launcher scripts and old workflows | blocked |
| 0362 | Design freeze: article/news verb set, content_types config, and the simplified workflow node maps | done |
| 0360 | Launch safety: single executor var, traffic probe first, single-flight lock, hard-fail writer | done |
| 0364 | Unified bundle and plan schema with the five publish step verbs | done |
| 0368 | Article generate verbs, kk-article-generate workflow and article publish through kk-publish | done |
| 0367 | News generate step verbs and the kk-news-generate workflow | done |
| 0361 | Extract a neutral publish core from itc-publish, itc-plan and publish-matrix | done |
| 0365 | launchWorkflow and the plain generate / publish verbs | done |
| 0363 | content_types config and the kk article / kk news nouns with new and status | done |
| 0366 | kk-publish workflow and news publish cut-over | done |
<!-- END AUTO-GENERATED -->

## Notes

Evidence (review 2026-11-12/13): `publish-matrix.ts` imports its send loop, plugin probe, receipt type, preset
schemas and config path from `itc-publish.ts`, `itc-plan.ts`, `itc-config.ts`; the ITC publish-tail DAG is a
byte-identical copy of seven `kk-itc.yaml` nodes; ITC channel retries produced `a2ui-intro-wechat2/3/4` work
dirs; voice3 runs in the `kk-daily-ai-voice2` namespace; the operator API lives in the retired daily launcher
and the article publisher; ~70 `kk stage run <name>` bodies take untyped positionals and most resolve
from the installed package; a checkout holding a pre-f7a964e2 scheduler job line ran a quota-dead pinned
executor on 11-11 and 11-12 and failed 7/7 while a second machine ran the real schedule.

## History

- 2026-11-13T17:40:54.085Z moved Q → G61 (system)
- 2026-11-13T21:35:41.126Z backlog → active (system)
- 2026-11-14T21:54:01.624Z active → blocked (system)
- 2026-11-22T22:31:01.351Z blocked → active (system)

