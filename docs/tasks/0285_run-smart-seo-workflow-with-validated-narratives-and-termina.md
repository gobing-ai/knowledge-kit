---
schema_version: 1
name: Run Smart SEO workflow with validated narratives and terminal outcomes
status: done
template: feature-impl
created_at: 2026-10-15T04:45:13.288Z
updated_at: "2026-10-16T16:21:27.088Z"
feature_id: G9
priority: P2
tags:
  - seo
  - geo
estimate_hours: 8

dependencies: ["0282", "0283", "0284"]
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0285-verdict.json
---

## 0285. Run Smart SEO workflow with validated narratives and terminal outcomes

### Background

Accepted design: docs/design/kk-smart-seo.md; vendor snapshot 55a184a3b0d09565a4c84268f725a47784e62528 reviewed in docs/plans/2026-10-14-smart-seo-vendor-review.md. Vendor code is reference-only. No Python, new dependency, direct provider client, site mutation or undocumented scope expansion.

Implements: R8 — Narrative claims resolve to recorded facts before final output; R9 — Workflow stages stop or degrade according to their recorded outcomes.

Verified premises: plugins/kk/workflows/kk-storm-research.yaml:24 uses the shipped state-machine workflow format; apps/cli/src/stage.ts:79 explains the captured stage output behavior; plugins/kk/scripts/itc-stages.ts:1 is the existing narrative/stage sibling pattern, not a reusable SEO schema.

Dependencies: Produce reproducible SEO assessments and stable prioritized reports offline; Assess SEO meaning through typed Spur catalogs with honest fallbacks; Enrich audits with separate lab field and imported query evidence. Predecessor SEO stage artifacts are accepted design, not existing code; use the stated contracts once those tasks land.

**Refine corrections (2026-10-14)**

- Pointer-backed arbitrary prose was claimed fully validated → pointers do not establish sentence truth → replace with strict fact/action/limit template selection and deterministic rendering, rejecting text/unknown keys.
- Workflow preflight conflicted with earlier collection-only use → catalogs arrive in 0283 → enable require_decisions=true only for integrated workflow and isolate fixture contracts.
- Cancellation assumed inherited signals → runStage uses spawnSync with captured pipes → require actual workflow-to-grandchild cancellation proof and repair the existing seam if necessary.
- Stage ownership and generic Plan obscured integration → 0282/0283/0284 own their behavior → preserve payload contracts and explicitly verify required versus optional outcomes and report atomicity.

Current-tree audit: no Smart SEO runtime files are present; all local requirements remain valid planned work. One current main worktree and no wip tasks were observed at kickoff. Bun 1.4.3 and Biome 2.5.15 match package/lock/tool pins; Bare-shell Spur initially reported 0.4.4. Freshness inspection confirmed bun-global Spur 0.4.6 equals npm latest and Superskill 0.3.37 equals npm latest; final writes/checks use the explicit bun-global Spur executable because PATH contains shadow copies (point-in-time evidence, no new pins). Implementation step 0 must recheck tool/environment and ownership drift. External-source dates are evidence, not a guarantee that a provider account is enabled.

### Requirements

- [x] R1. Implement bounded optional narrative schema, fact/action JSON-pointer references and digest validation before final materialization; reject unsupported claims and emit a labeled deterministic summary on absent/invalid/failed narrative.
- [x] R2. Compose preflight, collection, checks, enrichment, judgments, scoring, one narrative action and report through existing stage run actions; enforce predecessor identity, atomic outputs, required failures, partial outcomes and cancellation without a new workflow engine.

### Acceptance Criteria

- [x] AC1 — Narrative claims resolve to recorded facts before final output (req: R1)
- [x] AC2 — Workflow stages stop or degrade according to their recorded outcomes (req: R2)

```gherkin
Feature: Run Smart SEO workflow with validated narratives and terminal outcomes

  Scenario: AC1 — Narrative claims resolve to recorded facts before final output (req: R1)
    Given audit facts and an optional agent-authored structured narrative
    When final JSON and Markdown reports are materialized
    Then every claim reference resolves to its fact or action and invalid claims cannot enter the final report
    And absent narrative yields a labeled deterministic report with coverage and limits


  Scenario: AC2 — Workflow stages stop or degrade according to their recorded outcomes (req: R2)
    Given kk-smart-seo and a unique run workspace
    When preflight, collection, checks, optional enrichment, judgments, narrative and reporting execute
    Then each stage consumes validated predecessor artifacts and writes atomic run-bound outputs
    And required-stage errors reach failed while optional unavailable evidence yields a partial report
    And cancellation prevents further network and decision dispatch

```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-15T05:03:37.529Z

Closed by ready refinement (2026-10-14): design §13 and the refined handoff close the identified seam decisions. Owner is this WBS for its slice; later integration belongs to 0285 and installed acceptance to 0286. Existing deferred scope in §1 remains deferred to separate operator intake. No issue was dropped and no task merge/link/cancellation was authorized.

### Design

Chosen approach: native KK stage slice, per §3–4, §9 of the satellite.

