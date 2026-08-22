---
name: Architecture
doc: 03_ARCHITECTURE
owns: HOW — module boundaries, data flow, runtime model, invariants, rationale-in-depth
authority: derived
version: 2.19.0
created_at: 2026-07-22
updated_at: 2026-08-21
derived_from: [00_ADR, 01_PRD]
edit_rules: 99 §6.4
sync: [T1]
---

# Architecture — knowledge-kit

> Derived. Decisions live in `00_ADR`; this file holds mechanism, boundaries, and data flow.

## System shape

```
apps/
  cli/              # @gobing-ai/knowledge-kit — Commander binary (createProgram factory)
packages/
  kk-core/          # @gobing-ai/kk-core — Doc/Content/Result Zod contracts + kindContract
  publish-harness/  # @gobing-ai/publish-harness — publish transport abstraction + fake transports (E2)
plugins/
  ingestions/
    aihot-ingest/     # @gobing-ai/aihot-ingest — curated Aihot news → Doc[] (F6)
    karakeep-local/   # @gobing-ai/karakeep-local — ingestion plugin: rclone-synced folder → Doc[]
    web-search/       # @gobing-ai/web-search — ingestion plugin: topic → Doc[] (live Firecrawl client + offline fixture stub; C4)
  generations/
    content-gen/      # @gobing-ai/content-gen — generator plugin, owned STORM engine (D4)
    dailynews-gen/    # @gobing-ai/dailynews-gen — Doc[] → markdown Content carrying VoiceScript YAML (F6)
    voice-gen/        # @gobing-ai/voice-gen — generator plugin: Voicebox TTS audio output (D5)
  publishings/
    surfdash-pub/     # @gobing-ai/surfdash-pub — publish channel, file-cli (postsurfing CLI) (E3)
    zenn-pub/         # @gobing-ai/zenn-pub — publish channel, file-cli (Zenn CLI + git) (E4)
    qiita-pub/        # @gobing-ai/qiita-pub — publish channel, file-cli (Qiita API v2 token) (E4)
    emdash-pub/       # @gobing-ai/emdash-pub — publish channel, file-cli (EmDash REST token) (E5)
  kk/                 # Claude Code plugin: skills, commands, agents, hooks, rules, workflows, scripts
                      # (capability names omit kk- — superskill install prefixes kk:)
tooling/
  typescript/       # shared tsconfig presets
.spur/              # Spur config, rules, workflows, templates
```

Workspaces reference each other only via `@gobing-ai/*` (`workspace:*`). Per-root registry
discovery scans kind collections (`plugins/ingestions|generations|publishings/*/plugin.json`,
ADR-009); `plugins/kk` is skipped. Default runtime discovery is a **multi-root merge**
(ADR-012 — see Multi-root discovery below). Product-plugin dirs with a `package.json` are
`@gobing-ai/*` workspaces; `plugins/kk` is not.

## Runtime model

- **Runtime / PM / tests:** Bun `1.3.14` (`packageManager` pin). Prefer `bun:*` over `node:*`.
- **Lint / format:** Biome **2.5.5** (root `devDependency` + `.prototools`).
- **CLI entry:** `apps/cli/src/index.ts` → `process.exit(await main())` when `import.meta.main`.
  `main(argv) → number` (ADR-010 R3). `createProgram()` stays side-effect-free.
- **Command tree:** `apps/cli/src/commands/<noun>.ts` exports `registerXCommand`; `createProgram()`
  only wires name (`kk`), version, global `--verbose`, and those register calls (ADR-010 R2).
- **Output:** product messages go through the ts-utils seam (`echo` / `echoError`, adapted by
  `apps/cli/src/output.ts`); structured diagnostics use ts-infra (`initializeLogger` once per
  diagnostic-emitting process, `getLogger` at call sites) (ADR-015).
  `--verbose` gates extra `info`; it must not interleave into `--json` payloads.

## Data flow (command path)

```text
argv
  → main(argv)
  → createProgram().parseAsync(argv)
  → registerXCommand action
  → @gobing-ai/* pure logic
  → logger.out / logger.info / logger.error
  → stdout / stderr
  → main returns exit code
```

