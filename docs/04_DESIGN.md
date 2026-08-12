---
name: Design
doc: 04_DESIGN
owns: SURFACE — concrete shapes: every CLI command, flag, config key, env var, table, DTO
authority: derived
version: 2.4.0
created_at: 2026-07-22
updated_at: 2026-08-12
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

| Command | Description | Status |
|---------|-------------|--------|
| `add <a> <b>` | Add two integers; print the sum to stdout (via `logger.out`) | shipped |
| `invoke <plugin>` | Invoke a plugin with input/output files and contract validation | shipped |
| `plugins list` | List discovered plugins grouped by kind (`--kind` filter, `--json` format) | shipped |
| `plugins doctor` | Validate plugin manifests and entry files under plugins root | shipped |
| `fanin` | Merge N `Doc[]` files into one (§1.5) | shipped (B6) |
| `fanout` | Dispatch one `Content` to N publish targets in sequence (§1.6) | shipped (B6) |

> **Surface status.** Rows marked *shipped* are live in `apps/cli` (transcribed from the code
> registrations). `fanin` / `fanout` shipped with feature **B6** (tasks 0042/0043) — §1.5/§1.6 are
> callable today. The spec's `--dedupe` flag is deliberately deferred, not shipped — see §1.5.

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

### 1.5 `fanin` — shipped (B6)

Merges N `Doc[]` files into one. Sibling of `invoke` so the single-plugin invoker contract stays
intact (ADR-006). Spec: `docs/design/fan-in-and-fan-out-specification.md` §1.2, §2.

```text
knowledge-kit fanin --in <f1> [--in <f2> …] --out <merged.json>
```

| Option | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `--in <file>` | string (repeatable) | yes (≥1) | — | Input `Doc[]` JSON files to merge |
| `--out <file>` | string | yes | — | Output merged `Doc[]` JSON path |

**Behavior:** validate each input against `DocListSchema` (missing / unreadable / invalid-JSON /
schema-violating file exits `1` naming the file) → dedupe by `Doc.id` (first-seen wins; later
duplicates contribute only their provenance) → append `metadata.sources: Array<{ file,
sourceUri? }>` in `--in` order → keep first-appearance order → write merged `Doc[]`. Exit `0` on
success, `2` on usage errors. **Deferred:** spec §1.2's `--dedupe <id|uri|none>` flag is **not
shipped** — id dedupe (default) is the only rule; add the flag if a `uri`-dedupe consumer appears
(task 0042).

### 1.6 `fanout` — shipped (B6)

Dispatches one `Content` to N publish targets **in sequence**, emitting one aggregate `Result`.
Spec: `docs/design/fan-in-and-fan-out-specification.md` §1.3, §3–§6.

```text
knowledge-kit fanout --content <content.json> --target <p1> [--target <p2> …] \
                     --out <result.json> [--retry-from <prior-result.json>] [--plugins-root <dir>]
```

| Option | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `--content <file>` | string | yes | — | `Content` JSON to publish |
| `--target <plugin>` | string (repeatable) | yes (≥1)\* | — | Publish plugin name per target |
| `--out <file>` | string | yes | — | Aggregate `Result` JSON path |
| `--retry-from <file>` | string | no | — | Prior `Result`; published/skipped targets carried as `skipped` (url/id preserved), only prior failures re-dispatched |
| `--plugins-root <dir>` | string | no | `./plugins` | Root directory containing plugins |

\* `--target` is required unless `--retry-from` supplies the retry set; explicit `--target` values
then narrow the dispatch to the still-unpublished subset.

**Behavior:** validate `--content` against `ContentSchema` and every target against the publish
registry (malformed flags, invalid content, or an unresolvable target exits `2`) → dispatch targets
sequentially, one `TargetOutcome` per target → write the aggregate `{ ok, summary: { total,
succeeded, failed, skipped }, targets }` (spec §3.1) to `--out`.

