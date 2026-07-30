---
name: Roadmap
doc: 02_ROADMAP
owns: WHEN — phases, current vs deferred, sequencing
authority: derived
version: 2.1.1
created_at: 2026-07-22
updated_at: 2026-07-29
derived_from: [00_ADR, 01_PRD]
edit_rules: 99 §6.3
sync: [T5]
---

# Roadmap

> Derived from `01_PRD` (scope) and `00_ADR` (ADR-006, the platform pivot). Edit when phase status
> changes. Feature IDs are the `05_FEATURES` / Spur letter tree (reorganized 2026-07-29 under **A1**).

## Phases

| Phase | Status | Features | Items |
|-------|--------|----------|-------|
| Phase 0 — Foundation | ✅ done | **A** (+ **A1** hygiene) | Bun workspaces monorepo; `@gobing-ai/*`; Commander shell; Biome + tsc/test gates; Spur init; feature-tree restructure (A1) |
| **Phase 1 — Plugin platform + vertical** | ⏳ **current** | **B–E** | Plugin platform B (B1–B3 done, B4 CLI, **B5** E2E acceptance) · Ingestion C (C1/C2) · Content generation D (D1–D3) · Publish E (E1–E3) |
| Phase 2 — Depth | 💤 deferred | **D4, D5, E multi-channel** | Own STORM (**D4**) · wt generator harvest (**D5**) · remaining publish channels under **E** (former G notes) |
| Phase 3 — LLM wiki (conditional) | 🌫️ fog | **I** | Undecided; go/no-go research spike first |

Cancelled roots (historical only): **F** (E2E → **B5**), **G** (publish suite → E Notes), **H** (STORM/harvest → D4/D5).

## Phase 1 sequencing

Research gates first — no implementation past `todo` until the gate resolves:

```
B (platform: B1→B2→B3 done; B4 CLI; B5 E2E acceptance)
        │
        ├── C1 design · C2 Karakeep-local ingest
        ├── D1 [research done] → D2 wire · D3 design
        └── E1 [research done] → E2 harness → E3 Surfdash
                                   │
                                   └── B5  (end-to-end: C2 + D2 + E3 via B3 template)
```

**Status legend:** ✅ done · 🔶 partial · ⏳ planned/current · 💤 deferred · 🌫️ fog (undecided)
