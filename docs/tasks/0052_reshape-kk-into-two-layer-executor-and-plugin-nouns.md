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
updated_at: "2026-08-13T03:48:54.823Z"
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
`--force` re-verify of already-`done` 0052. Prior Review P2 (`plugin|plugins` visible in `kk --help`) is **resolved** in the current tree: `registerPluginCommand` uses a hidden top-level `plugins` command, not group `.alias()`. Verify mode does not rewrite `## Review`.

**Per-Requirement Traceability**

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `apps/cli/src/cli.ts:20-21` registers only executor/plugin; `apps/cli/src/commands/plugin.ts:163-183` hidden `plugins` (no group alias); this run `kk --help` lists `executor`, `plugin`, `help` only; `apps/cli/tests/main.test.ts:52-63` |
| R2 | MET | `apps/cli/src/commands/executor.ts:97-104` flags `<plugin> --in --out [--plugins-root]`; `apps/cli/src/commands/executor.ts:29-38` `runInvoke` + CommanderError carries entry exit; `apps/cli/tests/commands/executor.test.ts:114-149` exit 3; engine `apps/cli/src/invoke.ts` unchanged vs HEAD |
| R3 | MET | `apps/cli/src/commands/executor.ts:106-112` fan-in `--in`/`--out` → `runFanin`; this run `kk help executor` names `fan-in`; `apps/cli/tests/commands/executor.test.ts:82-88` |
| R4 | MET | `apps/cli/src/commands/plugin.ts:120-132` grouped text + `[healthy]`/`[unhealthy]`; `--kind` filter `apps/cli/src/commands/plugin.ts:95-100`; `apps/cli/tests/commands/plugin.test.ts:91-106` |
| R5 | MET | `apps/cli/src/commands/plugin.ts:47-67` `{ healthy, plugins, diagnostics }`; `missing_entry` on plugin (`apps/cli/src/commands/plugin.ts:53-60`); tree codes in top-level `diagnostics` (`apps/cli/src/commands/plugin.ts:66`); this run `kk plugin status --json --plugins-root ./plugins` exit 0; `apps/cli/tests/commands/plugin.test.ts:126-176` exit 1 missing_entry + misplaced |
| R6 | MET | Hidden `invoke`/`fanin`/`fanout` `apps/cli/src/commands/executor.ts:125-151`; hidden `plugins` + `list`/`doctor` `apps/cli/src/commands/plugin.ts:174-183`; this run those `--help` paths work and `kk --help` does not list them; `apps/cli/tests/cli.test.ts` hidden-alias block |
| R7 | MET | `apps/cli/src/commands/add.ts` absent; this run `kk add 1 2` exit 1 `unknown command 'add'`; `apps/cli/tests/index.test.ts:13-20` |
| R8 | MET | `docs/04_DESIGN.md:23-45` two-noun table; `docs/design/kk-cli-surface.md`; `docs/03_ARCHITECTURE.md:124-150`; `README.md:78-81`; `.spur/workflows/kk-ingest-generate-publish.yaml:25-39`; ADR-006 `docs/00_ADR.md:210-211,227-230`; ADR-010 `docs/00_ADR.md:377-381`; ADR-011 `docs/00_ADR.md:385-415` |
| R9 | MET | this run `kk not-a-noun` exit 1 `unknown command 'not-a-noun'`; `apps/cli/tests/main.test.ts:114-118` |
| R10 | MET | `apps/cli/src/commands/executor.ts:114-123` `--content --target --out --retry-from --plugins-root` → `runFanout`; this run `kk help executor` names `fan-out`; `apps/cli/tests/commands/executor.test.ts` retry-from + flags |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| R1 — kk --help lists only executor and plugin as first-layer nouns | MET | command | `bun run apps/cli/src/index.ts --help` exit 0; Commands: executor, plugin, help |
| R2 — kk executor run invokes a plugin with the current invoke flags | MET | test | `apps/cli/tests/commands/executor.test.ts:114-149` |
| R3 — kk executor fan-in keeps the current fanin engine flags and exit codes | MET | command | `bun run apps/cli/src/index.ts help executor` exit 0 names `fan-in`; `executor.test.ts` merge + missing-input |
| R4 — kk plugin status lists discovered plugins with a health attribute | MET | test | `apps/cli/tests/commands/plugin.test.ts:91-106` |
| R5 — kk plugin status --json emits a unified health report and fails when unhealthy | MET | command | `kk plugin status --json --plugins-root ./plugins` exit 0 `{healthy,plugins,diagnostics}`; `apps/cli/tests/commands/plugin.test.ts:126-176` exit 1 |
| R6 — Hidden aliases keep the old command paths working | MET | command | `kk invoke/fanin/fanout/plugins list/plugins doctor --help` exit 0; `kk --help` omits those names |
| R7 — kk add is no longer a registered command | MET | command | `kk add 1 2` exit 1; `commands/add.ts` gone |
| [doc-only] R8 — Surface docs and ADRs name the two-noun tree | MET | static-ref | `docs/04_DESIGN.md:23-45`; `docs/00_ADR.md:210-211,377-415` |
| R9 — Unknown first-layer noun fails loud | MET | command | `kk not-a-noun` exit 1 names `not-a-noun` |
| R10 — kk executor fan-out keeps the current fanout engine flags and exit codes | MET | test | `apps/cli/tests/commands/executor.test.ts` fan-out flags + `--retry-from` |

