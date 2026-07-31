---
template: standard
schema_version: 1
name: "Decide generator entry mechanism and Content mapping conventions"
description: ""
status: done
type: task
profile: standard
feature_id: D3
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: "2026-07-30T23:41:42.492Z"
updated_at: "2026-07-31T00:33:34.174Z"
---

## 0016. Decide generator entry mechanism and Content mapping conventions

### Background



### Requirements
- R1. Skill-backed entry mechanism decided (executable wrapper CLI vs generated shim vs invoke change — the last escalates to an ADR note), with rationale and argv/env contract for the plugin author.
- R2. Doc[]→Content field conventions defined against ContentSchema as built: `format` (default markdown), `outline`, `references`, `metadata` usage; no schema changes.
- R3. Stand-in vs own-engine selection criteria recorded (D1 research as input; explicit conditions for switching to D4).
- R4. Generator failure semantics defined — empty DocList input, engine failure, invalid output — each with an explicit exit-code and output-file contract (fail-loud per ADR-006 + C1 §1.4).
### Acceptance Criteria
```gherkin
Feature: Generator plugin design

  Scenario: Content mapping conventions are specified
    Given the Content schema in kk-core
    When the design defines Doc[]-to-Content field conventions
    Then format, outline, references, and metadata usage are defined without schema changes

  Scenario: Skill-backed entry mechanism is decided
    Given runInvoke spawns executable entries with --in/--out
    When the design names how an agent-skill generator runs under kk invoke
    Then a plugin author can implement the entry without changes to runInvoke

  Scenario: Stand-in versus own-engine criteria are specified
    Given the D1 research (stand-in = wt:technical-content-creation stages 0-3)
    When the design records selection criteria
    Then the conditions for switching from stand-in to own engine (D4) are explicit

  Scenario: Generator failure semantics are specified
    Given the fail-loud mandate (ADR-006) and C1 generic contract section 1.4
    When the design covers empty DocList input, engine failure, and invalid output
    Then each case has an explicit exit-code and output-file contract
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
#### 1. Skill-Backed Entry Mechanism Decision (R1)
- **Decision**: Executable CLI Wrapper in Node/Bun (`./src/index.ts` / `./bin/run.js`) inside the generator plugin directory.
- **Rationale**: `runInvoke` spawns plugin entry scripts using `[execPath, entryPath, '--in', absInPath, '--out', absOutPath]` without requiring modifications to `@gobing-ai/knowledge-kit` core.
- **Contract for Plugin Author**:
  - The plugin directory contains `plugin.json` (`kind: "generator"`, `entry: "./src/index.ts"`).
  - The entry executable reads `Doc[]` JSON from `--in` and writes `Content` JSON to `--out`.
  - For agent skill-backed execution (e.g. `wt:technical-content-creation` stand-in), the CLI wrapper reads input `Doc[]`, formats stage 0 material inputs, invokes the agent skill engine (or helper script/CLI), parses the resulting article markdown, and constructs the valid `Content` output written to `--out`.

#### 2. Doc[] → Content Mapping Conventions (R2)
Conventions mapped to `ContentSchema` (`{ body, title?, format?, outline?, references?, metadata? }`) without schema changes:
- `body`: Aggregated/generated markdown article content (required).
- `title`: Extracted article title or primary doc title; defaults to "Generated Knowledge Kit Synthesis".
- `format`: Defaults to `"markdown"` (per `ContentSchema` default).
- `outline`: Formatted markdown outline string (extracted from stage 2 outline or generator engine output).
- `references`: Array of `{ url, title, cite }` constructed from `Doc.sourceUri`, `Doc.title`, and `Doc.id` / `metadata`.
- `metadata`: Preserves vendor-specific / generator metadata (e.g. `generator: "wt:technical-content-creation"`, `stageCount: 4`, `docIds: string[]`).

#### 3. Stand-in vs Own-Engine Selection Criteria (R3)
- **Phase 1 Stand-in**: `wt:technical-content-creation` (stages 0–3 material intake → research brief → outline → draft).
- **Selection & Switch Criteria to Own Engine (D4 - STORM)**:
  - Switch when persona-driven multi-perspective curation or DSPy-based iterative retrieval loop over internal corpus (`KarakeepLocalRM`) is required.
  - Switch when exact per-section citation grounding (`url_to_info`) is required beyond top-level source mapping.

#### 4. Generator Failure Semantics (R4)
- **Empty `DocList` Input (`[]`)**:
  - Writes a valid `Content` object with an explanatory notice body (e.g., `# Notice\nNo documents provided for generation.`) and empty references, returning exit `0`.
- **Engine / Skill Execution Failure**:
  - Emits diagnostic error details to `stderr` (`console.error`) and exits with code `1`. Output file `--out` is NOT written (or deleted if incomplete).
- **Invalid Output**:
  - If output fails `ContentSchema` validation, `runInvoke` catches the schema violation, logs diagnostic details to `stderr`, and exits with a non-zero exit code (ADR-006 & generic contract §1.4).
