---
template: feature-impl
schema_version: 1
name: "Reshape kk into two-layer executor and plugin nouns"
description: ""
status: done
type: task
profile: standard
feature_id: A21
parent_wbs: null
priority: P1
tags: ["cli", "surface"]
dependencies: []
ac_numbering: task-local
created_at: "2026-08-13T00:59:01.008Z"
updated_at: "2026-08-13T01:47:35.901Z"
---

## 0052. Reshape kk into two-layer executor and plugin nouns

### Background

Implements: R1 — kk --help lists only executor and plugin as first-layer nouns; R2 — kk executor run invokes a plugin with the current invoke flags; R3 — kk executor fan-in keeps the current fanin engine flags and exit codes; R4 — kk plugin status lists discovered plugins with a health attribute; R5 — kk plugin status --json emits a unified health report and fails when unhealthy; R6 — Hidden aliases keep the old command paths working; R7 — kk add is no longer a registered command; R8 — [doc-only] Surface docs and ADRs name the two-noun tree; R9 — Unknown first-layer noun fails loud; R10 — kk executor fan-out keeps the current fanout engine flags and exit codes.

A2 shipped the register-per-noun tree but left mixed-depth names (`add`, `invoke`, `fanin`, `fanout`, `plugins list|doctor`). ADR-011 locks two first-layer nouns. Engines in `invoke.ts` / `fanin.ts` / `fanout.ts` stay; only registration, help, status JSON, aliases, and T3 docs change.

Rubric: E1 D0 L1 C0 R1 = 3 → keep as one task. One deliverable, one rollback, same review context (`apps/cli` command tree + surface docs). Rejected split (executor vs plugin vs docs): all three edit `cli.ts` and the same help/JSON tests.

### Requirements
- [x] R1. `kk --help` lists only `executor` and `plugin` as first-layer commands; `add`, `invoke`, `fanin`, `fanout`, and `plugins` are not visible there.
- [x] R2. `kk executor run <plugin> --in --out [--plugins-root]` calls `runInvoke` with those flag names and the same exit-code contract as today's `invoke`.
- [x] R3. `kk executor fan-in` calls `runFanin` with today's flags; `kk help executor` names the hyphenated verb `fan-in`.
- [x] R4. `kk plugin status [--kind] [--plugins-root]` lists plugins grouped by kind with a per-plugin health mark; `--kind` still filters.
- [x] R5. `kk plugin status --json` writes `{ healthy, plugins, diagnostics }`; each `plugins[]` entry has `healthy` and `diagnostics`; tree-level codes stay in top-level `diagnostics`; exit `0` when healthy and `1` when any diagnostic exists.
- [x] R6. Hidden aliases `invoke`, top-level `fanin`/`fanout`, `plugins`, `plugins list`, and `plugins doctor` reach the same engines and do not appear as visible first-layer commands.
- [x] R7. `kk add` exits non-zero; `apps/cli/src/commands/add.ts` is deleted.
- [x] R8. The implementing commit updates `docs/04_DESIGN.md` §1, `docs/design/kk-cli-surface.md`, README, `.spur/workflows/kk-ingest-generate-publish.yaml`, and the current `03` pipeline diagram to the new names (ADR-011 already recorded).
- [x] R9. `kk not-a-noun` exits non-zero and stderr names the unknown command.
- [x] R10. `kk executor fan-out` calls `runFanout` with today's flags (`--content`, `--target`, `--out`, `--retry-from`, `--plugins-root`) and exit codes; `kk help executor` names the hyphenated verb `fan-out`.
### Acceptance Criteria
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
### Q&A
- **Two first-layer nouns** — `executor` + `plugin` only. Approved at idea-eval (Approach 1).
- **`executor run` ≡ `invoke`** — same engine and flags. Approved.
- **Retire `kk add`** — approved (not kept).
- **Hidden one-release aliases** — approved (not a hard cut).
- **`plugin status` exit 1 when unhealthy** — approved; tree-level diagnostics stay in top-level `diagnostics`.
- **Feature home A21 under A2** — not B4 (B4 Goal is list+doctor only).
### Design
Chosen approach: two Commander groups — `registerExecutorCommand` (`commands/executor.ts`) and `registerPluginCommand` (`commands/plugin.ts`). Actions call the existing engines and throw `CommanderError` the same way today's modules do. Hidden aliases are Commander `hidden: true` commands (or `.alias` on the group) that invoke the same action functions — no second implementation.

