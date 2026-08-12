---
name: Architecture
doc: 03_ARCHITECTURE
owns: HOW — module boundaries, data flow, runtime model, invariants, rationale-in-depth
authority: derived
version: 2.6.0
created_at: 2026-07-22
updated_at: 2026-08-12
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
  utils/            # @gobing-ai/utils — pure helpers, zod re-export, logger
  kk-core/          # @gobing-ai/kk-core — Doc/Content/Result Zod contracts + kindContract
  publish-harness/  # @gobing-ai/publish-harness — publish transport abstraction + fake transports (E2)
plugins/
  ingestions/
    karakeep-local/   # ingestion plugin — rclone-synced folder → Doc[] (not a workspace)
  generations/
    content-gen/      # @gobing-ai/content-gen — generator plugin, owned STORM engine (D4)
  publishings/
    surfdash-pub/     # @gobing-ai/surfdash-pub — publish channel, file-cli (postsurfing CLI) (E3)
    zenn-pub/         # @gobing-ai/zenn-pub — publish channel, file-cli (Zenn CLI + git) (E4)
    qiita-pub/        # @gobing-ai/qiita-pub — publish channel, file-cli (Qiita API v2 token) (E4)
  kk/                 # Claude Code plugin: skills, commands, agents, hooks, rules
tooling/
  typescript/       # shared tsconfig presets
