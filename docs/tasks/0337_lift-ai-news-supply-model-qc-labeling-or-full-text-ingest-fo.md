---
schema_version: 1
name: "Lift ai-news supply: model QC labeling or full-text ingest for stub items"
status: testing
template: standard
created_at: 2026-10-26T01:00:07.141Z
updated_at: "2026-11-04T03:54:10.170Z"

ac_altitude: task-local
ac_numbering: task-local
feature_id: G3
priority: P2
estimate_hours: 8
---

## 0337. Lift ai-news supply: model QC labeling or full-text ingest for stub items

### Background

This task originally proposed model labeling, full-text enrichment or a lower duration floor as interchangeable fixes for the October 25 supply shortage. The current tree does not justify selecting any of those remedies. The remaining valid issue is the absence of a reproducible, policy-correct supply diagnosis separating source volume, body depth, labels and reservations before changing production behavior.

**Refine corrections (2026-11-03)**
- Production labeling is heuristic-only → `apps/cli/src/commands/store.ts:721` always consults judgment decisions; only the four graded dimensions are skipped in default mode → drop the heuristic-only premise.
- A default decision-mode pass is the supply fix → explicit decision mode consults all eight dimensions, while 0317 deliberately pruned graded calls from the default (`apps/cli/src/commands/store.ts:728`) → drop the automatic model-pass proposal; no demonstrated downstream benefit.
- Every 45–1,105-character body must be quality 1 → `plugins/generations/episode-plan-gen/src/index.ts:398` caps bodies below 300 at 1, but sourced bodies at/above 300 can score at least 2 → correct the claim; distinguish body-length facts from effective stored labels.
- The 2-item historical pool proves persistent ingest starvation → 0338 recovery identified stale reservations; the recorded 168-hour simulation increased eligible supply from 22 to 67 stories (`docs/report/2026-11-01-daily-ai-news-recovery.md:90`) → historical counts do not prove today's 24-hour shortage; measure both windows at one explicit clock.
- Full text is uniformly absent → RSS parsing already prefers `content:encoded` (`plugins/ingestions/aihot-ingest/src/rss.ts:101`) → retain full-text enrichment only as an evidence-dependent follow-up, not this task's assumed implementation.
- Lower the 15-minute floor or guarantee more eligible news → neither is justified by the filing → explicitly exclude gate relaxation and supply guarantees.
- Empty Background/Requirements/AC/Design/Plan and no owner → prepare a bounded diagnostic implementation under G3, the existing kk-collect/store/topic-extraction owner; G33 retains decision-maker tuning and G11 retains episode planning/recovery.

The October 25 run and SQL counts are historical filing evidence, not rerun measurements. This refinement reads current code and the recovery report; it does not claim a new live-store audit. Original title is retained because the CLI has no rename surface; the concrete deliverable is now **reproducible AI-news supply diagnosis**, not a promise to lift supply.

- Initial candidate G31 → Spur rejects new links to completed features → use its existing parent G3, whose Scope explicitly owns store/labels/topic extraction; G81 is Board-only and G33 is decision-maker tuning. No completed feature is reopened.

### Requirements

- [x] R1. Provide a repository operator script `scripts/ai-news-supply-report.ts` that reads an explicitly selected existing SQLite store in readonly mode and prints one versioned JSON supply report. It must not migrate, relabel, collect, reserve/release stories or call a model/network service.
- [x] R2. At one explicit evaluation timestamp, report cumulative AI-news extraction gates for both 24h and 168h using the current profile and effective label policy: seen, category, quality, importance, moderation, reservation exclusion and extraction cap. Report item counts and distinct non-null story counts separately; missing required labels fail closed exactly as extraction does.
- [x] R3. Expose source-level and body-depth evidence plus reservation counts without confusing diagnosis with a fix: body-length buckets, missing/stale/current label distinctions, effective quality-label makers, and distinct blocked stories partitioned as published versus selected-only. Never count multiple observations/selections as multiple items or promise that all eligible items survive downstream QC or duration checks.
- [x] R4. Add subprocess fixture verification before implementation, covering policy priority/confidence/hash/replay rules, gate attrition, story reservations, both windows, extraction caps, malformed/missing inputs and read-only behavior. Produce a repeatable JSON artifact and a dated operator report stating measured findings, limitations and whether a separately scoped enrichment or labeling experiment is supported.
- [x] R5. Document exact invocation, JSON contract and interpretation. Keep runtime collection, extraction thresholds, labeling defaults, episode floor, schedules and installed package untouched. No new dependencies, database schema or public kk verb; this task implements the diagnostic only.

