# knowledge-kit

Bun + TypeScript + Biome **CLI monorepo** for the knowledge-kit command-line tool.
Shared logic lives in workspace packages under `@gobing-ai/*`; the binary is
`@gobing-ai/knowledge-kit`.

## Stack

| Tool       | Version        | Role                                                     |
| ---------- | -------------- | -------------------------------------------------------- |
| Bun        | 1.3.14         | Runtime, package manager, test runner                    |
| TypeScript | ESNext, strict | Language                                                 |
| Biome      | **2.5.5**      | Lint + format (pinned in `package.json` + `.prototools`) |
| Lefthook   | 1.13.0         | Git hooks                                                |
| Cocogitto  | 6.5.0          | Conventional commits                                     |
| proto      | —              | Tool version pins (`.prototools`)                        |
| Spur       | —              | Project quality harness (rules, tasks, workflows)        |
| Commander  | ^14            | CLI framework                                            |

## Layout

```
apps/
  cli/                 # @gobing-ai/knowledge-kit — Commander binary
packages/
  utils/               # @gobing-ai/utils — helpers, zod re-export, logger
tooling/
  typescript/          # shared tsconfig presets
.spur/                 # Spur config, rules, workflows
docs/                  # 00–05 + 99 constitution
```

## Quick start

```bash
# Toolchain (optional but recommended)
proto use              # installs bun + biome 2.5.5 + lefthook + cog

bun install            # also runs lefthook install via prepare
bun run check          # lint + typecheck + tests
```

Run the CLI:

```bash
bun run --filter @gobing-ai/knowledge-kit start -- --help
bun run --filter @gobing-ai/knowledge-kit start -- add 3 4
# or after link / from apps/cli:
bun apps/cli/src/index.ts add 3 4
```

## CLI surface

Binary name: `knowledge-kit` (`apps/cli` `bin`).

| Command                     | Description                     |
| --------------------------- | ------------------------------- |
| `knowledge-kit add <a> <b>` | Add two integers; print the sum |

Full surface shapes: [`docs/04_DESIGN.md`](docs/04_DESIGN.md).

## Commands

| Command                   | Description                                               |
| ------------------------- | --------------------------------------------------------- |
| `bun run lint`            | Biome **2.5.5** check + TypeScript typecheck              |
| `bun run format`          | Biome autofix                                             |
| `bun run autofix`         | Format then typecheck                                     |
| `bun run typecheck`       | Typecheck all workspaces                                  |
| `bun run test`            | Unit tests with **dots** reporter + coverage              |
| `bun run test:full`       | Unit tests with **detailed** console output + coverage    |
| `bun run build`           | Bundle CLI to `apps/cli/dist/`                            |
| `bun run check`           | lint + test (dots)                                        |
| `bun run check:full`      | lint + test:full (detailed)                               |
| `bun run spur-check`      | lint + Spur pre-check + test (dots) + post-check          |
| `bun run spur-check:full` | lint + Spur pre-check + test:full (detailed) + post-check |
| `bun run dev`             | Workspace dev scripts (CLI `start` where defined)         |

## Workspace packages

| Package                    | Path             | Role                                  |
| -------------------------- | ---------------- | ------------------------------------- |
| `@gobing-ai/knowledge-kit` | `apps/cli`       | Product CLI binary                    |
| `@gobing-ai/utils`         | `packages/utils` | Pure helpers, `logger`, zod re-export |

Cross-package imports use the `@gobing-ai/*` alias only — never deep relative paths into a sibling package.

## Tooling notes

### Biome 2.5.5

- Pinned as root `devDependency`: `@biomejs/biome@2.5.5` so `bun run lint` / `format` use the local binary (not a system Biome).
- Also pinned in `.prototools` for `proto use`.
- Schema in `biome.json` matches `2.5.5`.

### Test reporters

| Script              | Reporter                          | Used by                         |
| ------------------- | --------------------------------- | ------------------------------- |
| `bun run test`      | `--dots` (compact)                | `spur-check`, `check`           |
| `bun run test:full` | default console (per-test detail) | `spur-check:full`, `check:full` |

### Spur

```bash
bun run check        # lint + tests
bun run spur-check   # full quality gate with Spur rule presets
```

Rules live under `.spur/rules/`. Project name in `.spur/config.yaml` is `knowledge-kit`.

## Testing

- Runner: `bun:test`
- Location: `<workspace>/tests/*.test.ts`
- Coverage target: line ≥ 90% and function ≥ 90% aggregate (`bunfig.toml`)

## Verification gate

Before calling work done:

```bash
bun run lint
bun run test
bun run build
```

Architecture / rule changes should also run `bun run spur-check`.

## Documentation

| Doc                                                                  | Owns                                  |
| -------------------------------------------------------------------- | ------------------------------------- |
| [`AGENTS.md`](AGENTS.md)                                             | Agent entry + stack + harness routing |
| [`docs/00_ADR.md`](docs/00_ADR.md)                                   | Architecture decisions                |
| [`docs/01_PRD.md`](docs/01_PRD.md)                                   | Product scope                         |
| [`docs/02_ROADMAP.md`](docs/02_ROADMAP.md)                           | Phases                                |
| [`docs/03_ARCHITECTURE.md`](docs/03_ARCHITECTURE.md)                 | Module boundaries                     |
| [`docs/04_DESIGN.md`](docs/04_DESIGN.md)                             | CLI / config surface                  |
| [`docs/05_FEATURES.md`](docs/05_FEATURES.md)                         | Feature status                        |
| [`docs/99_PROJECT_CONSTITUTION.md`](docs/99_PROJECT_CONSTITUTION.md) | Doc process                           |

## Security

Never commit secrets, `.env*`, credentials, or private endpoints. See [SECURITY.md](SECURITY.md).

## License

Apache 2.0 — see [LICENSE](LICENSE).

## Referecnes

- [Mem0 团队对 Agent Wiki 这个新兴品类做了一次全景综述](https://x.com/yibie/status/2079711445261173097)
