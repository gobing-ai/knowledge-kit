---
template: feature-impl
schema_version: 1
name: "Discover built-in and user plugins via a merged registry"
description: ""
status: done
type: task
profile: standard
feature_id: B7
parent_wbs: null
priority: P1
tags: ["plugin-platform", "discovery"]
dependencies: []
ac_numbering: task-local
created_at: "2026-08-13T05:06:47.549Z"
updated_at: "2026-08-14T02:21:55.936Z"
---

## 0053. Discover built-in and user plugins via a merged registry

### Background
The kk plugin platform already scans one `--plugins-root` (default `./plugins`) for ADR-009 kind collections. That replace-not-union contract hides package-shipped built-ins when `kk` runs from a user CWD, and it cannot keep built-ins while adding a caller-named folder.

Covers feature B7 scenarios R1–R12. Satellite: `docs/design/multi-root-plugin-discovery.md`. Authority: ADR-012.

`~/.kk/plugins` is the default global store. Extra **plugin.json** folders union via `--plugins-path` / `KK_PLUGIN_PATH`. Custom **workflow kinds** are assumed to come from spur workflow YAML `extensions.actions` / `extensions.guards` (ts-libs C1, spur-new D4) — a separate channel.

Rubric: E1 D1 L1 C0 R1 = 4 → keep as one task.
### Requirements
- [x] R1. Default discovery (no `--plugins-root`) registers every valid plugin under the package-shipped kind collections and skips `plugins/kk`.
- [x] R2. A valid user plugin under `~/.kk/plugins/<collection>/<name>/` appears in `kk plugin status` next to built-in plugins of the same kind.
- [x] R3. `kk executor run <name>` executes a plugin that exists only on a default extra root and validates IO against the kind contract.
- [x] R4. `--plugins-root <dir>` scans that tree only; package-shipped plugins are not registered.
- [x] R5. When two default roots declare the same `name`, the higher-priority plugin is registered and a `shadowed` diagnostic names both paths.
- [x] R6. `kk plugin status --json` includes `origin` (`builtin` | `project` | `user` | `path`) on each plugin record.
- [x] R7. A plugin that exists only on a `KK_PLUGIN_PATH` root is registered with `origin: path`.
- [x] R8. A top-level `plugin.json` on an extra default root that is a plugins tree emits `misplaced` and does not abort discovery of valid plugins on other roots.
- [x] R9. When CWD `./plugins` is the same realpath as the package-shipped tree, each plugin name appears once with no `duplicate_name` diagnostic.
- [x] R10. Repeatable `--plugins-path <dir>` unions with built-ins and `~/.kk/plugins`. The dir may be a plugins tree, a kind collection, or a single folder that contains `plugin.json`.
- [x] R11. Passing `--plugins-root` and `--plugins-path` together is a usage error (exit 2).
- [x] R12. Product plugins stay name-resolved via `kk executor run`. Workflow YAML `extensions.actions` / `extensions.guards` (assumed spur D4) register extra kinds only; they do not replace kk registry discovery. This task does not implement the workflow schema.
### Acceptance Criteria
```gherkin
Feature: Discover built-in and user plugins via a combined registry

  Scenario: R1 — Built-in plugins are discovered by default from the package
    Given kk is invoked without the --plugins-root flag
    And the current working directory has no project plugins tree
    When discovery runs
    Then every valid plugin under the package-shipped kind collections is registered
    And plugins/kk is not registered as a kk-core plugin

  Scenario: R2 — A user kind-collection plugin merges with built-ins
    Given a valid plugin.json plugin under ~/.kk/plugins/publishings/my-pub/
    And built-in publish plugins are shipped with kk
    When kk plugin status runs without the --plugins-root flag
    Then both my-pub and the built-in publish plugins appear
    And my-pub is listed under kind publish

  Scenario: R3 — kk executor run resolves a merged-registry plugin by name
    Given a user plugin named extra-gen is present only on a default extra root
    When kk executor run extra-gen --in <file> --out <file> runs without the --plugins-root flag
    Then the extra-gen entry is executed
    And input and output are validated against the plugin's kind contract

  Scenario: R4 — --plugins-root remains an exclusive single-root scan
    Given built-in plugins exist on the package root
    And a separate directory tree contains only plugin isolated-pub
    When kk plugin status --plugins-root <that-tree> runs
    Then isolated-pub is registered
    And built-in plugins from the package root are not registered

  Scenario: R5 — A higher-priority root shadows a duplicate name
    Given two valid plugins on different default roots declare the same name
    When default discovery runs
    Then only the higher-priority root's plugin is registered
    And a diagnostic names the shadowed path and the winning path

  Scenario: R6 — kk plugin status reports each plugin's origin
    Given the combined registry contains a builtin plugin and a user plugin
    When kk plugin status --json runs without the --plugins-root flag
    Then each plugin record includes origin of builtin, project, user, or path

  Scenario: R7 — KK_PLUGIN_PATH roots are scanned on the default path
    Given KK_PLUGIN_PATH names a kind-collection tree that contains plugin path-ing
    And that plugin is not present on builtin, user, or project roots
    When kk plugin status runs without the --plugins-root flag
    Then path-ing is registered
    And its origin is path

  Scenario: R8 — Extra roots still skip-and-report ADR-009 layout faults
    Given a default extra root contains a plugin.json at its top level (not under a kind collection)
    When default discovery runs
    Then a misplaced diagnostic names that path
    And valid plugins on other roots remain registered

  Scenario: R9 — Project and builtin trees that share a realpath are scanned once
    Given the current working directory plugins tree is the same realpath as the package-shipped tree
    When default discovery runs
    Then each plugin name appears once
    And no duplicate_name diagnostic is emitted for that realpath

  Scenario: R10 — A workflow-injected folder is unioned with default roots
    Given built-in plugins are shipped with kk
    And ~/.kk/plugins contains a valid global plugin
    And an arbitrary folder contains a valid plugin.json
    When kk plugin status --plugins-path <that-folder> runs
    Then the injected plugin is registered with origin path
    And built-in plugins remain registered
    And the ~/.kk/plugins plugin remains registered

  Scenario: R11 — --plugins-root and --plugins-path cannot be combined
    Given both --plugins-root and --plugins-path are passed
    When kk plugin status runs
    Then the command exits 2
    And the error names the mutually exclusive flags

  Scenario: R12 — Workflow extensions and the kk registry stay separate channels
    Given spur workflow YAML may list extensions.actions or extensions.guards
    And a product plugin exists only on a kk discovery root
    When the workflow runs
    Then custom kinds come from the YAML extensions block
    And the product plugin is still resolved by name via kk executor run
    And the product plugin is not loaded as a workflow extension module
```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design
Approach: extend `discoverPlugins` with `resolvePluginRoots` + `discoverAllPlugins` (ADR-012). Built-in root is the packaged tree. `~/.kk/plugins` is the default global store. Repeatable `--plugins-path` unions any **plugin.json** folder with the defaults; `--plugins-root` stays exclusive isolation.

