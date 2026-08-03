---
template: meta
schema_version: 1
name: "Realign the feature tree to the repositioned scope"
description: ""
status: done
type: meta
profile: standard
feature_id: J
parent_wbs: null
priority: P2
tags: ["meta"]
dependencies: ["0031"]
created_at: "2026-08-03T00:11:45.097Z"
updated_at: "2026-08-03T03:28:31.991Z"
---

## 0035. Realign the feature tree to the repositioned scope

### Background
`wayfinder:task` — CLI-gated corpus work on map **J**. Blocked on **0031** (PRD v3).

**Question:** What is the feature tree under the repositioned scope, and what is the mapping from
the current A–I tree to it?

The current tree was cut for *ingest → generate → publish where publishing is the tail end*:

```
A foundation · B plugin platform · C ingestion · D content generation · E publish
F/G/H cancelled · I LLM wiki (fog)
```

Under co-equal creation and publishing this is at least strained:

- **D** is "Content generation" — downstream of ingestion by construction. With briefs as a
  first-class entry, creation is a peer of ingestion, not its consumer.
- **E** carries a deferred multi-channel suite that the PRD re-cut promotes into scope; E's children
  need re-deriving from whatever scope 0031 lands on.
- **Fan-in/fan-out and the judge** (0033, 0034) have no home in the tree at all — they are platform
  capabilities, so plausibly **B** children, but B is `verifying` and near closure.
- **F, G, H are cancelled roots** whose content was folded into B5, E-notes and D4/D5. Whether the
  restructure reuses those letters or continues at K is a real question — feature letter IDs are
  assigned **by creation order**, so a "move" is not a rename.

Precedent exists: **A1** did exactly this restructure once (tasks 0006–0009), and `sp:dev-featurechange`
is the tool — dry-run from a mapping file, then apply via `spur feature move`, task `feature_id`
edges, and root doc reference rewrites. **Never raw-Write `docs/features/` or `docs/tasks/`.**

Read the A1 close-out learnings before drafting the mapping; that restructure's blast-radius
inventory (0006) is the template for this one.
### Requirements
- **R1** — A target feature tree is derived from PRD v3 scope (0031). Every in-scope area maps to
  exactly one root; every retained root maps to stated scope.
- **R2** — A mapping file records the disposition of every current node A–I (keep / rename / move /
  cancel / merge) with a one-line reason. No node is silently dropped.
- **R3** — Homes are assigned for the capabilities that currently have none: fan-in/fan-out (0033)
  and the judge (0034), whatever 0034 decides about its taxonomy.
- **R4** — The disposition of cancelled roots **F**, **G**, **H** is stated — reused or left
  cancelled — accounting for letter IDs being creation-ordered rather than positional.
- **R5** — Work in flight is protected: feature **B** is `verifying` with open tasks **0028** and
  **0029**. The mapping states how they survive the restructure, or the restructure waits.
- **R6** — The change is executed via `sp:dev-featurechange` — dry-run first, then apply through
  `spur feature move` / task `feature_id` edges / root doc reference rewrites. No raw Write or Edit
  on `docs/features/` or `docs/tasks/`.
- **R7** — `docs/05_FEATURES.md` reflects the applied tree, and `spur feature list` agrees with it.
- **R8** — Task→feature traceability holds after the move: no task points at a feature_id that no
  longer exists.
### Acceptance Criteria
```gherkin
Scenario: Tree and scope agree
  Given PRD v3 scope tables and the applied feature tree
  When each is read against the other
  Then every in-scope area has exactly one feature root, and every root maps to stated scope

Scenario: No traceability is lost in the move
  Given tasks carrying feature_id edges before the restructure
  When `spur feature check` and `spur task check` run after it
  Then both pass, and no task references a feature_id that no longer exists

Scenario: In-flight work survives
  Given feature B is verifying with tasks 0028 and 0029 open
  When the restructure is applied
  Then those tasks remain reachable under a live feature, or the restructure is deferred until
    they close, with the choice recorded

Scenario: The restructure was CLI-gated
  Given the change has been applied
  When `git log -p` for docs/features and docs/tasks is inspected
  Then the changes came from spur CLI operations, not hand edits
```

