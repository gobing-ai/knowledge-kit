---
template: feature-impl
schema_version: 1
name: "Wire kk program globals and main exit seam"
description: ""
status: done
type: task
profile: standard
feature_id: A2
parent_wbs: null
priority: P1
tags: ["cli", "surface"]
dependencies: []
ac_numbering: task-local
created_at: "2026-08-12T17:19:19.223Z"
updated_at: "2026-08-12T21:11:05.669Z"
---

## 0049. Wire kk program globals and main exit seam

### Background

Feature A2 makes the operator-facing binary `kk` and gives it a normal Commander baseline. This first deliverable introduces CLI_CONFIG, main(argv) → exitCode, program.name('kk'), version from package.json, and global --verbose. Command bodies stay in createProgram until the next task moves them.

Implements feature scenarios: R1 — Bare invocation and --help print usage for the kk binary; R2 — help command prints command-specific usage; R3 — --version prints the package version; R4 — Global --verbose is accepted on a shipped command; R11 — Unknown command fails loud with help.

Ordering: first. The command-module split and the npm bin task both depend on this program shape.

Rubric: E3 D1 L1 C0 R1 = 6 → own task. Rejected merging the whole feature: pack metadata and the command-file move are separately reviewable. Rejected splitting help vs version: same createProgram surface.

### Requirements
- [x] R1. createProgram names the binary `kk` and Commander `--help` / `-h` / bare `kk` exit 0 listing add, invoke, plugins, fanin, and fanout.
- [x] R2. `kk help invoke` and `kk invoke --help` describe invoke's required `--in` and `--out`.
- [x] R3. `--version` / `-V` print `apps/cli/package.json` version and never the hard-coded `0.0.0`.
- [x] R4. Global `--verbose` / `-v` is accepted on a shipped command and does not change that command's result writer.
- [x] R5. An unknown command returns non-zero and names the command on stderr.
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
- **Config** — `apps/cli/src/config.ts:8` loads `binaryName: 'kk'` and `binaryVersion` from `apps/cli/package.json` (never `0.0.0`).
- **Exit seam** — `apps/cli/src/main.ts:25` `main(argv) → number` with `exitOverride` (`apps/cli/src/main.ts:27`); empty user argv prints help and returns 0 (`apps/cli/src/main.ts:52`); `CommanderError` maps to `err.exitCode` (`apps/cli/src/main.ts:58`). Nested commands re-inherit writers (`apps/cli/src/main.ts:38`).
- **Factory** — `apps/cli/src/cli.ts:16` `createProgram()` sets `.name(CLI_CONFIG.binaryName)` (`apps/cli/src/cli.ts:18`), `.version(CLI_CONFIG.binaryVersion)` (`apps/cli/src/cli.ts:20`), and global `-v, --verbose` (`apps/cli/src/cli.ts:21`). No `.parse()`.
- **Entry** — `apps/cli/src/index.ts:5` is the only `process.exit(await main())`.
- **Tests** — `apps/cli/tests/main.test.ts:34` (help), `:45` (invoke help), `:57` (version), `:74` (verbose add), `:113` (unknown command); `apps/cli/tests/config.test.ts` asserts version load.
### Testing
**Force re-verify 2026-08-12** (`/sp-dev-verifyall --feature A2 --force --fix all`). Coverage: 94 pass / 0 fail in `apps/cli/tests` this run.

**Per-requirement**

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `apps/cli/src/cli.ts:18` `.name(CLI_CONFIG.binaryName)`; `apps/cli/src/config.ts:9` `binaryName: 'kk'`. This run: `bun apps/cli/src/index.ts`, `--help`, `-h` all exit 0; stdout `Usage: kk` lists add, invoke, plugins, fanin, fanout. Test `apps/cli/tests/main.test.ts:34`. |
| R2 | MET | This run: `help invoke` and `invoke --help` exit 0; stdout names required `--in <path>` and `--out <path>`. Test `apps/cli/tests/main.test.ts:45`. |
| R3 | MET | `apps/cli/package.json:3` `"version": "0.1.0"`; `apps/cli/src/config.ts:10` `binaryVersion: pkg.version`. This run: `--version` and `-V` print `0.1.0` (not `0.0.0`). Test `apps/cli/tests/main.test.ts:57`. |
| R4 | MET | `apps/cli/src/cli.ts:21` `.option('-v, --verbose', …)`; add writes via `apps/cli/src/commands/add.ts:14` `logger.out`. This run: `--verbose add 1 2` and `add 1 2 -v` exit 0, stdout `3`. Test `apps/cli/tests/main.test.ts:74`. |
| R5 | MET | This run: `not-a-command` exit 1; stderr `unknown command 'not-a-command'`. Test `apps/cli/tests/main.test.ts:113`. |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| R1 — Bare invocation and --help print usage for the kk binary | MET | command | `bun apps/cli/src/index.ts` / `--help` / `-h` exit 0; `Usage: kk`; commands add, invoke, plugins, fanin, fanout. Also test `apps/cli/tests/main.test.ts:34`. |
| R2 — help command prints command-specific usage | MET | command | `help invoke` and `invoke --help` exit 0; `--in` and `--out` described. Test `apps/cli/tests/main.test.ts:45`. |
| R3 — --version prints the package version | MET | command | `--version` / `-V` exit 0; stdout `0.1.0`. Test `apps/cli/tests/main.test.ts:57`. |
| R4 — Global --verbose is accepted on a shipped command | MET | command | `--verbose add 1 2` and `add 1 2 -v` exit 0; result `3` via logger. Test `apps/cli/tests/main.test.ts:74`. |
| R5 — Unknown command fails loud with help | MET | command | `not-a-command` exit 1; stderr names the command. Test `apps/cli/tests/main.test.ts:113`. |

Coverage: 94/94 CLI tests this run (`bun test apps/cli/tests`); `apps/cli/src/main.ts` function 100% / line 92.86% (uncovered 60-61 non-CommanderError rethrow).
### Review
| Priority | Dimension | Location | Finding |
|----------|-----------|----------|---------|
| P4 | correctness | `apps/cli/src/main.ts:60` | Uncovered non-CommanderError rethrow (lines 60-61); advisory only |
| P4 | — | — | No P1–P3 findings on 2026-08-12 force re-verify; nested-help P3 from the pipeline review is fixed (`copyInheritedSettings` recurses) |

Force re-verify SECUA (`--focus all`): no secrets/injection; no efficiency issue; exit seam correct; `main()` argv contract documented at `apps/cli/src/main.ts:21-23`. Prior pipeline Review (2026-08-12) approved R1–R5 against the real binary.
### References

A2

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-08-12T17:50:27.960Z todo → wip (system)
- 2026-08-12T17:56:45.538Z wip → testing (system)
- 2026-08-12T17:56:50.436Z testing → done (system)
