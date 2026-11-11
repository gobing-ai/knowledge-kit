---
name: Architecture Decision Record
doc: 00_ADR
owns: WHY — which cross-cutting decision was made, and the one-line reason
authority: authoritative
version: 1.45.0
created_at: 2026-05-28
updated_at: 2026-11-10
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

### Amendment (2026-11-04)

The pin is now `packageManager: bun@1.4.3` (commit `ca7fe0d` aligned the tool pins to the 1.4.3
baseline). The 1.3.14 runner workarounds were re-measured on 1.4.3. The Playwright launch block and
the third-compose hang are gone. Two behaviors remain: `Bun.which` ignores a mutated
`process.env.PATH` unless it is passed explicitly, and `Bun.markdown.html` passes raw HTML through.

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

### Amendment — 2026-10-07 (G repurposed: kk workflows)

Root **G** is no longer a cancelled root. It is repurposed as the **kk workflows** parent: one
direct child per product workflow under `plugins/kk/workflows/` (G1 kk-daily-ai-voice, G2 kk-itc,
G3 kk-collect, G4 kk-solo-podcast, G5 kk-storm-research, G6 kk-ingest-generate-publish) plus G7
for capabilities shared across workflows (run ledger). Change features are grandchildren
(G11 voice2 DAG, G31 kk-collect store, G71 run ledger). The cancelled G slot (PublishPlugin
rewrite epic, no linked tasks, absorbed into E4) was freed by removing its file, the same
procedure as the F repurpose. The "historical cancelled roots" set is now **H only**.
**Why:** workflow work was landing on ad-hoc roots (L, L1, N, O, Q) with no shared home.
Shipped features keep their IDs (they are cited by ADRs, design docs and commits); each G child's
Notes link them instead of renaming.

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

### Amendment — 2026-10-03 (R4: fan-out gets interior concurrency; the engine stays sequential)

> **Status:** Accepted · **Amends:** R4's "sequential step invocations" wording · **Companion:** ADR-019.

R4's substance is unchanged — the engine still executes one node at a time and `kk` still owns
fan-in/fan-out. What changes is the **inside** of the fan-out step: `kk executor fan-out` now
dispatches its non-serial targets **concurrently** and aggregates one `TargetOutcome` per target in
`--target` order, exactly the way ADR-019 made `kk executor fan-in` spawn its `--source` plugins
concurrently.

**Why.** A run's publish wall clock was the sum of every target's transport time, because the
engine cannot overlap nodes and the fan-out step was the only place that could. Two of the tail's
agents — the XHS card plan and the en/ja translation — are serial by nature (one work dir, one
agent), so the fan-out is where the parallelism actually pays.

**Guards.** `--serial` restores the pre-amendment loop for a caller whose transports share a
resource; `--jobs <n>` bounds how many start together; `--serial-target <plugin>` keeps one target
out of the batch and runs it alone afterwards (headed browser channels, publishers sharing a
checkout — `kk-itc` already splits browser targets out of its fan-out groups, so its groups stay
safe by construction); `--target-timeout <ms>` records an overrun as `failed` without aborting
siblings. A rejection, timeout or non-zero plugin exit is still recorded per target; the aggregate
`ok`/exit contract (ADR-007 R5 partial success) is untouched.

**Not decided here.** Engine-level node concurrency (`type: parallel`) remains an upstream question
for `@gobing-ai/ts-dual-workflow-engine` (ts-libs) — the field is declared and never read. This
amendment only moves the concurrency into the step that already owns N→1 and 1→N.

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

### Amendment — 2026-10-11 (one workflow directory and Settings reuse)

All repository-owned workflow definitions, including `feature-verification.yaml`, now live in
`plugins/kk/workflows/`. `.spur/workflows` is a relative directory symlink to
`../plugins/kk/workflows`, preserving lifecycle callers and exposing those definitions through
Spur's project workflow discovery. Remove the redundant registered plugin-directory path to
avoid duplicate CLI catalog entries. There is one physical copy of each definition. Shared Spur
workflows retain their installed location and normal discovery precedence.


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

### Amendment — 2026-10-07 (`plugin check` / `plugin login`, ADR-032)

R3's "`kk plugin status` is the only inspection verb" is **amended**: ADR-032 adds `kk plugin check` (live, read-only readiness probe) and `kk plugin login` (interactive). `status` keeps its static inventory + health contract unchanged.

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

**Amendment (2026-10-03, window 24 h → 2 h).** Operator decision after the 20261002 XHS draft was
saved into the creator console's draft box (`草稿箱` counter 22 → 23, `暂存离开`) yet an operator check
of the phone app showed nothing, and the 24 h window then refused the same-day retry/re-verify that
would have settled it. The window is now **2 h** for both events (`CAP_WINDOW_MS`). What the cap
still buys: at most 12 headed console visits a day, the session preflight still refuses an
unauthenticated profile in ~30 s, the publish budget is still consumed at the headed launch (a
refused preflight leaves the window intact), `login` stays uncapped and operator-interactive, and
drafts remain the default (`xhs_live` stays a launch-time switch, ADR-022). Residual risk accepted
by the operator: a retry loop, or a schedule that re-runs the target more than hourly, can now reach
the console up to 12×/day instead of 1×; the daily workflow itself still drives this target once per
episode. The 24 h figures in the Decision paragraph and the earlier amendments above describe the
window in force at their dates — this amendment supersedes them.

**Amendment (2026-10-09, one visit may compose several notes).** Operator decision (task 0236,
option A): one headed publish cycle may compose more than one note in the same browser session —
voice2's 上传图文 note and its 发播客 episode. The cap still counts **visits**, not notes: one
`allow('publish')` check before the browser opens and one `record('publish')` per visit, whatever
the number of operations. Each operation keeps its own draft rail (ADR-022: draft by default, a draft
claimed only from a console signal, 去发布/发布 clicked only on `publishStatus: public`) and its own
Result; a failed follow-up never fails the run. Rejected: a second `xhs-pub` call per run (refused
by the cap by design) and a second `KK_XHS_AUTOMATION_STATE` file to dodge it (that override is
for a deliberate second profile). Residual risk accepted: one visit now spends longer in the
console and saves two drafts instead of one.

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

**Amendment (2026-10-15): same-origin CGI subpath for eligible plain-article drafts.**
Eligible plain `文章` draft runs (operation=`文章`, publishStatus=`draft`, plain title/body/digest/author
metadata only) may create the draft through the authenticated browser's own same-origin
`/cgi-bin/operate_appmsg` subpath, prepared by the 0289 media upload/crop pipeline. Session
token/ticket extraction stays in-page (URL token first, then bounded known inline fields),
credentials never leave the browser, and the created draft is read back (appMsgId + title) before
`ok:true`. This is the console transport's own HTTP boundary, not a token-API transport: no
AppID/secret dependency, drafts only (never mass-send), and the ADR-022 `wechat_live` rail is
unchanged. Advanced article metadata, other modes and public operations stay on the DOM flow; an
ambiguous create never retries or falls back to a second creation. Manual live verification
remains a separate operator-run delivery check. Detail: `docs/03_ARCHITECTURE.md`,
`docs/04_DESIGN.md` → `@gobing-ai/wechatmp-pub`.

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

## ADR-028: Card copy is typeset from a real font, not generated as pixels

**Status:** Accepted · **Date:** 2026-09-30

**Decision.** Image generation never receives on-card text. A generator format preset may declare
a `compose` block; for such a format the plugin's renderer (`image-gen`) generates only a
text-free illustration, then typesets the card copy — headline and bullet points — from fonts
shipped inside the plugin (Noto Sans SC, OFL-1.1) through headless Chromium (Playwright, already
cataloged and kept external by the bundler) into the format's declared pixel canvas. The compose
step is a pure function of (copy, role, compose block, font bytes, illustration bytes): identical
input yields byte-identical PNGs, so recorded artifacts stay resumable. Character coverage is
checked against the shipped font's `cmap` before any provider spend; an uncovered character fails
loud naming the code point and field. Chromium is the rendering engine because the alternative
(satori + a rasterizer) adds native or WASM dependencies that are not already installed, and
Chromium gives real measured layout for the bounded safe-area and minimum-glyph-size checks.

