# Multi-root plugin auto-discovery

Feature **B7** (shipped — ADR-012, 2026-08-13; task 0053). Runtime discovery of
package-shipped built-in plugins plus user/project kind-collection plugins.

> Chosen approach: extend `@gobing-ai/kk-core` `discoverPlugins` with root resolution + merge.
> Rejected: restore spur PluginLoader; register kk kinds as workflow action extensions.

Authority: **ADR-012** (Accepted). Amends ADR-009 clause 3 (per-root layout stays).

---

## 0. Spur source — what YAML actually extends

Checked 2026-08-13 against `spur-new` / `@gobing-ai/ts-dual-workflow-engine` / `@gobing-ai/ts-rule-engine`. This is the seam B7 copies. It is **not** `PluginLoader` and **not** a new workflow action kind.

### Workflow YAML names a kind. It does not load an implementation.

A guard or action in YAML is only `{ kind, options }`:

```yaml
# apps/cli/schemas/state-machine-workflow.schema.json $defs.guard / $defs.action
guard:
  kind: shell
  options:
    command: 'test "$profile" = auto'
onEnter:
  - kind: agent.run
    options: { input: "…" }
  - kind: rule.check
    options: { preset: recommended-pre-check }
```

The driver looks the kind up on `WorkflowEngineHost` and fails if it is unknown:

- `state-machine.ts` `firstPassingTransition` → `host.evaluateGuard(transition.guard.kind, …)`
- `host.ts` `evaluateGuard` / `runAction` → `CapabilityRegistry.get(kind)` or `Unknown workflow action/guard`

`type: gate` / `type: parallel` on a transition-flow node is **not read** by `transition-flow.ts`. A gate is just a node whose outbound `condition` is a guard. Same lookup.

### Three places a kind can come from

| Layer | Registered where | Kinds |
|-------|------------------|--------|
| Engine builtins | `createDefaultWorkflowEngineHost` (`host.ts`) | `note`, `shell`, `event.emit`, `always`, `never`, `action-ok`, engine `shell` guard |
| Spur builtins | `registerSpurBuiltins` (`packages/app/src/workflow/builtins.ts`), called from `workflow-service.ts` when the CLI builds the host | `agent.run`, streaming `shell`, env-var `shell` guard, `rule.check`, `file.exists` / `file.read` / `file.read.into-var`, `hitl.*`, `http.request`, `response.validate` |
| Extension modules | `loadWorkflowExtensionsIntoHost` (`extensions.ts`) | TS module default-export `{ name, actions[], guards[] }` |

`spur workflow run` **today** never calls `loadWorkflowExtensionsIntoHost`. That gap is being
closed outside this repo: ts-libs **C1** / task **0062** adds `extensions.actions` /
`extensions.guards` to `WorkflowDef`; spur-new **D4** / task **0533** loads them on
`validate` / `run` / `continue`. B7 **assumes that capability** and does not reimplement it.

### The YAML that *does* declare module paths is the rule engine

Preset / rule file (`preset.schema.json`, `ts-rule-engine` `collectExtensions`):

```yaml
extensions:
  evaluators:
    - ./extensions/custom-evaluator.ts   # relative to the YAML file; no abs, no ..
```

Then a rule says `evaluator: { type: <export.name> }`. Paths are `(baseDir = dirname(yaml), path as authored)` → `loadExtensionModules` → `host.evaluators.register`. That is "defined in the YAML, loaded from a folder next to the YAML."

### What B7 copies

- **Kind lookup:** a plugin is resolved by **name** from the kk registry, the same way a workflow resolves `kind: shell` from the host. `kk executor run extra-gen` is `registry.get("extra-gen")`.
- **YAML as injector of paths, not of runners:** a workflow injects extra folders as **vars** (B3 already has `plugins_root`) and the CLI unions them (`--plugins-path`). Same idea as rule `extensions.evaluators: [./…]`, but the payload is a `plugin.json` directory, not a dynamically imported TS evaluator.
- **Do not** register `kk.ingest` / `kk.generate` / `kk.publish` on Spur's `WorkflowEngineHost`. kk does not own that host. Steps stay `kind: shell` → `kk executor *`.
- **Do not** call `loadWorkflowExtensionsIntoHost` or restore spur `PluginService` (still a no-op, ADR-012 in spur-new).

---

## 1. Decisions

