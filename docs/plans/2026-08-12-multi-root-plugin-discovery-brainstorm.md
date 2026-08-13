# Brainstorm: Multi-root plugin auto-discovery

**Date:** 2026-08-12

## Overview

The operator wants `spur workflow` YAML to remain the SSOT of an ingest → create → publish
pipeline, and wants end users to extend kk with their own ingestion / generator / publish
plugins — while the plugins already stored under `plugins/ingestions|generations|publishings`
stay built-in: shipped with `kk` at pack time, discovered automatically at runtime.

Discovery today (`discoverPlugins` in `@gobing-ai/kk-core`, ADR-009) scans **one**
`--plugins-root` (default `./plugins`). That is a *replace*, not a merge. Two gaps follow:

1. **Shipped built-ins are not the runtime default.** `scripts/bundle-plugins.ts` copies the
   kind collections into the npm tarball (`apps/cli/plugins/`), but `kk executor run` /
   `kk plugin status` still look at CWD `./plugins`. An installed `kk` used from a user
   project does not see the bundled plugins unless that project has its own tree.
2. **User plugins cannot sit beside built-ins.** Pointing `--plugins-root` at a custom tree
   hides the shipped set. The PRD already names "plugin developers" as a user; they currently
   must fork, copy, or replace the whole tree.

