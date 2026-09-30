---
name: Architecture Decision Record
doc: 00_ADR
owns: WHY — which cross-cutting decision was made, and the one-line reason
authority: authoritative
version: 1.29.0
created_at: 2026-05-28
updated_at: 2026-09-25
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

### Amendment — 2026-08-16 (output ownership superseded by ADR-015)

ADR-015 supersedes ADR-004's `@gobing-ai/utils` output ownership. The binary decision and its
2026-08-12 amendment remain in force.

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

### Amendment — 2026-09-10 (executor owns invocation completion)

**Status:** Accepted; enforced by the executor (task 0110, shipped 2026-09-10).

**Decision.** The executor owns the completion boundary: success requires output produced by
this invocation, valid under its declared contract, and a successful domain result. A child exit
code alone is insufficient. Plugin-specific rendering operations must not weaken validation for
an entire kind; the generic publish contract remains `Content → Result`.

**Why.** Stale files, `ok: false` results, and the podcast array-input exception currently pass
through independent gaps in the generic success path.

**Detail:** `docs/03_ARCHITECTURE.md` → Execution boundary integrity; task 0110 I3/I5/I6.

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

### Amendment — 2026-08-19 (fat skill renamed `content-judge`; persona subagents retired)

> **Status:** Accepted · **Amends:** the 2026-08-07 skill-centric amendment on this ADR.

- **Fat skill path and install id.** Evaluation rubrics, prompt templates, and verdict emission
  live at `plugins/kk/skills/content-judge` (install id `kk:content-judge`). The former directory
  `plugins/kk/skills/judge` and install id `kk:judge` are retired. The verdict contract
  (`PASS` / `FAIL` / `NEEDS_REVISION`) is unchanged.
- **No persona subagents.** `judge-tech` / `judge-tone` / `judge-compliance` wrappers under
  `plugins/kk/agents/` are deleted. Rubric selection is a field on the `agent.run` prompt
  (`tech-accuracy` | `brand-tone` | `compliance` | `general`), or the `--judge` flag on
  `itc-generating`. Do not re-add a thin wrapper unless a new skill owns a distinct run
  procedure.
- **Historical note.** Ticket 0037 and F1's shipped AC still describe the wrappers as of
  2026-08-12. This amendment records the 2026-08-19 retirement; those corpus files stay
  append-only.

---

### Amendment to ADR-007 — 2026-09-10 (retry preserves publication state)

**Status:** Accepted; enforced by the executor (task 0110, shipped 2026-09-10).

**Decision.** A fan-out retry preserves the prior target ledger, including validated artifact
metadata and failures outside the selected retry subset. Selecting fewer targets does not resolve
or remove the others; overall success requires no remaining failed target.

**Why.** Reconstructing only selected outcomes loses both downstream artifact locations and
unresolved publication failures.

**Detail:** `docs/03_ARCHITECTURE.md` → Execution boundary integrity; task 0110 I4/I7.

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

### Amendment — 2026-09-17 (browser drivers; E7)

> **Status:** Accepted (shipped — E7, tasks 0141–0147) · **Amends:** this entry's deferred-browser clause.

- **Browser is no longer deferred.** Leftover wt channels that have no official write API
  (`juejin-pub`, `substack-pub`, `infoq-pub`, `xhs-pub`, `x-pub` `article`) implement
  `kind: 'browser'`.
- **Drivers, not a third kind.** A browser transport declares `driver: 'script' | 'agent'`.
  `script` is Playwright (or equivalent) run inside the plugin process. `agent` means a
  `plugins/kk` skill / workflow `agent.run` drives the page using harness session helpers;
  the plugin process still owns mapping and `Result` and never embeds an LLM. `kind`
  remains `'file-cli' | 'browser'` — a third kind is still forbidden.
- **API/CLI stays `file-cli`.** Medium token API, WeChat `draft/add`, and X `POST /2/tweets`
  are `file-cli` even though they use the network (same rule as Qiita).
