# Feature tree restructure map (map J — repositioned scope)

SSOT for applying the 0035 realignment. Operator-approved target: tree derived from PRD v3 scope
(tasks 0030–0034 decisions). Apply via spur CLI (rename / create / section update / task edge) —
not raw ID surgery.

**Date:** 2026-08-03
**Map feature:** J
**Task:** 0035 (realign the feature tree)
**Precedent:** A1 map `docs/plans/feature-tree-restructure-map.md` (tasks 0006–0009) — this map's
blast-radius template and apply-order pattern. A1 close-out learnings applied: basename lag is

> **Supersession (2026-08-07, task 0037).** Decision #3 below ("Judge home = B7", fourth plugin kind)
> was **superseded** by ADR-007 amdt 2026-08-07: LLM-as-judge moved from a plugin kind to agent
> skills + `agent.run`. B7 remains the home, now scoped to **agent skills** (fat skill `kk-judge` +
> thin wrappers), not a fourth plugin kind. The historical decision text below is retained as a
> record of what 0034 decided and 0037 superseded.
## Locked decisions

1. **No new root letters.** PRD v3 in-scope areas (Project foundation A · Plugin platform B ·
   Ingestion C · Content generation D · Multi-channel publish E · Platform Repositioning J) map
   one-to-one onto existing roots; deferred/fog (I, D4, D5) keep existing homes. MECE decision
   procedure: new work is a **child of an existing capability**, never a root (hierarchy-mece.md).