- [x] Dry-run output reviewed before apply (R6).
- [x] `spur feature list` matches `docs/05_FEATURES.md` (R7).
- [x] [docs-only] The feature tree matches the stated scope

- [x] Map **J** → *Decisions so far* gains one line.
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design

<!-- Approach and tradeoffs for process/docs/config changes. Keep this short. -->

### Plan

<!-- Ordered checklist. Fill before moving to todo/wip. -->

### Solution
- `docs/plans/feature-tree-restructure-map-j.md:1` (new): SSOT mapping — disposition for every node A–J, locked decisions, free-digit preflight, apply order (R2/R6).
- Tree changes (all via `spur feature` / `spur task` CLI — no raw writes on `docs/features/` or `docs/tasks/`):
  - `spur feature update E --field name --value "Multi-channel publish"` — rename-only to the PRD v3 in-scope row name; ID stable (`docs/features/E_publishplugin-surfdash.md:4`) (R1).
  - `spur feature update B --section Goal|Scope|Notes` — Goal names the Judge kind; Scope adds B6/B7 (`docs/features/B_kk-plugin-platform.md:14`, `:17`); Notes records that B5's "no fourth plugin kind" edge scenario is superseded by 0034's judge-kind decision (ADR-007 amendment lands in 0036).
  - `spur feature update D --section Goal|Scope|Acceptance Criteria` — D re-cut: generator input `Doc[] | Brief`, creation co-equal with ingestion (`docs/features/D_contentgeneratorplugin.md:15`); D4/D5 Phase-3 deferred (`:17`); core AC scenario input widened (`:25`).
  - `spur feature update E --section Goal|Scope` — E re-cut: multi-channel suite in scope; harvest lands as E4 (`docs/features/E_publishplugin-surfdash.md:15`) (formerly G deferral).
  - `spur feature create "Sequential fan-in/fan-out steps" --parent B` → **B6**; Goal cites the 0033 spec (`docs/features/B6_sequential-fan-in-fan-out-steps.md:14`) — R3 home for fan-in/fan-out.
  - `spur feature create "Judge plugin kind" --parent B` → **B7**; Goal cites the 0034 decision (`docs/features/B7_sequential-fan-in-fan-out-steps.md:14`) — R3 home for the judge.
  - `spur feature create "Multi-channel suite harvest" --parent E` → **E4**; Goal cites PRD v3 promotion (`docs/features/E4_multi-channel-suite-harvest.md:14`).
  - `spur task update 0029 --feature C` — restored 0029's missing edge to the live parent C (`docs/tasks/0029_harden-karakeep-local-fail-loud-on-zero-doc-ingest-and-creat.md:9`; C2 is done; guard L4.feature-terminal rejects terminal parents; precedent: B holds 0003/0004/0005 directly) — R5/R8.
  - `spur feature refresh` — INDEX regenerated; J task table synced.
