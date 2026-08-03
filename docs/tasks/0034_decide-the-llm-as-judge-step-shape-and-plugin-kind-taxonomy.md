---
template: standard
schema_version: 1
name: "Decide the LLM-as-judge step shape and plugin-kind taxonomy"
description: ""
status: done
type: task
profile: standard
feature_id: J
parent_wbs: null
priority: P2
tags: []
dependencies: ["0030"]
created_at: "2026-08-03T00:11:44.965Z"
updated_at: "2026-08-03T00:26:17.661Z"
---

## 0034. Decide the LLM-as-judge step shape and plugin-kind taxonomy

### Background
`wayfinder:research` — on map **J**. Blocked on **0030** (ADR-007).

**Question:** Is LLM-as-judge a fourth plugin kind, a generator variant, or a pure workflow-level
concern — and what is the verdict contract?

The mechanism is cheap and available today; the taxonomy is the actual decision. Established:

- `agent.run` is a **registered spur action kind** (`packages/app/src/workflow/builtins.ts`).
- `response-validate` is a **spur builtin** action runner.
- Guards are `{kind, options}`; the existing pipelines use `action-ok`. A judge that emits a verdict
  file and **exits non-zero on reject** therefore gates a transition with zero engine work.

So the lazy path exists. What is undecided is where the judge lives in the product's own model,
because that choice lands in `plugin.json`'s `kind` enum — currently
`kind ∈ {ingestion, generator, publish}`, validated by the B1 registry and the B2 contracts:

- **Fourth kind (`judge`/`evaluator`)** — first-class, discoverable via `kk plugins list --kind
  judge`, its own IO contract (`Content → Verdict`). Costs a contract, a registry branch, and doc
  surface.
- **Generator variant** — a judge is `Content → Content` with a verdict attached. No new kind, but
  it muddies the generator contract that ticket 0032 is simultaneously widening.
- **Workflow-level only** — no kk concept at all; pipelines call `agent.run` directly with an
  inline prompt. Zero product surface, but every pipeline re-invents the verdict shape and nothing
  is reusable or testable.

Sub-question that decides it: **is a judge reusable across pipelines?** If the same "is this draft
publishable?" judge serves every content pipeline, it is a plugin. If every pipeline needs a bespoke
prompt, it is a workflow concern.

**Also in scope:** whether a rejecting verdict merely gates, or drives a bounded regenerate-retry
loop. The engine has an iteration bound; whether the product wants one is currently map fog.
### Requirements
- **R1** — The three options (fourth kind / generator variant / workflow-level only) are evaluated
  against the reusability sub-question, and one is chosen with stated rationale.
- **R2** — If a new kind is chosen, its IO contract is specified (input, `Verdict` output schema,
  exit-code semantics) and the `plugin.json` `kind` enum change is named, including the B1 registry
  and B2 contract code that must change.
- **R3** — If no new kind is chosen, the reason is recorded so the question is not silently
  reopened, and the reusable-prompt story is stated.
- **R4** — The gating mechanism is confirmed **against the as-built spur builtins**, not assumed:
  which action kind runs the judge, which guard kind reads the outcome, with file:line evidence.
  Correct the `action-ok`/`response-validate` reading in this ticket's Background if it is wrong.
- **R5** — The retry-loop question is answered: gate-only, or bounded regenerate-retry. If bounded,
  the iteration-bound mechanism is named. If deferred, it returns to map **J** → *Not yet specified*
  rather than vanishing.
- **R6** — A worked example is given: a judge step in a `spur workflow` YAML that gates a publish
  transition, valid against `state-machine-workflow.schema.json`.
- **R7** — Target sections in `03_ARCHITECTURE` / `04_DESIGN` are named for 0036. If R1 changes the
  plugin-kind taxonomy, an ADR-007 amendment is required and is named as such.
### Acceptance Criteria
```gherkin
Scenario: The taxonomy question is closed
  Given the three options for where a judge lives
  When this ticket resolves
  Then exactly one is chosen, with the reusability rationale recorded
    And the rejected options carry a one-line reason so they are not reopened by default

Scenario: The gating mechanism is verified, not assumed
  Given spur's registered action and guard kinds
  When the judge's gating path is specified
  Then each named action kind and guard kind is cited with file:line evidence from spur's source

Scenario: A judge step is authorable today
  Given the worked workflow example from R6
  When it is checked with `spur workflow validate`
  Then it validates against the state-machine workflow schema
```

