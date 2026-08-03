---
name: Product Requirements
doc: 01_PRD
owns: WHAT — product vision, users, scope (in / out / deferred)
authority: authoritative-on-scope
version: 3.1.0
created_at: 2026-07-22
updated_at: 2026-08-03
derived_from: [00_ADR]
edit_rules: 99 §6.2
sync: [T6]
---

# Product Requirements — knowledge-kit

> **v3.0.0 repositioning (2026-08-02).** knowledge-kit is a spur-orchestrated **ingest → create → publish platform**. Creation and publishing are first-class co-equal capabilities, not downstream consequences of ingestion. Ingestion is optional (`Doc[] | Brief`). See `00_ADR` → ADR-007 for the governing decision.

## Product

**knowledge-kit** is a spur-orchestrated **ingest → create → publish platform** for technical content and knowledge artifacts. Creation (from a brief or topic) and multi-channel publishing are co-equal core capabilities alongside knowledge ingestion. Plugins are Claude Code–style plugins, **distributed by `superskill install`** and **orchestrated by `spur workflow`** (Spur is the first-class harness). The `apps/cli` binary (`@gobing-ai/knowledge-kit`) hosts the shared runtime, invoker, and `@gobing-ai/*` libraries; the first plugin collection lives in `plugins/kk` and installs via `superskill install kk`.

## The framework — typed plugin contracts

The platform is a **type + discovery layer**: TypeScript data contracts discovered by a registry, with `spur workflow` composing them. Sequential fan-in (N→1) and fan-out (1→N) steps are owned by `kk` and run on the workflow engine.

| Kind | Contract (essence) | Phase-1 / Initial instance |
|------|--------------------|----------------------------|
| `IngestionPlugin` | `ingest(source) → Doc[]` | **Karakeep-local** — read an rclone-synced folder |
| `ContentGeneratorPlugin` | `generate(Doc[] \| Brief) → Content` | **Generator (reuse-first)** — accepts ingested `Doc[]` or standalone `Brief` (topic → article) |
| `PublishPlugin` | `publish(Content) → Result` | **Multi-channel publish** — Surfdash (tested rewrite) + `wt` target harvest |
| `JudgePlugin` | `judge(Content) → Verdict` | **LLM-as-judge** — reusable evaluation rubric gating a pipeline (ADR-007 amdt 2026-08-02) |

A **pipeline** is a `spur workflow` that runs `ingest → generate → publish` (or standalone
`create → publish`) as a **sequence of states**, optionally gated by a judge. The workflow engine
executes one state at a time; where a stage needs many inputs or many outputs, `kk fanin` /
`kk fanout` collapse that into a single sequential step. The registry discovers installed plugins
by kind.

## Users

- **Robin (primary)** — automated creation (topic/brief → article) and multi-channel publishing (Surfdash, Surfing, X, Juejin, Qiita, Medium, Substack, Zenn, InfoQ, XHS) alongside continuous Karakeep collection → generation → publish workflows.
- **Plugin developers** — extend the platform with new Ingestion / Generator / Publish / Judge plugins against stable typed data contracts.
- **AI coding agents** — operate the platform under Spur / Superskill harness contracts.

## Problem

Technical content creation and published output are fragmented: turning ideas or collected knowledge into multi-channel published content requires manual per-platform effort or brittle ad-hoc scripts. knowledge-kit makes the entire path **composable, testable, and re-runnable**: a plugin per stage, typed contracts per kind, optional ingestion, sequential fan-in/fan-out, and `spur workflow` as the orchestrator.

## Goals

- **Achieved (Phase 1):** Prove the **reference vertical end-to-end** (Karakeep-local → generator → Surfdash via `spur workflow`) and establish the **kk plugin platform** (manifest, registry, `kk invoke`, unit-tested Surfdash publisher).
- **Current (Phase 2 — Co-equal Creation & Publishing):** Deliver **creation-from-brief** as a first-class user-facing outcome (topic → published article without prior ingest) and harvest the **multi-channel publish suite** under robust data contracts and tests.
- Maintain Spur as the first-class lifecycle harness and Superskill as the distribution / capability harness.

## Non-Goals (Current Scope)

- Engine-level parallel execution — sequential fan-in/fan-out owned by `kk` satisfies multi-channel publish without premature engine complexity (ADR-007 R4).
- Package or binary rename — the name `knowledge-kit` is historical and retained (ADR-007 R2).
- The **LLM wiki** — explicitly undecided map fog (feature **I**), requiring a go/no-go spike first.

## In scope

| Area | Feature | Phase | Notes |
|------|---------|-------|-------|
| Project foundation | **A** | Phase 0 | Monorepo substrate; **A1** feature-tree restructure |
| Plugin platform | **B** | Phase 1/2 | B1 registry, B2 contracts, B3 workflow, B4 CLI, **B5** E2E pipeline acceptance (done) · Phase 2: **B6** sequential `kk fanin`/`fanout`, **B7** `judge` plugin kind |
| Ingestion | **C** | Phase 1 | C1 design · **C2** Karakeep-local: rclone-synced folder → Docs |
| Content generation | **D** | Phase 1/2 | D1 research · D2 wire stand-in · D3 design · **Brief input contract** (`Doc[] \| Brief`) |
| Multi-channel publish | **E** | Phase 1/2 | E1 audit · E2 design/harness · E3 Surfdash · **Multi-channel suite harvest** (Surfing, X, Juejin, Qiita, Medium, Substack, Zenn, InfoQ, XHS) |
| Platform Repositioning | **J** | Phase 2 | **J** Reposition knowledge-kit to ingest-create-publish (ADR-007, PRD v3, contract designs) |

A user can answer "can I run this to write an article about X with nothing ingested?" directly from this PRD: **Yes**, by passing a `Brief` to a `ContentGeneratorPlugin` and piping `Content` to a `PublishPlugin`.

## Out of scope / deferred

| Area | Feature | Status | Reason |
|------|---------|--------|--------|
| Engine-level parallel execution | — | Deferred | `kk` sequential fan-out meets requirement without engine complexity (ADR-007 R4) |
| Package / binary rename | — | Deferred / Rejected | Name is historical; renaming has migration cost with zero capability gain (ADR-007 R2) |
| LLM wiki | **I** | Undecided | Parked as map fog; requires go/no-go spike first |
| Own STORM generator | **D4** | Phase 3 | Future generator depth |
| wt generator harvest | **D5** | Phase 3 | Future generator harvest depth |

## Success criteria

- Creation-from-brief (topic → published article without prior ingest) executes end-to-end via a `spur workflow`.
- Multi-channel fan-out publish runs sequentially via `kk`, returning aggregate `Result` status with fail-loud exit on partial failure.
- The `Generator` contract accepts either input shape — ingested `Doc[]`, a standalone `Brief`, or
  both — while `Ingestion` (`source → Doc[]`), `Publish` (`Content → Result`) and `Judge`
  (`Content → Verdict`) keep their own single-shape contracts.
- Existing gates stay green: `bun run lint`, `bun run test`, `bun run build`.
