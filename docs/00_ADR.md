---
name: Architecture Decision Record
doc: 00_ADR
owns: WHY — which cross-cutting decision was made, and the one-line reason
authority: authoritative
version: 1.18.0
created_at: 2026-05-28
updated_at: 2026-08-16
edit_rules: 99 §6.1
sync: [T1, T2]
---

# 00 — Architecture Decision Record (CLI)

> **Status:** Accepted · **Date:** 2026-05-28 · **Scope:** project-wide, binding.
>
> This is the authoritative architecture decision record for **knowledge-kit**. `AGENTS.md`
> points here; changes that contradict a decision below must supersede it with a new dated entry,
> not diverge silently.

## Context

A Bun + TypeScript + Biome **command-line tool** with shared workspace packages under the
`@gobing-ai/*` scope. The design optimizes for a clean separation between the CLI shell and
reusable logic, testable command output, and a workspace layout that can grow more packages
without restructuring.

---

## ADR-001 — Turborepo + Bun-workspaces layout

**Decision.** The project is a Bun-workspaces monorepo:

```
apps/cli/            # @gobing-ai/knowledge-kit (Commander binary)
packages/utils/      # @gobing-ai/utils (helpers, zod, logger)
tooling/typescript/  # shared tsconfig presets
```

Workspaces reference each other only via `@gobing-ai/*` aliases (`workspace:*` dependencies).

**Rationale.** Separating reusable logic from the command shell keeps logic unit-testable in
isolation and reusable if a second app appears.

**Consequences.** The root pins `packageManager: bun@1.3.14`. New shared code becomes a new
`packages/*` workspace, not a folder inside `apps/cli`.

---

## ADR-002 — Commander as the CLI framework

**Decision.** Commands are defined with **Commander** in `apps/cli/src/cli.ts` via a
`createProgram()` factory; `src/index.ts` is a thin `#!/usr/bin/env bun` entry that calls
`createProgram().parse()` guarded by `import.meta.main`.

**Rationale.** Commander gives declarative subcommands, argument parsing/coercion, and
help/version generation. Returning the program from a factory makes the command tree
constructable in tests without invoking `process.argv`.

**Consequences.** New subcommands are registered inside `createProgram()`. The factory must stay
side-effect-free at construction.

### Amendment — 2026-08-12 (register-per-command; ADR-010)

`createProgram()` remains the side-effect-free factory. New nouns are registered by
`registerXCommand` modules under `apps/cli/src/commands/`; `createProgram()` only wires name,
version, global options, and those register calls. Action bodies do not grow `cli.ts`. `index.ts`
no longer calls `createProgram().parse()` — it is `process.exit(await main())` under
`import.meta.main`, and `main()` owns `parseAsync` and the exit seam. See ADR-010 R2/R3.

---

## ADR-003 — `@gobing-ai/*` workspace aliases as the only cross-package boundary

**Decision.** `apps/cli` consumes packages exclusively through `@gobing-ai/*` workspace aliases
(e.g. `import { add } from '@gobing-ai/utils'`). Deep relative imports into a sibling package are
forbidden.

**Rationale.** Aliases keep the package boundary explicit and refactor-safe. `workspace:*`
ensures the local source is always linked.

**Consequences.** Public API of each package is its `src/index.ts` (or `exports` map). zod is
re-exported through `@gobing-ai/utils` so every workspace gets one consistent copy.

---

## ADR-004 — Testable structured output; `.ts` bin under Bun

**Decision.** Command output goes through the shared `logger` in `@gobing-ai/utils` (`out` /
`info` / `error`). The binary is declared as `bin: { knowledge-kit: "./src/index.ts" }` — a
TypeScript entry that runs only under Bun.

**Rationale.** Centralizing output keeps assertions free of ad-hoc format coupling. Shipping a
`.ts` bin leans on Bun's native TS execution.

**Consequences.** The `.ts` bin cannot be resolved by plain `node`. To ship for Node consumers,
run `bun run build` and repoint `bin` to `dist/index.js` before publishing.

### Amendment — 2026-07-22

1. Production code uses `logger` from `@gobing-ai/utils` (stdio via Bun write APIs).
2. Workspace scope is `@gobing-ai/*`; product package is `@gobing-ai/knowledge-kit`.

### Amendment — 2026-08-12 (operator binary `kk`; ADR-010)