Frozen decisions: One bounded narrative attempt with deterministic fallback; no revision loop. Native stage calls consume validated options-file paths instead of shell-interpolated URLs. iterationBound=12; failureStates=[failed]; done/partial describe assessment completeness. Preserve underlying stage errors and workflow cancellation; no scheduler/Board surface.

Files owned: plugins/kk/workflows/kk-smart-seo.yaml; plugins/kk/scripts/seo-stages.ts, seo-report.ts; plugins/kk/tests/smart-seo-workflow.test.ts and fixtures; docs/04_DESIGN.md.

Verification: validate YAML using spur workflow validate, then run fixture workflow end to end with no live network/maker. Verify required failure, optional unavailable evidence, empty site, invalid narrative IDs/pointers/numbers/digests, workspace collision, wrong predecessor hash, literal shell metacharacters in path arguments, cancel during request/decision and report atomicity. Assert no site-mutating or publishing step.

Rejected alternatives: wrapping vendor Python, adding dependency/service abstractions or separating tests/docs from this behavior; each expands runtime or ceremony without improving this slice. Out of scope: all deferred capabilities in design §1.

Execution budget: 8h estimated; preserve partial artifacts at budget boundary and resume from current tree, never invent replacement APIs. requireDiff: production stage/catalog/skill plus its behavior checks and same-change docs.

Refined handoff: Consume the immutable 0281 envelopes, 0282 audit/report schema, 0283 decision ledger and 0284 enrichment outcomes. Own workflow YAML, catalog-required workflow preflight, typed narrative selection validation and report terminal status integration; leave prior stage semantics and score ownership intact. Narrative schema is exactly design §9: allow only summary/priorities/limits headings, fact/action/limit templates and audit.json pointers to approved matching target collections/types. Reject unknown keys/text/prototype paths/stale digest or mismatched target; reject the entire narrative, then use deterministic fallback. Numeric values/units and remediation text originate only in validated audit records. Add apps/cli/src/stage.ts and its existing tests to conditional ownership only if real cancellation proves its synchronous child seam insufficient; preserve alias, output and exit contracts.

Shared-file protocol: implement sequentially in frozen order 0281, 0282, 0283, 0284, 0285, 0286. Change only this slice's registration/payload adapters; preserve predecessor tests and exports. Shared docs/04_DESIGN.md edits describe only shipped behavior. Recheck worktrees/wip ownership before writing; if another worker appears, coordinate rather than revert its edits.

### Plan

- [x] Step 0: Recheck current task contract, cited source files, Bun/tool pins, worktrees/wip ownership and completed predecessor artifact interfaces before editing; preserve unrelated working-tree changes.
- [x] (R2) Validate all predecessor schemas/digests; compose eight stages plus terminal states using quoted environment data, resolved workspace binding and require_decisions=true workflow preflight; verify iterationBound=12 and failureStates=[failed].
- [x] (R1) Implement strict narrative template/reference schema, approved pointer/type validation and deterministic rendering from immutable audit facts/actions/limits; persist rejection diagnostics and labeled fallback for absent/failed/invalid agent output.
- [x] (R1,R2) Wire one fresh agent.run attempt with timeoutMs=120000, answerFile and action-level onError=continue; unconditional report edge must materialize deterministic output on failure without permitting failed required stages to continue.
- [x] (R2) Exercise actual fixture workflow cancellation through kk stage run to sockets/decision grandchildren; repair existing stage subprocess signal forwarding only if needed, extending apps/cli/tests/stage.test.ts and commands/stage.test.ts to preserve captured output/aliases/exit status.
- [x] (R1,R2) Validate YAML and run plugins/kk/tests/smart-seo-workflow.test.ts with fixture network/makers forbidden; cover all required failures, empty/partial evidence, malformed narrative/template/pointer/digest, literal paths, collision, report status and atomic writes.
- [x] Update docs/04_DESIGN.md in the same change for this shipped slice; preserve accepted/deferred scope and source checked-at dates.
- [x] Run project lint, tests, build and rule gates; complete task-pipeline review and traceable requirement/AC verification before recording done. Never waive an upstream implementation dependency because refinement passed.

### Solution

Landed as commit `4e651020` ("feat(kk): run the Smart SEO workflow with validated narratives (task 0285)"), an ancestor of this branch's HEAD. The slice composes the `kk-smart-seo` state machine over the already-shipped `kk stage run seo-*` actions and adds the strict §9 narrative contract; no new workflow engine, scheduler or site-mutating step. This implement pass verified the landed slice against R1/R2 and found no residual code work; it closed the one outstanding Plan step (the same-change surface docs), so the code is byte-identical to `4e651020` and this pass's diff is `docs/04_DESIGN.md` plus this corpus update. Fresh evidence this pass: `bun test plugins/kk/tests/smart-seo-workflow.test.ts` 27 pass / 0 fail, the three Smart SEO suites 74 pass / 0 fail, the five-file behavior set 107 pass / 0 fail, and `spur workflow validate plugins/kk/workflows/kk-smart-seo.yaml` exit 0 (two medium composition warnings, no errors).