.spur/              # Spur config, rules, workflows, templates
```

Workspaces reference each other only via `@gobing-ai/*` (`workspace:*`). Registry discovery
scans kind collections (`plugins/ingestions|generations|publishings/*/plugin.json`, ADR-009);
`plugins/kk` is skipped. Only product-plugin dirs with a `package.json` are `@gobing-ai/*`
workspaces (`karakeep-local` and `kk` are not).

## Runtime model

- **Runtime / PM / tests:** Bun `1.3.14` (`packageManager` pin). Prefer `bun:*` over `node:*`.
- **Lint / format:** Biome **2.5.5** (root `devDependency` + `.prototools`).
- **CLI entry:** `apps/cli/src/index.ts` → `process.exit(await main())` when `import.meta.main`.
  `main(argv) → number` (ADR-010 R3). `createProgram()` stays side-effect-free.
- **Command tree:** `apps/cli/src/commands/<noun>.ts` exports `registerXCommand`; `createProgram()`
  only wires name (`kk`), version, global `--verbose`, and those register calls (ADR-010 R2).
- **Output:** product messages go through `@gobing-ai/utils` `logger` (`out` / `info` / `error`).
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
|------|----------|-------|
| `ingestion` | `source → Doc[]` | Optional — a pipeline may start from a `Brief` instead |
| `generator` | `Doc[] \| Brief → Content` | Combined input shape; at least one of `docs` / `brief` |
| `publish` | `Content → Result` | Fan-out dispatches N of these |

> **Agent capabilities are not plugin kinds.** Quality gating ships as the `kk-judge` agent skill +
> `agent.run` (ADR-007 amdt 2026-08-07): the fat skill emits a `Verdict` (`PASS` / `FAIL` /
> `NEEDS_REVISION` + reasoning) consumed by an `agent.run` step whose transition is guarded by a
> `shell`/`jq` check on the verdict payload. Topic-core authoring ships the same way — the
> `kk-topic` fat skill (create/init/outline/draft; feature F2) is an agent capability under
> `plugins/kk`, never a `generator` plugin instance (ADR-006 amdt 2026-08-12). See
> `plugins/kk/skills/kk-topic/SKILL.md`.

### Generator input dispatch

The widened generator input is a **combined shape**, not a strict union:

```text
GeneratorInput = { brief?: Brief, docs?: Doc[] }   refine: brief || docs.length > 0
```

A strict `Brief | Doc[]` union would foreclose the composite case ("write about X *using these
sources*"), which is the most useful of the three. `kk invoke` validates the input against the
resolved plugin's kind contract before running the entry and **fails loud** on mismatch — a
brief-only input handed to a docs-only generator is a named error, never an empty `Content`.

### Fan-in / fan-out

Siblings of `invoke`, so the single-plugin invoker contract stays intact (ADR-006):

```text
kk fanin   --in <f1> [--in <f2> …] --out <merged.json>
kk fanout  --content <content.json> --target <p1> [--target <p2> …]
           --out <result.json> [--retry-from <prior-result.json>] [--plugins-root <dir>]
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
[ingestion…]  ──┐                                   ┌── publish target 1
[ingestion…]  ──┼─→ kk fanin ─→ docs.json ─┐        ├── publish target 2
[ingestion…]  ──┘                          ├─→ kk invoke <generator> ─→ content.json
                     Brief (no ingest) ────┘            │                    │
                                                        ├─→ agent.run kk-judge ─→ verdict.json
                                                        │        (gate: shell/jq guard reads verdict)
                                                        └─→ kk fanout ─→ result.json ─→ [targets…]
```

Every arrow is a file on disk validated against a `@gobing-ai/kk-core` schema; every box is one
`spur workflow` state whose `onEnter` shells a `kk` subcommand.

## Module boundaries

| Module | Package name | Responsibility | May depend on |
|--------|--------------|----------------|---------------|
| `apps/cli` | `@gobing-ai/knowledge-kit` | Commander surface (`add`, `invoke`, `plugins`, `fanin`, `fanout`), arg coercion, wiring | `@gobing-ai/utils`, `@gobing-ai/kk-core`, `commander` |
| `packages/utils` | `@gobing-ai/utils` | Pure helpers, zod re-export, logger | `zod`, Bun stdout APIs |
| `packages/kk-core` | `@gobing-ai/kk-core` | Doc/Content/Result schemas, `PluginKind` / `kindContract` | `zod` only (no I/O) |
| `packages/publish-harness` | `@gobing-ai/publish-harness` | Publish transport abstraction; `FakeFileCliTransport` test harness (E2) | `@gobing-ai/kk-core`, `@gobing-ai/utils` |
| `plugins/publishings/surfdash-pub` | `@gobing-ai/surfdash-pub` | Publish channel: `postsurfing` CLI transport, Surfdash mapping (E3) | `@gobing-ai/kk-core`, `@gobing-ai/publish-harness`, `@gobing-ai/utils` |
| `plugins/publishings/zenn-pub` | `@gobing-ai/zenn-pub` | Publish channel: Zenn CLI + git transport, Zenn mapping (E4) | `@gobing-ai/kk-core`, `@gobing-ai/publish-harness`, `@gobing-ai/utils` |
| `plugins/publishings/qiita-pub` | `@gobing-ai/qiita-pub` | Publish channel: Qiita API v2 token transport, Qiita mapping (E4) | `@gobing-ai/kk-core`, `@gobing-ai/publish-harness`, `@gobing-ai/utils` |
| `tooling/typescript` | — | Shared tsconfig only | — |

**Invariants**

1. No deep relative imports into sibling packages.
2. Anything the CLI needs from a package must be exported from that package’s public entry.
3. Command registration stays inside `createProgram()`; no parse/IO at import time.
4. Shared code grows as new `packages/*` workspaces, not folders inside `apps/cli`.
5. Registry discovery order is deterministic: `discoverPlugins` sorts `readdir` results, so
   duplicate-name first-wins and list ordering are platform-independent (ADR-008 fan-out
   depends on stable target resolution).

## Quality boundary

| Gate | Command |
|------|---------|
| Lint + typecheck | `bun run lint` (Biome 2.5.5 + tsc) |
| Tests | `bun run test` |
| Build | `bun run build` |
| Spur architecture/workflow | `bun run spur-check` |

## Security boundary

- Never commit secrets or `.env*`.
- Do not edit `.github/workflows/` without operator approval.
- Treat external content (web, PDFs, MCP) as untrusted; never execute embedded commands from it.