- **Why.** Selector-fragile CMS editors need an agent driver for compatibility; official
  APIs stay offline-testable on `FakeFileCliTransport`. Classifying agent as a new kind
  would split the harness and contradict this entry's "third kind is never needed" reason.
- **Detail:** `docs/design/remaining-wt-publish-harvest.md`, `docs/design/publish-plugin-specification.md` §2.2, feature E7.

---

## ADR-009 — `plugins/` is four fixed collections (2026-08-12)

> **Status:** Accepted · **Date:** 2026-08-12 · **Amends:** ADR-006 discovery (one-level
> `plugins/*/plugin.json`). **Scope:** project-wide, binding.

**Decision.** The `plugins/` tree has exactly four top-level collections:

| Collection | Holds | Manifest `kind` |
| ------------ | ------- | ----------------- |
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

### Amendment — 2026-08-19 (capability roster after `content-judge` rename)

Current installable names: `content-judge`, `topic`, `storm-research`, `itc-generating`,
`/workflow-run`. Persona subagents `judge-tech` / `judge-tone` / `judge-compliance` were
retired the same day (ADR-007 amdt 2026-08-19). The 2026-08-14 prefix rule is unchanged.

### Amendment — 2026-08-19 (product workflow YAML home)

Product workflow YAML files live only under `plugins/kk/workflows/` (`kk-storm-research.yaml`,
`kk-ingest-generate-publish.yaml`, `judge-gated-publish-example.yaml`, `kk-itc.yaml`).
`.spur/workflows/` holds only Spur project lifecycle and developer pipeline workflows.
The workflow install copy rule resolves from two roots in order: `$KK_WORKFLOWS_SOURCE`
then `plugins/kk/workflows/`.

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

### Amendment — 2026-09-18 (`stage` is a third first-layer noun)

The shared workflow stage runner landed as a first-layer verb: `kk stage <stage> [args…]`
(commit `1eb6c8d6`, release 0.0.19; feature F8, task 0133). Workflow shell steps call it to reach
`plugins/kk/scripts/kk-workflow-stages.ts` without re-resolving the script path themselves. R1's
"exactly `executor` and `plugin`" is **amended, not superseded**: `stage` runs deterministic
workflow steps, so `executor` remains the uniform single-plugin step and no plugin operation moves
to it. Detail: `docs/04_DESIGN.md` §1.8 and §7.

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

### Amendment — 2026-09-10 (user roots live under `~/.config/kk/`)

All HOME-based user roots conform to `~/.config/kk/` (matching `config.yaml`, `works/`, `workflows/`):

1. **User plugin-discovery root renamed** `~/.kk/plugins` → `~/.config/kk/plugins` (was empty on all
   machines; no migration). The 2026-08-13 text above keeps `~/.kk/plugins` as the historical record.
2. **User preset root renamed** `~/.kk/image-presets` → `~/.config/kk/image-presets`
   (feature M/0109; previously `~/.kk/image-presets` from the image-preset batch).
3. **Predefined preset SSOT stays with the product plugin** (`plugins/generations/image-gen/presets/`):
   presets resolve in place from the installed package; the user root starts empty and fine-tuning is
   single-file shadowing (a user-root file with a builtin name replaces it). No bulk seeding and no
   superskill runtime-asset mechanism — decided 2026-09-10 after superskill source review
   (its installer has no data-dir concept; ADR-012 R1 keeps kind-collection plugins independent of
   `plugins/kk`). Project root `.kk/image-presets` under CWD is project-scoped and unchanged.
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

### Amendment — 2026-09-24 (fan-in honours the root flags)

`kk executor fan-in` also accepts `--plugins-root` (exclusive) and `--plugins-path` (union) for
its `--source` discovery; combining them is a usage error (exit `2`). Task 0157 R3. The ADR-012
decision is unchanged — R4/R6 now apply to the sibling verb too.

---

### Amendment to ADR-012 — 2026-09-10 (packaged entry dependency closure)

**Status:** Accepted; implemented (task 0110, shipped 2026-09-10).

