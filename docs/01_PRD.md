---
name: Product Requirements
doc: 01_PRD
owns: WHAT — product vision, users, scope (in / out / deferred)
authority: authoritative-on-scope
version: 3.19.0
created_at: 2026-07-22
updated_at: 2026-11-10
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
| ------ | -------------------- | ---------------------------- |
| `IngestionPlugin` | `ingest(source) → Doc[]` | **Karakeep-local** — read an rclone-synced folder |
| `ContentGeneratorPlugin` | `generate(Doc[] \| Brief) → Content` | **Generator (reuse-first)** — accepts ingested `Doc[]` or standalone `Brief` (topic → article) |
| `PublishPlugin` | `publish(Content) → Result` | **Multi-channel publish** — Surfdash (tested rewrite) + `wt` target harvest |

A **pipeline** is a `spur workflow` that runs `ingest → generate → publish` (or standalone
`create → publish`) as a **sequence of states**. An optional LLM-as-judge gate (an `agent.run`
step backed by the `content-judge` skill) may evaluate generated `Content` before publish; the gate
reads a verdict file, not a plugin-kind contract. The workflow engine executes one state at a
time; where a stage needs many inputs or many outputs, `kk executor fan-in` /
`kk executor fan-out` collapse that into a single sequential step. The registry discovers
installed plugins by kind.

## Users

- **Robin (primary)** — automated creation (topic/brief → article) and multi-channel publishing (Surfdash, Surfing, X, Juejin, Qiita, Medium, Substack, Zenn, InfoQ, XHS) alongside continuous Karakeep collection → generation → publish workflows.
- **Plugin developers** — extend the platform with new Ingestion / Generator / Publish plugins against stable typed data contracts.
- **AI coding agents** — operate the platform under Spur / Superskill harness contracts.

## Problem

Technical content creation and published output are fragmented: turning ideas or collected knowledge into multi-channel published content requires manual per-platform effort or brittle ad-hoc scripts. knowledge-kit makes the entire path **composable, testable, and re-runnable**: a plugin per stage, typed contracts per kind, optional ingestion, sequential fan-in/fan-out, and `spur workflow` as the orchestrator.

## Goals

- **Achieved (Phase 1):** Prove the **reference vertical end-to-end** (Karakeep-local → generator → Surfdash via `spur workflow`) and establish the **kk plugin platform** (manifest, registry, `kk executor run`, unit-tested Surfdash publisher).
- **Current (Phase 2 — Co-equal Creation & Publishing):** Deliver **creation-from-brief** as a first-class user-facing outcome (topic → published article without prior ingest) and harvest the **multi-channel publish suite** under robust data contracts and tests.
- Maintain Spur as the first-class lifecycle harness and Superskill as the distribution / capability harness.

## Non-Goals (Current Scope)

- Engine-level parallel execution — sequential fan-in/fan-out owned by `kk` satisfies multi-channel publish without premature engine complexity (ADR-007 R4).
- Package rename — the name `knowledge-kit` / `@gobing-ai/knowledge-kit` is historical and retained (ADR-007 R2). The operator binary is `kk` (ADR-010 / feature A2); that is not a package rename.

## In scope

| Area | Feature | Phase | Notes |
| ------ | --------- | ------- | ------- |
| SEO/GEO audit and action plan | **G9** | Phase 3 | Committed scope: read-only public-site audit, typed Spur judgments, one skill and JSON/Markdown evidence; optional performance/imported visibility. Paid collection, browser rendering, rich exports and site mutation deferred to separate intake; [design](design/kk-smart-seo.md). |
| Project foundation | **A** | Phase 0/2 | Monorepo substrate; **A1** feature-tree restructure; **A2** `kk` product CLI surface (help/version/verbose, command tree, npm `bin.kk`) |
| Plugin platform | **B** | Phase 1/2 | B1 registry, B2 contracts, B3 workflow, B4 CLI, **B5** E2E pipeline acceptance · Phase 2: **B6** sequential `kk executor fan-in`/`fan-out` · **A21** two-noun CLI (`executor` + `plugin`) · **B7** multi-root plugin auto-discovery (built-ins + user roots; ADR-012) |
| Ingestion | **C** | Phase 1 | C1 design · **C2** Karakeep-local: rclone-synced folder → Docs |
| Content generation | **D** | Phase 1/2/3 | D1 research · D2 wire stand-in · D3 design · **Brief input contract** (`Doc[] \| Brief`) · **D4** owned STORM (`content-gen`) · **D5** Voicebox TTS generator (`voice-gen`, `format: "audio"`) |
| Multi-channel publish | **E** | Phase 1/2 | E1 audit · E2 design/harness · E3 Surfdash · **Multi-channel suite harvest** (Surfing, X, Juejin, Qiita, Medium, Substack, Zenn, InfoQ, XHS) |
| Xiaohongshu image-card posts | **E8** | Phase 3 | Source content → ordered image cards and Chinese note → actual XHS draft or explicitly requested live post |
| Reusable browser sessions for publishing | **E9** | Phase 3 | Shared ts-libs browser profile package with XHS as first consumer; headed login, persistent profile reuse, and a read-only headless session check |
| Agent capabilities and product workflows | **F** | Phase 2/3 | F1 LLM-as-judge · **F2 topic-core authoring** (`topic`: topic/brief → approved outline + draft) · **F3 ITC generating** (`itc-generating`: distilled IT-writing method + orchestration; skill only) · **F4 IT-content workflow** (`kk-itc`) · **F5 Solo-podcast workflow** (`kk-solo-podcast`) · **F6 Daily AI news voice workflow** (`aihot-ingest` → `dailynews-gen` → `voice-gen`) · **F9 Explain-things** (`explain-things` smallest-view skill + thin `/tell-me`) |
| Platform Repositioning | **J** | Phase 2 | **J** Reposition knowledge-kit to ingest-create-publish (ADR-007, PRD v3, contract designs) |

