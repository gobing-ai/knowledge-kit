---
schema_version: 1
id: "A2"
name: "kk product CLI surface"
status: done
priority: P1
tags: []
created_at: "2026-08-12T17:13:50.092Z"
updated_at: "2026-08-12T18:37:02.315Z"
---

# A2: kk product CLI surface

## Goal
The `kk` binary of `@gobing-ai/knowledge-kit` behaves like a normal product CLI (help, version, verbose) and registers existing commands in a tree that can grow.
## Scope
- In:
  - Operator-facing binary name `kk` (`program.name`, npm `bin.kk`)
  - Compatibility npm bin alias `knowledge-kit` pointing at the same artifact
  - Commander baseline: `kk`, `--help`/`-h`, `help [cmd]`, `--version`/`-V`
  - Global `--verbose`/`-v` for diagnostics
  - Per-command `registerXCommand` tree for shipped verbs (`add`, `invoke`, `plugins`, `fanin`, `fanout`) with unchanged flags and exit codes
  - `main(argv) → exitCode` seam; no `process.exit` inside command actions
  - Version sourced from `apps/cli/package.json` (not a hard-coded `0.0.0`)
  - `prepack` stages `dist/` so `npm pack` sees the `kk` bin file
  - Same-commit `docs/04_DESIGN.md` §1 (T3) and a dated ADR note that the package name is unchanged
  - Update `.spur/rules/surface/check-cli-surface.yaml` for the new layout
- Out:
  - npm Trusted Publisher / GitHub OIDC / `.github/workflows/` (operator later)
  - Native multi-arch `bun --compile` binaries (spur `build-binaries`)
  - New pipeline verbs or kind-nouns (`ingest`/`generate`/`publish`)
  - Package rename away from `@gobing-ai/knowledge-kit`
  - Removing the toy `add` command
  - Copying spur's ApplicationRuntime, DB, or figlet banner
## Acceptance Criteria
```gherkin
Feature: kk product CLI surface

  @core
  Scenario: R1 — Bare invocation and --help print usage for the kk binary
    Given the knowledge-kit CLI program is constructed
    When the user runs `kk` or `kk --help` or `kk -h`
    Then the process exits 0
      And stdout names the binary `kk`
      And the help text lists the shipped commands add, invoke, plugins, fanin, and fanout

  @core
  Scenario: R2 — help command prints command-specific usage
    Given the knowledge-kit CLI program is constructed
    When the user runs `kk help invoke` or `kk invoke --help`
    Then the process exits 0
      And the help text describes invoke's required `--in` and `--out` options

  @core
  Scenario: R3 — --version prints the package version
    Given apps/cli/package.json declares a semver version
    When the user runs `kk --version` or `kk -V`
    Then the process exits 0
      And stdout prints that same version string
      And the printed version is not the hard-coded `0.0.0`

  @core
  Scenario: R4 — Global --verbose is accepted on a shipped command
    Given the knowledge-kit CLI program is constructed
    When the user runs `kk --verbose add 1 2` or `kk add 1 2 -v`
    Then the process exits 0
      And the command result is still written through the shared logger

  @core
  Scenario: R5 — Existing pipeline commands keep their flags and exit codes
    Given the shipped commands invoke, plugins list, plugins doctor, fanin, and fanout
    When each command is invoked with the same flags it had before this feature
    Then flag parsing and exit codes are unchanged
      And plugins list --json and plugins doctor --json still emit the same machine shapes

  @core
  Scenario: R6 — Each shipped command is registered from its own module
    Given the apps/cli/src/commands directory
    When createProgram is constructed
    Then add, invoke, plugins, fanin, and fanout each have a registerXCommand module
      And createProgram remains a side-effect-free factory that does not call parse

  @core
  Scenario: R7 — Command actions do not call process.exit
    Given a command that must fail (missing plugin, usage error, doctor diagnostics)
    When the command runs through main(argv)
    Then main returns the non-zero exit code
      And the command module does not call process.exit

  @core
  Scenario: R8 — npm bin exposes kk and a knowledge-kit alias
    Given apps/cli/package.json
    When the package metadata is read
    Then bin.kk points at the built dist entry
      And bin.knowledge-kit points at the same artifact
      And the package name remains @gobing-ai/knowledge-kit

  @core
  Scenario: R9 — prepack stages the dist artifact that bin.kk names
    Given a clean apps/cli tree without dist/index.js
    When `bun run --filter @gobing-ai/knowledge-kit prepack` (or the documented pack path) runs
    Then dist/index.js exists
      And npm pack can see the kk bin file

  @core
  Scenario: R10 — [doc-only] Surface docs and ADR name the kk binary
    Given the binary is named kk
    When the implementing commit lands
    Then docs/04_DESIGN.md section 1 documents `kk` as the binary in that commit
      And a dated ADR entry records that the package name is unchanged and the operator binary is kk

  @edge
  Scenario: R11 — Unknown command fails loud with help
    Given the knowledge-kit CLI program is constructed
    When the user runs `kk not-a-command`
    Then the process exits non-zero
      And stderr names the unknown command

  @edge
  Scenario: R12 — --verbose does not change --json machine output
    Given plugins list --json emits a JSON array
    When the user runs `kk --verbose plugins list --json --plugins-root <dir>`
    Then stdout is still a JSON array of plugin records
      And any verbose diagnostics are not mixed into that JSON
```
## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0049 | Wire kk program globals and main exit seam | done |
| 0050 | Split shipped commands into register modules | done |
| 0051 | Publish kk bin and prepack artifact | done |
<!-- END AUTO-GENERATED -->

## Notes

## History
- 2026-08-12T17:56:45.895Z backlog → active (system)
- 2026-08-12T18:35:26.462Z active → verifying (system)
- 2026-08-12T18:37:02.315Z verifying → done (system)