**Decision.** Each shipped product-plugin entry must resolve its runtime dependencies from the
installed distribution, independently of the development checkout and dependency auto-install.
Bundling the CLI does not satisfy the dependency closure of separately spawned plugin entries.
Manifest discovery and the file-based subprocess boundary remain unchanged.

**Why.** Copying source files exposes private workspace imports that the installed package cannot resolve.

**Detail:** `docs/03_ARCHITECTURE.md` → Execution boundary integrity; task 0110 I1.

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

## ADR-014: Centralize ts-libs versions in the Bun workspace catalog

**Status:** Accepted (shipped — A3; tasks 0065–0067) · **Date:** 2026-08-16

**Decision.** The root Bun catalog is the single version source for `@gobing-ai/ts-utils`,
`@gobing-ai/ts-infra`, `@gobing-ai/ts-runtime`, and `@gobing-ai/ts-db`; a workspace declares a
`catalog:` dependency only when it directly consumes that package.

**Why.** One catalog constraint keeps the portfolio dependency line coherent without adding dead
runtime edges.

**Detail:** `docs/design/ts-libs-logging-foundation.md` §1; feature A3.

---

## ADR-015: Separate terminal output from structured diagnostics

**Status:** Accepted (shipped — A3; tasks 0065–0067) · **Date:** 2026-08-16

**Decision.** `@gobing-ai/ts-utils` owns user-facing terminal output and `@gobing-ai/ts-infra`
owns structured diagnostics; every executable process initializes logging once, direct terminal
writes are forbidden in production code, and `@gobing-ai/utils` is retired after its consumers
migrate. This supersedes the output-ownership portion of ADR-004.

**Why.** Reusing the portfolio seams removes a shallow local package while keeping command output
injectable and diagnostics structured.

**Detail:** `docs/03_ARCHITECTURE.md` (Output and diagnostics foundation),
`docs/design/ts-libs-logging-foundation.md` §§2–6; feature A3.

---

## ADR-016: ts-runtime FileSystem is the sanctioned file-IO seam

**Status:** Accepted · **Date:** 2026-08-17

**Decision.** File IO in `apps/**/src`, `packages/**/src`, and `plugins/<kind>/<name>/src` goes
through `createNodeFileSystem()` from `@gobing-ai/ts-runtime`, not `node:fs`. Four sites are
exempt because their public API is synchronous by contract: `apps/cli/src/invoke.ts`,
`packages/kk-core/src/registry.ts`, `apps/cli/src/config.ts`, and
`apps/cli/src/commands/plugin.ts`. Recursive directory scans use `walkDir` from the same package.

**Why.** `ts-runtime` was in the catalog under ADR-014 with zero import sites — a declared
dependency the code never used, while `node:fs` was hand-rolled in 10 files. The seam is also
cycle-safe and root-confined for directory walks, which the previous `readdir({recursive:true})`
scan was not.

**Cost.** `FileSystem` methods return `T | Promise<T>` unions, so every consumer must be async.
That is why the four sync-structural sites stay on `node:fs`: adopting the seam there would make
plugin discovery and CLI config loading async for no behavioral gain. The exemptions carry their
reason inline in `.spur/rules/strict/runtime-boundaries.yaml`.

**Consequence (user-visible).** `FileSystem.writeFile` creates parent directories, so
`kk executor fan-in`/`fan-out` now create a missing `--out` directory instead of failing. This
matches what every ingestion and publish plugin already did. Genuine write failures (an existing
directory at the out path, permission denied) still exit non-zero as before.

**Enforcement.** `no-direct-fs-io` (severity `error`) in the `strict` category, which joined
`recommended-pre-check` on the same date — see ADR-017.

**Detail:** `docs/04_DESIGN.md` §fan-in/§fan-out; feature A3.

---

## ADR-017: Constraint rules cover the plugin tree and run in the default gate

**Status:** Accepted · **Date:** 2026-08-17

**Decision.** `recommended-pre-check` extends the `strict` category, and every rule scoped to
source includes `plugins/*/*/src/**/*.ts` while excluding `apps/cli/plugins/**`.

