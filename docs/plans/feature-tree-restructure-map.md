# Feature tree restructure map (A1)

SSOT for applying the A1 restructure. Operator-approved target (wayfinder on A1).
Apply via spur CLI (rename / create / section update / cancel) — not raw ID surgery.

**Date:** 2026-07-29  
**Map feature:** A1  
**Tasks:** 0006 inventory · 0007 this file · 0008 dry-run · 0009 apply+docs

## Locked decisions

1. CLI surface = **B4** (not new root F)
2. Keep **F** as end-to-end vertical
3. C/D/E kind-aligned parents: Ingestion / Content generation / Publish
4. G absorb into E Notes (deferred multi-channel); cancel root G
5. H split into D4 (STORM) + D5 (wt generator harvest); cancel root H
6. Restructure meta work lives under **A1**

## Free-digit preflight

| Parent | Current kids | Free | Planned creates | Pass |
| --- | --- | --- | --- | --- |
| A | A1 | 8 | 0 | ✅ |
| B | B1 B2 B3 | 6 | B4 | ✅ |
| C | — | 9 | C1 C2 | ✅ |
| D | D1 D2 | 7 | D3 D4 D5 | ✅ |
| E | E1 E2 E3 | 6 | 0 | ✅ |

## Disposition table

| old_id | disposition | new_id / result | wave | notes |
| --- | --- | --- | --- | --- |
| A | rename-only | A | 1 | name → Project foundation; broaden Goal |
| A1 | keep | A1 | 1 | map stays under A |
| B | rename-only | B | 1 | name → Plugin platform |
| B1 | keep | B1 | 1 | |
| B2 | keep | B2 | 1 | |
| B3 | keep | B3 | 1 | |
| — | create | B4 | 2 | CLI surface under B |
| C | rename-only + goal rewrite | C | 1 | name → Ingestion (parent) |
| — | create | C1 | 2 | Ingestion plugin design |
| — | create | C2 | 2 | Karakeep-local (content from old C Goal/Scope) |
| D | rename-only + goal rewrite | D | 1 | name → Content generation (parent) |
| D1 | keep | D1 | 1 | research done |
| D2 | keep | D2 | 1 | wire stand-in |
| — | create | D3 | 2 | Generator plugin design (from old D Goal) |
| — | create | D4 | 2 | Own STORM (from H) deferred |
| — | create | D5 | 2 | wt generator harvest (from H) deferred |
| E | rename-only + goal rewrite | E | 1 | name → Publish (parent); absorb G notes |
| E1 | rename-only | E1 | 1 | keep audit (optional name polish) |
| E2 | rename-only | E2 | 1 | Publish design + test harness |
| E3 | rename-only | E3 | 1 | Surfdash publisher |
| F | rename-only | F | 1 | name → End-to-end vertical |
| G | archive (cancel) | cancelled | 3 | content → E Notes; no E4… pre-create |
| H | archive (cancel) | cancelled | 3 | content → D4/D5 |
| I | keep | I | 1 | LLM wiki fog |

## Apply order (waves)

### Wave 1 — renames (stable IDs)

```bash
spur feature update A --field name --value "Project foundation"
spur feature update B --field name --value "Plugin platform"
spur feature update C --field name --value "Ingestion"
spur feature update D --field name --value "Content generation"
spur feature update E --field name --value "Publish"
spur feature update F --field name --value "End-to-end vertical"
spur feature update E2 --field name --value "Publish design and test harness"
# E1/E3 names OK as-is or minor polish
```

Then rewrite Goals/Scopes for A, C, D, E via `--section`.

### Wave 2 — creates (digit order)

```bash
spur feature create "CLI surface" --parent B                 # → B4
spur feature create "Ingestion plugin design" --parent C     # → C1
spur feature create "Karakeep-local" --parent C              # → C2
spur feature create "Generator plugin design" --parent D     # → D3
spur feature create "Own STORM generator" --parent D         # → D4
spur feature create "wt generator harvest" --parent D        # → D5
```

Populate C2/D3/D4/D5 Goal/Scope from former C/D/H content.

### Wave 3 — archive

```bash
spur feature update G cancelled   # if not already
spur feature update H cancelled
```

### Wave 4 — refresh + derived docs

```bash
spur feature refresh
# rewrite docs/01_PRD.md docs/02_ROADMAP.md docs/05_FEATURES.md (+ ADR letter notes if needed)
```

## Docs rewrite checklist (0009)

- [ ] `05_FEATURES.md` — new tree table including A1, B4, C1/C2, D3–D5; G/H cancelled; F renamed
- [ ] `02_ROADMAP.md` — Phase 2 = D4/D5 + E multi-channel (not root G/H)
- [ ] `01_PRD.md` — in/out tables match new IDs
- [ ] `00_ADR.md` — consequences letter map if needed (A–I still valid; G/H cancelled)

## Out of scope for this map

- Implementing C2/D2/E3 plugin code
- Creating E4–E12 empty stubs
- New root for CLI
- Dropping F

## Amendment — 2026-07-29 (F folded into B5)

Operator decision after A1 apply: free active root **F**.

| old_id | disposition | result |
| --- | --- | --- |
| F | archive (cancel) | content → **B5 End-to-end pipeline acceptance** under B |
| — | create | **B5** |
| B3 | extend Notes | points E2E acceptance at B5 (template stays B3) |

Active Phase-1 tree roots: **A, B, C, D, E, I** (+ cancelled F/G/H historical).

## Amendment — 2026-08-12 (D5 rehomed under F)

Operator-approved correction after the 2026-08-12 ADR-006 amendment made **F** the exclusive parent
for `plugins/kk` agent capabilities. D5's `topic-*` / `image-*` / `info-*` skill harvest is an agent
capability collection, not a product `generator` plugin satisfying `GeneratorInput → Content`.

| old_id | disposition | new_parent | expected_new_id | wave | notes |
| --- | --- | --- | --- | --- | --- |
| D5 | reparent-under:F | F | F2 | 4 | Keep Goal; narrow the first delivery to the cohesive topic-core path during planning. |
