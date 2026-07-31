---
name: Design
doc: 04_DESIGN
owns: SURFACE — concrete shapes: every CLI command, flag, config key, env var, table, DTO
authority: derived
version: 1.2.0
created_at: 2026-07-22
updated_at: 2026-07-25
derived_from: [00_ADR, 01_PRD, 03_ARCHITECTURE]
edit_rules: 99 §6.5
sync: [T3]
---

# Design — surface shapes

> Derived. Concrete shapes — every command, flag, config key, env var, schema, and DTO.
> Edit in the **same commit** as the surface change (constitution T3).

## 1. CLI commands

Package: `@gobing-ai/knowledge-kit` · Binary: `knowledge-kit` · Path: `apps/cli`.

```text
knowledge-kit --help
knowledge-kit --version
knowledge-kit add <a> <b>
knowledge-kit invoke <plugin> --in <path> --out <path> [--plugins-root <dir>]
knowledge-kit plugins list [--kind <kind>] [--json] [--plugins-root <dir>]
knowledge-kit plugins doctor [--json] [--plugins-root <dir>]
```

| Command | Description |
|---------|-------------|
| `add <a> <b>` | Add two integers; print the sum to stdout (via `logger.out`) |
| `invoke <plugin>` | Invoke a plugin with input/output files and contract validation |
| `plugins list` | List discovered plugins grouped by kind (`--kind` filter, `--json` format) |
| `plugins doctor` | Validate plugin manifests and entry files under plugins root |

### `add`

| Arg | Type | Coercion | Required |
|-----|------|----------|----------|
| `a` | number | `Number.parseInt(v, 10)` | yes |
| `b` | number | `Number.parseInt(v, 10)` | yes |

**Output:** decimal sum followed by newline on stdout. Exit 0 on success.

**Implementation:** `apps/cli/src/cli.ts` → `add` from `@gobing-ai/utils`.

### `invoke`

| Arg / Option | Type | Required | Default | Description |
|--------------|------|----------|---------|-------------|
| `<plugin>` | string | yes | — | Name of plugin to resolve from registry |
| `--in <path>` | string | yes | — | Input file path (or source path for ingestion) |
| `--out <path>` | string | yes | — | Output file path written by plugin |
| `--plugins-root <dir>` | string | no | `./plugins` | Root directory to discover plugins from |

**Behavior:**
1. Resolves `<plugin>` name via `discoverPlugins` & `getByName`.
2. Validates input file against kind's input schema before spawn (fails loud if schema violated).
3. Spawns plugin entry executable with `--in <in>` and `--out <out>`.
4. On non-zero entry exit, fails loud and surfaces error message (returns entry exit code).
5. Validates written output file against kind's output schema.

**Implementation:** `apps/cli/src/cli.ts` & `apps/cli/src/invoke.ts`.

### `plugins list`

| Option | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `--kind <kind>` | string | no | — | Filter by plugin kind (`ingestion`, `generator`, `publish`) |
| `--json` | boolean | no | `false` | Emit machine-readable JSON array of records |
| `--plugins-root <dir>` | string | no | `./plugins` | Root directory containing plugins |

**Behavior:**
1. Scans `--plugins-root` using `discoverPlugins`.
2. Filters by `--kind` if specified using `listByKind`.
3. Under `--json`, writes raw `PluginRecord[]` JSON array to stdout via `logger.out`.
4. Under standard text, prints records grouped by kind (`ingestion`, `generator`, `publish`).

**Implementation:** `apps/cli/src/cli.ts`.

### `plugins doctor`

| Option | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `--json` | boolean | no | `false` | Emit machine-readable JSON health report |
| `--plugins-root <dir>` | string | no | `./plugins` | Root directory containing plugins |

**Behavior:**
1. Scans `--plugins-root` using `discoverPlugins`.
2. Verifies `plugin.json` schema validity, unique names, and entry file existence on disk (`missing_entry`).
3. Under `--json`, writes `{ healthy: boolean, diagnostics: DiscoveryDiagnostic[] }` JSON.
4. Under standard text, prints formatted diagnostic errors to stderr via `logger.error`.
5. Exits code `1` if any diagnostic issue exists, `0` if healthy.

**Implementation:** `apps/cli/src/cli.ts`.


## 2. Configuration keys

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| _(none yet)_ | — | — | No product config file; Spur config lives under `.spur/config.yaml` (harness only) |

## 3. Environment variables

| Var | Required | Description |
|-----|----------|-------------|
| `NODE_ENV` | no | Set to `test` by workspace test scripts |

## 4. Public package surface

### `@gobing-ai/utils` (`packages/utils`)

| Export | Kind | Notes |
|--------|------|-------|
| `add(a, b)` | function | Pure integer sum |
| `logger` | object | `info`, `error`, `out` — stdout/stderr writers |
| `z`, `ZodType` | re-export | Single zod instance for workspaces (Zod 4) |

### `@gobing-ai/kk-core` (`packages/kk-core`)

| Export | Kind | Notes |
|--------|------|-------|
| `DocSchema`, `ContentSchema`, `ResultSchema`, `DocListSchema` | Zod schemas | Pure data contract schemas |
| `Doc`, `Content`, `Result` | types | Inferred TypeScript types |
| `PLUGIN_KINDS`, `PluginKind`, `PluginKindSchema` | constants & schema | Supported plugin lifecycle kinds |
| `kindContract(kind)` | function | Resolves I/O contract per plugin kind |
| `PluginManifestSchema`, `parsePluginManifest`, `PluginManifest` | schema & type | Validation for `plugin.json` manifests |
| `discoverPlugins(root)`, `listByKind`, `getByName` | functions | Filesystem discovery and registry filtering |
| `PluginRecord`, `DiscoveryDiagnostic`, `DiscoveryResult` | interfaces | Structured discovery output types |

### `@gobing-ai/knowledge-kit` (`apps/cli`)

| Export | Kind | Notes |
|--------|------|-------|
| `createProgram()` | function | Side-effect-free Commander factory |
| `runInvoke(opts)` | function | Invoke execution & contract validation engine |
| `bin: knowledge-kit` | binary | `./src/index.ts` under Bun |

## 5. Spur project config (harness)

File: `.spur/config.yaml`

| Key | Value |
|-----|--------|
| `name` | `knowledge-kit` |
| `bootstrap.database.driver` | `bun-sqlite` |
| `bootstrap.database.url` | `.spur/spur.db` |

## 6. Design specifications

| Specification | Path | Description |
|---------------|------|-------------|
| Ingestion Plugin Specification | `docs/design/ingestion-plugin-specification.md` | Generic plugin authoring contract + Ingestion Plugin specification |
| Generator Plugin Specification | `docs/design/generator-plugin-specification.md` | Generator-kind authoring contract: Doc[]→Content mapping, skill-backed entry, stand-in criteria, failure semantics |
| Publish Plugin Specification | `docs/design/publish-plugin-specification.md` | Publish-kind authoring contract: transport abstraction, Content→frontmatter mapping, Result conventions, generic §1 citation |


