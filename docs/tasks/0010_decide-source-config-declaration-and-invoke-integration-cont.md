---
template: standard
schema_version: 1
name: "Decide source-config declaration and invoke integration contract"
description: ""
status: done
type: task
profile: standard
feature_id: C1
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: "2026-07-30T21:56:59.987Z"
updated_at: "2026-07-30T22:48:27.180Z"
---

## 0010. Decide source-config declaration and invoke integration contract

### Background



### Requirements
- R1: One decision names where per-plugin source config lives (CLI flags vs manifest key vs config file vs env vars), with rationale; it must cover both FS-source and API-source shapes.
- R2: `--in` semantics per source type are defined (e.g. FS: directory path; API: base URL or config-file path).
- R3: The extra-config channel is defined: either `invoke` forwards declared config (flags/env) as built, or the required `invoke` extension is scoped explicitly as a follow-up task.
- R4: Secrets channel is specified: credentials reach the spawned entry via env inheritance only — never in the manifest, never committed.
- R5: The decision is validated against as-built `runInvoke` and `PluginManifestSchema`; any contradiction is resolved or escalated as an ADR entry.
### Acceptance Criteria
```gherkin
Feature: Source-config declaration and invoke integration contract

  Scenario: Source config declaration is specified
    Given an FS source and an API source
    When the chosen config mechanism is applied to each
    Then both are configurable without invoke code changes, or the invoke change is scoped as a follow-up task

  Scenario: Invoke integration contract is specified
    Given the as-built manifest schema and runInvoke spawn behavior
    When a plugin author declares source config per the decision
    Then they can predict argv and env at entry spawn time
    And every contradiction with registry, kindContract, or runInvoke is resolved or recorded as a proposed ADR entry
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
- Source Config Channel: Per-plugin configuration path via `--in` argument and environment variables (`process.env`).
- FS vs API semantics: FS-source uses directory path for `--in`; API-source uses JSON config file path for `--in`.
- Extra-config channel: Embedded in JSON file / directory at `--in`.
- Secrets channel: Environment variable inheritance (`process.env`).
### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution
- `docs/tasks/0010_decide-source-config-declaration-and-invoke-integration-cont.md`: Specified source-config declaration, `--in` semantics, extra-config channel, and secrets inheritance contract for `IngestionPlugin` and generic plugins under `runInvoke`.

1. **Source Config Location & Channel**:
   - Per-plugin source config is passed via the `--in` path argument (file or directory) and environment variables (`process.env`).
   - Rationale: `runInvoke` spawns plugin entry points with a fixed CLI contract (`[entryPath, '--in', absInPath, '--out', absOutPath]`). Using `--in` as a flexible input specifier allows plugins to read configuration without requiring signature changes to `runInvoke`.
2. **`--in` Semantics per Source Type**:
   - **FS-Source**: `--in` points to a local directory or file path containing the source assets/documents to ingest.
   - **API-Source**: `--in` points to a JSON config file (e.g. `source-config.json`) specifying endpoint parameters, sync cursor/dates, and query options.
3. **Extra-Config Channel**:
   - Additional non-secret parameters are embedded inside the JSON file/directory at `--in`. `runInvoke` forwards `--in` as-is, so no core `runInvoke` extensions are required for Phase 1.
4. **Secrets Channel**:
   - Secrets and credentials (API tokens, private keys) are passed strictly via environment variable inheritance (`process.env`). Credentials must never appear in `plugin.json` or committed config files.
5. **Platform Alignment Verification**:
   - Validated against as-built `runInvoke` (`apps/cli/src/invoke.ts:90-95`), `PluginManifestSchema`, and `kindContract("ingestion")`. No contradictions exist; core spawn behavior requires no modifications.
### Testing
- Verified alignment of decision against `runInvoke` implementation in `apps/cli/src/invoke.ts` and unit tests in `apps/cli/tests/invoke.test.ts`.
- Command run: `bun run lint && bun run test` -> PASS.
- Numeric Coverage: N/A (specification task).
- Verdict: PASS.
### Review
| Priority | Category | Finding | Disposition |
| --- | --- | --- | --- |
| P4 | Architecture | Verified `--in` and secrets channel against `runInvoke` contract | Approved |

- Functional Traceability: R1-R5 MET.
- Verdict: PASS.
### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History
- 2026-07-30T22:48:09.193Z todo → wip (system)
- 2026-07-30T22:48:24.677Z wip → testing (system)
- 2026-07-30T22:48:27.180Z testing → done (system)
