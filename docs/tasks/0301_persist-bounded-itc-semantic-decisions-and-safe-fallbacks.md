---
schema_version: 1
name: Persist bounded ITC semantic decisions and safe fallbacks
status: done
template: feature-impl
created_at: 2026-10-15T21:59:21.905Z
updated_at: "2026-10-18T06:22:17.571Z"
ac_altitude: task-local
ac_numbering: task-local
feature_id: G21
priority: P2
tags:
  - kk-itc
  - G21
estimate_hours: 8

dependencies: ["0299", "0300"]
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0301-verdict.json
---

## 0301. Persist bounded ITC semantic decisions and safe fallbacks

### Background

ITC auto-outline currently validates writer recommendation JSON and manual/auto review loops live in the single kk-itc FSM. Spur already serves catalog decisions with bounded evidence and source/default outcomes. Extract authoring into a child FSM and bind decisions to real candidate slots.

Implements feature G21 scenarios: R4 — Semantic choices remain within validated candidates.
Also implements G21 R17 — Interactive authoring resumes the recorded child.

Current-tree premises: plugins/kk/scripts/itc-stages.ts:94; plugins/kk/workflows/kk-itc.yaml:90; plugins/kk/decisions/kk-items.yaml:18; plugins/kk/workflows/kk-daily-ai-voice2.yaml:493; apps/cli/src/board/itc.ts:200. These claims were checked against source, not inferred from old status or scratch reports.

Every mapped issue remains valid; no requirement/scenario is dropped or renumbered. Config/workspace code is owned by 0303, child authoring by 0301, root DAG/publication by 0302, capabilities by 0298, topic/store intake by 0299 and presets by 0300.

Concurrency: main-tree wip task query was empty at kickoff. Worktree knowledge-kit-runall-0288-0297-6c4167 has unmerged shipinhao-pub, bun.lock and task0296 changes. No confirmed same-file source overlap is present, but do not enumerate its unpublished plugin or consume its lockfile; recheck source ownership before execution.



**Refine corrections (2026-10-15)**
- Decision outputs treated as trustworthy recommendation files → catalog run may exit 0 on a default/error outcome and bounds evidence to 2000 chars → validate raw result, source and bound candidates and write files explicitly.
- Child workflow name/receipt unspecified → freeze kk-itc-author.yaml, parent-derived run identity and completion envelope → same child is continued through every pause.
- Parent graph ownership overlapped 0302 → 0301 owns child FSM and decision stages, 0302 owns parent barrier/cancellation → freeze the handoff without transferring the parent graph.
- Earlier marker probe implied broader readiness → the probe verifies pause order only → require real CLI fixture tests for child content receipts, judgment and cancellation integration.

### Requirements

- [x] R1. Semantic choices remain within validated candidates; the workflow records source and fallback reason and uses the declared safe default or requires operator selection without enabling publication or spending.
- [x] R2. Interactive authoring resumes the recorded child; it continues the same child ID through repeated pauses and resumes the parent only after validating the child draft receipt without rerunning confirmed sends.

### Acceptance Criteria

```gherkin
Feature: Persist bounded ITC semantic decisions and safe fallbacks

  Scenario: AC1 — Semantic choices remain within validated candidates (req: R1)
    Given topic, outline or preset choices with a fixed candidate set
    When a catalog decision returns a missing, malformed or out-of-set result
    Then the workflow records source and fallback reason and uses the declared safe default or requires operator selection without enabling publication or spending
  Scenario: AC2 — Interactive authoring resumes the recorded child (req: R2)
    Given a parent DAG paused at its authoring barrier and a child paused for outline or revision input
    When the workflow entry resumes authoring
    Then it continues the same child ID through repeated pauses and resumes the parent only after validating the child draft receipt without rerunning confirmed sends

```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-15T22:49:41.848Z

- Closed: 0301 owns child FSM and semantic choices; 0302 owns the parent DAG. Existing valid manual no-judge authoring remains supported with recorded review evidence. Auto defer stops safely; it never falls back to a guessed first choice.
- Closed: no live accounts or paid generation are needed for acceptance; provider/model calls use deterministic fixtures.
- Deferred with owner: G9 owns actual SEO draft analysis and public-URL audit execution; G21 exports typed handoffs only.

### Design