| Workflow visibility in Spur Board | **G8** | Phase 3 | Collect, Daily AI Voice and IT Content: run-bound summaries, outputs, progress and recorded run settings; reuse Settings → Workflows for definitions; local read-only operation; tasks `0252`–`0255`; [design](design/workflow-board-modules.md) |
| LLM wiki vault | **I** / **I1** | Phase 3 | Committed via the operator specs dated 2026-11-10 (`kk wiki` verb family). `kk` owns the deterministic vault mechanics (raw snapshots, wikilink graph, link/lint, merge with redirect, index/MAP compile, gc, `user_edited` guard, Quartz publish projection); model-bearing summarize/synthesize/query authoring stays in a `kk` skill; ADR-048; [design](design/kk-wiki.md). The separate `treasury` vault repository (Quartz 4, R2/rclone `raw/`, cron loop, Cloudflare Pages) is deferred to its own run. |
| Daily AI news visuals | **L4** | Phase 3 | Dedicated cover and illustration skills for scheduled and standalone news work, rendered through `image-gen`. Covers and cards retain existing defaults. Inline figures require opt-in and a verified delivery path. [Design](design/daily-news-visual-skills.md). |

Topic → article without prior ingestion is in scope through the planned `Brief` generator input.
This is a product requirement, not a shipped CLI claim: `docs/04_DESIGN.md` §1.7/§4 identifies
the unimplemented `Brief` / `GeneratorInput` contract.

## Out of scope / deferred

| Area | Feature | Status | Reason |
| ------ | --------- | -------- | -------- |
| Engine-level parallel execution | — | Deferred | `kk` sequential fan-out meets requirement without engine complexity (ADR-007 R4) |
| Package rename | — | Rejected | Package `@gobing-ai/knowledge-kit` is historical (ADR-007 R2). Operator binary `kk` is in scope (A2 / ADR-010). |
| LLM wiki static-site deployment (treasury repo) | **I1** | Deferred (needs its own run) | Committed at the `kk wiki` surface; the Quartz/R2/Pages repository turns committed once its own run plans it |
| Own STORM generator | **D4** | Phase 3 | Future generator depth |
| Remaining WT agent-skill families | **F41** | Shipped | Image, auxiliary research, adaptation and publishing delivered by F41 kk-itc end-to-end (ADR-021/ADR-022, `docs/design/kk-itc-end-to-end.md`) |

## Success criteria

- Creation-from-brief (topic → published article without prior ingest) executes end-to-end via a `spur workflow`.
- The installable `topic` skill turns a topic or supplied brief into an approved outline and draft without pulling image, adaptation, or publishing work into the first delivery.
- The installable `itc-generating` skill applies the distilled IT-writing method and orchestrates `topic` / `storm-research` / optional `content-judge` without a slash command or `kk` CLI verb.
- Multi-channel fan-out publish runs sequentially via `kk`, returning aggregate `Result` status with fail-loud exit on partial failure.
- The `Generator` contract accepts either input shape — ingested `Doc[]`, a standalone `Brief`, or
  both — while `Ingestion` (`source → Doc[]`) and `Publish` (`Content → Result`) keep their own
  single-shape contracts. LLM-as-judge runs as an `agent.run` skill, not a plugin contract.
- Existing gates stay green: `bun run lint`, `bun run test`, `bun run build`.


## Planned: consistent CLI operations and named browser sessions (A22)

ADR-037/038 define exactly `kk <noun> <verb>` for canonical operations, with compatible hidden routes for shipped spellings. A22 adds bot list/login/logout/open for named local browser sessions on the existing harness, preserving plugin readiness and channel-specific state. These commands are designed, not shipped; see `docs/design/kk-noun-verb-bots.md`.


## ITC workflow extensibility (G21)

In scope: a top-level ITC DAG with bounded child authoring FSM, canonical config/workspace defaults, optional collected-topic ideation, structured semantic recommendations, explicit topic channel presets, plugin-owned publication capabilities, evidence-bound recovery, and versioned SEO handoffs. Unfinished SEO draft optimization and automatic public-URL audits remain outside this feature. Direct topic/file authoring and draft-first operation remain supported. New channels, automatic authentication, implicit live publication and paid generation are outside this feature. Design: [kk-itc-refactor.md](design/kk-itc-refactor.md).