## Pipeline model

> Mechanism for ADR-007. `kk` owns **steps**; `spur workflow` owns **orchestration**. The two never
> trade places: no DAG runtime inside `kk`, no domain logic inside a workflow YAML.

### Execution substrate — sequential by design

`spur workflow` runs on `@gobing-ai/ts-dual-workflow-engine`, which executes **one node at a time**.
The `transition-flow` schema declares a node `type` of `action | gate | parallel | decision`, but no
executor reads that field — verified at `0.4.14`: `parallel` occurs only in `src/types.ts:77`,
`src/schema.ts:100`, and `schemas/transition-flow-workflow.schema.json:38`, and `src/service.ts:24`
documents deliberate per-run serialization. **Authoring a `parallel` node does not fan out.**

Consequently fan-in and fan-out are `kk`'s responsibility, expressed as ordinary sequential steps
(ADR-007 R4). Engine-level concurrency is deferred, not rejected.

### Plugin kinds

Three kinds, discovered under the matching kind collection (ADR-009; ADR-007 amdt 2026-08-07
supersedes the 2026-08-02 fourth-kind amendment):

| Kind | Contract | Notes |
| ------ | ---------- | ------- |
| `ingestion` | `source → Doc[]` | Optional — a pipeline may start from a `Brief` instead |
| `generator` | `Doc[] \| Brief → Content` | Combined input shape; at least one of `docs` / `brief` |
| `publish` | `Content → Result` | Fan-out dispatches N of these |

> **Agent capabilities are not plugin kinds.** Quality gating ships as the `content-judge`
> agent skill + `agent.run` (ADR-007 amdt 2026-08-07, rename 2026-08-19): the fat skill emits
> a `Verdict` (`PASS` / `FAIL` / `NEEDS_REVISION` + reasoning) consumed by an `agent.run` step
> whose transition is guarded by a `shell`/`jq` check on the verdict payload. Topic-core
> authoring ships the same way — the `topic` fat skill (create/init/outline/draft; feature F2)
> is an agent capability under `plugins/kk`, never a `generator` plugin instance (ADR-006
> amdt 2026-08-12). See `plugins/kk/skills/topic/SKILL.md`. IT-writing craft ships the same
> way — the `itc-generating` fat skill (feature F3) distills the four works-dir studies and
> orchestrates `topic` / `storm-research` / optional `content-judge`; it is not a generator
> plugin and adds no slash command or `kk` noun (ADR-011). See
> `docs/design/itc-generating.md`. Capability names omit a leading `kk-` so
> `superskill install kk` yields `kk:content-judge` / `kk:topic` / `kk:itc-generating` /
> `/kk:workflow-run` (ADR-009 amdt 2026-08-14 / 2026-08-19).

### Generator input dispatch

The widened generator input is a **combined shape**, not a strict union:

```text
GeneratorInput = { brief?: Brief, docs?: Doc[] }   refine: brief || docs.length > 0
```

