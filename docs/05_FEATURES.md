---
name: Features
doc: 05_FEATURES
owns: STATUS — feature decomposition + state
authority: derived
version: 2.0.3
created_at: 2026-07-22
updated_at: 2026-07-25
derived_from: [01_PRD, 02_ROADMAP]
edit_rules: 99 §6.6
sync: [T4]
---

# Features

> Derived from the Spur feature tree (`docs/features/INDEX.md`, letter IDs per DD-14). Edit when a
> feature's status changes. Tier-1 = a letter (`A`); children append one digit (`B1`, `B2`).

## Status legend

✅ done · 🔶 partial · ⏳ planned/current · 💤 deferred · 🌫️ fog (undecided)

## Feature tree

| ID | Feature | Status | Phase | Notes |
|----|---------|--------|-------|-------|
| **A** | CLI monorepo foundation | ✅ done¹ | 0 | Bun + TS + Biome monorepo, `@gobing-ai/*`, gates, Spur init |
| **B** | kk plugin platform | ⏳ planned | 1 | skill-first seam (ADR-006 amdt 2026-07-24); tasks `0003`–`0005` |
| B2 | Typed lifecycle contracts | ✅ done | 1 | task `0003` done: Zod Doc/Content/Result + `kindContract` in `@gobing-ai/kk-core` |
| B1 | Plugin manifest + registry/discovery | ✅ done | 1 | task `0004` done: `plugin.json` schema + `discoverPlugins` / `listByKind` in `@gobing-ai/kk-core` |
| B3 | Spur workflow integration | ⏳ planned | 1 | task `0005`: `kk invoke --in --out` + workflow template; no DAG runtime |
| **C** | IngestionPlugin: Karakeep-local | ⏳ current | 1 | read rclone-synced folder as normal FS |
| **D** | ContentGeneratorPlugin (reuse-first) | ⏳ current | 1 | stand-in = `wt:technical-content-creation` (stages 0–3); own STORM → H |
| D1 | ↳ [research] study `vendors/storm` → pick stand-in | ✅ done | 1 | resolved (task `0001`): STORM = 4 modules; stand-in chosen |
| D2 | ↳ Wire existing generator skill to contract | ⏳ ready | 1 | **unblocked** — wire `wt:technical-content-creation` (materials←Karakeep, research, outline, draft) |
| **E** | PublishPlugin: Surfdash (tested rewrite) | ⏳ current | 1 | file/CLI transport, **no auth**; two-transport contract |
| E1 | ↳ [research] wt-publish audit | ✅ done | 1 | resolved (task `0002`): transports mapped; Surfdash simplest |
| E2 | ↳ PublishPlugin contract + test harness | ⏳ ready | 1 | **unblocked** — transport abstraction (FileCli + Browser) + frontmatter mapping |
| E3 | ↳ Surfdash publisher (tested) | ⏳ planned | 1 | blocked by E2; wrap `postsurfing.mjs` + tested frontmatter mapping |
| **F** | Reference vertical: Karakeep → gen → Surfdash | ⏳ planned | 1 | acceptance demo; blocked by C, D2, E3 |
| **G** | PublishPlugin rewrite epic | 💤 deferred | 2 | `G1…G9`: medium, juejin, qiita, substack, infoq, wechatmp, x, xhs, zenn |
| **H** | Real STORM + wt generator harvest | 💤 deferred | 2 | own STORM (ref `vendors/storm`); lazy Py→TS of 25 scripts |
| **I** | LLM wiki | 🌫️ fog | 3 | undecided; go/no-go spike first |

¹ Phase-0 work is complete; the Spur lifecycle tracks `A` at `verifying` (its guards forbid a
retroactive jump to `done` without a verified linked task — completion is authoritative here and in
`00_ADR`).

## Open research gates

Both Phase-1 research gates are **resolved** — the map has cleared enough to start building (B/C + `/sp:dev-plan`).

| Gate | Task | Blocks | Outcome |
|------|------|--------|---------|
| ✅ D1 — study `vendors/storm` | `0001` (done) | D2 | stand-in = `wt:technical-content-creation`; real STORM → H |
| ✅ E1 — wt-publish audit | `0002` (done) | E2/E3 | Surfdash = no-auth file/CLI; two-transport contract; G mapped |

## Map fog (`## Not yet specified`)

Suspected but not yet sharp enough to ticket: the Karakeep export schema in the synced folder; a
`KarakeepLocalRM` dspy retrieval module exposing Karakeep-local as STORM's corpus (feature H);
whether any pipeline config lives outside `spur workflow`; audio / stream generation as a fourth
generator output.
