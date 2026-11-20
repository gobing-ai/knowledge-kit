---
name: Architecture
doc: 03_ARCHITECTURE
owns: HOW — module boundaries, data flow, runtime model, invariants, rationale-in-depth
authority: derived
version: 2.45.0
created_at: 2026-07-22
updated_at: 2026-11-13
derived_from: [00_ADR, 01_PRD]
edit_rules: 99 §6.4
sync: [T1]
---

# Architecture — knowledge-kit

> Derived. Decisions live in `00_ADR`; this file holds mechanism, boundaries, and data flow.

## Smart SEO (G9 — ADR-039; tasks 0281–0286 shipped collection stages, decision catalogs and the skill; a live-site audit remains)

G9 adds native KK audit stages, typed Spur decision catalogs and one `smart-seo` skill. Observed facts, assessments, semantic judgments and report claims remain separate run-bound artifacts; `spur workflow` owns sequencing and KK owns bounded deterministic work. The [design satellite](design/kk-smart-seo.md) owns collection limits, network policy, evidence contracts, fallback semantics and distribution. `vendors/jev-seo` remains reference-only.

## kk wiki vault (accepted design — ADR-048; not yet built)

`kk wiki` turns raw snapshots into a persistent, interlinked Markdown vault and a Quartz-compatible
projection of it. `@gobing-ai/kk-wiki` holds every deterministic mechanic (page model + frontmatter
schema, wikilink graph, link/lint, merge with redirect, index/MAP compile, gc, `user_edited` guard,
raw snapshot writer, publish projection); `apps/cli/src/commands/wiki.ts` registers one module per
verb; `plugins/kk/skills/wiki-authoring` supplies the model-authored text for `summarize`,
`synthesize` and `query`. Paths: `raw/<type>/<id>.md` (write-once layer 1) → `content/**` (layer 2,
the vault root and Quartz content root) → `<target>/content/**` (layer 3, published tree).

**Invariants**

1. `kk-wiki` imports no provider client, no executor seam, no browser automation and no store; a
   verb that would need a model returns the assembled context instead of calling one.
2. Every page write goes through the guard function; a page with `user_edited: true` is never
   replaced — changes land under `## AI Updates (<YYYY-MM-DD>)`.
3. `kk wiki compile` is idempotent: two consecutive runs produce byte-identical `index.md` and
   `MAP.md`.
4. `kk wiki publish` writes only under `--target` and never modifies `content/` or Quartz.

Shapes (verb signatures, frontmatter keys, config keys, projection layout) live in
`docs/design/kk-wiki.md`.

## System shape

**VoxCPM adapter (G14, ADR-036 — shipped).** `voxcpm-tts` supplies a `VoiceboxClient` to the
existing voice-gen pipeline and owns one private Python worker per generator invocation. Its
model, package, profile and worker assets resolve independently of the reference-only `vendors/`
tree. Both daily workflows opt in through the existing `vdriver` variable; defaults stay as shipped.
Driver-aware one-shot cache validation ships with it. [The design satellite](design/voxcpm-daily-voice-driver.md)
owns the worker protocol, profile behavior, distribution checks and comparison procedure.

