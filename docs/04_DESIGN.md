---
name: Design
doc: 04_DESIGN
owns: SURFACE — concrete shapes: every CLI command, flag, config key, env var, table, DTO
authority: derived
version: 2.22.0
created_at: 2026-07-22
updated_at: 2026-08-20
derived_from: [00_ADR, 01_PRD, 03_ARCHITECTURE]
edit_rules: 99 §6.5
sync: [T3]
---

# Design — surface shapes

> Derived. Concrete shapes — every command, flag, config key, env var, schema, and DTO.
> Edit in the **same commit** as the surface change (constitution T3).

## 0. Design satellites

| Satellite | Area | Status |
| ----------- | ------ | -------- |
| [kk-cli-surface.md](design/kk-cli-surface.md) | Operator `kk` binary + two-noun tree | shipped (A2/A21) |
| [fan-in-and-fan-out-specification.md](design/fan-in-and-fan-out-specification.md) | Sequential `executor fan-in` / `fan-out` | shipped (B6) |
| [ingestion-plugin-specification.md](design/ingestion-plugin-specification.md) | Ingestion kind contract | shipped (C1) |
| [generator-plugin-specification.md](design/generator-plugin-specification.md) | Generator kind contract | shipped (D3) |
| [publish-plugin-specification.md](design/publish-plugin-specification.md) | Publish kind + transports | shipped (E2) |
| [emdash-pub.md](design/emdash-pub.md) | EmDash CMS publish channel | shipped (E5) |
| [multi-root-plugin-discovery.md](design/multi-root-plugin-discovery.md) | Built-in + user plugin discovery merge | shipped (B7, ADR-012) |
| [storm-evidence-cache.md](design/storm-evidence-cache.md) | STORM per-reference cache, markitdown normalization, digest contract | shipped (C5, ADR-013) |
| [ts-libs-logging-foundation.md](design/ts-libs-logging-foundation.md) | Catalog, output, diagnostics, and enforcement shapes | shipped (A3, ADR-014/ADR-015) |
| [itc-generating.md](design/itc-generating.md) | ITC generating skill — method + orchestration, no CLI | shipped (F3) |
| [voice-gen.md](design/voice-gen.md) | Voice generator plugin over local Voicebox REST | shipped (D5) |
| [kk-solo-podcast.md](design/kk-solo-podcast.md) | Solo-podcast product workflow over voice-gen | shipped (F5) |

## 1. CLI commands

Package: `@gobing-ai/knowledge-kit` · Binary: `kk` (alias `knowledge-kit`) · Path: `apps/cli`.

```text
kk --help
kk --version
kk executor run <plugin> --in <path> --out <path> [--plugins-root <dir>] [--plugins-path <dir> …]
kk executor fan-in --in <f1> [--in <f2> …] --out <merged.json>
kk executor fan-out --content <content.json> --target <p1> [--target <p2> …]
                   --out <result.json> [--retry-from <prior-result.json>]
                   [--plugins-root <dir>] [--plugins-path <dir> …]
kk plugin status [--kind <kind>] [--json] [--plugins-root <dir>] [--plugins-path <dir> …]
```

| Command | Description | Status |
| --------- | ------------- | -------- |
| `executor run <plugin>` | Invoke a plugin with input/output files and contract validation | shipped (A21) |
| `executor fan-in` | Merge N `Doc[]` files into one (§1.5) | shipped (A21) |
| `executor fan-out` | Dispatch one `Content` to N publish targets in sequence (§1.6) | shipped (A21) |
| `plugin status` | List discovered plugins grouped by kind with per-plugin health (`--kind` filter, `--json` report) | shipped (A21) |

> **Surface status.** Rows marked *shipped* are live in `apps/cli` (transcribed from the code
> registrations). The first-layer nouns are exactly `executor` and `plugin` (ADR-011, feature
> **A21**); the engines shipped with **A2** / **B6** keep their flags and exit codes, only the
> canonical paths changed. Hidden one-release aliases `invoke` / `fanin` / `fanout` / `plugins *`
> still reach the same engines but are not listed in `kk --help`. §1.5/§1.6 are callable today. The
> spec's `--dedupe` flag is deliberately deferred, not shipped — see §1.5.

### `executor run`

