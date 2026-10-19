# AGENTS.md

Entry point for AI coding agents in this repository. `CLAUDE.md` and `GEMINI.md` symlink here.

**Read this first every session.** Lean: harness routing + project facts + where depth lives.
Does **not** restate skill runbooks or the full `spur` / `superskill` verb catalogs.

---

## Project

**knowledge-kit** — a spur-orchestrated **ingest → create → publish** platform, built as a
Bun + TypeScript + Biome CLI monorepo. Product binary: `kk` (package `@gobing-ai/knowledge-kit`, `apps/cli`).
Shared libraries: `@gobing-ai/*` (e.g. `@gobing-ai/kk-core`, `@gobing-ai/publish-harness`). Spur project
name: `knowledge-kit`.

> **The name is historical.** knowledge-kit is not only a knowledge-management tool: content
> creation and multi-channel publishing are first-class, co-equal capabilities, and **ingestion is
> optional** — a pipeline may start from a `Brief` (topic → article) with no ingested documents.
> See `docs/00_ADR.md` → **ADR-007** for the repositioning; renaming was considered and rejected.

**The product model.** Product plugins are directories with a `plugin.json` manifest, discovered
under kind collections (`plugins/ingestions|generations|publishings/<name>/`, ADR-009). Default
runtime discovery is a multi-root union (package-shipped built-ins + user/project/`KK_PLUGIN_PATH`,
ADR-012 — shipped, feature B7). Agent
skills, slash commands, subagents, hooks, and rules live only in `plugins/kk`. Three kinds:

| Kind | Contract |
| ------ | ---------- |
| `ingestion` | `source → Doc[]` (optional in a pipeline) |
| `generator` | `Doc[] \| Brief → Content` |
| `publish` | `Content → Result` |

> **LLM-as-judge is not a plugin kind.** Quality gating is delivered as agent skills + `agent.run`
> (ADR-007 amdt 2026-08-07). See `plugins/kk/skills/content-judge/SKILL.md`.

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
  cli/            # @gobing-ai/knowledge-kit — Commander binary (executor, plugin)
packages/
  kk-core/        # @gobing-ai/kk-core — Doc/Brief/Content/Result contracts + kindContract
  publish-harness/  # @gobing-ai/publish-harness — publish transport abstraction + fake transports
tooling/
  typescript/     # shared tsconfig presets
plugins/
  ingestions/     # product ingestion plugins (`kind: ingestion`)
  generations/    # product generator plugins (`kind: generator`)
  publishings/    # product publish plugins (`kind: publish`)
  kk/             # Claude Code plugin: skills, commands, agents, hooks, rules
                  # (capability names omit kk- — superskill install prefixes `kk:`)
docs/design/      # per-kind authoring specs (ingestion, generator, publish, fan-in/fan-out)
.spur/            # Spur config, rules, workflows, templates
```

`*` = specified under ADR-007, not yet implemented. See `docs/04_DESIGN.md` §1.

- **Runtime / package manager / test runner:** Bun `1.4.3`. Prefer `bun:*` APIs over `node:*`
  unless Bun lacks the API.
- **Lint + format:** Biome **`2.5.15`** only (`@biomejs/biome` root devDependency +
  `.prototools`). No ESLint, no Prettier. Always use `bun run lint` / `bun run format` so the
  pinned binary is used — not a system `biome` on PATH.
- **Build orchestration:** Bun workspaces (Turborepo available where present).
- **Tool versions:** pinned in `.prototools` via [proto](https://moonrepo.dev/proto). Run
  `proto use` to install. Exception: `spur` and `superskill` are never pinned — always run and record
  "latest" (bare CLI, `@latest` installs); version numbers belong only in point-in-time evidence, not live
  configs.
- **Single global install:** keep exactly one `spur` on PATH (the bun-global one) — a second npm-global
  copy shadows it and silently downgrades the engine.
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

## Code style (enforced by Biome 2.5.15 / `biome.json`)

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
bun run gate            # final quality gate: format + build + lint + rules + tests
bun run lint            # biome 2.5.15 check + typecheck  (the gate)
bun run format          # biome check --write
bun run autofix         # format then typecheck
bun run test            # unit tests (dots reporter) + coverage → .coverage/
bun run test:full       # unit tests (detailed console) + coverage
bun run build           # all workspaces with a build script
bun run dev             # workspace dev scripts
bun run spur-check      # lint + pre-check + test (dots) + post-check
bun run spur-check:full # lint + pre-check + test:full (detailed) + post-check
bun run tools:fresh     # warn if installed spur/superskill is behind npm latest or PATH-shadowed
```

CLI binary: `@gobing-ai/knowledge-kit` exposes `bin: { kk: "./dist/index.js", "knowledge-kit":
"./dist/index.js" }`; `prepack` runs the bun build so npm pack sees the bundle (ADR-010 R5).

