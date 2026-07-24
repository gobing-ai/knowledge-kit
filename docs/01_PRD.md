---
name: Product Requirements
doc: 01_PRD
owns: WHAT — product vision, users, scope (in / out / deferred)
authority: authoritative-on-scope
version: 2.0.0
created_at: 2026-07-22
updated_at: 2026-07-23
edit_rules: 99 §6.2
sync: [T6]
---

# Product Requirements — knowledge-kit

> **v2.0.0 pivot (2026-07-23).** knowledge-kit is a **plugin-based knowledge platform**, not a
> minimal CLI. See `00_ADR` → ADR-006 for the decision and its rationale.

## Product

**knowledge-kit** is a **collection of agentic knowledge-management plugins** — an
**ingest → generate → publish** pipeline over knowledge in multiple formats (tech articles first;
audio, wikis later). Plugins are Claude Code–style plugins, **distributed by `superskill install`**
and **orchestrated by `spur workflow`** (Spur is the first-class harness). The `apps/cli` binary
(`@gobing-ai/knowledge-kit`) hosts the shared runtime and `@gobing-ai/*` libraries; the first
plugin collection lives in `plugins/kk` and installs via `superskill install kk`.

## The framework — three typed plugin kinds

The platform is a **type + discovery layer**: TypeScript contracts discovered by a registry, with
`spur workflow` composing them. No bespoke `kk run` runtime (deferred, YAGNI).

| Kind | Contract (essence) | Phase-1 instance |
|------|--------------------|------------------|
| `IngestionPlugin` | `ingest(source) → Doc[]` | **Karakeep-local** — read an rclone-synced folder |
| `ContentGeneratorPlugin` | `generate(Doc[]) → Content` | **Generator (reuse-first)** — wire an existing skill; STORM later |
| `PublishPlugin` | `publish(Content) → Result` | **Surfdash** — tested rewrite |

A **pipeline** is a `spur workflow` that runs `ingest → generate → publish` as a DAG. The registry
discovers installed plugins by kind.

## Users

- **Robin (primary)** — continuous Karakeep collection → generation → Surfdash publishing, as a
  re-runnable workflow rather than manual per-platform effort.
- **Plugin developers** — extend the platform with new Ingestion / Generator / Publish plugins
  against stable typed contracts.
- **AI coding agents** — operate the platform under Spur / Superskill harness contracts.

## Problem

Collected knowledge is scattered across sources, and turning it into published content is manual
and per-platform. knowledge-kit makes the path **composable, testable, and re-runnable**: a plugin
per stage, a typed contract per kind, and `spur workflow` as the orchestrator.

## Goals

- Ship the **kk plugin platform**: a manifest / registry + the three typed lifecycle contracts.
- Prove one **reference vertical end-to-end**: Karakeep-local → generator → Surfdash via a single
  `spur workflow` run.
- Rewrite the **Surfdash publisher with real unit tests**, behind a reusable publish test harness
  (closing the `wt` publish test-coverage gap).
- Keep Spur as the lifecycle harness and Superskill as the distribution / capability harness.

## Non-Goals (Phase 1)

- A bespoke `kk run` runtime / dynamic DAG engine — `spur workflow` orchestrates instead.
- The 9 non-Surfdash publish targets — a Phase-2 tested-rewrite epic (feature G).
- An own STORM implementation and bulk `wt` generator migration / Python→TS — Phase 2 (feature H).
- Direct Karakeep R2 API access — the rclone-synced local folder is the Phase-1 contract.
- The **LLM wiki** — explicitly undecided (feature I, map fog).

## In scope (Phase 1)

| Area | Feature | Notes |
|------|---------|-------|
| Plugin platform | **B** | manifest + registry (B1), typed contracts (B2), spur-workflow steps (B3) |
| Ingestion | **C** | Karakeep-local: read rclone-synced folder → Docs |
| Generation | **D** | study STORM (D1, research) → wire existing skill (D2) |
| Publish | **E** | wt-publish audit (E1, research) → contract + harness (E2) → tested Surfdash (E3) |
| Reference vertical | **F** | Karakeep-local → generator → Surfdash via `spur workflow` |

## Out of scope / deferred

| Area | Feature | Status |
|------|---------|--------|
| Publish suite (9 targets) | G | Phase 2 — tested rewrite each |
| Own STORM + wt generator harvest (lazy Py→TS) | H | Phase 2 |
| LLM wiki | I | Undecided — go/no-go spike first |
| Audio / other output formats | — | Deferred |

## Success criteria (Phase 1)

- One `spur workflow` run takes a Karakeep-local item through the generator to a **published
  Surfdash post**.
- Every plugin contract (Ingestion / Generator / Publish) has tests; the **Surfdash publisher has
  real unit coverage**.
- `superskill install kk` yields a working plugin set; `spur workflow` runs the vertical.
- No plugin feature advances past `todo` until its **research gate** is `done` (D1 gates D2; E1
  gates E3).
- Existing gates stay green: `bun run lint`, `bun run test`, `bun run build`.