Assume spur workflow YAML already has rule-style `extensions.actions` / `extensions.guards` (ts-libs C1, spur-new D4). That channel registers extra **workflow kinds** from TS modules listed next to the YAML. Product plugins stay `kk executor run <name>` against the kk registry. Two channels; do not collapse them.

Rejected: exclusive `--plugins-root` as the injection flag; treating `~/.kk/plugins` as the only user home; adding `kind: kk.publish` to Spur builtins; dynamic-import of `plugin.json` packages as workflow extension modules.

Invariants: no scan of `plugins/kk` on collection-shaped roots; skip-and-report per ADR-009; realpath-dedupe builtin vs project; `--plugins-root` and `--plugins-path` mutually exclusive.
### Plan
1. Add `PluginOrigin`, `DiscoverAllOptions`, `resolvePluginRoots`, and `discoverAllPlugins` in `packages/kk-core`; keep `discoverPlugins` as the per-root scanner.
2. Classify each extra path: `plugin.json` in the folder itself, kind-collection basename, or plugins tree.
3. Realpath-dedupe builtin vs project; union by name; emit `shadowed` on collision.
4. Unit-test the resolver/union with injected roots (no real `$HOME`).
5. Switch CLI default discovery to `discoverAllPlugins`; add repeatable `--plugins-path`; keep `--plugins-root` exclusive; reject both flags together (exit 2).
6. Surface `origin` on `kk plugin status`.
7. Point the B3 template at `--plugins-path` for extra plugin.json folders. Do not list product plugins under workflow `extensions:`.
8. Update `docs/04_DESIGN.md` in the same commit (T3).
9. Tests for R1–R12 (R12 is a contract/doc + template assertion: B3 still shells `kk executor run`).
10. `bun run lint` and `bun run test` green.
### Solution
Merged multi-root plugin discovery (ADR-012, feature B7). Default runtime discovery switches from a single CWD `./plugins` scan to a low→high union of the package-shipped built-in tree, `~/.kk/plugins`, CWD `./plugins` (realpath-deduped against built-in), `KK_PLUGIN_PATH`, and repeatable `--plugins-path`. `--plugins-root` stays the exclusive single-root override; combining it with `--plugins-path` is a usage error (exit 2).

