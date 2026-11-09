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
- **Empty Output**: If no matching items exist, the plugin writes `[]` to `--out` and exits with code `0`. A plugin may only report "quiet" after it has *acquired* a successful, non-empty payload and parsed zero items — an empty acquisition is a failure, not a quiet day.
- **Partial Item Failure**: If individual items fail to parse, the plugin logs a warning to `stderr`, skips the item, includes all valid items in `Doc[]`, and exits with code `0`.
- **Fatal Error**: If the source path is inaccessible or authentication fails, the plugin logs the error to `stderr` and exits with a non-zero code.

### 2.5 Rendered sources (bot-backed session) — 0346

A client-rendered source may return a successful SPA shell with no data, so a bot-backed plugin declares the same `browserSession {profileName, homeUrl?}` descriptor a publish plugin uses (still with its `check` probe owning `login|check|open`) and calls `runBotCollection` from `@gobing-ai/publish-harness/bot-collection` inside its own entry process (contract: `docs/04_DESIGN.md` §1.13).

- **The plan is data the plugin builds**: an ordered `request | navigate | wait | click | scroll | extract` list plus `responses[]` captures. Selectors, pagination, politeness and `Doc[]` mapping are plugin-owned; the harness executes, captures and cleans up.
- **Declare every artifact you require.** Each declared capture and each request/extract artifact must produce a non-empty body, so a missing data XHR fails the run (`empty`) instead of degrading into `Doc[] = []`. A source that may legitimately have nothing to capture omits that declaration and parses what it did get.
- **Fail closed on auth.** An explicit 401/403 or a final URL on a login/signin/auth/sso path classifies as `authentication` with `kk bot login <url> --save <name>` guidance; other explicit ≥400 statuses, transport faults and timeouts are `browser`. A stored `expiresAt` is never readiness evidence — only an observed signal fails a run.
- **One lease, one launch, one profile.** The plugin child acquires the profile lease itself, so two concurrent collectors for the same profile fail `busy`. Do not export cookies, convert a foreign profile or manipulate the profile directory; the harness never does, and it closes the context and releases the lease on every path.
- **Diagnostics are safe by construction.** Errors carry the step/capture id only. Never log a query-bearing URL, a header or cookie value, or a response body from a collection run.

---

## 3. Platform Alignment & Verification

- **Platform Compliance**: Validated against `@gobing-ai/kk-core` (`discoverPlugins`, `kindContract`, `DocSchema`, `DocListSchema`) and `apps/cli/src/invoke.ts` (`runInvoke`).
- **Schema Impact**: Zero Zod schema changes or core `runInvoke` modifications required.