Primary npm `bin` is `kk` → the Bun-target bundle `dist/index.js`. `knowledge-kit` is a
compatibility alias for the same artifact. Dev still runs `bun run src/index.ts`. See ADR-010 R1/R5.

---

## ADR-005 — Biome as the only formatter/linter (2026-07-22)

**Decision.** Lint and format are **Biome only** — pinned as root `devDependency`
`@biomejs/biome` and in `.prototools` (currently **2.5.5**). No ESLint, no Prettier.

**Rationale.** A single pinned version avoids “schema vs CLI” drift from a system-wide Biome
binary. `bun run lint` / `format` resolve the local binary via Bun’s `node_modules/.bin`.

**Consequences.** Prefer `bun run lint` over bare `biome` on PATH. Upgrade Biome only by bumping
both `package.json` and `.prototools` (and `biome.json` `$schema`) together.

### Amendment — 2026-07-22 (init toolchain bump)

At project initialization, dependencies were refreshed to latest published versions
(`bun outdated` → install Latest column), including Biome **2.5.5**, Commander **15**, and Zod **4**.

---

## ADR-006 — knowledge-kit is a plugin-based knowledge platform (2026-07-23)

> **Status:** Accepted (Amended in part by ADR-007) · **Supersedes:** the "minimal CLI monorepo" product framing of the prior
> `01_PRD` (v1.1.0). This is a product pivot, not a toolchain change — ADR-001..005 (layout,
> Commander, `@gobing-ai/*` boundary, testable output, Biome) remain the substrate.
> **Forward Pointer:** See `ADR-007` (2026-08-02) for the repositioning of knowledge-kit as an ingest → create → publish platform where creation and publishing are first-class co-equal scope, ingestion is optional (`Doc[] | Brief`), and sequential fan-in/fan-out is owned by `kk`.

**Decision.** knowledge-kit is a **collection of agentic knowledge-management plugins** — an
**ingest → generate → publish** pipeline over knowledge in multiple formats — delivered as Claude
Code–style plugins, distributed by `superskill install`, and orchestrated by `spur` (first-class
harness). The first plugin collection is `plugins/kk`. The platform defines **three typed plugin
kinds** — `IngestionPlugin`, `ContentGeneratorPlugin`, `PublishPlugin` — as TypeScript contracts
discovered by a registry. **Orchestration is `spur workflow`**; a bespoke `kk run` runtime CLI is
**deferred (YAGNI)** until a concrete need appears. The `apps/cli` binary
(`@gobing-ai/knowledge-kit`) hosts the shared runtime / SDK.

**Sub-decisions (Phase 1 = "Foundation + STORM"):**

1. **Plugin model** — typed contracts + registry (the type / discovery layer), orchestrated by
   `spur workflow`; not a custom DAG runtime. The framework is the *contract* layer; Spur owns
   execution. (Refines an initial "formal runtime framework" lean toward a spur-orchestrated
   hybrid.)
2. **Ingestion (Karakeep)** — reads an **rclone-synced local folder** mirroring the Karakeep R2
   bucket, as a normal filesystem. Direct R2 API access is out of Phase 1; the sync is an
   out-of-band precondition.
3. **Generators** — reuse-first, lazy Python→TS. The Phase-1 generator wires an **existing agent
   skill** to the contract; an own **STORM** implementation (ref `vendors/storm`) is Phase 2.
4. **Publish** — **rewrite-with-tests**, not reuse: the `wt` publish skills lack unit tests, so
   reusing them as-is would inherit that risk. Phase 1 rewrites **only Surfdash** (the one target
   the reference vertical needs) behind a reusable test harness; the other 9 targets are a Phase-2
   tested-rewrite epic. Every publish rewrite is preceded by a **wt-publish audit**.
5. **Reference vertical** — Karakeep-local → generator → Surfdash, proven end-to-end via a
   `spur workflow`, is the Phase-1 acceptance demo.

**Rationale.** The plugin taxonomy matches the shape of existing assets: `wt` already carries a
generator suite and 10 publish targets, and Karakeep / Surfdash sit at the ingest / publish ends.
Making ingest→generate→publish a composable, tested pipeline converts scattered collection plus
manual per-platform publishing into a re-runnable workflow. Leaning on `spur workflow` avoids
building a runtime before the domain is proven.