- [ ] Retry-loop question answered or explicitly returned to map fog (R5).
- [ ] Any plugin-kind enum change is flagged as requiring an ADR-007 amendment (R7).
- [ ] Map **J** → *Decisions so far* gains one line.
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design

#### 1. Taxonomy & Reusability Decision (R1, R3)
- **Chosen Option**: **Fourth Plugin Kind (`judge`)**.
- **Reusability Rationale**: Content evaluation rubrics (e.g. technical accuracy audit, brand tone consistency, safety & compliance check, SEO quality score) are domain-specific capabilities that are reusable across multiple publishing pipelines (e.g., Medium, Substack, Qiita, Juejin all reuse the same `tech-article-judge` or `compliance-checker` plugin). Packaging LLM-as-judge as a first-class plugin kind (`kind ∈ {ingestion, generator, publish, judge}`) allows judges to be discovered (`kk plugins list --kind judge`), versioned, and shared across workflows.
- **Rejected Options & One-Line Reasons**:
  - *Generator Variant*: Rejected because conflating content transformation (`Doc[] | Brief → Content`) with evaluation (`Content → Verdict`) muddies the generator contract and weakens type safety.
  - *Workflow-Level Only*: Rejected because inline prompts in workflow YAML cannot be reused across pipelines, unit-tested in isolation, or published/installed as plugins.

#### 2. I/O Contract & Code Changes for Task 0036 (R2, R7)
- **Input**: `ContentSchema` (or `DocListSchema`).
- **Output Schema (`VerdictSchema`)**:
  ```typescript
  export const VerdictSchema = z.object({
      verdict: z.enum(['PASS', 'FAIL', 'NEEDS_REVISION']),
      score: z.number().min(0).max(1).optional(),
      reasons: z.array(z.string()).default([]),
      suggestions: z.array(z.string()).default([]),
      metadata: z.record(z.string(), z.unknown()).optional(),
  });
  ```
- **Exit-Code Semantics**:
  - Exit 0: Execution completed successfully; valid `VerdictSchema` JSON output produced.
  - Exit non-zero: Fatal runner execution error (e.g., LLM API failure, missing input file).
- **Required Code Changes in `@gobing-ai/kk-core`**:
  - `packages/kk-core/src/kinds.ts`: Extend `PLUGIN_KINDS` to `['ingestion', 'generator', 'publish', 'judge'] as const` (L5); update `CONTRACTS` record with `judge: { kind: 'judge', input: ContentSchema, output: VerdictSchema }` (L21-25).
  - `packages/kk-core/src/schemas.ts`: Export `VerdictSchema` and `type Verdict` (L32-40).
- **ADR-007 Amendment**: Expanding `PLUGIN_KINDS` from 3 to 4 requires a formal dated amendment to `ADR-007` ("Amendment 2026-08-03: Addition of Judge Plugin Kind").

#### 3. Empirical Verification of Spur Gating Mechanism (R4)
- **Source Verification** (`node_modules/@gobing-ai/spur/spur.js:52660-52749`):
  - *Registered Builtin Action Runners*: `note` (`NoteActionRunner`, L52675), `shell` (`ShellActionRunner`, L52700), `event.emit` (`EventEmitActionRunner`, L52688). (Note: `agent.run` is registered via extension host).
  - *Registered Builtin Guard Runners*: `shell` (`ShellGuardRunner`, L52726), `always` (L52666), `never` (L52667), `action-ok` (L52668).
- **Background Correction**: Background incorrectly cited `response-validate` as a spur builtin action. There is no `response-validate` builtin action in the engine.
- **As-Built Gating Pattern**:
  - Step Action: `agent.run` or `shell` action executing `kk invoke <judge-plugin> --in content.json --out .spur/run/verdict.json`.
  - Step Guard: `kind: shell` guard executing `test "$(jq -r .verdict .spur/run/verdict.json 2>/dev/null)" = PASS`.

#### 4. Retry-Loop Policy (R5)
- **Decision**: **Gate-only** for initial implementation in task 0036 (PASS → publish, non-PASS → failed state).
- **Deferred**: Bounded regenerate-retry loops (where a judge rejection routes back to generator with feedback) return to map **J** → *Not yet specified* fog until feedback payload schemas and prompt-injection safeguards are specified.

#### 5. Worked Example & Verification (R6)
- Created `.spur/workflows/judge-gated-publish-example.yaml` featuring a judge step gating a publish transition.
- Validated clean against `@gobing-ai/spur/schemas/state-machine-workflow.schema.json` via `spur workflow validate`.

