---
template: meta
schema_version: 1
name: "Sync derived docs to the repositioned canon"
description: ""
status: done
type: meta
profile: standard
feature_id: J
parent_wbs: null
priority: P2
tags: ["meta"]
dependencies: ["0031", "0032", "0033", "0034", "0035"]
created_at: "2026-08-03T00:11:45.228Z"
updated_at: "2026-08-03T01:53:20.915Z"
---

## 0036. Sync derived docs to the repositioned canon

### Background
`wayfinder:task` — the closing sweep on map **J**. Blocked on **0031**, **0032**, **0033**,
**0034**, **0035**.

**Question:** Do the derived docs contain any statement that contradicts the repositioned canon?

By the time this runs, authority is settled: ADR-007 (0030) owns WHY, PRD v3 (0031) owns scope, and
0032/0033/0034 have produced specs naming their target sections. This ticket propagates — it does
not decide. Any decision surfacing here is a signal that an upstream ticket was closed too early;
route it back rather than settling it in a derived doc.

Targets and what each must absorb:

| Doc | Absorbs |
|---|---|
| `docs/02_ROADMAP.md` | Phases re-cut per PRD v3; no phase describes finished work as current |
| `docs/03_ARCHITECTURE.md` | Mechanism from 0032 (Brief dispatch), 0033 (fan-in/fan-out), 0034 (judge) |
| `docs/04_DESIGN.md` | Surface: new/changed `kk` subcommands and flags, schema shapes |
| `docs/05_FEATURES.md` | Tree from 0035 (largely applied there; verify agreement) |
| `docs/99_PROJECT_CONSTITUTION.md` | Process only — sync triggers and doc map if the surface grew |
| `AGENTS.md` | Project framing paragraph, layout, harness routing table |
| `docs/features/*.md` | Per-feature Goal/Scope alignment with the new tree and scope |

Three known contradictions to hunt specifically, each currently asserted somewhere in the corpus:

1. **Ingestion is mandatory** — implied wherever `generate(Doc[]) → Content` appears.
2. **`spur workflow` provides fan-out** — the PRD calls a pipeline "a DAG"; the engine runs it
   linearly and `type: parallel` has no executor.
3. **Publish is deferred to Phase 2** — stated in PRD v2 and echoed in the roadmap.

`AGENTS.md` is symlinked as `CLAUDE.md` and `GEMINI.md`; edit the real file once.
### Requirements
- **R1** — A drift audit runs first via `sp:doc-evolve`, producing the list of contradicting
  statements before any edit. The three known contradictions in Background are confirmed or
  dismissed by evidence, not assumed.
- **R2** — `docs/02_ROADMAP.md` phases are re-cut from PRD v3. No phase presents completed work
  (the B5 reference vertical) as current.
- **R3** — `docs/03_ARCHITECTURE.md` absorbs the mechanism specs from 0032, 0033, 0034 into the
  sections those tickets named.
- **R4** — `docs/04_DESIGN.md` absorbs the surface changes — `kk` subcommands, flags, and schema
  shapes — per the T3 same-commit obligation.
- **R5** — `docs/05_FEATURES.md` agrees with `spur feature list` after 0035.
- **R6** — `AGENTS.md` states the repositioned product in its Project section; the harness routing
  table and layout are corrected if the surface grew. Edited once at the real file, not via the
  `CLAUDE.md` / `GEMINI.md` symlinks.
- **R7** — `docs/99_PROJECT_CONSTITUTION.md` is touched **only** if process changed (sync triggers,
  doc map). Content changes do not belong here.
- **R8** — Every `docs/features/*.md` Goal/Scope is checked against the new tree and scope.
- **R9** — Frontmatter contracts per `99` §4.3 hold on every touched doc: `version`, `updated_at`,
  `derived_from`, `sync`.
- **R10** — No derived doc asserts any of the three known contradictions. This is verified by
  search, and the searches are recorded in Testing.
- **R11** — Any decision that surfaces during the sweep is routed back to an upstream ticket or to
  map **J** → *Not yet specified* — never settled inside a derived doc.
