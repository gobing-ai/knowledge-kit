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
```

| Command | Description |
|---------|-------------|
| `add <a> <b>` | Add two integers; print the sum to stdout (via `logger.out`) |
| `invoke <plugin>` | Invoke a plugin with input/output files and contract validation |

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
