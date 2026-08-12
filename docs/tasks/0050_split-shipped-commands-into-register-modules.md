---
template: feature-impl
schema_version: 1
name: "Split shipped commands into register modules"
description: ""
status: done
type: task
profile: standard
feature_id: A2
parent_wbs: null
priority: P1
tags: ["cli", "surface"]
dependencies: ["0049"]
ac_numbering: task-local
created_at: "2026-08-12T17:19:19.254Z"
updated_at: "2026-08-12T19:45:55.714Z"
---

## 0050. Split shipped commands into register modules

### Background

After the kk program skeleton exists, move add, invoke, plugins, fanin, and fanout into apps/cli/src/commands/<noun>.ts registerXCommand modules. Command actions must stop calling process.exit so main() can return the code. Flags and --json shapes stay identical.

Implements feature scenarios: R5 — Existing pipeline commands keep their flags and exit codes; R6 — Each shipped command is registered from its own module; R7 — Command actions do not call process.exit; R12 — --verbose does not change --json machine output.

Ordering: depends on the program-globals task (createProgram / main shape).

Rubric: E4 D1 L1 C1 R1 = 8 → own task. Same review context as the command tree, not the npm pack file. Rejected one-file-per-verb tasks: they would all edit cli.ts and the same tests.

### Requirements
- [x] R1. invoke, plugins list/doctor, fanin, and fanout keep their shipped flags and exit codes, including `--json` shapes.
- [x] R2. add, invoke, plugins, fanin, and fanout each live in `apps/cli/src/commands/<noun>.ts` exporting `registerXCommand`; `createProgram` does not contain action bodies or call parse; `check-cli-surface.yaml` and CLI tests follow that layout.
- [x] R3. Command modules do not call `process.exit`; `main` returns the non-zero code on fail-loud paths.
- [x] R4. `--verbose` plus `plugins list --json` still emits a JSON array on stdout with diagnostics off that stream.
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
- **Split command tree** — `apps/cli/src/cli.ts` is now a side-effect-free factory that only registers commands: `registerAddCommand` (`apps/cli/src/commands/add.ts:8`), `registerInvokeCommand` (`apps/cli/src/commands/invoke.ts:10`), `registerFaninCommand` (`apps/cli/src/commands/fanin.ts:4`), `registerFanoutCommand` (`apps/cli/src/commands/fanout.ts:4`), `registerPluginsCommand` (`apps/cli/src/commands/plugins.ts:14`). No action bodies or `.parse()` remain in cli.ts or any command module (R2).
- **Exit seam (R3)** — every fail-loud path in the command modules now throws `CommanderError(<code>, 'kk.<noun>.<failure>', …)` instead of calling `process.exit`; `main()` already maps `CommanderError` → `err.exitCode`, so `main(argv)` returns the non-zero code. Exit codes unchanged: invoke plugin failures 1, plugins list invalid kind 1, plugins doctor unhealthy 1, fanin file errors 1 / usage 2, fanout input errors 2 / target failures 1. The obsolete `processExit` callback seam was removed from `runInvoke` (`apps/cli/src/invoke.ts`) — the return code is the sole contract.
- **Flags and --json shapes unchanged (R1)** — each `registerXCommand` recreates the exact same commander definitions (required options, repeatable `--in`/`--target` collectors, `--json` handling) that previously lived inline in cli.ts; `--verbose` remains a global accepted no-op that never touches the `--json` stream (R4).
- **Surface rule** — `.spur/rules/surface/check-cli-surface.yaml` updated: new `cli-commands-register-modules` (require) and `cli-commands-no-process-exit` (forbid) rules over `apps/cli/src/commands/*.ts`, and `cli-no-parse-at-module-scope` extended to cover `commands/*.ts`; the stale "not a commands/ dir" comment removed.
- **Tests** — `tests/cli.test.ts`, `tests/index.test.ts` rewritten to assert `main()` return codes (no more `process.exit` mocks); `tests/invoke.test.ts` asserts `runInvoke` return codes only; new `tests/commands/<noun>.test.ts` files assert the R2 registration contract (command name, option shapes via `Option.mandatory`, fail-loud codes); `tests/main.test.ts` gains the R4 `--verbose plugins list --json` non-interference test.
### Testing
**Force re-verify 2026-08-12** (`/sp-dev-verifyall --feature A2 --force --fix all`). Coverage: 94 pass / 0 fail in `apps/cli/tests` this run.