### Acceptance Criteria
```gherkin
Scenario: No derived doc contradicts authority
  Given docs/00_ADR.md ADR-007 and docs/01_PRD.md v3 as authority
  When docs/02, 03, 04, 05, 99, AGENTS.md and docs/features/* are read against them
  Then no derived doc asserts ingestion is mandatory
    And none asserts the workflow engine provides fan-out
    And none asserts publish is deferred to Phase 2

Scenario: Mechanism and surface docs absorbed their specs
  Given the target sections named by tickets 0032, 0033 and 0034
  When docs/03_ARCHITECTURE.md and docs/04_DESIGN.md are read
  Then each named section carries the corresponding spec

Scenario: Frontmatter contracts survive the sweep
  Given docs/99 §4.3
  When each touched doc's frontmatter is checked
  Then version, updated_at, derived_from and sync are present and correctly bumped

Scenario: The doc corpus passes its own gate
  Given the sweep is complete
  When the project's doc drift audit runs via sp:doc-evolve
  Then it reports no drift between authority and derived docs
```

- [ ] Contradiction searches recorded in Testing with their commands and results (R10).
- [ ] `AGENTS.md` edited at the real file, symlinks untouched (R6).
- [ ] Map **J** closes: every ticket done, Not-yet-specified reviewed for graduation or carry-over.
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design

<!-- Approach and tradeoffs for process/docs/config changes. Keep this short. -->

### Plan

<!-- Ordered checklist. Fill before moving to todo/wip. -->

### Solution
Drift audit first (R1), then authority-down propagation. The three known contradictions were each
confirmed present before edit and re-checked absent after.

**Authority corrections (contradictions found *in* `00`/`01`, fixed at source per the conflict rule):**

- `docs/00_ADR.md` — added **Amendment 2026-08-02 (fourth plugin kind `judge`, ticket 0034)**.
  0034 chose a fourth kind but the taxonomy change was never recorded in authority;
  `docs/05_FEATURES.md:46` had it pending as "ADR-007 amdt in 0036". Records
  `kind ∈ {ingestion, generator, publish, judge}`, the `Content → Verdict` contract, and the
  exit-code rule (exit 0 even on a FAIL verdict — gating reads the payload, not the exit status).
  Version 1.5.0 → 1.6.0.
- `docs/01_PRD.md` — three corrections: added the `JudgePlugin` row to the framework table;
  replaced "a pipeline … **as a DAG**" (contradiction C2 — the engine is sequential) with a
  sequence-of-states statement naming `kk fanin`/`fanout`; corrected the success criterion that
  claimed *every* contract accepts briefs (only the generator does). Plugin-developer line and the
  **B** in-scope row now name Judge and B6/B7 so `01` and `02` agree on Phase 2. 3.0.0 → 3.1.0.

**Derived-doc propagation:**

- `docs/02_ROADMAP.md` (2.1.1 → **3.0.0**) — phases re-cut. Phase 1 no longer reads "current" with
  finished work in it (R2): B1–B5 done and the E2E vertical proven, residue named explicitly
  (`0028`, `0029`, D1/D2, E1). New **Phase 2 — Repositioning + widened contracts** (current) holding
  J → B6/B7/D-Brief/E4, with intra-phase ordering and dependencies. Phase 3 = D4/D5.
- `docs/03_ARCHITECTURE.md` (1.1.0 → **2.0.0**) — new **Pipeline model** section absorbing all three
  mechanism specs: the sequential-substrate finding with file:line evidence, the four plugin kinds,
  generator input dispatch (combined shape + fail-loud mismatch), fan-in/fan-out semantics with
  partial-success reconciliation, and a pipeline data-flow diagram. `kk-core` boundary row extended
  with Brief/Verdict.
- `docs/04_DESIGN.md` (1.2.0 → **2.0.0**) — §1.5 `fanin` and §1.6 `fanout` full surface specs with
  flag tables and the exit-code contract; command table gains a **Status** column and an explicit
  *specified — not implemented* marker so `04` never asserts a callable surface that has no code;
  `judge` added to `plugins list --kind`; Brief/Verdict schemas listed as specified-not-implemented.
  Fan-in/fan-out spec registered in §6.