| Arg / Option | Type | Required | Default | Description |
| -------------- | ------ | ---------- | --------- | ------------- |
| `<plugin>` | string | yes | — | Name of plugin to resolve from the merged registry |
| `--in <path>` | string | yes | — | Input file path (or source path for ingestion) |
| `--out <path>` | string | yes | — | Output file path written by plugin |
| `--plugins-root <dir>` | string | no | — | Exclusive single-root scan (isolation/tests only; no union with defaults) |
| `--plugins-path <dir>` | string[] | no | — | Extra plugin root to union with the default roots (repeatable; tree, kind collection, or single `plugin.json` dir) |

**Behavior:**

1. Resolves `<plugin>` name via `discoverAllPlugins` & `getByName` (default discovery), or
   `discoverPlugins` when `--plugins-root` is given.
2. Validates input file against kind's input schema before spawn (fails loud if schema violated).
3. Spawns plugin entry executable with `--in <in>` and `--out <out>`.
4. On non-zero entry exit, fails loud and surfaces error message (returns entry exit code).
5. Validates written output file against kind's output schema.
6. `--plugins-root` and `--plugins-path` are mutually exclusive (usage error, exit 2).

**Implementation:** `apps/cli/src/commands/executor.ts` (`registerExecutorCommand`, `executor run`) & `apps/cli/src/invoke.ts` (engine).

### `plugin status`

| Option | Type | Required | Default | Description |
| -------- | ------ | ---------- | --------- | ------------- |
| `--kind <kind>` | string | no | — | Filter by plugin kind (`ingestion`, `generator`, `publish`) |
| `--json` | boolean | no | `false` | Emit the machine-readable unified health report |
| `--plugins-root <dir>` | string | no | — | Exclusive single-root scan (isolation/tests only; no union with defaults) |
| `--plugins-path <dir>` | string[] | no | — | Extra plugin root to union with the default roots (repeatable; tree, kind collection, or single `plugin.json` dir) |

**Behavior:**

1. Default discovery runs `discoverAllPlugins` — a merged low→high scan of the package-shipped
   built-in tree, `~/.kk/plugins` (when present), CWD `./plugins` (when present and not the
   built-in realpath), `KK_PLUGIN_PATH` entries, and `--plugins-path` dirs (ADR-012).
   `--plugins-root` skips the defaults and scans that one root only.
2. Filters by `--kind` if specified. Health is **tree-wide**: `healthy` and `diagnostics` are
   computed over the full merged tree before filtering, so a `--kind` report can be
   `healthy: false` with every listed plugin healthy (unfiltered diagnostics name the offenders).
3. Builds the unified report `{ healthy, plugins, diagnostics }` — one entry per discovered
   `PluginRecord` (including `origin`: `builtin` \| `project` \| `user` \| `path`) augmented with
   `healthy` and `diagnostics`; tree-level discovery diagnostics (`misplaced`, `kind_mismatch`,
   `malformed`, `duplicate_name`, `shadowed`, `unreadable`) stay in the top-level `diagnostics`
   array and are never dropped.
4. `missing_entry` (entry file absent on disk) attaches to the owning plugin's `diagnostics` and
   counts toward that plugin's `healthy: false`.
5. Under `--json`, writes the unified object to stdout via `logger.out`; under standard text,
   prints records grouped by kind with a per-plugin `[healthy]` / `[unhealthy]` mark, then any
   diagnostics to stderr via `logger.error`.
6. Exits code `1` when any diagnostic exists (plugin-level or tree-level), `0` when healthy;
   exits `2` when `--plugins-root` and `--plugins-path` are combined.

**Implementation:** `apps/cli/src/commands/plugin.ts` (`registerPluginCommand`).

### 1.5 `executor fan-in` — shipped (A21; engine B6)

Merges N `Doc[]` files into one. Sibling of `executor run` so the single-plugin invoker contract
stays intact (ADR-006). Spec: `docs/design/fan-in-and-fan-out-specification.md` §1.2, §2.
Canonical path is `kk executor fan-in`; `kk fanin` is a hidden one-release alias (ADR-011).
A missing `--out` parent directory is created (ADR-016); a write that genuinely fails still exits
non-zero.

