# knowledge-kit

**Ingest → Create → Publish** — a content pipeline platform built as a Bun + TypeScript CLI
monorepo. `knowledge-kit` turns documents (or just a topic brief) into finished, published
content across multiple channels.

> **The name is historical.** knowledge-kit is not only a knowledge-management tool: content
> creation and multi-channel publishing are first-class, co-equal capabilities, and **ingestion is
> optional** — a pipeline may start from a `Brief` (topic → article) with no ingested documents.
> See `docs/00_ADR.md` → **ADR-007** for the repositioning.

The product binary is `@gobing-ai/knowledge-kit` (`apps/cli`), installed globally as both `kk` and
`knowledge-kit`. Pipelines are expressed as **plugins** (ingestion / generator / publish) wired
together by **spur workflows** — `kk` owns each step, `spur` owns the orchestration.

---

## Features

| Capability | Status | What it is |
| --- | --- | --- |
| Plugin platform | ✅ | `plugin.json` manifests + registry discovery; three kinds — `ingestion`, `generator`, `publish` |
| Typed contracts | ✅ | `Doc` / `Brief` / `Content` / `Result` + per-kind `kindContract` in `@gobing-ai/kk-core` |
| CLI surface | ✅ | Two-noun tree `executor run\|fan-in\|fan-out` + `plugin status` (ADR-010/011) |
| Pipeline orchestration | ✅ | `spur workflow` shells out to `kk` subcommands; proven end-to-end (fixture → content → `ok:true`) |
| Fan-in / fan-out | ✅ | Sequential `kk executor fan-in` (dedupe merge) and `kk executor fan-out` (multi-target publish with retry) steps |
| Ingestion | ✅ | `karakeep-local` plugin (`source → Doc[]`) |
| Generation | ✅ | Owned STORM pipeline behind the generator contract (`content-gen`) |
| Publishing | ✅ | `surfdash-pub`, `zenn-pub`, `qiita-pub` on a shared transport harness; more channels on the roadmap |
| Quality gating | 🚧 | `judge` LLM-as-judge skills (tech-accuracy, brand-tone, compliance) wired via `agent.run` |
| Authoring skills | 🚧 | `topic` topic-core skill (`create`, `init`, `outline`, `draft`) |
| Distribution | ✅ | npm tarball ships `plugins/kk` + marketplace — install into any coding agent via `superskill install` |

Status legend: ✅ shipped · 🚧 in flight. Full per-feature detail lives in `docs/05_FEATURES.md`.

---

## Quick start
### From command lines
Install the CLI and the `kk` plugin collection globally:

```bash
# install superskill, we will use it to install claude code style plugin
bun add -g @gobing-ai/superskill

# install kk CLI
bun add -g @gobing-ai/knowledge-kit

# install plugin kk to all coding agents.
# The marketplace locator is the knowledge-kit REPO (owner/repo or full URL) —
# an org URL like https://github.com/gobing-ai/ is not parseable.
# The repo is private, so superskill needs a GitHub token in the environment
# (GITHUB_TOKEN or GH_TOKEN — the gh CLI auth alone is not consulted for 404s):
#   export GH_TOKEN=$(gh auth token)
# It caches under ~/.cache/superskill/marketplaces (warm cache works offline).
superskill install kk --marketplace https://github.com/gobing-ai/knowledge-kit
```

### From source

```bash
bun install                 # workspaces: apps, packages, plugins
bun run dev                 # run the CLI against src/
bun run build               # bundle apps/cli → dist/index.js
bun run test                # unit tests + coverage
bun run spur-check          # full quality gate: lint → rules → tests → rules
```

Requires [Bun 1.3.14](https://bun.sh) (`proto use` installs the pinned toolchain from
`.prototools`).

---

## Commands

| Command | What it does |
| --- | --- |
| `kk executor run <plugin> --in <path> --out <path>` | Invoke a plugin with input/output files and contract validation |
| `kk executor fan-in` | Merge N `Doc[]` JSON inputs into one deduplicated `Doc[]` output |
| `kk executor fan-out` | Publish one `Content` JSON to N targets, aggregating per-target results |
| `kk plugin status` | List discovered plugins grouped by kind with per-plugin health (`--kind`, `--json`) |
| `kk -v, --verbose` | Enable verbose diagnostics |
| `kk --help` / `kk <command> --help` | Full flag reference |

Hidden one-release aliases (`invoke`, `fanin`, `fanout`, `plugins list`, `plugins doctor`) still
work but are not listed in `kk --help` (ADR-011).

---

## The plugin model

Plugins are directories with a `plugin.json` manifest, discovered by a registry scan, in three
kinds:

| Kind | Contract | Example |
| --- | --- | --- |
| `ingestion` | `source → Doc[]` | `karakeep-local` |
| `generator` | `Doc[] \| Brief → Content` | `content-gen` (owned STORM pipeline) |
| `publish` | `Content → Result` | `surfdash-pub`, `zenn-pub`, `qiita-pub` |

