# AGENTS.md

Entry point for AI coding agents in this repository. `CLAUDE.md` and `GEMINI.md` symlink here.

**Read this first every session.** Lean: harness routing + project facts + where depth lives.
Does **not** restate skill runbooks or the full `spur` / `superskill` verb catalogs.

---

## Project

**knowledge-kit** — a spur-orchestrated **ingest → create → publish** platform, built as a
Bun + TypeScript + Biome CLI monorepo. Product binary: `@gobing-ai/knowledge-kit` (`apps/cli`).
Shared libraries: `@gobing-ai/*` (e.g. `@gobing-ai/utils`, `@gobing-ai/kk-core`). Spur project
name: `knowledge-kit`.

> **The name is historical.** knowledge-kit is not only a knowledge-management tool: content
> creation and multi-channel publishing are first-class, co-equal capabilities, and **ingestion is
> optional** — a pipeline may start from a `Brief` (topic → article) with no ingested documents.
> See `docs/00_ADR.md` → **ADR-007** for the repositioning; renaming was considered and rejected.

**The product model.** Plugins are directories with a `plugin.json` manifest, discovered by a
registry scan, in three kinds:

| Kind | Contract |
|------|----------|
| `ingestion` | `source → Doc[]` (optional in a pipeline) |
| `generator` | `Doc[] \| Brief → Content` |
| `publish` | `Content → Result` |

> **LLM-as-judge is not a plugin kind.** Quality gating is delivered as agent skills + `agent.run`
> (ADR-007 amdt 2026-08-07). See `plugins/kk/skills/kk-judge/SKILL.md`.

A **pipeline** is a `spur workflow` whose states shell out to `kk` subcommands. **`kk` owns steps;
`spur workflow` owns orchestration** — never the reverse. The workflow engine executes one node at
a time (`type: parallel` is an inert schema field — see `docs/03_ARCHITECTURE.md`), so fan-in and
fan-out are `kk`'s own sequential subcommands, not engine features.

This project uses two complementary first-class harness tools:

- **Spur** — `spur` provides deterministic project corpus/ops; the `sp` agent surface
  (`/sp:dev-*` commands + `sp:*` subagents/skills) drives planning, execution, review, and docs
  hygiene.
- **Superskill** — `superskill` installs plugin capabilities across supported coding agents and
  manages the authoring and quality lifecycle for skills, commands, agents, hooks, and main-agent
  configs.

Prefer these entry surfaces over ad-hoc process unless the operator overrides for a one-off.

### Layout

```
apps/
  cli/            # @gobing-ai/knowledge-kit — Commander binary (invoke, plugins, fanin*, fanout*)
packages/
  utils/          # @gobing-ai/utils — helpers, zod re-export, logger
  kk-core/        # @gobing-ai/kk-core — Doc/Brief/Content/Result contracts + kindContract
  publish-harness/  # @gobing-ai/publish-harness — publish transport abstraction + fake transports
tooling/
  typescript/     # shared tsconfig presets
plugins/          # plugin collection — one dir per plugin, each with plugin.json
docs/design/      # per-kind authoring specs (ingestion, generator, publish, fan-in/fan-out)
.spur/            # Spur config, rules, workflows, templates
```

`*` = specified under ADR-007, not yet implemented (feature **B6**). See `docs/04_DESIGN.md` §1.

- **Runtime / package manager / test runner:** Bun `1.3.14`. Prefer `bun:*` APIs over `node:*`
  unless Bun lacks the API.
- **Lint + format:** Biome **`2.5.5`** only (`@biomejs/biome` root devDependency +
  `.prototools`). No ESLint, no Prettier. Always use `bun run lint` / `bun run format` so the
  pinned binary is used — not a system `biome` on PATH.