### Verification gate (all must pass before "done")

1. `bun run lint` clean — Biome 2.5.15 and typecheck.
2. `bun run test` passes; no test skipped, `.skip`'d, or commented out to go green.
3. `bun run build` succeeds across workspaces that declare a `build` script.
4. `git status` shows only intentional changes.

If a check fails, fix the root cause. **Never** bypass with `--no-verify`, `--force`, or new
`biome-ignore` suppressions added solely to silence the gate.

### Editing `plugins/kk/scripts/` (stage bodies)

`kk stage <name>` resolves its runner from the **installed** package (`$HOME/node_modules/@gobing-ai/`
`knowledge-kit/plugins/kk/scripts/`), not from this checkout — product *plugins* resolve the opposite
way (the project root shadows the install). A stage edit is therefore live for `kk executor run` but
invisible to `kk stage`, and every scheduled workflow (the 04:30 daily voice run included) keeps
executing the old body. Refresh the copy after editing:

```bash
rsync -a plugins/kk/scripts/ "$HOME/node_modules/@gobing-ai/knowledge-kit/plugins/kk/scripts/"
```

Until this repo is released and reinstalled, that copy is the one the cron actually runs.

### Testing

- Tests live in `tests/` next to the code (`<workspace>/tests/*.test.ts`), using `bun:test`.
- Coverage target: **line >= 90% and function >= 90% per file** (`bunfig.toml`'s
  `coverageThreshold`). Measured 2026-10-12: bun enforces it per file, not on the aggregate — a full
  suite reporting 98% overall still exited 1 because two files sat at 88%, and it prints `0 fail`
  either way, so read the exit code, not the pass count alone.
- **`bun test <file>` exits 1 on coverage, not on failures.** One file under-covers the modules it
  loads, so judge a single-file run by its pass/fail counts; `bun run test` exits 0 only when every
  file clears 90%.
- Names describe behavior under a condition; assertions tie to the requirement.
- For CLI output, assert via `logger` / stdout writers (not log-format coupling).

---

## Architecture decision record (binding)

`docs/00_ADR.md` is authoritative. Read it before non-trivial changes to the workspace graph, CLI
surface, or cross-package boundaries. Contradictions require a new dated ADR entry first.

For plugin packaging, invocation completion, cancellation, and retry changes, read
`docs/03_ARCHITECTURE.md` → **Execution boundary integrity** for required behavior and known gaps.

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

### Config vs works split (ADR-042)

- `~/.config/kk/` is **mission-critical only**: `config.yaml`, presets/registries (`image-presets/`,
  `voices/` incl. all voice profile registries), `browser-profiles/`, `backups/`, and
  `<channel>-automation.json` guard state. Nothing disposable or per-run lives here.
- The works root holds only `kk.db*` and `<workflow-name>/<run>` dirs (`<YYYYMMDD>` digits for
  daily-cadence, `<topic-slug>` for topic-cadence, `<run-id>` otherwise, optional `_archive/`,
  `tmp/test-<name>` for test scratch).
  Everything is disposable **except `kk.db`**. Spur artifacts (`.board/`, task archives, incident
  evidence) never go here.
- Compiled `works_dir` default is `<cwd>/.works` — headless/cron callers must pin `works_dir` or
  run from a stable cwd. A `workflows_dir` override silently beats shipped workflow copies — prefer
  the fallback chain and re-diff any override after upgrades.

- Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, …); breaking changes in a
  `BREAKING CHANGE:` footer.
- Cross-workspace imports use `@gobing-ai/<pkg>` only.
- Never commit secrets or `.env*`. Never edit `.github/workflows/` without approval.
- Surgical changes only — no drive-by refactors or speculative abstractions.
- Surface changes keep `docs/04_DESIGN.md` in the **same commit** (T3).

---

## Indexed context

Project context under `.spur/context/`, tracked in git except `token-ledger.jsonl` (gitignored), via **`sp:indexed-context`**:

1. `anatomy.md` — file one-liners + token estimates
2. `learnings.md` — conventions / decisions
3. `pitfalls.md` — do-not-repeat
4. `buglog.md` — historical bugs
5. `memory.md` — session log
6. `token-ledger.jsonl` — auto; never hand-edit

If `.spur/context/` is absent, continue; do not block.


### Planned CLI/session follow-up

A22 / ADR-037/038 specify canonical `stage run`, top-level `lock acquire|release`, and `bot list|login|logout|open`, retaining shipped spellings as hidden compatible routes. This is accepted design, not a shipped surface. See `docs/design/kk-noun-verb-bots.md`; keep site readiness and special authentication-state handling in channel plugins.
