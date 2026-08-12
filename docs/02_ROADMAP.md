---
name: Roadmap
doc: 02_ROADMAP
owns: WHEN — phases, current vs deferred, sequencing
authority: derived
version: 3.3.0
created_at: 2026-07-22
updated_at: 2026-08-12
derived_from: [00_ADR, 01_PRD]
edit_rules: 99 §6.3
sync: [T5]
---

# Roadmap

> Derived from `01_PRD` v3 (scope) and `00_ADR` (ADR-006 platform pivot; **ADR-007** the
> ingest → create → publish repositioning). Edit when phase status changes. Feature IDs are the
> `05_FEATURES` / Spur letter tree (reorganized 2026-07-29 under **A1**; re-cut 2026-08-02 under **J**).

## Phases

| Phase | Status | Features | Items |
|-------|--------|----------|-------|
| Phase 0 — Foundation | ✅ done | **A** (+ **A1** hygiene) | Bun workspaces monorepo; `@gobing-ai/*`; Commander shell; Biome + tsc/test gates; Spur init; feature-tree restructure (A1) |
| Phase 1 — Plugin platform + reference vertical | 🔶 partial | **B–E** | Platform **B1–B5 done** — manifest/registry, typed contracts, workflow integration, CLI surface, and the **E2E vertical proven** (Karakeep-local → generator → Surfdash in one `spur workflow` run). Ingestion **C1/C2 done** · generator design **D3 done** · publish **E2/E3 done**. Residue: C/D/E reopened (`active`) as living kind parents for plugin intake; E1 close-out (`0002` done; feature backlog — AC placeholder never enriched) |
| **Phase 2 — Repositioning + widened contracts** | ⏳ **current** | **J**, **B6**, **A2**, **F** (kk plugin collection), **F1**, **D** (Brief), **E4** | **J** repositioning (ADR-007, PRD v3, contract designs — this phase's gate) → implementation graduates into **B6** sequential `kk fanin`/`fanout`, **A2** `kk` product CLI surface, **F1** LLM-as-judge agent skills (under **F**), **D** Brief input contract (`Doc[] \| Brief`), **E4** multi-channel suite harvest |
| **Phase 3 — Generator + authoring depth** | ⏳ **current** | **D4**, **F2** | Own STORM generator (**D4**) · topic-core authoring skill (**F2**, one fat `kk-topic` skill) |
| LLM wiki (conditional) | 🌫️ fog | **I** | Undecided; go/no-go research spike first |

Cancelled roots (historical only): **G** (publish suite → **E4**), **H** (STORM/harvest → D4; former D5 rehomed as **F2**).

## Phase 2 sequencing

The map **J** is the gate: authority lands first, then implementation graduates into the homes the
tree restructure created. No implementation past `todo` until **J** closes.

```
J (map: ADR-007 → PRD v3 → contract designs → tree realign → doc sync)
        │  closes ⇒ graduates
        ├── B6  kk fanin / kk fanout        (spec: docs/design/fan-in-and-fan-out-specification.md)
        ├── A2  kk product CLI surface     (help/version/verbose, command tree, npm bin.kk; spec: docs/design/kk-cli-surface.md)
        ├── F   kk plugin collection       (parent for plugins/kk capabilities; B7 migrated in as F1)
        ├── F1  LLM-as-judge agent skills  (under F; fat skill kk-judge + wrappers; agent.run gate; ADR-007 amdt 2026-08-07)
        ├── D   Brief input contract        (Doc[] | Brief; generator plugins accept both)
        └── E4  multi-channel suite harvest (Surfing/X/Juejin/Qiita/Medium/Substack/Zenn/InfoQ/XHS
                                             under the E2 transport contract)
```

Ordering within Phase 2: **D** (Brief) and **B6** (fan-in/fan-out) are independent and unblock the
creation-from-brief and multi-channel success criteria respectively; **E4** depends on **B6** for
aggregate-Result fan-out; **F1** is independent and gate-only.

## Phase 1 sequencing (historical)

```
B (platform: B1→B2→B3→B4 done; B5 E2E acceptance done)
        │
        ├── C1 design · C2 Karakeep-local ingest
        ├── D1 research → D2 wire · D3 design
        └── E1 audit → E2 harness → E3 Surfdash
                                   │
                                   └── B5  (end-to-end: C2 + D2 + E3 via B3 template)
```

**Status legend:** ✅ done · 🔶 partial · ⏳ planned/current · 💤 deferred · 🌫️ fog (undecided)