**Consequences.** The feature tree (`05_FEATURES`, letter IDs **A–I**) and roadmap (`02_ROADMAP`)
derive from this ADR. The prior PRD Non-Goals about "multi-mode scaffolding / convergence" are moot
— those addressed a template product; knowledge-kit is now explicitly multi-plugin. `plugins/kk`
graduates from an empty skeleton to the platform home. The **LLM wiki**
(`vendors/llm-wiki.md`, `gbrain`, `deepwiki-open`, `openwiki`) remains **undecided** — parked as map
fog (feature **I**), pursued only after a go/no-go spike.

### Amendment — 2026-07-29 (feature tree restructure, A1)

Feature tree reorganized under foundation hygiene (**A1**) before Phase-1 plugin implementation:

- Kind-aligned parents: **C Ingestion**, **D Content generation**, **E Publish** (instances are children).
- **B4 CLI surface** under Plugin platform.
- **E2E composition proof** is **B5** (under B), not a root letter — root **F** cancelled (folded into B5; B3 Notes point at B5).
- Roots **G** / **H** **cancelled**: multi-channel publish notes fold under **E**; STORM / wt generator harvest become **D4** / **D5**.
- Mapping SSOT: `docs/plans/feature-tree-restructure-map.md`. Letter IDs **A–I** remain; F/G/H are historical cancelled roots only.

### Amendment — 2026-08-12 (F repurposed)

Root **F** is no longer a cancelled root. It is repurposed as the **kk plugin collection** parent: all `plugins/kk` capabilities (agent skills, slash commands, subagents) live under F or a child feature; kk-judge migrated **B7 → F1** (intake task `0038`). The 2026-07-29 statement "F/G/H are historical cancelled roots only" now holds for **G/H only**. The cancelled F slot was freed by removing its file (`cancelled` is terminal in spur — no lifecycle transition out); the allocator re-minted F as the first free root letter.

### Amendment — 2026-08-12 (WT topic-core harvest rehomed D5 → F2)

The WT agent-skill harvest moves from **D5** to **F2** under the kk plugin collection; its first
delivery is one fat `topic` skill covering topic-core authoring. **Why:** `plugins/kk` agent
capabilities belong under F, while D remains the home for product `generator` plugin instances.

### Amendment — 2026-07-24 (plugin model concretized, sub-decision 1)

Planning feature **B** resolved sub-decision 1 to a **skill-first** shape, grounded in the D1/E1
research (the real instances are an agent skill + a Node CLI, not TS classes):

- **A plugin is a directory with a `plugin.json` manifest** — `{ name, kind, entry }`, where
  `kind ∈ {ingestion, generator, publish}` and `entry` names the skill or command that runs it.
- **The "typed contract" is a DATA contract**, not in-process TS interfaces with methods: Zod
  schemas for `Doc` / `Content` / `Result` in a new `@gobing-ai/kk-core` package (new `packages/*`
  per ADR-001), exchanged as files/JSON between steps.
- **`kk invoke <plugin> --in <f> --out <f>`** is the uniform entrypoint a spur workflow step calls
  — a subcommand of the knowledge-kit binary (per ADR-002) that resolves the manifest entry,
  validates IO against the kind's contract, runs the skill/CLI, and **fails loud** (dropping the
  `postsurfing` "always exit 0" anti-pattern found in audit 0002). It is a single-plugin invoker,
  **not** the deferred DAG runtime. **Amended 2026-08-12 by ADR-011:** the canonical path is
  `kk executor run`; `invoke` remains a hidden alias.
- **Discovery** = filesystem scan of `plugins/*/plugin.json` grouped by kind (feature B1).

This supersedes the earlier reading of "TypeScript interfaces … with lifecycle methods" as
in-process classes; the methods are the ingest→generate→publish step sequence spur workflow runs.

### Amendment — 2026-08-12 (kind-collection layout; supersedes one-level discovery)

The one-level scan `plugins/*/plugin.json` is superseded by **ADR-009**. Product plugins live
under kind collections (`plugins/ingestions|generations|publishings/<name>/plugin.json`);
`plugins/kk` is the Claude Code capability plugin and is never a kk-core registry entry.

### Amendment — 2026-08-02 (repositioned as ingest-create-publish platform, ADR-007)

`ADR-007` amends `ADR-006` to reposition knowledge-kit as a spur-orchestrated **ingest → create → publish** platform. Creation and publishing are first-class co-equal capabilities, not downstream consequences of ingestion. Ingestion is optional (`Doc[] | Brief`). Substrate decisions (plugin manifest format, data contract, `kk invoke`, registry discovery) remain binding.