### Acceptance Criteria

```gherkin
Scenario: AC1 — supply inspection preserves the store (req: R1)
  Given an existing fixture SQLite store and explicit report inputs
  When the report script runs in a subprocess
  Then it exits 0 with one parseable JSON document and no model or network invocation
  And the closed fixture database bytes and schema remain unchanged
  And a missing database fails without creating it

Scenario: AC2 — the gate ladder matches extraction semantics (req: R2)
  Given fixture items spanning both windows and each profile rejection reason
  And a pinned timestamp, profile and effective label policy
  When the report is generated twice with identical inputs
  Then the JSON is identical and every cumulative gate has the expected item and distinct-story counts
  And the final capped item ids equal ItemsDao.selectByProfile for those same inputs
  And missing required labels exclude items and the profile limit is not mistaken for total eligible supply

Scenario: AC3 — current labels and reservations are diagnosed without double counting (req: R3)
  Given competing makers, stale hashes, replay observations, missing labels and shared-story items
  And selected, published and dropped reservations across multiple runs and topics
  When the report is generated
  Then the effective answers follow labelsCurrentSql and configured confidence/maker policy
  And published stories and selected-only stories are disjoint and dropped or other-topic rows do not exclude AI news
  And source/body-depth distributions count items once and do not equate length with a model quality judgment

Scenario: AC4 — diagnostic evidence is repeatable and failures are explicit (req: R4)
  Given the documented fixture command and report artifact location
  When the subprocess verification runs
  Then the artifact contains the measured gate counts and named checks with passing results
  And invalid timestamp, config, profile, unavailable schema or inaccessible database exits nonzero with an actionable error
  And the dated operator report distinguishes fixture results from any separately performed live read

Scenario: AC5 — the handoff preserves production policy (req: R5)
  Given the completed diagnostic change
  When its diff and documentation are reviewed
  Then only the diagnostic script, its fixture checks and documentation implement the task
  And no workflow, production config, gate threshold, label default or installed runtime is changed
  And any proposed enrichment experiment has measured rationale and requires a separate task
```

### Q&A

Closed scope decision: prepare the evidence-led supply audit as the smallest justified implementation. Full-text enrichment, default decision-mode scoring and lowering the episode floor are not equivalent solutions; none is authorized implementation in this refinement. The audit is useful even when it finds sufficient supply and recommends no change. A following agent implements only this diagnostic and reports its evidence; any remedy is a separate scoped task.

Closed owner decision: G3 covers collection, stored labels and topic extraction. G33 owns decision-maker experiments; G11 owns daily-episode planning and recovery. No new feature is needed. Use task-local AC because these diagnostic regressions are narrower than G3's original ship scenarios.

Closed historical evidence decision: October 25 counts are not current live measurements; the later 22→67 recovery result is a 168h observation with its own explicit timing. Neither proves today's 24h shortage. No live run, relabeling, reservation release, external call, deployment or workflow edit is part of refinement.

### Design

Chosen deliverable: a read-only repository operator script, following `scripts/decision-signal-report.ts:203` for native Bun SQLite readonly access. G3 is the owning feature because its goal covers collected items, labels and topic extraction. G33/0317 owns decision-maker experiments; G11/0338 owns daily cache and failed-run recovery. Neither is reimplemented here. No dependency on 0336: it is cancelled as superseded; 0338 and 0317 are already done context, not pending prerequisites.

