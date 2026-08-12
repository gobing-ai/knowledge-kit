---
template: standard
schema_version: 1
name: "Harden content-gen failure semantics"
description: ""
status: done
type: task
profile: standard
feature_id: D
parent_wbs: null
priority: P2
tags: []
dependencies: ["0022"]
created_at: "2026-07-30T23:48:00.337Z"
updated_at: "2026-08-12T01:20:21.733Z"
---

## 0023. Harden content-gen failure semantics

### Background



### Requirements
- R1. A failing stand-in stage → non-zero exit with the error on stderr.
- R2. Empty DocList input → behavior matching the generator spec failure contract (exit code + output).
- R3. Stand-in output that violates the mapping is surfaced as an error, never silently written.
- R4. Each failure mode has an automated test.
### Acceptance Criteria
```gherkin
Feature: Wire existing generator skill to contract

  Scenario: Engine failure fails loud
    Given a stand-in stage fails for an input
    When the plugin runs
    Then it exits non-zero and the error reaches stderr

  Scenario: Empty input follows the generator failure contract
    Given an empty DocList input file
    When the plugin runs
    Then its exit code and output match the generator spec failure semantics
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
- **Failure & Diagnostics Semantics**: Fail-loud per ADR-006 and generator plugin spec §2.5.
- **Failing Engine Stage**: Non-zero exit code `1` with diagnostic message printed to `stderr` via `console.error` in `processGeneratorIO` and `main` (R1).
- **Empty `DocList` Input (`[]`)**: `TechnicalContentStandInEngine` constructs a valid `Content` output with notice title (`"Notice"`), markdown notice body (`"# Notice\nNo documents provided for generation."`), empty `references`, and exits `0` (R2).
- **Invalid Mapping Detection**: File access errors and JSON parse errors emit fatal diagnostics to `stderr` and rethrow/exit `1`, preventing silent file generation (R3).
- **Automated Test Suite**: `plugins/content-gen/tests/content-gen.test.ts` exercises all failure modes (R4).
### Plan
- [x] Implement non-zero exit code `1` and stderr diagnostic output on engine failure (R1).
- [x] Implement empty `DocList` (`[]`) notice output with exit code `0` in `TechnicalContentStandInEngine` (R2).
- [x] Implement input file access and malformed JSON error handling to fail loud without silent writes (R3).
- [x] Add automated unit tests in `plugins/content-gen/tests/content-gen.test.ts` for each failure mode (R4).
### Solution
**Change Map**

- `plugins/content-gen/src/index.ts:14-19,83-86` implements the empty-`DocList` notice contract and validates input/output before writing.
- `plugins/content-gen/src/index.ts:47-62,101-107` propagates runner/skill/schema failures, writes diagnostics through the stderr logger, returns exit `1`, and removes stale output.
- `plugins/content-gen/tests/content-gen.test.ts:72-115,135-153,176-191` covers empty input, engine failure diagnostics/non-zero exit/no output, invalid output, malformed input, and the CLI failure path.

**Documented Design Deviation**

- Diagnostics are emitted once by `main` through `@gobing-ai/utils` `logger.error`, rather than duplicated through `console.error` in both IO and CLI layers. The externally observable failure contract is unchanged and the repository no-console constraint is preserved.
### Testing
Re-verified 2026-07-31 with `--force --focus all --fix all` after the bounded repair pass.

**Commands run (fresh)**

- `bun run autofix` -> exit 0; Biome clean and all five workspaces typechecked.
- `bun test plugins/content-gen` -> exit 0; 10/10 tests passed; `plugins/content-gen/src/index.ts` 100% functions / 97.78% lines.
- `bun run spur-check` -> exit 0; 65/65 tests passed; aggregate 100% functions / 97.14% lines; all 31 enabled rules passed.
- `bun run build` -> exit 0; `@gobing-ai/knowledge-kit` bundled successfully.

**Per-Requirement Traceability**

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `plugins/content-gen/src/index.ts:47-59,101-107` converts runner/skill failures into stderr diagnostics and exit `1`; `plugins/content-gen/tests/content-gen.test.ts:86-106,135-142,176-191` verifies propagation. |
| R2 | MET | `plugins/content-gen/src/index.ts:14-19,83-86` writes the schema-valid notice without invoking the skill; `plugins/content-gen/tests/content-gen.test.ts:72-84` verifies exit-path output. |
| R3 | MET | `plugins/content-gen/src/index.ts:56-75,83-86,101-107` validates generated Content and removes stale output before/on failure; `plugins/content-gen/tests/content-gen.test.ts:86-115` proves no output remains. |
| R4 | MET | Automated cases at `plugins/content-gen/tests/content-gen.test.ts:72-115,135-153,176-191` cover empty input, engine failure, invalid output, malformed input, and CLI failure. |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| Engine failure fails loud | MET | test | `plugins/content-gen/tests/content-gen.test.ts:86-106,135-142,176-191`; non-zero result, diagnostic propagation, and absent output asserted. |
| Empty input follows the generator failure contract | MET | test | `plugins/content-gen/tests/content-gen.test.ts:72-84`; valid notice Content and no skill invocation asserted. |

**Design Conformance**

| Check | Status | Evidence |
| --- | --- | --- |
| design-conformance | pass | Empty/failure/invalid-output claims DONE; single logger emission is a documented goal-equivalent Solution deviation from duplicate `console.error` calls. |
| scope-creep | pass | All failure-path changes and tests map to R1-R4. |
| evidence-rule-pass | pass | Both behavior-bearing scenarios have fresh executable evidence. |

**SECUA Review**

- Security: no shell evaluation; agent prompt/source path are argv entries and JSON-escaped.
- Efficiency: output cleanup and validation add bounded IO only.
- Correctness: stale output is removed, all trust boundaries use Zod, and errors remain non-zero with stderr context.
- Usability: one contextual diagnostic avoids duplicate stack noise while retaining the engine message.
- Architecture: failure policy remains at the plugin boundary and reuses the project logger.
- Findings: no blocker, major, or minor findings remain.

**Fix-pass disclosure**

- Repaired failure/output validation at `plugins/content-gen/src/index.ts:47-75,83-107` and executable failure coverage at `plugins/content-gen/tests/content-gen.test.ts:72-191`.
- Rewrote `.spur/run/0023-verdict.json:1` with the post-fix PASS verdict and exact feature-scenario IDs.
- `--next`: no-op - task already terminal (`done`).
### Review
| Severity | Finding | Location | Status |
| --- | --- | --- | --- |
| P4 | Failure semantics strictly align with generator plugin spec §2.5 | `plugins/content-gen/src/index.ts:63` | Resolved |

#### Residual Risk & Final Disposition
- All failure mode requirements R1–R4 covered by automated tests. Approved for `done`.
### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History
- 2026-07-31T17:42:07.061Z todo → wip (system)
- 2026-07-31T17:42:08.818Z wip → testing (system)
- 2026-07-31T17:42:10.472Z testing → done (system)