```text
kk executor fan-in --in <f1> [--in <f2> …] --out <merged.json>
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

### 1.6 `executor fan-out` — shipped (A21; engine B6)

Dispatches one `Content` to N publish targets **in sequence**, emitting one aggregate `Result`.
Spec: `docs/design/fan-in-and-fan-out-specification.md` §1.3, §3–§6.
Canonical path is `kk executor fan-out`; `kk fanout` is a hidden one-release alias (ADR-011).
A missing `--out` parent directory is created (ADR-016); a write that genuinely fails still exits
with code 2.

```text
kk executor fan-out --content <content.json> --target <p1> [--target <p2> …] \
                    --out <result.json> [--retry-from <prior-result.json>]
                    [--plugins-root <dir>] [--plugins-path <dir> …]
```

| Option | Type | Required | Default | Description |
| -------- | ------ | ---------- | --------- | ------------- |
| `--content <file>` | string | yes | — | `Content` JSON to publish |
| `--target <plugin>` | string (repeatable) | yes (≥1)\* | — | Publish plugin name per target |
| `--out <file>` | string | yes | — | Aggregate `Result` JSON path |
| `--retry-from <file>` | string | no | — | Prior `Result`; published/skipped targets carried as `skipped` (url/id preserved), only prior failures re-dispatched |
| `--plugins-root <dir>` | string | no | — | Exclusive single-root scan (isolation/tests only; no union with defaults) |
| `--plugins-path <dir>` | string[] | no | — | Extra plugin root to union with the default roots (repeatable; tree, kind collection, or single `plugin.json` dir) |

\* `--target` is required unless `--retry-from` supplies the retry set; explicit `--target` values
then narrow the dispatch to the still-unpublished subset.

**Behavior:** validate `--content` against `ContentSchema` and every target against the publish
registry (default merged discovery via `discoverAllPlugins`; malformed flags, invalid content, an
unresolvable target, or combined `--plugins-root`/`--plugins-path` exits `2`) → dispatch targets
sequentially, one `TargetOutcome` per target → write the aggregate `{ ok, summary: { total,
succeeded, failed, skipped }, targets }` (spec §3.1) to `--out`.

**Exit-code contract:**

| Outcome | Exit | Aggregate `Result` |
| --------- | ------ | -------------------- |
| All targets published | `0` | every dispatched entry `published` (carried retry entries `skipped`) |
| Some published, some failed | `1` | mixed entries; successes retain `published` |
| All targets failed | `1` | every entry `failed` |
| CLI / input error (malformed flags, invalid `--content`, unresolvable target, `--out` write failure) | `2` | nothing written to `--out` |

Partial success is **not** exit 0 — the run fails loud (ADR-007 R5), while successful targets stay
published and are individually re-runnable via `--retry-from` (spec §5).

## 1.7 `plugin.json` manifest surface

Product plugins live under kind collections (ADR-009):

| Collection | `kind` | Example |
| ------------ | -------- | --------- |
| `plugins/ingestions/<name>/` | `ingestion` | `plugins/ingestions/karakeep-local` |
| `plugins/generations/<name>/` | `generator` | `plugins/generations/content-gen` |
| `plugins/publishings/<name>/` | `publish` | `plugins/publishings/surfdash-pub` |

Default runtime discovery is a **merged multi-root scan** (ADR-012): the package-shipped built-in
tree, `~/.kk/plugins` (when present), CWD `./plugins` (when present and not the built-in realpath),
`KK_PLUGIN_PATH` entries, and repeatable `--plugins-path` dirs — low→high priority, a later root
shadowing an earlier `name` (with a `shadowed` diagnostic). `--plugins-root` is the exclusive
single-root override (isolation/tests only) and stays the same scan the old default `./plugins`
performed. Passing a collection directory itself is also valid as a root. `plugins/kk` is the
Claude Code capability plugin and is never discovered as a kk-core plugin.

Every product plugin directory carries a `plugin.json`. Schema:
`PluginManifestSchema` (`packages/kk-core/src/manifest.ts`), `.passthrough()` — unknown keys are
preserved, not rejected.

| Field | Type | Required | Status | Description |
| ------- | ------ | ---------- | -------- | ------------- |
| `name` | string (min 1) | yes | shipped | Unique plugin name; the argument to `kk executor run` |
| `kind` | `ingestion` \| `generator` \| `publish` | yes | shipped | Selects the I/O data contract via `kindContract(kind)` |
| `entry` | string (min 1) | yes | shipped | Relative path to the executable entry the invoker spawns |
| `version` | string | no | shipped | Informational |
| `description` | string | no | shipped | Informational |
| `accepts` | `('brief' \| 'docs')[]` | no | **specified — not implemented** (D) | Generator-only. Declares which input shapes the plugin handles; defaults to both when absent. Lets a mismatch fail at **resolve time** rather than inside the plugin |

**Resolve-time validation (shipped).** `kk executor run` resolves the manifest, selects the contract with
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

Product file: `$KK_CONFIG` (default `~/.config/kk/config.yaml`). Spur harness config stays under
`.spur/config.yaml`.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `works_dir` | string | `$HOME/.config/kk/works` | C4 topic workspace root (`KK_WORKS_DIR` wins) |
| `workflows_dir` | string | `$HOME/.config/kk/workflows` | Installed workflow YAML dest (`KK_WORKFLOWS_DIR` wins) |
| `defaults.maxResults` | int | `8` | STORM ingest cap |
| `defaults.fixture` | bool | `false` | STORM live vs fixture |
| `plugins.<collection>.<name>.env` | map of scalars | — | Injected into that plugin's process env at `spawnPluginEntry`. Real env vars win (`flag > env > config > compiled default`). Collection names: `ingestions` / `generations` / `publishings`. Missing file or missing key → no extra env. Empty-string values are skipped. |

## 3. Environment variables

| Var | Required | Description |
| ----- | ---------- | ------------- |
| `NODE_ENV` | no | Set to `test` by workspace test scripts |
| `POSTSURFING_BIN` | no (surfdash-pub) | Path to the `postsurfing` binary the Surfdash transport invokes (default: on PATH) |
| `ZENN_REPO` | yes (zenn-pub) | Zenn/GitHub repository path the Zenn transport publishes into (`npx zenn` + `git add/commit/push`) |
| `QIITA_TOKEN` | yes (qiita-pub) | Qiita API v2 token; sent as `Authorization: Bearer <token>` on `POST /api/v2/items` |
| `KNOWLEDGE_KIT_PUBLISH_TRANSPORT` | no | `fake` selects `FakeFileCliTransport` instead of the real transport — the offline harness switch, identical across `surfdash-pub` / `zenn-pub` / `qiita-pub` |
| `KK_PLUGIN_PATH` | no | Colon-separated extra plugin roots to union with the default discovery roots (ADR-012); overridden by `--plugins-root` |
| `KK_CONFIG` | no | Path to the operator YAML (`works_dir`, workflow defaults, `plugins.<collection>.<name>.env`). Default: `~/.config/kk/config.yaml` |
| `FIRECRAWL_API_KEY` | yes (web-search live) | Bearer token for the live Firecrawl client (task 0057; selected when `fixture` is absent/false) — unset → exit 1, no `--out` (fail loud) |
| `VOICEBOX_URL` | no (voice-gen) | Origin for Voicebox REST API (default: `http://127.0.0.1:17493`) |
| `VOICEBOX_DEFAULT_PROFILE` | no (voice-gen) | Default profile name/ID when segment/doc omits profile |
| `VOICEBOX_TIMEOUT_MS` | no (voice-gen) | Poll timeout per generation in ms (default: `600000`) |
| `VOICEBOX_POLL_MS` | no (voice-gen) | Poll interval in ms (default: `1000`) |
| `VOICEBOX_MAX_CHUNK_CHARS` | no (voice-gen) | Max chunk characters (default: `800`, range 100–5000) |
| `VOICEBOX_CROSSFADE_MS` | no (voice-gen) | Crossfade duration in ms (default: `50`, range 0–500) |