**Why.** Diffusion models have no glyph renderer: BPE token embeddings carry no glyph geometry and
latent compression destroys the 2–5px strokes of a Han character, so MiniMax `image-01` returned
illegible Chinese for every measured card (F616, filed from the 0179 review). Task 0163 already
banned Chinese text from the daily cover's image prompts for the same structural reason. Setting
copy with a deterministic typesetter is the fix; switching providers remains probabilistic.

**Cost / accepted risk.** A generator plugin gains a browser runtime and ships a binary font asset
(~17 MB for the two Noto Sans SC weights); one Chromium launch per composed image is acceptable
next to a paid provider call. Output is reproducible per install because the font bytes ship with
the plugin — no system-font lookup and no runtime download. A post-spend compose failure is
infrastructure only (Chromium crash) and re-bills the illustration on the next run; keeping a paid
illustration across failures is deferred until observed.

**Detail:** tasks 0180, 0182; `docs/design/xhs-image-cards.md` (Decision and boundary);
`docs/04_DESIGN.md` (format `compose` block, exact canvas gate, `ImageArtifact.illustration`).

---

## ADR-029: A publish channel is one plugin; its publishing types are operations

**Status:** Accepted (design) · **Date:** 2026-10-05

**Decision.** One plugin per publish *channel*. The publishing *types* a channel offers (xhs 上传视频 / 上传图文 / 写长文 / 发播客; X post / article; WeChat MP 文章 / 贴图 / 视频 / 播客) are declared, validated `operations` inside that plugin — selected from `options.operation ?? content.metadata.operation`, resolved against a per-channel declared list, and refused by name before any browser opens. Each operation owns its own flow, selector table and success signal; the channel owns one profile dir, one session, one preflight and one `profile-check` CLI. A separate plugin is warranted only by a different account/session, a different `Content → Result` contract, or a different product surface — never by a publishing type alone.

**Why.** Every type on a channel shares one login, so splitting by type multiplies logins, profile dirs, env tiers and preflights while the actual difference is a selector table and a flow (confirmed against both live consoles: xhs and WeChat MP each expose four types behind one authenticated session).

**Detail:** `03_ARCHITECTURE` § Publish modes inside a channel plugin (dispatch, validation, mandatory rail); per-channel live evidence in `docs/design/xhs-ui-discovery.md` and `docs/design/wechatmp-ui-discovery.md`; work in feature E92 / tasks 0199–0205. Prior art: the `x-pub` `post` | `article` split.

---

## ADR-030: Collected items live in a kk-owned SQLite store behind one package

**Status:** Accepted · **Date:** 2026-10-06 (feature G31 store, shipped — tasks 0206, 0208–0210)

**Decision.** Collected `Doc[]`, their labels, collect provenance and episode usage persist in one SQLite file (`store.db_path`, default `<works_dir>/kk.db`) owned by a new `@gobing-ai/kk-store` workspace: `@gobing-ai/ts-db` adapter, drizzle schema, DAOs, versioned migrations, WAL + `busy_timeout`. ts-db is importable only inside `packages/kk-store`, drizzle only inside its `src/schema/` — enforced by `spur rule` boundary rules (spur `packages/domain` pattern). Labels come from a kk-owned `spur decision` catalog (heuristic first, model on demand, `source: default` on degrade); topic extraction is a profile file compiled to one DAO query. Markdown core-facts remain a per-run artifact.

**Why.** Per-day JSON forces every episode to re-collect (~32 min on 20261006) and makes labels throwaway; a durable labeled store moves collection off the episode path and turns a new topic into a profile, not a pipeline. Resolves the "Config / persistent state" deferral below.

**Detail:** `docs/design/kk-collect-and-daily-voice2.md` §2–§4; feature G31.

---

### Amendment — 2026-10-09 (G32 store v2: observation identity, item facts, topic-scoped selections, frozen DDL, atomic rebuilds)

**Status:** Accepted (shipped — G32; tasks 0225–0230) · **Date:** 2026-10-09 · **Amends:** ADR-030 · **Work:** feature G32, tasks 0225–0230

**Decision.**

1. **R1, labels are observations, not a verdict.** `labels` identity becomes UNIQUE `(item_id, decision_id, maker, run_id)` — one row per maker's answer, so a second maker never overwrites the first and cross-maker evidence survives for backtesting. `run_id` is NOT NULL; a pre-identity row backfills to the literal `'legacy'`. New columns: `raw_value TEXT`, `raw_confidence REAL` (the raw 0–1 payload), `reason TEXT`, `duration_ms INTEGER`, `catalog_version TEXT`, `content_hash TEXT` (the item hash the answer was made against). The enum `confidence` column stays, because the G31 R14 consumers read it. No SQL VIEW: `labels_current` needs the configured maker priority, so it is compiled as a DAO CTE (task 0226).
2. **R2, facts live in `items`, judgments in `labels`.** Deterministic, maker-independent facts go to typed `items` columns (`engagement REAL`, `body_chars INTEGER`, `source_tier TEXT`, `lang TEXT`, `domain TEXT`, `story_id TEXT` with an index); anything a maker could disagree on stays a `labels` observation. The columns stay NULL until `backfill-facts` (task 0227) derives them; `story_id` is backfilled to the item's own id in between.
3. **R3, `selections` replaces `episode_usage`.** The dedup ledger is topic-scoped, not workflow-scoped, and carries a story key: UNIQUE `(topic, item_id, run_id)`, plus `story_id`, `workflow`, `rank`, `reason`, `status` (CHECK `selected` | `published` | `dropped`), `selected_at`, `published_at`, and the standard columns. Every `episode_usage` row is copied in as `topic='ai-news'`, `status='published'`, `story_id = item_id`, then the old table is dropped. Extraction excludes by `(topic, story_id)` with status `selected` or `published`, so one item can still serve another topic (task 0228).
4. **R4, `0001` is frozen literal SQL.** `KK_STORE_V1_SQL_FROZEN` in `src/migrations.ts` holds the exact v1 DDL (including the `0002` columns) that the builders produced when the store shipped; `0001` no longer derives from the live `defineTable` builders. The derivation trick only converged ADD COLUMN paths; a widened identity breaks it, so the v1 shape is pinned and v2 is described by the builders plus `0003_store_v2`.
5. **R5, `0003` is atomic and race-safe.** A `KkMigration` may set `atomic: true`; the migrator then builds one `adapter.batch` (one transaction) of the journal `INSERT` — plain, no `ON CONFLICT`, placed first — followed by every `;`-split statement. A losing concurrent migrator fails on the journal PRIMARY KEY or SQLITE_BUSY and rolls back whole; the migrator re-reads the journal and treats "id now present" as applied by the other process. Any other failure is rethrown. Non-atomic migrations (`0001`, `0002`) keep the per-statement path and its duplicate-column tolerance.