#### Change map — R1 (narrative claims resolve to recorded facts before final output)

| Ref | Anchor | Shipped behavior |
| --- | --- | --- |
| R1 allow-listed vocabularies | `plugins/kk/scripts/seo-report.ts:62-66` | `NARRATIVE_HEADINGS` (`summary|priorities|limits`) and `NARRATIVE_TEMPLATES` (`fact|action|limit`) are the only accepted heading and template values; anything else is rejected. |
| R1 pointer hygiene | `plugins/kk/scripts/seo-report.ts:134-152` | `decodePointer` refuses non-pointer strings, empty segments, NUL bytes and the prototype keys `__proto__`/`constructor`/`prototype`. |
| R1 fact/action references | `plugins/kk/scripts/seo-report.ts:156-189` | `resolveClaim` binds each template to its approved collection (`facts`/`actions`/`limits`), requires a two-segment pointer to exactly one record, and rejects unknown fact/action/limit ids and non-scalar fact values. |
| R1 unsupported claims rejected | `plugins/kk/scripts/seo-report.ts:191-297` | `validateNarrativeObject` is exact-key (a free-prose `text` key is an unknown key), requires matching `runId` and `auditDigest`, collects every diagnostic without early exit, and rejects the ENTIRE narrative on any invalid claim. |
| R1 bounded envelope | `plugins/kk/scripts/seo-report.ts:299-318` | `validateNarrative` refuses >32 KiB, non-JSON and non-object input before any claim is examined, returning a rejection rather than throwing. |
| R1 deterministic rendering | `plugins/kk/scripts/seo-report.ts:321-364` | `renderClaim`/`renderNarrativeSections` render through fixed method-owned templates over the audit records, so an agent can select and order references but cannot introduce a measurement, unit, diagnosis or prediction. |
| R1 labeled fallback | `plugins/kk/scripts/seo-report.ts:366-384` | `renderDeterministicSummary` supplies the coverage/scores/prioritized-action/crawl-limit summary used whenever no narrative is supplied or one is rejected. |
| R1 integration | `plugins/kk/scripts/seo-stages.ts:853-922` | `seoReport` hashes the materialized `audit.json` (876), validates the optional `narrative.json` against that digest, persists rejection diagnostics to `narrative-diagnostics.json` (883-891) and labels the omitted narrative (896) — all before the report is materialized (902-920). A rejected narrative is never an audit failure: the stage still exits 0 and records `narrativeStatus`. |

#### Change map — R2 (stages stop or degrade according to their recorded outcomes)

| Ref | Anchor | Shipped behavior |
| --- | --- | --- |
| R2 machine shape | `plugins/kk/workflows/kk-smart-seo.yaml:28-42` | Declares `name: kk-smart-seo`, `kind: state-machine`, terminal `done|partial|failed`, the single `failureStates: [failed]` and `iterationBound: 12`. |
| R2 preflight composition | `plugins/kk/workflows/kk-smart-seo.yaml:54-64` | Runs `kk stage run seo-preflight "$work_dir" "$options_file" "$__runId" true` as quoted argv data and binds `work_dir` from the run-bound file with `file.read.into-var`. |
| R2 catalog requirement | `plugins/kk/scripts/seo-stages.ts:126-160` | `checkSeoDecisionContracts` proves the four SEO catalogs and their 22 decision ids are served, failing with the `decisions.paths` registration pointer when one is missing. |
| R2 workspace binding | `plugins/kk/scripts/seo-stages.ts:172-267` | `seoPreflight` validates the options file, allocates or refuses a non-empty workspace, writes `options.json`/`manifest.json` and the run-bound `.spur/run/<runId>-seo-work-dir.txt` atomically. |
| R2 required/partial outcomes | `plugins/kk/scripts/seo-stages.ts:700-716` | A collection that hit a limit, came back empty or lost a page to unavailability persists `status: partial` in an atomically written `crawl.json`, which is what steps the terminal state to `partial`; a stage error fails its own state instead. |
| R2 one bounded narrative | `plugins/kk/workflows/kk-smart-seo.yaml:119-140` | `narrative` is one `agent.run` — fresh session, `timeoutMs: 120000`, `answerFile: ${vars.work_dir}/narrative.json`, `onError: continue` — with an unconditional `always` edge, so no revision loop exists and failure cannot stop the audit. |
| R2 terminal selection | `plugins/kk/workflows/kk-smart-seo.yaml:231-249` | `report` routes to `done`/`partial` from the validated `report.json.status` and to `failed` when the report is absent or malformed. |
| R2 atomic outputs | `plugins/kk/scripts/seo-fetch.ts:745-762` | `writeJsonAtomic` writes every artifact through a sibling temp file + rename, so a reader never observes a partially written value. |
| R2 cancellation | `plugins/kk/scripts/seo-fetch.ts:314-320` | A cancellation observer destroys the in-flight pinned socket and rejects with `SeoStageCancelledError`, rather than merely abandoning the loop that would have used the response. |
| R2 cancellation marker | `plugins/kk/scripts/seo-stages.ts:981-1034` | `runSeoStage` installs the cancellation registry around the whole stage, writes `cancelled.json` while preserving completed artifacts, and exits with the conventional signal status. |
| R2 host signal reach | `apps/cli/src/stage.ts:135-184` | `runStageCancellable` spawns the stage detached and forwards SIGINT/SIGTERM/SIGHUP to the stage's entire process group, escalating to SIGKILL after 5 s, while keeping the captured-output and exit-status contracts. |
| R2 CLI seam | `apps/cli/src/commands/stage.ts:58-65` | `kk stage run` executes through the cancellable path and maps a non-zero stage exit to a `CommanderError` carrying that code. |

