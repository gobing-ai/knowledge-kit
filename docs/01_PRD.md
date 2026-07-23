---
name: Product Requirements
doc: 01_PRD
owns: WHAT — product vision, users, scope (in / out / deferred)
authority: authoritative-on-scope
version: 1.1.0
created_at: 2026-07-22
updated_at: 2026-07-22
edit_rules: 99 §6.2
sync: [T6]
---

# Product Requirements — knowledge-kit

## Product

**knowledge-kit** is a Bun + TypeScript + Biome **CLI monorepo**. The shippable binary is
`@gobing-ai/knowledge-kit`; shared libraries live under `@gobing-ai/*` (starting with
`@gobing-ai/utils`).

## Users

- Developers extending the CLI with new subcommands and shared libraries.
- AI coding agents operating under Spur / Superskill harness contracts.
- Maintainers who need a small, testable binary with clear package boundaries.

## Problem

CLI work often collapses shell, logic, and I/O into one untestable blob. knowledge-kit keeps a
thin Commander shell, reusable packages, and testable stdout so commands stay easy to verify.

## Goals

- Ship a Bun-native CLI (`apps/cli` → `@gobing-ai/knowledge-kit`) with workspace-shared utilities.
- Keep lint (Biome **2.5.5**), typecheck, test, and build gates green.
- Use Spur as the project quality and lifecycle harness.
- Grow via new `packages/*` workspaces and Commander subcommands without restructuring.

## Non-Goals

- Multi-mode project-template scaffolding.
- Convergence / absorb-from-source-project workflows.
- Replacing Bun, Biome, or Commander without a superseding ADR.
- Secrets, deployment accounts, or host infrastructure management.

## In scope

| Area | Notes |
|------|--------|
| CLI binary | `@gobing-ai/knowledge-kit` — Commander program, `add` subcommand (starter) |
| Shared utils | `@gobing-ai/utils` — pure helpers, zod re-export, stdout logger |
| Quality gates | Biome 2.5.5, tsc, bun:test, Spur rule presets |
| Docs corpus | `docs/00`–`05`, `99`, root `AGENTS.md` |

## Out of scope / deferred

| Area | Status |
|------|--------|
| Config / persistent product state | Deferred until a command needs it |
| Interactive prompts / colored TUI | Deferred |
| Node-publishable `bin` pointing at `dist/` | Optional; documented in ADR-004 |
| Additional apps under `apps/*` | Deferred; layout already supports it |

## Success criteria

- Agents can orient from `AGENTS.md` + `docs/00`–`05` without guessing stack or surface.
- Every CLI command is documented in `04_DESIGN` and covered by tests.
- Workspace imports stay on `@gobing-ai/*` only.
- `bun run lint`, `bun run test`, and `bun run build` pass before work is marked done.
