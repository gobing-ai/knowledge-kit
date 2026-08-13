---
template: feature-impl
schema_version: 1
name: "Discover built-in and user plugins via a merged registry"
description: ""
status: todo
type: task
profile: standard
feature_id: B7
parent_wbs: null
priority: P1
tags: ["plugin-platform", "discovery"]
dependencies: []
ac_numbering: task-local
created_at: "2026-08-13T05:06:47.549Z"
updated_at: "2026-08-13T06:20:41.086Z"
---

## 0053. Discover built-in and user plugins via a merged registry

### Background
The kk plugin platform already scans one `--plugins-root` (default `./plugins`) for ADR-009 kind collections. That replace-not-union contract hides package-shipped built-ins when `kk` runs from a user CWD, and it cannot keep built-ins while adding a caller-named folder.

Covers feature B7 scenarios R1–R12. Satellite: `docs/design/multi-root-plugin-discovery.md`. Authority: ADR-012.

`~/.kk/plugins` is the default global store. Extra **plugin.json** folders union via `--plugins-path` / `KK_PLUGIN_PATH`. Custom **workflow kinds** are assumed to come from spur workflow YAML `extensions.actions` / `extensions.guards` (ts-libs C1, spur-new D4) — a separate channel.

Rubric: E1 D1 L1 C0 R1 = 4 → keep as one task.
### Requirements
- [ ] R1. Default discovery (no `--plugins-root`) registers every valid plugin under the package-shipped kind collections and skips `plugins/kk`.
- [ ] R2. A valid user plugin under `~/.kk/plugins/<collection>/<name>/` appears in `kk plugin status` next to built-in plugins of the same kind.
- [ ] R3. `kk executor run <name>` executes a plugin that exists only on a default extra root and validates IO against the kind contract.
- [ ] R4. `--plugins-root <dir>` scans that tree only; package-shipped plugins are not registered.
- [ ] R5. When two default roots declare the same `name`, the higher-priority plugin is registered and a `shadowed` diagnostic names both paths.
- [ ] R6. `kk plugin status --json` includes `origin` (`builtin` | `project` | `user` | `path`) on each plugin record.
- [ ] R7. A plugin that exists only on a `KK_PLUGIN_PATH` root is registered with `origin: path`.
- [ ] R8. A top-level `plugin.json` on an extra default root that is a plugins tree emits `misplaced` and does not abort discovery of valid plugins on other roots.
- [ ] R9. When CWD `./plugins` is the same realpath as the package-shipped tree, each plugin name appears once with no `duplicate_name` diagnostic.
- [ ] R10. Repeatable `--plugins-path <dir>` unions with built-ins and `~/.kk/plugins`. The dir may be a plugins tree, a kind collection, or a single folder that contains `plugin.json`.
- [ ] R11. Passing `--plugins-root` and `--plugins-path` together is a usage error (exit 2).
- [ ] R12. Product plugins stay name-resolved via `kk executor run`. Workflow YAML `extensions.actions` / `extensions.guards` (assumed spur D4) register extra kinds only; they do not replace kk registry discovery. This task does not implement the workflow schema.
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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

B7

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