#### Change map — what the tests prove

| Ref | Anchor | Asserted behavior |
| --- | --- | --- |
| R2 config invariants | `plugins/kk/tests/smart-seo-workflow.test.ts:123-241` | The machine declares the eight stages, three terminals, the single failure state and `iterationBound 12`; validates against the engine schema; quotes environment data instead of templating shell source; binds `work_dir`; gives every required stage an `action-ok` plus failure edge; bounds the narrative to one attempt; and declares no site-mutating, publishing or scheduling surface. |
| R1 absent narrative | `plugins/kk/tests/smart-seo-workflow.test.ts:278-287` | With no `narrative.json` the report materializes a labeled deterministic summary and `report.json` status `done`. |
| R1 unsupported claim | `plugins/kk/tests/smart-seo-workflow.test.ts:289-319` | An invented fact value plus a free-prose `text` key rejects the narrative (`narrativeStatus: rejected`, diagnostic naming the unknown key, `narrative-diagnostics.json` written) while the audit stays deliverable. |
| R1 reference matrix | `plugins/kk/tests/smart-seo-workflow.test.ts:477-547` | A stale digest, an unknown pointer, a prototype path and a pointer into the wrong template collection are each rejected. |
| R1 claim bounds | `plugins/kk/tests/smart-seo-workflow.test.ts:612-641` | More than 30 claims and an oversize narrative are rejected even when every individual claim is valid. |
| R1 accepted narrative | `plugins/kk/tests/smart-seo-workflow.test.ts:321-354` | A validated narrative renders only method-owned templates, and the accepted shape reaches the report. |
| R2 preflight contracts | `plugins/kk/tests/smart-seo-workflow.test.ts:643-682` | Preflight fails with the `decisions.paths` pointer when the catalogs are unserved and passes against the catalogs this project serves. |
| R2 socket cancellation | `plugins/kk/tests/smart-seo-workflow.test.ts:684-710` | Cancelling a live pinned request yields `SeoStageCancelledError` with zero open sockets. |
| R2 decision cancellation | `plugins/kk/tests/smart-seo-workflow.test.ts:712-755` | Cancellation terminates the in-flight decision grandchild and the run refuses further dispatch. |
| R2 cancellation marker | `plugins/kk/tests/smart-seo-workflow.test.ts:757-823` | The stage writes `cancelled.json` and exits with the conventional signal status. |
| R2 CLI forwarding | `apps/cli/tests/stage.test.ts:162-225` | A host signal reaches the stage's whole process group through the CLI seam while the stage exit code and output routing are preserved. |
| R1 report fallback | `plugins/kk/tests/smart-seo-analysis.test.ts:587-637` | A free-prose or unapproved-pointer narrative falls back to a labeled deterministic report via the stage entry point. |

#### Change map — same-change surface docs (Plan step 8)