The original idea asked to "leverage spur workflow's plugin mechanism." Source review of
`/Users/robin/xprojects/spur-new` shows that mechanism is **not a live product-plugin
discovery API**. Spur's `@gobing-ai/spur-plugin-sdk`, `PluginLoader` four-tier roots, and
`spur plugin list|info` were **removed** by the 2026-06-09 ADR-012 amendment ("until a real
consumer exists"). What remains is ts-infra lifecycle `Plugin`/`PluginHost` plus workflow
engine **action/guard extension** (`host.registerAction` / `loadWorkflowExtensionsIntoHost`) —
the wrong seam for kk product plugins. kk owns steps (`kk executor run`); spur owns
orchestration. Registering `kind: ingest` as a custom workflow action would invert that
(ADR-006 / ADR-007).

The real requirement is therefore: **extend kk's existing plugin mechanism layer** so it
discovers a merged registry (built-in + project + user), while workflow YAML keeps naming
plugins by `kk executor run <name>`.

## Approaches

### Approach 1: Multi-root merge in `@gobing-ai/kk-core` ⭐ Recommended

**Description:** Keep `plugin.json` + kind-collection layout (ADR-009) as the only product
plugin contract. Add root *resolution* and *merge* next to `discoverPlugins`: a built-in
root (package-shipped kind collections), the project `./plugins` tree, optional
`~/.kk/plugins`, and `KK_PLUGIN_PATH`. Default CLI discovery uses the merge. `--plugins-root`
stays an exclusive override so existing tests and isolated runs do not change.

**Trade-offs:**
- **Pros:**
  - Extends the existing deep module (`discoverPlugins`) instead of adding a parallel registry
  - Built-ins stay on-disk directories discovered at runtime — no static import table
  - Workflow YAML / B3 invoke contract unchanged
  - Borrow spur's *pattern* (priority-ordered roots, name-shadowing) without depending on
    deleted spur-plugin-sdk
  - `--plugins-root` exclusive override preserves B1/B4/A21 tests
- **Cons:**
  - Must resolve the built-in root correctly in monorepo-dev vs published-package
  - Same-name plugins across roots need an explicit shadowing + diagnostic rule
  - New env / origin field is a surface change (04 T3 + ADR amendment)

**Implementation Notes:**
- `discoverPlugins(root)` remains the single-root scanner (ADR-009 rules unchanged per root)
- New `resolvePluginRoots(opts)` + `discoverAllPlugins(opts)` merge scans; `PluginRecord`
  gains `origin` (`builtin` | `project` | `user` | `path`)
- Built-in path: packaged `apps/cli/plugins` next to `dist/`; monorepo falls back to repo
  `plugins/` when the staged copy is absent; realpath-dedupe if that equals CWD `./plugins`
- Shadowing: later / higher-priority root wins; emit `duplicate_name` (or a new
  `shadowed` diagnostic) naming both paths
- `kk plugin status` shows origin; `kk executor run` / `fan-out` use the merged registry
  unless `--plugins-root` is set

**Confidence:** HIGH
**Sources:**
- `packages/kk-core/src/registry.ts` (single-root scan) | **Verified:** 2026-08-12
- `docs/00_ADR.md` ADR-006 / ADR-009 / ADR-011 | **Verified:** 2026-08-12
- `scripts/bundle-plugins.ts` + `apps/cli/package.json` `files`/`prepack` | **Verified:** 2026-08-12
- `docs/04_DESIGN.md` §1 `--plugins-root` defaults to `./plugins` | **Verified:** 2026-08-12
- spur-new `docs/00_ADR.md` ADR-012 amendment 2026-06-09 (SDK/loader removed);
  `docs/04_DESIGN.md` §6 deferred plugin surface | **Verified:** 2026-08-12
- spur-new task `0013` (historical PluginLoader root order, pattern only) | **Verified:** 2026-08-12

### Approach 2: Restore / consume spur PluginLoader

**Description:** Treat kk product plugins as spur plugins under
`SPUR_PLUGIN_PATH` / `.spur/plugins` / `~/.spur/plugins` / bundled, by restoring
`@gobing-ai/spur-plugin-sdk` + `PluginLoader` in spur-new and calling that from kk.

**Trade-offs:**
- **Pros:**
  - One discovery story across harness and product
  - Matches the operator's first reading of "use spur's plugin mechanism"
- **Cons:**
  - Wrong contract: spur plugins were `plugin.yaml` + `SpurPlugin` + dynamic `import`, not
    kk-core `plugin.json` + `entry` spawn
  - The loader is deleted in spur; restoring it is a spur-new feature, not a kk one
  - Couples kk's registry to a deferred/removed API
  - Workflow YAML still would not discover plugins — PluginLoader was for spur itself

**Implementation Notes:**
- Would require a new consumer-driven restore in spur-new (ADR-012 amendment says
  "until a real consumer exists") plus an adapter from SpurPlugin → kk-core PluginRecord
- Cross-repo, cross-contract, high blast radius

**Confidence:** HIGH (that this is the wrong seam)
**Sources:**
- spur-new `docs/03_ARCHITECTURE.md` §11 Plugin Substrate | **Verified:** 2026-08-12
- spur-new `docs/04_DESIGN.md` "standalone `@gobing-ai/spur-plugin-sdk` is deleted" | **Verified:** 2026-08-12

### Approach 3: Custom workflow action kinds per plugin

**Description:** Register `kk.ingest` / `kk.generate` / `kk.publish` (or per-plugin kinds)
as workflow engine extensions so YAML steps invoke plugins without `kk executor run`.

**Trade-offs:**
- **Pros:**
  - YAML looks more "native" (`kind: kk.publish` vs `kind: shell` + `kk executor run`)
- **Cons:**
  - Inverts "kk owns steps; spur owns orchestration" (ADR-006 / ADR-007)
  - Custom actions are library-only on `spur workflow` CLI (built-ins only); would need a
    kk-owned workflow host
  - Does not solve multi-root *discovery*; still needs a registry
  - Built-ins would now depend on the workflow engine extension loader they were supposed
    to avoid

**Implementation Notes:** Rejected as the discovery vehicle. A later, separate feature could
still add optional syntactic sugar once discovery exists.

**Confidence:** HIGH (reject for this feature)
**Sources:**
- `docs/00_ADR.md` ADR-006 / ADR-007 R4 | **Verified:** 2026-08-12
- `sp-spur-cli` `references/workflows/validation-and-extension.md` (CLI vs library) | **Verified:** 2026-08-12

## Recommendations

**Choose Approach 1.** The operator's *intent* (workflow YAML as pipeline SSOT; built-ins
shipped and auto-discovered; users can add kind-collection plugins) is correct. The
*mechanism* they named (spur workflow's plugin system) is the wrong layer: that system is
deferred/deleted, and workflow extensions are for new action kinds, not product plugin
inventories.

Do the work in `@gobing-ai/kk-core` + the `kk` CLI (the existing plugin mechanism layer).
Borrow spur's root-priority *idea*. Keep `spur workflow` as the composition SSOT that
*names* plugins. Do not restore spur-plugin-sdk and do not register kk kinds as engine
actions.

Key factors: conformance with ADR-009, deletion test on a new package (fails — extend
`discoverPlugins`), and the already-shipped `bundle-plugins` path that currently has no
runtime consumer.

Consider Approach 2 only if spur independently restores PluginLoader *and* publishes a
discovery API that can scan kk-core manifests — not a prerequisite.

## Design Summary

**Problem.** Single-root `--plugins-root` (default CWD `./plugins`) cannot both expose
package-shipped built-ins and accept user kind-collection plugins. Workflow YAML already
composes plugins by name; names that are not in that one root are invisible.

**Decision.** Multi-root discovery lives in `@gobing-ai/kk-core`. Each root is an ADR-009
kind-collection tree. Default merge order (low → high, later wins on name):

1. **builtin** — kind collections shipped with `@gobing-ai/knowledge-kit` (staged by
   `bundle-plugins`; resolved from the package, not CWD)
2. **user** — `~/.kk/plugins/` if present
3. **project** — `./plugins` relative to CWD if present and not the same realpath as builtin
4. **KK_PLUGIN_PATH** — colon-separated extra roots (highest among defaults)

`--plugins-root <dir>` remains an **exclusive** single-root override (current test and
isolation contract). Default (no flag) uses the merge.

**Invariants.**
- Built-in plugins are on-disk directories with `plugin.json`; they are not statically
  imported into the CLI bundle and they do not go through spur PluginHost or workflow
  extensions.
- User plugins use the same `plugin.json` + kind-collection contract; they are not
  `plugins/kk` agent capabilities and they are not `.spur/plugins` spur-sdk plugins.
- `spur workflow` YAML stays the pipeline SSOT: steps still call `kk executor run|fan-in|fan-out`.
- Malformed / misplaced / kind-mismatch diagnostics stay skip-and-report (B1).
- Duplicate names across roots: higher-priority root is registered; a diagnostic names
  the shadowed path.

**Surface (accepted design — implement in the same commit as code, T3).**
- `KK_PLUGIN_PATH` env
- `PluginRecord.origin`
- `discoverAllPlugins` / `resolvePluginRoots` exports
- `kk plugin status` origin column / JSON field
- `kk executor run` / `fan-out` default to the merge

**Out of scope.** Remote registry; `kk plugin install`; superskill distribution of product
kinds; hot-reload; new plugin kinds; workflow custom action kinds; compile-time static
plugin import tables; depending on deleted spur-plugin-sdk.

**Parent in the feature tree.** Child of **B** (plugin platform). B is `done`; this is a
new deliverable slice (expected **B7**). Not a new root letter.

## Spec self-review

- No TODO / TBD / ??? placeholders.
- No internal contradiction: spur pattern is borrowed; spur APIs are not called.
- Scope does not include install/distribution (superskill / npm of third-party plugins).
- Decomposition can proceed from AC without guessing the discovery owner (kk-core).

## Next Steps

1. Idea-eval → feature-create under B (B7).
2. ADR-012 (or ADR-009 amendment) for multi-root discovery.
3. Satellite `docs/design/multi-root-plugin-discovery.md` + `04` §0 index.
4. Tasks: root resolver + merge in kk-core; CLI default + origin on status; docs T3.

---

**Generated by:** sp-brainstorm
**Research delegation:** inline source read of knowledge-kit + spur-new (no `spur agent run`)

needs_design: true
