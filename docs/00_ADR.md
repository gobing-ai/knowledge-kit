---
name: Architecture Decision Record
doc: 00_ADR
owns: WHY — which cross-cutting decision was made, and the one-line reason
authority: authoritative
version: 1.4.0
created_at: 2026-05-28
updated_at: 2026-07-24
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

> **Status:** Accepted · **Supersedes:** the "minimal CLI monorepo" product framing of the prior
> `01_PRD` (v1.1.0). This is a product pivot, not a toolchain change — ADR-001..005 (layout,
> Commander, `@gobing-ai/*` boundary, testable output, Biome) remain the substrate.

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
  **not** the deferred DAG runtime.
- **Discovery** = filesystem scan of `plugins/*/plugin.json` grouped by kind (feature B1).

This supersedes the earlier reading of "TypeScript interfaces … with lifecycle methods" as
in-process classes; the methods are the ingest→generate→publish step sequence spur workflow runs.

---

## Decisions deliberately deferred

- **Config / persistent state** — none yet; add as a `packages/*` workspace when needed.
- **Interactive prompts, colored output** — out of scope until a command requires them.
