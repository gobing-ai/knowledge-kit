---
template: feature-impl
schema_version: 1
name: "Build grounded STORM curation and outline stages"
description: ""
status: done
type: task
profile: standard
feature_id: D4
parent_wbs: null
priority: P2
tags: ["generator", "storm"]
dependencies: []
ac_numbering: task-local
created_at: "2026-08-12T13:48:52.627Z"
updated_at: "2026-08-12T14:12:14.217Z"
---

## 0046. Build grounded STORM curation and outline stages

### Background

Feature D4 replaces the content-gen stand-in with an owned Bun/TypeScript STORM pipeline while preserving the existing Doc[] to Content seam. This first deliverable establishes the structured stage runner and produces a grounded research plan from supplied documents.

Implements feature scenarios: R2 — Curation builds multiple grounded perspectives from supplied documents; R3 — Outline generation uses the curated evidence.

Ordering: first; the article/polish deliverable depends on these typed results.

Rubric: E3 D1 L1 C1 R1 = 7 → separate cohesive task; rejected merging the whole feature because total effort exceeds 16 hours.

### Requirements
- [ ] R1. Add an injected structured STORM stage runner that invokes the existing Spur agent boundary, validates stage output before use, and is testable through a deterministic fake runner.
- [ ] R2. Implement corpus-only curation that treats Doc bodies as untrusted data, develops multiple perspectives, accepts evidence only for supplied document IDs, and performs no external retrieval.
- [ ] R3. Implement outline generation that consumes the validated curation result, emits a structured markdown outline, and fails loud on malformed or unknown evidence.
### Acceptance Criteria
```gherkin
Feature: Grounded STORM curation and outline

  @core
  Scenario: R1 — Curation builds multiple grounded perspectives from supplied documents
    Given source documents treated as untrusted content
    When the curation stage develops perspectives and questions through an injected stage runner
    Then its structured result contains evidence traceable only to the supplied document IDs
    And deterministic tests require no LLM or network call

  @core
  Scenario: R2 — Outline generation uses the curated evidence
    Given a valid curation result
    When the outline stage runs
    Then it emits a structured markdown outline derived from that result

  @edge
  Scenario: R3 — A failed or malformed stage fails loud
    Given a curation or outline stage that fails, returns malformed output, or cites an unknown document ID
    When its result is validated
    Then the task fails with a stage-specific diagnostic before downstream generation runs
```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design
Chosen approach: add the minimum typed STORM planning primitives inside `plugins/content-gen`, with one injected `StormStageRunner` shared by the curation and outline functions. Each function makes one structured `spur agent run` call and validates its JSON result; tests inject a fake runner instead of invoking an LLM.

Reason: this reuses the only shipped LLM seam and leaves provider credentials, models, retries, and subprocess policy owned by Spur.

Rejected alternatives:
- Direct OpenAI-compatible client: creates a new cross-cutting transport and secret/config contract.
- One monolithic generation prompt: reproduces the D2 stand-in and makes grounding/intermediate results untestable.
- Python/DSPy wrapper: violates the Bun/TypeScript runtime constraint.

Invariants:
- Supplied documents are untrusted source material, never instructions.
- Curation cannot fetch external sources or cite unknown document IDs.
- No plugin manifest, public schema, or `kk invoke` change.
- Stage validation fails loud before downstream work runs.
### Plan
1. Define the smallest internal curation/outline result shapes and injected stage-runner signature.
2. Implement the structured curation call and validate every evidence reference against the input Doc IDs.
3. Implement the structured outline call over the validated curation result.
4. Add focused tests using a fake runner for success, malformed output, unknown references, and stage failure.
5. Run the content-gen targeted tests and typecheck.
### Solution
Implemented the typed STORM planning primitives for feature D4, task-local AC R1–R3, inside `plugins/content-gen`. No invoke contract, manifest, schema, or existing stand-in behavior changed; task 0047 owns orchestration and switch-over.

