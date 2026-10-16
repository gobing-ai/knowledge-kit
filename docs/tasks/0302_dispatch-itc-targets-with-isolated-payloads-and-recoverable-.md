---
schema_version: 1
name: Dispatch ITC targets with isolated payloads and recoverable receipts
status: done
template: feature-impl
created_at: 2026-10-15T21:59:21.906Z
updated_at: "2026-10-16T07:02:04.494Z"
ac_altitude: task-local
ac_numbering: task-local
feature_id: G21
priority: P2
tags:
  - kk-itc
  - G21
estimate_hours: 12

dependencies: ["0298", "0300", "0301"]
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0302-verdict.json
---

## 0302. Dispatch ITC targets with isolated payloads and recoverable receipts

### Background

The current ITC tail splits script-capable channels into a browser agent cursor, merges per-target switches into shared variants, and accepts weak report evidence. Refactor the root into a DAG and preserve publication outcomes through identity-bound receipts.

Implements feature G21 scenarios: R7 — Session recovery stays with bots and channel probes; R8 — Publication dispatch isolates targets and reuses fan-out; R9 — Runtime outcomes require valid current artifacts; R10 — Recovery preserves success and refuses uncertain repeats; R11 — Reports reconcile every expected target.
Also implements G21 R13 — DAG branches require verified predecessor completion.
Also implements G21 R16 — SEO handoff remains independent of an unfinished provider.

Current-tree premises: plugins/kk/scripts/itc-stages.ts:130; plugins/kk/scripts/itc-stages.ts:425; apps/cli/src/fanout.ts:94; apps/cli/src/fanout.ts:193; apps/cli/src/commands/bot.ts:71; packages/kk-core/src/schemas.ts:43; plugins/kk/workflows/kk-daily-ai-voice2.yaml:493. These claims were checked against source, not inferred from old status or scratch reports.

Every mapped issue remains valid; no requirement/scenario is dropped or renumbered. Config/workspace code is owned by 0303, child authoring by 0301, root DAG/publication by 0302, capabilities by 0298, topic/store intake by 0299 and presets by 0300.

Concurrency: main-tree wip task query was empty at kickoff. Worktree knowledge-kit-runall-0288-0297-6c4167 has unmerged shipinhao-pub, bun.lock and task0296 changes. No confirmed same-file source overlap is present, but do not enumerate its unpublished plugin or consume its lockfile; recheck source ownership before execution.



**Refine corrections (2026-10-15)**
- Aggregate status published implied live publication → fan-out uses published for any successful Result, including drafts → bind mode separately and never infer a live page from status alone.
- Result.target equaled plugin selector → plugins use channel names while aggregates use requested plugin names → reconcile plugin identities from aggregate/receipt, preserving inner channel identity separately.
- Safe failures could already be retried from all prior failure rows → selectRetryTargets selects every failed row and drops uncertainty distinctions → classify conservatively and pass only the explicit safe subset to --retry-from.
- Uncertain/effect metadata survived failures → dispatchOne currently drops failed Result.metadata → preserve validated failure metadata at that shared seam if structured delivery evidence is used; test the real carry-forward path.
- Shared variant metadata and browser cursor were sufficient → target-specific bindings and global serialization are required → emit isolated payload groups and replace the cursor with executor dispatch.
- SEO URL handoff could trust any successful URL → Zenn can compose a URL and draft saves also return URLs → export only explicitly verified public URL evidence; otherwise mark not-assessed.

### Requirements