### Plan
- [x] Record skill-backed entry mechanism decision (Executable CLI Wrapper in `./src/index.ts`) in task design and upcoming spec doc (R1).
- [x] Define `Doc[]` → `Content` field mapping conventions for `body`, `title`, `format`, `outline`, `references`, `metadata` (R2).
- [x] Detail stand-in (`wt:technical-content-creation`) vs own-engine (D4 STORM) transition criteria (R3).
- [x] Specify generator failure semantics (empty input exit 0, engine error exit 1, invalid output schema fail-loud) (R4).
### Solution
#### Change Map
- `docs/tasks/0016_decide-generator-entry-mechanism-and-content-mapping-convent.md:58-87`: Recorded decisions for R1 (skill-backed entry via CLI wrapper in `./src/index.ts`), R2 (`Doc[]` → `Content` field mapping conventions without schema changes), R3 (stand-in `wt:technical-content-creation` vs D4 STORM criteria), and R4 (generator failure semantics fail-loud per ADR-006).
### Testing
Re-verified 2026-07-31 via `/sp-dev-verify 0016 --auto --force --focus all --fix all` (audit of terminal task).

**Commands run (this run)**
- `spur task check 0016 --strict-core --json` → exit 0, `pass: true`, no findings.
- `spur feature check D3 --json` → exit 0 (pre-fix: 6× `L4.scenario-unverified`; post-fix re-run below).
- Anchor re-reads this run: `apps/cli/src/invoke.ts`, `packages/kk-core/src/schemas.ts`, `packages/kk-core/src/kinds.ts`, `docs/design/ingestion-plugin-specification.md` §1.4, `docs/00_ADR.md` ADR-006, `docs/tasks/0001_…` D1 decision.

**Per-Requirement Traceability**

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | Decision recorded `docs/tasks/0016_….md:58-64`; spawn contract re-read `apps/cli/src/invoke.ts:90-94` (`[execPath, entryPath, '--in', absIn, '--out', absOut]`, no core change); kind contract `packages/kk-core/src/kinds.ts:23` (generator: in DocListSchema → out ContentSchema) |
| R2 | MET | Conventions recorded `docs/tasks/0016_….md:66-73`; `ContentSchema` re-read `packages/kk-core/src/schemas.ts:14-30` — `body` required, `title?`, `format` default `'markdown'` (:17), `outline?`, `references?[{url?,title?,cite?}]`, `metadata?` — mapping needs zero schema changes |
| R3 | MET | Criteria recorded `docs/tasks/0016_….md:75-79` with two explicit D4 switch conditions; D1 research input confirmed `docs/tasks/0001_….md:69-71` (stand-in = `wt:technical-content-creation` stages 0–3) |
| R4 | MET | Semantics recorded `docs/tasks/0016_….md:81-87`; engine failure → stderr + non-zero propagation re-read `apps/cli/src/invoke.ts:103-113`; missing/invalid output → exit 1 `:115-119`, `:133-139`; empty `[]` passes input validation `:43-66`; exit contract §1.4 `docs/design/ingestion-plugin-specification.md:28-30`; fail-loud ADR-006 `docs/00_ADR.md:116` |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| Content mapping conventions are specified | MET | static-ref + command | `packages/kk-core/src/schemas.ts:14-30` re-read this run; `spur task check 0016 --strict-core` exit 0 |
| Skill-backed entry mechanism is decided | MET | static-ref + command | `apps/cli/src/invoke.ts:90-94` re-read this run; plugin author needs no runInvoke change |
| Stand-in versus own-engine criteria are specified | MET | static-ref | `docs/tasks/0016_….md:75-79`; D1 input `docs/tasks/0001_….md:69-71` |
| Generator failure semantics are specified | MET | static-ref + command | `apps/cli/src/invoke.ts:103-139` re-read this run; §1.4 `docs/design/ingestion-plugin-specification.md:28-30` |

**Design Conformance**

| Check | Status | Evidence |
|-------|--------|----------|
| design-conformance | pass | 4/4 Design claims DONE (§1–§4 match diff); Plan 4/4 checked; Solution change-map anchor corrected this run (stale `:32-62` → `:58-87`) |
| scope-creep | pass | Diff hunks all map to Requirements/Design/Plan/Review; none unmapped |

**SECUA Review** — S: doc-only, no secrets/injection surface. E: N/A. C: all design claims match as-built code; engine-failure exit code is plugin-propagated (`invoke.ts:108-110`), consistent with design. U: argv/env contract stated for plugin author. A: decision keeps core untouched, seam at plugin boundary per ADR-006. No blocker/major findings. Minor (P4): spec authoring deferred to 0017 (already tracked in Review).

**Fix-pass disclosure (`--fix all`)**
- `.spur/run/0016-verdict.json` rewritten schema-conformant: requirement statuses `pass`→`MET`; AC rows `title`→`id` keyed to exact feature scenario titles; added `evidenceType`, design-conformance/scope-creep check rows (previously absent → caused 4× `L4.scenario-unverified` in `spur feature check D3`).
- `### Solution` change-map anchor corrected via `spur task update 0016 --section Solution` (`:32-62` → `:58-87`).
- No follow-up tasks created (spec authoring already tracked as 0017).

Coverage: N/A (design-decision task; zero production code modified).
### Review
| Severity | Finding | Location | Status |
| --- | --- | --- | --- |
| P4 | Decisions need formal spec authoring in task 0017 | `docs/tasks/0017_author-generator-plugin-specification-and-validate-agains.md` | Tracked in task 0017 |

#### Residual Risk & Final Disposition
- Decisions fully documented and aligned with platform contract. Zero residual risk. Approved for `done`.
### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History
- 2026-07-31T00:27:09.469Z todo → wip (system)
- 2026-07-31T00:27:10.882Z wip → testing (system)
- 2026-07-31T00:27:12.534Z testing → done (system)