**Why.** A verdict table keyed by `(item, decision)` cannot answer "which maker was right?" — the second write erases the first — and it destroyed evidence on every content-hash change (`ItemsDao.upsertDocs` deleted an item's labels on edit). Facts mixed into untyped `metadata_json` could not be queried as signals. A workflow-keyed usage ledger recorded nothing when a run failed before its tail, so the next day re-aired the same items; a topic-scoped ledger written when the run commits to its set fixes that at the source. The DDL freeze and the atomic-apply contract are the two enabling mechanisms: without them a rebuild migration cannot converge a fresh and a migrated database, and a per-statement rebuild is not race-safe against a concurrent `kk store migrate`.

**Detail:** task 0225 (schema, migration, DAOs, this amendment); 0226 (`labels_current`, raw capture, `--replay`); 0227 (typed facts, `story_id` clustering, `backfill-facts`); 0228 (`kk store select` / `mark-published` / `release`, `excludeTopic`); brainstorm `docs/plans/2026-10-08-kk-collect-store-v2-brainstorm.md` (D1, D2, D4). Adapter atomicity: `@gobing-ai/ts-db` `batch` runs one transaction.

---

## ADR-031: Product workflows may be `kind: dag`; nodes pass data by files

**Status:** Accepted; implemented (tasks 0211–0212, first green run `4a9b22f0` 2026-10-08) · **Date:** 2026-10-06

**Decision.** A product workflow may use the engine's `kind: dag` (ts-dual-workflow-engine ≥ 0.5.16: concurrent waves, `dependsOn`, `condition` skip, `pause`, durable resume). Each node is exactly one `kk` command, one `agent.run`, or one `spur workflow run` (loops live in a nested state-machine). Nodes exchange data through fixed paths under `work_dir`, never through vars (concurrent `setVars` is last-writer-wins). Non-blocking targets exit 0 on soft failure because the DAG is fail-fast. This amends ADR-007 R4: `kk` still owns steps and fan-in/fan-out *within* a step; the engine may now run independent steps concurrently.

**Why.** The serial FSM runs article/cover/script and the publish channels back-to-back although they are independent; the engine now executes DAG waves concurrently (probe: two 1 s nodes in 1.2 s).

**Detail:** `docs/design/kk-collect-and-daily-voice2.md` §6; `03_ARCHITECTURE` § Execution substrate; feature G11.

---

## ADR-032: `kk plugin check` / `kk plugin login` probe a channel's live readiness; `status` stays static

**Status:** Accepted (shipped — E93; tasks 0215+0216, channels 0291–0297) · **Date:** 2026-10-07 · **Amends:** ADR-011 R3 (`status` is no longer the only `plugin` verb)

**Decision.**

1. **R1, the verbs.** `kk plugin check [<name>…] [--kind <kind>] [--json] [--headed]` is read-only. It runs each selected plugin's own readiness probe and exits nonzero when any probe refuses. `kk plugin login <name>` runs that plugin's interactive login. Both are new verbs under the existing `plugin` noun.
2. **R2, `status` stays static.** `kk plugin status` remains discovery plus manifest/entry health: offline, fast, and free of side effects. A live probe never runs from `status`.
3. **R3, manifest opt-in.** A plugin exposes its probe through an optional `plugin.json` field (`check`: an entry path relative to the plugin dir). A plugin without the field reports `unsupported`. That is not a failure, so API-only channels opt in on their own schedule.
4. **R4, probe contract.** kk runs `<entry> check|login [--profile <dir>] [--timeout <ms>]`. Exit codes are `0` verified, `1` refused, `2` usage. The `check` stdout ends with one JSON line `{ status, profileDir?, detail }`, the existing `runProfileCli` `ChannelSessionResult` shape. kk reports only this verdict. Probe stdout is never echoed to the operator beyond `detail`.
5. **R5, safety.** `check` never clicks, never creates a profile, and never prints a cookie, token or page body. It is headless by default; `--headed` opts in to the headed fallback (needed for infoq's WAF-451). `login` is the only path that opens a browser for interaction.

**Why.** Each browser channel already ships a `profile-check.ts login|check`, but an operator has to know six script paths, their per-channel env vars and their differing output formats. 0193/0194 lost a day to a session that looked healthy and wasn't (0214). One verb answers "can this channel publish right now?" across channels, and `--json` lets a workflow preflight gate on it. Folding this into `status` would turn a deterministic inventory check into a slow, profile-dependent and flaky one.

**Detail:** feature E93; `docs/04_DESIGN.md` `plugin` noun section (same commit as the surface code).

---

## ADR-033: The safety gate escalates only on findings the reviewer marked `disposition: "escalate"`

**Status:** Accepted · **Date:** 2026-10-07 · **Amends:** the 0189 R10 gate classification as adjusted 20261005 (any RISK decision or report-level `escalate: true` on a clean pass pauses)

**Decision.**

1. **R1, the finding contract.** Every `kk:content-safety` finding carries `disposition: note | fix | gap | escalate`. `note`/`fix`/`gap` findings are recorded on the report but never pause an unattended run; only `disposition: "escalate"` (category-2 residue that survives exclusion, no-reference-file platforms, anything an operator must answer by hand) sets report-level `escalate: true` and escalates.
2. **R2, the gate.** `daily-safety-gate` escalates on a clean pass (PASS verdict, no BLOCK) only when the report carries a `disposition: "escalate"` finding. RISK whose findings are all `gap`/`note`/`fix` lands in `exclude` with an empty `excludedPlatforms` — published at recorded risk, the residual-risk record preserved in the status/stamp.
3. **R3, fail-closed back-compat.** A report with no `disposition` field anywhere keeps the legacy rule: any `RISK` decision or report-level `escalate: true` escalates. The narrowed rule must be earned by the reviewer explicitly marking findings.
4. **R4, evidence gaps stay visible.** `evidenceGap: true` remains mandatory reporting; a gap is `disposition: "gap"` — recorded, surfaced in the gate reason, never a silent auto-`OK`. What changes is only that a gap alone no longer forces pre-publish human review on an unattended run.
5. **R5, report confidence (amendment, 2026-10-07).** A report on the disposition contract must also carry report-level `confidence: HIGH | MEDIUM | LOW` — the reviewer's self-graded certainty in its own decisions and dispositions, mirroring the 20261003 verdict-confidence hardening. The gate blocks a disposition-contract report whose confidence is missing or out-of-enum. Legacy reports (no `disposition` field) stay exempt, so R3's back-compat is unchanged.

**Why.** The 2026-10-07 06:00 scheduler run classified three platform RISKs on a clean judge PASS whose findings were all evidence gaps and note-class items the reviewer itself dispositioned as non-blocking — the escalate branch routed the run to the HITL `review` state, and because an unattended run cannot answer, the job failed. Reviewer-marked escalation keeps the human decision where it belongs; recorded-but-answerable risk no longer converts an unattended run into a failed job.

**Detail:** `plugins/kk/scripts/kk-workflow-stages.ts` `dailySafetyGate`; `plugins/kk/skills/content-safety/SKILL.md` finding contract; `plugins/kk/workflows/kk-daily-ai-voice.yaml` safety-judge edges; `docs/design/kk-daily-ai-voice.md` gate section and `docs/04_DESIGN.md` daily workflow row (same commit as the code).

---

## ADR-034: Voice2 episode speech is one synthesis request per section

**Status:** Accepted (design) · **Date:** 2026-10-09

**Decision.** Voice2 synthesizes an episode as one request per section: the opening, one section per selected item, and the closing. Existing voice-script chunks are grouped into those sections. Each section file is cached by spoken text, voice, and driver; a later run synthesizes only a section whose file is missing or whose text hash differs. Section files are joined in order, then the existing intro sting is applied. The duration check still reads that joined episode and stays at 15–20 minutes. Everyday concurrency is 1; a count above 1 is refused in this delivery. An account-window refusal stops the run and keeps finished section files. The voice1 workflow file and the shared script builder stay unchanged.

**Why.** The paid unit then matches the unit that gets rewritten, so a failed or over-long episode pays again only for the sections that changed.

**Detail:** `docs/design/segmented-episode-speech.md`; `03_ARCHITECTURE` § Voice2 episode speech.

---

## Decisions deliberately deferred

- **Config / persistent state** — resolved by ADR-030 (`@gobing-ai/kk-store`).
- **Interactive prompts, colored output** — out of scope until a command requires them.


## ADR-035: Workflow visibility uses native Spur Board modules and a KK-owned local reader

**Status:** Accepted · **Date:** 2026-10-11 · **Work:** G8

**Decision.** Deliver the Collect, Daily AI Voice and IT Content views as native project-owned
Spur Board contributions. Spur retains execution/run authority; a loopback, read-only KK reader
owns sanitized, run-bound artifact and configuration access.

**Why.** The shipped Board extension contract loads browser contributions without downstream
server routes, so this boundary provides complete local visibility without an upstream fork.

**Detail:** [Workflow Board modules](design/workflow-board-modules.md).

### Amendment — 2026-10-11 (reuse Settings → Workflows)

Settings → Workflows remains the sole definition browser: workflow dropdown, current metadata,
YAML/copy and static Mermaid graph. G8 must reuse that existing tab via
`/board/settings/workflows`, with no duplicate definition viewer, editor, static graph or KK
current-definition endpoint. Workflow Config Summary contains only sanitized recorded run settings,
capture provenance and explicit unknowns, plus that Settings link. Execution progress may show
run-specific status/dependency evidence. The existing Settings tab does not support selecting a
workflow by URL, so operators select it in its existing dropdown; do not invent a query contract.

### Amendment — 2026-10-11 (ready audit: revoke ownership before overwrites)

G8 preparation must revoke an earlier workspace owner before changing result artifacts. If
revocation cannot be persisted, stop preparation before overwriting those artifacts. After
successful revocation, failure to write the new optional Board capture warns and leaves artifact
access disabled without aborting production. A running reader is never a workflow prerequisite.
New-run ownership alone does not prove an old file was produced by the new run: result access also
requires recorded success of that artifact's producer in the selected run. Definition topology is
captured only when the current catalog digest matches the engine-injected execution digest.

### Amendment — 2026-10-12 (G8 shipped; module route is page vs asset)

Shipped by 0252–0255. One design-time assumption corrected on evidence: the module PAGE is
mounted by the SPA at `/board/modules/<id>`, while the bare `/modules/<id>` prefix serves only
assets and the descriptor's `route`/`entryUrl` — the bare page is the SPA 404 (verified live with
Chromium and `GET /api/board/modules`). The checkout declares the three modules `enabled: true`:
the root `prepare` script builds the gitignored browser contributions on every `bun install`, so
the host's server-start validation finds `apps/cli/dist/board/*` and no operator flip is needed
(see the 2026-10-19 note below). Shapes and operator setup: `04` `kk board`.

> **2026-10-19 (operator-setup contract):** the declarations flipped from `enabled: false` to
> `enabled: true` and the assets became an install-time product — root `prepare` runs
> `bun scripts/build-board.ts`, pinned by `scripts/tests/board-package.test.ts`. The build-first-flip
> workflow above is superseded; `04` `kk board` → Operator setup owns the current steps.

### Amendment — 2026-10-16 (G81: Collect reads the kk store read-only)

Reverses the "artifacts only; no store/DAO reader" rule of `workflow-board-modules.md` §9 **for the
Collect module only**. The run's artifacts answer "what files did this run write"; operators need
"what did this run add to the store, how well was it labelled, what became of it, and is collection
keeping its 6 h cadence" — facts that live only in `.works/kk.db` (`collect_runs`, `items`, `labels`,
`selections`). The KK reader may open that store with `openStore({path, migrate:false})` (precedent:
`apps/cli/src/commands/daily.ts:150`) and serve three GET-only Collect store routes. Constraints: no
write, DDL or migration; Spur stays the authority for run status and timing (the `collect_runs` row
is stamped at `kk store ingest`, so its `started_at`/`finished_at` are not a duration, and failed or
skipped ticks have no row); an unreadable, missing, locked or schema-newer store is an
`unavailable` diagnostic, never zeros; item bodies are never served; query parameters are accepted
only on routes that declare them. Daily AI Voice and IT Content stay artifacts-only. Detail:
[Collect store views](design/collect-store-views.md).

