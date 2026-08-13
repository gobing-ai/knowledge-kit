---
schema_version: 1
id: "B7"
name: "Multi-root plugin auto-discovery"
status: backlog
priority: P1
tags: []
created_at: "2026-08-13T05:02:52.265Z"
updated_at: "2026-08-13T06:20:40.462Z"
---

# B7: Multi-root plugin auto-discovery

## Goal
The kk plugin mechanism discovers package-shipped built-ins by default, keeps ~/.kk/plugins as the default global store, unions extra plugin.json folders, and uses spur workflow YAML extensions.actions / extensions.guards for any custom step kinds — without replacing either channel.
## Scope
- In:
  - Multi-root discovery in `@gobing-ai/kk-core` (extend `discoverPlugins`; do not add a second registry)
  - Built-in root: kind collections shipped with `@gobing-ai/knowledge-kit` (`bundle-plugins` staged tree), resolved from the package and scanned by default
  - Default global store: `~/.kk/plugins` (if present) — convenience, not the only user location
  - Default project root: CWD `./plugins` when present and not the builtin realpath
  - Dynamic extra **plugin.json** paths: repeatable `--plugins-path <dir>` and `KK_PLUGIN_PATH` **union** with the defaults. A path may be a plugins tree, a kind collection, or a single directory that contains `plugin.json`
  - Assumed spur capability (D4 / ts-libs C1): a workflow YAML may list `extensions.actions` / `extensions.guards` (relative TS modules). Those register extra **workflow kinds** for that file. kk does not add kinds to Spur builtins
  - Workflow template still shells `kk executor *` for product plugins; it may also list extension modules when a custom kind is needed
  - `--plugins-root` remains an exclusive single-root override (tests and isolation only); mutually exclusive with `--plugins-path`
  - Same ADR-009 skip-and-report diagnostics on collection-shaped roots
  - Name shadowing: higher-priority root wins; a diagnostic names the shadowed path
  - `PluginRecord.origin` (`builtin` | `project` | `user` | `path`) surfaced by `kk plugin status`
- Out:
  - Treating `~/.kk/plugins` as the only user-plugin location
  - Using exclusive `--plugins-root` as the workflow injection flag
  - Turning product plugins (`plugin.json` + `entry`) into workflow extension TS modules
  - Adding `kind: kk.publish` (or similar) to Spur's `registerSpurBuiltins`
  - Restoring `@gobing-ai/spur-plugin-sdk` / PluginLoader
  - `kk plugin install` / remote registry / hot-reload
  - Distributing product plugins via `superskill install`
  - New plugin kinds; static compile-time import tables of built-ins
  - Changing kind contracts, `plugin.json` required fields, or the B3 invoke file-IO contract
  - Implementing the workflow `extensions:` schema (owned by ts-libs C1 + spur-new D4)