| Ref | Anchor | Shipped behavior |
| --- | --- | --- |
| G9 surface docs | `docs/04_DESIGN.md:599,608` | §1.8's Smart SEO header now scopes the surface to tasks 0281-0285 and the new entry documents the shipped `kk-smart-seo` workflow — stage chain, `done\|partial\|failed` terminals, the §9 narrative contract (allow-listed headings/templates, `audit.json` pointer + sha256 binding, method-owned rendering, labeled deterministic fallback), the `require_decisions=true`/`decisions.paths` catalog requirement and the advisory read-only boundary; the §0 satellite row records 0285 as shipped with the skill + installed acceptance still open with 0286. |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Bounded optional narrative schema with fact/action JSON-pointer references and digest validation before final materialization; unsupported claims rejected and a labeled deterministic summary on an absent, invalid or rejected narrative. Envelope: `plugins/kk/scripts/seo-report.ts:299-318` refuses over 32 KiB, non-JSON and non-object input before any claim is examined, returning a rejection rather than throwing. Vocabularies: `plugins/kk/scripts/seo-report.ts:62-66` is the allow-list of the summary, priorities and limits headings and the fact, action and limit templates. Pointer and digest binding: `plugins/kk/scripts/seo-report.ts:134-152` refuses non-pointers, empty segments, NUL bytes and the prototype keys; `plugins/kk/scripts/seo-report.ts:156-189` requires a two-segment pointer into the collection the template approves and rejects unknown ids and non-scalar fact values; `plugins/kk/scripts/seo-report.ts:191-297` is exact-key, requires a matching runId and the sha256 auditDigest of the materialized audit.json, collects every diagnostic without early exit and rejects the entire narrative. Deterministic rendering and the labeled fallback: `plugins/kk/scripts/seo-report.ts:321-384`. Order before materialization: `plugins/kk/scripts/seo-stages.ts:853-920` hashes audit.json (line 876), validates the optional narrative against that digest, persists narrative-diagnostics.json (lines 883-891) and only then writes report.md (line 902) and report.json (line 920); a rejected narrative is never an audit failure, so the stage still exits 0 and records narrativeStatus. Executable evidence re-run this attempt: `bun test plugins/kk/tests/smart-seo-workflow.test.ts` -> 27 pass / 0 fail, and the five-file behavior set -> 107 pass / 0 fail; rows at `plugins/kk/tests/smart-seo-workflow.test.ts:278-287` (absent narrative yields the labeled deterministic summary with report.json recording done), `plugins/kk/tests/smart-seo-workflow.test.ts:289-319` (an invented fact plus a free-prose text key rejects the narrative while audit.json stays deliverable), `plugins/kk/tests/smart-seo-workflow.test.ts:477-547` (stale digest, unknown pointer, prototype path and wrong collection each rejected), `plugins/kk/tests/smart-seo-workflow.test.ts:612-641` (over-limit claims and an oversize narrative rejected) and `plugins/kk/tests/smart-seo-analysis.test.ts:587-637` (free-prose and unapproved-pointer fallback through the stage entry point). |
| R2 | MET | Preflight, collection, checks, enrichment, judgments, scoring, one narrative action and report composed through the existing `kk stage run` actions, with no new workflow engine. Machine: `plugins/kk/workflows/kk-smart-seo.yaml:28-42` declares name kk-smart-seo, kind state-machine, the terminals done, partial and failed, the single failureStates entry failed and iterationBound 12; `plugins/kk/workflows/kk-smart-seo.yaml:53-66` runs the preflight action with quoted argv data and rebinds work_dir with `file.read.into-var`; `plugins/kk/workflows/kk-smart-seo.yaml:119-140` is the single fresh-session `agent.run` step with timeoutMs 120000, an answerFile and onError continue; `plugins/kk/workflows/kk-smart-seo.yaml:225-250` gives that step one unconditional always edge to report and selects the terminal from the validated report.json status. Predecessor identity, workspace binding and catalogs: `plugins/kk/scripts/seo-stages.ts:172-267` validates the options file and allocates or refuses a non-empty workspace; `plugins/kk/scripts/seo-stages.ts:126-160` proves the four SEO catalogs and 22 decision ids are served and fails with the decisions.paths registration pointer. Required versus partial outcomes: `plugins/kk/scripts/seo-stages.ts:700-716` persists status partial in an atomically written crawl.json when a limit was hit, the site came back empty or a page was unavailable, while a required-stage error fails its own state. Atomic outputs: `plugins/kk/scripts/seo-fetch.ts:745-762` writes every artifact through a sibling temp file plus rename. Cancellation: `plugins/kk/scripts/seo-fetch.ts:314-320` destroys the in-flight pinned socket and rejects with `SeoStageCancelledError`; `plugins/kk/scripts/seo-stages.ts:981-1034` installs the cancellation registry around the whole stage, writes cancelled.json while preserving completed artifacts and exits with the conventional signal status; `apps/cli/src/stage.ts:135-184` spawns the stage detached and forwards SIGINT, SIGTERM and SIGHUP to the stage process group, escalating to SIGKILL after 5 seconds; `apps/cli/src/commands/stage.ts:58-65` maps a non-zero stage exit to a `CommanderError`. Executable evidence re-run this attempt: the five-file behavior set -> 107 pass / 0 fail across 5 files; `plugins/kk/tests/smart-seo-workflow.test.ts:123-241` asserts the shipped machine declares the eight stages, the three terminals, the single failure state and iterationBound 12, validates against the engine schema and declares no site-mutating, publishing or scheduling surface; `plugins/kk/tests/smart-seo-workflow.test.ts:642-682` covers the preflight catalog contracts; `plugins/kk/tests/smart-seo-workflow.test.ts:684-823` cancels a live pinned request with zero open sockets, terminates the in-flight decision grandchild and asserts cancelled.json with the conventional signal exit while preserving written artifacts; `apps/cli/tests/stage.test.ts:162-225` drives the real CLI, sends a host signal to the CLI and asserts the stage process group and its grandchild die with the mapped exit code and preserved output routing; `spur workflow validate plugins/kk/workflows/kk-smart-seo.yaml` exits 0 with workflow valid: kk-smart-seo (explicit(2)). Certified quality gate at this digest: `.spur/run/0285-test-gate.log` records lint clean, 3750 pass, 2 skip and 0 fail, and receipt `.spur/run/0285-check-receipt.json` records tier full, status PASS. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Narrative claims resolve to recorded facts before final output (req: R1) | MET | test | Behavioral AC re-run this attempt: `bun test plugins/kk/tests/smart-seo-workflow.test.ts` -> 27 pass / 0 fail, `bun test plugins/kk/tests/smart-seo-workflow.test.ts plugins/kk/tests/smart-seo-analysis.test.ts plugins/kk/tests/smart-seo-collect.test.ts apps/cli/tests/stage.test.ts apps/cli/tests/commands/stage.test.ts` -> 107 pass / 0 fail across 5 files. Every claim reference resolves to a recorded fact, action or limit in its approved collection and is bound to the materialized audit.json sha256 and the run id, and no invalid claim can enter the final report: validate-before-materialize ordering at `plugins/kk/scripts/seo-stages.ts:853-920` (hash at line 876, validation against that digest, narrative-diagnostics.json at lines 883-891, report.md only at line 902 and report.json only at line 920); reference/type/digest enforcement at `plugins/kk/scripts/seo-report.ts:156-189` and `plugins/kk/scripts/seo-report.ts:191-297`; bounded envelope at `plugins/kk/scripts/seo-report.ts:299-318`; method-owned rendering and the labeled deterministic summary at `plugins/kk/scripts/seo-report.ts:321-384`. Test anchors: `plugins/kk/tests/smart-seo-workflow.test.ts:278-287` (absent narrative -> the report carries the labeled deterministic summary with report.json recording done), `plugins/kk/tests/smart-seo-workflow.test.ts:289-319` (one unsupported text key rejects the whole narrative while audit.json stays deliverable), `plugins/kk/tests/smart-seo-workflow.test.ts:477-547` (stale digest, unknown pointer, prototype path and a pointer into the wrong collection each rejected), `plugins/kk/tests/smart-seo-workflow.test.ts:612-641` (over-limit and oversize rejected), `plugins/kk/tests/smart-seo-analysis.test.ts:587-637` (the same fallback through the seo-report stage entry point). |
| AC2 — Workflow stages stop or degrade according to their recorded outcomes (req: R2) | MET | test | Behavioral AC re-run this attempt: the five-file behavior set -> 107 pass / 0 fail, and `spur workflow validate plugins/kk/workflows/kk-smart-seo.yaml` exits 0 (workflow valid: kk-smart-seo (explicit(2))). Each stage consumes validated predecessor artifacts and writes atomic run-bound outputs, a required-stage error reaches failed while unavailable optional evidence yields a partial report, and cancellation prevents further network and decision dispatch: terminal selection at `plugins/kk/workflows/kk-smart-seo.yaml:231-250` (report -> done, partial or failed from the validated report.json status); required versus partial outcome recording at `plugins/kk/scripts/seo-stages.ts:700-716`; predecessor identity, workspace binding and the catalog pointer at `plugins/kk/scripts/seo-stages.ts:126-160` and `plugins/kk/scripts/seo-stages.ts:172-267`; atomic artifact writes at `plugins/kk/scripts/seo-fetch.ts:745-762`; cancellation that aborts the in-flight pinned socket at `plugins/kk/scripts/seo-fetch.ts:314-320`, marks the cancelled run at `plugins/kk/scripts/seo-stages.ts:981-1034`, and reaches the stage process group through `apps/cli/src/stage.ts:135-184` and `apps/cli/src/commands/stage.ts:58-65`. Test anchors: `plugins/kk/tests/smart-seo-workflow.test.ts:642-682` (preflight catalog contracts), `plugins/kk/tests/smart-seo-workflow.test.ts:684-823` (live socket aborted with zero open sockets, in-flight decision grandchild terminated, cancelled.json written with the conventional signal exit while completed artifacts survive), `apps/cli/tests/stage.test.ts:162-225` (a host signal reaches the stage process group and its grandchild through the CLI seam, with the stage exit code and output routing preserved). |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 0285 (attempt 2; slice landed in `4e651020` + this attempt's same-change surface docs)
**Scope:** `plugins/kk/workflows/kk-smart-seo.yaml`, `plugins/kk/scripts/seo-{stages,report,fetch,decisions,enrich}.ts`, `apps/cli/src/{stage.ts,commands/stage.ts}`, `plugins/kk/tests/smart-seo-workflow.test.ts`, `apps/cli/tests/stage.test.ts`, `apps/cli/tests/commands/stage.test.ts`. `git diff HEAD` is `docs/04_DESIGN.md` plus this task file only, so every reviewed code file is byte-identical to `4e651020`.
**Dimensions:** functional traceability (R1/R2, AC1/AC2), security, efficiency, correctness, usability, architecture
**Verdict:** PASS

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P3 (minor) | functional/process | Attempt 1's only P3 is closed. The slice's declared same-change `docs/04_DESIGN.md` update is present: the §1.8 header now scopes the surface to tasks 0281-0285 and a new entry documents the `kk-smart-seo` workflow, the `preflight → collect → check → enrich → judge → score → narrative → report` chain, the `done\|partial\|failed` terminals with `failed` the sole failure state, quoted-argv deterministic steps, the run-bound workspace binding, `require_decisions=true` with the `decisions.paths` registration pointer, the §9 narrative contract and the advisory read-only boundary; the §0 satellite row records 0285 as shipped and leaves the one skill plus installed acceptance to 0286. Every statement was re-checked against the shipped files and against `docs/design/kk-smart-seo.md` §3/§4/§9/§10 — chain and terminals, `plugins/kk/workflows/kk-smart-seo.yaml:28-42`; quoted-argv preflight with the fourth argument `true`, `plugins/kk/workflows/kk-smart-seo.yaml:54-64`; one bounded narrative step, `plugins/kk/workflows/kk-smart-seo.yaml:119-140`; report→terminal selection, `plugins/kk/workflows/kk-smart-seo.yaml:231-249`; four catalogs and 22 decision ids, `plugins/kk/scripts/seo-stages.ts:78-109`; validate-before-materialize ordering, `plugins/kk/scripts/seo-stages.ts:853-920`. No inaccurate statement found. | `docs/04_DESIGN.md:599,608` | RESOLVED (surface docs written in this attempt's working tree; the P3 finding is closed, not deferred) |
| 2 | P4 (advisory) | correctness/config | `spur workflow validate` reports two medium composition warnings on the narrative step — the prompt is not slash-pinned and the action declares neither `expectFile` nor `requireDiff` — and exits 0 with no error-level finding. Sibling `agent.run` steps do declare `expectFile`. | `plugins/kk/workflows/kk-smart-seo.yaml:119-140` | ACCEPTED — `answerFile` with `onError: continue` is the design-chosen optional-artifact contract (`docs/design/kk-smart-seo.md:144-147`), deliberately making the artifact optional; the repo test asserts `valid` with zero error-level findings (`plugins/kk/tests/smart-seo-workflow.test.ts:146-155`). |
| 3 | P4 (advisory) | correctness | `report.md` is written with a plain write while every JSON artifact uses sibling-temp + rename, so a crash mid-write can leave a truncated Markdown projection; the design states writes use sibling temp file + rename (`docs/design/kk-smart-seo.md:74`). Only the atomic `report.json` decides the terminal state, so the impact is confined to the human projection. | `plugins/kk/scripts/seo-stages.ts:902` | ACCEPTED — no terminal, gate or certification path reads the Markdown; the predecessor `digest.md` carries the same pattern (`plugins/kk/scripts/seo-stages.ts:845`). |
| 4 | P4 (advisory) | security | The narrative step runs `role: coder` over site-derived audit content with no declared capability or tool restriction, so an instruction injected through a crawled page title could steer the agent while it authors the artifact. The report blast radius stays bounded: only allow-listed headings, templates and in-collection pointers are accepted, and any unsupported claim rejects the whole narrative before materialization. | `plugins/kk/workflows/kk-smart-seo.yaml:119-140` | ACCEPTED — the design records this boundary as an expectation rather than a sandbox (`docs/design/kk-smart-seo.md:84`) and the artifact is optional; pin a bounded capability set if this step is ever promoted beyond advisory. |

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | Bounded optional narrative, all validation before materialization. Envelope: `plugins/kk/scripts/seo-report.ts:299-318` rejects over 32 KiB, non-JSON and non-object input before any claim is examined. Vocabularies: `plugins/kk/scripts/seo-report.ts:62-66` allows only `summary`/`priorities`/`limits` headings and `fact`/`action`/`limit` templates. Pointer hygiene: `plugins/kk/scripts/seo-report.ts:134-152` refuses non-pointers, empty segments, NUL bytes and the prototype keys. References: `plugins/kk/scripts/seo-report.ts:156-189` binds each template to its approved collection, requires a two-segment pointer to exactly one record, and rejects unknown ids and non-scalar facts. Unsupported claims: `plugins/kk/scripts/seo-report.ts:191-297` is exact-key (a free-prose `text` key is an unknown key), requires matching `runId` and `auditDigest`, collects every diagnostic and rejects the entire narrative. Rendering and fallback: `plugins/kk/scripts/seo-report.ts:321-384`. Integration order: `plugins/kk/scripts/seo-stages.ts:853-920` hashes the materialized `audit.json` (876), validates (876), persists `narrative-diagnostics.json` (883) and only then writes `report.md` (902) and `report.json` (920); a rejected narrative still exits 0 and records `narrativeStatus`. Tests: `plugins/kk/tests/smart-seo-workflow.test.ts:278-354,477-641`. |
| R2 | MET | Composition over the existing stage actions, no new engine. Machine shape: `plugins/kk/workflows/kk-smart-seo.yaml:28-42` (`kind: state-machine`, version 2, `done`/`partial`/`failed`, `failureStates: [failed]`, `iterationBound: 12`). Preflight: `plugins/kk/workflows/kk-smart-seo.yaml:54-64` passes quoted argv data and rebinds `work_dir` with `file.read.into-var`; catalog proof and the `decisions.paths` pointer are `plugins/kk/scripts/seo-stages.ts:126-160`. Required versus partial outcomes: `plugins/kk/scripts/seo-stages.ts:700-716` persists `status: partial` in an atomic `crawl.json`; a required-stage error routes to `failed` (the engine takes a guard-less transition unconditionally, which is the repo's `always` convention at `docs/design/kk-smart-seo.md:51`). One bounded narrative: `plugins/kk/workflows/kk-smart-seo.yaml:119-140` (fresh session, `timeoutMs: 120000`, `answerFile`, `onError: continue`, unconditional edge, no revision loop). Terminal selection: `plugins/kk/workflows/kk-smart-seo.yaml:231-249`. Atomic outputs: `plugins/kk/scripts/seo-fetch.ts:745-762`. Cancellation: `plugins/kk/scripts/seo-fetch.ts:314-319` destroys the in-flight pinned socket, `plugins/kk/scripts/seo-stages.ts:981-1034` writes `cancelled.json` with the conventional signal exit, `apps/cli/src/stage.ts:135-184` forwards SIGINT/SIGTERM/SIGHUP to the stage's process group, `apps/cli/src/commands/stage.ts:58-65` maps a non-zero exit to a `CommanderError`. Tests: `plugins/kk/tests/smart-seo-workflow.test.ts:123-241,642-823`, `apps/cli/tests/stage.test.ts:162-225`. |
| AC1 | MET | (req R1) Every claim reference resolves to a recorded fact, action or limit in its approved collection and is bound to the materialized `audit.json` sha256 and the run id; an unsupported claim rejects the whole narrative before materialization, and an absent or rejected narrative yields the labeled deterministic summary in `report.md` with `report.json` still deliverable (`plugins/kk/scripts/seo-stages.ts:853-920`; `plugins/kk/tests/smart-seo-workflow.test.ts:278-354,477-641`). |
| AC2 | MET | (req R2) Each stage consumes validated predecessor artifacts and writes run-bound atomic outputs; a required-stage error routes to `failed`, unavailable optional evidence stays `partial`, and a cancellation reaches the stage grandchild and records a marker (`plugins/kk/workflows/kk-smart-seo.yaml:231-249`; `plugins/kk/scripts/seo-stages.ts:981-1034`; `plugins/kk/tests/smart-seo-workflow.test.ts:684-823`; `apps/cli/tests/stage.test.ts:162-225`). |

**Fresh evidence this attempt:** `bun test plugins/kk/tests/smart-seo-workflow.test.ts` → 27 pass / 0 fail; `bun test plugins/kk/tests/smart-seo-workflow.test.ts plugins/kk/tests/smart-seo-analysis.test.ts plugins/kk/tests/smart-seo-collect.test.ts apps/cli/tests/stage.test.ts apps/cli/tests/commands/stage.test.ts` → 107 pass / 0 fail across 5 files; `bun test plugins/kk/tests/` → 279 pass / 0 fail across 13 files; `spur workflow validate plugins/kk/workflows/kk-smart-seo.yaml` → `workflow valid: kk-smart-seo (explicit(2))`, exit 0. Certified gate at this digest: `.spur/run/0285-test-gate.log` (lint clean, 3750 pass / 2 skip / 0 fail) with receipt `.spur/run/0285-check-receipt.json` tier `full`, status PASS.

**Assumptions / recheckable gaps (no asserted confidence level):** the narrative `agent.run` → `narrative.json` wiring is asserted structurally from the shipped config (one action, fresh session, `answerFile`, `onError: continue`, unconditional edge) and not executed end to end, because the fixtures forbid a live maker; the validation it feeds is exercised directly. AC2's `partial` terminal is asserted through `audit.status`/`crawl.json` status plus the machine's `jq` guards, not through a live enrich-unavailable fixture run. Both gaps re-check at `plugins/kk/tests/smart-seo-workflow.test.ts:123-241` and `spur workflow validate`.

**Next:** no code change required; carry findings 2-4 as accepted advisories (consider pinning the narrative agent's capabilities when the skill and installed acceptance land with 0286).

### References

- Feature G9: docs/features/G9_kk-smart-seo-evidence-grounded-seo-and-geo-audits.md
- Accepted design: docs/design/kk-smart-seo.md (§13 is the refined handoff). ADR-039: docs/00_ADR.md:1364.
- Vendor review: docs/plans/2026-10-14-smart-seo-vendor-review.md. Snapshot verified unchanged.
- Current premises: plugins/kk/workflows/kk-storm-research.yaml:24; apps/cli/src/stage.ts:79; plugins/kk/scripts/itc-stages.ts:1; /Users/robin/xprojects/spur-new/packages/app/src/workflow/actions/agent-run.ts:122.
- Predecessors: 0282, 0283, 0284; dependent responsibilities are named in Design.
- Batch audit/checklist: docs/plans/2026-10-14-g9-ready-refinement.md; machine evidence: .spur/memory/evidence/g9-refine-ready-20261014-01/report.json.
- Concurrency at kickoff: git worktree list showed only current main; spur task list --status wip --json returned [].

### History

- 2026-10-16T07:17:40.516Z todo → wip (system)
- 2026-10-16T15:54:06.914Z wip → testing (system)
- 2026-10-16T15:55:14.668Z testing → wip (system)
- 2026-10-16T16:21:20.344Z wip → testing (system)
- 2026-10-16T16:21:27.083Z testing → done (system)