### Amendment — 2026-08-12 (two-layer CLI nouns; ADR-011)

The uniform step entrypoint is **`kk executor run`**. `kk invoke` is a hidden compatibility alias.
Registry inspection is **`kk plugin status`**. See **ADR-011**.

---

## ADR-007 — Reposition knowledge-kit as an ingest-create-publish platform (2026-08-02)

> **Status:** Accepted · **Amends:** ADR-006 (replaces the narrow ingestion-centric product framing and `generate(Doc[])` signature).
> **Scope:** project-wide, binding.

**Decision.** knowledge-kit is a spur-orchestrated **ingest → create → publish** platform.
1. **Product framing (R1):** Creation and publishing are first-class co-equal capabilities, not downstream consequences of ingestion.
2. **Historical name (R2):** The name `knowledge-kit` is historical and deliberately retained; renaming was considered and rejected on migration cost against zero capability gain.
3. **Optional ingestion (R3):** Ingestion is optional: the content generator contract widens from `generate(Doc[]) → Content` to accept a `Brief` as an alternative input shape (`Doc[] | Brief`), making topic → article a first-class pipeline. Mechanism is delegated to `docs/03_ARCHITECTURE.md` and `docs/04_DESIGN.md` (ticket 0032).
4. **Sequential fan-in and fan-out owned by `kk` (R4):** Fan-in (N `docs.json` → 1) and fan-out (1 `content.json` → N publishers) are owned by `kk` as sequential step invocations on the existing workflow engine. This decision is grounded in empirical source analysis showing `type: parallel` in `@gobing-ai/ts-dual-workflow-engine@0.4.14` is a schema stub with no executor (`src/types.ts:77`, `src/schema.ts:100`, `schemas/transition-flow-workflow.schema.json:38`). Engine-level concurrency is explicitly deferred, not rejected.
5. **Partial-success publish semantics (R5):** Fan-out publish yields partial success where successful targets remain published and individually re-runnable, while the overall execution fails loud with a non-zero exit code. This reconciles against the fail-loud hardening of tasks 0023/0025 and avoids the `postsurfing` always-exit-0 anti-pattern from audit 0002 — stating why partial success is not a regression.
6. **Relationship to ADR-006 and substrate continuity (R6, R7):** ADR-007 amends ADR-006 in part (superseding the narrow ingestion-centric product framing and single input signature), while ADR-001..005 (layout, Commander, `@gobing-ai/*` aliases, testable output, Biome) and ADR-006 substrate decisions (plugin manifest, data contract, `kk invoke`, registry discovery) are unaffected and remain binding.

**Why.** Repositioning knowledge-kit to cover creation and multi-channel publishing explicitly reflects the shipped platform reality, while widening inputs to `Doc[] | Brief` and keeping fan-out execution sequential inside `kk` delivers robust creation and publishing pipelines without premature engine complexity.

**Detail:** `docs/01_PRD.md` (v3 re-cut, ticket 0031), `docs/03_ARCHITECTURE.md` / `docs/04_DESIGN.md` (contract design, tickets 0032–0034), `docs/features/J_reposition-knowledge-kit-as-an-ingest-create-publish-platform-wayfinder-map.md`.

### Amendment — 2026-08-12 (R2 package name vs operator binary)

R2 retains the **package** name `knowledge-kit` / `@gobing-ai/knowledge-kit`. The
**operator-facing binary** is `kk` (ADR-010). This is not a package rename.

### Amendment — 2026-08-07 (LLM-as-judge repositioned to agent skills; supersedes 2026-08-02 judge-kind amendment, ticket 0037)

> **Status:** Accepted · **Supersedes:** the 2026-08-02 amendment on this ADR (fourth plugin kind `judge`).

Ticket 0037 repositioned LLM-as-judge from a **fourth plugin kind** to an **agent-skill-centric model**.
The 2026-08-02 amendment is superseded in full:

- **Plugin taxonomy reverts to three kinds:** `kind ∈ {ingestion, generator, publish}`. No `judge`
  kind exists in `PLUGIN_KINDS`, `kindContract`, `PluginManifestSchema`, or the `kk plugin status` CLI.
  This is the taxonomy shipped in `@gobing-ai/kk-core` (`packages/kk-core/src/kinds.ts`) — the
  runtime never gained a fourth kind, so this is a doc-only correction.