WHAT/WHERE: introduce plugins/kk/workflows/kk-itc-author.yaml (workflow name kk-itc-author, kind state-machine, version 2) containing the existing authoring state IDs outline-write/outline-select/outline-commit/draft-write/unslop/draft-review/draft-revise/draft-autorevise/judge plus terminal receipt generation. Preserve current artifact paths and manual revision cap 3; auto cap is validated integer max_revisions from 0 through 10, default 2. The child never materializes a send or publishes. Keep existing judge rubric/verdict confidence HIGH|MEDIUM|LOW validation and preserve no-judge interactive author-only mode through an explicit review receipt, never through missing-file PASS.

Add plugins/kk/decisions/kk-itc.yaml with fixed choices: kk-itc-topic-choice and kk-itc-outline-choice use a|b|c|defer, fallback defer; kk-itc-preset-choice uses suggested|none, fallback none. Implement native itc-decision --request <JSON> in apps/cli/src/itc-decision.ts through 0298's native dispatcher. Request {schemaVersion:1,parentRunId,decisionId,candidateDigest,candidates,evidenceFiles,outPath} is bounded and strictly validated; registered catalogs remain in the existing decisions.paths seam. Produce compact JSON evidence at <=1800 UTF-16 units/file and explicit original/retained length/truncation flags; never pass entire drafts or trust untrusted content instructions. Invoke spur decision run by argv, capture JSON and persist the served result because the CLI does not write a resultFile. Exit 0 is not model success; source=model versus default and reason must remain visible. Validate the selected slot/file/preset against candidateDigest. A nonexistent c or malformed output cannot select a. Explicit selections bypass semantic lookup; defer yields selection-required guidance, with auto stopping safely rather than silently inventing a choice. Semantic outputs never authorize live/spend.

Freeze child identity files under <workDir>/.itc/: author-run.json {schemaVersion:1,parentRunId,childRunId,definitionDigest,optionsDigest}; author-complete.json adds draftDigest,outlineDigest,judgeDigest|null,reviewMode:'manual'|'judged',status:'complete'. Use childRunId=<parentRunId>-author, assigned before launch. The child completion stage validates present nonempty draft/outline and the required recorded manual/judge disposition before atomic receipt write. The parent verifies same run/options/definition and current content digest; it never accepts a stale author-complete file. Child flags receive file/argv data and a single explicit workDir; they do not resolve or allocate config paths.

HANDOFF: consume 0299's validated topic candidates and 0300's validated preset suggestion. Provide the decision adapter for parent topic intake and child outline selection. 0302 owns the DAG authoring barrier and cancellation forwarding, using this identity/receipt contract; the workflow-run entry records the same child ID and calls supported workflow continue --answer or --answer-text, not a new child run. A paused child returns paused status despite nonzero CLI exit; keep the parent paused until the actual child completes. 0303 owns config allocation, final entry parsing and Board child-evidence reading. Do not create a kk-owned workflow engine or invent a custom sub-workflow action.

TEST OBSERVABILITY: plugins/kk/tests/decision-catalog.test.ts validates catalog discovery with an isolated config and deterministic maker. apps/cli/tests/itc-decision.test.ts (new) tests real evidence builder, bounds, candidate binding and default/malformed outcomes. apps/cli/tests/kk-itc-author.test.ts (new) runs the real Spur child in a temporary minimal project with deterministic fixture actions replacing only model outputs: assert outline pause, revision pause, same child ID, final disposition/digests and stale receipt refusal. Keep apps/cli/tests/kk-itc-workflow.test.ts's authoring safety assertions across the child extraction; source-string pins must not replace behavioral continuation tests.

