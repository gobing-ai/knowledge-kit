---
name: Features
doc: 05_FEATURES
owns: STATUS — feature decomposition + state
authority: derived
version: 2.1.1
created_at: 2026-07-22
updated_at: 2026-07-29
derived_from: [01_PRD, 02_ROADMAP]
edit_rules: 99 §6.6
sync: [T4]
---

# Features

> Derived from the Spur feature tree (`docs/features/INDEX.md`, letter IDs per DD-14). Edit when a
> feature's status changes. Tier-1 = a letter (`A`); children append one digit (`B1`, `B2`).
>
> **2026-07-29 (A1):** Tree reorganized to kind-aligned parents (Ingestion / Content generation /
> Publish). Roots F/G/H cancelled (E2E → **B5**; multi-channel → E Notes; STORM/harvest → D4/D5).
> Map: `docs/plans/feature-tree-restructure-map.md`.

## Status legend

✅ done · 🔶 partial · ⏳ planned/current · 💤 deferred · 🌫️ fog (undecided) · ❌ cancelled

## Feature tree

| ID | Feature | Status | Phase | Notes |
|----|---------|--------|-------|-------|
| **A** | Project foundation | ✅ done¹ | 0 | Monorepo substrate + tooling; A1 = tree hygiene |
| A1 | Feature tree restructure | ✅ done | 0 | tree+docs applied; tasks `0006`–`0009` **done**; map `docs/plans/feature-tree-restructure-map.md` |
| **B** | Plugin platform | ⏳ planned | 1 | skill-first seam (ADR-006 amdt 2026-07-24); B1–B3 done |
| B1 | Plugin manifest + registry/discovery | ✅ done | 1 | task `0004`: `plugin.json` + `discoverPlugins` / `listByKind` |
| B2 | Typed lifecycle contracts | ✅ done | 1 | task `0003`: Doc/Content/Result + `kindContract` in `@gobing-ai/kk-core` |
| B3 | Spur workflow integration | ✅ done | 1 | task `0005`: `knowledge-kit invoke` + pipeline workflow template; E2E proof → **B5** |
| B4 | CLI surface | ⏳ planned | 1 | expand Commander surface for plugin ops (beyond minimal invoke) |
| B5 | End-to-end pipeline acceptance | ⏳ planned | 1 | C2→D2→E3 composition proof (folded from cancelled **F**) |
| **C** | Ingestion | ⏳ current | 1 | kind parent: design + source instances |
| C1 | Ingestion plugin design | ⏳ planned | 1 | design slice for IngestionPlugin instances |
| C2 | Karakeep-local | ⏳ current | 1 | rclone-synced folder → Docs (Phase-1 instance) |
| **D** | Content generation | ⏳ current | 1 | kind parent: research → wire → design; STORM/harvest later |
| D1 | Study vendors/storm → pick stand-in | ✅ done | 1 | task `0001`: stand-in = `wt:technical-content-creation` |
| D2 | Wire existing generator skill to contract | ⏳ ready | 1 | **unblocked** — wire stand-in stages 0–3 |
| D3 | Generator plugin design | ⏳ planned | 1 | ContentGeneratorPlugin design / adapter patterns |
| D4 | Own STORM generator | 💤 deferred | 2 | from cancelled H; ref `vendors/storm` |
| D5 | wt generator harvest | 💤 deferred | 2 | from cancelled H; lazy Py→TS of wt generator skills |
| **E** | Publish | ⏳ current | 1 | kind parent: audit → design/harness → Surfdash; multi-channel deferred |
| E1 | wt-publish audit | ✅ done | 1 | task `0002`: transports mapped; Surfdash simplest |
| E2 | Publish design and test harness | ⏳ ready | 1 | **unblocked** — FileCli + Browser transports + frontmatter mapping |
| E3 | Surfdash publisher (tested) | ⏳ planned | 1 | blocked by E2; wrap `postsurfing.mjs` + tested mapping |
| **F** | End-to-end vertical | ❌ cancelled | — | folded into **B5** (platform owns composition proof) |
| **G** | PublishPlugin rewrite epic | ❌ cancelled | — | absorbed into **E** Notes (deferred multi-channel) |
| **H** | Real STORM + wt generator harvest | ❌ cancelled | — | split into **D4** + **D5** |
| **I** | LLM wiki | 🌫️ fog | 3 | undecided; go/no-go spike first |

¹ Phase-0 substrate is complete; Spur tracks `A` at `verifying` (guards forbid a retroactive jump to
`done` without a verified linked task — completion is authoritative here and in `00_ADR`).

## Open research gates

Both Phase-1 research gates are **resolved**.

| Gate | Task | Blocks | Outcome |
|------|------|--------|---------|
| ✅ D1 — study `vendors/storm` | `0001` (done) | D2 | stand-in = `wt:technical-content-creation`; real STORM → **D4** |
| ✅ E1 — wt-publish audit | `0002` (done) | E2/E3 | Surfdash = no-auth file/CLI; two-transport contract; multi-channel → **E** Notes |

## Map fog

Suspected but not yet sharp: Karakeep export schema in the synced folder; a `KarakeepLocalRM`
retrieval module for STORM corpus (**D4**); whether pipeline config lives outside `spur workflow`;
audio / stream generation as a generator output; exact B4 CLI command set.
