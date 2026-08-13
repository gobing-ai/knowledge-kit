---
schema_version: 1
id: "A21"
name: "Two-layer CLI nouns (executor + plugin)"
status: active
priority: P1
tags: []
created_at: "2026-08-13T00:54:08.128Z"
updated_at: "2026-08-13T01:46:57.744Z"
---

# A21: Two-layer CLI nouns (executor + plugin)

## Goal
The `kk` command tree is a two-layer noun+verb surface with exactly two first-layer nouns: `executor` (run, fan-in, fan-out) and `plugin` (status).
## Scope
- In:
  - First-layer nouns `executor` and `plugin` only (globals `--help`/`--version`/`--verbose` stay)
  - `kk executor run` — current `invoke` engine and flags (`<plugin> --in --out [--plugins-root]`)
  - `kk executor fan-in` / `kk executor fan-out` — current `fanin` / `fanout` engines and flags; hyphenated canonical names
  - `kk plugin status` — replaces `plugins list` and `plugins doctor`; inventory plus health, including tree-level discovery diagnostics
  - `status --json` unified object; exit `1` when any diagnostic exists
  - Hidden one-release aliases: `invoke`; top-level `fanin`/`fanout`; `plugins`; `plugins list`; `plugins doctor`
  - Retire `kk add`
  - Same-commit T3 (`docs/04_DESIGN.md` §1, `docs/design/kk-cli-surface.md`) and dated ADR-006 / ADR-010 amendments
  - Update `.spur/workflows/kk-ingest-generate-publish.yaml` and README command table to the new names
- Out:
  - New pipeline engines or flag semantics (`--dedupe`, new invoke flags)
  - Kind-nouns (`ingest` / `generate` / `publish`)
  - Plugin install/remove (`superskill install` owns distribution)
  - Reopening or rewriting A2 / B4 / B6 AC
  - npm Trusted Publisher / native `bun --compile` binaries
## Acceptance Criteria
```gherkin
Feature: Two-layer CLI nouns (executor + plugin)

  @core
  Scenario: R1 — kk --help lists only executor and plugin as first-layer nouns
    Given the knowledge-kit CLI program is constructed
    When the user runs `kk --help`
    Then the process exits 0
      And the help text lists `executor` and `plugin` as commands
      And the help text does not list `add`, `invoke`, `fanin`, `fanout`, or `plugins` as visible first-layer commands

  @core
  Scenario: R2 — kk executor run invokes a plugin with the current invoke flags
    Given a discoverable plugin and valid `--in` / `--out` paths
    When the user runs `kk executor run <plugin> --in <path> --out <path> [--plugins-root <dir>]`
    Then the process uses the existing invoke engine
      And flag names remain `--in`, `--out`, and `--plugins-root`
      And a successful run exits 0 and writes the plugin output
      And a failing plugin entry surfaces the entry exit code

  @core
  Scenario: R3 — kk executor fan-in keeps the current fanin engine flags and exit codes
    Given valid Doc[] input files
    When the user runs `kk executor fan-in --in <f>… --out <path>`
    Then flag parsing and exit codes match the shipped fanin engine
      And `kk help executor` names the hyphenated verb `fan-in`

  @core
  Scenario: R4 — kk plugin status lists discovered plugins with a health attribute
    Given a plugins root with plugins of multiple kinds
    When the user runs `kk plugin status [--kind <kind>] [--plugins-root <dir>]`
    Then plugins print grouped by kind
      And each listed plugin shows whether it is healthy
      And `--kind` still filters to that kind

  @core
  Scenario: R5 — kk plugin status --json emits a unified health report and fails when unhealthy
    Given a plugins root that may include tree-level discovery problems or a missing entry
    When the user runs `kk plugin status --json --plugins-root <dir>`
    Then stdout is a JSON object with `healthy`, `plugins`, and `diagnostics`
      And each `plugins[]` entry includes `healthy` and `diagnostics`
      And tree-level issues such as `misplaced` or `kind_mismatch` appear in top-level `diagnostics`
      And the process exits 0 when there are no diagnostics
      And the process exits 1 when any diagnostic exists

  @core
  Scenario: R6 — Hidden aliases keep the old command paths working
    Given the knowledge-kit CLI program is constructed
    When the user runs `kk invoke`, `kk fanin`, `kk fanout`, `kk plugins list`, or `kk plugins doctor` with the flags those commands already accepted
    Then each alias reaches the same engine as `executor run`, `executor fan-in`, `executor fan-out`, or `plugin status`
      And those old names do not appear as visible first-layer commands in `kk --help`

  @core
  Scenario: R7 — kk add is no longer a registered command
    Given the knowledge-kit CLI program is constructed
    When the user runs `kk add 1 2`
    Then the process exits non-zero
      And `apps/cli/src/commands/add.ts` is gone

  @core
  Scenario: R8 — [doc-only] Surface docs and ADRs name the two-noun tree
    Given the implementing commit lands
    When `docs/04_DESIGN.md` section 1 and `docs/design/kk-cli-surface.md` are read
    Then they document `kk executor run|fan-in|fan-out` and `kk plugin status`
      And a dated ADR-006 amendment names `kk executor run` as the uniform entrypoint with `invoke` as alias
      And a dated ADR-010 amendment names `executor` and `plugin` as the first-layer nouns and records that `add` is retired

  @edge
  Scenario: R9 — Unknown first-layer noun fails loud
    Given the knowledge-kit CLI program is constructed
    When the user runs `kk not-a-noun`
    Then the process exits non-zero
      And stderr names the unknown command

  @core
  Scenario: R10 — kk executor fan-out keeps the current fanout engine flags and exit codes
    Given a valid Content file and at least one publish target
    When the user runs `kk executor fan-out --content <path> --target <p>… --out <path> [--retry-from <path>] [--plugins-root <dir>]`
    Then flag parsing and exit codes match the shipped fanout engine
      And `kk help executor` names the hyphenated verb `fan-out`
```
## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0052 | Reshape kk into two-layer executor and plugin nouns | todo |
<!-- END AUTO-GENERATED -->

## Notes

## History
- 2026-08-13T01:21:38.974Z backlog → active (system)
- 2026-08-13T01:21:39.206Z active → verifying (system)
- 2026-08-13T01:46:57.744Z verifying → active (system)