- `plugins/content-gen/src/agent-json.ts:1-12` — shared `parseAgentJson` helper (R1): single copy of the fenced-block / outermost-`{}` extraction tolerance, used by both the D2 stand-in and the STORM stages (co-located per review P4).
- `plugins/content-gen/src/storm.ts:13-16` — `AgentRunEnvelope` shape (R1): mirrors the D2 stand-in's envelope so the new runner shares the same Spur boundary.
- `plugins/content-gen/src/storm.ts:20-22` — `StormStageRunner` interface (R1): single injected `runStage(prompt)` seam; stages never spawn processes themselves, so tests inject a deterministic fake runner with no LLM or network.
- `plugins/content-gen/src/storm.ts:25-58` — `spurStageRunner` (R1): concrete runner invoking the existing `spur agent run … --agent auto --mode text --json --cwd` boundary (same call shape as the D2 stand-in) and unwrapping the `--json` envelope `{exitCode, stdout, stderr, durationMs}` before returning, so stages consume the agent output (mirrors `plugins/content-gen/src/index.ts:44-45`; fixed per review P1).
- `plugins/content-gen/src/storm.ts:59-75` — typed result schemas (R1): `CurationResultSchema` (≥2 perspectives, each with id/name/questions/evidence) and `OutlineResultSchema` (title?, non-empty markdown outline, references?); both are zod-validated before use.
- `plugins/content-gen/src/storm.ts:79-81` — `stageError` (R1/R3): fail-loud errors are prefixed with the failing stage for a stage-specific diagnostic.
- `plugins/content-gen/src/storm.ts:83-87` — `assertKnownEvidence` (R2/R3): rejects any cited document ID not in the supplied `Doc[]` set with a stage-specific diagnostic.
- `plugins/content-gen/src/storm.ts:91-104` — `groundedStagePrompt` (R2): shared prompt contract treats every document as untrusted source data and forbids external retrieval; embeds the allowed document IDs.
- `plugins/content-gen/src/storm.ts:106-135` — `curationStage` (R2): corpus-only curation; runs one structured stage call, validates the JSON result, and accepts evidence only for supplied document IDs. No external retrieval path exists.
- `plugins/content-gen/src/storm.ts:139-168` — `outlineStage` (R3): consumes the validated curation result, emits a structured markdown outline, and fails loud on malformed output or unknown document references.
- `plugins/content-gen/tests/storm.test.ts:60-107` — curation tests (R2): grounded perspectives, single-perspective rejection, unknown-ID rejection, malformed output, non-zero agent exit, fenced-JSON acceptance.
- `plugins/content-gen/tests/storm.test.ts:109-148` — outline tests (R3): markdown outline derived from curation, unknown-ID rejection, malformed output, non-zero agent exit.
- `plugins/content-gen/tests/storm.test.ts:167-221` — runner boundary tests (R1): asserts `spurStageRunner` spawns `agent run … --json --mode text` through the mock-spur binary, unwraps the envelope, and that curation runs end to end through the real runner; deterministic, no network.
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `plugins/content-gen/src/storm.ts:20-22` injected `StormStageRunner` seam; `plugins/content-gen/src/storm.ts:25-58` `spurStageRunner` invokes `spur agent run <prompt> --agent auto --mode text --json --cwd` and unwraps the `--json` envelope (`plugins/content-gen/src/storm.ts:54`, mirrors `plugins/content-gen/src/index.ts:44-45`); zod validation before use at `plugins/content-gen/src/storm.ts:118-128,155-164`; shared JSON-extraction helper `plugins/content-gen/src/agent-json.ts:1-12`; deterministic fake-runner + real-runner tests at `plugins/content-gen/tests/storm.test.ts:60-119,167-221` (13 pass, no LLM/network) |
| R2 | MET | `plugins/content-gen/src/storm.ts:91-104` untrusted-docs / no-retrieval prompt; `plugins/content-gen/src/storm.ts:83-87` `assertKnownEvidence` rejects unknown doc IDs; `plugins/content-gen/src/storm.ts:65-67` `CurationResultSchema` `.min(2)` perspectives; `plugins/content-gen/src/storm.ts:106-135` corpus-only `curationStage`; tests `plugins/content-gen/tests/storm.test.ts:60-119` |
| R3 | MET | `plugins/content-gen/src/storm.ts:139-168` `outlineStage` consumes validated `CurationResult`; non-empty markdown `outline` required; fail-loud `stageError` + `assertKnownEvidence`; tests `plugins/content-gen/tests/storm.test.ts:122-164` |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario R1 — Curation builds multiple grounded perspectives | MET | test | `plugins/content-gen/tests/storm.test.ts:61-72` deterministic (fake runner, no LLM/network); single-perspective rejection `:74-81`; real-runner end-to-end `:203-221` — shipped boundary unwraps the envelope (`storm.ts:54`) so the scenario holds for real runs |
| Scenario R2 — Outline generation uses the curated evidence | MET | test | `plugins/content-gen/tests/storm.test.ts:123-139` — prompt embeds curation result (`perspective-1` asserted); outline derived from it |
| Scenario R3 — Failed or malformed stage fails loud | MET | test | `plugins/content-gen/tests/storm.test.ts:84-119,142-164` — malformed output, unknown doc ID, non-zero exit all reject with stage-prefixed diagnostics before downstream use |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
**Priority Table**

| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P1 | Correctness (R1) | `plugins/content-gen/src/storm.ts:24-46` | `spurStageRunner` returns the raw CLI process result without unwrapping the `spur agent run --json` envelope. The CLI writes `{exitCode, stdout, stderr, durationMs}` to stdout (`spur-new/packages/app/src/services/agent-service.ts:1254-1264`); the stages then feed `envelope.stdout` (the envelope JSON, not the agent output) to `parseAgentJson`/zod (`storm.ts:110-138,143-172`) — every successful real run throws `Curation stage failed: malformed output` / `Outline stage failed: malformed output`. The D2 stand-in the code claims to mirror unwraps first (`plugins/content-gen/src/index.ts:44-45` → `JSON.parse(stdout)` then `envelope.stdout`). The R1 boundary test (`tests/storm.test.ts:154-175`) asserts the runner passes the envelope through, and the stage tests inject a fake runner returning the already-unwrapped shape — the seam hides the contract mismatch. Verified by simulation: `parseAgentJson('{"exitCode":0,"stdout":"{...perspectives...}","stderr":"","durationMs":1234}')` yields keys `[exitCode,stdout,stderr,durationMs]`, no `perspectives` → schema rejection. Fix: in `runStage`, `JSON.parse(stdout)` and return `{exitCode, stdout, stderr}` from the nested envelope; add an integration test connecting `spurStageRunner` to a stage. |
| P3 | Correctness (R2) | `plugins/content-gen/src/storm.ts:57-59` | `CurationResultSchema.perspectives` is `.min(1)`; R2 requires "multiple perspectives" and the prompt says "multiple distinct perspectives", but a single-perspective result passes validation. Test fixture happens to use 2 (`tests/storm.test.ts:25-38`), so the gap is unenforced. Use `.min(2)`. |
| P4 | Maintainability | `plugins/content-gen/src/storm.ts:79-85` | `parseAgentJson` duplicates the D2 stand-in's fenced-block / outermost-`{}` extraction (`plugins/content-gen/src/index.ts:36-40`). Two copies of the same tolerance logic; co-locate a shared helper at/after the 0047 cutover. |
| P4 | Documentation | `docs/tasks/0046_build-grounded-storm-curation-and-outline-stages.md` Solution | Stale line anchor `storm.ts:148-177` — file is 172 lines; `outlineStage` is `storm.ts:143-172`. Surfaced by `spur task check 0046` L4 warning this run. |