2. **Fan-in/fan-out home = B6.** `kk fanin` / `kk fanout` are kk platform-step capabilities (PRD v3
   framework section: "Sequential fan-in (N→1) and fan-out (1→N) steps are owned by kk and run on
   the workflow engine"; spec `docs/design/fan-in-and-fan-out-specification.md`, task 0033). B's
   Goal owns the platform seam → child of B, not a new root.
3. **Judge home = B7.** Fourth plugin kind `judge` (`Content → Verdict`) per task 0034; extends B1
   registry / B2 contracts / B4 CLI. ADR-007 amendment recording it is task 0036's work; the tree
   reflects the decided taxonomy now (0034 is done).
4. **Multi-channel suite promoted → E4.** PRD v3 re-cut moves the suite (Surfing, X, Juejin, Qiita,
   Medium, Substack, Zenn, InfoQ, XHS) out of deferral into E's scope. One **E4 "Multi-channel
   suite harvest"** node — not E5–E12 stubs. Honors A1's "do not pre-create E4–E12 empty stubs"
   intent (the prohibition targeted empty per-channel stubs before planning; the PRD promotion
   makes a single harvest node the planned representation).
5. **E renamed "Publish" → "Multi-channel publish"** (rename-only, ID stable) — matches the PRD v3
   in-scope row exactly, so the tree↔scope read (R1) is self-evident.
6. **D re-cut, not renamed.** PRD v3 keeps the area name "Content generation" (D). The strain from
   the Background (creation as peer of ingestion) is resolved in D's Goal/Scope/AC text: generator
   input is `Doc[] | Brief`, brief-first creation is first-class and co-equal; D4/D5 move to
   Phase-3 deferred (PRD v3 out-of-scope table).
7. **In-flight work survives; restructure proceeds.** Feature B stays `verifying`; task 0028
   (close out B verification) covers the B1–B5 window and is untouched — B6/B7 are new backlog
   scope outside that window. Task 0029 (karakeep-local hardening) is C2's cited follow-up
   (`05_FEATURES` row C2: "hardening follow-up → task 0029") whose `feature_id` edge is currently
   missing; the edge is set to **C** (live parent) via CLI, because C2 is `done` and the
   L4.feature-terminal guard rejects tasks under terminal features (same pattern as B holding
   0003/0004/0005 directly). 0029's remaining `L3.ac-empty`/`L4.design-placeholder` findings are
   its own pre-existing content debt (populate when 0029 is refined), untouched by this map. No
   node that 0028/0029 depend on is cancelled or moved, so no wait is needed.
8. **F, G, H stay cancelled — not reused.** Letter IDs are creation-ordered, not positional (A1
   precedent: cancelled roots keep their letters as history; re-homed content lives under live
   parents — F→B5, G→E Notes, H→D4/D5). New nodes get fresh creation-ordered IDs (B6/B7/E4).
9. **I (LLM wiki) stays fog; J stays active.** I is out of PRD scope, undecided (go/no-go spike
   first). J is the wayfinder map, in-scope Phase 2, closes after 0036 syncs derived docs.

## Free-digit preflight

| Parent | Current kids | Free (≤9) | Planned creates | Pass |
| --- | --- | --- | --- | --- |
| B | B1 B2 B3 B4 B5 | 4 (B6–B9) | B6, B7 | ✅ |
| E | E1 E2 E3 | 6 (E4–E9) | E4 | ✅ |

No moves → no cascading ID reassignment anywhere else.

## Disposition table (every current node A–J)

| old_id | disposition | result | wave | one-line reason |
| --- | --- | --- | --- | --- |
| A | keep | A | 1 | Project foundation — PRD in-scope Phase 0; name matches |
| A1 | keep | A1 | 1 | historical restructure, done; stays under A |
| B | keep (+Goal/Scope/Notes re-cut) | B | 1 | Plugin platform — PRD in-scope; verifying; Goal names Judge kind; B6/B7 added to Scope |
| B1 | keep | B1 | 1 | manifest/registry, done |
| B2 | keep | B2 | 1 | typed contracts, done (judge kind extends, 0036+) |
| B3 | keep | B3 | 1 | workflow integration, done |
| B4 | keep | B4 | 1 | CLI surface, done |
| B5 | keep | B5 | 1 | E2E acceptance, done (edge scenario "no fourth kind" superseded by 0034 — noted) |
| — | create | B6 | 2 | Sequential fan-in/fan-out steps — home for 0033 spec |
| — | create | B7 | 2 | Judge plugin kind — home for 0034 decision |
| C | keep | C | 1 | Ingestion — PRD in-scope Phase 1; name matches; optionality expressed at D/J level |
| C1 | keep | C1 | 1 | ingestion plugin design, done |
| C2 | keep | C2 | 1 | Karakeep-local, done; 0029 edge set to live parent C (feature-terminal guard) |
| D | keep (Goal/Scope/AC re-cut) | D | 1 | Content generation — PRD in-scope; re-cut: `Doc[] \| Brief`, creation co-equal; D4/D5 Phase-3 |
| D1 | keep | D1 | 1 | research done |
| D2 | keep | D2 | 1 | wire stand-in |
| D3 | keep | D3 | 1 | generator design, done |
| D4 | keep | D4 | 1 | Own STORM — Phase-3 deferred (PRD v3 out-of-scope table) |
| D5 | keep | D5 | 1 | wt generator harvest — Phase-3 deferred (PRD v3) |
| E | rename-only + Goal/Scope re-cut | E | 1 | name → "Multi-channel publish" (PRD v3 row); suite promoted into scope |
| E1 | keep | E1 | 1 | wt-publish audit, done |
| E2 | keep | E2 | 1 | publish design + harness, done |
| E3 | keep | E3 | 1 | Surfdash publisher, done |
| — | create | E4 | 2 | Multi-channel suite harvest — promoted from former-G deferral (PRD v3) |
| F | keep cancelled | — | 1 | not reused; E2E folded into B5 (A1) — history |
| G | keep cancelled | — | 1 | not reused; suite content now lives as E4 (was E Notes) — history |
| H | keep cancelled | — | 1 | not reused; STORM/harvest folded into D4/D5 (A1) — history |
| I | keep | I | 1 | LLM wiki — out of PRD scope, fog, go/no-go spike first |
| J | keep | J | 1 | Reposition (wayfinder map) — PRD in-scope Phase 2; closes after 0036 |

No node is dropped, merged, or moved. Three creates (B6/B7/E4), one rename (E), three re-cuts
(B Scope/Notes, D Goal/Scope/AC, E Goal/Scope), one task-edge restore (0029 → C2).

## Apply order (waves)

### Wave 1 — rename + section re-cuts (stable IDs)

```bash
spur feature update E --field name --value "Multi-channel publish"
spur feature update B --section Scope --from-file <b-scope.md>
spur feature update B --section Notes --from-file <b-notes.md>
spur feature update D --section Goal --from-file <d-goal.md>
spur feature update D --section Scope --from-file <d-scope.md>
spur feature update D --section Acceptance --from-file <d-ac.md>
spur feature update E --section Goal --from-file <e-goal.md>
spur feature update E --section Scope --from-file <e-scope.md>
```

### Wave 2 — creates (digit order)

```bash
spur feature create "Sequential fan-in/fan-out steps" --parent B   # → B6
spur feature create "Judge plugin kind" --parent B                 # → B7
spur feature create "Multi-channel suite harvest" --parent E       # → E4
# then populate Goal/Scope via --section --from-file
```

### Wave 3 — task edge

```bash
spur task update 0029 --feature C   # C2 is done; guard L4.feature-terminal rejects terminal parents
```

### Wave 4 — refresh + checks + docs

```bash
spur feature refresh
spur feature check --json
spur task check --json
# rewrite docs/05_FEATURES.md (R7); 02/03/04/00 sweep is task 0036
```

## Docs rewrite checklist (this task)

- [ ] `docs/05_FEATURES.md` — E renamed; B6/B7/E4 rows; D4/D5 Phase 3; E note "multi-channel in scope"; map-j header note
- [ ] Map **J** → *Decisions so far* gains one line (0035 gist)

## Left to task 0036 (derived-doc sweep — explicitly out of 0035)

- `docs/02_ROADMAP.md` phase re-cut (Phase 2 — Co-equal Creation & Publishing; D4/D5 Phase 3)
- `docs/01_PRD.md` cross-check (already states "Multi-channel publish | E" — no change expected)
- `docs/00_ADR.md` ADR-007 amendment for judge kind (0034 R7)
- `docs/03_ARCHITECTURE.md` / `docs/04_DESIGN.md` contract sections (0032/0033/0034 targets)

## Out of scope for this map

- Implementing fan-in/fan-out, judge kind, or any publish channel (implementation graduates to B6/B7/E4 once J closes)
- Creating E5–E12 per-channel stubs
- New root letters (K+)
- Reusing F/G/H letters
