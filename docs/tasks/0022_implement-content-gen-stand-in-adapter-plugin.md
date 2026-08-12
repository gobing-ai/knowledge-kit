---
template: standard
schema_version: 1
name: "Implement content-gen stand-in adapter plugin"
description: ""
status: done
type: task
profile: standard
feature_id: D
parent_wbs: null
priority: P2
tags: []
dependencies: ["0017"]
created_at: "2026-07-30T23:48:00.205Z"
updated_at: "2026-08-12T01:20:21.617Z"
---

## 0022. Implement content-gen stand-in adapter plugin

### Background



### Requirements
- R1. `plugins/content-gen` with a valid `plugin.json` (kind=generator, entry per the generator spec mechanism from 0016/0017).
- R2. The adapter maps invoke file IO (docs.json → content.json) to stand-in stages 0–3; output satisfies ContentSchema.
- R3. No modifications to wt-owned skill files — the adapter is the only new code at the boundary.
- R4. A contract test runs `knowledge-kit invoke` over fixtures and produces ContentSchema-valid output (LLM stages mocked at the adapter boundary per the generator spec test strategy).
### Acceptance Criteria
```gherkin
Feature: Wire existing generator skill to contract

  Scenario: Plugin is discoverable and invocable
    Given plugins/content-gen with a valid plugin.json (kind=generator)
    When the registry discovers it and knowledge-kit invoke runs it
    Then the entry executes and writes an output file

  Scenario: Docs become contract-valid Content
    Given a docs.json fixture of valid Docs
    When the plugin runs via knowledge-kit invoke
    Then the output parses against ContentSchema

  Scenario: Stand-in internals are not modified
    Given the wt:technical-content-creation skill is owned by wt
    When the adapter delegates to its stages 0-3
    Then no files under the wt skill are changed
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
- **Architecture**: `plugins/content-gen` generator plugin instance. Implements `{ "kind": "generator", "entry": "./src/index.ts" }` manifest.
- **Stand-in Engine Adapter**: `TechnicalContentStandInEngine` class in `plugins/content-gen/src/index.ts` implementing `ContentGeneratorEngine` interface (`generate(docs: Doc[]): Promise<Content>`). Maps `Doc[]` to `Content` schema (`title`, `body`, `format: "markdown"`, `outline`, `references`, `metadata`).
- **File IO & Invocation**: CLI entry parsing `--in` and `--out` using `node:util.parseArgs`, executing `processGeneratorIO` to read `DocList`, synthesize `Content`, and write formatted JSON to disk.
### Plan
- [x] Create `plugins/content-gen/plugin.json` manifest with `kind: "generator"` (R1).
- [x] Implement adapter entry in `plugins/content-gen/src/index.ts` mapping invoke IO to `Content` schema (R2, R3).
- [x] Add contract tests in `plugins/content-gen/tests/content-gen.test.ts` executing via `runInvoke` (R4).
### Solution
**Change Map**

- `plugins/content-gen/plugin.json:1-7` declares the discoverable `generator` manifest and Bun entry.
- `plugins/content-gen/src/index.ts:21-75` delegates non-empty input to `wt-technical-content-creation` stages 0–3 through `spur agent run`, treats source documents as untrusted data, validates the agent result, and adds the contract's title/reference/provenance mapping.
- `plugins/content-gen/src/index.ts:77-113` validates `DocListSchema`, handles file IO, and exposes the executable `--in` / `--out` wrapper.
- `plugins/content-gen/tests/content-gen.test.ts:16-192` mocks the Spur executable at the adapter boundary and covers discovery/invocation, schema-valid output, skill success/failure, empty input, invalid input/output, and CLI outcomes.
- `plugins/content-gen/package.json:1-15`, `plugins/content-gen/tsconfig.json:1-4`, `package.json:6-24`, and `bun.lock` register the plugin workspace so its `@gobing-ai/*` imports are resolved and typechecked.

**Documented Design Deviation**

- The approved class/interface seam is implemented as one injected `ContentGenerator` function because there is one production implementation; this preserves the mock boundary and `Doc[] -> Promise<Content>` behavior without a one-implementation abstraction.
- Diagnostics use the repository `logger` instead of `console.error`; behavior remains stderr + non-zero exit and satisfies the project no-console rule.
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
| R1 | MET | `plugins/content-gen/plugin.json:1-7` names `content-gen`, `kind: generator`, and `./src/index.ts`; `plugins/content-gen/tests/content-gen.test.ts:35-70` discovers and invokes that manifest through `runInvoke`. |
| R2 | MET | `plugins/content-gen/src/index.ts:21-75` invokes the installed wt skill for stages 0-3, validates its JSON, and maps title/markdown/references/provenance; `:77-86` performs validated DocList-to-Content file IO. |
| R3 | MET | `plugins/content-gen/src/index.ts:24-29` treats source docs as untrusted data and explicitly forbids modifying wt/source files; `git status --short` and `git diff --name-only` contain no wt-owned paths. |
| R4 | MET | `plugins/content-gen/tests/content-gen.test.ts:16-70` replaces only the Spur executable and runs the real plugin through `runInvoke`; output is parsed with `ContentSchema`. |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| Plugin is discoverable and invocable | MET | test | `plugins/content-gen/tests/content-gen.test.ts:35-70`; full suite exit 0. |
| Docs become contract-valid Content | MET | test | `plugins/content-gen/tests/content-gen.test.ts:45-69,117-133`; `ContentSchema.parse` verifies mapped output. |
| Stand-in internals are not modified | MET | command + static-ref | `git status --short` / `git diff --name-only` show no wt paths; runtime instruction at `plugins/content-gen/src/index.ts:24-29`. |

**Design Conformance**

| Check | Status | Evidence |
| --- | --- | --- |
| design-conformance | pass | Manifest and CLI-wrapper claims DONE; the class-to-function and console-to-logger changes are documented goal-equivalent deviations in Solution. |
| scope-creep | pass | Changes are limited to the D2 plugin, its workspace registration/lockfile, and CLI-gated D2 corpus evidence. |
| evidence-rule-pass | pass | Every behavior-bearing AC maps to a fresh test or command. |
| cli-golden-path-present | pass | `knowledge-kit invoke delegates to the stand-in boundary and writes ContentSchema output` exercises `runInvoke` over the real manifest. |

**SECUA Review**

- Security: source docs are explicitly untrusted and embedded instructions/external fetches are prohibited (`plugins/content-gen/src/index.ts:24-29`); no secrets or shell interpolation.
- Efficiency: one agent subprocess per non-empty invocation; empty input short-circuits without an LLM call (`plugins/content-gen/src/index.ts:83-86`).
- Correctness: input, agent output, and final output are schema-validated; runner/agent failures fail loud.
- Usability: stderr includes the failing boundary and preserves skill diagnostics.
- Architecture: delegation stays inside the plugin wrapper; zero `runInvoke`, kk-core schema, or wt-skill changes.
- Findings: no blocker, major, or minor findings remain.

**Fix-pass disclosure**

- Repaired the fake concatenation engine at `plugins/content-gen/src/index.ts:21-75` and the contract/failure coverage at `plugins/content-gen/tests/content-gen.test.ts:16-192`.
- Rewrote `.spur/run/0022-verdict.json:1` with the post-fix PASS verdict and exact feature-scenario IDs.
- `--next`: no-op - task already terminal (`done`).
### Review
| Severity | Finding | Location | Status |
| --- | --- | --- | --- |
| P4 | Adapter implementation clean with mock engine injection support | `plugins/content-gen/src/index.ts:58` | Resolved |

#### Residual Risk & Final Disposition
- All requirements R1–R4 satisfied and verified with contract testing. Approved for `done`.
### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History
- 2026-07-31T17:41:31.953Z todo → wip (system)
- 2026-07-31T17:41:34.198Z wip → testing (system)
- 2026-07-31T17:41:35.853Z testing → done (system)
