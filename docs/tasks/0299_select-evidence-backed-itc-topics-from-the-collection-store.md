---
schema_version: 1
name: Select evidence-backed ITC topics from the collection store
status: done
template: feature-impl
created_at: 2026-10-15T21:59:21.902Z
updated_at: "2026-10-16T00:23:57.349Z"
ac_altitude: task-local
ac_numbering: task-local
feature_id: G21
priority: P2
tags:
  - kk-itc
  - G21
estimate_hours: 8

dependencies: ["0298"]
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0299-verdict.json
---

## 0299. Select evidence-backed ITC topics from the collection store

### Background

kk-collect already stores Doc[] and store extract/select/release/mark-published already exist. ITC entry currently requires topic XOR file and has no collected candidate contract; add bounded evidence-backed topic intake using those store operations.

Implements feature G21 scenarios: R2 — Collected evidence can supply a selected topic; R3 — Empty or unavailable collections stop topic selection safely.

Current-tree premises: apps/cli/src/commands/store.ts:1277; apps/cli/src/commands/store.ts:1373; apps/cli/src/commands/store.ts:1462; packages/kk-store/src/profile.ts:43; plugins/kk/workflows/kk-collect.yaml:1; plugins/kk/commands/workflow-run.md:189. These claims were checked against source, not inferred from old status or scratch reports.

Every mapped issue remains valid; no requirement/scenario is dropped or renumbered. Config/workspace code is owned by 0303, child authoring by 0301, root DAG/publication by 0302, capabilities by 0298, topic/store intake by 0299 and presets by 0300.

Concurrency: main-tree wip task query was empty at kickoff. Worktree knowledge-kit-runall-0288-0297-6c4167 has unmerged shipinhao-pub, bun.lock and task0296 changes. No confirmed same-file source overlap is present, but do not enumerate its unpublished plugin or consume its lockfile; recheck source ownership before execution.



**Refine corrections (2026-10-15)**
- A selected topic implied a fresh exclusive claim → extract returns a snapshot and select is idempotent per run, not a global atomic cross-workflow claim → preserve that contract and avoid claiming stronger exclusivity.
- Release on every failure → remote side effects can be uncertain and published rows must remain excluded → freeze settlement precedence and retain selected rows on unknown effects.
- Topic selection/workspace interfaces were unspecified → add bounded candidate/selection artifacts and explicit intake-directory inputs; defer default workspace allocation to 0303.
- Collection refresh completion was vague → use the resolved kk-collect definition and terminal child identity; no independent ingestion or async-launch-as-success shortcut.

- Native ITC dispatcher assumed without a prerequisite → it is introduced by 0298 → add the missing 0298 dependency before implementation.

### Requirements

- [x] R1. Collected evidence can supply a selected topic; ranked candidates cite item IDs and source URLs and the selected candidate becomes the brief with a topic-scoped selection record.
- [x] R2. Empty or unavailable collections stop topic selection safely; it reports no usable topic and writes no draft or publication and releases any selection owned by this run.

### Acceptance Criteria