- **LLM-as-judge is delivered via agent skills + `agent.run`.** Evaluation rubrics, prompt templates,
  and verdict emission live in a **fat skill** (`plugins/kk/skills/judge`). Specialized personas
  (tech-accuracy, brand-tone, compliance) are **thin wrappers** (slash commands / subagents) that
  delegate to the fat skill. No engine changes are required: `agent.run` is an existing spur action
  kind that writes a verdict file; a `shell`/`jq` guard reads the verdict payload to gate transitions.
- **Verdict contract** (`PASS` / `FAIL` / `NEEDS_REVISION` + reasoning) is defined by the skill's
  output format and validated by a `VerdictSchema` utility in `@gobing-ai/kk-core`, but it is **not**
  wired into `kindContract` — the verdict is a skill output, not a plugin-kind contract.
- **Rationale:** the fourth-kind model (0034) added platform surface (contract + registry branch +
  CLI enum) for a capability that is more naturally an agent skill. Skills allow prompt/rubric
  iteration without recompiling or changing manifests, and compose with the existing `agent.run` +
  shell-guard pattern with zero engine work. The codebase never implemented the fourth kind, making
  the rollback a documentation-only correction.
- **Historical note:** the 2026-08-02 amendment and tasks 0034/0035/0036 are retained as historical
  records of a decision that was subsequently superseded. This amendment records the supersession.
- **Amendment (2026-08-11):** corrects the preceding paragraph — no `VerdictSchema` utility exists
  in `@gobing-ai/kk-core`, nor was one built by ticket 0037 (`packages/kk-core/src/schemas.ts`
  exports `Doc` / `Content` / `Result` / `DocList` only). The verdict contract is defined by the
  `judge` skill's output format (`plugins/kk/skills/judge/SKILL.md` §Verdict output contract)
  and validated by the workflow's `shell`/`jq` guard on the verdict payload. The "validated by a
  `VerdictSchema` utility" phrasing is withdrawn; nothing else in this amendment changes.

---

## ADR-008 — Publish transports: one shared `PublishTransport` contract, `file-cli` first (2026-08-12)

> **Status:** Accepted · **Date:** 2026-08-12 · **Records:** the E2 transport decision (tasks
> 0018/0019, 2026-07) that shipped as `@gobing-ai/publish-harness` and until now lived only in
> `docs/design/publish-plugin-specification.md` §2. Recorded here as binding at the first
> multi-channel harvest (E4: `zenn-pub`, `qiita-pub`).

**Decision.** Every publish plugin implements the shared `PublishTransport` abstraction from
`@gobing-ai/publish-harness` with two transport kinds: `file-cli` — anything the plugin process
executes itself, whether a child-process CLI (Surfdash `postsurfing`, Zenn CLI via `npx zenn`) or
a token-API call made by the plugin (Qiita API v2 via `fetch`) — and `browser` (Playwright
automation; **deferred** until a target requires it). Target-specific `Content` → frontmatter/body
mapping stays inside the plugin (no shared mapper, no per-target core schema, no new transport
kind); secrets are env-only (spec §2.4). Fan-out sequencing over the channels is `kk`'s job
(ADR-007 R4), not the transport's.

**Why.** Classifying by execution mechanism rather than network usage lets token APIs (Qiita)
reuse the same offline-testable harness (`FakeFileCliTransport`) as local CLIs, so a third
transport kind is never needed.

**Detail:** `docs/design/publish-plugin-specification.md` §2, `docs/03_ARCHITECTURE.md` (module
boundaries), `docs/04_DESIGN.md` §3–§4, feature E4.

---

## ADR-009 — `plugins/` is four fixed collections (2026-08-12)

> **Status:** Accepted · **Date:** 2026-08-12 · **Amends:** ADR-006 discovery (one-level
> `plugins/*/plugin.json`). **Scope:** project-wide, binding.

**Decision.** The `plugins/` tree has exactly four top-level collections:

| Collection | Holds | Manifest `kind` |
|------------|-------|-----------------|
| `plugins/ingestions/<name>/` | product ingestion plugins | `ingestion` |
| `plugins/generations/<name>/` | product generator plugins | `generator` |
| `plugins/publishings/<name>/` | product publish plugins | `publish` |
| `plugins/kk/` | Claude Code capability plugin | not a kk-core kind |