```
apps/
  cli/              # @gobing-ai/knowledge-kit — Commander binary (createProgram factory)
  board/            # @gobing-ai/kk-board — native Spur Board browser contributions (G8, ADR-035)
packages/
  kk-core/          # @gobing-ai/kk-core — Doc/Content/Result Zod contracts + kindContract
  kk-store/         # @gobing-ai/kk-store — SQLite store: items/labels/stories DAOs, profiles, current-label resolution, config reader
  publish-harness/  # @gobing-ai/publish-harness — publish transport abstraction + fake transports (E2); shared `./browser` command library (E91, ADR-027)
plugins/
  ingestions/
    aihot-ingest/     # @gobing-ai/aihot-ingest — curated Aihot news → Doc[] (F6)
    karakeep-local/   # @gobing-ai/karakeep-local — ingestion plugin: rclone-synced folder → Doc[]
    web-search/       # @gobing-ai/web-search — ingestion plugin: topic → Doc[] (live Firecrawl client + offline fixture stub; C4)
    horizon-ingest/   # @gobing-ai/horizon-ingest — Horizon CLI (`uv run horizon`) digest items → Doc[] (F61)
    last30days-ingest/ # @gobing-ai/last30days-ingest — last30days skill CLI JSON → Doc[] (F61)
  generations/
    content-gen/      # @gobing-ai/content-gen — generator plugin, owned STORM engine (D4)
    dailynews-gen/    # @gobing-ai/dailynews-gen — Doc[] → markdown Content carrying VoiceScript YAML (F6)
    voice-gen/        # @gobing-ai/voice-gen — generator plugin: Voicebox TTS audio output (D5)
    omni-voice-gen/   # Python (uv) generator plugin: OmniVoice TTS, drop-in for voice-gen (F611, ADR-020 — the only non-TypeScript plugin)
    gemini-tts/       # @gobing-ai/gemini-tts — generator plugin: hosted Gemini 3.8 TTS over voice-gen's pipeline (F612, ADR-023)
    voxcpm-tts/       # @gobing-ai/voxcpm-tts — generator plugin: VoxCPM over voice-gen's pipeline + private uv Python worker (G14, ADR-036)
    core-facts-gen/   # @gobing-ai/core-facts-gen — merged Doc[] → dated core-facts markdown (mechanical, no LLM; F61)
    daily-article-gen/ # @gobing-ai/daily-article-gen — merged Doc[] → daily AI-news article with per-item links (mechanical, no LLM)
    episode-plan-gen/ # @gobing-ai/episode-plan-gen — scores/dedups/selects blended Doc[] into the episode plan (mechanical, no LLM; F61)
    image-gen/        # @gobing-ai/image-gen — free / cover / illustration image jobs; 12 provider adapters (K)
    news-report-gen/  # @gobing-ai/news-report-gen — per-run report from existing run artifacts (output-only; 0117)
  publishings/
    surfdash-pub/     # @gobing-ai/surfdash-pub — publish channel, file-cli (postsurfing CLI) (E3)
    zenn-pub/         # @gobing-ai/zenn-pub — publish channel, file-cli (Zenn CLI + git) (E4)
    qiita-pub/        # @gobing-ai/qiita-pub — publish channel, file-cli (Qiita API v2 token) (E4)
    emdash-pub/       # @gobing-ai/emdash-pub — publish channel, file-cli (EmDash REST token) (E5)
    podcast-pub/      # @gobing-ai/podcast-pub — publish channel, file-cli (microfeed REST + presigned upload) (E6)
    medium-pub/       # @gobing-ai/medium-pub — publish channel, file-cli (Medium integration-token REST) (E7)
    wechatmp-pub/     # @gobing-ai/wechatmp-pub — publish channel, browser/script (WeChat MP console; eligible plain-article drafts may create via same-origin operate_appmsg — ADR-026 amd 2026-10-15) (E7, ADR-026)
    x-pub/            # @gobing-ai/x-pub — publish channel: post via tweets API, article via browser/script (E7, ADR-027)
    juejin-pub/       # @gobing-ai/juejin-pub — publish channel, browser/script (Juejin) (E7, ADR-027)
    infoq-pub/        # @gobing-ai/infoq-pub — publish channel, browser/script (InfoQ CN) (E7, ADR-027)
    substack-pub/     # @gobing-ai/substack-pub — publish channel, browser/script (Substack) (E7, ADR-027)
    xhs-pub/          # @gobing-ai/xhs-pub — publish channel, browser/script (Xiaohongshu) (E7/E8, ADR-024)
    threads-pub/      # @gobing-ai/threads-pub — publish channel, file-cli (Threads Graph: container → threads_publish, text only) (E94)
    weibo-pub/        # @gobing-ai/weibo-pub — publish channel, browser/script (Weibo home composer + 头条文章, draft by default) (E94)
    jike-pub/         # @gobing-ai/jike-pub — publish channel, browser/script (即刻 dynamic post) (0291)
    csdn-pub/         # @gobing-ai/csdn-pub — publish channel, browser/script (CSDN Markdown article) (0292)
    cnblogs-pub/      # @gobing-ai/cnblogs-pub — publish channel, browser/script (博客园 Markdown article) (0293)
    sspai-pub/        # @gobing-ai/sspai-pub — publish channel, browser/script (少数派 Matrix column drafts) (0294)
    xiaoyuzhou-pub/   # @gobing-ai/xiaoyuzhou-pub — publish channel, browser/script (小宇宙 podcast episode drafts) (0295)
    shipinhao-pub/    # @gobing-ai/shipinhao-pub — publish channel, browser/script (微信视频号 short video) (0296)
    bilibili-pub/     # @gobing-ai/bilibili-pub — publish channel, browser/script (B站 video upload + dynamic) (0297)
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

- **Runtime / PM / tests:** Bun `1.4.3` (`packageManager` pin). Prefer `bun:*` over `node:*`.
  Exception (ADR-020): `plugins/generations/omni-voice-gen` is Python — uv-managed venv,
  `make` targets, pytest; outside Bun workspaces, Biome, and `bun:test`.
- **Lint / format:** Biome **2.5.15** (root `devDependency` + `.prototools`).
- **CLI entry:** `apps/cli/src/index.ts` → `process.exit(await main())` when `import.meta.main`.
  `main(argv) → number` (ADR-010 R3). `createProgram()` stays side-effect-free.
- **Command tree:** `apps/cli/src/commands/<noun>.ts` exports `registerXCommand`; `createProgram()` in
  `apps/cli/src/cli.ts` only wires name (`kk`), version, global `--verbose`, and those register calls
  (ADR-010 R2). `article` and `news` attach from one `registerContentVerbs(program, noun, defaultType)`
  call each (`apps/cli/src/commands/content.ts`, 0363).
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

`spur workflow` runs on `@gobing-ai/ts-dual-workflow-engine`. `state-machine` and `transition-flow`
execute **one node at a time**. The `transition-flow` schema declares a node `type` of
`action | gate | parallel | decision`, but no executor reads that field — verified at `0.4.14`:
`parallel` occurs only in `src/types.ts:77`, `src/schema.ts:100`, and
`schemas/transition-flow-workflow.schema.json:38`, and `src/service.ts:24` documents deliberate
per-run serialization. **Authoring a `parallel` node does not fan out.**

Consequently fan-in and fan-out stay `kk` steps (ADR-007 R4). Inside fan-out, non-serial targets
run concurrently (amendment 2026-10-03). A `type: parallel` node still does not fan out;
engine-level concurrency is the `kind: dag` case below.

**DAG workflows (ADR-031; shipped 2026-10-08, tasks 0211–0212).** One node at a time remains true for
`state-machine` and `transition-flow`. Since `0.5.16` the engine also runs `kind: dag`: each wave of ready nodes is
dispatched with `Promise.all` (`src/dag.ts`), so independent steps run concurrently. Constraints
kk designs around: one action per node, no back-edges (loops → nested state-machine via
`spur workflow run`), fail-fast on any node failure, wave-level waiting (a successor waits for
its wave's slowest node), and last-writer-wins `setVars` — DAG nodes pass data by files under
`work_dir`. First user: `kk-daily-ai-voice2` (`docs/design/kk-collect-and-daily-voice2.md`).
Store handoff for Grok Bot cloud routines follows the same file-seam pattern and stays
Mac-side for everything store- or browser-bound — see ADR-044; seam and policy:
`docs/design/kk-collect-and-daily-voice2.md` §10.

**Voice2 episode speech (ADR-034, design).** `dailyGenerate` today sends the whole wrap-docs document to one voice-driver job and skips when `metadata.qc.passed` is true (`plugins/kk/scripts/daily-stages.ts`). Voice2 will instead group the already-written VoiceScript into an opening, one section per spoken item, and a closing, synthesize one request per section, and join those files before the existing intro step. The intro sting, the 15–20 minute duration check, and publish-prep's read of `mp3Path ?? audioPath` stay where they are. Concurrency above 1 is not a DAG wave: ADR-019 and ADR-031 keep fan-out inside `kk`, and this delivery runs one section at a time. The five-argument generate command stays the one-shot path, so voice1's workflow file and its one-request behavior stay put. Shapes: `docs/design/segmented-episode-speech.md`.

**Persistent store (shipped — ADR-030; tasks 0206, 0208–0210, 0225–0229).** `@gobing-ai/kk-store`
owns the only SQLite file (`store.db_path`);
`kk store migrate|lock|ingest|backfill-facts|label|extract|select|mark-published|release` is its
sole CLI surface and the package is the only ts-db importer (boundary rules). Store v2
(`0003_store_v2`, one atomic migration) widens `labels` to one observation per
(`item_id`, `decision_id`, `maker`, `run_id`) with raw-evidence columns (`raw_value`,
`raw_confidence`, `reason`, `duration_ms`, `catalog_version`, `content_hash`), promotes the
deterministic facts (`engagement`, `body_chars`, `source_tier`, `lang`, `domain`, `story_id`) to
typed `items` columns, and replaces `episode_usage` with the topic-scoped `selections`;
`items.story_id` is the dedup key the pool exclusion rides on: URL identity first (an item's own
`canonical_url` against another item's body outbound links, either direction — 0316), then title
Jaccard as the fallback for URL-less pairs. `kk-collect` writes
it every 6 h (04/10/16/22 local); DAG workflows read it. `extract` compiles a topic profile
(`plugins/kk/decisions/extract/<topic>.yaml`) into one `ItemsDao.selectByProfile` query — a
`labels` self-join per `where` decision, `first_seen_at >= now - window`, and a topic-scoped
`NOT EXISTS selections` story exclusion (`--include-selected` opts out) — and writes the pool as
`Doc[]` with the stored labels inlined under `metadata.labels`, so a new topic is a profile file
rather than a pipeline. `select` / `mark-published` / `release` maintain that topic-scoped
`selections` ledger — written the moment a run commits to its set, so the "never re-aired" invariant
no longer depends on publishing — and `kk daily prepare` names any earlier run still holding
`selected` rows. The live store is on v2, and only the global `kk` writes it; launchd resolves `kk` via
the plist PATH (`~/.bun/bin` first), and an interactive shell resolves the same file. **Upgrade order:**
a schema-bumping change reaches the live tree only together with a global `kk` that carries it, and the
schema-skew guard in `applyKkMigrations` (task 0242 R1) enforces this. Recovery paths:
`.works/kk.db.pre-0242`, or the incident archive at `.works/incident-2026-10-09T0952/kk.db` copied without
its `-wal`/`-shm` (v1, 68 items / 340 labels).

### XHS image-card path (ADR-024)

`kk:xhs-images` reads source content and writes an ordered card plan and saved prompts. Each card is one `image-gen` job using an XHS preset; the skill collects the resulting `metadata.images[]` entries into one `Content` carrying the XHS note. `xhs-pub` validates the ordered local paths, attaches them through its browser transport, and returns a `Result` from observed draft or publication state. The agent handles content judgment and spend confirmation; product plugins retain image bytes, browser actions, and result validation. A failed card can resume from its saved prompt without repeating successful paid jobs.

Since ADR-028 (task 0180), card copy is not provider prompt text: for compose formats (a `compose` block on the format preset, e.g. `xhs-card`), image-gen typesets headline/points locally with pinned Noto Sans SC via headless Chromium at the declared canvas and composes the card over the provider illustration band (or text-only on the pre-spend probe). The provider prompt carries the illustration description only; the job artifact adds `ImageArtifact.illustration` and downstream consumers read only `.path` (the composed card). Pre-spend guards: font cmap coverage check and `KK_IMAGE_DRY_RUN=1` text-only compose fail loud without spend. Mechanism and guarantees: `docs/design/xhs-image-cards.md` § Deterministic text typesetting.

Declared canvas forwarding and delivery measurement (task 0182): Format presets declare canvas dimensions (`width`/`height`), but providers vary in exact canvas support. An opt-in capability seam `ImageProvider.exactSize?(model, width, height)` allows providers (e.g. MiniMax `image-01`) to receive exact pixel requests (with `aspectRatio` omitted), while providers without the capability receive byte-identical aspect-only requests (`aspectRatio` only). Delivery dimensions are measured from raw image bytes via a zero-dependency, header-only reader (`imageDimensions` in `src/bytes.ts`: PNG IHDR, JPEG SOFn, WebP VP8/VP8L/VP8X; unparseable bytes return `null`, not a throw) and recorded in `ImageArtifact.width/height` with `sizeRequest: 'exact' | 'aspect'`. Mismatched or unparseable dimensions emit a warning rather than failing after spend, preserving paid artifacts (money boundary invariant). On compose formats (0180), the raw provider delivery is recorded in `illustration.width/height` beside the card canvas.

The XHS path keeps draft as the default. An explicit public switch is required before the browser submits a live post (ADR-022). One console visit may compose several notes (ADR-025 amendment 2026-10-09): the automation cap counts visits, not notes, and each operation keeps its own draft rail and its own `Result`, so a failed operation never fails the visit (surface: `docs/04_DESIGN.md` → `xhs-pub`). Task 0167 replaced the placeholder `sessionReady` stub with a Playwright script driver, verifying ordered uploads via `setInputFiles`, thumbnail counts, and browser-confirmed draft or public outcomes. Surface and artifact shapes live in `docs/design/xhs-image-cards.md`.

### Plugin kinds

Three kinds, discovered under the matching kind collection (ADR-009; ADR-007 amdt 2026-08-07
supersedes the 2026-08-02 fourth-kind amendment):

| Kind | Contract | Notes |
| ------ | ---------- | ------- |
| `ingestion` | `source → Doc[]` | Optional; the alternative `Brief` generator input is planned |
| `generator` | `Doc[] → Content` (shipped) | `Brief` / combined input is planned; see Generator input dispatch |
| `publish` | `Content → Result` | Auxiliary `Doc[]` forms require a manifest-declared `operations` entry (Execution boundary integrity I3, shipped 0110) |

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

### Publish modes inside a channel plugin (ADR-029)

A publish channel is one plugin; its publishing **types** are `operations` of that plugin, not
separate plugins. Selection is `options.operation ?? content.metadata.operation`, resolved against
the channel's declared operation list; an undeclared operation fails with a named error before a
browser is launched or a profile resolved, so a misrouted run cannot open a session it will not use.

| Concern | Owner |
| ---------- | ------- |
| Mode list, per-mode flow, selector table, success signal | the operation |
| Profile dir, session, preflight, `profile-check login|check`, `Content → Result` mapping | the channel |
| Transport, when modes genuinely differ (API vs browser) | the operation, via the existing per-operation transport resolution |

**Mandatory rail.** A publish flow reports success only on an observed site signal, and the signal
is read from the page's notification containers — never from the document at large, where the
article body the flow itself pasted satisfies the probe (fixed in the E91 residual sweep). A mode
whose save control only exists after its artifact is attached (WeChat MP 视频 / 播客) fails fast on
the missing artifact instead of reporting an unobservable save.

Live per-mode evidence, including the drift lists the fix work consumes:
`docs/design/xhs-ui-discovery.md`, `docs/design/wechatmp-ui-discovery.md`.

### Generator input dispatch (accepted design — not yet built)

The shipped input is a bare `Doc[]` (`kindContract('generator')`). `BriefSchema`,
`GeneratorInputSchema`, and manifest `accepts` remain specified but unimplemented; see `04`
§1.7 and §4. The planned widened input is a **combined shape**, not a strict union:

```text
GeneratorInput = { brief?: Brief, docs?: Doc[] }   refine: brief || docs.length > 0
```

A strict `Brief | Doc[]` union would foreclose the composite case ("write about X *using these
sources*"), which is the most useful of the three. The planned dispatcher checks populated input
keys against the plugin's accepted forms before spawn. Today `kk executor run` validates only
the shipped kind contract, so a brief object is rejected as invalid `Doc[]`.

### Fan-in / fan-out

Siblings of `executor run`, so the single-plugin invoker contract stays intact (ADR-006):

```text
kk executor fan-in  --in <f1> [--in <f2> …] --out <merged.json> [--plugins-root <dir> | --plugins-path <dir> …]
kk executor fan-out --content <content.json> --target <p1> [--target <p2> …]
                    --out <result.json> [--retry-from <prior-result.json>]
                    [--jobs <n>] [--serial] [--serial-target <plugin> …] [--target-timeout <ms>]
                    [--plugins-root <dir>] [--plugins-path <dir> …]