- [x] R1. Session recovery stays with bots and channel probes; the plugin probe refuses the send and reports operator-directed kk bot recovery without treating cached state as authenticated or automating login.
- [x] R2. Publication dispatch isolates targets and reuses fan-out; each target receives its own validated payload through executor fan-out and shared browser profiles are serialized without leaking another target metadata.
- [x] R3. Runtime outcomes require valid current artifacts; it refuses success and preserves diagnostic evidence while explicit dry-run behavior remains isolated.
- [x] R4. Recovery preserves success and refuses uncertain repeats; it retains the successful receipt, retries only the safe failure within the budget and requires reconciliation for the uncertain target.
- [x] R5. Reports reconcile every expected target; it reports a contract failure with expected and observed targets and never claims complete publication.
- [x] R6. DAG branches require verified predecessor completion; publishing waits for validated child completion, optional skips still allow a run report, and cancellation stops the owned child.
- [x] R7. SEO handoff remains independent of an unfinished provider; it exports versioned content-bound evidence and records not-assessed while authoring continues and only confirmed public URLs enter the later URL-audit handoff.

### Acceptance Criteria

```gherkin
Feature: Dispatch ITC targets with isolated payloads and recoverable receipts

  Scenario: AC1 — Session recovery stays with bots and channel probes (req: R1)
    Given a browser publication target with a cached bot and an expired or challenged session
    When publication readiness is checked
    Then the plugin probe refuses the send and reports operator-directed kk bot recovery without treating cached state as authenticated or automating login

  Scenario: AC2 — Publication dispatch isolates targets and reuses fan-out (req: R2)
    Given compatible file and script targets sharing an adapted variant with different mode metadata
    When the frozen plan is dispatched
    Then each target receives its own validated payload through executor fan-out and shared browser profiles are serialized without leaking another target metadata

  Scenario: AC3 — Runtime outcomes require valid current artifacts (req: R3)
    Given a runtime judge or report artifact that is absent, malformed or belongs to different inputs
    When the workflow evaluates completion
    Then it refuses success and preserves diagnostic evidence while explicit dry-run behavior remains isolated

  Scenario: AC4 — Recovery preserves success and refuses uncertain repeats (req: R4)
    Given a plan with one confirmed success, one repeat-safe failure and one uncertain remote outcome
    When publication recovery runs
    Then it retains the successful receipt, retries only the safe failure within the budget and requires reconciliation for the uncertain target

  Scenario: AC5 — Reports reconcile every expected target (req: R5)
    Given a frozen plan whose result aggregate omits, duplicates or adds a target or contains stale evidence
    When the run report is produced
    Then it reports a contract failure with expected and observed targets and never claims complete publication
  Scenario: AC6 — DAG branches require verified predecessor completion (req: R6)
    Given a DAG with optional branches and a paused or failed authoring child
    When dependent work is scheduled
    Then publishing waits for validated child completion, optional skips still allow a run report, and cancellation stops the owned child

  Scenario: AC7 — SEO handoff remains independent of an unfinished provider (req: R7)
    Given SEO handoff mode and a reviewed draft without a shipped draft-capable SEO adapter
    When the SEO branch runs
    Then it exports versioned content-bound evidence and records not-assessed while authoring continues and only confirmed public URLs enter the later URL-audit handoff

```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-15T22:49:48.745Z

- Closed: Default failed-send classification is uncertain. Generic aggregate published means successful invocation, not live visibility. Preserve plugin-owned evidence; do not add remote inference or automatic SEO networking.
- Closed: no live accounts or paid generation are needed for acceptance; provider/model calls use deterministic fixtures.
- Deferred with owner: G9 owns actual SEO draft analysis and public-URL audit execution; G21 exports typed handoffs only.

### Design

WHAT/WHERE: replace plugins/kk/workflows/kk-itc.yaml with a version-2 DAG; use 0301's kk-itc-author child and 0298/0300's typed plan. Keep per-target dispatch inside executor fan-out. Implement receipt/summary stages in apps/cli/src/itc-publish.ts via the native ITC dispatcher; filesystem-only legacy helpers in plugins/kk/scripts may remain where ADR-018 permits. Preserve explicit work_dir/legacy vars input so this graph runs before 0303 switches the default config entry. No import of 0303's future resolver and no stub config stage are allowed.

