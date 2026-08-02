---
template: standard
schema_version: 1
name: "Harden surfdash-pub failure modes"
description: ""
status: done
type: task
profile: standard
feature_id: E3
parent_wbs: null
priority: P2
tags: []
dependencies: ["0024"]
created_at: "2026-07-30T23:48:35.444Z"
updated_at: "2026-08-02T21:55:48.711Z"
---

## 0025. Harden surfdash-pub failure modes

### Background



### Requirements
- R1. Transport failure → non-zero exit plus Result ok: false carrying the error.
- R2. postsurfing non-zero exit is mapped to a fail-loud Result — never swallowed (the wt always-exit-0 anti-pattern).
- R3. Malformed Content input is rejected by invoke's input validation before the entry runs (contract.input = ContentSchema); the plugin never sees invalid input.
- R4. Each failure mode has an automated test.
### Acceptance Criteria
```gherkin
Feature: Surfdash publisher tested

  Scenario: Transport failure produces a fail-loud Result
    Given the postsurfing transport fails
    When the plugin runs
    Then it exits non-zero and the Result carries ok false with the error
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
- **Transport Failure handling**: PostsurfingFileCliTransport catches execution/spawn errors and non-zero exit codes from postsurfing, returning a parsed ResultSchema with `ok: false` and the descriptive error message.
- **Fail-loud on non-zero exit**: `processPublishIO` checks `validatedResult.ok`. If `false`, it writes the complete `Result` JSON artifact with `ok: false` and error details to output before throwing `Error(validatedResult.error)`, producing non-zero exit code in `main()`.
- **Validation before entry run**: `runInvoke` (in `apps/cli/src/invoke.ts`) resolves `contract.input` (`ContentSchema` for publish kind), reads input file, parses JSON, and performs `contract.input.safeParse(json)`. If validation fails, `runInvoke` logs schema violations and exits with code 1 before ever spawning the plugin process.
### Plan
- [x] Step 1: Precheck & audit existing surfdash-pub error handling and input validation in invoke CLI.
- [x] Step 2: Ensure transport failure returns non-zero exit plus Result `ok: false` carrying error (R1).
- [x] Step 3: Ensure postsurfing non-zero exit maps to fail-loud Result (R2).
- [x] Step 4: Ensure input validation rejects malformed Content before plugin execution (R3).
- [x] Step 5: Verify automated unit and integration tests cover each failure mode (R4).
- [x] Step 6: Execute full verification gate (`bun run spur-check`).
### Solution
- `plugins/surfdash-pub/src/index.ts:85-135`: `PostsurfingFileCliTransport.publish()` catches spawn/execution errors and non-zero CLI exits, returning `Result` with `ok: false` and error message.
- `plugins/surfdash-pub/src/index.ts:152-174`: `processPublishIO()` writes output `Result` file before throwing on `!validatedResult.ok`, guaranteeing non-zero process exit alongside error result output.
- `apps/cli/src/invoke.ts:65-74`: `runInvoke()` validates input against `contract.input` (`ContentSchema`) before spawning the plugin entry point.
- `plugins/surfdash-pub/tests/surfdash-pub.test.ts:67-95`: Unit tests for missing binary and CLI exit 1.
- `plugins/surfdash-pub/tests/surfdash-pub.test.ts:149-181`: Unit test for `processPublishIO` fail-loud behavior.
- `apps/cli/tests/invoke.test.ts:28-40`: Integration test verifying schema validation rejects malformed input before spawning entry.
### Testing
- Verdict: **PASS** (re-verified under `--force`; fresh gate run this turn)
- Commands run (fresh evidence):
  - `bun run spur-check`: Biome lint + typecheck passed; **76 tests pass, 0 fail** across 14 files (includes `apps/cli/tests/invoke.test.ts` + `plugins/surfdash-pub/tests/surfdash-pub.test.ts`); post-check rules passed.
  - Coverage for `plugins/surfdash-pub/src/index.ts`: 100.00% lines / 93.33% functions (gate ≥ 90% — PASS).

**Per-Requirement Traceability**

| Req | Status | Evidence |
|---|---|---|
| R1 | MET | `plugins/surfdash-pub/src/index.ts:169-173` — `processPublishIO` writes the error Result file then throws on `!validatedResult.ok`; `plugins/surfdash-pub/src/index.ts:189-200` — `main()` catch returns 1 → `process.exit(1)`. Test: `plugins/surfdash-pub/tests/surfdash-pub.test.ts:149-181` (rejects with error + `ok:false` Result on disk) |
| R2 | MET | `plugins/surfdash-pub/src/index.ts:112-118` — non-zero postsurfing exit mapped to `ok:false` Result carrying exit code + stderr (never swallowed). Test: `plugins/surfdash-pub/tests/surfdash-pub.test.ts:76-95` (mock binary exit 1 → error `"postsurfing CLI failed (exit 1): CLI error"`) |
| R3 | MET | `apps/cli/src/invoke.ts:65-73` — `contract.input.safeParse(json)` rejects malformed input with exit 1 before entry resolution/spawn (`apps/cli/src/invoke.ts:82`). Test: `apps/cli/tests/invoke.test.ts:79-116` "R2 — fails before entry spawn when input violates kind schema" (marker file never written) |
| R4 | MET | All four failure modes covered: missing binary `plugins/surfdash-pub/tests/surfdash-pub.test.ts:67-74`; CLI non-zero exit `:76-95`; transport failure via processPublishIO `:149-181`; malformed input `apps/cli/tests/invoke.test.ts:79-116` |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
|---|---|---|---|
| Scenario: Transport failure produces a fail-loud Result | MET | test | `plugins/surfdash-pub/tests/surfdash-pub.test.ts:149-181` — `processPublishIO` rejects with `'Simulated postsurfing CLI failure'` and the written Result parses with `ok:false` + error; non-zero exit via `main()` at `plugins/surfdash-pub/src/index.ts:192-195` |

**Design Conformance**

| Check | Status | Evidence |
|---|---|---|
| design-conformance | pass | 3/3 claims DONE — transport catch + `ok:false` (`plugins/surfdash-pub/src/index.ts:112-118,126-131`); write-then-throw fail-loud (`plugins/surfdash-pub/src/index.ts:169-173`); validate-before-spawn (`apps/cli/src/invoke.ts:65-73`) |

**SECUA Review (focus: all)**

- No blocker / major findings. C: every failure path produces a schema-valid Result and a non-zero exit — no swallowed errors; U: schema violations logged with path-level issue detail (`apps/cli/src/invoke.ts:67-70`); S/A: validation at the trust boundary before any spawn; `processExit` injectable for tests.
- Advisory (P3, citation drift): Solution change map cites `apps/cli/tests/invoke.test.ts:28-40` for the malformed-input test; the actual test is at `apps/cli/tests/invoke.test.ts:79-116` (28-40 is the R1 happy-path test). Evidence above uses the corrected anchor; Solution section left untouched (implement-owned).

**Fix pass (`--fix all`)**: nothing to repair in code — no UNMET/PARTIAL rows, no major findings. Repaired verdict artifact shape: `.spur/run/0025-verdict.json` (rewritten this run; `acceptanceCriteria` rows added with ids matching feature scenario titles so `spur feature check` marks scenarios verified — confirmed: feature check findings cleared).
### Review

| Priority | Finding | Action / Resolution |
| --- | --- | --- |
| P4 | Pre-execution schema validation prevents plugin execution on invalid input | Verified in `apps/cli/src/invoke.ts` and unit tests |
| P4 | Non-zero CLI exits and spawn errors propagate to `Result` with `ok: false` | Verified in `plugins/surfdash-pub/src/index.ts` and unit tests |

None.

APPROVED.
### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History
- 2026-08-02T21:14:45.890Z todo → wip (system)
- 2026-08-02T21:14:47.799Z wip → testing (system)
- 2026-08-02T21:14:48.076Z testing → done (system)