- `docs/05_FEATURES.md` (2.2.0 → **2.3.0**) — B7 row updated from "ADR-007 amdt in 0036" (pending) to
  the recorded amendment.
- `AGENTS.md` — Project section restated for the platform, with the historical-name note, the
  four-kind table, and the `kk` owns steps / `spur workflow` owns orchestration invariant. Layout
  block gains `kk-core/`, `plugins/`, `docs/design/`. Edited at the real file; `CLAUDE.md` /
  `GEMINI.md` are symlinks and were not touched (R6).
- `docs/99_PROJECT_CONSTITUTION.md` — **untouched.** No process changed; sync triggers T1–T8 still
  describe this work correctly (R7).

**Corpus repairs found during the sweep (outside the original R-set):**

- `docs/features/B7_…md` carried B6's title in its `# H1` *and* its AC `Feature:` line while
  frontmatter said "Judge plugin kind" — a content error 0035's review missed (it dispositioned only
  the basename as P3-residual). H1 corrected; real AC authored via `spur feature update --section`.
- **B6, B7, E4** all shipped with the untouched scaffold AC (`Scenario: Basic acceptance / Given a
  precondition`). Replaced with three real scenarios each, derived from the 0033/0034 specs and the
  E2 transport contract.
### Testing
**Contradiction searches (R10)** — run after the sweep; each of the three known contradictions
re-checked by grep across `docs/*.md`, `docs/features/*.md`, `AGENTS.md`:

```
C1  ingestion mandatory (bare `generate(Doc[]) → Content`)                 → (clean)
C2  engine provides fan-out / pipeline "as a DAG"                          → (clean)*
C3  publish deferred to Phase 2                                            → (clean)*
```

`*` Remaining hits are correct content, manually inspected: `docs/01_PRD.md:57` is the Non-Goal that
*rejects* engine parallelism; `docs/features/J_reposition-knowledge-kit-as-an-ingest-create-publish-platform-wayfinder-map.md:138` is the map's own Findings entry documenting
the stub; `docs/05_FEATURES.md:26` defers **D4/D5** to Phase 3, not publish.

**Feature-file canon scan (R8)** — Goal/Scope of every `docs/features/[A-Z]*.md` grepped for stale
canon (`generate(Doc[]) →`, "as a DAG", "deferred to Phase 2", "knowledge management tool",
"parallel node"): no hits.

**Corpus gates:**

```
spur feature check   → 29/29 PASS (A A1 B B1-B7 C C1 C2 D D1-D5 E E1-E4 F G H I J)
spur feature check J → PASS  (shippable gate; 5 DD-09 orphan-scenario WARNs — map-level AC,
                              expected shape for a wayfinder feature)
```

**Frontmatter contract (R9)** — `99` §4.3, after sweep:

| Doc | version | updated_at |
|-----|---------|------------|
| `00_ADR` | 1.6.0 | 2026-08-02 |
| `01_PRD` | 3.1.0 | 2026-08-03 |
| `02_ROADMAP` | 3.0.0 | 2026-08-02 |
| `03_ARCHITECTURE` | 2.0.0 | 2026-08-02 |
| `04_DESIGN` | 2.0.0 | 2026-08-02 |
| `05_FEATURES` | 2.3.0 | 2026-08-03 |
| `99_PROJECT_CONSTITUTION` | 1.2.0 | unchanged — no process change (R7) |

**Project quality gate:**

```
bun run lint  → biome check 53 files, no fixes; typecheck exit 0 across all 6 workspaces
bun run test  → 77 pass / 0 fail, 189 expect() calls, 14 files, 2.41s
```

Coverage holds the ≥90% line/function target on every module (lowest: `surfdash-pub` 93.33% line,
100% function).