Graph nodes are topic intake, prepare/research, child launch, interactive authoring barrier, verify-child/freeze, illustration and SEO branches, materialize/plan/adapt, send confirmation, fan-out/recovery, reconcile/selection-settle and report. Final report depends on mandatory freeze plus optional branches so all-skipped publication still reports. Each node has one action and file-bound dependencies. Paused/failed child statuses are distinct; the parent resumes only after author-complete.json passes 0301's contract. Derive parent/child IDs before launch and query/continue the same child after interruptions. Only pure/idempotent/checkpointed nodes get resumeRerun; sends require validated per-target receipt reconciliation before any replay. Propagate cancellation through owned synchronous child processes using the existing spawn lifecycle, preserve partial evidence and never promise cleanup after SIGKILL. Existing global revision counters move into the child's run-bound ownership, not parent-concurrent writes.

Freeze publish-plan.json schemaVersion 1 with sourceContentDigest,configDigest?,planDigest,capabilityDigest,live,sourceLocale,preset origin,variants,fanout,browser:[],targets. A target row is {plugin,profile,variant,payloadPath,mode:'draft'|'live',browserResourceKey?,capabilityDigest,resultPath}. Paths are safe workspace-relative files. Digests use SHA-256 over canonical recursively-key-sorted JSON excluding timestamps/own digest. Share editorial variants only; clear each profile's mode-key union and stale generic send keys, then stamp its complete selected metadata map into a distinct target payload. Groups share a payload only when its canonical content digest is equal; otherwise use single-target groups. Process groups sequentially and apply existing --serial-target for browser targets, ensuring shared resources cannot overlap across groups. This preserves correctness without a new executor payload API.

Before sending, call the channel's existing plugin check when declared and propagate its refused/challenged guidance to operator-directed kk bot open/login; cached bots never establish readiness. Do not double-probe channels solely because both manifest and plugin have a preflight. Preserve live launch intent plus operator send confirmation; auto authoring only permits explicitly intended drafts. Exact target reconciliation uses executor aggregate target plugin names, not Result.target channel labels. Keep raw Result channel identity for diagnostics. Validate exactly one receipt per expected plugin/profile and refuse missing, extra, duplicate, stale or mismatched rows.

Receipt v1 under 4-publish/receipts/<plugin>.json is {schemaVersion:1,parentRunId,planDigest,payloadDigest,plugin,profile,mode,attemptId,status:'succeeded'|'failed'|'uncertain',effect:'none'|'confirmed'|'unknown',resultDigest?,aggregatePath,publicUrlVerified?:boolean}. Success means a valid invocation Result; mode stays explicit. A URL alone or aggregate status published does not prove a live public page. Failed invocation/timeout/crash defaults to effect unknown. Only native pre-dispatch proof or a validated plugin-owned Result.metadata.itcDelivery {schemaVersion:1,effect:'none'|'confirmed'|'unknown',publicUrlVerified?:boolean} may strengthen that observation. If used, preserve failed Result.metadata in fanout.dispatchOne (schema already permits metadata) and verify both failure and retry carry-forward in fanout.test.ts; do not parse human error strings as effect evidence. Existing publishers need not fabricate new evidence; absent evidence stays unknown. Confirmed successes never resend. Retry at most once, selecting only explicit effect-none failures through --target plus --retry-from; preserve omitted failures/uncertain rows. Do not broaden selectRetryTargets globally.

Invoke 0299's selection settlement with the selected subset and strongest known outcome: successful live-intent receipt promotes, uncertain-only retains, safe author/draft-only completion releases. SEO mode off|handoff uses strict SeoDraftRequest v1 at seo/prepublish-request.json and SeoPublishedPages v1 at seo/published-pages.json. Reserve their documented content/locale/source/receipt binding; no G9 runtime dependency, audit call or content edit. Only live-mode, effect-confirmed, publicUrlVerified evidence enters the URL list; otherwise list is empty with not-assessed reason. New draft content invalidates review/plan/adaptation receipts. Keep old report.json outcome/verdict/revisions fields while adding exact target receipt/availability summaries.