1. **Product plugins** are directories with a kk-core `plugin.json` (`name`, `kind`, `entry`)
   and live only under the matching kind collection. `kind` MUST match the collection.
2. **Agent capabilities** (skills, slash commands, subagents, hooks, rules) live only under
   `plugins/kk/` (`skills/`, `commands/`, `agents/`, `hooks/`, `rules/`). They are not plugin
   kinds and are not registered by `discoverPlugins`.
3. **Discovery** scans kind collections only (`plugins/<collection>/*/plugin.json`). A
   `--plugins-root` that *is* a kind collection scans that collection's children. `plugins/kk`
   is skipped even if it has a Claude Code `plugin.json`. A kk-core `plugin.json` at
   `plugins/<name>/` (top-level, outside a collection) is `misplaced`; a kind that does not
   match its collection is `kind_mismatch`.
4. **Workspaces** are `plugins/ingestions/*`, `plugins/generations/*`, `plugins/publishings/*`.
   `plugins/kk` is not a Bun workspace.

**Why.** Kind-aligned folders keep product plugins and agent capabilities from mixing, and
make a plugin dropped at `plugins/<name>` a doctor/rule failure instead of a silent layout
fork.

**Detail:** `docs/03_ARCHITECTURE.md` layout, `docs/04_DESIGN.md` §1.7, `docs/design/ingestion-plugin-specification.md` §1.5.

### Amendment — 2026-08-13 (multi-root discovery; ADR-012)

Clause 3 still governs **per-root** layout and diagnostics. Default runtime discovery is no
longer a single CWD `./plugins` scan — see **ADR-012**. `--plugins-root` remains the exclusive
single-root override and still obeys this layout.

### Amendment — 2026-08-14 (capability names omit the plugin prefix)

`superskill install kk` prefixes every skill, slash command, and subagent with the plugin name
`kk`. Capability files under `plugins/kk` therefore **must not** start with `kk-` (else install
yields `kk:kk-judge`). Current names: `judge`, `topic`, `storm-research`, `/workflow-run`,
`judge-tech` / `judge-tone` / `judge-compliance`. Product workflow YAML stems (`kk-storm-research`)
are not installable agent capabilities and keep their existing names.

---

## ADR-010 — Product CLI: `kk` binary, register-per-command tree (2026-08-12)

> **Status:** Accepted · **Date:** 2026-08-12 · **Amends:** ADR-002 (registration + parse site),
> ADR-004 (bin name/path), ADR-007 R2 (package vs operator binary). Feature **A2** — shipped
> 2026-08-12 (tasks 0049–0051).

**Decision.** The product CLI is the `kk` binary published as `@gobing-ai/knowledge-kit`.

1. **Operator binary (R1):** `program.name` and the primary npm `bin` key are `kk`. The package
   name `@gobing-ai/knowledge-kit` is unchanged. A `knowledge-kit` bin alias points at the same artifact.
2. **Command modules (R2):** Each noun lives in `apps/cli/src/commands/<noun>.ts` as
   `registerXCommand(program)`. `createProgram()` stays the side-effect-free factory and only
   wires name, version, global options, and register calls.
3. **Exit seam (R3):** `main(argv) → number`. Command actions must not call `process.exit`. Only
   the `import.meta.main` entry may exit.
4. **Version (R4):** Commander `--version` / `-V` prints `apps/cli/package.json` `version`.
5. **Publish artifact (R5):** npm ships the Bun-target bundle (`dist/index.js`). `prepack` builds
   it so `npm pack` sees `bin.kk`. Native `bun --compile` binaries and npm Trusted Publisher /
   GitHub OIDC are out of this decision.
6. **Globals (R6):** `--help`/`-h`, `--version`/`-V`, `--verbose`/`-v`. `--json` stays per-command.

**Why.** Docs and workflows already say `kk`; a single `cli.ts` cannot grow; a lying version and
a missing bin file cannot be published honestly.

**Detail:** `docs/design/kk-cli-surface.md`, `docs/03_ARCHITECTURE.md` (CLI entry), feature A2.

### Amendment — 2026-08-12 (two first-layer nouns; ADR-011)

R2's register-per-noun tree now has exactly two first-layer nouns: `executor` and `plugin`. The
scaffold `add` command is retired. Hidden aliases preserve `invoke` / `fanin` / `fanout` /
`plugins *` for one release. See **ADR-011**.

---