**Not verified by execution:** the `kk fanin` / `kk fanout` surfaces documented in `04_DESIGN` §1.5–1.6
have no implementation yet — they are marked *specified — not implemented* precisely so the doc does
not assert an executable surface. Their behavior graduates to feature **B6** and is untested here.
### Review
| Sev | Finding | Location | Disposition |
|-----|---------|----------|-------------|
| P1 | — | — | None. No contradiction between authority (`00`/`01`) and derived docs survives the sweep; all three tracked contradictions re-verified clean. |
| P2 | `0034` chose a fourth plugin kind but authority never recorded the taxonomy change; `05_FEATURES:46` carried it as a pending TODO ("ADR-007 amdt in 0036"). A design assuming `kind: judge` with no ADR backing it is exactly the drift `99` T2 forbids. | `docs/00_ADR.md` | **Fixed** — ADR-007 Amendment 2026-08-02 records the kind, contract, and exit-code semantics. |
| P2 | `01_PRD` described a pipeline as "a DAG", asserting an execution model the engine does not provide (contradiction C2 in authority itself, not just derived docs). | `docs/01_PRD.md:32` (pre-edit) | **Fixed** — restated as a sequence of states with `kk fanin`/`fanout` named. |
| P3 | `docs/features/B7_…md` H1 and AC `Feature:` line both carried B6's title. `0035`'s own review saw only the basename duplication (P3, "residual OK") and missed the in-file content error. | `docs/features/B7_…md:12,22` (pre-edit) | **Fixed** — H1 corrected; real AC authored via CLI. |
| P3 | B6 / B7 / E4 were created with untouched scaffold AC (`Given a precondition / When an action`). They passed `feature check` L3 (valid Gherkin) while carrying no actual acceptance meaning. | `docs/features/{B6,B7,E4}_….md` | **Fixed** — three real scenarios each, derived from the 0033/0034 specs and the E2 transport contract. |
| P3 | `01_PRD` success criterion claimed *every* plugin contract accepts briefs; only the generator does. Ingestion produces `Doc[]`, publish consumes `Content`, judge consumes `Content`. | `docs/01_PRD.md` (pre-edit) | **Fixed** — per-kind contracts stated individually. |
| P4 | `04_DESIGN` now documents `fanin`/`fanout` before any code exists, risking a doc that asserts a callable surface. | `docs/04_DESIGN.md` §1.5–1.6 | **Mitigated, deliberate** — command table gained a Status column; both sections are headed *specified, not implemented*, with an explicit callout that nothing in §1.5/§1.6 runs today. Preferred over omitting the spec, which would leave `03` mechanism with no surface counterpart. |
| P4 | `updated_at` is inconsistent across the corpus (`2026-08-02` vs `2026-08-03`) because automated edits stamp UTC while hand edits use the operator's PST date. | frontmatter, several docs | **Accepted** — cosmetic; both resolve to the same operator-local day. Not worth a churn commit. |
| P4 | `B7`/`E` feature-file basenames still lag their names (`B7_sequential-fan-in-fan-out-steps.md`, `E_publishplugin-surfdash.md`). | `docs/features/` | **Accepted, residual** — no CLI verb regenerates a basename (`--field name` writes frontmatter only, verified); `id` + `name` are authoritative for all tooling and `feature check` passes. Same disposition as A1's P2 precedent and 0035's own P3. Repair needs `git mv` + reference sweep — worth a dedicated task, not a drive-by. |

**Residual risk:** low. The corpus is internally consistent and every gate is green. The one
knowingly-unresolved item is cosmetic (basenames). The substantive follow-on is that `03`/`04` now
describe mechanism and surface for code that does not exist — intentional under ADR-007, tracked as
**B6**/**B7**/**D**/**E4**, and explicitly labelled in `04` so no reader mistakes spec for shipped.

**Disposition:** APPROVE.
### References

<!-- Links to docs, tasks, decisions, or external references. -->

### History
- 2026-08-03T01:43:59.946Z todo → wip (system)
- 2026-08-03T01:51:23.343Z wip → testing (system)
- 2026-08-03T01:53:20.915Z testing → done (system)