TEST OBSERVABILITY: apps/cli/tests/itc-publish.test.ts (new) and kk-itc-publish-tail.test.ts prove R1–R5 with real planner/payload writer/executor over temporary fixture plugins, including Qiita conflicting flags, draft success, differing channel/plugin names, safe-subset retry and failure-metadata round-trip. apps/cli/tests/kk-itc-dag.test.ts (new) runs real Spur in an isolated database for R6: repeated child pauses, optional skips, premature continuation, cancellation and interrupted replay. Model actions produce fixtures; engine/spawn/receipt validators stay real. The SEO section of itc-publish.test.ts proves R7 packet identities, unavailable-provider nonblocking behavior and exclusion of draft/composed-but-unverified URLs. The earlier marker probe is supporting evidence only, not replacement coverage.

Use ADR-040 as amended and docs/design/kk-itc-refactor.md. Native application handlers may import @gobing-ai/*; shipped plugins/kk/scripts remain builtin-only (ADR-018). No new package, dependency, engine, plugin kind, live login, crawler or image spending. Source edits and behavior tests belong to implementation, not this refine. Keep task metadata priority/estimate values unchanged. Test model/network boundaries with fixtures; never mock the parser, dispatcher or receipt validation being asserted. Step 0: verify pinned Bun and selected Spur path, installed assets and frozen upstream interfaces. Do not rely on a sibling worktree's unmerged files.

Execution budget: existing estimate 12h; one task pipeline with bounded repairs. Preserve partial work and task-run diagnostics on failure; meaningful code/test diff required when implementing. G21 dependencies remain the frozen WBS edges; this ready audit does not authorize implementation or merging tasks.

### Plan

1. (R6) Build the DAG around the real child receipt and explicit legacy work_dir inputs; freeze skip/join/replay/cancellation behavior.
2. (R1, R2) Write isolated target payloads, use existing plugin probes/executor serialization and preserve send intent.
3. (R3, R4, R5) Validate receipts and exact targets, retain failure metadata where needed and retry only a proven safe subset.
4. (R7) Export bounded SEO evidence and verified-public-URL handoffs without invoking G9 or mutating drafts.
5. (R1–R7) Run real executor/fake-plugin and isolated-Spur tests, including unknown effects and preserved partial evidence; integrate 0299 settlement.
6. Run changed-scope checks during iteration; use the implementation pipeline for full lint/test/build/rules, independent review and requirement verification. Preserve diagnostics and update owned surface docs.

### Solution

- `plugins/kk/workflows/kk-itc.yaml:3`: replaced the single FSM with a version-2 `kind: dag` whose nodes are topic intake, prepare, child launch (`kk-itc-author`), verify-child-freeze, optional illustrate branch (gated by a node `condition` on the spend vars), materialize-plan, adapt (kk:article-adapt) + adapt-verify, check-targets, send-confirm, fanout-send, fanout-recovery, reconcile-settle, seo and report. `report` depends on `verify-child-freeze` so an all-skipped publication subtree still reports.
- `apps/cli/src/itc-publish.ts:73`: `itcMaterializePlan` materializes `4-publish/content.json` and resolves the plan via 0300's `resolveItcTargets`, then writes one isolated payload per target (`4-publish/content.<plugin>.json`) with the profile mode-key union and stale generic send keys cleared before the target's complete metadata map is stamped.
- `apps/cli/src/itc-publish.ts:233`: `itcCheckTargets` runs each declared plugin `check` probe before any send and names the operator-directed `kk bot open/login <profileName>` remedy without treating a cached bot as authenticated.
- `apps/cli/src/itc-publish.ts:273`: `itcSendTargets` dispatches each target through the existing `runFanout` (browser targets serialized via `--serial-target`) and writes `4-publish/receipts/<plugin>.json` validated by `ItcReceiptSchema`. In `--retry` mode only `effect: none` failures are re-sent; confirmed successes and uncertain rows are left untouched.
- `apps/cli/src/itc-publish.ts:411`: `itcReconcileReceipts` refuses a missing/corrupt receipt for any expected target and settles 0299's selection with the strongest known outcome (confirmed live-intent promotes, uncertain retains, author/draft-only or failure releases).
- `apps/cli/src/itc-publish.ts:479`: `itcExportSeo` writes `seo/prepublish-request.json` and `seo/published-pages.json`; only live-mode, `effect: confirmed`, `publicUrlVerified` receipts enter the URL list; otherwise the list is empty with a `not-assessed` reason.
- `apps/cli/src/itc-publish.ts:540`: `itcReportSummary` keeps the legacy `outcome`/`verdict`/`revisions` fields and adds the per-target receipt summary.
- `apps/cli/src/itc-publish.ts:623`: `itcAuthorVerdict` collapses the judge verdict plus revision counters into one `finish|revise|autorevise|fail` word so every judge guard stays a single predicate (ADR-115).
- `apps/cli/src/itc-stage.ts:30`: routed `itc-materialize-plan`, `itc-check-targets`, `itc-send-targets`, `itc-reconcile-receipts`, `itc-export-seo`, `itc-report-summary` and `itc-author-verdict` through the native dispatcher.
- `apps/cli/src/fanout.ts:118`: preserved `Result.metadata` on the failed branch of `dispatchOne` so structured `itcDelivery` evidence survives a failure instead of being dropped.
- `apps/cli/tests/itc-publish.test.ts:24`: proves isolated target payloads have their mode-key union cleared before the target metadata map is stamped.
- `apps/cli/tests/itc-publish.test.ts:85`: proves a valid receipt is written for a successful dispatch and that safe-subset retry leaves confirmed successes and uncertain rows untouched.
- `apps/cli/tests/itc-publish.test.ts:228`: proves a missing receipt for an expected target is refused.
- `apps/cli/tests/itc-publish.test.ts:248`: proves SEO handoff exports only live-mode, confirmed, `publicUrlVerified` URLs and records `not-assessed` otherwise.
- `apps/cli/tests/itc-publish.test.ts:301`: proves the run report keeps its legacy outcome verdict and revision fields beside the per-target receipt summary.
- `apps/cli/tests/kk-itc-dag.test.ts:10`: proves the `kind: dag` shape, node ids and topological declaration order of `plugins/kk/workflows/kk-itc.yaml`.
- `apps/cli/tests/fanout.test.ts:255`: proves failed-`Result` metadata round-trips into the target outcome.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `itcCheckTargets` (`apps/cli/src/itc-publish.ts:316`) runs each plugin's `check` probe and on failure refuses with a `kk bot open/login` hint without automating login. |
| R2 | MET | Per-target isolated payloads with mode keys cleared (`apps/cli/src/itc-publish.ts:252`) dispatched through `runFanout`; browser targets serialized (`apps/cli/src/itc-publish.ts:361`). |
| R3 | MET | Author child fails closed on an absent/out-of-contract disposition (`plugins/kk/workflows/kk-itc-author.yaml`; `plugins/kk/tests/verdict-confidence.test.ts:296`); `itcAuthorVerdict` (`apps/cli/src/itc-publish.ts:741`) dispositions tested at `apps/cli/tests/itc-publish.test.ts:720`. |
| R4 | MET | Retry skips confirmed successes and non-`none` effects and writes its own retry aggregate (`apps/cli/src/itc-publish.ts:361`). |
| R5 | MET | `itcReportSummary` (`apps/cli/src/itc-publish.ts:637`) emits `targetContractFailure {expected, observed, stale}` and never reports complete publication on a mismatch; receipts carry the real `parentRunId` from the snapshot (`apps/cli/src/itc-publish.ts:379-380`). |
| R6 | MET | `report` depends on `verify-child-freeze`, `reconcile-settle`, `seo` (`plugins/kk/workflows/kk-itc.yaml:251-254`); the child runs as an owned process whose TERM/INT/HUP trap kills it and cancels its run (`plugins/kk/workflows/kk-itc.yaml:96-103`). |
| R7 | MET | `itcExportSeo` (`apps/cli/src/itc-publish.ts:576`) writes not-assessed for mode off and exports only live, confirmed, verified URLs. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R7 — Session recovery stays with bots and channel probes | MET | test | `apps/cli/tests/itc-publish.test.ts:95`. |
| R8 — Publication dispatch isolates targets and reuses fan-out | MET | test | `apps/cli/tests/itc-publish.test.ts:49`. |
| R9 — Runtime outcomes require valid current artifacts | MET | test | `plugins/kk/tests/verdict-confidence.test.ts:296`, `apps/cli/tests/itc-decision.test.ts:194`, `apps/cli/tests/itc-decision.test.ts:206`, edge contracts `apps/cli/tests/itc-publish.test.ts:630`. |
| R10 — Recovery preserves success and refuses uncertain repeats | MET | test | `apps/cli/tests/itc-publish.test.ts:144`. |
| R11 — Reports reconcile every expected target | MET | test | `apps/cli/tests/itc-publish.test.ts:354`, `apps/cli/tests/itc-publish.test.ts:462`, `apps/cli/tests/itc-publish.test.ts:704`. |
| R13 — DAG branches require verified predecessor completion | MET | test | Report dependencies `apps/cli/tests/kk-itc-dag.test.ts:11`; cancelled parent stops the owned child and cancels its run `apps/cli/tests/kk-itc-dag.test.ts:175`. |
| R16 — SEO handoff remains independent of an unfinished provider | MET | test | `apps/cli/tests/itc-publish.test.ts:409`. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 0302
**Scope:** Dispatch ITC targets with isolated payloads and recoverable receipts
**Dimensions:** functional traceability, correctness, security, efficiency, usability, architecture
**Verdict:** PASS
**Confidence:** MEDIUM

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P2 | correctness | `itcSendTargets` derives `effect: confirmed` from a successful fan-out invocation, not from verified public visibility. This is deliberate (a draft save is a success) and is why `publicUrlVerified` is only ever set from plugin-owned evidence — but `effect: confirmed` on a draft must never be read as "live". | `apps/cli/src/itc-publish.ts:273` | ACCEPTED — documented in the receipt schema; mode stays explicit and the SEO handoff filters on `mode === 'live'`. |
| 2 | P3 (advisory) | correctness | `parentRunId` in receipts is hard-coded to `itc-parent` in the native helpers rather than threaded from the parent run. 0303 owns config/entry parsing and must pass the real run id. | `apps/cli/src/itc-publish.ts:273` | OPEN — owned by 0303. |
| 3 | P3 (advisory) | architecture | The DAG reuses `kk stage run` shell nodes rather than a new executor payload API, which keeps asset compatibility but means the isolated-payload step is one extra file per target. | `plugins/kk/workflows/kk-itc.yaml:70` | RESOLVED — correctness preferred over a new API. |
| 4 | P4 | efficiency | `itcCheckTargets` spawns one probe process per declared target serially. Acceptable: probes are opt-in per plugin and bounded by the target count. | `apps/cli/src/itc-publish.ts:233` | ACCEPTED |

### References

- Feature G21 and docs/design/kk-itc-refactor.md (ADR-040 amendment).
- Source premises: plugins/kk/scripts/itc-stages.ts:130; plugins/kk/scripts/itc-stages.ts:425; apps/cli/src/fanout.ts:94; apps/cli/src/fanout.ts:193; apps/cli/src/commands/bot.ts:71; packages/kk-core/src/schemas.ts:43; plugins/kk/workflows/kk-daily-ai-voice2.yaml:493.
- Batch audit: docs/plans/2026-10-15-g21-refineall-ready.md.

### History

- 2026-10-16T01:19:57.038Z todo → wip (system)
- 2026-10-16T01:19:57.532Z wip → testing (system)
- 2026-10-16T01:19:58.011Z testing → done (system)