## 4. Public package surface

### `@gobing-ai/kk-core` (`packages/kk-core`)

| Export | Kind | Notes |
| -------- | ------ | ------- |
| `DocSchema`, `ContentSchema`, `ResultSchema`, `DocListSchema` | Zod schemas | Pure data contract schemas |
| `BriefSchema`, `GeneratorInputSchema` | Zod schemas | **Specified, not implemented** (ADR-007 R3; feature D) |
| `Doc`, `Content`, `Result` | types | Inferred TypeScript types |
| `Brief`, `GeneratorInput` | types | **Specified, not implemented** (ADR-007 R3; feature D) |
| `PLUGIN_KINDS`, `PluginKind`, `PluginKindSchema` | constants & schema | Supported plugin lifecycle kinds |
| `PLUGIN_KIND_COLLECTIONS`, `PLUGIN_COLLECTION_KINDS`, `KK_CAPABILITY_COLLECTION` | constants | ADR-009 collection folder map |
| `collectionForKind(kind)`, `kindForCollection(name)` | functions | Kind ↔ collection directory |
| `kindContract(kind)` | function | Resolves I/O contract per plugin kind |
| `PluginManifestSchema`, `parsePluginManifest`, `PluginManifest` | schema & type | Validation for `plugin.json` manifests |
| `discoverPlugins(root)`, `discoverAllPlugins(opts)`, `resolvePluginRoots(opts)`, `listByKind`, `getByName` | functions | Per-root scan, merged multi-root discovery, root resolution, and registry filtering (ADR-012) |
| `PluginRecord`, `PluginOrigin`, `DiscoverAllOptions`, `DiscoveryDiagnostic`, `DiscoveryResult` | interfaces | Structured discovery output types (`misplaced`, `kind_mismatch`, `shadowed` codes; `origin` on every record) |
| `renderContentMarkdown(content)`, `renderContentMarkdownFile(in, out)`, `main()` | functions | Content → research-report markdown (frozen template) + `--in`/`--out` file/CLI wrapper (task 0058). **C5 (ADR-013):** drops the `## Outline` replay (applied to the byte-identical `plugins/kk/scripts/render-md.ts` copy too); references tail resolves cite ids to cached files |