**Exit-code contract:**

| Outcome | Exit | Aggregate `Result` |
|---------|------|--------------------|
| All targets published | `0` | every dispatched entry `published` (carried retry entries `skipped`) |
| Some published, some failed | `1` | mixed entries; successes retain `published` |
| All targets failed | `1` | every entry `failed` |
| CLI / input error (malformed flags, invalid `--content`, unresolvable target, `--out` write failure) | `2` | nothing written to `--out` |

Partial success is **not** exit 0 — the run fails loud (ADR-007 R5), while successful targets stay
published and are individually re-runnable via `--retry-from` (spec §5).

## 1.7 `plugin.json` manifest surface

Every plugin directory under `--plugins-root` carries a `plugin.json`. Schema:
`PluginManifestSchema` (`packages/kk-core/src/manifest.ts`), `.passthrough()` — unknown keys are
preserved, not rejected.

| Field | Type | Required | Status | Description |
|-------|------|----------|--------|-------------|
| `name` | string (min 1) | yes | shipped | Unique plugin name; the argument to `kk invoke` |
| `kind` | `ingestion` \| `generator` \| `publish` | yes | shipped | Selects the I/O data contract via `kindContract(kind)` |
| `entry` | string (min 1) | yes | shipped | Relative path to the executable entry the invoker spawns |
| `version` | string | no | shipped | Informational |
| `description` | string | no | shipped | Informational |
| `accepts` | `('brief' \| 'docs')[]` | no | **specified — not implemented** (D) | Generator-only. Declares which input shapes the plugin handles; defaults to both when absent. Lets a mismatch fail at **resolve time** rather than inside the plugin |

**Resolve-time validation (shipped).** `kk invoke` resolves the manifest, selects the contract with
`kindContract(record.kind)` (`apps/cli/src/invoke.ts:35`), and validates the input file with
`contract.input.safeParse(json)` (`apps/cli/src/invoke.ts:65`) **before** spawning the entry — a
schema violation exits non-zero with `Input schema violation for kind '<kind>': <issues>`.

**Planned extension (feature D).** Once the generator contract widens to `GeneratorInput`
(`{ brief?, docs? }`, at least one), the same resolve-time step also checks the populated keys
against `accepts`. A brief-only input handed to an `accepts: ["docs"]` generator fails with a named
error rather than a silent empty `Content`. **Migration note:** the existing `content-gen` plugin
does *not* survive this change unchanged — its entry must read `{ docs: Doc[] }` instead of a
root-level `Doc[]` array, and should declare `"accepts": ["docs"]`.

## 2. Configuration keys

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| _(none yet)_ | — | — | No product config file; Spur config lives under `.spur/config.yaml` (harness only) |

## 3. Environment variables

| Var | Required | Description |
|-----|----------|-------------|
| `NODE_ENV` | no | Set to `test` by workspace test scripts |
| `POSTSURFING_BIN` | no (surfdash-pub) | Path to the `postsurfing` binary the Surfdash transport invokes (default: on PATH) |
| `ZENN_REPO` | yes (zenn-pub) | Zenn/GitHub repository path the Zenn transport publishes into (`npx zenn` + `git add/commit/push`) |
| `QIITA_TOKEN` | yes (qiita-pub) | Qiita API v2 token; sent as `Authorization: Bearer <token>` on `POST /api/v2/items` |
| `KNOWLEDGE_KIT_PUBLISH_TRANSPORT` | no | `fake` selects `FakeFileCliTransport` instead of the real transport — the offline harness switch, identical across `surfdash-pub` / `zenn-pub` / `qiita-pub` |

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
| `BriefSchema`, `GeneratorInputSchema` | Zod schemas | **Specified, not implemented** (ADR-007 R3; feature D) |
| `Doc`, `Content`, `Result` | types | Inferred TypeScript types |
| `Brief`, `GeneratorInput` | types | **Specified, not implemented** (ADR-007 R3; feature D) |
| `PLUGIN_KINDS`, `PluginKind`, `PluginKindSchema` | constants & schema | Supported plugin lifecycle kinds |
| `kindContract(kind)` | function | Resolves I/O contract per plugin kind |
| `PluginManifestSchema`, `parsePluginManifest`, `PluginManifest` | schema & type | Validation for `plugin.json` manifests |
| `discoverPlugins(root)`, `listByKind`, `getByName` | functions | Filesystem discovery and registry filtering |
| `PluginRecord`, `DiscoveryDiagnostic`, `DiscoveryResult` | interfaces | Structured discovery output types |