```gherkin
Feature: Select evidence-backed ITC topics from the collection store

  Scenario: AC1 — Collected evidence can supply a selected topic (req: R1)
    Given explicit collected-topic mode with a nonempty store pool from kk-collect
    When topic discovery runs
    Then ranked candidates cite item IDs and source URLs and the selected candidate becomes the brief with a topic-scoped selection record

  Scenario: AC2 — Empty or unavailable collections stop topic selection safely (req: R2)
    Given collected-topic mode with an empty pool or a failed explicitly requested collection refresh
    When topic discovery runs
    Then it reports no usable topic and writes no draft or publication and releases any selection owned by this run
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-15T22:49:27.914Z

- Closed: No new ingestion path, global exclusive store claim, or new selection status is introduced. Topic selection accepts an explicit chosen slot until 0301 supplies structured decisions; default workspace composition stays with 0303.
- Closed: no live accounts or paid generation are needed for acceptance; provider/model calls use deterministic fixtures.
- Deferred with owner: G9 owns actual SEO draft analysis and public-URL audit execution; G21 exports typed handoffs only.

### Design

WHAT/WHERE: add apps/cli/src/itc-topic.ts and native itc-topic-* handlers through the ITC stage dispatcher from 0298; touch commands/store.ts only for reusable existing profile resolution, not for a second ingestion engine. Source input union is exactly topic | input_file | collected topic_profile. Native helper arguments take an explicit input JSON file and intakeDir; later 0303 composes the default workspace. Expose itc-topic-extract --request <file>, itc-topic-validate --request <file>, itc-topic-select --request <file>, and itc-selection-settle --request <file> through stage run. No new root command noun.

Freeze intake artifacts under the owning parent run: topic-pool.json is validated Doc[] plus a separate topic-pool-manifest.json {schemaVersion:1,parentRunId,topicProfile,window:'24h',limit:20,extractedAt,poolDigest,collectRunId?}. Both defaults use the existing extract flags; request may set a validated positive window/limit. topic-candidates.json is {schemaVersion:1,parentRunId,poolDigest,candidates:[{id:'a'|'b'|'c',title,reason,itemIds:string[],sourceUrls:string[]}]} with 1–3 unique slots, bounded strings, nonempty known item IDs and source URLs matching the referenced Doc.sourceUri values. Model topic ideation is a workflow agent.run producer; the native validator owns membership/size/evidence checks. Invalid or empty pool fails with no draft/publication. Selection input is explicit selected candidate ID, supplied by operator initially or by 0301's decision binding; no implicit first-candidate auto pick.

Use kk store extract --topic ... --window ... --limit ... --out ... --db <resolved DB> via argv; an empty [] with exit 0 is no usable topic. An explicit refresh is a Spur-owned child kk-collect run with recorded ID, resolved installed definition and required successful terminal. A locked/skipped requested refresh is not sufficient by itself; existing pool may proceed only if the normal 24h-or-explicit-window extraction yields usable evidence. The DAG/entry owns launching/waiting, 0299 owns validating refresh evidence. Do not parse core-facts markdown as Doc[].

Write chosen-source.json {schemaVersion:1,parentRunId,topicProfile,candidateId,poolDigest,topicName,displayTitle,itemIds,selectedDocsPath}; selectedDocsPath is a confined Doc[] file. Call store select with the same parentRunId and selected subset, never the whole pool. The store proves item existence and run idempotence; no cross-workflow exclusive-selection guarantee is added. Preserve source references in brief/content metadata and transfer validated intake artifacts into the final workspace before child authoring.

Settlement precedence: successful live-intent send receipt promotes the selected subset to published; any unresolved possible effect retains selected rows with reconciliation guidance; otherwise known author-only/draft-only completion or safe failure releases only this run's selection. Never release another run's rows or published rows. Abrupt termination cannot promise cleanup; persist the selection identity so the next owned recovery/explicit operator release can reconcile. 0302 invokes this settlement helper from verified outcomes; 0303 owns workspace/date/lease policy. No new selections state/table/migration is introduced.

HANDOFF: 0301 consumes validated candidate slots and provides a bound choice; 0300 consumes topicProfile; 0302 consumes chosen-source and settlement request; 0303 moves intake data into the resolved workspace. No dependency on future default config code is required: all helpers can be tested with explicit directory/DB request inputs.

TEST OBSERVABILITY: apps/cli/tests/itc-topic.test.ts (new) proves R1/R2 with real store extraction/selection against temporary SQLite, including unknown IDs, stale candidate digest, empty count, failed/locked refresh and run-owned settlement. Extend apps/cli/tests/store-selections.test.ts only if shared selection behavior changes. Model/Spur launch is a bounded stub; store, artifact validators and CLI argv stay real.

Use ADR-040 as amended and docs/design/kk-itc-refactor.md. Native application handlers may import @gobing-ai/*; shipped plugins/kk/scripts remain builtin-only (ADR-018). No new package, dependency, engine, plugin kind, live login, crawler or image spending. Source edits and behavior tests belong to implementation, not this refine. Keep task metadata priority/estimate values unchanged. Test model/network boundaries with fixtures; never mock the parser, dispatcher or receipt validation being asserted. Step 0: verify pinned Bun and selected Spur path, installed assets and frozen upstream interfaces. Do not rely on a sibling worktree's unmerged files.

Execution budget: existing estimate 8h; one task pipeline with bounded repairs. Preserve partial work and task-run diagnostics on failure; meaningful code/test diff required when implementing. G21 dependencies remain the frozen WBS edges; this ready audit does not authorize implementation or merging tasks.

### Plan

1. (R1, R2) Define strict pool/candidate/chosen-source requests and validators with source-ID/URL binding.
2. (R1, R2) Reuse extract and run-owned select through explicit DB/directory inputs; validate requested refresh terminal evidence.
3. (R1, R2) Implement receipt-driven selection settlement and preserved reconciliation identity on abrupt/uncertain failure.
4. (R1, R2) Run temporary-store behavioral tests and publish frozen inputs for 0301/0302/0303.
5. Run changed-scope checks during iteration; use the implementation pipeline for full lint/test/build/rules, independent review and requirement verification. Preserve diagnostics and update owned surface docs.

### Solution

- `apps/cli/src/itc-topic.ts:95`: implemented `itcTopicExtract` with store profile compilation, 24h window, and `topic-pool.json` plus `topic-pool-manifest.json` generation with SHA-256 `poolDigest`.
- `apps/cli/src/itc-topic.ts:189`: implemented `itcTopicValidate` with parentRunId, poolDigest, candidate count, item ID membership in pool, and sourceUrls matching doc sourceUri.
- `apps/cli/src/itc-topic.ts:284`: implemented `itcTopicSelect` to extract the chosen candidate subset to `selected-docs.json`, write `chosen-source.json`, and record topic-scoped selection rows in SQLite.
- `apps/cli/src/itc-topic.ts:373`: implemented `itcSelectionSettle` with published promotion, uncertain reconciliation retention, and author_only/draft_only/failed selection release.
- `apps/cli/src/itc-stage.ts:25`: wired `itc-topic-extract`, `itc-topic-validate`, `itc-topic-select`, and `itc-selection-settle` stages to `runItcTopicStage`.
- `apps/cli/tests/itc-topic.test.ts:95`: verified `itcTopicExtract` against seeded store and verified empty pool and failed collection refresh handling.
- `apps/cli/tests/itc-topic.test.ts:190`: verified `itcTopicValidate` candidate slot validation.
- `apps/cli/tests/itc-topic.test.ts:343`: verified `itcTopicSelect` subset extraction and store settlement.

### Testing

- `bun test apps/cli/tests/itc-topic.test.ts`: 10 pass, 0 fail.
- `bun test apps/cli/tests/itc-plan.test.ts`: 11 pass, 0 fail.
- `bun test apps/cli/tests/itc-stages.test.ts`: 36 pass, 0 fail.
- `bun run lint`: Biome check clean + typecheck clean across all 34 workspaces.
- `bun run build`: all packages and bundles built successfully.

### Review

#### Review Report — 0299
**Scope:** Select evidence-backed ITC topics from the collection store
**Dimensions:** functional traceability, correctness, security, efficiency, usability, architecture
**Verdict:** PASS
**Confidence:** HIGH

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P3 (advisory) | architecture | Evidence-backed topic intake routes store extraction, validation, subset selection, and settlement cleanly through native ITC stages without second ingestion engine. | `apps/cli/src/itc-topic.ts:95` | RESOLVED |

### References

- Feature G21 and docs/design/kk-itc-refactor.md (ADR-040 amendment).
- Source premises: apps/cli/src/commands/store.ts:1277; apps/cli/src/commands/store.ts:1373; apps/cli/src/commands/store.ts:1462; packages/kk-store/src/profile.ts:43; plugins/kk/workflows/kk-collect.yaml:1; plugins/kk/commands/workflow-run.md:189.
- Batch audit: docs/plans/2026-10-15-g21-refineall-ready.md.

### History

- 2026-10-16T00:08:47.994Z todo → wip (system)
- 2026-10-16T00:23:56.929Z wip → testing (system)
- 2026-10-16T00:23:57.342Z testing → done (system)