## Acceptance Criteria
```gherkin
Feature: Multi-root plugin auto-discovery

  @core
  Scenario: R1 — Built-in plugins are discovered by default from the package
    Given kk is invoked with no --plugins-root flag
    And the current working directory has no project plugins tree
    When discovery runs
    Then every valid plugin under the package-shipped kind collections is registered
    And plugins/kk is not registered as a kk-core plugin

  @core
  Scenario: R2 — A user kind-collection plugin merges with built-ins
    Given a valid plugin.json plugin under ~/.kk/plugins/publishings/my-pub/
    And built-in publish plugins are shipped with kk
    When kk plugin status runs with no --plugins-root
    Then both my-pub and the built-in publish plugins appear
    And my-pub is listed under kind publish

  @core
  Scenario: R3 — kk executor run resolves a merged-registry plugin by name
    Given a user plugin named extra-gen is present only on a default extra root
    When kk executor run extra-gen --in <file> --out <file> runs with no --plugins-root
    Then the extra-gen entry is executed
    And input and output are validated against the plugin's kind contract

  @core
  Scenario: R4 — --plugins-root remains an exclusive single-root scan
    Given built-in plugins exist on the package root
    And a separate directory tree contains only plugin isolated-pub
    When kk plugin status --plugins-root <that-tree> runs
    Then isolated-pub is registered
    And built-in plugins from the package root are not registered

  @core
  Scenario: R5 — A higher-priority root shadows a duplicate name
    Given two valid plugins on different default roots declare the same name
    When default discovery runs
    Then only the higher-priority root's plugin is registered
    And a diagnostic names the shadowed path and the winning path

  @core
  Scenario: R6 — kk plugin status reports each plugin's origin
    Given the merged registry contains a builtin plugin and a user plugin
    When kk plugin status --json runs with no --plugins-root
    Then each plugin record includes origin of builtin, project, user, or path

  @core
  Scenario: R7 — KK_PLUGIN_PATH roots are scanned on the default path
    Given KK_PLUGIN_PATH names a kind-collection tree that contains plugin path-ing
    And that plugin is not present on builtin, user, or project roots
    When kk plugin status runs with no --plugins-root
    Then path-ing is registered
    And its origin is path

  @edge
  Scenario: R8 — Extra roots still skip-and-report ADR-009 layout faults
    Given a default extra root contains a plugin.json at its top level (not under a kind collection)
    When default discovery runs
    Then a misplaced diagnostic names that path
    And valid plugins on other roots remain registered

  @edge
  Scenario: R9 — Project and builtin trees that share a realpath are scanned once
    Given the current working directory plugins tree is the same realpath as the package-shipped tree
    When default discovery runs
    Then each plugin name appears once
    And no duplicate_name diagnostic is emitted for that realpath

  @core
  Scenario: R10 — A workflow-injected folder is unioned with default roots
    Given built-in plugins are shipped with kk
    And ~/.kk/plugins contains a valid global plugin
    And an arbitrary folder contains a valid plugin.json (not under ~/.kk/plugins)
    When kk executor run or kk plugin status runs with --plugins-path <that-folder>
    Then the injected plugin is registered with origin path
    And the built-in plugins remain registered
    And the ~/.kk/plugins plugin remains registered

  @edge
  Scenario: R11 — --plugins-root and --plugins-path cannot be combined
    Given both --plugins-root and --plugins-path are passed
    When kk plugin status runs
    Then the command exits 2
    And the error names the mutually exclusive flags

  @core
  Scenario: R12 — Workflow extensions and the kk registry stay separate channels
    Given spur workflow YAML may list extensions.actions or extensions.guards (relative modules)
    And a product plugin exists only on a kk discovery root
    When the workflow runs
    Then custom kinds come from the YAML extensions block
    And the product plugin is still resolved by name via kk executor run
    And the product plugin is not loaded as a workflow extension module
```
## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0053 | Discover built-in and user plugins via a merged registry | todo |
<!-- END AUTO-GENERATED -->

## Notes
- Historical **B7** was LLM-as-judge and migrated to **F1**. This slot is multi-root discovery.
- Brainstorm: `docs/plans/2026-08-12-multi-root-plugin-discovery-brainstorm.md`
- Design satellite: `docs/design/multi-root-plugin-discovery.md`
- Authority: ADR-012 (Accepted (design)), amended 2026-08-13

Assumed spur capability (not implemented in this repo):
- ts-libs **C1** / task **0062** — schema `extensions.actions` / `extensions.guards` on WorkflowDef
- spur-new **D4** / task **0533** — `spur workflow validate|run` loads those modules

Two channels:
- Product plugins (`plugin.json`) → kk registry (built-ins, `~/.kk/plugins`, `--plugins-path`)
- Custom workflow kinds → YAML `extensions:` (relative TS modules, rule-style)

Do not collapse product plugins into workflow extension modules. Do not add `kind: kk.publish` to Spur builtins.
## History