### `@gobing-ai/publish-harness` (`packages/publish-harness`)

| Export | Kind | Notes |
| -------- | ------ | ------- |
| `PublishTransport` | interface | `{ kind: 'file-cli' \| 'browser', publish(payload): Promise<Result> }` (ADR-008) |
| `PublishTransportPayload` | interface | `{ content: Content, options?: Record<string, unknown> }` |
| `FakeFileCliTransport` | class | Offline fake for unit tests; `setNextResult`, records call log |

### `@gobing-ai/surfdash-pub` (`plugins/publishings/surfdash-pub`, kind `publish`)

| Export | Kind | Notes |
| -------- | ------ | ------- |
| `PostsurfingFileCliTransport` | class | `file-cli` transport: `postsurfing` CLI child process; requires `POSTSURFING_BIN` (default: on PATH) |
| `mapContentToSurfingMarkdown(content)` | function | Renders Surfdash markdown + frontmatter (title, description, tags, date, canonical_url, published) |
| `processPublishIO(inputPath, outputPath, transport?)` | function | `--in`/`--out` IO per the publish spec §1 |
| `main()` | function | `--in`/`--out` arg parsing; exit 0 success / 1 failure |

### `@gobing-ai/zenn-pub` (`plugins/publishings/zenn-pub`, kind `publish`)

| Export | Kind | Notes |
| -------- | ------ | ------- |
| `ZennCliFileCliTransport` | class | `file-cli` transport: `npx --yes zenn new:article` + `articles/<slug>.md` write + git push; requires `ZENN_REPO` |
| `mapContentToZennMarkdown(content)` | function | Renders Zenn frontmatter (title, type, emoji, topics, published, slug) + body |
| `processPublishIO(inputPath, outputPath, transport?)` | function | `--in`/`--out` IO per the publish spec §1; writes fail-loud `Result` |
| `main()` | function | `--in`/`--out` arg parsing; exit 0 success / 1 failure |

### `@gobing-ai/qiita-pub` (`plugins/publishings/qiita-pub`, kind `publish`)

| Export | Kind | Notes |
| -------- | ------ | ------- |
| `QiitaApiTransport` | class | `file-cli` transport: `POST /api/v2/items` via `fetch` with Bearer token; requires `QIITA_TOKEN` |
| `mapContentToQiitaMarkdown(content)` | function | Renders Qiita frontmatter (title, block-style tags, private) + body |
| `processPublishIO(inputPath, outputPath, transport?)` | function | `--in`/`--out` IO per the publish spec §1; writes fail-loud `Result` |
| `main()` | function | `--in`/`--out` arg parsing; exit 0 success / 1 failure |

