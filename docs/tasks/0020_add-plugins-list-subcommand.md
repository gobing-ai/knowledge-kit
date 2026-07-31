---
template: standard
schema_version: 1
name: "Add plugins list subcommand"
description: ""
status: done
type: task
profile: standard
feature_id: B4
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: "2026-07-30T23:42:55.633Z"
updated_at: "2026-07-31T04:07:54.328Z"
---

## 0020. Add plugins list subcommand

### Background



### Requirements
- R1. `knowledge-kit plugins list` prints discovered plugins grouped by kind via `logger.out`.
- R2. `--kind <kind>` narrows output to a single plugin kind.
- R3. `--json` emits machine-readable registry output.
- R4. `--plugins-root` resolves the same registry as `invoke --plugins-root`; tests go through the `createProgram()` factory (no parse at module scope).
### Acceptance Criteria
```gherkin
Feature: CLI surface

  Scenario: List shows discovered plugins
    Given a plugins root with plugins of multiple kinds
    When knowledge-kit plugins list runs
    Then plugins print grouped by kind and --json emits machine-readable output

  Scenario: Plugins root is consistent with invoke
    Given a non-default plugins directory
    When plugins list and doctor run with --plugins-root
    Then they resolve the same registry as invoke with --plugins-root

  Scenario: Surface is documented in the same commit
    Given the new subcommands
    When the implementing commit lands
    Then docs/04_DESIGN.md section 1 documents them in that commit
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
#### 1. Command Structure & Options (R1, R2, R3, R4)
- Subcommand: `knowledge-kit plugins list`
- Options:
  - `--kind <kind>`: Optional filter matching `PluginKind` (`ingestion`, `generator`, `publish`).
  - `--json`: Optional flag emitting raw JSON array of plugin records.
  - `--plugins-root <dir>`: Optional root directory path (defaults `./plugins`).
- Behavior:
  - Invokes `discoverPlugins(pluginsRoot)` from `@gobing-ai/kk-core`.
  - If `--kind` is specified, filters plugins via `listByKind`.
  - Under `--json`, formats and prints JSON output via `logger.out`.
  - Under standard output, prints plugins grouped by kind (`ingestion`, `generator`, `publish`), displaying `name`, `version`, `entry`, and `description`.

#### 2. Implementation Approach
- Update `apps/cli/src/cli.ts`:
  - Add `plugins` parent command with `list` subcommand.
  - Plumb `--plugins-root` identically to `invoke` command.
  - Add comprehensive unit tests in `apps/cli/tests/cli.test.ts` via `createProgram()`.
- Update `docs/04_DESIGN.md` §1 to document `plugins list` subcommand in the same commit (T3).
### Plan
- [x] Add `plugins list` subcommand to `apps/cli/src/cli.ts` with `--kind`, `--json`, and `--plugins-root` options (R1, R2, R3, R4).
- [x] Add CLI tests in `apps/cli/tests/cli.test.ts` exercising standard and `--json` outputs with default and custom `--plugins-root` (R4).
- [x] Document `plugins list` in `docs/04_DESIGN.md` §1 (T3).
### Solution
#### Change Map
- `apps/cli/src/cli.ts:40-128`: Added `plugins` parent command with `list` and `doctor` subcommands. `plugins list` supports `--kind` filtering, `--json` formatting, and kind-grouped console output. `plugins doctor` checks manifest validity and entry file existence (`missing_entry`), returning exit `1` on diagnostics and `0` when healthy.
- `apps/cli/tests/cli.test.ts:9-106`: Added comprehensive CLI unit test coverage for `plugins list` and `plugins doctor` subcommands across standard, `--json`, and error paths.
- `docs/04_DESIGN.md:28-35,62-95`: Documented `plugins list` and `plugins doctor` commands, options, and behaviors in Section 1 (T3).
### Testing
- Verdict: **PASS** (re-verify under `--force` on a `done` task; `--next` no-op — already terminal).
- Commands run (this run): `bun test apps/cli/tests/cli.test.ts` → **7 pass, 0 fail, 11 expect() calls**; golden-path smoke against a fixture root (`bun apps/cli/src/index.ts plugins list …`): grouped kind output exit 0, `--kind ingestion --json` exit 0 emitting the filtered record array; `spur task check 0020 --strict-core` → pass: true, 0 findings; fresh anchor re-reads of every cited line below.
- Line coverage: covered by workspace suite (cli.ts previously measured 94.69%; suite green this run).

**Per-Requirement Traceability**

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `apps/cli/src/cli.ts:79-94` — kind-grouped printing (`INGESTION/GENERATOR/PUBLISH` headers, name/version/entry/description) via `logger.out`; smoke: grouped output on fixture root, exit 0. Re-read this run. |
| R2 | MET | `apps/cli/src/cli.ts:61-67` — `--kind` validated by `isPluginKind`, filtered via `listByKind`; smoke: `--kind ingestion --json` returned only the ingestion record. Re-read this run. |
| R3 | MET | `apps/cli/src/cli.ts:69-72` — `--json` emits `JSON.stringify(records)` via `logger.out`; smoke: valid JSON array on stdout. Re-read this run. |
| R4 | MET | `apps/cli/src/cli.ts:57-58` — `options.pluginsRoot ?? './plugins'` into `discoverPlugins(root)`, identical to `apps/cli/src/invoke.ts:21-23`; tests construct via `createProgram()` (`apps/cli/tests/cli.test.ts:6`), no module-scope parse. Re-read this run. |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| Scenario: List shows discovered plugins | MET | command | `plugins list --plugins-root <fixture>` (this run): plugins printed grouped by kind, exit 0; `--json` emitted machine-readable array |
| Scenario: Plugins root is consistent with invoke | MET | command + static | `cli.ts:57-58` vs `invoke.ts:21-23` — same option, same default, same `discoverPlugins` registry; smoke with non-default root resolved the fixture registry |
| Scenario: Surface is documented in the same commit | MET | static | `docs/04_DESIGN.md:28-29,36-37,68-83` document `plugins list` (options + behavior); lands in the same commit as `cli.ts`/`cli.test.ts` (B4 close-out commit) |

**Design Conformance**

| Claim | Status | Evidence |
|-------|--------|----------|
| Command structure & options (kind/json/plugins-root) | DONE | `cli.ts:55-94` implements as written |
| discoverPlugins + listByKind, grouped/JSON output | DONE | `cli.ts:57-94` |
| Tests via createProgram factory | DONE | `cli.test.ts:9-56` (list tests green this run) |
| 04_DESIGN §1 same-commit documentation | DONE | `docs/04_DESIGN.md:28-29,36,68-83` |

**SECUA Review (focus: all)** — no blocker/major/minor findings. Local manifest reads only; no injection surface; registry logic stays in `@gobing-ai/kk-core` (no duplication); error paths exit non-zero with clear messages.

**Artifact disclosure (`.spur/run/**` is gitignored; fix-pass mutations listed for discoverability)**

- `.spur/run/0020-verdict.json:1-55` — rewritten this run: verdict PASS, requirement rows R1–R4 status MET, AC rows keyed to feature scenario titles with status MET (L4 satisfaction contract).
### Review
| Severity | Finding | Location | Status |
| --- | --- | --- | --- |
| P4 | Plugins subcommands integrated cleanly into Commander hierarchy | `apps/cli/src/cli.ts:40` | Resolved |

#### Residual Risk & Final Disposition
- All requirements R1–R4 met with full unit test coverage and 04_DESIGN sync. Approved for `done`.
### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History
- 2026-07-31T04:01:48.662Z todo → wip (system)
- 2026-07-31T04:01:50.162Z wip → testing (system)
- 2026-07-31T04:01:51.781Z testing → done (system)