**Why.** The `strict` rules (`runtime-boundaries`, `http-boundaries`) had been authored and tuned
for this repo but were never reachable: the preset did not extend `strict`, so `bun run spur-check`
never ran them. Their `apps/**` + `packages/**` scope also missed the product plugin tree entirely
while accidentally matching `apps/cli/plugins/**` — the gitignored `bundle-plugins.ts` byte-copy of
`plugins/`. The gate was linting generated output and ignoring the source it came from. The gate
went from 38 to 45 rules with no violations after the ADR-016 migration.

**Consequence.** A rule that names a path under `plugins/` must exempt the *source* path; excluding
only the bundled copy silently exempts nothing, and excluding only the source leaves phantom
findings against build artifacts.

**Detail:** `.spur/rules/recommended-pre-check.yaml`, `.spur/rules/strict/*.yaml`.

---

## ADR-018: Shipped plugin scripts are node-builtin-only

**Status:** Accepted · **Date:** 2026-08-17

**Decision.** Scripts under `plugins/<name>/scripts/**` import node builtins only — no
`@gobing-ai/*` package, including the ts-utils output seam, and no relative path escaping the
plugin directory. They therefore use raw `console.*` and are excluded from `output-boundaries`.
Enforced by `shipped-script-isolation` (severity `error`).

**Why.** These scripts ship inside the Claude Code plugin and the published npm package, then run
in the *user's* project as `bun <script>`. That project has no `@gobing-ai/*` in `node_modules`.
The failure is silent in development because bun auto-installs public packages from the network:
verified 2026-08-17, `bun --no-install plugins/kk/scripts/render-md.ts` failed with
`Cannot find module '@gobing-ai/ts-utils'`, while the same command without the flag quietly
fetched 0.4.38. The seam import therefore turned a "self-contained by design" runner into one
carrying a hidden network dependency — breaking offline, air-gapped, and locked-down CI.

**Cost.** Logic duplication. `plugins/kk/scripts/render-md.ts` already carries a `SYNC:` note
against `packages/kk-core/src/render-md.ts` for exactly this reason, and a characterization test
asserts the two render byte-identical output. That cost is accepted in exchange for a runner with
no dependency footprint.