- **Build orchestration:** Bun workspaces (Turborepo available where present).
- **Tool versions:** pinned in `.prototools` via [proto](https://moonrepo.dev/proto). Run
  `proto use` to install.
- **Git hooks:** Lefthook. **Conventional commits:** cocogitto (`cog`).

Never introduce a new runtime, package manager, linter, or formatter.

---

## Harness-first contract

All product development work goes through the harness by default.

### Harness tool routing

| Need                                                   | Route to                                                                       | Avoid                                              |
| ------------------------------------------------------ | ------------------------------------------------------------------------------ | -------------------------------------------------- |
| Plan a feature (intake → AC → tasks)                   | `/sp:dev-plan`, `/sp:dev-idea`                                                 | Freeform feature files without gates               |
| Drive one task end-to-end                              | `/sp:dev-run <wbs>` or **`sp:super-coder`**                                    | Implement with no task / no pipeline               |
| Batch or parallel task runs                            | `/sp:dev-runall`, `/sp:dev-parallel` → **`sp:super-coder`**                    | Unordered multi-task thrash                        |
| Multi-step corpus CLI (tasks/features/rules/workflows) | **`sp:expert-spur`**                                                           | Raw Write/Edit on corpus files                     |
| Look up `spur` verbs / flags / `--json`                | Skill **`sp:spur-cli`**                                                        | Inventing flags from memory                        |
| Create/edit/list tasks or features                     | **`spur task` / `spur feature`** (`--section --from-file`)                     | Direct-writing task/feature corpus files           |
| Verify requirements / AC                               | `/sp:dev-verify`                                                               | Self-reported “done”                               |
| Review (SECUA + traceability + architecture)           | `/sp:dev-review` or **`sp:super-reviewer`**                                    | Unstructured “LGTM”                                |
| Tests / coverage                                       | `/sp:dev-unit`                                                                 | Untested production paths as done                  |
| Constraint gate / rule authoring                       | **`spur rule`**; `/sp:rule-scan`, `/sp:rule-add`, `/sp:rule-refine`            | Skipping `spur rule run`                           |
| Workflow author / run                                  | **`spur workflow`**; `/sp:workflow-add`, `/sp:workflow-refine`                 | Ad-hoc shell as the lifecycle                      |
| Docs drift / sync / lessons                            | Skill **`sp:doc-evolve`** + `docs/99_PROJECT_CONSTITUTION.md`                  | Patching derived docs over authority               |
| Wrap completed work                                    | `/sp:dev-wrap`, `/sp:dev-wrapall`                                              | Skipping learnings / doc sync                      |
| Session index / memory                                 | Skill **`sp:indexed-context`** + `.spur/context/`                              | Full-tree re-reads every turn                      |
| Install / sync a plugin across coding agents           | **`superskill install <plugin>`**                                              | Hand-copying per-platform adapters                 |
| Capability authoring / quality lifecycle               | **`superskill <noun> --help`** (`agent`, `skill`, `command`, `hook`, `magent`) | Bypassing the noun's validation / evaluation gates |

**Non-negotiable (unless operator overrides):**

1. **CLI-gated corpus writes** — `spur task update` / `spur feature update` (etc.). Never
   direct-write task/feature corpus files.
2. **Gates before done** — `spur task check` / `spur feature check` / `spur rule run`; pipeline
   done needs a real verify **PASS**.
3. **`--json` for machines** — parse CLI with `--json`.
4. **Route, don’t invent** — verbs → `sp:spur-cli`; lifecycle → `/sp:dev-*` / `sp:super-coder`;
   multi-noun corpus → `sp:expert-spur`; review → `sp:super-reviewer`; docs process →
   `sp:doc-evolve`.
5. **Keep tool ownership explicit** — project lifecycle/corpus/gates → Spur; plugin installation
   and capability lifecycle → Superskill.

**Platform fallback:** Platforms without slash commands and/or subagents still use the harness
via `spur` / `superskill` CLIs and skills.

---

## Documentation

**Process SSOT:** `docs/99_PROJECT_CONSTITUTION.md`. Operate with **`sp:doc-evolve`**.

**Conflict rule:** lower number wins on content (`00` decisions, `01` scope, `99` process). Fix
authority first, then derived docs, then this file.

### Doc map

| Doc                               | Owns the question                      | Authority                    | Read / edit when                                |
| --------------------------------- | -------------------------------------- | ---------------------------- | ----------------------------------------------- |
| `docs/00_ADR.md`                  | **WHY** — cross-cutting decisions      | **Authoritative**            | Structural change; dated entry before diverging |
| `docs/01_PRD.md`                  | **WHAT** — vision, users, scope        | **Authoritative on scope**   | New feature/command; scope changes              |
| `docs/02_ROADMAP.md`              | **WHEN** — phases                      | Derived                      | Phase placement / status                        |
| `docs/03_ARCHITECTURE.md`         | **HOW** — boundaries, data flow        | Derived (ADR wins)           | Cross-module / seam / schema                    |
| `docs/04_DESIGN.md`               | **SURFACE** — commands, flags, schemas | Derived                      | Same commit as surface code (T3)                |
| `docs/05_FEATURES.md`             | **STATUS** — feature tree              | Derived                      | Feature status changes (T4)                     |
| `docs/99_PROJECT_CONSTITUTION.md` | **PROCESS**                            | **Authoritative on process** | Before editing numbered docs                    |
| `AGENTS.md` (this file)           | **ENTRY**                              | Derived                      | First every session                             |

**Routing:** decision → `00`; scope → `01`; mechanism → `03`; surface → `04`; phase → `02`;
feature status → `05`.

---

## Code style (enforced by Biome 2.5.5 / `biome.json`)

- 4-space indent, `lineWidth` 120.
- **Single quotes**, semicolons always, trailing commas everywhere.
- `interface` for object shapes, `type` for unions/intersections.
- Imports/exports are auto-sorted by Biome — don't hand-order them.
- `any` is an **error** (`noExplicitAny`). Narrow the type; if unavoidable, justify with
  `// biome-ignore`.
- TS source imports use extensionless relative specifiers.
- Workspace imports: always `@gobing-ai/*`, never deep relative paths into a sibling package.

---

## Build & verification

```bash
bun run autofix && bun run spur-check   # final quality gate
bun run lint            # biome 2.5.5 check + typecheck  (the gate)
bun run format          # biome check --write
bun run autofix         # format then typecheck
bun run test            # unit tests (dots reporter) + coverage → .coverage/
bun run test:full       # unit tests (detailed console) + coverage
bun run build           # all workspaces with a build script
bun run dev             # workspace dev scripts
bun run spur-check      # lint + pre-check + test (dots) + post-check
bun run spur-check:full # lint + pre-check + test:full (detailed) + post-check
```

CLI binary: `@gobing-ai/knowledge-kit` exposes `bin: { knowledge-kit: "./src/index.ts" }` (Bun
only). After `bun run build`, the bundle is at `apps/cli/dist/index.js`.

### Verification gate (all must pass before "done")

1. `bun run lint` clean — Biome 2.5.5 and typecheck.
2. `bun run test` passes; no test skipped, `.skip`'d, or commented out to go green.
3. `bun run build` succeeds across workspaces that declare a `build` script.
4. `git status` shows only intentional changes.

If a check fails, fix the root cause. **Never** bypass with `--no-verify`, `--force`, or new
`biome-ignore` suppressions added solely to silence the gate.

### Testing

- Tests live in `tests/` next to the code (`<workspace>/tests/*.test.ts`), using `bun:test`.
- Coverage target: **line >= 90% and function >= 90%** aggregate (`bunfig.toml`).
- Names describe behavior under a condition; assertions tie to the requirement.
- For CLI output, assert via `logger` / stdout writers (not log-format coupling).

---

## Architecture decision record (binding)

`docs/00_ADR.md` is authoritative. Read it before non-trivial changes to the workspace graph, CLI
surface, or cross-package boundaries. Contradictions require a new dated ADR entry first.

---

## Spur CLI surface

**Not the verb catalog.** For flags, exit codes, and `--json` shapes → skill **`sp:spur-cli`**.
Lifecycle → `/sp:dev-*` / **`sp:super-coder`**. Multi-noun corpus → **`sp:expert-spur`**.

```bash
spur <noun> <verb> … --json
spur <noun> --help
```

---

## Superskill CLI surface

Spur owns project lifecycle/corpus; Superskill owns plugin install and capability quality.

```bash
superskill install <plugin> --dry-run
superskill <agent|skill|command|hook|magent> --help
```

---

## Conventions & boundaries

- Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, …); breaking changes in a
  `BREAKING CHANGE:` footer.
- Cross-workspace imports use `@gobing-ai/<pkg>` only.
- Never commit secrets or `.env*`. Never edit `.github/workflows/` without approval.
- Surgical changes only — no drive-by refactors or speculative abstractions.
- Surface changes keep `docs/04_DESIGN.md` in the **same commit** (T3).

---

## Indexed context

Project context under `.spur/context/` (gitignored), via **`sp:indexed-context`**:

1. `anatomy.md` — file one-liners + token estimates
2. `learnings.md` — conventions / decisions
3. `pitfalls.md` — do-not-repeat
4. `buglog.md` — historical bugs
5. `memory.md` — session log
6. `token-ledger.jsonl` — auto; never hand-edit

If `.spur/context/` is absent, continue; do not block.
