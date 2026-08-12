---
template: feature-impl
schema_version: 1
name: "Split shipped commands into register modules"
description: ""
status: todo
type: task
profile: standard
feature_id: A2
parent_wbs: null
priority: P1
tags: ["cli", "surface"]
dependencies: ["0049"]
ac_numbering: task-local
created_at: "2026-08-12T17:19:19.254Z"
updated_at: "2026-08-12T17:20:27.553Z"
---

## 0050. Split shipped commands into register modules

### Background

After the kk program skeleton exists, move add, invoke, plugins, fanin, and fanout into apps/cli/src/commands/<noun>.ts registerXCommand modules. Command actions must stop calling process.exit so main() can return the code. Flags and --json shapes stay identical.

Implements feature scenarios: R5 — Existing pipeline commands keep their flags and exit codes; R6 — Each shipped command is registered from its own module; R7 — Command actions do not call process.exit; R12 — --verbose does not change --json machine output.

Ordering: depends on the program-globals task (createProgram / main shape).

Rubric: E4 D1 L1 C1 R1 = 8 → own task. Same review context as the command tree, not the npm pack file. Rejected one-file-per-verb tasks: they would all edit cli.ts and the same tests.

### Requirements
- [ ] R1. invoke, plugins list/doctor, fanin, and fanout keep their shipped flags and exit codes, including `--json` shapes.
- [ ] R2. add, invoke, plugins, fanin, and fanout each live in `apps/cli/src/commands/<noun>.ts` exporting `registerXCommand`; `createProgram` does not contain action bodies or call parse; `check-cli-surface.yaml` and CLI tests follow that layout.
- [ ] R3. Command modules do not call `process.exit`; `main` returns the non-zero code on fail-loud paths.
- [ ] R4. `--verbose` plus `plugins list --json` still emits a JSON array on stdout with diagnostics off that stream.
### Acceptance Criteria
```gherkin
Feature: register-per-command tree

  @core
  Scenario: R1 — Existing pipeline commands keep their flags and exit codes
    Given the shipped commands invoke, plugins list, plugins doctor, fanin, and fanout
    When each command is invoked with the same flags it had before this feature
    Then flag parsing and exit codes are unchanged
      And plugins list --json and plugins doctor --json still emit the same machine shapes

  @core
  Scenario: R2 — Each shipped command is registered from its own module
    Given the apps/cli/src/commands directory
    When createProgram is constructed
    Then add, invoke, plugins, fanin, and fanout each have a registerXCommand module
      And createProgram remains a side-effect-free factory that does not call parse

  @core
  Scenario: R3 — Command actions do not call process.exit
    Given a command that must fail (missing plugin, usage error, doctor diagnostics)
    When the command runs through main(argv)
    Then main returns the non-zero exit code
      And the command module does not call process.exit

  @edge
  Scenario: R4 — --verbose does not change --json machine output
    Given plugins list --json emits a JSON array
    When the user runs `kk --verbose plugins list --json --plugins-root <dir>`
    Then stdout is still a JSON array of plugin records
      And any verbose diagnostics are not mixed into that JSON
```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design
Chosen approach: one register file per existing noun. Actions set a captured exit code or throw an error that main maps. Fanin/fanout keep rebuilding their argv slice and calling runFanin/runFanout — only the process.exit after a non-zero code moves to main.

Reason: next noun is a new file plus one register call, matching spur without its runtime.

Rejected alternatives:
- Keep action bodies in cli.ts: fails A2 growth requirement.
- Kind-noun rewrite (ingest/generate/publish): breaks shipped kk invoke/fanin/fanout.

Invariants:
- No new pipeline verbs.
- --json stays per-command.
- Surface rule still requires createProgram() and forbids parse in cli.ts and commands/.
- Feature B4/B6 command contracts unchanged.
### Plan
1. Extract registerAdd/Invoke/Plugins/Fanin/Fanout modules from cli.ts.
2. Replace process.exit in those actions with a return-code path that main honors.
3. Keep createProgram as the factory that only registers.
4. Update check-cli-surface.yaml for commands/*.ts.
5. Rewrite cli/invoke/fanin/fanout tests to assert main() codes.
6. Add the --verbose + --json non-interference test.
7. Run apps/cli tests and typecheck.
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