### `@gobing-ai/web-search` (`plugins/ingestions/web-search`, kind `ingestion`)

| Export | Kind | Notes |
| -------- | ------ | ------- |
| `buildFixtureDocs(topic, maxResults)` | function | Canned `Doc[]` from fixture entries; `id` = sha256(`sourceUri`) hex prefix — deterministic per ingestion spec §2.3 |
| `parseInput(raw)` | function | Validates `--in` JSON per the 0054 contract; throws on invalid JSON / missing or blank `topic` / non-positive `maxResults` |
| `searchFirecrawl(input, deps)` | async function | Live Firecrawl `POST /v2/search` → `Doc[]` (task 0057, feature C4); throws fail-loud diagnostics — missing key / transport error / non-200 / malformed body / hits-but-no-usable-markdown. **C5 (ADR-013):** live path scrapes via `/v2/scrape` → `markitdown` → `references/<doc-id>.md` cache → normalized body; per-URL scrape failure warns and keeps the snippet body; existing cache file is reused |
| `scrapeAndCacheDocs(docs, deps, outPath)` | async function | Scrape → `markitdown` → `references/<doc-id>.md` cache → normalized body per Doc (C5, ADR-013); cache hit reuses the file without a new scrape; per-URL failure warns and keeps the snippet body |
| `FetchLike`, `SearchDeps`, `MarkitdownRunner` | type & interface | Injectable live-path dependencies — fetch signature, env, clock, scrape runner, markitdown runner — tests never hit the network or the real binary |
| `computeId(uri)` | function | sha256(`sourceUri`) 16-hex `Doc` id; exported so workflow local-Doc mapping stays consistent (0059) |
| `main()` | function | `--in`/`--out` IO per the ingestion spec §2; exit 0 success / 1 failure |

`--in` JSON (API source, ingestion spec §2.2): `{ "topic": string (required), "maxResults": int (default 8), "fixture": boolean }`. `fixture: true` selects the offline stub; absent/false runs the **live Firecrawl client** (task 0057, feature C4): requires `FIRECRAWL_API_KEY` (§3), zero hits writes `[]` exit 0, any failure exits 1 with no `--out` (fail loud). **C5 (ADR-013):** live mode additionally requires the `markitdown` binary on PATH (missing → exit 1 naming it); writes `references/` under the `--out` directory; `fixture: true` needs neither.

### `@gobing-ai/voice-gen` (`plugins/generations/voice-gen`, kind `generator`)

| Export | Kind | Notes |
| -------- | ------ | ------- |
| `processGeneratorIO(in, out, client?)` | function | Read Doc[], generate Voicebox audio Content, write out JSON + sibling WAV (D5) |
| `parseDocToVoiceScript(doc, envDefaultProfile?)` | function | Parse plain text or VoiceScript structure from Doc |
| `mergeVoiceScripts(scripts, docs, envDefaultProfile?)` | function | Merge multiple scripts into combined VoiceScript |
| `validateVoiceScript(script)` | function | Validate VoiceScript text/instruct caps, engine/language enums, and structure |
| `concatWavs(wavs, gapsMs?)` | function | Concat RIFF WAV buffers with optional gap silence |
| `createVoiceboxClient(opts?)` | function | Client factory for local Voicebox REST API |
| `main()` | function | CLI `--in`/`--out` entry point; exit 0 success / 1 failure |

### `@gobing-ai/knowledge-kit` (`apps/cli`)

| Export | Kind | Notes |
| -------- | ------ | ------- |
| `createProgram()` | function | Side-effect-free Commander factory |
| `runInvoke(opts)` | function | Invoke execution & contract validation engine |
| `bin: kk` (alias `knowledge-kit`) | binary | `dist/index.js` — Bun-target bundle staged by `prepack` (ADR-010) |

## 5. Spur project config (harness)

File: `.spur/config.yaml`

| Key | Value |
| ----- | -------- |
| `name` | `knowledge-kit` |
| `bootstrap.database.driver` | `bun-sqlite` |
| `bootstrap.database.url` | `.spur/spur.db` |

## 6. Design specifications