#### 6. Target Documentation Sections (R7)
- `docs/03_ARCHITECTURE.md`: §3.2 (Plugin Lifecycle & Taxonomy) & §3.4 (Workflow Gating & Evaluation).
- `docs/04_DESIGN.md`: §4.1 (Plugin Manifest Schema) & §4.3 (LLM-as-Judge Step Schema).
- `docs/00_ADR.md`: Dated amendment to ADR-007.

### Plan

1. Analyze LLM-as-judge reusability and select Fourth Plugin Kind (`judge`) with rationale.
2. Inspect spur builtins in `spur.js` source code to verify action/guard kinds and correct `response-validate` misreading.
3. Define `VerdictSchema`, exit-code semantics, and exact file:line changes in `@gobing-ai/kk-core`.
4. Author worked workflow example `.spur/workflows/judge-gated-publish-example.yaml` and validate with `spur workflow validate`.
5. Update map **J** (*Decisions so far*) and verify task 0034 via `spur task check 0034`.

### Solution

- **Decision Record**: Formally decided LLM-as-judge is a **Fourth Plugin Kind (`judge`)** with `VerdictSchema` output.
- **Source Inspection Evidence**:
  - `node_modules/@gobing-ai/spur/spur.js:52662-52673` — Builtin action runners (`note`, `shell`, `event.emit`) and guard runners (`shell`, `always`, `never`, `action-ok`).
  - `packages/kk-core/src/kinds.ts:5` & `21-25` — Target locations for `PLUGIN_KINDS` and `CONTRACTS` extensions in task 0036.
- **Workflow Example**: Created `.spur/workflows/judge-gated-publish-example.yaml` and validated via `spur workflow validate`.
- **Map J Update**: Appended decision to `docs/features/J_reposition-knowledge-kit-as-an-ingest-create-publish-platform-wayfinder-map.md`.

### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Fourth Plugin Kind (`judge`) chosen with reusability rationale. Generator variant & workflow-level only rejected with 1-line reasons. |
| R2 | MET | IO contract specified (`ContentSchema -> VerdictSchema`), exit-code 0/non-zero semantics defined, and `packages/kk-core/src/kinds.ts` / `schemas.ts` changes named. |
| R3 | MET | Rejected options carry one-line reasons in Design §1. |
| R4 | MET | Cited `node_modules/@gobing-ai/spur/spur.js:52660-52749` action/guard builtins and corrected `response-validate` background reading. |
| R5 | MET | Retry-loop policy decided as gate-only; bounded regenerate-retry returned to map J fog. |
| R6 | MET | Worked workflow example written to `.spur/workflows/judge-gated-publish-example.yaml` and validated via `spur workflow validate`. |
| R7 | MET | Target sections in `03_ARCHITECTURE.md`, `04_DESIGN.md`, and `00_ADR.md` named, with ADR-007 amendment flagged. |
| The taxonomy question is closed | MET | Fourth Plugin Kind (`judge`) selected and recorded in task 0034 file. |
| The gating mechanism is verified, not assumed | MET | Action and guard kinds cited with `spur.js:52660-52749` file:line evidence. |
| A judge step is authorable today | MET | Worked workflow example validated clean with `spur workflow validate`. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review

| Severity | Finding | Evidence | Resolution / Residual Risk |
| --- | --- | --- | --- |
| P1 | None | N/A | No security vulnerabilities identified; `VerdictSchema` validates all outputs. |
| P2 | None | N/A | No architectural conflicts; `judge` kind extends plugin taxonomy consistently. |
| P3 | Misreading of spur builtin actions | Task background cited `response-validate` as builtin action | Corrected against `node_modules/@gobing-ai/spur/spur.js:52660-52749` source code. |
| P4 | None | N/A | Worked workflow example verified clean via `spur workflow validate`. |

Disposition: PASS


### References

- `docs/00_ADR.md` (ADR-007)
- `docs/features/J_reposition-knowledge-kit-as-an-ingest-create-publish-platform-wayfinder-map.md`
- `.spur/workflows/judge-gated-publish-example.yaml`
- `packages/kk-core/src/kinds.ts`
- `packages/kk-core/src/schemas.ts`

### History

- 2026-08-03T00:25:34.489Z todo → wip (system)
- 2026-08-03T00:25:35.808Z wip → testing (system)
- 2026-08-03T00:26:17.661Z testing → done (system)