Frozen invocation: `bun scripts/ai-news-supply-report.ts --db <existing-path> --config <existing-kk-config> --profile plugins/kk/decisions/extract/ai-news.yaml --at <ISO-8601-with-offset>`; all four flags required, unknown/duplicate flags fail. Topic fixed to ai-news; reject another topic. Output is JSON only on stdout; diagnostics on stderr; failures exit nonzero without partial JSON. No live default path or clock. Resolve/read config once via exported `readStoreConfig`; print only the resolved label policy, never the full config. Parse profile with existing `parseProfile`. No new public kk API or dependency.

Targets: new `scripts/ai-news-supply-report.ts`, failure-first subprocess checks in `scripts/tests/ai-news-supply-report.test.ts`, and `docs/report/2026-11-03-ai-news-supply-readiness.md` (final report may use actual execution date). Update `docs/04_DESIGN.md` with the diagnostic invocation/contract when the script ships, per T3. Prefer exported `@gobing-ai/kk-store` types, `compileProfile`, `labelsCurrentSql`, `readStoreConfig` and `parseProfile`; no sibling-package deep imports or copied label-resolution logic. Use native `bun:sqlite` as the existing report does, rather than opening a writer/migrator. Read both windows inside one readonly read transaction; close/rollback in finally. Reject absent required schema; never run migrations.