| Specification | Path | Description |
| --------------- | ------ | ------------- |
| Ingestion Plugin Specification | `docs/design/ingestion-plugin-specification.md` | Generic plugin authoring contract + Ingestion Plugin specification |
| Generator Plugin Specification | `docs/design/generator-plugin-specification.md` | Generator-kind authoring contract: Doc[]→Content mapping, owned STORM engine (D4), failure semantics |
| Publish Plugin Specification | `docs/design/publish-plugin-specification.md` | Publish-kind authoring contract: transport abstraction, Content→frontmatter mapping, Result conventions, generic §1 citation |
| Fan-In / Fan-Out Specification | `docs/design/fan-in-and-fan-out-specification.md` | `kk executor fan-in` / `kk executor fan-out` CLI surface, merge + dedupe semantics, aggregate partial-success `Result`, exit codes, `--retry-from` (task 0033) |
| kk product CLI surface | `docs/design/kk-cli-surface.md` | Operator binary `kk`, two-noun tree `executor` + `plugin` (A21 / ADR-011 **shipped** 2026-08-12); A2 bin/help/register tree **shipped** 2026-08-12 |
| STORM evidence cache | `docs/design/storm-evidence-cache.md` | `references/` cache in the 0056 layout, Firecrawl `/v2/scrape` → `markitdown` → body, digest-don't-index report contract (C5 / ADR-013 **shipped** 2026-08-16) |
| ITC generating skill | `docs/design/itc-generating.md` | Fat agent skill `itc-generating` + four distilled references, generic craft & platform playbooks (F3 **shipped** 2026-08-19) |
| Voice generator | `docs/design/voice-gen.md` | Voice generator plugin over local Voicebox REST API (D5 **shipped** 2026-08-19) |
| Solo-podcast workflow | `docs/design/kk-solo-podcast.md` | Product state-machine over voice-gen: HITL outline + VoiceScript + WAV (F5 **shipped** 2026-08-20) |

## 7. Workflow install copy-rule and `/workflow-run` surface

Product workflows are authored under `plugins/kk/workflows/` (ADR-009 amendment — **design-time
SSOT**, packed in the npm tarball's `plugins/`). `/workflow-run` installs the YAML into
`~/.config/kk/workflows/$NAME.yaml` (**runtime dest**; `KK_WORKFLOWS_DIR` wins). Operators and
workflow shells always run that dest — never the package path, and never `docs/design/` (docs are
not in the tarball). Sidecars the machine executes (e.g. `validate-voicescript.ts` for
`kk-solo-podcast`) are copied beside the dest YAML.

### 7.1 Two-root copy rule

| Root priority | Path | Notes |
| ------------- | ---- | ----- |
| 1 | `$KK_WORKFLOWS_SOURCE/$NAME.yaml` | User/environment override root |
| 2 | `plugins/kk/workflows/$NAME.yaml` | Package/repo product workflow root |

**Resolution semantics:**
- `dest` missing → copy from the first hit.
- `dest` exists + `--force` → overwrite from source.
- `dest` exists + identical bytes → no-op.
- `dest` exists + different bytes → warn and leave (proceed with user copy).
- Source missing from both roots → exit 1 with stderr: `no source workflow for $NAME (searched KK_WORKFLOWS_SOURCE, plugins/kk/workflows)`.

### 7.2 `/workflow-run` command surface

```text
/workflow-run [name] <topic|--in file> [--dir <path>] [--playbook generic|english|wechat]
             [--research] [--judge] [--outline <a|b|c>] [--writer itc-generating|topic]
             [--duration <min>] [--language <code>] [--script-approved]
             [--fixture] [--force]
```

| Profile | Target workflow | Workspace layout | Report artifacts |
| ------- | --------------- | ---------------- | ---------------- |
| `kk-storm-research` (default) | `kk-storm-research.yaml` | `$works_dir/<topic-id>` (0056 hash) | `$work_dir/content.md`, `$work_dir/content.json` |
| `kk-itc` | `kk-itc.yaml` | `./<kebab>` (topic authoring) | `$work_dir/brief.md`, `$work_dir/2-outline/outline-approved.md`, `$work_dir/3-draft/draft-article.md` |
| `kk-solo-podcast` | `kk-solo-podcast.yaml` + `validate-voicescript.ts` | `$works_dir/<kebab>` | `$work_dir/3-script/voicescript.yaml`, `$work_dir/4-audio/content.json`, `$work_dir/4-audio/content.wav` |