Why: ADR-010 already requires one file per noun; ADR-011 names the nouns. Deleting `add` makes the two-noun claim true.

Rejected:
- Single noun `plugin` for run/fan-in/fan-out/status — fan-in does not resolve a plugin.
- First-layer `kk run` — leaves mixed depth.
- Dual JSON shapes behind `list`/`doctor` aliases — two contracts to test; aliases call `status`.
- Visible aliases that warn on stdout — pollutes `--json` unless carefully split; hidden is enough for an unpublished 0.1.0.

Invariants:
- `runInvoke` / `runFanin` / `runFanout` / `discoverPlugins` signatures do not change.
- `--json` stays per-command.
- No `process.exit` in command modules.
- `createProgram()` stays a side-effect-free factory.
- Tree-level diagnostics (`misplaced`, `kind_mismatch`, `malformed`, `duplicate_name`) are never dropped just because they are not on a `PluginRecord`.

Signatures (shape only):
```ts
export function registerExecutorCommand(program: Command): void;
export function registerPluginCommand(program: Command): void;
interface PluginStatusJson {
  healthy: boolean;
  plugins: Array<PluginRecord & { healthy: boolean; diagnostics: DiscoveryDiagnostic[] }>;
  diagnostics: DiscoveryDiagnostic[];
}
```
`missing_entry` is attached to the plugin's `diagnostics` (and counts toward `healthy: false`); discovery codes that have no matching record stay in the top-level `diagnostics` array.
### Plan
1. Add `commands/executor.ts`: group `executor` with `run`, `fan-in` (alias `fanin`), `fan-out` (alias `fanout`); wire `runInvoke` / `runFanin` / `runFanout`; register hidden top-level `invoke` / `fanin` / `fanout` that call the same actions.
2. Add `commands/plugin.ts`: group `plugin` (alias `plugins`) with `status` (`--kind`, `--json`, `--plugins-root`); build unified report; exit 1 when diagnostics exist; hidden `list` and `doctor` on the group map to `status`.
3. Point `cli.ts` at the two registers; delete `commands/add.ts`, `commands/invoke.ts`, `commands/plugins.ts`, `commands/fanin.ts`, `commands/fanout.ts`.
4. Rewrite CLI tests (`cli.test.ts`, `commands/*.test.ts`) onto the new paths and the unified JSON object; assert hidden aliases still work; assert `add` is gone; keep engine unit tests (`invoke.test.ts`, `fanin.ts`, `fanout.ts`) unchanged except help/argv samples.
5. Same-commit T3: `docs/04_DESIGN.md` §1 command table; rewrite the current `03` pipeline diagram (drop the accepted-design hedge); README; `.spur/workflows/kk-ingest-generate-publish.yaml` → `kk executor run`; bump satellite status from accepted-design to shipped.
6. `bun run lint` + `bun run test` + `bun run build` green.
### Solution
| File | Lines | What/Why |
| --- | --- | --- |
| `apps/cli/src/commands/executor.ts` | 1-152 | New: `registerExecutorCommand` — group `executor` with `run` (ex-`invoke` flags `<plugin> --in --out [--plugins-root]`), `fan-in` alias `fanin`, `fan-out` alias `fanout` (flag sets and exit codes unchanged), plus hidden top-level `invoke`/`fanin`/`fanout` aliases calling the same action functions; hyphenated verbs are canonical (R2/R3/R6/R10). |
| `apps/cli/src/commands/plugin.ts` | 1-174 | New: `registerPluginCommand` — group `plugin` alias `plugins` with `status` (`--kind`, `--json`, `--plugins-root`); unified report `{ healthy, plugins, diagnostics }`; `missing_entry` attaches to the owning plugin's `diagnostics` and counts toward `healthy:false`; tree-level codes stay in top-level `diagnostics`; exits 1 when any diagnostic exists; hidden `list`/`doctor` map to `status` (R4/R5/R6). |
| `apps/cli/src/cli.ts` | 1-24 | Re-pointed `createProgram()` at the two new registers (executor, plugin); removed the five old register calls; factory stays side-effect-free (R1). |
| `apps/cli/src/commands/add.ts` | deleted | `kk add` retired — no longer registered (R7). |
| `apps/cli/src/commands/invoke.ts` | deleted | Registration moved into `executor run` + hidden `invoke` alias; engine `src/invoke.ts` untouched (R2). |
| `apps/cli/src/commands/fanin.ts` | deleted | Registration moved into `executor fan-in` + hidden `fanin`; engine `src/fanin.ts` untouched (R3). |
| `apps/cli/src/commands/fanout.ts` | deleted | Registration moved into `executor fan-out` + hidden `fanout`; engine `src/fanout.ts` untouched (R10). |
| `apps/cli/src/commands/plugins.ts` | deleted | Replaced by `plugin status` (unified health report, exit 1 on diagnostics) (R4/R5). |
| `apps/cli/tests/commands/executor.test.ts` | 1-259 | New: group/subcommand registration, shipped flags, help names `fan-in`/`fan-out`, engine exit codes via `main`, hidden invoke/fanin/fanout and group aliases reach the same engines (R2/R3/R6/R10). |
| `apps/cli/tests/commands/plugin.test.ts` | 1-221 | New: registration, unified JSON contract (`healthy`/`plugins`/`diagnostics`, per-plugin `healthy`+`diagnostics`), `missing_entry` placement, tree diagnostics top-level, exit 0/1, hidden `plugins list`/`doctor` reach `status` (R4/R5/R6). |
| `apps/cli/tests/cli.test.ts` | 1-373 | Rewritten onto `executor`/`plugin` paths and the unified JSON object; ports the fan-in/fan-out/status behavior tests; asserts hidden aliases (R1-R6/R10). |
| `apps/cli/tests/main.test.ts` | 1-101 | Rewritten: `--help` lists only `executor`/`plugin` (no `add`/`invoke`/`fanin`/`fanout`/`plugins` entries), verb help, version, verbose purity, unknown command names itself (R1/R9). |
| `apps/cli/tests/index.test.ts` | 1-45 | Rewritten: `createProgram()` exposes executor/plugin groups, `add` is gone, fail-loud run path (R1/R7). |
| `apps/cli/tests/commands/add.test.ts`, `invoke.test.ts`, `fanin.test.ts`, `fanout.test.ts`, `plugins.test.ts` | deleted | Obsolete command-module tests replaced by executor/plugin suites; engine tests (`tests/invoke.test.ts`, `tests/fanin.test.ts`, `tests/fanout.test.ts`) kept unchanged. |
| `docs/04_DESIGN.md` | 19-151 | §1 command table + sections rewritten to `kk executor run|fan-in|fan-out` and `kk plugin status` (unified JSON shape, missing_entry placement, exit codes); `add` section removed; manifest arg name updated (T3, R8). |
| `docs/03_ARCHITECTURE.md` | 119-162 | Pipeline diagram rewritten to `kk executor fan-in` / `executor run` / `executor fan-out`; accepted-design hedge replaced with shipped note; module boundary table updated (R8). |
| `README.md` | 26, 74-84 | Features + Commands tables on the two-noun names; `kk add` row removed; hidden aliases noted (R8). |
| `.spur/workflows/kk-ingest-generate-publish.yaml` | 6, 25, 32, 39 | Workflow states shell `kk executor run` instead of `knowledge-kit invoke` (R8). |
| `docs/05_FEATURES.md` | 46 | A21 row flipped from backlog to verifying with shipped note. |
| `docs/features/INDEX.md` | 7 | Regenerated by `spur feature refresh` — A21 now `[verifying]`. |
| `docs/features/A21_two-layer-cli-nouns-executor-plugin.md` | 1-12 | Feature status walked `backlog → active → verifying` via `spur feature update` (done requires the strict gate after task verification); history recorded. |
| `docs/design/kk-cli-surface.md` | 3 | Header flipped from "Accepted design — ADR-011; not yet built" to shipped. |
| `docs/00_ADR.md` | 224-228, 377-380 | ADR-006 amendment (uniform entrypoint `kk executor run`, `invoke` alias) and ADR-010 amendment (two first-layer nouns, `add` retired) — landed during planning, verified present for R8. |
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `apps/cli/src/cli.ts:20-21` registers only executor/plugin; `apps/cli/src/commands/plugin.ts:163-183` — `plugin` group carries no alias, deprecated `plugins` path is a hidden top-level delegation command (`plugin.ts:180-183`) that never renders; verified this run: `kk --help` exits 0 and lists exactly `executor`, `plugin`, and Commander's built-in `help` — no `plugin\ |
| R2 | MET | `apps/cli/src/commands/executor.ts:98-104` `executor run <plugin> --in --out [--plugins-root]`; `executor.ts:29-38` `runInvokeAction` → `runInvoke`, `CommanderError(code, …)` carries the engine exit code; `apps/cli/tests/commands/executor.test.ts:114-149` asserts a failing plugin entry's exit code 3 surfaces through `main`; probed this run: `kk executor run nonexistent …` exits 1; engine `apps/cli/src/invoke.ts` untouched (`git status` clean) |
| R3 | MET | `executor.ts:107-112` `fan-in` with repeatable `--in`/required `--out`; `executor.ts:48-58` `runFaninAction` → `runFanin` (engine exit codes 1/2 preserved — `apps/cli/src/fanin.ts` untouched, `apps/cli/tests/fanin.test.ts:190-207` exit 2 on usage errors); verified this run: `kk help executor` names `fan-in`; `executor.test.ts:12-19` group verbs `['run','fan-in','fan-out']` |
| R4 | MET | `apps/cli/src/commands/plugin.ts:90-100` `statusAction` `--kind` filter via `isPluginKind` (invalid kind → exit 1, `plugin.ts:96-98`); `plugin.ts:120-131` text output groups by kind with per-plugin `[healthy]`/`[unhealthy]` mark; tests `apps/cli/tests/commands/plugin.test.ts:79-83`; probed this run: `kk plugin status --kind ingestion` prints only INGESTION PLUGINS with `[healthy]`, `--kind bogus` exits 1 |
| R5 | MET | `plugin.ts:47-68` `buildStatusReport` emits `{ healthy, plugins, diagnostics }`; per-plugin `healthy`+`diagnostics` (`plugin.ts:50-63`), `missing_entry` attaches to the owning plugin (`plugin.ts:54-58`), tree-level codes stay in top-level `diagnostics` (`plugin.ts:66`); exit 0 healthy / 1 any diagnostic (`plugin.ts:103-107` JSON path, `:115,137` text paths); tests `plugin.test.ts:126-151` (`missing_entry` placement, exit 1), `:157-175` (`misplaced` top-level), `:181-198` (text exit 1); probed this run: healthy repo root exit 0, broken root via `plugins doctor --json` exit 1 with `healthy:false` |
| R6 | MET | Hidden aliases reach the same action functions and do not appear in help: `executor.ts:128-145` hidden top-level `invoke`/`fanin`/`fanout`; `plugin.ts:180-183` hidden top-level `plugins` delegation command with hidden `status`/`list`/`doctor` subcommands; tests `apps/cli/tests/cli.test.ts:292-374` (invoke/fanin/fanout/plugins list/doctor reach the engines), `plugin.test.ts:226-241` (plugins list/doctor unified JSON, exit 1 on diagnostics), `main.test.ts:62` (no legacy names in exact help list), `plugin.test.ts:68-69` (no `plugin\ |
| R7 | MET | `apps/cli/src/commands/add.ts` deleted (`git D`); `cli.ts:20-21` registers only executor/plugin; tests `apps/cli/tests/index.test.ts:13-20` (`add` undefined on `createProgram()`, `kk add 1 2` non-zero); probed this run: `kk add 1 2` exits 1 |
| R8 | MET | `docs/04_DESIGN.md:26-30` command surface, `:35-38` two-noun table, `:43-44` hidden aliases "not listed in `kk --help`" (now true post-fix), `:65-87` `plugin status` unified report, `:89-93,115-116` hidden `fanin`/`fanout` aliases; `docs/03_ARCHITECTURE.md:144-151` pipeline diagram `kk executor fan-in |
| R9 | MET | `apps/cli/tests/main.test.ts:114-117` unknown command names itself on stderr; probed this run: `kk not-a-noun` exits 1, stderr `error: unknown command 'not-a-noun'` |
| R10 | MET | `executor.ts:115-123` `fan-out` flags `--content --target --out --retry-from --plugins-root`; `executor.ts:68-83` `runFanoutAction` → `runFanout` (engine untouched — `apps/cli/src/fanout.ts` clean, `apps/cli/tests/fanout.test.ts:375-391,409-428` exit 2 on usage/missing-file errors); tests `executor.test.ts:66-70` (flag set), `:223-280` (`--retry-from` carries successes as skipped, retries only failures); verified this run: `kk help executor` names `fan-out` |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R1 — kk --help lists only executor and plugin as first-layer nouns | MET | test | `apps/cli/tests/main.test.ts:39-62` exact visible list `['executor','help','plugin']` (fails against old `.alias('plugins')` defect); probe `kk --help` this run exits 0 with no `plugin\ |
| Scenario: R2 — kk executor run invokes a plugin with the current invoke flags | MET | test | `executor.test.ts:114-149` failing entry exit 3 surfaces; probe `kk executor run nonexistent --in … --out …` exits 1; flags `<plugin> --in --out [--plugins-root]` at `executor.ts:98-104` |
| Scenario: R3 — kk executor fan-in keeps the current fanin engine flags and exit codes | MET | test | `executor.test.ts:12-19` fan-in registered with repeatable `--in`/required `--out`; engine exit codes via unchanged `apps/cli/src/fanin.ts` + `fanin.test.ts:190-207`; probe `kk help executor` names `fan-in` |
| Scenario: R4 — kk plugin status lists discovered plugins with a health attribute | MET | test | `plugin.test.ts:79-83` unified report with per-plugin `healthy`; probes `kk plugin status --kind ingestion` (grouped, `[healthy]`) and `--kind bogus` (exit 1); grouping `plugin.ts:120-131` |
| Scenario: R5 — kk plugin status --json emits a unified health report and fails when unhealthy | MET | test | `plugin.test.ts:126-151` (`missing_entry` on plugin, exit 1), `:157-175` (tree `misplaced` top-level), `:181-198` (text exit 1); probes healthy root exit 0, broken root exit 1 with `healthy:false`; `plugin.ts:47-68,103-107` |
| Scenario: R6 — Hidden aliases keep the old command paths working | MET | test | `cli.test.ts:292-374` alias→engine routing; `plugin.test.ts:226-241` plugins list/doctor unified JSON; probes `kk plugins list |
| Scenario: R7 — kk add is no longer a registered command | MET | test | `index.test.ts:13-20`; probe `kk add 1 2` exits 1; `apps/cli/src/commands/add.ts` deleted (git D) |
| Scenario: R8 — [doc-only] Surface docs and ADRs name the two-noun tree | MET | static-ref | `docs/04_DESIGN.md:26-30,35-38,43-44`; `docs/03_ARCHITECTURE.md:144-151,158-161`; `docs/design/kk-cli-surface.md:89-91`; `README.md:24,78-83`; `.spur/workflows/kk-ingest-generate-publish.yaml:6,25,32,39`; ADR-006 amendment `docs/00_ADR.md:210-211,227-231` (dated 2026-08-12); ADR-010 amendment `docs/00_ADR.md:377-381` (dated 2026-08-12); ADR-011 `docs/00_ADR.md:387-401` |
| Scenario: R9 — Unknown first-layer noun fails loud | MET | test | `main.test.ts:114-117`; probe `kk not-a-noun` exits 1, stderr names it |
| Scenario: R10 — kk executor fan-out keeps the current fanout engine flags and exit codes | MET | test | `executor.test.ts:66-70` (flags), `:223-280` (`--retry-from` carry); engine exit codes via unchanged `apps/cli/src/fanout.ts` + `fanout.test.ts:375-391,409-428`; probe `kk help executor` names `fan-out` |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P2 | Usability (SECUA-U) / functional | `apps/cli/src/commands/plugin.ts:147`; `apps/cli/tests/main.test.ts:34`; `docs/04_DESIGN.md:43-44`; `docs/design/kk-cli-surface.md:89-91,147` | The `plugins` group alias is **visible** in `kk --help` as `plugin\|plugins` (verified by running `kk --help`). This violates the R1/R6 core-AC sub-condition "does not list ... `plugins` as visible first-layer commands", and contradicts the docs' own claim that hidden aliases are not listed in `kk --help` (DESIGN.md §1 note; kk-cli-surface §4 + invariant 5). Commander 15 renders group `.alias()` in help; only `hidden: true` commands are omitted (`invoke`/`fanin`/`fanout`/`list`/`doctor` are correctly hidden). The test blind spot: `commandEntry = /^\s+(add|invoke|fanin|fanout|plugins)\s/m` cannot match the `plugin\|plugins` rendering (line starts with `plugin|`), so the suite passes with the defect present. Remediation: register a hidden `plugins` delegation command instead of group `.alias()` (or amend AC + docs to accept the alias rendering); strengthen the help assertion to parse the command-name column (assert no `plugins` token in the Commands section). |
| P4 | Usability | `apps/cli/src/commands/plugin.ts:103-107` | `plugin status --kind <k> --json` filters `plugins[]` but reports `healthy`/`diagnostics` over the **unfiltered** tree; the report can be `healthy:false` with every listed plugin healthy and top-level diagnostics naming plugins absent from `plugins[]` (verified with a mixed broken/healthy root). Matches R5's "exit 1 when any diagnostic exists" wording, but the mixed scope is surprising for a filtered report — document the semantics (tree-wide health) in `docs/04_DESIGN.md` §1, or compute health over the filtered set. |
| P4 | Architecture | `apps/cli/src/commands/executor.ts:98-152` | Flag/option declarations are duplicated per verb between the `executor` group and the hidden top-level aliases (run / fan-in / fan-out × 2 = ~30 duplicated declaration lines). Action logic is shared (no second implementation — design claim holds); only declarations repeat. Advisory: extract a shared registration builder (e.g. `registerRunCommand(program, opts)`) in a follow-up. |
| P4 | Efficiency | `apps/cli/src/commands/executor.ts:48-63,68-88` | `runFaninAction` / `runFanoutAction` re-serialize commander options into an argv slice that `runFanin` / `runFanout` re-parse (parse → rebuild → re-parse round-trip). Pre-existing pattern from the deleted `fanin.ts`/`fanout.ts`, deliberately kept to honor the "engine signatures unchanged" invariant — acceptable now; advisory follow-up: typed options entry points on the engines. |

**Per-Requirement Traceability**

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | PARTIAL | `apps/cli/src/cli.ts:16-17` registers only executor/plugin; verified `kk --help` lists `executor` and `plugin\|plugins` — the `plugins` alias is visible (plugin.ts:147), violating the "not visible" sub-condition; test blind spot `apps/cli/tests/main.test.ts:34,44` |
| R2 | MET | `apps/cli/src/commands/executor.ts:98-104` run flags `<plugin> --in --out [--plugins-root]`; `executor.ts:29-43` runInvokeAction → `runInvoke`, CommanderError carries the engine exit code; `apps/cli/tests/commands/executor.test.ts:117-150` asserts a failing entry's exit code 3 surfaces; engine `apps/cli/src/invoke.ts` unchanged vs HEAD |
| R3 | MET | `executor.ts:107-112` fan-in with repeatable `--in`/required `--out` via runFaninAction → `runFanin` (engine untouched, exit codes 1/2 preserved); verified `kk help executor` names `fan-in`; `executor.test.ts:87-97` |
| R4 | MET | `apps/cli/src/commands/plugin.ts:117-135` groups by kind with `[healthy]`/`[unhealthy]` mark; `--kind` filters (plugin.ts:94-98); `apps/cli/tests/commands/plugin.test.ts:57-71`; verified by run |
| R5 | MET | `plugin.ts:47-73` buildStatusReport `{ healthy, plugins, diagnostics }` with per-plugin `healthy`+`diagnostics`; tree codes (`misplaced` etc.) in top-level `diagnostics` (plugin.ts:66); `missing_entry` on the owning plugin (plugin.ts:54-60); exit 0 healthy / 1 any diagnostic (plugin.ts:103-107); verified by run on a broken root + `plugin.test.ts:73-129` |
| R6 | PARTIAL | Aliases reach the same engines: hidden `invoke`/`fanin`/`fanout` (executor.ts:128-151), group alias + hidden `list`/`doctor` (plugin.ts:147,160-173); tested `cli.test.ts:301-374`, `executor.test.ts:257-336`; but `plugins` renders in `kk --help` as `plugin\|plugins` — the "not visible" sub-condition is unmet for `plugins` (see P2) |
| R7 | MET | `apps/cli/src/commands/add.ts` deleted (git D); `cli.ts` no longer registers it; verified `kk add` → exit 1, stderr `unknown command 'add'`; `apps/cli/tests/index.test.ts:17-27` |
| R8 | MET | `docs/04_DESIGN.md:19-110` §1 two-noun table; `docs/03_ARCHITECTURE.md` diagram + module table rewritten (diff vs HEAD); `docs/design/kk-cli-surface.md` shipped header + D7–D11; `README.md` features/commands tables; `.spur/workflows/kk-ingest-generate-publish.yaml` shells `kk executor run`; ADR-006 amendment `docs/00_ADR.md:210-211,224-228` (uniform entrypoint `kk executor run`, `invoke` alias) and ADR-010 amendment `docs/00_ADR.md:377-380` (two first-layer nouns, `add` retired), both dated 2026-08-12 |
| R9 | MET | verified `kk not-a-noun` → exit 1, stderr `error: unknown command 'not-a-noun'`; `apps/cli/tests/main.test.ts:63-68` |
| R10 | MET | `executor.ts:115-123` fan-out flags `--content --target --out --retry-from --plugins-root` via runFanoutAction → `runFanout` (engine untouched, exit codes 1/2 preserved); `--retry-from` carry-over test `executor.test.ts:193-254`; verified `kk help executor` names `fan-out` |

**Design invariants — all DONE**

- `runInvoke` / `runFanin` / `runFanout` / `discoverPlugins` signatures unchanged — engines untouched vs HEAD (`git diff HEAD -- apps/cli/src/{invoke,fanin,fanout}.ts` empty).
- `--json` stays per-command (only `plugin status`/`list`/`doctor`, plugin.ts:153/163/171).
- No `process.exit` in command modules — sole exit seam is `apps/cli/src/index.ts:5`; command modules throw `CommanderError`, `main()` maps (main.ts:46-54).
- `createProgram()` side-effect-free factory (`apps/cli/src/cli.ts:11-20`).
- Tree-level diagnostics never dropped — `discovery.diagnostics` spread into top-level `diagnostics` (plugin.ts:66); verified with a `misplaced` fixture.
- `missing_entry` attached to the owning plugin's `diagnostics` and counts toward `healthy:false` (plugin.ts:54-65); verified by run + `plugin.test.ts:96-115`.

**Design conformance:** 5/5 chosen-approach claims DONE (two Commander groups, engine reuse, hidden aliases, `add` deletion, unified status report) with one CHANGED nuance: the group `.alias('plugins')` was assumed hidden (kk-cli-surface D10 / executor.ts:125-126 comment) but Commander 15 renders group aliases in help — the surface claim "not listed in `kk --help`" (DESIGN.md:44, kk-cli-surface:89-91,147) does not hold for `plugins` (P2 above).

**SECUA:** S — no new surface (no secrets/shell/injection; `--plugins-root` path input unchanged). E — no regressions; single discovery pass per status; argv rebuild round-trip is pre-existing and invariant-preserving (P4). C — JSON contract, exit codes, diagnostics placement all verified by fresh runs; type-fit OK (`PluginRecord`/`DiscoveryDiagnostic` fields resolved against `packages/kk-core/src/registry.ts`). U — clear help/error text; P2 alias-visibility + P4 `--kind` scope-mix notes. A — boundaries respected (CLI → engine → core); registration modules thin but purposeful (real action bodies + report logic); no deepening blocker.

**Architecture-depth signals:** no shallow-module, tight-coupling, wrong-seam, or weak-locality hits; test surface strong (suites drive `main()` end-to-end over tmp fixture plugin roots). Two advisory candidates (P4 rows above: duplicated option declarations, argv rebuild round-trip).

**Verification evidence (run this turn):** `bun run lint` exit 0; repo `bun test` 240 pass / 0 fail (774 expects); `apps/cli` suite 105 pass / 0 fail; manual probes — `kk --help` (exit 0; shows `plugin|plugins`), `kk help executor` (lists `fan-in`/`fan-out`), `kk not-a-noun` (exit 1, names it), `kk add` (exit 1), `kk invoke/fanin/fanout/plugins list|doctor --help` (alias routes), `kk plugin status --json` on healthy repo root (exit 0) and on a broken fixture root with `missing_entry` + `misplaced` (exit 1, correct placement), `kk executor run` missing plugin (exit 1), fan-in/fan-out usage errors (exit 1 commander-level), `kk plugin status --kind bogus` (exit 1).

**Functional verdict: PARTIAL** — R1/R6 PARTIAL (no UNMET; all other requirements MET).

**Disposition: needs-fix** — the P2 `plugins`-in-help deviation must be resolved before approve: either implement a truly hidden `plugins` alias (hidden delegation command) or amend the R1/R6 AC + surface docs to accept the group-alias rendering; strengthen `main.test.ts:34`'s help assertion either way. No P1 findings; engines, JSON contract, and exit codes are correct.
### References

A21

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-08-13T01:25:10.545Z todo → wip (system)
- 2026-08-13T01:46:57.505Z wip → testing (system)
- 2026-08-13T01:47:02.548Z testing → done (system)