### `@gobing-ai/publish-harness` (`packages/publish-harness`)

| Export | Kind | Notes |
|--------|------|-------|
| `PublishTransport` | interface | `{ kind: 'file-cli' \| 'browser', publish(payload): Promise<Result> }` (ADR-008) |
| `PublishTransportPayload` | interface | `{ content: Content, options?: Record<string, unknown> }` |
| `FakeFileCliTransport` | class | Offline fake for unit tests; `setNextResult`, records call log |

### `@gobing-ai/surfdash-pub` (`plugins/surfdash-pub`, kind `publish`)

| Export | Kind | Notes |
|--------|------|-------|
| `PostsurfingFileCliTransport` | class | `file-cli` transport: `postsurfing` CLI child process; requires `POSTSURFING_BIN` (default: on PATH) |
| `mapContentToSurfingMarkdown(content)` | function | Renders Surfdash markdown + frontmatter (title, description, tags, date, canonical_url, published) |
| `processPublishIO(inputPath, outputPath, transport?)` | function | `--in`/`--out` IO per the publish spec §1 |
| `main()` | function | `--in`/`--out` arg parsing; exit 0 success / 1 failure |

### `@gobing-ai/zenn-pub` (`plugins/zenn-pub`, kind `publish`)

| Export | Kind | Notes |
|--------|------|-------|
| `ZennCliFileCliTransport` | class | `file-cli` transport: `npx --yes zenn new:article` + `articles/<slug>.md` write + git push; requires `ZENN_REPO` |
| `mapContentToZennMarkdown(content)` | function | Renders Zenn frontmatter (title, type, emoji, topics, published, slug) + body |
| `processPublishIO(inputPath, outputPath, transport?)` | function | `--in`/`--out` IO per the publish spec §1; writes fail-loud `Result` |
| `main()` | function | `--in`/`--out` arg parsing; exit 0 success / 1 failure |

### `@gobing-ai/qiita-pub` (`plugins/qiita-pub`, kind `publish`)

| Export | Kind | Notes |
|--------|------|-------|
| `QiitaApiTransport` | class | `file-cli` transport: `POST /api/v2/items` via `fetch` with Bearer token; requires `QIITA_TOKEN` |
| `mapContentToQiitaMarkdown(content)` | function | Renders Qiita frontmatter (title, block-style tags, private) + body |
| `processPublishIO(inputPath, outputPath, transport?)` | function | `--in`/`--out` IO per the publish spec §1; writes fail-loud `Result` |
| `main()` | function | `--in`/`--out` arg parsing; exit 0 success / 1 failure |

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
| Generator Plugin Specification | `docs/design/generator-plugin-specification.md` | Generator-kind authoring contract: Doc[]→Content mapping, owned STORM engine (D4), failure semantics |
| Publish Plugin Specification | `docs/design/publish-plugin-specification.md` | Publish-kind authoring contract: transport abstraction, Content→frontmatter mapping, Result conventions, generic §1 citation |
| Fan-In / Fan-Out Specification | `docs/design/fan-in-and-fan-out-specification.md` | `kk fanin` / `kk fanout` CLI surface, merge + dedupe semantics, aggregate partial-success `Result`, exit codes, `--retry-from` (task 0033) |


