---
template: feature-impl
schema_version: 1
name: "Plugin manifest schema + registry discovery by kind"
description: ""
status: done
type: task
profile: standard
feature_id: B
parent_wbs: null
priority: P2
tags: ["kk", "platform", "registry"]
dependencies: ["0003"]
created_at: "2026-07-24T17:36:27.412Z"
updated_at: "2026-07-25T16:58:43.769Z"
---

## 0004. Plugin manifest schema + registry discovery by kind

### Background
Discovery layer for feature B. Depends on B2 / task `0003` (kind enum + contracts); build SECOND (after B2, before B3). A plugin is a directory with `plugin.json {name, kind, entry}` (ADR-006 amendment, skill-first model). Covers B1 scenarios R1-R4. Rubric: E2 D1 L1 C1 R1 = 6 -> task.
### Requirements
- [x] R1. Define the `plugin.json` manifest schema: `name`, `kind` ∈ {ingestion, generator, publish}, and `entry` naming the skill or command that runs the plugin.
- [x] R2. Registry discovers `plugins/*/plugin.json`, registers each valid plugin under its declared kind, and supports list-by-kind.
- [x] R3. A malformed manifest is skipped and reported (path + reason) without aborting the scan; remaining valid plugins still register.
- [x] R4. Two plugin directories declaring the same name surface a duplicate-name diagnostic.
### Acceptance Criteria
```gherkin
Feature: Plugin manifest and registry discovery

  @core
  Scenario: R1 — A manifest declares a valid kind and entry
    Given a plugin directory containing a plugin.json
    When the manifest is validated against the manifest schema
    Then a kind of ingestion, generator, or publish is required
    And an entry naming the skill or command that runs the plugin is required

  @core
  Scenario: R2 — The registry discovers installed plugins grouped by kind
    Given several plugin directories each with a valid plugin.json
    When the registry runs discovery
    Then every valid plugin is registered under its declared kind
    And plugins can be listed by kind

  @core
  Scenario: R3 — A malformed manifest is skipped without aborting the scan
    Given one plugin directory whose plugin.json is missing a required field
    When the registry runs discovery
    Then the malformed plugin is reported as skipped with its path and reason
    And the remaining valid plugins are still registered

  @edge
  Scenario: R4 — Duplicate plugin names surface a diagnostic
    Given two plugin directories declaring the same plugin name
    When the registry runs discovery
    Then a duplicate-name diagnostic is reported
```
### Q&A
**Mode:** `--auto` (no interactive Q&A). Synthesized from task Background/Requirements, feature B1 AC, ADR-006 amendment, and refined task `0003` (B2) design.

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Dependency | Frontmatter `dependencies: [0003]` | Background requires B2 kind enum/contracts first; clears real dep edge |
| Placement | Extend `@gobing-ai/kk-core` with manifest + registry modules | Shared with `0005`; avoid new package (YAGNI) |
| Manifest required fields | `name`, `kind`, `entry` only | ADR-006 amendment; optional version/description for shell compat |
| Scan depth | One level `plugins/*` | Matches ADR “filesystem scan of plugins/*/plugin.json” |
| Malformed handling | Skip + diagnostic; continue | Feature B1 R3 |
| Duplicate names | First wins + `duplicate_name` diagnostic | Deterministic resolve for invoke; R4 satisfied |
| Missing plugin.json | Silent skip | Avoid noise from non-plugin directories |
| Existing `plugins/kk` | Expect skip (no kind/entry) until real kind plugins | Collection shell ≠ lifecycle plugin |
| AC source | Feature B1 scenarios R1–R4, stable titles | Traceability; do not rename after link |
### Design
**Approach.** Implement the B1 discovery layer on top of B2 (`0003` / `@gobing-ai/kk-core`): a Zod `PluginManifestSchema` plus a filesystem registry that scans `plugins/*/plugin.json`, groups by `PluginKind`, and returns structured diagnostics. Consumer is B3 (`0005` / `kk invoke`). No remote registry, no invoke, no lifecycle method classes (ADR-006 amendment 2026-07-24).

**Where it lives**

| Piece | Location | Why |
|-------|----------|-----|
| `PluginManifestSchema` + inferred `PluginManifest` | `@gobing-ai/kk-core` | Pure data contract; reuses `PluginKind` from `0003` |
| `discoverPlugins` / `listByKind` | `@gobing-ai/kk-core` (registry module) | Shared by CLI invoke and tests; one platform SDK |
| CLI surface | **out of scope** (B3) | Discovery only; no `kk` subcommand here |

Note vs task `0003` Design: that task forbade FS on the **contract** surface. B1 intentionally adds a **registry** module that uses Bun FS; contracts remain pure and importable without scanning.

**Manifest schema (`plugin.json`)**

```ts
// required (ADR-006 amendment)
{
  name: z.string().min(1),           // unique plugin id for invoke resolution
  kind: PluginKindSchema,            // 'ingestion' | 'generator' | 'publish'
  entry: z.string().min(1),          // skill/command name or relative path the invoker runs
}
// optional (forward-compat with existing Claude-style plugin.json shells)
// version?, description? — allowed as optional strings; unknown keys: strip or passthrough via .strict() false
```

Existing `plugins/kk/plugin.json` today is a collection shell (`name`/`version`/`description` only — no `kind`/`entry`). It is **not** a lifecycle plugin instance. Discovery will skip it as malformed (missing kind/entry) and report a diagnostic — expected until real kind plugins (C/D/E) land. Do not special-case `plugins/kk` in code.

**Discovery algorithm**

1. Resolve `pluginsRoot` (caller-supplied absolute/relative path; default convention `./plugins` relative to process cwd / repo root — caller owns the default).
2. List immediate child directories of `pluginsRoot` (one level: `plugins/*` only; no deep recursion).
3. For each child dir, read `plugin.json` if present; missing file → skip silently (not a plugin dir) or diagnostic `missing_manifest` — prefer **silent skip** for non-plugin dirs so agent/skill trees under a collection are not noise.
4. Parse JSON → `PluginManifestSchema.safeParse`. Fail → diagnostic `{ code: 'malformed', path, reason }` (include Zod path/field); continue.
5. On valid parse: if `name` already registered → diagnostic `{ code: 'duplicate_name', path, reason }`; **first wins**, second not registered (deterministic; invoke gets a single match).
6. Return `{ plugins: PluginRecord[], diagnostics: DiscoveryDiagnostic[] }`.

**Record + API shapes**

```ts
type PluginRecord = {
  name: string;
  kind: PluginKind;
  entry: string;
  dir: string;           // absolute plugin directory
  manifestPath: string;  // absolute path to plugin.json
};

type DiscoveryDiagnostic = {
  code: 'malformed' | 'duplicate_name' | 'unreadable';
  path: string;
  reason: string;
};

type DiscoveryResult = {
  plugins: readonly PluginRecord[];
  diagnostics: readonly DiscoveryDiagnostic[];
};

function parsePluginManifest(data: unknown): PluginManifest; // throws or returns SafeParse result
function discoverPlugins(pluginsRoot: string): DiscoveryResult; // sync via Bun readdir/read if practical
function listByKind(result: DiscoveryResult, kind: PluginKind): PluginRecord[];
function getByName(result: DiscoveryResult, name: string): PluginRecord | undefined;
```

**Invariants**

1. Scan never aborts on a single bad plugin — always returns partial success + diagnostics (R3).
2. `kind` is only the B2 enum; invalid kind is a malformed manifest, not a silent coerce.
3. Name uniqueness is global across kinds (R4): same name under two kinds still duplicates.
4. No network, no package-registry protocol, no install — filesystem only.
5. Public package import remains `@gobing-ai/kk-core` (or a subpath if we split exports later; v1 barrel is fine).

**Tradeoffs**

- **First-wins on duplicate names** vs fail-closed: first-wins keeps discovery usable in messy trees; diagnostics make the clash visible for B3. Rejected: abort whole scan on duplicate (contradicts R3 spirit).
- **Silent skip for dirs without plugin.json** vs diagnostic-per-dir: silent avoids flooding on monorepo noise; only invalid *present* manifests diagnose.
- **Registry in kk-core vs apps/cli:** package keeps `0005` and unit tests free of CLI coupling. Rejected: new `packages/kk-registry` (YAGNI for ~one module).
- **Optional version/description:** tolerate so Claude-style shells can grow into kk plugins without a second schema; required triad stays `name`/`kind`/`entry`.

**Impacted surfaces**

- Extend: `packages/kk-core` (after `0003` lands) — `manifest` + `registry` modules, tests with temp dirs
- Depends on: task `0003` (`PluginKind`, package scaffold)
- Consumers: task `0005` (`kk invoke` resolution), later C/D/E plugins
- Repo fixture: `plugins/kk/plugin.json` remains a non-lifecycle shell until a real kind plugin is added

**Out of scope**

- `kk invoke` / spur workflow template (B3 / `0005`)
- Doc/Content/Result schema work (B2 / `0003` owns it; this task only *uses* `PluginKind`)
- Remote discovery, superskill install hooks, multi-root search paths beyond the single `pluginsRoot` argument
### Plan
- [x] Confirm `@gobing-ai/kk-core` from task `0003` exists (or land `0003` first); depend on its `PluginKind` / `PluginKindSchema`
- [x] Add `PluginManifestSchema` + `PluginManifest` type + `parsePluginManifest` helper in kk-core
- [x] Implement `discoverPlugins(pluginsRoot)`, `listByKind`, `getByName` with diagnostics (`malformed`, `duplicate_name`, `unreadable`)
- [x] Export registry/manifest API from the package barrel (or documented subpath)
- [x] Unit tests with temp plugin trees: valid multi-kind discovery; list-by-kind; malformed skip+reason; duplicate-name first-wins + diagnostic; missing plugin.json silent skip
- [x] Run `bun run lint` and `bun run test`; no production call sites in CLI yet (that is `0005`)
### Solution
Implemented `plugin.json` manifest schema and filesystem registry discovery by kind in `@gobing-ai/kk-core`.

| File | Change |
|------|--------|
| `packages/kk-core/src/manifest.ts:4-21` | `PluginManifestSchema`, `PluginManifest` type, and `parsePluginManifest` helper |
| `packages/kk-core/src/kinds.ts:8` | `PluginKindSchema` Zod enum export |
| `packages/kk-core/src/registry.ts:32-117` | `discoverPlugins(pluginsRoot)` single-level filesystem scanner + `listByKind` + `getByName` |
| `packages/kk-core/src/index.ts:13-25` | Export manifest and registry public APIs from barrel |
| `packages/kk-core/tests/manifest.test.ts` | Unit tests for `PluginManifestSchema` validation |
| `packages/kk-core/tests/registry.test.ts` | Unit tests for discovery, listByKind, malformed skip (R3), duplicate name first-wins (R4), and unreadable errors |

**Testing Outcome**
- `bun run autofix` passed cleanly (0 lint/typecheck errors across monorepo).
- `bun run test` passed 27/27 tests (100% funcs, 98.93% lines overall coverage).
### Testing
**Verdict: PASS** (re-verify `--force` 2026-07-25)

**Commands (this run)**

```text
bun run autofix    # exit 0
bun run spur-check # exit 0
bun run test       # 27 pass, 0 fail; aggregate funcs 100%, lines 98.93%
```

Coverage: `packages/kk-core` — funcs 100%; lines ~91%+ on `registry.ts` (uncovered: rare unreadable-stat / JSON-parse error branches at 62, 78–83); overall suite 98.93% lines.

**Per-Requirement Traceability**

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `packages/kk-core/src/manifest.ts:5-13` `PluginManifestSchema` (name/kind/entry); `kinds.ts:8` `PluginKindSchema`; tests `manifest.test.ts:5-16` valid parse, `:18-26` missing kind/entry, `:28-38` invalid kind |
| R2 | MET | `registry.ts:33-121` `discoverPlugins`; `:124-126` `listByKind`; `:129-131` `getByName`; tests `registry.test.ts:17-50` multi-kind discovery + list/get |
| R3 | MET | `registry.ts:87-96` malformed → diagnostic + continue; tests `registry.test.ts:53-71` (good plugin still registered; reason contains `kind`) |
| R4 | MET | `registry.ts:99-106` duplicate first-wins + `duplicate_name`; tests `registry.test.ts:74-97` |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| R1 — valid kind & entry | MET | test | `packages/kk-core/tests/manifest.test.ts:5-39` |
| R2 — discover + list by kind | MET | test | `packages/kk-core/tests/registry.test.ts:17-50` |
| R3 — malformed skip | MET | test | `packages/kk-core/tests/registry.test.ts:53-71` |
| R4 — duplicate-name diagnostic | MET | test | `packages/kk-core/tests/registry.test.ts:74-97` |

**Design conformance:** all Design claims DONE (manifest schema, one-level scan, silent missing plugin.json, first-wins duplicate, API surface).

**SECUA:** no blockers/majors. P4: local FS only (by design).

**Fix-pass:** none required this run — implementation already present; re-verified only. Artifact: `.spur/run/0004-verdict.json`.

**--next:** task already terminal (`done`) — no-op.
### Review
SECUA review of `@gobing-ai/kk-core` plugin manifest schema & registry discovery.

| Priority | Finding | Disposition |
|----------|---------|-------------|
| P1 | — | none |
| P2 | — | none |
| P3 | — | none |
| P4 | Direct filesystem `readFileSync`/`readdirSync` assumes local plugins root — expected per ADR-006 local discovery | accepted residual |

**Residual risk:** none material for B1; single-level scanning prevents runaway directory traversals.

**Final disposition:** approve for `done` — discovery & manifest contracts complete, all unit tests PASS.
### References
- Platform feature: **B** (`kk plugin platform`) — `feature_id` after B1 terminal re-parent (Spur L4.feature-terminal)
- Delivered under child **B1** (Plugin manifest and registry discovery), feature status `done`
- AC scenarios R1–R4 match B1 / rolled into B for DD-09 subset
- Depends on: `0003` (B2 contracts)
- Related next: `0005` (B3 invoke)
### History
- 2026-07-25T16:55:01.088Z todo → wip (system)
- 2026-07-25T16:55:03.470Z wip → testing (system)
- 2026-07-25T16:55:23.029Z testing → done (system)