Algorithm: pin `now=Date.parse(at)` once. For 24h and 168h use the same lower-bound-only `first_seen_at >= now-windowMs` predicate as current extraction (do not silently invent an upper bound). Build the cumulative ladder in fixed order: all window items → category → quality → importance → china-politics → topic/story reservation exclusion → cap/order. Validate that the supplied profile contains the current four predicate ids; apply its actual values, not hardcoded thresholds. Unknown/additional predicates fail with a profile-contract diagnostic rather than yielding incomplete counts. Prefixes use current-label CTE joins and parameterized profile predicates; the complete ordered/capped query must match the current DAO on fixture inputs. The uncapped eligible set is counted without applying SQL LIMIT; only the last stage applies the configured profile limit (default is parseProfile's existing default). Missing decision rows reject at their owning gate. Item count is COUNT DISTINCT id; distinct-story count excludes NULL story_id, with a separate null-story item count. Do not infer one from the other or collapse actual capped item results to one item per story unless production extraction does so.

JSON version 1: top-level `version`, `at`, `dbPath`, `profilePath`, `profile` (parsed predicates/order/limit), `labelPolicy`, `windows`, `limitations`. Each window has `hours`, `since`, `gates` (stable stage name, items, stories, nullStoryItems, removedItems), `cappedItemIds`, `sources`, `labelCoverage`, `blockedStories`. Sources partition the window by stored source, with body buckets `<300`, `300..1499`, `>=1500` based on the planner's trimmed UTF-16 body-length measure, and quality-label maker distributions. Label coverage counts each required dimension as current, stale-only or missing: current follows the shared CTE, stale-only means observations exist but none match current content_hash, and missing covers no current answer for all other reasons (including current-hash rows rejected by policy); document these precise meanings. For fully profile-eligible items before reservation exclusion, blockedStories has disjoint `published` and `selectedOnly` story counts: published wins when both exist; selectedOnly has selected and no published. Ignore dropped and other topics. All arrays and map keys sort deterministically. Do not emit item bodies, titles, credentials or full config.

Rejected alternatives: default decision-mode labeling adds graded model calls that 0317 removed without a proven supply benefit; body-length padding or fabricated q2 labels defeats quality; lower episode floor changes policy; arbitrary full-page crawling introduces a new extraction/reliability scope before evidence; releasing live reservations belongs to explicit recovery authorization. The report may recommend a later task, but it cannot execute a remedy or assert that a 168h pool proves adequate 24h episode duration. No workflow/config/installed-package edits, scheduler changes or publication.

Concurrency audit on 2026-11-03: no wip tasks returned by Spur; worktrees were the main checkout and detached `/private/tmp/wk-cf356e3`. No source changes are made in this refinement. Future implementer rechecks overlapping work before touching the named files.

### Plan

- [x] Step 1 (R1–R5): Recheck task ownership, Git changes and concurrent work; read the named store exports/DAO and 0317/0338 evidence. Confirm no live policy or activation changes are needed.
- [x] Step 2 (R4): Before writing implementation, enumerate failures and build subprocess fixtures for gate rejection, current-label maker/confidence/hash/replay semantics, multiple observations, shared stories, cross-topic/dropped reservations, exact window boundaries, null stories, cap/order, invalid inputs and missing schema. Use a disposable real SQLite database and fixture config/profile; no live network/models. Fixtures assert parity with the exported DAO using identical inputs.
- [x] Step 3 (R1–R3): Implement the frozen report flags and deterministic JSON, readonly transaction, shared current-label CTE, cumulative profile ladder, source/body and reservation breakdowns; reject unsupported profile shapes explicitly.
- [x] Step 4 (R4): Run the subprocess checks; verify closed fixture DB bytes/schema unchanged, absent DB not created, nonzero failures, deterministic output and DAO item-id parity. Preserve the machine-readable result at `.spur/run/0337-supply-fixture.json` with the exact repeat command.
- [x] Step 5 (R4–R5): Write the dated operator report and update docs/04 surface documentation. A read of the explicitly named live store/config is permitted only as a read-only audit; if unavailable, report fixture-only evidence, no inferred current shortage. Record 24h and 168h measurements separately and recommend or reject enrichment/model experiments from observed attrition, with no automatic follow-up implementation.
- [ ] Step 6 (R1–R5): Run `bun run lint`, `bun run test`, `bun run build` and pre-/post-check rule presets via the project gate. Review the diff for unintended policy/runtime/corpus changes, then obtain a real task verify PASS through the harness. Keep pre-existing failures separate; do not weaken coverage or assertions.

### Root Cause

Original shortage diagnosis was incomplete: it conflated body quality, model routing and reserved supply. The remaining defect is an unrepeatable, policy-ambiguous diagnosis, addressed by the read-only gate report in Design. This is not evidence that today's supply is insufficient or that adding model calls will increase it.

### Solution

| File | What changed and why |
| --- | --- |
| `scripts/ai-news-supply-report.ts:426-468` | Add the frozen four-flag, JSON-only, native-readonly supply report with one rolled-back read transaction. |
| `scripts/ai-news-supply-report.ts:128-140` | Fail closed on malformed/non-mapping YAML before the shared config reader can apply its normal-operation defaults; this is the AC4 remediation. |
| `scripts/ai-news-supply-report.ts:216-404` | Reuse the shared labelsCurrent CTE and profile compiler for cumulative 24h/168h gates, capped ordering, source/body, label-coverage and reservation evidence. |
| `scripts/tests/ai-news-supply-report.test.ts:294-449` | Add failure-first subprocess fixtures for store preservation, deterministic gate counts, label/replay policy, reservations, boundaries, DAO parity and actionable failures, including malformed YAML; emit `.spur/run/0337-supply-fixture.json`. |
| `docs/04_DESIGN.md:969-992` | Document the diagnostic invocation, version-1 JSON contract and non-interpretations without adding a public kk verb. |
| `docs/report/2026-11-04-ai-news-supply-readiness.md:27` | Record measured fixture attrition separately for 24h/168h, state fixture-only limits and reject an unsupported live remedy experiment. |

**Focused evidence**

- `bun test scripts/tests/ai-news-supply-report.test.ts` → `2 pass`, `0 fail`, `70 expect() calls`; the single-file command exits 1 only because Bun enforces per-file coverage on loaded store modules.
- `spur task gate 0337 light` → changed-file format/lint PASS and all 58 pre-check rules PASS; post-check reports only the partial coverage tracefile produced by that single-file run. The pipeline's full gate remains authoritative.
- Public-surface probe: both tests spawn `bun scripts/ai-news-supply-report.ts` against disposable fixture roots and assert exact stdout/stderr/exit behavior. No live store read or production policy/runtime change was made.

### Testing

**Pipeline verify results**

- Verdict: PARTIAL (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `scripts/ai-news-supply-report.ts:447-471` uses native readonly access and closes the store; `scripts/tests/ai-news-supply-report.test.ts:295-311` verifies unchanged bytes/schema and missing-db behavior. |
| R2 | MET | `scripts/ai-news-supply-report.ts:373-419` builds both cumulative windows; `scripts/tests/ai-news-supply-report.test.ts:312-367` checks gate counts, caps and DAO parity. |
| R3 | MET | `scripts/ai-news-supply-report.ts:246-367` implements source/body, label-coverage and disjoint reservation evidence; `scripts/tests/ai-news-supply-report.test.ts:334-353` asserts distributions and counts. |
| R4 | MET | `scripts/ai-news-supply-report.ts:128-140` rejects malformed/non-mapping config; `scripts/tests/ai-news-supply-report.test.ts:395-451` covers repeatable artifacts, malformed/missing inputs and schema failures. Full `spur self exec check`: 4423 pass / 0 fail. |
| R5 | MET | `docs/04_DESIGN.md:969-992` and `docs/report/2026-11-04-ai-news-supply-readiness.md:1-51` document invocation, contract and limits; `git status --short` contains no production policy/runtime/install change. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: AC1 — supply inspection preserves the store (req: R1) | MET | test | `scripts/tests/ai-news-supply-report.test.ts:295-311` verifies parseable JSON and unchanged bytes/schema; `:395-415` verifies missing-db failure without creation. |
| Scenario: AC2 — the gate ladder matches extraction semantics (req: R2) | MET | test | `scripts/tests/ai-news-supply-report.test.ts:312-367` verifies deterministic cumulative gates and capped-id parity with `ItemsDao.selectByProfile`. |
| Scenario: AC3 — current labels and reservations are diagnosed without double counting (req: R3) | MET | test | `scripts/tests/ai-news-supply-report.test.ts:334-353` checks label coverage, source/body distributions, disjoint blocked stories and capped ids. |
| Scenario: AC4 — diagnostic evidence is repeatable and failures are explicit (req: R4) | MET | test | `scripts/tests/ai-news-supply-report.test.ts:395-451` verifies the repeatable artifact and nonzero failures; `:420-425` specifically rejects malformed YAML config with no stdout. Full `spur self exec check`: 4423 pass / 0 fail. |
| Scenario: AC5 — the handoff preserves production policy (req: R5) | MET | command | `git status --short` lists only the diagnostic script, fixture tests, `docs/04_DESIGN.md:969`, `docs/report/2026-11-04-ai-news-supply-readiness.md:1`, and task 0337; no runtime/config/workflow/install change is present. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P2 | Correctness | `scripts/ai-news-supply-report.ts:425` | Malformed YAML config is accepted with defaults: the 2026-11-04 subprocess probe exited 0 and emitted 5,302 JSON bytes, violating R4/AC4's invalid-input contract. Add explicit config-syntax validation and a malformed-config subprocess regression. |

Confidence: LOW

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `scripts/ai-news-supply-report.ts:434-459` uses native readonly access and closes the store; `scripts/tests/ai-news-supply-report.test.ts:295-311` verifies unchanged bytes/schema. |
| R2 | MET | `scripts/ai-news-supply-report.ts:361-407` builds both cumulative windows; `scripts/tests/ai-news-supply-report.test.ts:312-367` checks gate counts, caps and `ItemsDao.selectByProfile` parity. |
| R3 | MET | `scripts/ai-news-supply-report.ts:234-355` implements source/body, label-coverage and disjoint reservation evidence; `scripts/tests/ai-news-supply-report.test.ts:334-353` asserts the distributions and counts. |
| R4 | PARTIAL | `scripts/tests/ai-news-supply-report.test.ts:395-445` covers repeatable artifacts and many failures, but the malformed-config probe exited 0 with JSON output instead of nonzero. |
| R5 | MET | `docs/04_DESIGN.md:969-992` and `docs/report/2026-11-04-ai-news-supply-readiness.md:1-51` document the diagnostic and limits; `git status --short` shows only the diagnostic, tests, docs and task 0337. |

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| Scenario: AC1 — supply inspection preserves the store (req: R1) | MET | test | `scripts/tests/ai-news-supply-report.test.ts:295-311` verifies parseable JSON, unchanged bytes/schema; `:395-415` verifies missing-db failure without creation. |
| Scenario: AC2 — the gate ladder matches extraction semantics (req: R2) | MET | test | `scripts/tests/ai-news-supply-report.test.ts:312-367` verifies deterministic cumulative gates and capped-id parity with `ItemsDao.selectByProfile`. |
| Scenario: AC3 — current labels and reservations are diagnosed without double counting (req: R3) | MET | test | `scripts/tests/ai-news-supply-report.test.ts:334-353` checks label coverage, source/body distributions, disjoint blocked stories and capped ids. |
| Scenario: AC4 — diagnostic evidence is repeatable and failures are explicit (req: R4) | PARTIAL | command | Repeatable fixture artifact exists at `.spur/run/0337-supply-fixture.json`; however `bun scripts/ai-news-supply-report.ts` with malformed `store: [` config exited 0 and emitted 5,302 stdout bytes on 2026-11-04. |
| Scenario: AC5 — the handoff preserves production policy (req: R5) | MET | command+static-ref | `git status --short` lists only the diagnostic script, fixture tests, `docs/04_DESIGN.md:969`, `docs/report/2026-11-04-ai-news-supply-readiness.md:1`, and task 0337; no runtime/config/workflow/install change is present. |

Verdict: PARTIAL

### References

- Owner: G3, kk-collect/store/labels/topic extraction; completed G31 is historical implementation context; ADR-030 and its G32 amendment at docs/00_ADR.md:1193.
- 0317 / G33: default graded-call pruning; apps/cli/src/commands/store.ts:728. Explicit decision mode remains available for experiments.
- 0338 / G11: completed recovery and cache fixes; docs/tasks/0338_restore-unattended-scheduled-daily-ai-news-generation-and-de.md:200.
- Measured reservation recovery: docs/report/2026-11-01-daily-ai-news-recovery.md:90; original supply-summary JSON is disposable evidence under .works/tmp/test-daily-recovery/probes/.
- Profile/selection semantics: plugins/kk/decisions/extract/ai-news.yaml:14; packages/kk-store/src/dao/items.ts:451; packages/kk-store/src/dao/labels.ts:51; packages/kk-store/src/profile.ts:237.
- Existing report precedent: scripts/decision-signal-report.ts:203. Planner quality rubric: plugins/generations/episode-plan-gen/src/index.ts:398.
- Readiness audit only on 2026-11-03: no production implementation, database mutation or delegation; no pending dependency on cancelled 0336.

### History

- 2026-11-03T18:06:29.472Z backlog → todo (system)
- 2026-11-04T03:00:55.137Z todo → wip (system)
- 2026-11-04T03:37:06.209Z wip → testing (system)

### Notes

Implement-ready audit (2026-11-03):

| Checklist | Result | Evidence |
| --- | --- | --- |
| requirements | PASS | R1–R5 define observable diagnostic outcomes and explicit non-goals. |
| design | PASS | Design freezes script/flags/output, label precedence, gate algorithm, readonly boundary and owned files. |
| plan | PASS | Six ordered steps map to requirements and require failure-first subprocess checks plus a repeatable artifact. |
| ac | PASS | AC1–AC5 bind R1–R5 using task-local scenarios; todo precheck passes. |
| decisions | PASS | Q&A closes audit-first scope and feature G3 ownership; original speculative remedies dropped. |
| dependencies | PASS | No pending dependencies; 0317/0338 are completed context and 0336 is cancelled. |
| premises | PASS | Current source/feature/worktree evidence audited; historical/live evidence limits explicit in Background. |

Only task/feature corpus is changed during refinement. No implementation, live-store audit, runtime activation or delegation was performed. The future diagnostic's own verify PASS remains required after implementation; this readiness record is not an implementation verdict. Spur retains an advisory that the pre-existing Root Cause heading is outside the standard template. The current CLI has no section-delete verb; do not direct-write corpus files to conceal the warning.