**Precedent.** spur-new's `plugins/sp/scripts/*.ts` state the same constraint in-file
("Ships with the plugin to arbitrary projects, so it stays node-builtin-only — no workspace
imports") and sit outside its `output-boundaries` scope. This ADR encodes as a rule what that
repo holds by convention.

**Scope note.** Repo-internal `scripts/**` (release, publish, bundle-plugins) is also outside
`output-boundaries`, for the different reason that it is standalone tooling with no logger
bootstrap — mirroring spur-new's `scripts/spur-dev.ts`.

**Detail:** `.spur/rules/boundary/shipped-script-isolation.yaml`,
`.spur/rules/typescript/output-boundaries.yaml`.

---

## ADR-019: Workflow concurrency lives in kk executor fan-in, not the engine

**Status:** Accepted · **Date:** 2026-09-06

**Decision.** `kk executor fan-in` gains a concurrent source-runner mode:
`--source <plugin>:<inputFile>` (repeatable) resolves each named plugin against the merged registry,
spawns every ingestion concurrently through `invoke.ts`'s async spawn seam
(`spawnPluginEntryAsync`, per-source `AbortSignal.timeout` defaulting to 30m), and merges the
surviving `Doc[]` outputs through the existing merge path. A failed or timed-out source degrades to
a `metadata.sourceErrors[]` entry (`{ plugin, error, durationMs }`) instead of aborting siblings;
exit is `0` when ≥1 source succeeded and `1` with no output only when all sources fail. The
workflow engine stays sequential — `type: parallel` remains inert and ADR-007 R4 is unchanged.

**Why.** The kk-daily-ai-voice pipeline ran fetch → ingest-last30days → ingest-horizon → blend-facts
as four sequential workflow states; horizon alone took 20m40s in the 2026-09-06 dogfood. Engine-level
parallelism is off the table by design (ADR-007 R4), and each ingestion is an independent
`kk invoke`-shaped process, so the concurrency belongs at the one step that already owns "many
`Doc[]` → one": fan-in. A separate verb would duplicate the merge/dedupe semantics; extending
fan-in adds depth without a new surface.

**Consequence.** Spawn remains allowlisted to `invoke.ts` only (`no-direct-process-spawn`); fan-in
orchestrates but never spawns directly. Degradation means partial results are usable downstream, but
consumers must check `metadata.sourceErrors[]` rather than assume every configured source
contributed. Timeouts bound a hung source at the cost of killing it mid-run; the default (30m)
exceeds the slowest observed real source.

**Detail:** `apps/cli/src/invoke.ts` (`spawnPluginEntryAsync`), `apps/cli/src/fanin.ts`
(source-runner branch), `apps/cli/src/commands/executor.ts` (`--source`, `--source-timeout`).
Task 0092 (feature L1).

---

### Amendment to ADR-019 — 2026-09-10 (source cancellation owns descendants)

**Status:** Accepted; implemented (task 0110, shipped 2026-09-10).

**Decision.** The executor's source-process boundary owns cancellation and reaping of the
plugin process and its descendants. Reporting a source as timed out must not leave its child
tools running or writing artifacts; healthy sibling sources remain independent.

**Why.** Killing an adapter alone leaves its external ingestion tool outside the timeout boundary.

**Detail:** `docs/03_ARCHITECTURE.md` → Execution boundary integrity; task 0110 I2.

---

## ADR-020: omni-voice-gen — the plugin tree admits one Python plugin (uv-managed)

**Status:** Accepted · **Date:** 2026-09-13 (feature F611, tasks 0121–0126)

**Decision.** `plugins/generations/omni-voice-gen` is a Python project (uv-managed venv,
`make` targets, pytest) — the only non-TypeScript plugin in the repo (operator-approved). It
implements the same executor contract as voice-gen (`--in Doc[] → --out Content`, sibling
`.wav`/`.mp3`) against the PyPI `omnivoice` backend, and is selected in kk-daily-ai-voice via
the `voice_generator` workflow var. Its spawn seam is a bash shebang wrapper
(`bin/omni-voice-gen`) that execs `uv run --project <plugin> python -m omni_voice_gen` — the
executor spawns it exactly like any other plugin entry. The plugin owns its toolchain: it is
not a Bun workspace, Biome and `bun:test` do not cover it, and its quality gate is
`make -C plugins/generations/omni-voice-gen coverage` (per-file line AND function ≥ 90%). The
vendored `vendors/OmniVoice` checkout is reference-only; the dependency resolves from PyPI.

**Why.** OmniVoice's quality (clone fidelity, voice-design instruct mode) required its native
torch stack; a TS port or a Voicebox-compatible REST shim would have forked a fast-moving
upstream model. The plugin contract (`plugin.json` + `--in`/`--out`) is language-agnostic by
design (ADR-009/ADR-011), so confining the second runtime to one plugin dir keeps the blast
radius at one make invocation.

**Cost.** A second toolchain in CI and on operator machines (uv, Python 3.13, torch download);
the Bun gates (`bun run lint`/`test`/`build`) do not see this plugin. Accepted in exchange for
not reimplementing the model.

**Consequence.** ADR-018 is unaffected — omni-voice-gen ships no `plugins/<name>/scripts/**`.
Packaging gap: `scripts/bundle-plugins.ts` Bun-bundles every staged entry to `dist/index.js`
and prunes for a Node-only tree; a Python entry (bash wrapper + `src/*.py` + `profiles.json`
+ `uv.lock`) is not yet handled and is deferred until the npm distribution must carry
omni-voice-gen.

**Detail:** `docs/design/omni-voice-gen.md` (D1–D8), `plugins/generations/omni-voice-gen/`,
`docs/04_DESIGN.md` §3/§4.3.

### Amendment — 2026-09-13 (kk-daily-ai-voice default flips to omni-voice-gen)

> **Status:** Accepted · **Supersedes:** task 0126's "default stays `voice-gen`" decision.

The daily workflow's `voice_generator` var now defaults to `omni-voice-gen`; `voice-gen`
(Voicebox REST) remains shipped and selectable via `--vars`. The shipped `robin-news` registry
entry is an instruct placeholder (voice identity changes until a real clone clip lands in an
operator-private registry via `OMNIVOICE_PROFILE_REGISTRY`).

### Amendment — 2026-09-24 (driver selection is `vdriver`; the default is back to `voicebox`)

> **Status:** Accepted · **Supersedes:** the 2026-09-13 amendment's `voice_generator` var name and
> its `omni-voice-gen` default.

kk-daily-ai-voice selects the voice generator through the **`vdriver`** var (renamed from
`voice_generator` on 2026-09-17, commit `91ef8bc9`). Its values are driver aliases resolved by
`dailyGenerate`'s `VOICE_DRIVERS` map, not plugin names: `voicebox` → `voice-gen` (default),
`ominivoice` → `omni-voice-gen`, `gemini` → `gemini-tts` (F612, ADR-023). An unknown alias still
fails loud, naming the accepted keys. The default flipped back to `voicebox` on 2026-09-20 after an
operator A/B at matched speech rate (~5.2 chars/s): omni-voice-gen carried ~1 min of dead air over
a 16-min episode plus an ASR-garble class.

---

## ADR-021: kk-itc is the end-to-end IT-content workflow (idea → platform drafts)

**Status:** Accepted · **Date:** 2026-09-22 (feature F41, shipped)

**Decision.** `plugins/kk/workflows/kk-itc.yaml` grows var-gated states for the auto path,
de-slop, the judge revise loop, the cover, per-platform adaptation, Content materialization,
multi-platform publish and a run report. New behavior sits behind a var, so default-var runs keep
today's F4 path. Deterministic steps are `kk stage itc-*` helpers in the shared stage runner.
Model steps reuse shipped skills plus one new skill, `kk:article-adapt`. There is no new workflow
file, `kk` noun, slash command or generator plugin.

**Why.** Spur has no sub-workflow action, so one run, one trace and one `--auto` switch from idea
to drafts require one YAML. A second workflow would duplicate the authoring states and thread
`--auto` twice.

**Detail:** `docs/design/kk-itc-end-to-end.md`; mechanism pointer in `docs/03_ARCHITECTURE.md`
→ *kk-itc end-to-end*.

## ADR-022: Publishing defaults to platform drafts; auto never implies live

**Status:** Accepted · **Date:** 2026-09-22 (feature F41, shipped)

**Decision.** A kk workflow that publishes writes every target's own draft switch explicitly on
every Content it sends: `published` for emdash, surfdash, qiita and zenn; `publishStatus` for
medium; `operation` for wechatmp. Live publishing needs an operator-set launch var
(`publish_live=true` in kk-itc). No mode, including `auto`, `KK_NONINTERACTIVE` or a skipped
review, sets it. A target with no draft mode (`x-pub` post) is rejected unless live was
requested.

**Why.** A live post is the one irreversible, external step in the pipeline, and plugin defaults
differ (`zenn-pub` publishes live when `published` is absent). An explicit per-target switch plus
a launch-only live var keeps unattended runs reversible.

**Detail:** `docs/design/kk-itc-end-to-end.md` §5; complements `kk:publish` § Confirmation.

---

## ADR-023: A generator plugin may reuse a sibling generator's library via workspace dependency

**Status:** Accepted · **Date:** 2026-09-24 (feature F612)

**Decision.** `plugins/generations/gemini-tts` depends on `@gobing-ai/voice-gen` (`workspace:*`)
and supplies a Gemini-backed `VoiceboxClient` to voice-gen's `processGeneratorIO`, instead of
copying or extracting voice-gen's VoiceScript/QC/WAV pipeline. voice-gen gains an `exports` entry,
an optional `transcribe`, and an optional generator tag; its behaviour is unchanged.

**Why.** The pipeline (profile resolution, verify-retry, loudness gate, speed, concat, QC, MP3) is
backend-agnostic except for the client, which is already an injectable interface. Reusing it is
the smallest diff and keeps both drivers on one QC contract. `scripts/bundle-plugins.ts` inlines
workspace imports into each plugin's `dist/index.js`, so the dependency does not leak into the
published tarball.

**Cost.** voice-gen's exported surface becomes a contract for a second consumer: a breaking
change there must update gemini-tts in the same commit. If a third consumer appears, extract the
shared pipeline into a `packages/` library rather than chaining plugin-to-plugin imports.

**Detail:** `docs/design/gemini-tts.md` D1.

---

## ADR-024: XHS card planning stays in an agent skill; existing plugins render and publish

**Status:** Accepted · **Date:** 2026-09-25 (feature E8)

**Decision.** `kk:xhs-images` owns content analysis, ordered card planning, and prompt authoring. It invokes `image-gen` with XHS presets for each card and passes ordered image artifacts to `xhs-pub`. `xhs-pub` uses the existing browser transport and an explicit draft/public switch; it reports only browser-observed outcomes. For `xhs` the default driver becomes `script`, which overrides E7's agent default (ADR-008 amendment 2026-09-17; `remaining-wt-publish-harvest.md` D4) for this channel only, because an `agent`-driven page gives the plugin no evidence to build a truthful `Result`. No XHS-specific generator plugin is added.

**Why.** Card planning needs model judgment, while image rendering and publishing already have product plugin seams; a second generator would duplicate the provider stack.

**Detail:** `docs/design/xhs-image-cards.md`; mechanism in `docs/03_ARCHITECTURE.md` → XHS image-card path. Complements ADR-008 browser drivers and ADR-022 draft defaults.

---

## ADR-025: XHS automation is operator-initiated, session-preflighted, and rate-capped

**Status:** Accepted · **Date:** 2026-09-28

**Decision.** `xhs-pub` refuses to drive the creator console unless a saved session passes a
headless preflight, and it bounds console visits to one headed publish cycle and one read-only
session check per 24 h (state file `~/.config/kk/xhs-automation.json`, override
`KK_XHS_AUTOMATION_STATE`). The publish budget is consumed at the headed launch, so a refused
preflight leaves the window intact; `login` stays uncapped because it is operator-interactive by
construction. The daily workflow's XHS target ships `xhs_enabled: "false"` and must not be enabled
on a scheduled run.

**Why.** XHS warned the operator about automated login/publish activity (2026-09-28). `xhs-pub`
always launches a headed browser against the creator console; before this decision a missing session
was not a fast refusal but a 120 s headed login wait, and the freshly-wired daily target defaulted
to on — 365 unattended console sessions a year. The exposure is account-level, so the guard lives in
the plugin (every surface inherits it) rather than in one caller.

**Cost.** A legitimate second publish inside the window is refused and needs an explicit state
reset. The window is machine-local, so a second machine keeps its own budget.

**Amendment (2026-09-29).** Operator decision: the daily workflow's XHS target defaults **on**
(`xhs_enabled: "true"`) so unattended runs fill the creator draft box. The draft-default principle
of ADR-022 is untouched — `xhs_live` stays a launch-time switch, so a scheduled run can never post
live. The plugin-level ADR-025 guards (headless preflight, 24h cap, never-automated login) remain
in force and are what makes the on-by-default draft loop acceptable. The "must not be enabled on a
scheduled run" clause above is superseded by this amendment; the account-level exposure it named is
accepted by the operator with the caps as the mitigation.

**Amendment (2026-09-29, headed preflight fallback).** XHS bot-walls and slow-walls headless loads:
the same profile that never confirms auth headless reads ready in ~27 s headed. The session
preflight now retries a headless refusal once with a headed, read-only readiness visit before
refusing; the publish budget and never-automated-login rules are unchanged (the fallback is a
readiness check, not a publish cycle, and a dead session still refuses fast).

**Detail:** `docs/design/xhs-image-cards.md` → Automation risk policy.

---

## ADR-026: WeChat MP joins the daily workflow through the console browser transport

**Status:** Accepted · **Date:** 2026-09-29

**Decision.** `wechatmp-pub` is refactored from the HTTP `draft/add` API (which required
`WECHAT_APP_ID` / `WECHAT_APP_SECRET` and an uploaded `thumbMediaId`) to a persistent-profile
browser flow over `@gobing-ai/ts-browser-automation` — the same shape as `xhs-pub`: a headless
session preflight (readiness = the console lands on `/cgi-bin/home`) refuses a sessionless run
fast with `ok:false`, and the headed flow pastes the article into the MP console editor and saves
it to the draft box. The daily workflow gains a `wechat-publish` state (`wechat_enabled: "true"`,
`wechat_live: "false"`) as a second independent, non-blocking target that never enters
`publish_status`.

**Why.** The draft box, not the API, is the operator's actual intake surface: drafts are editable
in the MP UI before any 发表, and the API route needed app credentials + a separately uploaded
thumbnail that added setup cost without removing the manual step. The console is where the
operator already works; driving it keeps the xhs-pub muscle (profile dir, preflight, selector
table, loud no-toast failure) in one pattern.

**Cost / accepted risk.** Selector drift on the WeChat console can break the flow — mitigated by
the loud no-confirmation failure and non-blocking stage semantics. **No** ADR-025-style
automation-guard: WeChat has issued no automated-activity warning, and the preflight + draft
default are the guard; if a warning ever arrives, port the 24h cap as a follow-up. The ADR-022
rail carries over unchanged: `wechat_live` stays a launch-time switch, so a scheduled run can
never post live.

**Detail:** `docs/04_DESIGN.md` → `@gobing-ai/wechatmp-pub`; `docs/design/kk-daily-ai-voice.md`.

---

## ADR-027: Browser publish channels run script flows on ts-browser-automation with a shared harness command library

**Status:** Accepted · **Date:** 2026-09-29

**Decision.** `infoq-pub`, `juejin-pub`, `substack-pub`, and the `x-pub` `article` operation
replace their always-failing `agent`-driver stubs with `script`-driver Playwright flows over
`@gobing-ai/ts-browser-automation` (`withProfilePage` / `loginWithProfile`), following the
`xhs-pub` (ADR-024) and `wechatmp-pub` (ADR-026) pattern: headless session preflight, draft by
default, success only from an observed browser signal. The shared plumbing — profile-dir
precedence, a `login|check` profile CLI factory, polling, HTML paste / CodeMirror fill, file
upload, observed-outcome, and `Bun.markdown.html` rendering — lives in
`@gobing-ai/publish-harness` under a `./browser` sub-path export; `xhs-pub` and `wechatmp-pub`
migrate onto it. Site selectors and flows stay in each plugin. `medium-pub` (REST token),
`qiita-pub` (API v2), `zenn-pub` (zenn-cli + git), and `x-pub` `post` (API v2) stay on their
official transports.

**Why.** The `agent` default from the wt-publish harvest (E7, D13) never had an executor, so
four advertised channels fail every real run. The script pattern is already proven twice in this
repo; a third and fourth hand-copy of the same plumbing is the duplication a shared module
removes. Official APIs remain strictly better where they exist.

**Cost / accepted risk.** Selector drift and anti-bot friction per site — mitigated by loud
unobserved-outcome failures and operator-driven draft dogfood; CI stays offline. No
ADR-025-style automation guard for the new channels until a site warns (X is the first
candidate). Medium browser fallback is deferred until the token API stops accepting posts.

**Detail:** `docs/design/browser-publish-channels.md`; feature E91.

---

## Decisions deliberately deferred

- **Config / persistent state** — none yet; add as a `packages/*` workspace when needed.
- **Interactive prompts, colored output** — out of scope until a command requires them.