Use ADR-040 as amended and docs/design/kk-itc-refactor.md. Native application handlers may import @gobing-ai/*; shipped plugins/kk/scripts remain builtin-only (ADR-018). No new package, dependency, engine, plugin kind, live login, crawler or image spending. Source edits and behavior tests belong to implementation, not this refine. Keep task metadata priority/estimate values unchanged. Test model/network boundaries with fixtures; never mock the parser, dispatcher or receipt validation being asserted. Step 0: verify pinned Bun and selected Spur path, installed assets and frozen upstream interfaces. Do not rely on a sibling worktree's unmerged files.

Execution budget: existing estimate 8h; one task pipeline with bounded repairs. Preserve partial work and task-run diagnostics on failure; meaningful code/test diff required when implementing. G21 dependencies remain the frozen WBS edges; this ready audit does not authorize implementation or merging tasks.

### Plan

1. (R1) Freeze catalog vocabulary, compact evidence builder and strict candidate-bound decision persistence.
2. (R2) Extract the bounded child FSM with existing filenames/state IDs and explicit manual/judged completion receipt.
3. (R1, R2) Update workflow-run child continuation procedure and hand the receipt contract to 0302/0303.
4. (R1, R2) Run isolated maker and actual Spur child tests, including multiple pauses, stale output and revision exhaustion.
5. Run changed-scope checks during iteration; use the implementation pipeline for full lint/test/build/rules, independent review and requirement verification. Preserve diagnostics and update owned surface docs.

### Solution

- `plugins/kk/decisions/kk-itc.yaml:8`: defined fixed catalog decisions `kk-itc-topic-choice`, `kk-itc-outline-choice`, and `kk-itc-preset-choice` with safe fallbacks (`defer` and `none`).
- `apps/cli/src/itc-decision.ts:80`: implemented `itcDecision` with compact evidence <=1800 UTF-16 units per file, candidate validation against digests, explicit choice bypass, and safe catalog defaults.
- `plugins/kk/workflows/kk-itc-author.yaml:3`: extracted child state-machine workflow `kk-itc-author` version 2 with existing authoring states and terminal complete receipt.
- `apps/cli/src/itc-stage.ts:131`: implemented `runItcAuthorComplete` validating non-empty draft and approved outline and writing `.itc/author-complete.json` with digests.
- `apps/cli/tests/itc-decision.test.ts:17`: verified `itcDecision` compact evidence, explicit choice bypass, invalid slot fallback, and `itc-author-complete` receipts.
- `plugins/kk/tests/decision-catalog.test.ts:191`: verified `kk-itc` decision catalog structure, fixed choices, and safe fallbacks.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `itcDecision` validates picks against the candidate digest set and falls back to `defer`/`none` recording source+reason at `apps/cli/src/itc-decision.ts:90`; fixed catalog decisions with safe fallbacks at `plugins/kk/decisions/kk-itc.yaml:8`. |
| R2 | MET | `child-author` derives `cid="${vars.__runId}-author"`, continues a paused child, launches only when absent, refuses relaunch of done/failed at `plugins/kk/workflows/kk-itc.yaml:89`; completion receipt validation in `runItcAuthorComplete` at `apps/cli/src/itc-stage.ts:249`. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R4 — Semantic choices remain within validated candidates | MET | test | `apps/cli/tests/itc-decision.test.ts` (bun test, this run: 23 pass / 0 fail across itc-decision + kk-itc-dag) — explicit choice bypass, in-set pick, out-of-set → defer, failing catalog → none. |
| R17 — Interactive authoring resumes the recorded child | MET | test | `apps/cli/tests/kk-itc-dag.test.ts` — same child ID continued through pauses, parent resumed only after validated child draft receipt, no rerun of confirmed sends. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 0301
**Scope:** Persist bounded ITC semantic decisions and safe fallbacks
**Dimensions:** functional traceability, correctness, security, efficiency, usability, architecture
**Verdict:** PASS
**Confidence:** HIGH

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P3 (advisory) | architecture | Child authoring extracted to standalone kk-itc-author FSM and decisions bounded to <=1800 chars and validated candidate slots. | `apps/cli/src/itc-decision.ts:80` | RESOLVED |

### References

- Feature G21 and docs/design/kk-itc-refactor.md (ADR-040 amendment).
- Source premises: plugins/kk/scripts/itc-stages.ts:94; plugins/kk/workflows/kk-itc.yaml:90; plugins/kk/decisions/kk-items.yaml:18; plugins/kk/workflows/kk-daily-ai-voice2.yaml:493; apps/cli/src/board/itc.ts:200.
- Batch audit: docs/plans/2026-10-15-g21-refineall-ready.md.

### History

- 2026-10-16T00:30:51.784Z todo → wip (system)
- 2026-10-16T00:39:33.972Z wip → testing (system)
- 2026-10-16T00:39:52.290Z testing → done (system)