**LLM-as-judge is not a plugin kind.** Quality gating is delivered as agent skills + `agent.run`
(ADR-007). The judge lives in the `kk` plugin collection: `plugins/kk/skills/judge`.

Core contracts (`Doc`, `Brief`, `Content`, `Result`) and the `kindContract` per kind live in
`@gobing-ai/kk-core`. A **pipeline** is a `spur workflow` whose states shell out to `kk`
subcommands — `kk` owns steps; `spur workflow` owns orchestration, never the reverse.

---

## Repository layout

| Path | What lives there |
| --- | --- |
| `apps/cli/` | `@gobing-ai/knowledge-kit` — the Commander binary (`kk` / `knowledge-kit` bins), command registration per noun |
| `packages/utils/` | `@gobing-ai/utils` — helpers, zod re-export, logger |
| `packages/kk-core/` | `@gobing-ai/kk-core` — `Doc`/`Brief`/`Content`/`Result` contracts, `kindContract`, plugin registry discovery |
| `packages/publish-harness/` | `@gobing-ai/publish-harness` — publish transport abstraction + fake transports for tests |
| `plugins/kk/` | The `kk` plugin collection — skills, commands, subagents, hooks, rules (distributed in the npm tarball) |
| `plugins/ingestions/` | Ingestion-kind plugins (e.g. `karakeep-local`) |
| `plugins/generations/` | Generator-kind plugins (e.g. `content-gen`) |
| `plugins/publishings/` | Publish-kind plugins (e.g. `surfdash-pub`, `zenn-pub`, `qiita-pub`) |
| `scripts/` | Release tooling — `release.ts` (`bump-ver`/`drop-tags`), `publish.ts` (npm Trusted Publishing), `bundle-plugins.ts` (tarball staging) |
| `docs/` | Numbered docs: `00_ADR` (decisions), `01_PRD` (scope), `02_ROADMAP`, `03_ARCHITECTURE`, `04_DESIGN` (surface), `05_FEATURES` (status), `99_PROJECT_CONSTITUTION` (process) |
| `.spur/` | Spur config, rules, workflows, templates; run artifacts under `.spur/run/` |

---

## Development

### Stack

| Tool | Version | Role |
| --- | --- | --- |
| Bun | 1.3.14 | Runtime, package manager, test runner |
| TypeScript | ESNext, strict | Language |
| Biome | 2.5.5 | Lint + format (pinned in `package.json` + `.prototools`) |
| Lefthook | 2.1.10 | Git hooks |
| Cocogitto | 7.0.0 | Conventional commits |
| proto | — | Tool version pins (`.prototools`) |
| Spur | — | Project quality harness (rules, tasks, workflows) |
| Commander | 15.0.0 | CLI framework |

### Verification gate (all must pass before "done")

```bash
bun run autofix && bun run spur-check   # format + typecheck, then lint → rules → tests → rules
```

1. `bun run lint` clean — Biome 2.5.5 and typecheck.
2. `bun run test` passes; no skipped tests. Coverage target: line ≥ 90%, function ≥ 90%.
3. `bun run build` succeeds across workspaces.
4. `git status` shows only intentional changes.

### Conventions

- Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, …); breaking changes in a
  `BREAKING CHANGE:` footer. Enforced by cocogitto via lefthook.
- Tests live in `tests/` next to the code (`<workspace>/tests/*.test.ts`), using `bun:test`.
- Cross-workspace imports use `@gobing-ai/<pkg>` only — never deep relative paths into siblings.
- Never introduce a new runtime, package manager, linter, or formatter.

### Releasing

Release tags follow `@gobing-ai/knowledge-kit-v<version>`; pushing one triggers the
`Publish` GitHub Actions workflow (npm Trusted Publishing via OIDC — no registry token needed).

```bash
bun run bump-ver 0.0.4 --push    # bump version → commit → tag → push branch + tag
bun run drop-tags 0.0.4          # delete the release tag (add --remote for origin)
```

The workflow verifies the tag matches `apps/cli/package.json`, verifies release assets
(`dist/`, `plugins/kk/`, `.claude-plugin/marketplace.json` in the tarball, no test files), then
publishes.

---

## Documentation

| Doc | Owns |
| --- | --- |
| `docs/00_ADR.md` | **WHY** — cross-cutting decisions (authoritative) |
| `docs/01_PRD.md` | **WHAT** — vision, users, scope |
| `docs/02_ROADMAP.md` | **WHEN** — phases |
| `docs/03_ARCHITECTURE.md` | **HOW** — boundaries, data flow |
| `docs/04_DESIGN.md` | **SURFACE** — commands, flags, schemas |
| `docs/05_FEATURES.md` | **STATUS** — feature tree |
| `docs/99_PROJECT_CONSTITUTION.md` | **PROCESS** — edit rules for the docs above |
| `CHANGELOG.md` | Release notes |

Conflict rule: lower number wins on content; `99` owns process.
