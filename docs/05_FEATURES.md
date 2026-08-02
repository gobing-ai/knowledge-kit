---
name: Features
doc: 05_FEATURES
owns: STATUS — feature decomposition + state
authority: derived
version: 2.1.3
created_at: 2026-07-22
updated_at: 2026-07-30
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

✅ done · 🔶 partial · ⏳ planned/current · ⏳ ready (decomposed, unblocked) · ⏳ blocked (decomposed, dep-gated) · 💤 deferred · 🌫️ fog (undecided) · ❌ cancelled

## Feature tree

| ID | Feature | Status | Phase | Notes |
|----|---------|--------|-------|-------|
| **A** | Project foundation | ✅ done | 0 | Monorepo substrate + tooling; close-out task `0013` verified (gates PASS) |
| A1 | Feature tree restructure | ✅ done | 0 | tree+docs applied; tasks `0006`–`0009` **done**; map `docs/plans/feature-tree-restructure-map.md` |
| **B** | Plugin platform | ⏳ current | 1 | skill-first seam (ADR-006 amdt 2026-07-24); B1–B4 done; B5 blocked; Spur: active |
| B1 | Plugin manifest + registry/discovery | ✅ done | 1 | task `0004`: `plugin.json` + `discoverPlugins` / `listByKind` |
| B2 | Typed lifecycle contracts | ✅ done | 1 | task `0003`: Doc/Content/Result + `kindContract` in `@gobing-ai/kk-core` |
| B3 | Spur workflow integration | ✅ done | 1 | task `0005`: `knowledge-kit invoke` + pipeline workflow template; E2E proof → **B5** |
| B4 | CLI surface | ✅ done | 1 | tasks `0020`/`0021` done: `plugins list` + `plugins doctor` (noun group, `--json`); verifyall re-audit PASS + shippable; commit `fed9412` |
| B5 | End-to-end pipeline acceptance | ⏳ blocked | 1 | tasks `0026`/`0027`; deps on C2 (`0015`), D2 (`0023`), E3 (`0025`) |
| **C** | Ingestion | ⏳ current | 1 | kind parent; AC rolled up from C1+C2 (DD-09) |
| C1 | Ingestion plugin design | ✅ done | 1 | tasks `0010`–`0012` done; spec `docs/design/ingestion-plugin-specification.md`; verifyall re-audit PASS + shippable |
| C2 | Karakeep-local | ⏳ ready | 1 | tasks `0014`/`0015` done; verifyall + feature close-out pending |
| **D** | Content generation | ⏳ current | 1 | kind parent; AC rolled up from D3+D2 (DD-09) |
| D1 | Study vendors/storm → pick stand-in | ✅ done | 1 | task `0001`: stand-in = `wt:technical-content-creation` |
| D2 | Wire existing generator skill to contract | ⏳ ready | 1 | tasks `0022`/`0023`; D3 spec done (`0017`) — gate satisfied |
| D3 | Generator plugin design | ✅ done | 1 | tasks `0016`/`0017` done; cites C1 generic contract §1 |
| D4 | Own STORM generator | 💤 deferred | 2 | from cancelled H; ref `vendors/storm` |
| D5 | wt generator harvest | 💤 deferred | 2 | from cancelled H; lazy Py→TS of wt generator skills |
| **E** | Publish | ⏳ current | 1 | kind parent; AC rolled up from E2+E3 (DD-09); multi-channel deferred |
| E1 | wt-publish audit | ⏳ ready | 1 | task `0002` done (transports mapped; Surfdash simplest); feature close-out (verifyall) pending |
| E2 | Publish design and test harness | ✅ done | 1 | tasks `0018`/`0019` done; transport abstraction + `packages/publish-harness`; verifyall re-audit PASS + shippable; commit `2195d14` |
| E3 | Surfdash publisher (tested) | ✅ done | 1 | tasks `0024`/`0025` done; `plugins/surfdash-pub` + hardened failure modes; verifyall re-audit PASS + shippable; commit `d8b19d0` |
| **F** | End-to-end vertical | ❌ cancelled | — | folded into **B5** (platform owns composition proof) |
| **G** | PublishPlugin rewrite epic | ❌ cancelled | — | absorbed into **E** Notes (deferred multi-channel) |
| **H** | Real STORM + wt generator harvest | ❌ cancelled | — | split into **D4** + **D5** |
| **I** | LLM wiki | 🌫️ fog | 3 | undecided; go/no-go spike first |


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