## ADR-011 — Two-layer `kk` CLI nouns: `executor` + `plugin` (2026-08-12)

> **Status:** Accepted (shipped — A21; amdt 2026-08-12) · **Date:** 2026-08-12 · **Amends:** ADR-006 (named `kk invoke`
> entrypoint), ADR-007 R6 (substrate wording), ADR-010 R2 (which nouns exist). Feature **A21**.

**Decision.** The operator-facing `kk` tree is a two-layer noun+verb surface.

1. **Nouns (R1):** First-layer nouns are exactly `executor` and `plugin`. Globals
   (`--help`/`--version`/`--verbose`) are not nouns.
2. **Executor (R2):** `kk executor run` is the uniform single-plugin step (former `kk invoke`).
   `kk executor fan-in` and `kk executor fan-out` are the sequential merge and publish-dispatch
   steps (former `kk fanin` / `kk fanout`). Hyphenated names are canonical.
3. **Plugin (R3):** `kk plugin status` is the only inspection verb. It replaces `plugins list` and
   `plugins doctor`: inventory plus health, including tree-level discovery diagnostics. Exit `1`
   when any diagnostic exists.
4. **Compatibility (R4):** Hidden one-release aliases keep `invoke`, top-level `fanin`/`fanout`,
   `plugins`, `plugins list`, and `plugins doctor`. Docs and the B3 workflow template use the new
   names in the implementing commit.
5. **Retirement (R5):** `kk add` is removed.

**Why.** A mixed-depth tree (`add` + three first-layer verbs + `plugins *`) cannot grow without
inventing a third shape; `executor` is the step runner ADR-007 already assigned to `kk`.

**Detail:** `docs/design/kk-cli-surface.md`, feature A21.

### Amendment — 2026-08-12 (shipped; A21)

Feature A21 shipped with task 0052: `kk executor run|fan-in|fan-out` and `kk plugin status` are
live in `apps/cli` (`registerExecutorCommand` / `registerPluginCommand`). Hidden one-release
aliases `invoke` / top-level `fanin` / `fanout` / `plugins *` reach the same engines and are not
listed in `kk --help`; `kk add` is removed. Status moves from `Accepted (design)` to `Accepted`.

---

## ADR-012 — Multi-root plugin discovery; built-ins ship with kk (2026-08-13)

> **Status:** Accepted · **Date:** 2026-08-13 · **Amends:** ADR-006 discovery,
> ADR-009 clause 3 (scan is per-root; default runtime is a merge). Feature **B7** (shipped — task 0053).

**Decision.** Product-plugin discovery is a **merged multi-root scan** in `@gobing-ai/kk-core`.

1. **Same contract every root (R1):** built-in and default-global roots are ADR-009
   kind-collection trees. User-supplied plugins use the same `plugin.json` + `kind`/`entry`
   contract. `plugins/kk` is never a kk-core registry entry. Injected extra paths may also
   be a single `plugin.json` directory (see R6 amendment).
2. **Built-ins are packaged, not statically imported (R2):** kind collections staged by
   `bundle-plugins` ship with `@gobing-ai/knowledge-kit` and are a default discovery root,
   resolved from the package (not from CWD). They are on-disk directories discovered at
   runtime. They do not go through spur PluginHost, workflow action/guard extensions, or a
   compile-time import table.
3. **Default roots (R3), low → high (later wins on `name`):** (1) package-shipped built-in
   tree; (2) `~/.kk/plugins` if present; (3) CWD `./plugins` if present and not the same
   realpath as (1); (4) `KK_PLUGIN_PATH` colon-separated extra roots. A same-name collision
   registers the higher-priority plugin and emits a diagnostic naming both paths.
4. **`--plugins-root` is exclusive (R4):** the flag stays a single-root override (tests and
   isolation). It does not merge with the default roots.
5. **Workflow YAML is composition, not discovery (R5):** a pipeline names plugins via
   `kk executor run|fan-out`. kk does not register product plugins as custom workflow
   action kinds, and it does not call spur's deferred PluginLoader / plugin-sdk.

**Why.** End users cannot extend kk if the only scan replaces the shipped tree, and an
installed `kk` cannot see packaged built-ins if the default root is CWD `./plugins`.

**Detail:** `docs/design/multi-root-plugin-discovery.md`, `docs/03_ARCHITECTURE.md`
(Multi-root discovery), feature B7.

