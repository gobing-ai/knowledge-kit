---
name: Roadmap
doc: 02_ROADMAP
owns: WHEN — phases, current vs deferred, sequencing
authority: derived
version: 3.19.0
created_at: 2026-07-22
updated_at: 2026-10-13
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
| Phase 1 — Plugin platform + reference vertical | 🔶 partial | **B–E** | Platform **B1–B5 done** — manifest/registry, typed contracts, workflow integration, CLI surface, and the **E2E vertical proven** (Karakeep-local → generator → Surfdash in one `spur workflow` run). Ingestion **C1/C2 done** · generator design **D3 done** · publish **E2/E3 done**. Residue: C/D/E reopened (`active`) as living kind parents for plugin intake; E1 close-out **done** (`0002` done; wrapall 2026-08-19) |
| **Phase 2 — Repositioning + widened contracts** | ⏳ **current** | **J**, **B6**, **A2**, **A21**, **B7**, **F** (kk plugin collection), **F1**, **D** (Brief), **E4** | **J** repositioning (ADR-007, PRD v3, contract designs — this phase's gate) → **B6** sequential `kk executor fan-in`/`fan-out` **done**, **A2** `kk` product CLI surface **done**, **A21** two-noun tree **done** (`executor` + `plugin`; ADR-011), **B7** multi-root plugin auto-discovery **done** (ADR-012 shipped), **F1** LLM-as-judge agent skills (under **F**), **D** Brief input contract (`Doc[] \| Brief`), **E4** multi-channel suite harvest |
| **Phase 3 — Generator + authoring depth** | ⏳ **current** | **D4**, **D5**, **F2**, **C4**, **F3**, **F4**, **F5**, **F6**, **E8**, **E9** | Own STORM generator (**D4**, done) · Voicebox TTS generator (**D5**, done — task `0070`) · topic-core authoring skill (**F2**, done) · daily-usable STORM research (**C4**, done — successor to **C3**) · ITC generating skill (**F3**, done — task `0068`) · IT-content workflow + product YAML home (**F4**, done — task `0069`) · Solo-podcast workflow (**F5**, done — task `0071`) · Daily AI news voice workflow and plugins (**F6**, done — tasks `0072`–`0074`) · XHS image-card authoring and publishing (**E8**, done — tasks `0167`, `0168`, `0174`) · reusable browser sessions (**E9**, planned — upstream ts-libs `0088` → XHS dogfood `0177`) |
| LLM wiki (conditional) | 🌫️ fog | **I** | Undecided; go/no-go research spike first |

Cancelled roots (historical only): **H** (STORM/harvest → D4; former D5 rehomed as **F2**). **G** was repurposed 2026-10-07 as the kk workflows parent (former G publish suite → **E4**).

## Phase 2 sequencing

The map **J** is the gate: authority lands first, then implementation graduates into the homes the
tree restructure created. No implementation past `todo` until **J** closes.

```
J (map: ADR-007 → PRD v3 → contract designs → tree realign → doc sync)
        │  closes ⇒ graduates
        ├── B6  kk executor fan-in / fan-out (spec: docs/design/fan-in-and-fan-out-specification.md)
        ├── A2  kk product CLI surface     (done — help/version/verbose, command tree, npm bin.kk; spec: docs/design/kk-cli-surface.md)
        ├── A21 two-noun CLI tree          (done — executor + plugin; ADR-011)
        ├── B7  multi-root plugin discovery (done — ADR-012 shipped; builtin + user + --plugins-path)
        ├── F   kk plugin collection       (parent for plugins/kk capabilities; historical judge B7 migrated in as F1)
        ├── F1  LLM-as-judge agent skills  (under F; fat skill content-judge; agent.run gate; ADR-007 amdt 2026-08-07 / 2026-08-19)
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


## Workflow visibility in Spur Board (G8, Phase 3)

Collect with the native module/reader foundation → Daily AI Voice and IT Content views → installed
package/browser acceptance. Tasks `0252`–`0254` are implemented; `0255` adds the separately packed
Knowledge Kit install proof (three module routes + Settings → Workflows under the installed Board)
and the operator setup/restart/shutdown steps.
See [workflow-board-modules.md](design/workflow-board-modules.md).


## Planned CLI/session follow-up (2026-10-13)

A22 follows the shipped A21 surface: normalize stage/lock operations, add named bot lifecycle, preserve channel session behavior, then review and migrate compatible callers. **Shipped and verified by tasks `0275`–`0278`** (2026-10-14): `kk stage run` + top-level `kk lock` with hidden compat routes, the generic `kk bot` lifecycle over staged transactions and shared leases, `browserSession` channel binding on the `open \| login --url` check-script protocol, and an evidence-based caller review that migrated only the behaviour-equivalent lock callers while retaining the publishing contexts, in-process session paths and API transports.
