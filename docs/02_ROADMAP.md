---
name: Roadmap
doc: 02_ROADMAP
owns: WHEN — phases, current vs deferred, sequencing
authority: derived
version: 2.0.0
created_at: 2026-07-22
updated_at: 2026-07-23
derived_from: [00_ADR, 01_PRD]
edit_rules: 99 §6.3
sync: [T5]
---

# Roadmap

> Derived from `01_PRD` (scope) and `00_ADR` (ADR-006, the platform pivot). Edit when phase status
> changes. Feature IDs are the `05_FEATURES` / Spur letter tree.

## Phases

| Phase | Status | Features | Items |
|-------|--------|----------|-------|
| Phase 0 — Foundation | ✅ done | **A** | Bun workspaces monorepo; `@gobing-ai/knowledge-kit` + `@gobing-ai/utils`; Commander shell; Biome 2.5.5 + tsc/test gates; Spur init |
| **Phase 1 — Plugin platform + STORM vertical** | ⏳ **current** | **B–F** | kk platform (registry/loader + 3 typed contracts, `B`) · Karakeep-local ingest (`C`) · generator reuse-first (`D`) · Surfdash publish, tested rewrite (`E`) · reference vertical Karakeep→gen→Surfdash (`F`) |
| Phase 2 — Publish suite + generator harvest | 💤 deferred | **G, H** | 9 tested publish rewrites (`G1…G9`) · own STORM + wt generator harvest with lazy Py→TS (`H`) |
| Phase 3 — LLM wiki (conditional) | 🌫️ fog | **I** | Undecided; go/no-go research spike first; if pursued, maximize reuse of superskill / spur / Karakeep / Surfdash |

## Phase 1 sequencing

Research gates first — no implementation past `todo` until the gate resolves:

```
B (platform: B1→B2→B3)
        │
        ├── C  (Karakeep-local ingest)
        ├── D1 [research] → D2  (generator)
        └── E1 [research] → E2 → E3  (Surfdash publish)
                                   │
                                   └── F  (reference vertical: C + D2 + E3)
```

**Status legend:** ✅ done · 🔶 partial · ⏳ planned/current · 💤 deferred · 🌫️ fog (undecided)