**Per-Requirement Traceability**

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | PARTIAL | `storm.ts:19-21` injected `StormStageRunner` seam; `storm.ts:24-46` `spurStageRunner` invokes `spur agent run <prompt> --agent auto --mode text --json --cwd` (shape verified against `spur agent run --help` and `index.ts:32-45`); zod validation before use at `storm.ts:110-138,143-172`; deterministic fake-runner tests at `tests/storm.test.ts:42-47` (10 tests pass, 100% line coverage — `bun test plugins/content-gen/tests/storm.test.ts` run this turn). MISSING: the concrete runner never unwraps the `--json` envelope (P1), so the invoked boundary is unusable in real runs — material sub-condition of "invokes the existing Spur agent boundary" is broken. |
| R2 | MET | `storm.ts:95-104` `groundedStagePrompt` treats docs as untrusted and forbids external retrieval; `storm.ts:87-92` `assertKnownEvidence` rejects unknown document IDs; `storm.ts:110-138` `curationStage` (corpus-only, no retrieval path exists); tests `tests/storm.test.ts:60-105`. |
| R3 | MET | `storm.ts:143-172` `outlineStage` consumes the validated `CurationResult`, `OutlineResultSchema` requires non-empty markdown `outline`; fail-loud via `stageError` + `assertKnownEvidence`; tests `tests/storm.test.ts:107-146`. |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| Scenario R1 — Curation builds multiple grounded perspectives | PARTIAL | test | `tests/storm.test.ts:60-72` deterministic, no LLM/network (fake runner); evidence traceability works through the injected runner — but the real-run path throws on every successful run (P1), so the scenario holds only for injected runners, not the shipped boundary |
| Scenario R2 — Outline generation uses the curated evidence | MET | test | `tests/storm.test.ts:107-115` — prompt embeds the curation result (`perspective-1` asserted); outline derived from it |
| Scenario R3 — Failed or malformed stage fails loud | MET | test | `tests/storm.test.ts:73-105,116-146` — malformed output, unknown doc ID, and non-zero exit all reject with stage-prefixed diagnostics (`Curation stage failed:` / `Outline stage failed:`) before any downstream use |

**Design Conformance**

| Check | Status | Evidence |
| --- | --- | --- |
| design-conformance | pass | 8/8 design claims DONE: typed primitives in `plugins/content-gen` (`storm.ts`); one shared injected runner (`storm.ts:19-21,24-46`); one structured `spur agent run` call per stage with zod validation (`storm.ts:110-138,143-172`); fake-runner tests (`tests/storm.test.ts`); untrusted/no-retrieval prompt (`storm.ts:95-104`); no plugin manifest, public schema, or `kk invoke` change (git status: only new `storm.ts` + `storm.test.ts` + docs). P1 is a correctness defect in the concrete runner, not a design deviation. |

**Architecture Depth (code-improvement lens)**

| # | Severity | Signal | Location | Finding |
| --- | --- | --- | --- | --- |
| C1 | minor (advisory) | tight coupling | `storm.ts:24-46` vs `index.ts:32-45` | Two encodings of the `spur agent run` boundary + envelope contract; if the CLI contract changes, both must change. Transient — 0047 replaces the stand-in; no blocker/major candidates. |
| C2 | advisory | weak locality | `storm.ts:79-85` vs `index.ts:36-40` | JSON-extraction tolerance duplicated; co-locate at/after 0047 cutover. |

**Verdict: FAIL** — P1 blocker: the concrete `spurStageRunner` never unwraps the `spur agent run --json` envelope, so both stages fail with "malformed output" on every successful real run. Functional verdict PARTIAL (R1), SECUA verdict FAIL (P1), architecture no blockers. Remediation: unwrap the envelope in `runStage` (mirror `index.ts:44-45`) and add a test connecting the real runner to a stage; re-run `bun test plugins/content-gen/tests/storm.test.ts`. Task stays at `wip`; verify stage (`/sp-dev-verify 0046 --fix blockers-first`) or operator decides disposition.
### References

D4

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-08-12T13:59:47.688Z todo → wip (system)
- 2026-08-12T14:12:04.230Z wip → testing (system)
- 2026-08-12T14:12:14.217Z testing → done (system)