| ID | Choice | Rejected | Why |
|----|--------|----------|-----|
| D1 | Multi-root merge in `@gobing-ai/kk-core` next to `discoverPlugins` | New package; CLI-only merge | Discovery is already I/O in kk-core; one module owns the registry |
| D2 | Built-ins resolved from the packaged tree (`bundle-plugins` staging) | Static `import` table of plugins; CWD-only `./plugins` | Pack-time ship already exists; runtime must consume it |
| D3 | `~/.config/kk/plugins` is the **default global store**, plus CWD `./plugins` | Treat `~/.config/kk/plugins` as the only user location | A fixed home is a convenience, not a lock; exclusive home would make path injection pointless |
| D4 | Repeatable `--plugins-path` is additive (any folder). `--plugins-root` stays exclusive isolation | Make `--plugins-root` the injection flag (today's exclusive replace) | Workflow YAML already injects a folder via vars; replace-not-union hides built-ins |
| D5 | Shadow: later / higher-priority `name` wins + diagnostic | Fail the scan; silent last-write | Fail-loud about the collision; keep a usable registry |
| D6 | Workflow YAML names plugins via `kk executor *` | Custom workflow action kinds | kk owns steps; spur owns orchestration (ADR-006/007) |
| D7 | `PluginRecord.origin`: `builtin` \| `project` \| `user` \| `path` | Infer origin only in the CLI | Status and invoke share one record |

---

## 2. Roots and priority

Default discovery (no `--plugins-root`), **low → high**. A later root shadows an earlier
`name`. Same `realpath` is scanned once.

| Order | Origin | Root | Present when |
|-------|--------|------|----------------|
| 1 | `builtin` | Package-shipped kind collections | Always (resolved from the `kk` package) |
| 2 | `user` | `~/.config/kk/plugins` | Directory exists |
| 3 | `project` | `<cwd>/plugins` | Directory exists and is not the builtin realpath |
| 4 | `path` | Each `KK_PLUGIN_PATH` entry (colon-separated, left → right) | Entry is a non-empty existing directory |
| 5 | `path` | Each `--plugins-path <dir>` (repeatable, left → right) | Flag present; highest default-path priority |

`--plugins-path <dir>` (repeatable): **union** with the table. A workflow injects any
folder this way (`kk executor run … --plugins-path ${vars.plugins_path}`). Combining it
with `--plugins-root` is a usage error.

`--plugins-root <dir>`: skip the table; scan that one root only (`origin: path`). Isolation
and tests only — not the workflow injection flag. A `--plugins-root` that *is* a kind
collection still scans that collection's children (ADR-009).

### What an extra path may be

Tried in order for each `--plugins-path` / `KK_PLUGIN_PATH` entry:

1. **Single plugin directory** — the folder itself contains `plugin.json`. Register that
   one plugin; `kind` comes from the manifest (no collection-folder constraint).
2. **Kind collection** — basename is `ingestions` / `generations` / `publishings`. Scan
   children (ADR-009).
3. **Plugins tree** — scan kind collections under it (ADR-009). `plugins/kk` skipped.

This is the dynamic-load seam: the caller names any folder at runtime; the registry
classifies it. A default global store (`~/.config/kk/plugins`) does not replace this.

### Built-in root resolution

1. If `apps/cli/plugins` exists next to the published package (`join(packageRoot, 'plugins')`
   where `packageRoot` is the directory containing `package.json` for
   `@gobing-ai/knowledge-kit`), use it.
2. Else, if running from the monorepo sources, use the repo-root `plugins/` tree.
3. Never invent a third layout. Do not scan `plugins/kk`.

---

## 3. Interfaces (signatures, not bodies)

```ts
type PluginOrigin = 'builtin' | 'project' | 'user' | 'path';

interface PluginRecord {
    name: string;
    kind: PluginKind;
    entry: string;
    dir: string;
    manifestPath: string;
    origin: PluginOrigin;
    version?: string;
    description?: string;
}

interface DiscoverAllOptions {
    cwd?: string;
    env?: { KK_PLUGIN_PATH?: string };
    homeDir?: string;
    packagePluginsRoot?: string; // injectable for tests
    extraPaths?: readonly string[]; // additive (--plugins-path / KK_PLUGIN_PATH)
    pluginsRoot?: string;        // exclusive override (CLI --plugins-root)
}

function resolvePluginRoots(opts?: DiscoverAllOptions): readonly { origin: PluginOrigin; root: string }[];
function discoverAllPlugins(opts?: DiscoverAllOptions): DiscoveryResult;
function discoverPlugins(pluginsRoot: string): DiscoveryResult; // unchanged single-root scan
```

`discoverPlugins` stays the per-root scanner (ADR-009 diagnostics unchanged).
`discoverAllPlugins` calls it per resolved root, realpath-dedupes, then merges by `name`.

New diagnostic code (in addition to B1): `shadowed` — `path` is the losing manifest;
`reason` names the winning `manifestPath` and origin.

---

## 4. Invariants

1. Built-in plugins are directories with `plugin.json`. They are not statically imported
   into `dist/index.js` and are not spur PluginHost modules.
2. Every default extra root obeys ADR-009. `misplaced` / `kind_mismatch` / `malformed`
   skip that plugin and do not abort the merge.
3. `plugins/kk` is skipped on every root.
4. `kk executor run` / `fan-out` / `plugin status` share one discovery call (union of
   defaults + `--plugins-path`, unless `--plugins-root`).
5. Workflow definitions do not grow new action kinds for product plugins. They **do**
   inject extra folders via `--plugins-path` (the B3 template's `plugins_root` var becomes
   `plugins_path` and stops using exclusive `--plugins-root`).
6. `--plugins-root` and `--plugins-path` are mutually exclusive (exit 2).

---

## 5. Surface (shipped — landed in `04_DESIGN.md` §1/§3 with task 0053; T3)

- Env: `KK_PLUGIN_PATH` (optional, colon-separated extra paths; additive)
- CLI: default discovery switches from `discoverPlugins('./plugins')` to `discoverAllPlugins()`
- `--plugins-path <dir>` (repeatable): additive extra folders (tree, collection, or single plugin)
- `--plugins-root` flag text: exclusive override (isolation / tests only; no union)
- `kk plugin status --json`: each plugin includes `origin`
- Public exports on `@gobing-ai/kk-core`: `discoverAllPlugins`, `resolvePluginRoots`, `PluginOrigin`
- B3 template `.spur/workflows/kk-ingest-generate-publish.yaml`: `--plugins-path` not `--plugins-root`

---

## 6. Test seams

- Inject `packagePluginsRoot`, `homeDir`, `cwd`, `env` — no real `$HOME` in unit tests.
- Existing `--plugins-root` tests remain exclusive (no built-in leak).
- Merge fixture: builtin + user same name → user wins + `shadowed` diagnostic.
- Realpath fixture: cwd `./plugins` === builtin → one scan, no duplicate.