**Per-requirement**

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | Flags live in `apps/cli/src/commands/invoke.ts:16`, `apps/cli/src/commands/fanin.ts:15`, `apps/cli/src/commands/fanout.ts:15`, `apps/cli/src/commands/plugins.ts:20`. This run: `plugins list --json` exit 0 JSON array; `plugins doctor --json` exit 0 `{healthy:true}`; `invoke missing` exit 1; `fanout` missing content exit 2. |
| R2 | MET | `registerAddCommand` `apps/cli/src/commands/add.ts:5`; invoke `:11`; fanin `:5`; fanout `:5`; plugins `:14`. `createProgram` `apps/cli/src/cli.ts:16-29` only registers. `rg '\.parse\('` over cli.ts + commands/: no matches. Surface rules 0 findings this run. |
| R3 | MET | `rg process.exit` in `apps/cli/src/`: only `apps/cli/src/index.ts:5` and comments in `apps/cli/src/main.ts`. Fail-loud throws `CommanderError` (`apps/cli/src/commands/invoke.ts:27`, `apps/cli/src/commands/plugins.ts:31`, `apps/cli/src/commands/fanin.ts:27`, `apps/cli/src/commands/fanout.ts:35`). This run: invoke missing exit 1; fanout bad content exit 2. |
| R4 | MET | This run: `--verbose plugins list --json --plugins-root ./plugins` exit 0; stdout JSON array of 5; stderr 0 bytes; parsed equal to non-verbose run. Test `apps/cli/tests/main.test.ts:94`. |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| R1 — Existing pipeline commands keep their flags and exit codes | MET | command | `plugins list --json` exit 0 array; `plugins doctor --json` exit 0 healthy; `invoke missing` exit 1; `fanout --content /tmp/nope.json --target x --out /tmp/r.json` exit 2. |
| R2 — Each shipped command is registered from its own module | MET | test | Five `registerXCommand` exports; `createProgram` has no parse; `spur rule run --rule cli-commands-register-modules` 0 findings. |
| R3 — Command actions do not call process.exit | MET | command | invoke-missing exit 1 via `main`; no `process.exit` in `apps/cli/src/commands/`. Rule `cli-commands-no-process-exit` 0 findings. |
| R4 — --verbose does not change --json machine output | MET | command | verbose vs non-verbose `plugins list --json` parsed equal; stderr empty. Test `apps/cli/tests/main.test.ts:94`. |

Coverage: 94/94 CLI tests this run. `apps/cli/src/cli.ts` and commands add/invoke/fanin/plugins 100% lines; fanout 96.67%.
Fix-pass artifact: `.spur/run/0050-testing.md`.
### Review
| Priority | Dimension | Location | Finding |
|----------|-----------|----------|---------|
| P4 | architecture | `.spur/rules/surface/check-cli-surface.yaml:31` | Surface rules are shape-only (export pattern, not wiring proof); observation |
| P4 | — | — | No P1–P3 findings on 2026-08-12 force re-verify |

Force re-verify SECUA (`--focus all`): spawn still gated in invoke; flags/exit codes unchanged; register-per-command matches ADR-010 R2. Prior pipeline Review (2026-08-12) approved R1–R4.
### References

A2

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-08-12T18:07:57.617Z todo → wip (system)
- 2026-08-12T18:21:23.654Z wip → testing (system)
- 2026-08-12T18:21:28.450Z testing → done (system)