### Amendment — 2026-10-22 (G82: Daily AI Voice consumes Collect's read-only aggregate counts)

Widens the 2026-10-16 amendment by exactly one consumption: the Daily AI Voice module may read the
`GET /api/workflows/kk-collect/store/channels` aggregate (0319) to render one **supply-context**
panel — the day × source new-item matrix and the per-day tick/plugin table — for the half-open
window `[run.startedAt − captured config.window, run.startedAt)` of the selected `kk-daily-ai-voice2`
run. This is the same read-only loopback route, the same `CollectChannelYield` contract and the same
presentational tables the Collect module already serves; Daily adds no second DAO, route or query
surface. Constraints: the panel is labelled **configured context** — the run's effective extraction
window (the dailyExtract ladder's bounds) is not persisted and stays explicitly unknown; a run with
no captured `window` setting or no recorded `startedAt` renders unknown and issues no query; store
supply stays visibly distinct from the episode funnel, which continues to come only from the run's
own authorized artifacts; a missing plugin key reads as 0 recorded contributions with invocation
health unknown, never a dead source. Everything else about Daily stays artifacts-only (the funnel is
artifact-backed), and IT Content stays artifacts-only without exception. Detail:
[Workflow board modules](design/workflow-board-modules.md) §9.

#### API/library claim sources and confidence

| Claim | Source | Local verification | Confidence |
| --- | --- | --- | --- |
| The contribution ABI is `apiVersion: 1`, the entry exports `webModule`, and the component renders inside the host's own React tree without calling `createRoot` | installed `@gobing-ai/spur` declaration-only `./board` export | Read `node_modules/@gobing-ai/spur/board/index.d.ts:21,24,27,38` (0.4.2) | HIGH |
| The host mounts compiled browser contributions but exposes no downstream server-route extension point, which is the constraint this decision rests on | the contribution contract plus the Board's served route table | Read `node_modules/@gobing-ai/spur/board/index.d.ts` and the `app.get` registrations in `spur.js` (0.4.2); no route is mounted from a contribution | MEDIUM — inferred from the shipped contract and route table, not from an attempted injection |
| A declared module's page is mounted at `/board/modules/<id>` and its declaration is validated `.strict()` at config load | installed `BOARD_MODULE_ROUTE_PREFIX`, `boardModuleDeclarationSchema` | Read both in `node_modules/@gobing-ai/spur/spur.js` (0.4.2); the mounted path was measured live by `apps/board/tests/installed-board.test.ts` | HIGH |
| The TypeSafe SDK's transport drains `response.clone().body` **and** `response.body` into a telemetry buffer, then parses the same response with `text()` — fatal under Bun, where that body is already used (SDK 0.6.0 has no such drain) | installed `@typesafe-ai/sdk@0.7.0` (`bufferResponse` and its `attempt()` call site) | `node_modules/.bun/@typesafe-ai+sdk@0.7.0/node_modules/@typesafe-ai/sdk/dist/index.mjs:821` (`bufferResponse`) and `:1078` (its only call site); `grep -c 'Body already used'` returns 0 in the `spur@0.4.15` bundle | HIGH |
| `@gobing-ai/spur` 0.4.15 bundles `@typesafe-ai/sdk@0.6.0`; 0.4.16 and later bundle `0.7.0`, which is the version boundary the regression starts at | the published bundles themselves | `grep -o 'typesafe-ai+sdk@[0-9.]*' ~/node_modules/@gobing-ai/spur/spur.js` → `0.7.0`; the same grep on the `npm pack @gobing-ai/spur@0.4.15` tarball → `0.6.0` | HIGH |
| `voxcpm` 2.0.3's `_generate` accepts `cfg_value`, `inference_timesteps`, `normalize`, `denoise` and `max_len`, and rejects `reference_wav_path` on anything but a VoxCPM2 checkpoint | the installed Python package | `plugins/generations/voxcpm-tts/.venv/lib/python3.12/site-packages/voxcpm/core.py:180`–`:193` (signature) and `:239` (`ValueError("reference_wav_path is only supported with VoxCPM2 models")`) | HIGH |
| `openbmb/VoxCPM1.5` cannot reference-clone and `openbmb/VoxCPM-0.5B` renders natively at 16 kHz, so neither is a drop-in for the operator's `robin-news` clone | one probe render per checkpoint | `plugins/generations/voxcpm-tts/scripts/probe-long-render.py --model openbmb/VoxCPM1.5 --mode continuation` → `ValueError` above; `--model openbmb/VoxCPM-0.5B` → a `16000 Hz` wav, both measured with `kk stage audio-quality` | HIGH |
| `omni-voice-gen` clone profiles are declared as `ref_audio` + `ref_text`, which is what the third voice tier needs to reproduce the same speaker | the plugin's profile contract | `plugins/generations/omni-voice-gen/README.md` (profile kinds table) and the operator registry it reads, `~/.config/kk/voices/omni-voice-profiles.json` | MEDIUM |

## ADR-036: VoxCPM reuses the TypeScript voice pipeline with an isolated Python worker

**Status:** Accepted (shipped — G14) · **Date:** 2026-10-11 · **Supersedes:** ADR-020's restriction to one Python-bearing product plugin, only to admit the private VoxCPM worker below.

**Decision.** Add an opt-in `voxcpm` alias backed by `plugins/generations/voxcpm-tts`, a TypeScript generator reusing voice-gen's processing pipeline and owning a private uv-managed Python inference worker. Install VoxCPM independently from a pinned external distribution; `vendors/` remains reference-only and is never a product dependency, runtime path or packaging input. Keep both daily workflows' current defaults.

**Why.** The existing adapter seam preserves one VoiceScript/QC/audio implementation while VoxCPM inference requires its native Python stack.

**Detail:** [VoxCPM daily voice driver](design/voxcpm-daily-voice-driver.md); feature G14. This decision does not assert improved audio quality or validated hardware performance.

### Amendment — 2026-10-15 (voxcpm becomes the standing default on `kk-daily-ai-voice2`)

The 2026-10-15 production run rendered the episode end to end through voxcpm-tts on the operator's
decision, and the operator's audio verdict keeps it: `kk-daily-ai-voice2` defaults to
`vdriver: "voxcpm"` and gains a three-tier voice chain — `generate` (the var), `generate-fallback`
(gemini), `generate-fallback2` (omni) — each fallback gated on the pool count **and** on no valid
upstream render already existing (`metadata.generator` matches a plugin that could have produced it,
with `qc.passed`), `onError: continue` on the two non-final tiers, and `intro` depending on all three.
A successful primary therefore makes its siblings skip, and a failed attempt can neither be relabeled
nor mixed into the episode. Evidence: 12/12 local sections in 47 min, joined 21.76 min inside the
15–25 gate, all five publishes `success: true`, no fallback fired. Two follow-on fixes are part of
this amendment: the fit rate for voxcpm is 5.2 字/秒 (measured 5.19; the beta build borrowed
voicebox's 5.6, which budgeted 24.6 min — 18 s inside the gate), and `kk daily prepare`'s board
manifest now accepts `voxcpm` in the `vdriver` choice list (0257 wired the stage but not the gate).
`kk-daily-ai-voice` keeps its gemini default and single-generator shape.

### Amendment — 2026-10-20 (voxcpm stays primary; its echo is measured, monitored, and not yet fixable)

The 2026-10-15 order **stands unchanged**: `kk-daily-ai-voice2` keeps `vdriver: "voxcpm"` and the chain
voxcpm → gemini → omni. What this amendment adds is (a) the measurement that makes the known audio
defect explicit and re-checkable, and (b) the decision that the operator keeps the local driver for its
speed and cost while monitoring each episode, rather than paying a 1h47m–2h21m remote render per day.
Flipping `vdriver` to `"gemini"` remains the documented one-var escape hatch.

Evidence (`kk stage audio-quality`, 2026-10-20; real-cepstrum echo probe + pause floor, measured on the
raw model output of every episode and then on controlled renders of one 366-character paragraph):

| source | cepstrum echo peak | pause floor (p20) |
| --- | --- | --- |
| `gemini-tts`, episodes 10-12…10-14 | 20–25 ms @ 19–20 dB | −34 … −37 dB |
| `voxcpm-tts`, episodes 10-15…10-20 | **40 ms @ 27–30 dB** | **−16 … −22 dB** |
| `VoxCPM2` long render with `inference_timesteps=20` / `cfg=2.5` / `normalize` / `denoise` | 40 ms @ 27–31 dB | −16 … −17 dB |
| `VoxCPM1.5` (continuation; it cannot reference-clone) | 80 ms @ 31 dB | −16.6 dB |
| `VoxCPM-0.5B` (continuation, 16 kHz native) | 20.6 ms @ 20.4 dB (no lattice) | **−15.5 dB** |
| `omni-voice-gen` (clone profile, same paragraph) | 40 ms @ 37 dB | −20.9 dB |
| the shared `robin-news.wav` reference | 23 ms @ 21 dB | −27.7 dB |

What the sweep established: the artifact is **duration-dependent** (a 10 s render measures clean, >30 s
reproduces it — which is why the 2026-10-15 A/B listen missed it); it is present in the **raw model
output** before the ffmpeg join and the mp3 encode, so it is not a pipeline defect; it survives every
sampler knob and every checkpoint that can still reference-clone the operator's voice (`VoxCPM1.5` and
`VoxCPM-0.5B` cannot serve as drop-ins — they require continuation prompting, and the 16 kHz one
measures an even worse pause floor); and it is **not voxcpm-specific**: the 40 ms lattice is VoxCPM2's
own, while the raised pause floor is shared by the voxcpm family and by OmniVoice. No local driver is a
substitute today, so there is no free win being left on the table.

Monitoring is the deliverable: `kk stage audio-quality <file…>` reports cepstrum lag/prominence, pause
floor, offset decay curve and band balance for any episode, and
`plugins/generations/voxcpm-tts/scripts/probe-long-render.py` reproduces the artifact in ~2.5 minutes so
a future checkpoint or upstream fix can be judged numerically. Re-open this amendment when either a
voxcpm build drops the lattice or the operator accepts the Gemini render cost.

### Amendment — 2026-10-15 (the voxcpm profile must anchor a speaker; operator voice assets are private)

The production test above exposed a defect in how the driver was configured, not in the driver: the
`robin-news` registry entry was `mode: "instruct"`, which carries no reference audio. With no
reference there is no prompt cache, so VoxCPM samples `torch.randn` per request and every VoiceScript
segment draws a **new speaker** — the 2026-10-15 episode contained 59 of them, with a median
within-item pitch swing of 77 Hz (worst 103 Hz). A fixed `seed` is not a cure (the same seed across
different texts still spanned 214–269 Hz); only a reference clip pins identity. Measured on identical
texts: instruct spanned 141 Hz of median F0 (sd 58), a reference-anchored profile spanned 22–26 Hz
(sd 9–12) and correlated 0.95+ with its clip.

Requirements from here on:

1. A voxcpm profile used for multi-segment synthesis is `reference` or `continuation`, never
   `instruct`. The adapter enforces this: it warns once per invocation on an instruct profile and
   **fails the render on the second segment of one**, so a misconfigured registry drops the tier to
   the next driver instead of shipping a voice that changes mid-episode.
2. Operator voice assets live outside the repo (task 0159's existing invariant), registered through
   the operator config: `VOXCPM_PROFILES_PATH` and `OMNIVOICE_PROFILE_REGISTRY` under
   `plugins.generations.<plugin>.env` in `~/.config/kk/config.yaml`, with the clip in
   `~/.config/kk/voices/`. The committed registries keep non-personal placeholder entries.
   The oracle clip `plugins/generations/omni-voice-gen/voices/robin-news.wav` is therefore removed
   from the repo (it remains in git history and in the operator's private copy).
3. Episodes are graded with `plugins/generations/voxcpm-tts/scripts/audit-speaker-consistency.py`:
   a per-item F0 spread above 45 Hz, or a per-item median above 30 Hz, means the profile is not
   anchoring a speaker.

Speaker identity across drivers stays the operator's cloned `robin-news`: gemini-tts by stored voice
id, voxcpm and omni by the same private reference clip. The operator listened to the A/B of item 5
and item 8 (2026-10-15, `.works/voice-ab-20261015/`) and adopted the anchored clone as the standing
default: the anchored halves held one voice (per-item F0 spread 7–33 Hz, 0.91–0.94 LTAS correlation
with the clip) where the instruct halves changed speaker mid-item (34–65 Hz on those excerpts,
77 Hz median across the episode).


## ADR-037: Every canonical kk operation has one noun and one verb

> **Status:** Accepted (design — A22; not implemented) · **Date:** 2026-10-13 · **Amends:** ADR-011 R1/R4 and its stage amendment.

**Decision.** Every visible executable product operation has exactly two command words: `kk <noun> <verb> [data arguments/options]`. Noun groups have no default action. Framework help and global flags are excluded. Keep existing valid nouns and hyphenated verbs; make `stage run` and top-level `lock acquire|release` canonical. Every shipped spelling remains a hidden compatibility route sharing the action implementation and output/exit contract; no alias sunset is implied by this change. Alias diagnostics never contaminate machine output.

**Why.** The full registered tree has 27 visible executable leaves; only stage's root action and the two nested store lock operations violate this rule. Domain-wide renames would create churn without improving conformance.

**Detail:** feature A22; `docs/design/kk-noun-verb-bots.md`. Historical ADR-011 noun inventories describe their shipping dates, not an eternal two-noun limit.

## ADR-038: Named bots manage local browser sessions through the publish harness

> **Status:** Accepted (design — A22; not implemented) · **Date:** 2026-10-13 · **Complements:** ADR-027/029/032.

**Decision.** `kk bot list|login|logout|open` manages named persistent Chromium profiles under `~/.config/kk/browser-profiles`. Reuse the existing publish-harness browser launcher; retain site readiness, special state capture/restoration and browser interaction in each channel plugin. A bot is neither a new plugin kind nor an agent. Unknown URLs require explicit operator confirmation; site-verified and operator-confirmed evidence remain distinct. Logout removes local credentials only. Existing plugin status/check/login contracts remain supported.

**Why.** Shared local session operations need one operator surface, while site readiness and session portability require channel knowledge. Folder existence, cookies and page loads are insufficient proof of a working login.

**Detail:** feature A22; `docs/design/kk-noun-verb-bots.md`. The optional browser-session descriptor extends the existing plugin check-script seam; API-only plugins remain independent of browser loading.


### Amendment — 2026-10-13 (ADR-038 ready-depth refinement)

The optional browserSession descriptor carries profileName and an optional homeUrl: publication-scoped Substack cannot declare one fixed editor URL. Saved plugin identity, declared profile name, then literal-origin matching select an adapter. Generic bots remain operator-confirmed; known adapters preserve plugin-owned canonical navigation (including fixed non-secret editor-version queries). Shared leases use scoped parent/child ownership across the existing check-script process boundary. No Xiaoyuzhou publisher connector exists in the current tree; generic URL login does not add one. Detail: the A22 satellite and task Design sections.

### Amendment — 2026-10-16 (A23 session facts and `bot exec`)

Login records optional `bot.json` facts — `lastLoginAt`, an estimated `expiresAt` (earliest persistent httpOnly cookie applicable to the default URL) and an adapter-reported `identity` — so `bot list` can show them while staying browser- and cookie-DB-free; `schemaVersion` stays 1. A new leaf `kk bot exec <bot> <url>` sends one request with a curl option subset through the profile's headless persistent context under the shared lease, attaching only cookies the profile holds. Plugin special state, storage tokens and the rest of curl are deliberately out of scope. This adds one visible leaf to the ADR-037 tree. Detail: [A23 satellite](design/kk-bot-session-facts-exec.md).

### Amendment — 2026-11-09 (rendered collection substrate for ingestion plugins)

Ingestion plugins may declare the same `browserSession {profileName, homeUrl?}` descriptor a publish plugin declares, still with a mandatory `check` probe that owns `login|check|open`; the adapter selection order is unchanged and kind-agnostic, so no CLI or fan-in code moves. Alongside it ships a bounded library runner, `runBotCollection(profileName, plan, options?)` from `@gobing-ai/publish-harness/bot-collection`: a JSON-serializable ordered plan of `request | navigate | wait | click | scroll | extract` steps plus declarative response captures, executed in one headless persistent context under one profile lease and one launch. The plugin owns site selectors, pagination and politeness; the harness owns validation, deadlines, body caps, failure classification and cleanup. Missing acquisition data and observed auth walls fail the run (`empty`, `authentication`) rather than reading as a quiet day, and a stored `expiresAt` is never treated as evidence. Rejected: cookie/storage export or import, HAR replay or a response cache, a warm browser pool or daemon, a declarative recipe/JSONPath/CSV engine, generic crawling and retry/politeness policy, anti-bot/robots bypass, and any new `kk bot` verb — an operator hand-driving a plan uses the repository probe script instead. Detail: [kk-noun-verb-bots.md](design/kk-noun-verb-bots.md), [ingestion specification](design/ingestion-plugin-specification.md); feature G3.

### Amendment — 2026-11-09 (canonical collection execution via kk bot plan)

Supersedes the preceding amendment's rejection of a new `kk bot` verb. Promote declarative collection execution into the canonical single noun-verb CLI surface: `kk bot plan <bot> <plan.json> [-o <dir>] [-m <seconds>]`. This provides a first-class, scriptable CLI leaf for workflows, subagents, and operator tasks to execute declarative collection plans against existing bot profiles without depending on ad-hoc probe scripts or direct TypeScript imports. The runner retains strict boundaries: validation before execution, single profile lease acquisition, headless persistent context, fail-closed exit codes (0 = success, 1 = operational failure such as `authentication`/`empty`/`browser`, 2 = usage error), output redaction of request URLs, queries, and cookies, and 0600 artifact file containment under `-o <dir>` or JSON metadata to stdout. The CLI loads `@gobing-ai/publish-harness/bot-collection` directly; `browser.ts` still does not import or re-export it. Detail: `docs/04_DESIGN.md` §1.12/§1.13, `docs/design/kk-noun-verb-bots.md`.

---

## ADR-039: Smart SEO uses native KK audit stages and Spur semantic decisions

**Status:** Accepted (shipped in part — G9; tasks 0281–0286; a live-site audit and feature-level verification remain) · **Date:** 2026-10-14

**Decision.** Deliver a read-only SEO/GEO audit workflow through native KK stages, typed `spur decision` catalogs and one fat `smart-seo` skill. Keep `vendors/jev-seo` reference-only; preserve observed facts, unknown assessments and model provenance separately. The first delivery produces JSON/Markdown and introduces no runtime, dependency or product plugin kind.

**Why.** The reviewed vendor's evidence/judgment separation fits KK, while wrapping its Python pipeline would retain network/evidence defects and conflict with vendor isolation.

**Detail:** [Smart SEO design](design/kk-smart-seo.md), feature G9; [vendor review](plans/2026-10-14-smart-seo-vendor-review.md).


---

## ADR-040: ITC plans use plugin publication capabilities and explicit topic channel presets

**Status:** Accepted (shipped — G21; tasks 0298–0303) · **Date:** 2026-10-15 · **Complements:** ADR-007/018/021/029/032/038.

**Decision.** Retain the kk-itc state machine and existing executor fan-in/fan-out. Publish plugins own optional operation-specific planning capabilities and mode bindings; topic presets own editorial target selection. Optional topic discovery consumes kk-collect/store evidence, and Spur catalog decisions recommend only validated choices. Freeze send intent and reconcile per-target receipts before recovery; uncertain remote effects require reconciliation. Bot lifecycle stays in the harness and channel readiness/auth state stays in plugins.

**Why.** A workflow-owned channel table duplicates plugin policy and makes new channels require orchestration edits; separating editorial intent from channel behavior removes that duplication while preserving explicit live/spending boundaries.

**Detail:** [kk-itc-refactor.md](design/kk-itc-refactor.md); feature G21.


### Amendment — 2026-10-15 (G21 operator feedback: DAG, configuration, SEO cooperation)

**Decision.** Replace ADR-040's pure-FSM topology choice with a top-level `kk-itc` DAG containing a bounded authoring FSM; retain kk-owned fan-in/fan-out and plugin-owned channel behavior. The parent requires verified child completion before downstream work. Resolve declared ITC defaults from the canonical KK config and compose workspaces as `{works_dir}/kk-itc/{topic-name}/[YYYYMMDD]/`, preserving explicit workspace overrides. Reserve versioned SEO evidence handoffs without depending on the unfinished URL-audit workflow or inventing draft-audit support.

**Why.** Independent production branches and explicit dependencies fit the expanded workflow, while revision loops, shared configuration and typed handoffs preserve reliable continuation and ownership.

**Detail:** [kk-itc-refactor.md](design/kk-itc-refactor.md), revised graph, configuration and SEO sections. This amendment changes the prior topology recommendation; it does not claim the refactor is shipped.

---

## ADR-041: Repo gates do not grade agent answers with HIGH/MEDIUM/LOW labels

**Status:** Accepted · **Date:** 2026-10-17 · **Parity:** spur-new ADR-138 ("retire every HIGH/MEDIUM/LOW confidence label", task 1221).

**Decision.** Retire the three project rules that judged a confidence label an agent asserted about its own work: `run-answer-confidence-level` (run-plane review/verify answers), `review-record-confidence-level` (a task's `## Review`), and `verification-confidence-level` (a task's/Doc's `## Testing` and `Verification (` blocks) — files, checkers and falsification suites deleted, so the `structure` category and therefore `recommended-pre-check` no longer carry them. The product contract is untouched: `labels.confidence` keeps its closed `HIGH|MEDIUM|LOW` enum with the 0–1 mapping in `@gobing-ai/kk-store`, the judge-verdict guards keep their confidence-aware read, and `itc-author-verdict` / `itc-author-complete` / `itc-report-summary` still refuse a `PASS` without a level. Citation gates stay: `api-library-claim-citation` and `scratch-citation-existence` judge sources, not self-grades.

**Why.** A self-graded level asserted nothing a deterministic check does not already carry, so the rules bought no re-checkable evidence while costing live friction: the run-plane rule fired on an answer whose `Confidence:` line was honest but uncited, and every repair made the label longer rather than the work better. Gates must rest on reproducible evidence (test output, `path:line`, exit status); a graded label is introspection, and enforcing it teaches agents to write the token instead of the evidence. The `api-library-claim-citation` claim table keeps its level cell only because it is bound to a per-row citation it also enforces.

**Invariant.** No repo gate asserts, scores or derives a confidence level for agent-authored text. If a new check needs to express uncertainty, it must cite the artifact or name the gap — never a `HIGH|MEDIUM|LOW` label.

---

## ADR-042: The config root holds only mission-critical data; works roots hold only disposable run data

**Status:** Accepted · **Date:** 2026-10-18 · **Amends:** the compiled `works_dir` default of ADR-024 (`<works_dir>/kk.db` is retained) and the `~/.config/kk/works` default documented in 04_DESIGN §config.

**Decision.** `~/.config/kk/` and the works root are two disjoint planes with different durability contracts:

- **Config root (`~/.config/kk/`) — mission-critical, survives any cleanup.** Holds only: `config.yaml`; user preset/registries (`image-presets/`, `voices/` including every voice profile registry); `browser-profiles/<channel>/` login profiles; `backups/` for rotated `*.bak-*` files; and per-channel ADR-025 automation-guard state files `<channel>-automation.json` at the top level (grouped under `state/` only if a second kind appears). Nothing disposable, temporary, or per-run lives here.
- **Works root — disposable, deletable without data loss except `kk.db`.** Layout is frozen: only `kk.db`(`-wal`/`-shm`) and workflow-named directories at the top level; each workflow's runs compose as `<workflow-name>/<YYYYMMDD>` for daily-cadence workflows (digits only), `<workflow-name>/<topic-slug>` for topic-cadence workflows, or `<workflow-name>/<run-id>` for other per-run workflows; an optional `_archive/` holds operator-retired trees and is equally disposable. Test scratch dirs live under `tmp/test-<name>` (the former repo-root `.tmp-test-*` convention is retired) and are disposable on sight. The code-owned reserved subtrees `.board/` (ITC Board capture) and per-workflow `ledger.md` (kk ledger) are the only other sanctioned entries. `kk.db` (ADR-024 store) is the single documented exception to disposability — back it up or accept collect-history loss. Ad-hoc spur/operator artifacts (`spur-serve/`, task archives, incident evidence) never live in the works root.
- **Compiled `works_dir` default is `<cwd>/.works`** (env `KK_WORKS_DIR` > config `works_dir` > default), replacing `~/.config/kk/works`. This matches the pre-existing cwd-relative collect/board layout and guarantees a fresh install never writes disposable data into the config root. Headless/cron callers must run from a stable cwd or pin `works_dir`, since the default follows the caller's cwd.
- **Workflow YAML resolution drops the `workflows_dir` config convention of copying into `~/.config/kk/workflows`** as the day-to-day default: the shipped fallback chain (`KK_WORKFLOWS_DIR` → bun global → npm global → package root → repo checkout, 04_DESIGN §workflow resolution) is the primary source; a `workflows_dir` override remains the documented customization escape hatch, but a stale override silently wins over newer shipped copies (observed 2026-10-18: stale config-dir copies of `kk-storm-research.yaml`/`kk-solo-podcast.yaml` pre-dating ADR-012/ADR-115 ran in production), so overrides must be deliberate and re-diffed after upgrades.

**Why.** The two planes were mixed: the compiled default itself put disposable runs inside the config root, ad-hoc spur artifacts accumulated beside workflow runs, and stale config-dir workflow overrides shadowed shipped fixes invisibly. Separating durability contracts makes cleanup safe by construction (`rm -rf <works>` loses nothing but `kk.db`), makes migration a single rsync of `~/.config/kk/`, and makes the config root small enough to audit at a glance.

**Migration note (2026-10-18).** One-time reorganization moved voice profile registries into `voices/`, rotated `*.bak-*` into `backups/`, retired the stale `workflows/` override (archived under `backups/`), and consolidated non-conforming works trees under `.works/_archive/`. `browser-profiles/` does not survive a machine move reliably (Chromium cookie encryption is Keychain-bound) — plan per-channel `kk bot login` on a new host.

---

## ADR-043: Daily voice generation and publishing are two workflows joined by a frozen bundle

**Status:** Accepted · **Date:** 2026-10-22 (feature G15, tasks 0321–0327 shipped; voice2 still the installed path)

**Decision.** The daily AI-voice product is two workflows, not one: `kk-daily-ai-voice3` generates and
freezes a `bundle.json` of validated `Content` variants, and `kk-daily-publish3` publishes exactly one
**window** of that bundle per launch (`after-generate`, `cn-peak`, `overseas-rss`). The channel matrix —
which plugin, operation, variant, tier and draft/dummy mode — lives in a config-selected publish preset
(`workflows.kk-daily-ai-voice3.publish_preset`), never in workflow YAML and never in a `*_enabled` var; a
preset row can never carry `live` (ADR-022). Publish status is classified from per-target receipts, and
channel payloads are shaped on the generate side, so publishing never re-authors content.

**Why.** Re-sending one failed channel must cost seconds instead of an hour of regeneration, and adding a
channel must be a preset edit instead of a four-place workflow edit.

**Detail:** `docs/03_ARCHITECTURE.md` §Daily voice3 generate/publish split; `docs/04_DESIGN.md`
§publish-matrix stages; `docs/design/kk-daily-ai-voice3.md` §2, §5a, §8. Extends ADR-021/ADR-022 to the
daily pipeline and generalizes ADR-040's preset idea beyond ITC; surface stays `kk stage run
publish-matrix-*`, so ADR-037's noun inventory is unchanged.

---

## ADR-044: Grok Bot cloud routines prepare inputs; the Mac owns the kk store

**Status:** Accepted · **Date:** 2026-11-04 · **Feature:** F81 · **Task:** 0341 (decided before task 0343 ships any cloud execution code)

**Decision.** Four points, frozen for every Grok Bot routine rendered or run:

1. **`kk.db` never moves.** The store does not sync to, copy to, or open from a Bot computer — not via git, iCloud, smb, or any future channel. The Mac owns the store; the Bot owns preparation.
2. **Cloud routines run store-free and browser-free.** A Bot routine may execute only collection-input work that touches no database and no browser profile. Its output is a file artifact pushed by the Bot's GitHub connector to the frozen branch `kk-cloud-sync` at the path `sync/<schedule>/<stamp>.json` (`<stamp>` is `YYYYMMDDTHHMMZ`, the kk-collect stamp format).
3. **The Mac imports through existing verbs.** The Mac-side import is `kk store ingest --run cloud-<stamp> --in <file>` after a `git fetch` of `kk-cloud-sync` — typically an operator cron. No new sync verb is added; the collect fan-in seam (`kk executor fan-in --out <Doc[].json>` → `kk store ingest --in`) already splits storage-free collection from the store (`plugins/kk/workflows/kk-collect.yaml:115-121`).
4. **Publishing stays Mac-local.** Anything reading the store, the frozen bundle (ADR-043), or browser profiles (`~/.config/kk/browser-profiles/`, Keychain-bound per ADR-042) runs on the Mac only. ADR-022's live-publish consent gate is unchanged and applies to the Mac exactly as before.

**Missing/stale-input policy (every cloud render must carry it verbatim).**

| Situation | Behavior |
| --- | --- |
| Inputs or credentials missing at run time | Routine prints `no-content: <reason>` and exits with no side effects |
| Artifact older than 26 h when the Mac imports | `kk store ingest` ignores it (logged), matching the 26 h horizon digest fallback in `kk-collect.yaml:113-114` |
| Same artifact seen again | Imported at most once — idempotency by the `--run cloud-<stamp>` run id (`<stamp>` differs per routine run) |

**Rejected.** Running the store on the Bot:

- **SQLite over sync/network storage is unsafe.** SQLite's own guidance: locking is unreliable on network filesystems, and copying a live WAL database risks corruption (https://www.sqlite.org/useovernet.html, https://www.sqlite.org/howtocorrupt.html §1.2). Syncing `kk.db` (WAL) via git/iCloud is this same failure, at the file's pace.
- **Browser profiles cannot move.** Chromium cookie encryption is Keychain-bound and "do not survive a machine move reliably" (ADR-042 migration note) — publish channels are Mac-bound regardless of storage.
- **Bot computers are ephemeral-by-configuration.** Member-installed packages are removed on recreate (https://docs.x.ai/grok-bot/computers) — a durable disk does not mean durable tooling.
- **Rate budget is shared.** Routines share 200 runs/hour/routine and 300/hour across the account (https://docs.x.ai/grok-bot/skills-routines-and-automations) — a schedule wall that store-bound Mac work does not currently face.
- **Syncing `kk.db` via git/iCloud** is rejected by the same means and reasons as point (1).

**Revisit-when.** Either a documented Grok Bot storage surface with single-writer POSIX locking guarantees (a documented API, not marketing copy), or kk adopting a server-side store — whichever arrives first reopens this decision; until then the Bot stays store-free.

**Detail:** `docs/03_ARCHITECTURE.md` §Pipeline model (DAG workflows paragraph points here); seam and policy table: `docs/design/kk-collect-and-daily-voice2.md` §10. Downstream render contract: task 0343 (`kk schedule render --platform grok-bot` encodes this policy verbatim and refuses store- or browser-bound schedules, citing this ADR).

---

## ADR-045: Daily-news editorial policy lives in the `kk:news-editorial` skill

**Status:** Accepted · **Date:** 2026-11-08 · **Task:** 0345

**Decision.** Every editorial judgement of a daily news episode lives in one agent skill,
`plugins/kk/skills/news-editorial/`. It covers what to keep or drop (topic boundary and selection rubric), how to
order and weight items, how to balance news, opinion and technical detail, and the style contract with its
machine-readable caps/banned block. Workflow YAML prompts only name a skill mode plus input and output paths. Code
keeps everything deterministic: store extraction and its thresholds (`decisions/extract/*.yaml`), the plan/QC
stages, the dailynews-gen validator and builder (fixed opening and closing), duration/floor gates, safety and
renderers. The style contract moves from `plugins/kk/scripts/daily-voice-style.zh.md` to
`plugins/kk/skills/news-editorial/references/style-contract.zh.md`. The validator keeps reading the first fenced
`json` block of that file, so prompt and validator still share one source.

**How the skill reaches the writer.** kk skills are not installed for every executor (pi and codex have none), so
a run never relies on skill discovery. `daily-script-style` snapshots `SKILL.md` and the style contract into the
work dir, and prompts cite those snapshot paths. That also freezes the exact policy a run was written against.

**Shape.** One editorial pass feeds many renders. `curate` keeps or drops items, orders them and writes the
Chinese facts. `write` adds lead, insight, intro and outro, plus later card, social and cover lines. `write --fix`
repairs a plan using the validator's error list instead of silently falling back to the template. The article,
script, cards and cover render from that master. Judging stays in `content-judge` (a `news-balance` rubric), and
platform admission stays in `content-safety`.

**Why.** On 2026-11-02 a writer-model swap shifted the transcripts from news to opinion, because policy was spread
across six ≤1000-char prompts, a sidecar and code comments that the new model read literally. One owner makes the
policy reviewable in one place, lets a cheap standard-tier model follow short mode-scoped instructions, and stops
each item's facts from being authored three times.

**Rejected.** Reusing `kk:audio-authoring`, which turns a generic brief into a VoiceScript with operator gates and
has no selection policy. Keeping policy in YAML prompts, which hit the prompt cap and drift per model.

**Detail:** task 0345; `docs/design/kk-daily-ai-voice3.md`; `docs/04_DESIGN.md` §daily stages.

---

## ADR-046: Quasi-news podcast cover rendering via layered generation and deterministic typography compositing

**Status:** Accepted · **Date:** 2026-11-10 · **Task:** (Feature L2)

**Decision.** The Daily AI News episode cover transitions from an abstract flat vector illustration to a
quasi-news podcast cover (准新闻类播客封面) using a two-layer rendering architecture:
1. **Layer 1: AI Diffusion News Scene.** Generates a pure visual background (`negative: text, letters...`)
   grounded in the lead story's concrete visual scene, using a dedicated format (`daily-news-podcast-cover`,
   1344x576 at 21:9) and style preset (`quasi-news-podcast`, documentary/cinematic lighting with negative space).
2. **Layer 2: Deterministic Typography & Branding Compositing.** Composites a bold Chinese Hook headline
   (derived from the day's top news item via `news-editorial`) and the podcast brand logo badge (`assets/general/xhxs.svg`
   anchored at the top-left or top-right, with the lower `SALTY CLUB` text omitted for visual cleanliness) onto the
   generated background using deterministic graphics rendering.
3. **Anti-garble guarantee (中文抗乱码):** AI text-to-image diffusion models are strictly forbidden from directly
   synthesizing Chinese characters; all Chinese text is rendered via local vector/font engines (SVG/Canvas)
   to ensure 100% glyph correctness and crispness.
4. **Isolated testability:** A standalone runner (`kk cover render --mock`) enables immediate generation and
   verification of mock news items without running the entire daily audio pipeline.

**Why.** Abstract covers lack journalistic timeliness and viral clickability. However, direct diffusion generation
of Chinese headlines produces garbled glyphs and visual hallucinations. Layering clean AI imagery with deterministic
typography achieves both rich visual context and reliable typography.

**Detail:** Feature L2; `docs/design/daily-news-podcast-cover.md`.

---

## ADR-047: the vault config splits project file from global file

**Status:** Accepted · **Date:** 2026-11-10 · **Feature:** I1 (task 0355)

**Decision.** Vault paths, defaults, mirror dirs and remote definitions live in a project-level
`kk.config.json` at the vault root, owned by `apps/cli/src/wiki/config.ts`; the existing global
`~/.config/kk/config.yaml` keeps owning channels, presets and credentials. Precedence inside the
project file's keys is flag → `KK_WIKI_*` → `kk.config.json` → built-in default. The resolver never
creates or rewrites either file and fails naming an unsupported declared key.

**Why.** A vault is a directory the operator moves between machines and commits to its own
repository, while channel credentials are per-machine; folding both into one file makes either the
vault machine-bound or the credentials publishable.

**Detail:** `docs/design/kk-wiki.md` §5; resolver `apps/cli/src/wiki/config.ts`.

---

## ADR-048: `kk wiki` is a model-free vault package behind a CLI noun

**Status:** Accepted (design) · **Date:** 2026-11-10 · **Feature:** I1

**Decision.** A new workspace package `packages/kk-wiki` (`@gobing-ai/kk-wiki`) owns every
deterministic wiki mechanic — page model and frontmatter schema, `[[wikilink]]` graph, link/lint,
merge with redirect, `index.md`/`MAP.md` compilation, gc, the `user_edited` append-only guard, the
raw snapshot writer and the Quartz-compatible publish projection. `apps/cli/src/commands/wiki.ts`
exposes them as the `kk wiki <verb>` noun. Model-bearing authoring (`summarize`, `synthesize`,
`query`) stays in a `plugins/kk` skill that hands text to those verbs: the package never calls a
model, and the CLI never imports the executor, browser or store.

**Why.** The vault has to stay plain Markdown that a human edits and Quartz publishes, so its
mechanics must be testable without a provider and the user-edit guard must be enforced in code
rather than requested in a prompt.

**Detail:** `docs/design/kk-wiki.md`; §Module boundaries and "kk wiki vault" in `docs/03_ARCHITECTURE.md`.