A strict `Brief | Doc[]` union would foreclose the composite case ("write about X *using these
sources*"), which is the most useful of the three. `kk executor run` validates the input against
the resolved plugin's kind contract before running the entry and **fails loud** on mismatch — a
brief-only input handed to a docs-only generator is a named error, never an empty `Content`.

### Fan-in / fan-out

Siblings of `executor run`, so the single-plugin invoker contract stays intact (ADR-006):

```text
kk executor fan-in  --in <f1> [--in <f2> …] --out <merged.json>
kk executor fan-out --content <content.json> --target <p1> [--target <p2> …]
                    --out <result.json> [--retry-from <prior-result.json>]
                    [--plugins-root <dir>] [--plugins-path <dir> …]
```

- **Fan-in (N→1):** merge `Doc[]` sets; dedupe on primary `id` (first-seen wins); provenance
  retained in `metadata.sources`; stable ordering. Spec §1.2's `--dedupe` flag is deferred — id
  dedupe is the only rule (task 0042).
- **Fan-out (1→N):** dispatch `Content` to N publishers **in sequence**; emit one aggregate `Result`
  with a per-target entry (`published | failed | skipped`) plus summary counters.
- **Partial success:** successful targets stay published and are individually re-runnable via
  `--retry-from`; the process still exits **non-zero** so the run fails loud (ADR-007 R5). This
  preserves the 0023/0025 hardening — a target that failed is never reported as success — while
  avoiding the all-or-nothing trap where one expired token withholds four healthy publishes.

Full specification: `docs/design/fan-in-and-fan-out-specification.md`.

### Pipeline data flow

```text
[ingestion…]  ──┐                                        ┌── publish target 1
[ingestion…]  ──┼─→ kk executor fan-in ─→ docs.json ─┐   ├── publish target 2
[ingestion…]  ──┘                                    ├─→ kk executor run <generator> ─→ content.json
                     Brief (no ingest) ─────────────┘            │                    │
                                                                 ├─→ agent.run judge ─→ verdict.json
                                                                 │        (gate: shell/jq guard reads verdict)
                                                                 └─→ kk executor fan-out ─→ result.json ─→ [targets…]
```

Every arrow is a file on disk validated against a `@gobing-ai/kk-core` schema; every box is one
`spur workflow` state whose `onEnter` shells a `kk` subcommand.

### Two-layer CLI nouns (shipped — ADR-011, feature A21)

Canonical paths are `kk executor run` / `kk executor fan-in` / `kk executor fan-out` /
`kk plugin status`. Engines and file contracts above are unchanged. Hidden one-release aliases
(`invoke` / `fanin` / `fanout` / `plugins *`) keep the old names working but are not listed in
`kk --help`.

### Output and diagnostics foundation (accepted design — ADR-014/ADR-015; not yet built)

Feature A3 reuses two published ts-libs seams and adds no replacement logging package:

| Candidate | Coupling / locality | Reversibility | Decision |
| --- | --- | --- | --- |
| ts-utils output + ts-infra diagnostics | Existing portfolio contracts; migration stays at call sites and manifests | Catalog pin and imports are reversible | **Chosen** |
| Extend `@gobing-ai/utils` | Smallest immediate diff, but preserves a repository-specific logging fork | Cheap now; continued divergence compounds | Rejected |
| ts-utils output only | Removes the local package, but leaves operational diagnostics unstructured | Cheap to add logging later | Rejected: feature A3 requires a shared logger |

The seams have separate contracts. User-facing command output, usage errors, and preserved plugin
messages flow through ts-utils `echo` / `echoError`. `apps/cli/src/output.ts` adapts those functions
to an injectable `CommandOutput`; product plugins and repository scripts import ts-utils directly
rather than depending on the CLI app. Operational diagnostics flow through ts-infra `getLogger`.
No module writes directly through `console.*` or `process.stdout` / `process.stderr`.

LogTape configuration is process-local. The `kk` process and each directly executable plugin or
script that emits diagnostics call `initializeLogger` exactly once before dispatch; call sites only
obtain category loggers and never install sinks. Test processes call `setLoggerMuted(true)`. Plugin
console logging starts at `warn`, keeping structured records on stderr and leaving stdout available
for command output; plugin result contracts remain file-based through `--out`.

```text
kk process:      argv → initializeLogger once → command → CommandOutput → echo / echoError
plugin process:  spawn → initializeLogger once → plugin ┬→ result file (`--out`)
                                                    ├→ echo / echoError (operator contract)
                                                    └→ getLogger(category) (diagnostics)
```

The root catalog constrains all four ts-libs packages, but feature A3 creates dependency edges only
to ts-utils and ts-infra. `ts-runtime` does not replace the existing `Bun.spawnSync` seam in this
feature, and `ts-db` has no persistence consumer. Either adoption requires separate evidence and a
later decision.

`packages/utils` was removed in A3 (0067) once source imports and stale manifest dependencies hit
zero. Its logger was replaced by the two seams; its unconsumed `add`, `z`, and `ZodType` exports
were deleted, not relocated. The `output-boundaries` rule expands to production plugin sources and kk scripts;
tests and fixtures remain excluded. Full shapes: `docs/design/ts-libs-logging-foundation.md`.

### Evidence cache and report digestion (ADR-013)

Feature C5. The live `web-search` ingest path (0057) has a scrape → normalize → cache
stage between search and `docs.json` write:

```text
web-search live path (C5)
  /v2/search ──→ Doc[] (snippet bodies, 0057)
       │ per Doc with usable sourceUri:
       ▼
  /v2/scrape (formats: ["markdown"]) ─→ markitdown (PATH binary) ─→ references/<doc-id>.md
       │  failure or unusable content: warn, keep snippet body, continue
       ▼
  docs.json body = normalized cached content (Doc[] shape unchanged — ADR-013)
```

- **Owner.** The ingestion plugin (`plugins/ingestions/web-search`) — the component that
  already owns the `Doc[]` contract. No new workflow state, no second component reading
  `docs.json` (rejected: a `fetch-refs` state splits one contract across two owners).
- **`references/` location.** `works/<topic-id>/references/`, derived from the plugin's
  `--out` directory — no new `--in` field, no new env var, no new `kk` noun. Amends the
  frozen 0056 works layout (ADR-013).
- **Cache key.** Doc id = `sha256(sourceUri)` 16-hex. File existence ⇒ reuse, no re-scrape
  (R4); the key is URL-derived, so reuse is independent of the query that produced it.
- **`markitdown`.** Invoked as an external binary (it is one today), availability-checked
  before scraping. Live mode without it on PATH exits 1 naming it and writes no `docs.json`
  (R5). Fixture mode never scrapes and needs neither the key nor the binary (R9).
- **Report digestion.** content-gen's STORM prompt mandates synthesis over one-line listing
  (digest, don't index — R6). Render (`renderContentMarkdown` in `@gobing-ai/kk-core` and
  its byte-identical `plugins/kk/scripts/render-md.ts` copy) drops the `## Outline` replay
  and keeps the compact References list whose cite ids resolve to `references/<id>.md`
  (R7).

Full spec: `docs/design/storm-evidence-cache.md`.

## Module boundaries

| Module | Package name | Responsibility | May depend on |
| -------- | -------------- | ---------------- | --------------- |
| `apps/cli` | `@gobing-ai/knowledge-kit` | Commander surface (`executor`, `plugin`; hidden aliases `invoke`/`fanin`/`fanout`/`plugins *`), arg coercion, wiring | `@gobing-ai/kk-core`, `@gobing-ai/ts-utils`, `@gobing-ai/ts-infra`, `commander` |
| `packages/kk-core` | `@gobing-ai/kk-core` | Doc/Content/Result schemas, `PluginKind` / `kindContract`, filesystem plugin discovery | `zod` + `node:fs` / `node:path` (discovery only) |
| `packages/publish-harness` | `@gobing-ai/publish-harness` | Publish transport abstraction; `FakeFileCliTransport` test harness (E2) | `@gobing-ai/kk-core` |
| `plugins/ingestions/aihot-ingest` | `@gobing-ai/aihot-ingest` | Aihot selected snapshot/changes → attributed `Doc[]`; atomic cursor state (F6) | `@gobing-ai/kk-core`, `@gobing-ai/ts-runtime`, `@gobing-ai/ts-utils`, `zod` |
| `plugins/ingestions/karakeep-local` | `@gobing-ai/karakeep-local` | Ingestion plugin: rclone-synced folder → `Doc[]` | `@gobing-ai/kk-core`, `@gobing-ai/ts-utils`, `@gobing-ai/ts-infra` |
| `plugins/ingestions/web-search` | `@gobing-ai/web-search` | Ingestion plugin: topic `--in` JSON → `Doc[]`; live Firecrawl client (`FIRECRAWL_API_KEY`) + offline fixture stub (0057, C4) | `@gobing-ai/kk-core`, `@gobing-ai/ts-utils`, `@gobing-ai/ts-infra` |
| `plugins/generations/content-gen` | `@gobing-ai/content-gen` | Owned STORM pipeline → markdown `Content` (D4) | `@gobing-ai/kk-core`, `@gobing-ai/ts-runtime`, `@gobing-ai/ts-utils` |
| `plugins/generations/dailynews-gen` | `@gobing-ai/dailynews-gen` | News `Doc[]` → validated VoiceScript YAML in markdown `Content` (F6) | `@gobing-ai/kk-core`, `@gobing-ai/ts-runtime`, `@gobing-ai/ts-utils`, `zod` |
| `plugins/generations/voice-gen` | `@gobing-ai/voice-gen` | VoiceScript/plain-text `Doc[]` → Voicebox WAV/optional MP3 audio `Content` (D5) | `@gobing-ai/kk-core`, `@gobing-ai/ts-runtime`, `@gobing-ai/ts-utils`, `zod` |
| `plugins/publishings/surfdash-pub` | `@gobing-ai/surfdash-pub` | Publish channel: `postsurfing` CLI transport, Surfdash mapping (E3) | `@gobing-ai/kk-core`, `@gobing-ai/publish-harness`, `@gobing-ai/ts-utils` |
| `plugins/publishings/zenn-pub` | `@gobing-ai/zenn-pub` | Publish channel: Zenn CLI + git transport, Zenn mapping (E4) | `@gobing-ai/kk-core`, `@gobing-ai/publish-harness`, `@gobing-ai/ts-utils` |
| `plugins/publishings/qiita-pub` | `@gobing-ai/qiita-pub` | Publish channel: Qiita API v2 token transport, Qiita mapping (E4) | `@gobing-ai/kk-core`, `@gobing-ai/publish-harness`, `@gobing-ai/ts-utils` |
| `plugins/publishings/emdash-pub` | `@gobing-ai/emdash-pub` | Publish channel: EmDash CMS REST token transport, Portable Text mapping (E5) | `@gobing-ai/kk-core`, `@gobing-ai/publish-harness`, `@gobing-ai/ts-utils` |
| `tooling/typescript` | — | Shared tsconfig only | — |

**Invariants**

1. No deep relative imports into sibling packages.
2. Anything the CLI needs from a package must be exported from that package’s public entry.
3. Command registration stays inside `createProgram()`; no parse/IO at import time.
4. Shared code grows as new `packages/*` workspaces, not folders inside `apps/cli`.
5. Per-root discovery order is deterministic: `discoverPlugins` sorts `readdir` results, so
   duplicate-name first-wins and list ordering are platform-independent (ADR-008 fan-out
   depends on stable target resolution). Across roots, ADR-012 priority (later wins) plus a
   `shadowed` diagnostic replaces silent first-wins.

## Multi-root discovery (ADR-012)

`discoverPlugins(root)` remains the ADR-009 per-root scanner. Default CLI discovery calls
`discoverAllPlugins()`:

```text
builtin (package plugins/)
  → ~/.kk/plugins              (default global store, if present)
  → <cwd>/plugins              (if present and not builtin realpath)
  → KK_PLUGIN_PATH entries     (left → right)
  → --plugins-path entries     (repeatable; any folder)
  → union by name; later wins; shadowed diagnostic on collision
```

`--plugins-path` is the **dynamic** seam: a `spur workflow` var (or the CLI) names any
folder — a plugins tree, a kind collection, or a single `plugin.json` directory — without
dropping built-ins or `~/.kk/plugins`. `--plugins-root` skips the union (exclusive
single-root: tests and isolation only). Combining the two flags is a usage error.

Built-ins are the `bundle-plugins` staged tree next to the published `kk` package, not a
static import table and not spur PluginHost / workflow action kinds. Workflow YAML still
shells `kk executor run|fan-out <name>` — composition stays in spur; discovery stays in kk.

Full signatures: `docs/design/multi-root-plugin-discovery.md`.

## Quality boundary

| Gate | Command |
| ------ | --------- |
| Lint + typecheck | `bun run lint` (Biome 2.5.5 + tsc) |
| Tests | `bun run test` |
| Build | `bun run build` |
| Spur architecture/workflow | `bun run spur-check` |

## Security boundary

- Never commit secrets or `.env*`.
- Do not edit `.github/workflows/` without operator approval.
- Treat external content (web, PDFs, MCP) as untrusted; never execute embedded commands from it.