**Design conformance:** 5/5 DONE (two groups, engine reuse, hidden aliases including hidden `plugins` command, `add` deleted, unified status). Prior CHANGED (group `.alias('plugins')`) is now DONE (`apps/cli/src/commands/plugin.ts:157-183`).

**Checks:** design-conformance pass; evidence-rule-pass; cli-golden-path-present (`plugin status --json` this run); scope-creep none; lint-clean pass (`bun run lint` exit 0); tests-pass (`bun run test` 240 pass / 0 fail).

**SECUA (`--focus all`):** no P1–P3. S — no new secret/injection surface. E — single discovery pass. C — JSON/exit/diagnostics verified this run. U — help matches two-noun contract. A — CLI → engine → kk-core unchanged. Residual P4 from prior Review (declaration duplication, argv rebuild) remain advisory.

**Coverage:** line 99.12% / function 99.27% (`bun run test` this run).

**`--fix all`:** no UNMET/PARTIAL and no major SECUA — no remediations this pass.

**`--next`:** task already terminal (`done`) — no-op (no `testing → done` hop).
### Review
| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P4 | Usability | `apps/cli/src/commands/plugin.ts:90-107` | `plugin status --kind` filters `plugins[]` but `healthy`/`diagnostics` stay tree-wide. Documented in `docs/04_DESIGN.md` § `plugin status` (tree-wide health). No code change — matches R5 exit-1-on-any-diagnostic. |
| P4 | Architecture | `apps/cli/src/commands/executor.ts:97-151` | Flag declarations duplicated on hidden top-level aliases. Action bodies are shared. Follow-up, not this task. |
| P4 | Efficiency | `apps/cli/src/commands/executor.ts:48-83` | `runFanin`/`runFanout` argv rebuild is the pre-existing engine contract. Follow-up: typed engine entry points. |

**Resolved this feature**

| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P2 | Usability | `apps/cli/src/commands/plugin.ts:157-183` | Commander 15 rendered group `.alias('plugins')` as `plugin\|plugins` in `kk --help`. Fixed: hidden top-level `plugins` command. Re-verified: `kk --help` lists `executor`, `plugin`, `help` only. |

**Disposition:** PASS — P2 closed; remaining rows are advisory P4. `spur task check 0052` clean; `.spur/run/0052-verdict.json` PASS; dogfood `docs/dogfood/2026-08-12-A21-two-layer-cli-dogfood.md`.
### References

A21

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-08-13T01:25:10.545Z todo → wip (system)
- 2026-08-13T01:46:57.505Z wip → testing (system)
- 2026-08-13T01:47:02.548Z testing → done (system)
