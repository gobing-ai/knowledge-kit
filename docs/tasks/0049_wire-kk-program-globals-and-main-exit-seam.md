---
template: feature-impl
schema_version: 1
name: "Wire kk program globals and main exit seam"
description: ""
status: todo
type: task
profile: standard
feature_id: A2
parent_wbs: null
priority: P1
tags: ["cli", "surface"]
dependencies: []
ac_numbering: task-local
created_at: "2026-08-12T17:19:19.223Z"
updated_at: "2026-08-12T17:20:27.292Z"
---

## 0049. Wire kk program globals and main exit seam

### Background

Feature A2 makes the operator-facing binary `kk` and gives it a normal Commander baseline. This first deliverable introduces CLI_CONFIG, main(argv) → exitCode, program.name('kk'), version from package.json, and global --verbose. Command bodies stay in createProgram until the next task moves them.

Implements feature scenarios: R1 — Bare invocation and --help print usage for the kk binary; R2 — help command prints command-specific usage; R3 — --version prints the package version; R4 — Global --verbose is accepted on a shipped command; R11 — Unknown command fails loud with help.

Ordering: first. The command-module split and the npm bin task both depend on this program shape.

Rubric: E3 D1 L1 C0 R1 = 6 → own task. Rejected merging the whole feature: pack metadata and the command-file move are separately reviewable. Rejected splitting help vs version: same createProgram surface.

### Requirements
- [ ] R1. createProgram names the binary `kk` and Commander `--help` / `-h` / bare `kk` exit 0 listing add, invoke, plugins, fanin, and fanout.
- [ ] R2. `kk help invoke` and `kk invoke --help` describe invoke's required `--in` and `--out`.
- [ ] R3. `--version` / `-V` print `apps/cli/package.json` version and never the hard-coded `0.0.0`.
- [ ] R4. Global `--verbose` / `-v` is accepted on a shipped command and does not change that command's result writer.
- [ ] R5. An unknown command returns non-zero and names the command on stderr.
### Acceptance Criteria
```gherkin
Feature: kk program globals and main exit seam

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

  @edge
  Scenario: R5 — Unknown command fails loud with help
    Given the knowledge-kit CLI program is constructed
    When the user runs `kk not-a-command`
    Then the process exits non-zero
      And stderr names the unknown command
```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design
Chosen approach: add `apps/cli/src/config.ts` (CLI_CONFIG) and `apps/cli/src/main.ts` (`main(argv, options?) → number` with Commander exitOverride). `createProgram()` sets name, version from package.json, and `.option('-v, --verbose', …)`. `index.ts` becomes `process.exit(await main())` under import.meta.main.

Reason: matches spur's testable entry without importing spur's runtime.

Rejected alternatives:
- Keep createProgram().parse() in index and only rename the program: no exit-code seam, tests still mock process.exit.
- Copy spur ApplicationRuntime / figlet / --cli-verbose: fails the deletion test.

Invariants:
- createProgram stays side-effect-free and does not parse.
- Output stays on @gobing-ai/utils logger.
- Existing command flags are not redesigned in this task.
- No package.json bin change here (next pack task).
### Plan
1. Add CLI_CONFIG and load binaryVersion from apps/cli/package.json.
2. Add main(argv) with exitOverride and configurable output if needed for tests.
3. Set program.name('kk'), .version(CLI_CONFIG.binaryVersion), global --verbose.
4. Point index.ts at main(); keep createProgram exported.
5. Add tests for --help, help invoke, --version, --verbose add, and unknown command.
6. Run apps/cli tests and typecheck.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

A2

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