| File | Change |
|---|---|
| `packages/kk-core/src/registry.ts:9-34` | Add `PluginOrigin`, `PluginRecord.origin`, `shadowed` diagnostic code, `DiscoverAllOptions`. |
| `packages/kk-core/src/registry.ts:67` | `discoverPlugins` gains an `origin` param (default `path`); scans stamp it on every record. |
| `packages/kk-core/src/registry.ts:125-160` | `resolvePluginRoots`: ordered default roots (builtin/user/project/env/extra) with builtin-vs-project realpath dedupe; exclusive `pluginsRoot` override. |
| `packages/kk-core/src/registry.ts:171-214` | `discoverAllPlugins`: realpath-dedupe, per-root ADR-009 scan, merge by name with `shadowed` diagnostics; `--plugins-path` single-`plugin.json` dirs classified as one plugin (kind from manifest). |
| `packages/kk-core/src/registry.ts:216-232` | `mergeByName`: later/higher-priority root wins; losing manifest is the `shadowed` diagnostic `path`, reason names the winner + origin. |
| `packages/kk-core/src/registry.ts:239-260` | `resolveBuiltinRoot`: walk-up from the executing module to the packaged `<pkg>/plugins` tree (monorepo fallback to repo-root `plugins/`). |
| `packages/kk-core/src/index.ts:26-35` | Export `discoverAllPlugins`, `resolvePluginRoots`, `PluginOrigin`, `DiscoverAllOptions`. |
| `apps/cli/src/invoke.ts:14,72-76` | `runInvoke` default discovery → `discoverAllPlugins`; `--plugins-path` union; merged-registry not-found message. |
| `apps/cli/src/fanout.ts:54,258-335` | `FanoutOptions.pluginsPath`; parse repeatable `--plugins-path`. |
| `apps/cli/src/fanout.ts:350,423-431` | Single hoisted discovery per run; `--plugins-root`/`--plugins-path` exclusivity → exit 2; dispatch/validate share one `DiscoveryResult` (fixes N+1 discovery). |
| `apps/cli/src/commands/plugin.ts:39,55,99-103,167` | `plugin status` merged report + `--plugins-path` flag; `origin` flows into `--json` records; exclusivity → exit 2. |
| `apps/cli/src/commands/executor.ts:30,42,96,123,143,155,173` | `executor run` / `fan-out` (and hidden aliases) gain `--plugins-path`; exclusivity → exit 2. |
| `.spur/workflows/kk-ingest-generate-publish.yaml` | B3 template: `plugins_root` → `plugins_path`, `--plugins-root` → `--plugins-path` (R12; workflow names plugins via `kk executor run`, no extensions blocks). |
| `docs/04_DESIGN.md` | Surface updated in the same commit (T3): `--plugins-path`, merged discovery, `origin` on status JSON, kk-core exports. |
| `packages/kk-core/tests/registry.test.ts` | Merged-registry unit tests for R1-R11 with injected roots (no real `$HOME`). |
| `apps/cli/tests/invoke.test.ts` | R3: plugin that exists only on a `--plugins-path` root executes and validates against the kind contract. |
| `apps/cli/tests/commands/plugin.test.ts` | R6 (origin in status JSON), R10 (single-dir union), R11 (exit 2) CLI tests. |
| `apps/cli/tests/commands/executor.test.ts` | R11 CLI test (exit 2 on combined flags). |
| `apps/cli/tests/workflow-template.test.ts` | R12 template contract: B3 shells `kk executor run` via `--plugins-path`, never extensions blocks. |
### Testing
**Pipeline verify results** (re-audit 2026-08-13, `--force`)