```

- **Fan-in (N→1):** merge `Doc[]` sets; dedupe on primary `id` (first-seen wins); provenance
  retained in `metadata.sources`; stable ordering. Spec §1.2's `--dedupe` flag is deferred — id
  dedupe is the only rule (task 0042).
- **Concurrent collect (`--source`):** the daily workflow's single collect state passes
  `--source "<plugin>:<config-file>"` pairs instead of pre-materialized `--in` files; fan-in spawns
  each plugin (executor `run` contract, plugin resolved by name) and merges the outputs, so
  per-source documents never land in the workspace (0097). `--source` discovery uses the merged
  registry by default; `--plugins-root` (exclusive) / `--plugins-path` (union) narrow it, and
  combining them is a usage error (0157 R3).
- **Fan-out (1→N):** dispatch `Content` to N publishers **concurrently** — bounded by `--jobs`, with
  `--serial-target` names held out of the batch and run alone afterwards — and emit one aggregate
  `Result` with a per-target entry (`published | failed | skipped`) plus summary counters; a
  `--target-timeout <ms>` overrun kills that publisher's owned process tree (descendants then the
  entry) and is recorded `failed` (ADR-007 R4 amendment 2026-10-03).
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

The Brief branch is planned. Executable domain steps exchange files through `kk` subcommands;
judge steps use `agent.run`. The intended domain boundary validates each file against a
`@gobing-ai/kk-core` contract. Packaging, cancellation, kind-contract, freshness, and retry
completion rules shipped in task 0110 are the table below.

### Execution boundary integrity

**Shipped (2026-09-10, task 0110).** The dated amendments to ADR-006/007/012/019 own the
decisions; [task 0110](tasks/0110_repair-plugin-packaging-execution-contracts-cancellation-and.md)
implemented them with regression coverage. The executor now enforces:

| Boundary / owner | Required behavior | Shipped mechanism (task issue) |
| --- | --- | --- |
| Distribution / `scripts/bundle-plugins.ts` | Every discovered shipped entry resolves dependencies from the installed distribution | Product entries are Bun-bundled to `dist/index.js` at staging; manifests rewritten to `./dist/index.js`; `node_modules` is pruned so workspace symlinks do not ship; missing entry / failed build / zero plugins fail loud (I1, 0111) |
| Cancellation / `apps/cli/src/invoke.ts` | Source timeout terminates and reaps owned descendants without affecting siblings | `killProcessTree` (descendants first, then entry) on a self-managed `timeoutMs` timer so the walk runs while the entry is alive (I2) |
| Kind contract / `kk-core` + executor | Plugin-specific render operations preserve generic kind validation | Publish input is `Content` again; non-`Content` inputs require a manifest-declared `operations` entry, validated and dispatched by declaration (I3) |
| Retry persistence / `apps/cli/src/fanout.ts` | Preserve validated per-target metadata through read and carry-forward | Prior ledgers validate through kk-core `AggregateResultSchema`/`TargetOutcomeSchema` (0157 R11); `TargetOutcome.metadata` round-trips; a wrong-typed or primitive field is a named input error, exit 2 (I4) |
| Invocation completion / `apps/cli/src/invoke.ts` | Only output produced by this invocation can establish success | `--in`/`--out` aliasing rejected pre-mutation by file identity (dev+ino, not path string — 0157 R1); stale `--out` unlinked before spawn (delete-or-verify) (I5) |
| Publish completion / `apps/cli/src/invoke.ts` | A valid `Result` with `ok: false` yields non-zero exit | Single invocations reject `ok: false` with `reported failure: <reason>`, exit 1, artifact kept (I6) |
| Retry aggregation / `apps/cli/src/fanout.ts` | Retain failures excluded from the selected retry subset | Prior failures outside the explicit selection stay `failed` in the aggregate; `ok: false` and exit 1 preserved (I7) |

Keep process lifecycle handling at the existing spawn seam and result validation at the executor
boundary. Each plugin retains its own validation for direct entry execution. Product-plugin
entries stay bundled at packaging time (no second registry, no published private workspaces);
copied assets remain alongside the entry.

Show-notes rendering keeps its markdown deliverable through the declared
`operations["show-notes"]` (doc-list → markdown) path; the daily workflow artifact is unchanged.
Retry repairs preserve the existing aggregate fields. Retry dispatch uses the same concurrent
pool as a fresh fan-out (`--jobs`, `--serial`, `--serial-target`); target eligibility is
unchanged: without explicit targets exactly the prior failures retry; an explicit selection
narrows that attempt set and previously unattempted names remain eligible, while unselected
prior failures are retained in the aggregate.

Verification exercises these boundaries directly: execution outside workspace dependency
resolution, nested child cancellation, negative plugin output, and a persisted-result round trip
through the locale-scaffolding selector.

### Two-layer CLI nouns (shipped — ADR-011, feature A21)

Canonical paths are `kk executor run` / `kk executor fan-in` / `kk executor fan-out` /
`kk plugin status`. Engines and file contracts above are unchanged. Hidden one-release aliases
(`invoke` / `fanin` / `fanout` / `plugins *`) keep the old names working but are not listed in
`kk --help`. ADR-011's "exactly two first-layer nouns" was amended 2026-09-18: `kk stage <stage>
[args…]` is a **third** first-layer noun that runs a `kk-workflow-stages.ts` stage for workflow
shell steps (`docs/04_DESIGN.md` §1.8). It is a deterministic step runner, not a plugin operation.
ADR-053 adds the content nouns `article` and `news` (the shared verbs, one registration function);
`kk itc` / `kk daily` stay their routes until the G61 cut-over retires them.

### Output and diagnostics foundation (ADR-014/ADR-015)

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
| `packages/kk-core` | `@gobing-ai/kk-core` | Doc/Content/Result + fan-out aggregate schemas (`TargetOutcomeSchema` / `AggregateResultSchema`, 0157 R11), `PluginKind` / `kindContract`, filesystem plugin discovery | `zod` + `node:fs` / `node:path` (discovery only) |
| `packages/kk-wiki` | `@gobing-ai/kk-wiki` | Accepted design (ADR-048, feature I1 — not yet built): vault page model, wikilink graph, link/lint, merge with redirect, index/MAP compile, gc, `user_edited` guard, raw snapshot writer, Quartz publish projection | `@gobing-ai/kk-core`, `zod`, `node:fs` / `node:path` |
| `packages/publish-harness` | `@gobing-ai/publish-harness` | Publish transport abstraction; `FakeFileCliTransport` / `FakeBrowserTransport`; browser session helpers (`resolveBrowserProfileDir`, `trySelectors`; browser launch moved upstream to `@gobing-ai/ts-browser-automation`, task 0177); shared `./browser` command library — channel profile-dir precedence, `login\|check` profile CLI, poll/editor-input/observed-outcome helpers (E91, ADR-027) | `@gobing-ai/kk-core`, `@gobing-ai/ts-browser-automation`, `@gobing-ai/ts-utils` |
| `plugins/ingestions/aihot-ingest` | `@gobing-ai/aihot-ingest` | Aihot selected snapshot/changes → attributed `Doc[]`; atomic cursor state (F6) | `@gobing-ai/kk-core`, `@gobing-ai/ts-runtime`, `@gobing-ai/ts-utils`, `zod` |
| `plugins/ingestions/karakeep-local` | `@gobing-ai/karakeep-local` | Ingestion plugin: rclone-synced folder → `Doc[]` | `@gobing-ai/kk-core`, `@gobing-ai/ts-utils`, `@gobing-ai/ts-infra` |
| `plugins/ingestions/web-search` | `@gobing-ai/web-search` | Ingestion plugin: topic `--in` JSON → `Doc[]`; live Firecrawl client (`FIRECRAWL_API_KEY`) + offline fixture stub (0057, C4) | `@gobing-ai/kk-core`, `@gobing-ai/ts-utils`, `@gobing-ai/ts-infra` |
| `plugins/ingestions/horizon-ingest` | `@gobing-ai/horizon-ingest` | Ingestion plugin: Horizon CLI (`uv run horizon`) digest items → `Doc[]` (F61) | `@gobing-ai/kk-core`, `@gobing-ai/ts-runtime`, `@gobing-ai/ts-utils`, `zod` |
| `plugins/ingestions/last30days-ingest` | `@gobing-ai/last30days-ingest` | Ingestion plugin: `last30days` skill CLI JSON → `Doc[]` (F61) | `@gobing-ai/kk-core`, `@gobing-ai/ts-runtime`, `@gobing-ai/ts-utils`, `zod` |
| `plugins/generations/content-gen` | `@gobing-ai/content-gen` | Owned STORM pipeline → markdown `Content` (D4) | `@gobing-ai/kk-core`, `@gobing-ai/ts-runtime`, `@gobing-ai/ts-utils` |
| `plugins/generations/dailynews-gen` | `@gobing-ai/dailynews-gen` | News `Doc[]` → validated VoiceScript YAML in markdown `Content` (F6) | `@gobing-ai/kk-core`, `@gobing-ai/ts-runtime`, `@gobing-ai/ts-utils`, `zod` |
| `plugins/generations/voice-gen` | `@gobing-ai/voice-gen` | VoiceScript/plain-text `Doc[]` → Voicebox WAV/optional MP3 audio `Content` (D5) | `@gobing-ai/kk-core`, `@gobing-ai/ts-runtime`, `@gobing-ai/ts-utils`, `zod` |
| `plugins/generations/omni-voice-gen` | — (Python, uv — not a Bun workspace) | VoiceScript/plain-text `Doc[]` → OmniVoice WAV/optional MP3 audio `Content`; drop-in for voice-gen via the `vdriver` workflow var (F611, ADR-020) | PyPI `omnivoice` (torch stack), stdlib |
| `plugins/generations/gemini-tts` | `@gobing-ai/gemini-tts` | VoiceScript/plain-text `Doc[]` → hosted Gemini 3.8 TTS WAV/optional MP3 audio `Content`; supplies a Gemini-backed `VoiceboxClient` to voice-gen's `processGeneratorIO` rather than porting the pipeline (F612, ADR-023), plus the one-time replicated-voice creation CLI | `@gobing-ai/voice-gen`, `@gobing-ai/ts-utils` |
| `plugins/generations/core-facts-gen` | `@gobing-ai/core-facts-gen` | Merged `Doc[]` → one dated core-facts markdown `Content` (mechanical, no LLM; F61) | `@gobing-ai/kk-core`, `@gobing-ai/ts-runtime`, `@gobing-ai/ts-utils`, `zod` |
| `plugins/generations/daily-article-gen` | `@gobing-ai/daily-article-gen` | Merged `Doc[]` → readable daily AI-news article with per-item source links (mechanical template, no LLM) | `@gobing-ai/kk-core`, `@gobing-ai/ts-runtime`, `@gobing-ai/ts-utils`, `zod` |
| `plugins/generations/episode-plan-gen` | `@gobing-ai/episode-plan-gen` | Scores/dedups/selects blended `Doc[]` into the daily episode plan, plus the `--mode filter` quality gate (mechanical, no LLM; F61) | `@gobing-ai/kk-core`, `@gobing-ai/ts-runtime`, `@gobing-ai/ts-utils`, `zod` |
| `plugins/generations/image-gen` | `@gobing-ai/image-gen` | `free` / `cover` / `illustration` image jobs over the generator `Doc[]` → `Content` contract; 12 provider adapters (K) | `@gobing-ai/kk-core`, `@gobing-ai/ts-runtime`, `@gobing-ai/ts-utils`, `zod` |
| `plugins/generations/news-report-gen` | `@gobing-ai/news-report-gen` | Assembles the per-run report from existing run artifacts (QC aggregates, rejects, step timing) — output-only (0117) | `@gobing-ai/kk-core`, `@gobing-ai/ts-runtime`, `@gobing-ai/ts-utils`, `zod` |
| `plugins/publishings/surfdash-pub` | `@gobing-ai/surfdash-pub` | Publish channel: `postsurfing` CLI transport, Surfdash mapping (E3) | `@gobing-ai/kk-core`, `@gobing-ai/publish-harness`, `@gobing-ai/ts-utils` |
| `plugins/publishings/zenn-pub` | `@gobing-ai/zenn-pub` | Publish channel: Zenn CLI + git transport, Zenn mapping (E4) | `@gobing-ai/kk-core`, `@gobing-ai/publish-harness`, `@gobing-ai/ts-utils` |
| `plugins/publishings/qiita-pub` | `@gobing-ai/qiita-pub` | Publish channel: Qiita API v2 token transport, Qiita mapping (E4) | `@gobing-ai/kk-core`, `@gobing-ai/publish-harness`, `@gobing-ai/ts-utils` |
| `plugins/publishings/emdash-pub` | `@gobing-ai/emdash-pub` | Publish channel: EmDash CMS REST token transport, Portable Text mapping (E5) | `@gobing-ai/kk-core`, `@gobing-ai/publish-harness`, `@gobing-ai/ts-utils` |
| `plugins/publishings/podcast-pub` | `@gobing-ai/podcast-pub` | Publish channel: microfeed REST Bearer transport + upload flow, episode mapping (E6) | `@gobing-ai/kk-core`, `@gobing-ai/publish-harness`, `@gobing-ai/ts-runtime`, `@gobing-ai/ts-utils` |
| `plugins/publishings/medium-pub` | `@gobing-ai/medium-pub` | Publish channel: Medium integration-token REST (E7) | `@gobing-ai/kk-core`, `@gobing-ai/publish-harness`, `@gobing-ai/ts-runtime`, `@gobing-ai/ts-utils` |
| `plugins/publishings/wechatmp-pub` | `@gobing-ai/wechatmp-pub` | Publish channel: WeChat MP console browser/script (E7, ADR-026) | `@gobing-ai/kk-core`, `@gobing-ai/publish-harness`, `@gobing-ai/ts-runtime`, `@gobing-ai/ts-utils` |
| `plugins/publishings/x-pub` | `@gobing-ai/x-pub` | Publish channel: X `POST /2/tweets` + article browser/script (E7, ADR-027) | `@gobing-ai/kk-core`, `@gobing-ai/publish-harness`, `@gobing-ai/ts-runtime`, `@gobing-ai/ts-utils` |
| `plugins/publishings/juejin-pub` | `@gobing-ai/juejin-pub` | Publish channel: Juejin browser/script (E7, ADR-027) | `@gobing-ai/kk-core`, `@gobing-ai/publish-harness`, `@gobing-ai/ts-runtime`, `@gobing-ai/ts-utils` |
| `plugins/publishings/infoq-pub` | `@gobing-ai/infoq-pub` | Publish channel: InfoQ CN browser/script (E7, ADR-027) | `@gobing-ai/kk-core`, `@gobing-ai/publish-harness`, `@gobing-ai/ts-runtime`, `@gobing-ai/ts-utils` |
| `plugins/publishings/substack-pub` | `@gobing-ai/substack-pub` | Publish channel: Substack browser/script (E7, ADR-027) | `@gobing-ai/kk-core`, `@gobing-ai/publish-harness`, `@gobing-ai/ts-runtime`, `@gobing-ai/ts-utils` |
| `plugins/publishings/xhs-pub` | `@gobing-ai/xhs-pub` | Publish channel: Xiaohongshu browser/script (E7/E8) | `@gobing-ai/kk-core`, `@gobing-ai/publish-harness`, `@gobing-ai/ts-runtime`, `@gobing-ai/ts-utils` |
| `plugins/publishings/threads-pub` | `@gobing-ai/threads-pub` | Publish channel: Threads Graph two-step text publish (TEXT container → `threads_publish`), no browser path (E94) | `@gobing-ai/kk-core`, `@gobing-ai/publish-harness`, `@gobing-ai/ts-runtime`, `@gobing-ai/ts-utils` |
| `plugins/publishings/weibo-pub` | `@gobing-ai/weibo-pub` | Publish channel: Weibo home composer + 头条文章 browser/script, draft by default (E94) | `@gobing-ai/kk-core`, `@gobing-ai/publish-harness`, `@gobing-ai/ts-browser-automation`, `@gobing-ai/ts-runtime`, `@gobing-ai/ts-utils` |
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

## Remaining wt-publish harvest (ADR-008 amdt 2026-09-17)

E7 extends the E2 harness instead of adding a package. The harness driver field,
`FakeBrowserTransport` / session helpers, leftover channel plugins, and the thin
`plugins/kk/skills/publish` skill are shipped.
Browser transports stay `kind: 'browser'` and declare `driver: 'script' | 'agent'`. Plugin
processes do not embed an LLM: `agent` drivers are `plugins/kk` skills / workflow `agent.run`
using harness session helpers. `kk fanout` stays the sequencer for `file-cli` and `script`;
agent-default channels sequence as workflow steps. Channel plugins (`medium-pub`,
`wechatmp-pub`, `x-pub`, `juejin-pub`, `substack-pub`, `infoq-pub`, `xhs-pub`, `weibo-pub`) land under
`plugins/publishings/` like the shipped E3–E6 instances; `threads-pub` is a `file-cli` channel on the
same rails as the tweet-API post half of `x-pub` (E94).

Full design: `docs/design/remaining-wt-publish-harvest.md`.

## kk-itc end-to-end (ADR-021/ADR-022, shipped — F41)

`kk-itc` runs the whole path from idea to platform drafts in one state machine, because spur has
no sub-workflow action. The authoring states stay as they are. A var-gated tail follows:
`illustrate → materialize → publish-plan → adapt → publish-confirm → publish-fanout →
publish-agent → publish-retry → report`.

- `kk stage itc-*` helpers own the deterministic seams: Content materialization, the target
  profile table, fan-out groups and the report.
- API and file-cli targets go through `kk executor fan-out` (`--retry-from` once). Browser targets
  loop over `agent.run kk:publish`.
- `itc-materialize` is the split point ADR-053 adopts for the generic publish workflow (see
  Content pipeline consolidation below — accepted design, not yet built).
- Drafts are the default, and every target's own draft switch is written explicitly (ADR-022).

Full design: `docs/design/kk-itc-end-to-end.md`.

## Daily voice3 generate/publish split (ADR-043, shipped — G15)

The daily AI-voice product is two DAGs joined by a file, not one DAG. `kk-daily-ai-voice3`
(generate, fail-fast) ends by freezing `bundle.json`; `kk-daily-publish3` (publish, one window per
launch) reads it and never regenerates content. The bundle **is** the interface: `runId`,
`runDate`, `parentRunId`, `runs[]` (every publish run that touched the bundle, append-only so a
window's record survives the next generate run), `episode {title, guid}`, and
`variants { key → {path, sha256} }` where each `path` is a kk-core `Content` and the digest is
verified before any plan accepts it.

Invariants, each mechanically checkable:

- No channel name appears in a workflow YAML. The matrix is a publish preset
  (`plugins/kk/publish-presets/`) selected by `workflows.kk-daily-ai-voice3.publish_preset`; launch
  vars (`channels`, `live_channels`, `dummy`) may **narrow or promote** the preset's rows, never
  extend them — a token the preset does not list in that window fails the plan.
- A preset row's `mode` is closed over `off|dummy|draft`, so `live` is launch-only (ADR-022); the
  installed cron line carrying `live_channels` is the operator's consent.
- Publish status is derived from receipts, never from an exit code: `publish-matrix-send` exits 0
  on a failed row, and `publish-matrix-classify` reduces a window to `full|partial|none|dummy`
  over **non-dummy** rows only, a planned row with no receipt counting as not succeeded.
- A `dummy` row is planned, payload-validated and receipted but never dispatched, so a full
  rehearsal spawns no plugin process and makes no network call.
- Channel copy is shaped on the generate side (`30-variants/`; a channel-specific key is
  `<variant>@<plugin>` and wins the lookup over the shared `<variant>`), and `{{article_url}}` /
  `{{podcast_url}}` resolve at send time from the tier-0 receipts — a publish plugin only ever
  receives finished content.
- A channel that needs more than one locale gets them on the generate side too: the `article`
  variant carries `metadata.surfdash.locales.{en,ja} = {title, body}` (produced by the news DAG's
  `localize` node before `variants`, gated by `localize-check`), and the publisher materializes one
  `index.md` per locale beside zh, spawning `postsurfing` once with the zh path. A digest Content
  missing a locale is refused before that spawn with effect `none`, so the site's opaque
  post-spawn "missing locale file(s)" can no longer be the first place a half-localized day is
  visible (2026-11-19, ADR-053 amendment, task 0409).
- Tier 0 is the publication contract: serial and first, because later tiers may link it. The
  dependency is per payload, not per tier: a failed tier-0 row fails only the later rows whose
  `{{article_url}}` / `{{podcast_url}}` cannot resolve (effect `none`, retryable); unrelated
  channels still dispatch (2026-11-12 amendment — one surfdash CMS failure used to drop a whole
  day's planned posts).

**Module boundary.** `apps/cli/src/publish-matrix.ts` owns the `publish-matrix-*` stage family
(plan, check, send, classify, bundle, rss-gate, wait-until), dispatched by
`apps/cli/src/publish-matrix-stage.ts` beside `itc-stage.ts` through `kk stage run
publish-matrix-*` — the compatibility route; the five named `publish-*` step verbs on `kk article` /
`kk news` (0364) call the same functions with named flags. The send loop is **shared with itc, not
forked**: `sendRows` in `apps/cli/src/publish-core.ts` (0361) owns resend rules, effect
classification and receipt writing, and the two callers differ only in receipt key (plugin for itc,
target id here), where `targetId = id ?? ${plugin}.${slugify(operation)} ?? plugin` lets one plugin
hold several concurrent receipt keys. `ItcReceiptSchema` is extended additively (`target`, `window`,
`dummy`, `error`, timestamps), so an itc receipt never changes shape.

**Engine constraint this layout is shaped around** (§Execution substrate): a DAG node is skipped
only when *all* its dependencies were skipped, so a conditional node can never gate a chain alone.
The RSS gate therefore always succeeds and records its verdict in `4-publish/rss-gate.json` (a
failed node would cascade-skip the incident path), and every node depending on a conditional node
lists a second, unconditional dependency.

**Editorial boundary (ADR-045).** Editorial judgement for the episode (selection, ordering, the
balance of news, opinion and technical detail, and the style contract) lives in the `kk:news-editorial`
skill, not in stage code or prompts. Code keeps the deterministic parts: thresholds, the builder, the
validator, duration gates. `daily-script-style` snapshots the skill into `20-editorial/` so every
executor reads the same frozen policy by path. `daily-script-check` dry-runs the validator, so a
rejected plan gets one `write --fix` pass before the template fallback.

Full design and rollout: `docs/design/kk-daily-ai-voice3.md`; shapes: `docs/04_DESIGN.md`
§publish-matrix stages.

## Content pipeline consolidation (G61 — ADR-053; surface shipped 0363–0364, workflows accepted design — not yet built)

One content-type registry, one bundle, one plan and one publish core serve every content type; the
per-type workflows only sequence steps.

- `apps/cli/src/content-types.ts` owns the registry: `ContentTypeSchema` (`workflow`, `writer_skill`,
  `publish_preset`, `channels`) with built-ins `news` and `itc`, resolution flag →
  `content_types.<type>` → `workflows.<workflow>.publish_preset` → built-in (per-field merge,
  `channels` key by key), the writer-skill directory plus `SKILL.md`/`references` digest, and
  `resolveRun` for `<works>/<workflow>/<run>` (ADR-042/ADR-053 amdt).
- Nothing in `apps/cli/src/publish-core.ts` imports `./itc-*`; it owns `ReceiptSchema`, the preset
  dialect and resolver, the plugin probe and `sendRows`. `apps/cli/src/publish-matrix.ts` owns the
  `publish-matrix-*` plan/check/send/classify family; the five named `publish-*` verbs are thin
  compositions over it.
- One `BundleSchema` carries both types (`contentType`, optional `title`/`episode`) and
  `PublishPlanRowSchema` carries `transport`, `metadata` and `modeSource`; `schemaVersion` stays `1`
  because every change is additive or a relaxation.

**Invariants**

1. `kk news` rejects `--type` (Commander unknown-option, exit 2); `kk article` resolves it.
2. An unknown type exits 2 naming the known set and the config path; a `writer_skill` without
   `SKILL.md` fails by that path.
3. Every content verb prints exactly one JSON object on stdout; diagnostics go to stderr.
4. `content_types.<type>.channels` is applied only by the named `publish-plan`; a key matching no
   preset row exits 2 before any file is written, and `kk stage run publish-matrix-plan` ignores it.

**Not built (accepted design).** The launching `generate` / `publish` verbs with
`launchWorkflow()`, the workflows `kk-news-generate` / `kk-article-generate` / `kk-publish`, the
generation step verbs, and the retirement of the publish3 / ITC publish-tail DAGs are tasks
0365–0369. Shapes: `docs/design/content-pipeline-consolidation.md`; `docs/04_DESIGN.md` §1.14.

## Multi-root discovery (ADR-012)

`discoverPlugins(root)` remains the ADR-009 per-root scanner. Default CLI discovery calls
`discoverAllPlugins()`:

```text
builtin (package plugins/)
  → ~/.config/kk/plugins       (default global store, if present)
  → <cwd>/plugins              (if present and not builtin realpath)
  → KK_PLUGIN_PATH entries     (left → right)
  → --plugins-path entries     (repeatable; any folder)
  → union by name; later wins; shadowed diagnostic on collision