### Amendment — 2026-08-13 (dynamic extra paths; `~/.kk/plugins` is a default, not a lock)

Operator feedback on B7: a `spur workflow` YAML already injects locations via vars (today
`plugins_root` + `--plugins-root`). Forcing user plugins to live only under
`~/.kk/plugins/<collection>/<name>/` would make runtime path injection pointless.

1. **`~/.kk/plugins` is the default global store (R3 unchanged as a default).** It is not
   the only user-plugin location and it does not replace path injection.
2. **Dynamic extra paths (R6):** repeatable `--plugins-path <dir>` (and `KK_PLUGIN_PATH`)
   **union** with the default roots. A workflow injects any folder this way. An extra path
   may be a plugins tree, a kind collection, **or a single directory that contains
   `plugin.json`**. Extra paths do not drop built-ins or `~/.kk/plugins`.
3. **`--plugins-root` stays exclusive (R4)** for tests and isolation only. It is not the
   workflow injection flag. Combining `--plugins-root` with `--plugins-path` is a usage
   error (exit 2).
4. **R5 restated:** workflow YAML remains the pipeline SSOT. It names plugins via
   `kk executor *` **and** may inject extra discovery folders via `--plugins-path`. It
   still does not register product plugins as custom workflow action kinds.
5. **Two channels (2026-08-13):** (a) product plugins stay `plugin.json` name-lookup
   on the kk registry (built-ins, `~/.kk/plugins`, `--plugins-path`); (b) custom
   workflow **kinds** come from YAML `extensions.actions` / `extensions.guards`
   (rule-style; ts-libs C1 + spur-new D4). B7 does not add `kind: kk.publish` to
   Spur builtins and does not load product plugins as workflow extension modules.

### Amendment — 2026-08-13 (shipped; B7)

Feature B7 shipped with task 0053: `discoverAllPlugins` / `resolvePluginRoots` are live in
`@gobing-ai/kk-core` (origin-stamped `PluginRecord`s, `shadowed` diagnostic, realpath dedupe);
repeatable `--plugins-path` lands on `kk executor run` / `kk executor fan-out` / `kk plugin
status`; `KK_PLUGIN_PATH` is honored; `--plugins-root` is the exclusive single-root override and
combining it with `--plugins-path` exits `2`. The B3 workflow template injects
`--plugins-path ${vars.plugins_path}`. Status moves from `Accepted (design)` to `Accepted`.

---

## ADR-013 — Per-reference evidence cache + report digestion in STORM (2026-08-15)

> **Status:** Accepted · **Date:** 2026-08-15 · **Amends:** the frozen 0056 works
> layout (adds `references/`) · **Feature:** C5 (shipped 2026-08-16).

**Decision.** The STORM research workflow gains a durable per-reference evidence cache,
owned by the `web-search` ingestion plugin. After search returns `Doc[]`, each source with
a usable URL is fetched via Firecrawl `/v2/scrape` (`formats: ["markdown"]`), normalized
with the installed `markitdown` binary (PATH, availability-checked), written to
`works/<topic-id>/references/<doc-id>.md`, and the normalized text becomes the Doc body in
`docs.json` — the Doc[] shape is unchanged. Per-URL scrape failures are non-fatal: keep the
search-snippet body and warn; the ingest still exits 0. The cache is keyed by Doc id
(`sha256(sourceUri)` 16-hex), so an existing cached file is reused without a new scrape.
Report craft becomes contract in the same change: content-gen must synthesize findings
across sources (digest, don't index), and render's tail is a compact References list whose
cite ids resolve to cached files, with no `## Outline` replay. Fail-loud rules: live mode
with `markitdown` missing on PATH exits 1 naming it and writes no `docs.json`;
`fixture: true` never scrapes and needs neither the key nor the binary.

**Why.** Re-running ingest today re-fetches everything and Doc bodies carry Firecrawl search
boilerplate; a durable per-source cache plus normalized bodies delivers an auditable
evidence trail, cleaner/smaller generation context, and re-run reuse with no new workflow
states, `kk` noun, or package dependency.

**Detail:** `docs/design/storm-evidence-cache.md`, `docs/03_ARCHITECTURE.md`
(Evidence cache and report digestion), feature C5.

---

## Decisions deliberately deferred

- **Config / persistent state** — none yet; add as a `packages/*` workspace when needed.
- **Interactive prompts, colored output** — out of scope until a command requires them.
