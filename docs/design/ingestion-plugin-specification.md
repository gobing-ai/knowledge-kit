# Ingestion Plugin Specification & Generic Plugin Authoring Contract

## 1. Generic Plugin-Instance Authoring Contract

This section defines the shared contract applicable to all Knowledge-Kit plugin kinds (`ingestion`, `generator`, `publisher`). Subsequent kind specifications (such as D3 Generator Plugin Design) cite this section directly.

### 1.1 Manifest Contract
Every plugin directory MUST contain a `plugin.json` conforming to `PluginManifestSchema`:
```json
{
  "name": "example-plugin",
  "kind": "ingestion",
  "entry": "./src/index.ts",
  "version": "1.0.0",
  "description": "Ingests documents from source"
}
```

### 1.2 Invocation & Entry Spawn Contract
All plugins are spawned by `runInvoke(opts)` via `Bun.spawnSync`:
- **Executable Command**: `[process.execPath, entryPath, '--in', absInPath, '--out', absOutPath]` (for `.ts` / `.js` entries) or `[entryPath, '--in', absInPath, '--out', absOutPath]`.
- **Environment**: Inherits `process.env` completely.

### 1.3 Extra-Config & Secrets Channels
- **Extra Config**: Non-secret parameters are supplied within the JSON file or directory specified by `--in`.
- **Secrets**: Credentials (API tokens, auth keys) MUST be passed exclusively through environment variable inheritance (`process.env`). Secrets MUST NEVER be committed to disk or included in `plugin.json`.

### 1.4 Exit Code & Validation Contract
- **Exit Code 0**: Signifies successful execution. The plugin entry MUST write a JSON file to `--out` that satisfies the kind's output schema (`kindContract(kind).output`).
- **Exit Code != 0**: Signifies a execution failure. The plugin MUST output diagnostic errors to `stderr`.

### 1.5 On-disk layout (ADR-009)
Product plugins MUST live under the kind collection that matches `plugin.json.kind`:

| `kind` | Path |
|--------|------|
| `ingestion` | `plugins/ingestions/<name>/` |
| `generator` | `plugins/generations/<name>/` |
| `publish` | `plugins/publishings/<name>/` |

Agent skills, slash commands, subagents, hooks, and rules MUST live under `plugins/kk/`
(`skills/`, `commands/`, `agents/`, `hooks/`, `rules/`). They are not product plugins.

A kk-core `plugin.json` at `plugins/<name>/` (outside a collection) is `misplaced`. A
`kind` that does not match its collection is `kind_mismatch`. `discoverPlugins` skips
`plugins/kk`.

---

## 2. Ingestion-Specific Contract

### 2.1 Kind Definition
- `kind`: `"ingestion"`
- `input`: `null` (Input path `--in` is validated for existence on disk by `runInvoke`)
- `output`: `DocListSchema` (`z.array(DocSchema)`)

### 2.2 `--in` Semantics per Source Type
- **File System (FS) Source**: `--in` specifies a file or directory path containing source documents.
- **API Source**: `--in` specifies a JSON configuration file containing endpoint settings and sync parameters.

### 2.3 Doc Mapping & Field Conventions
Target output schema: `DocSchema` (`{ id, body, title?, sourceUri?, mediaType?, metadata? }`).
- **`id` Stability**: `id` MUST be derived deterministically from the canonical source identifier (e.g. relative file path for FS sources, or resource URI for API sources). Re-running ingestion over unchanged input MUST yield identical `id` values.
- **`body`**: Required primary text/markdown content.
- **Top-Level Fields**: `title`, `sourceUri`, and `mediaType` are promoted to top-level fields.
- **`metadata`**: Vendor-specific properties (e.g. `checksum`, `tags`, `author`) live inside `metadata`.

### 2.4 Failure & Diagnostics Semantics
- **Empty Output**: If no matching items exist, the plugin writes `[]` to `--out` and exits with code `0`.
- **Partial Item Failure**: If individual items fail to parse, the plugin logs a warning to `stderr`, skips the item, includes all valid items in `Doc[]`, and exits with code `0`.
- **Fatal Error**: If the source path is inaccessible or authentication fails, the plugin logs the error to `stderr` and exits with a non-zero code.

---

## 3. Platform Alignment & Verification

- **Platform Compliance**: Validated against `@gobing-ai/kk-core` (`discoverPlugins`, `kindContract`, `DocSchema`, `DocListSchema`) and `apps/cli/src/invoke.ts` (`runInvoke`).
- **Schema Impact**: Zero Zod schema changes or core `runInvoke` modifications required.