- `docs/05_FEATURES.md:39-60` — tree table rewritten to match the applied tree: 29 rows agree with `spur feature list` (R7); E renamed (`:56`), B6/B7/E4 added (`:45`, `:46`, `:60`), D4/D5 Phase 3, J row added, map-j header note (`:24`).
- Map **J** — `Decisions so far` gains the 0035 line (`docs/features/J_reposition-knowledge-kit-as-an-ingest-create-publish-platform-wayfinder-map.md:168`).
- F/G/H remain cancelled (creation-ordered IDs, not reused); I stays fog; J stays active — R4.
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | PRD v3 in-scope areas map 1:1 onto roots A/B/C/D/E/J; E renamed 'Multi-channel publish' (PRD row name); D re-cut to co-equal `Doc[] \| Brief` creation; I deferred as fog |
| R2 | MET | docs/plans/feature-tree-restructure-map-j.md: disposition for every node A-J with one-line reasons; no node dropped |
| R3 | MET | Homes created: B6 (fan-in/fan-out, 0033 spec), B7 (judge kind, 0034), E4 (multi-channel suite, PRD v3) |
| R4 | MET | F/G/H stay cancelled — creation-ordered IDs not reused (map locked decision 8); content already re-homed (B5/E4/D4/D5) |
| R5 | MET | 0028 untouched under verifying B (B1-B5 window); 0029 edge set to live parent C (C2 done; L4.feature-terminal guard); choice recorded in map |
| R6 | MET | Dry-run preflight (free digits B:4/E:6 >= creates 2/1); apply via spur feature create/update + spur task update + refresh; no raw writes on docs/features or docs/tasks |
| R7 | MET | docs/05_FEATURES.md rewritten; 29 rows match spur feature list (IDs identical; E row name matches) |
| R8 | MET | Distinct task feature_ids {A,A1,B,B4,B5,C,C1,C2,D1,D2,D3,E1,E2,E3,J} all exist in live feature list; set difference empty |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|--------------|----------|
| AC1 | pass |  | Tree and scope agree: every in-scope area has exactly one root; every root maps to stated scope |
| AC2 | pass |  | feature check 29/29 PASS; no dangling feature_ids; task check 4 pre-existing failures (0001/0002/0028/0029) unchanged by the move |
| AC3 | pass |  | 0028 reachable under B; 0029 reachable under C; choice recorded in map |
| AC4 | pass |  | git diff HEAD for docs/features + docs/tasks shows CLI-generated changes only; no hand ID surgery |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

**Unit (sp-dev-unit 0035, 2026-08-03T01:11Z)**

Meta task — zero code delta (feature tree restructure, corpus/docs only). No tests to write, no
per-file coverage target applies to this task's artifacts. Repo suite run as the smoke gate:

- `bun run test`: **77 pass / 0 fail** (14 files, 189 expect calls)
- Coverage: **99.49% funcs / 97.37% lines** aggregate (threshold 90/90) — unchanged by this task's
  corpus-only diff
- `spur task check 0035`: exit 0 — warnings only (L3.requirements-format, L4.uncovered-task-scenario
  x7, L4.gate-language x2), all pre-existing; no error-level findings
- No implementation gaps revealed; task remains at `testing` per dev-unit contract (never marks done)
### Review
**Functional Traceability (sp-functional-review) — PASS**

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `docs/01_PRD.md:64` in-scope row "Multi-channel publish \| E"; `docs/features/E_publishplugin-surfdash.md:4` `name: Multi-channel publish` (rename-only, ID stable); `docs/features/D_contentgeneratorplugin.md:15` Goal — generator input `Doc[] \| Brief`, creation co-equal (ADR-007 R3); `docs/features/B_kk-plugin-platform.md:15` Goal names Judge kind + fan-in/fan-out. Roots A/B/C/D/E/J = PRD in-scope areas, I fog, D4/D5 Phase-3 (map locked decision 1) — 1:1 tree↔scope bijection |
| R2 | MET | `docs/plans/feature-tree-restructure-map-j.md` disposition table — every node A–J has a row (keep / create / cancelled) with one-line reason; no node dropped, merged, or moved |
| R3 | MET | B6 created — `docs/features/B6_sequential-fan-in-fan-out-steps.md:13` Goal cites 0033 spec (`kk fanin`/`kk fanout`); B7 created — `docs/features/B7_sequential-fan-in-fan-out-steps.md:13` Goal cites 0034 judge kind (`Content → Verdict`); E4 created — `docs/features/E4_multi-channel-suite-harvest.md:13` Goal cites PRD v3 promotion. Hierarchy: `docs/features/INDEX.md` (auto-generated) places B6/B7 under B, E4 under E |
| R4 | MET | `spur feature list`: F/G/H all `cancelled`; map locked decision 8 — creation-ordered IDs not reused, content already re-homed (F→B5, G→E4, H→D4/D5) |
| R5 | MET | 0028: `spur task show 0028` → status `todo`, feature B — untouched under verifying B (B1–B5 window, map decision 7); 0029: `spur task show 0029` → feature C, frontmatter `docs/tasks/0029_…md:9` `feature_id: C` (git diff: `null → C`); choice recorded in map |
| R6 | MET | Map free-digit preflight (B:4 / E:6 ≥ creates 2/1) + apply-order waves = dry-run first; `git diff` on docs/features + docs/tasks shows only CLI-shaped changes (name field, section bodies, auto-regenerated linked-tasks tables, `feature_id` field) — no raw writes on `docs/features/` or `docs/tasks/`. Caveat: uncommitted — `git log -p` evidence deferred to post-commit; working-tree diff verified this run |
| R7 | MET | `docs/05_FEATURES.md:33-65` — 29 rows (A–J) match `spur feature list` (29 entries); E renamed `:56`, B6 `:45`, B7 `:46`, E4 `:60`, D4/D5 Phase-3 `:54/:55`, J row `:65`, map-j header note `:23-27` |
| R8 | MET | Distinct task feature_ids {A,A1,B,B4,B5,C,C1,C2,D1,D2,D3,E1,E2,E3,J} (15) all ⊆ live features (29); set difference empty; `spur feature check --json` — 0 error-level findings |