- Verdict: PASS
- Tests this run: `NODE_ENV=test bun test packages/kk-core/tests/registry.test.ts apps/cli/tests/invoke.test.ts apps/cli/tests/commands/plugin.test.ts apps/cli/tests/commands/executor.test.ts apps/cli/tests/fanout.test.ts apps/cli/tests/workflow-template.test.ts` — **100 pass, 0 fail** (376 expect; bun test v1.3.14)
- Golden path: `kk plugin status --json` from repo root → 5 plugins, all `origin: builtin`, `healthy: true`
- Fix pass: flipped 12 Requirements checkboxes to `[x]` (L3.unchecked-checklist on a `done` task). Artifact: `.spur/run/0053-verdict.json` (rewritten this run)

**Full-repo gate** (plan item 10, 2026-08-13)

- `bun run lint` — Biome 2.5.5 check + typecheck, 84 files, no fixes applied; all workspace typechecks exit 0
- `bun run test` — **266 pass, 0 fail** (863 expect; bun test v1.3.14); aggregate coverage 99.27% functions / 99.24% lines

**Per-Requirement Traceability**

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `packages/kk-core/src/registry.ts:171` `discoverAllPlugins`; `packages/kk-core/src/registry.ts:89-90` skips `kk`; `packages/kk-core/src/registry.ts:239` `resolveBuiltinRoot`; tests `packages/kk-core/tests/registry.test.ts:210` and `:490` |
| R2 | MET | `packages/kk-core/src/registry.ts:137-140` `~/.kk/plugins` user root; test `packages/kk-core/tests/registry.test.ts:232` (my-pub origin user, kind publish, next to builtin-pub) |
| R3 | MET | `apps/cli/src/invoke.ts:72` `discoverAllPlugins` + kind contract; test `apps/cli/tests/invoke.test.ts:79` (extra-gen only on `--plugins-path`, exit 0, output validated) |
| R4 | MET | `packages/kk-core/src/registry.ts:126-127` exclusive `pluginsRoot`; test `packages/kk-core/tests/registry.test.ts:253` (only isolated-pub) |
| R5 | MET | `packages/kk-core/src/registry.ts:216-228` `mergeByName` `shadowed`; test `packages/kk-core/tests/registry.test.ts:273` |
| R6 | MET | `packages/kk-core/src/registry.ts:9` `PluginOrigin`; `apps/cli/src/commands/plugin.ts:55` status via `discoverAllPlugins`; tests `packages/kk-core/tests/registry.test.ts:296` and `apps/cli/tests/commands/plugin.test.ts:255` |
| R7 | MET | `packages/kk-core/src/registry.ts:147-152` `KK_PLUGIN_PATH`; test `packages/kk-core/tests/registry.test.ts:320` |
| R8 | MET | `packages/kk-core/src/registry.ts:97-106` `misplaced` skip-and-report; test `packages/kk-core/tests/registry.test.ts:338` |
| R9 | MET | `packages/kk-core/src/registry.ts:178-186` realpath dedupe; `packages/kk-core/src/registry.ts:271` `sameRealpath`; test `packages/kk-core/tests/registry.test.ts:364` |
| R10 | MET | `packages/kk-core/src/registry.ts:153-157` extraPaths; `:194-202` single `plugin.json` dir; tests `packages/kk-core/tests/registry.test.ts:379`, `apps/cli/tests/commands/plugin.test.ts:293`, `apps/cli/tests/fanout.test.ts:764` |
| R11 | MET | `apps/cli/src/commands/plugin.ts:98-104`, `apps/cli/src/commands/executor.ts:38-44`, `apps/cli/src/fanout.ts:422-423` exit 2; tests `apps/cli/tests/commands/plugin.test.ts:319`, `apps/cli/tests/commands/executor.test.ts:114`, `apps/cli/tests/fanout.test.ts:806` |
| R12 | MET | `.spur/workflows/kk-ingest-generate-publish.yaml:25` shells `kk executor run` + `--plugins-path`; tests `apps/cli/tests/workflow-template.test.ts:15` and `:28` (no `extensions.actions`/`extensions.guards`) |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| Scenario: R1 — Built-in plugins are discovered by default from the package | MET | test | `packages/kk-core/tests/registry.test.ts:210`; `packages/kk-core/tests/registry.test.ts:490` |
| Scenario: R2 — A user kind-collection plugin merges with built-ins | MET | test | `packages/kk-core/tests/registry.test.ts:232` |
| Scenario: R3 — kk executor run resolves a merged-registry plugin by name | MET | test | `apps/cli/tests/invoke.test.ts:79` |
| Scenario: R4 — --plugins-root remains an exclusive single-root scan | MET | test | `packages/kk-core/tests/registry.test.ts:253` |
| Scenario: R5 — A higher-priority root shadows a duplicate name | MET | test | `packages/kk-core/tests/registry.test.ts:273` |
| Scenario: R6 — kk plugin status reports each plugin's origin | MET | test | `packages/kk-core/tests/registry.test.ts:296`; `apps/cli/tests/commands/plugin.test.ts:255` |
| Scenario: R7 — KK_PLUGIN_PATH roots are scanned on the default path | MET | test | `packages/kk-core/tests/registry.test.ts:320` |
| Scenario: R8 — Extra roots still skip-and-report ADR-009 layout faults | MET | test | `packages/kk-core/tests/registry.test.ts:338` |
| Scenario: R9 — Project and builtin trees that share a realpath are scanned once | MET | test | `packages/kk-core/tests/registry.test.ts:364` |
| Scenario: R10 — A workflow-injected folder is unioned with default roots | MET | test | `packages/kk-core/tests/registry.test.ts:379`; `apps/cli/tests/commands/plugin.test.ts:293`; `apps/cli/tests/fanout.test.ts:764` |
| Scenario: R11 — --plugins-root and --plugins-path cannot be combined | MET | test | `apps/cli/tests/commands/plugin.test.ts:319`; `apps/cli/tests/commands/executor.test.ts:114`; `apps/cli/tests/fanout.test.ts:806` |
| Scenario: R12 — Workflow extensions and the kk registry stay separate channels | MET | test | `apps/cli/tests/workflow-template.test.ts:15`; `apps/cli/tests/workflow-template.test.ts:28` |

**SECUA Review**

| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P4 | Architecture | `packages/kk-core/src/registry.ts:125-213` | Extends `discoverPlugins` rather than a second registry; deletion test holds |
| P4 | Security | extraPaths / `KK_PLUGIN_PATH` | Operator-trusted local dirs by design (ADR-012); no secret I/O; exclusivity fails loud (exit 2) |
| P4 | Correctness | `packages/kk-core/src/registry.ts:314-326` | Unreadable single-plugin-dir manifest skip-and-report (not silent) |

Coverage: repo aggregate from `bun run test` — 99.27% functions / 99.24% lines (above bunfig.toml 90/90). Targeted subset remains 100/100.

Fix-pass artifact: `.spur/run/0053-verdict.json` rewritten this run after checkbox flip.
### Review
**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |
### References

B7

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-08-13T22:46:56.283Z todo → wip (system)
- 2026-08-13T23:03:32.690Z wip → testing (system)
- 2026-08-13T23:03:40.332Z testing → done (system)