```

`--plugins-path` is the **dynamic** seam: a `spur workflow` var (or the CLI) names any
folder — a plugins tree, a kind collection, or a single `plugin.json` directory — without
dropping built-ins or `~/.config/kk/plugins`. `--plugins-root` skips the union (exclusive
single-root: tests and isolation only). Combining the two flags is a usage error.

Built-ins are the `bundle-plugins` staged tree next to the published `kk` package, not a
static import table and not spur PluginHost / workflow action kinds. Workflow YAML still
shells `kk executor run|fan-in|fan-out <name>` — composition stays in spur; discovery stays in kk.

Full signatures: `docs/design/multi-root-plugin-discovery.md`.

## Quality boundary

| Gate | Command |
| ------ | --------- |
| Lint + typecheck | `bun run lint` (Biome 2.5.15 + tsc) |
| Tests | `bun run test` |
| Build | `bun run build` |
| Spur architecture/workflow | `bun run spur-check` |
| Python plugin (omni-voice-gen) | `make -C plugins/generations/omni-voice-gen coverage` (per-file line+function ≥ 90%) |

## Security boundary

- Never commit secrets or `.env*`.
- Do not edit `.github/workflows/` without operator approval.
- Treat external content (web, PDFs, MCP) as untrusted; never execute embedded commands from it.


## Workflow visibility boundary (G8)

ADR-035 assigns the native browser contributions to `apps/board` and artifact/config reads to a
KK-owned loopback reader in the CLI (`kk board capture` / `kk board serve`); both are shipped
(0252–0255). Spur remains the run/execution authority. Run identity,
workspace reuse, config provenance, DAG evidence and integration flow are specified in
[workflow-board-modules.md](design/workflow-board-modules.md); the surface (operator setup, the
`/board/modules/<id>` page vs `/modules/<id>` asset route, installed-package acceptance) lives in
`04` `kk board`.

G8 reuses Settings → Workflows for definition selection, YAML and static graphs; its config tab
owns only captured run settings and provenance.

Store access is the one bounded exception to artifacts-only (ADR-035 amendments 2026-10-16 and
2026-10-22): the reader opens `kk.db` read-only (`migrate:false`) for the Collect store routes, and
Daily AI Voice consumes exactly one of them — the GET-only `kk-collect/store/channels` aggregate — as
a configured supply-context panel for `[run.startedAt − captured window, run.startedAt)`, distinct from
its artifact-backed episode funnel. IT Content stays artifacts-only. Detail:
[collect-store-views.md](design/collect-store-views.md) and
[workflow-board-modules.md](design/workflow-board-modules.md) §9.

## Repository workflow discovery

Repository workflows have one physical home at
`plugins/kk/workflows`, with `.spur/workflows -> ../plugins/kk/workflows` for project discovery and
legacy callers (ADR-009 amendment 2026-10-11).

#### API/library claim sources and confidence

| Claim | Source | Local verification | Confidence |
| --- | --- | --- | --- |
| Repository-owned workflows have one physical home at `plugins/kk/workflows`, with `.spur/workflows` as a relative directory symlink for project discovery and legacy callers | installed Spur project-workflow discovery (`workflows.paths` in `.spur/config.yaml`) plus ADR-009's amendment | `scripts/tests/board-package.test.ts` AC10 asserts the symlink and that the three board-module definitions resolve under it; the retired `feature-verification` wrapper was removed with spur's ADR-142 lifecycle (receipts bind to the bundled `feature-lifecycle`) | HIGH |
| A declared Board module's page is mounted at `/board/modules/<id>` — the host derives it from the declaration's `id` and its own constant `/modules/<id>` | installed `BOARD_MODULE_ROUTE_PREFIX` / `boardModuleRoute(id)` | Read both in `node_modules/@gobing-ai/spur/spur.js` (0.4.2); the mounted path was measured live by `apps/board/tests/installed-board.test.ts` | HIGH |
| The installed progress projection is state-oriented and a DAG run can lose it entirely (404 on an `orphan-row` diagnostic), so board progress reads run-detail action rows plus a digest-verified captured topology | installed bundle: `projectWorkflowProgress` and the progress route's guard | Read both in `node_modules/@gobing-ai/spur/spur.js` (0.4.2); the fallback is `apps/cli/src/board/reader.ts:354` | HIGH |
| The reader is a KK-owned loopback process rather than a Board extension point, because the shipped Board loads browser contributions only and exposes no downstream server-route hook | the contribution contract and the served route table | Read `node_modules/@gobing-ai/spur/board/index.d.ts` and the `app.get` registrations in `spur.js` (0.4.2); no contribution-mounted route exists | MEDIUM — concluded from the contract and the route table, not from an attempted server injection |


## Named browser-session boundary (A22 — shipped)

ADR-037/038 shipped with A22 (tasks 0275–0278; `apps/cli/src/commands/bot.ts`, `packages/publish-harness/src/bot.ts`). CLI owns command parsing; publish-harness owns local profile lifecycle and shared launcher ownership; plugins keep site readiness and special state capture/restoration. An optional browserSession {profileName, homeUrl?} descriptor extends the existing manifest check-script seam, with publication-scoped URL resolution and scoped parent/child profile-lease ownership without importing publisher code into the CLI. The design and full canonical/alias map are in [kk-noun-verb-bots.md](design/kk-noun-verb-bots.md). Existing plugin status/check/login contracts remain unchanged.

**Rendered collection substrate (0346, ADR-038 amendment 2026-11-09).** The same descriptor is now legal on `kind: ingestion` (still requiring its `check` probe), and a bounded runner `runBotCollection(profileName, plan, options?)` ships as the `@gobing-ai/publish-harness/bot-collection` sub-path. Boundary: the harness executes a JSON-serializable ordered plan (`request | navigate | wait | click | scroll | extract`) plus declarative response captures in **one** headless persistent context under **one** lease acquisition and **one** launch; the plugin owns selectors, pagination, politeness and `Doc[]` mapping; fan-in and the CLI are untouched (the plugin child owns the lease for its own collection run, so no parent-side lease coordination exists). `browser.ts` never imports the collection module — the dependency is one-way, so existing browser consumers do not load the runner. Validation, deadline arithmetic, body/artifact caps and cleanup live in the runner; classification is fail-closed (`authentication` for an explicit 401/403 or a final URL whose path carries a login/signin/auth/sso segment, `browser` for other explicit ≥400 statuses and transport/read/timeout faults, `empty` for a declared capture or extract step that yields nothing). Diagnostics name only the safe step/capture id: never a query, fragment, header or cookie value, request data or body. Limits, not certifications: live sites, anti-bot behavior, binary/media payloads and adapter special state are out of scope, and verification is loopback-only.


### ITC extensibility (G21 — sponsored by ADR-040; tasks 0298–0303 shipped)

ADR-040 as amended selects a top-level DAG with a child authoring FSM and the existing executor, while moving channel planning contracts into discovered publish plugins. Config-driven workspace allocation and versioned SEO evidence handoffs share the run envelope; G9 remains independently deployable. Collected-topic mode reads the existing store; decisions recommend within validated choices; topic presets express editorial targets. Plans and per-target receipts bind recovery to input identity. Mechanism and migration: [kk-itc-refactor.md](design/kk-itc-refactor.md).

## Daily AI News editorial delivery (ADR-054, L3 accepted design)

News generation reconciles evidence-backed editorial judgments between final selection and script writing. The news editorial skill authors the proposed changes. The deterministic step validates and atomically commits them to the durable `<works_dir>/kk-news-generate/conclusion.md` ledger and supplies a run-scoped snapshot. Works cleanup and backup procedures treat this ledger as an ADR-042 exception alongside the store.

The frozen news bundle carries one episode title and the final editorial references. Podcast and image plugins own their output formats, and the shared publish workflow remains the single dispatch path. The [L3 design](design/daily-ai-news-editorial-delivery.md) specifies replay, notes, crop and channel-readiness behavior.