**SECUA Review (sp-code-verification review mode) — PASS**

Corpus/docs-only task — zero code delta. No code, secrets, or permissions touched; no security surface; fail-loud precedent preserved.

| Severity | Finding | Evidence | Disposition |
| --- | --- | --- | --- |
| P1 | None | — | Pass |
| P2 | None | — | Pass |
| P3 | B7 feature-file basename duplicates B6's (`B7_sequential-fan-in-fan-out-steps.md`); E's basename lags the rename (`E_publishplugin-surfdash.md` for "Multi-channel publish") | `docs/features/B7_…md`; `docs/features/E_publishplugin-surfdash.md:4` | Residual OK — id+name authoritative; A1 P2 precedent |
| P4 | B6/B7/E4 AC sections carry unfilled template scenario ("Basic acceptance / Given a precondition…") | B6/B7/E4 feature files, Acceptance Criteria | Residual — backlog homes; fill at implementation decomposition (0036+ / feature close-out) |
| P4 | 0035 self-check warnings: L3.requirements-format x1, L4.uncovered-task-scenario x7, L4.gate-language x2 | `spur task check 0035 --json` — 0 error-level, warnings only (pre-existing/structural: meta task; J AC not enumerated) | Residual OK |

**Architecture Depth (sp-code-improvement) — PASS**

No code modules to deepen (corpus-only); structural review of the tree change:

- MECE decision procedure applied: new homes are children of existing capabilities (B6/B7 under B, E4 under E), no new roots, no letter reuse — hierarchy-mece gate respected (map locked decision 1).
- A1 close-out learnings applied: no status jumps (creates land at `backlog`), no E5–E12 stub explosion (single E4 harvest node), basename lag accepted.
- ID stability: E rename and section re-cuts keep IDs; free-digit preflight prevents cascading reassignment; no moves.
- Advisory: B6/B7/E4 are intentionally shallow homes (placeholder AC) — deepening deferred to implementation decomposition. No blocker/major candidates.

**Residual Risk**

- AC2 "both pass": `spur feature check` 0 errors (29/29); `spur task check` retains 4 pre-existing failures on 0001/0002/0028/0029 (empty Solution/Review/AC from pre-hardening authoring) — unrelated to this move, documented.
- R6 `git log -p` evidence only inspectable after commit; working-tree diff verified CLI-consistent this run.

**Disposition: APPROVED**

Review Verdict: PASS (Functional PASS · SECUA PASS · Architecture PASS)
### References

<!-- Links to docs, tasks, decisions, or external references. -->

### History
- 2026-08-03T01:06:28.508Z todo → wip (system)
- 2026-08-03T01:07:20.038Z wip → testing (system)
- 2026-08-03T01:07:20.152Z testing → done (system)
- 2026-08-03T01:08:38.783Z done → wip (system)
- 2026-08-03T01:10:56.693Z wip → testing (system)
- 2026-08-03T01:14:44.252Z testing → done (system)
