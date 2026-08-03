---
template: meta
schema_version: 1
name: "Author ADR-007 — reposition knowledge-kit as an ingest-create-publish platform"
description: ""
status: done
type: meta
profile: standard
feature_id: J
parent_wbs: null
priority: P2
tags: ["meta"]
dependencies: []
created_at: "2026-08-03T00:11:44.427Z"
updated_at: "2026-08-03T03:28:31.725Z"
---

## 0030. Author ADR-007 — reposition knowledge-kit as an ingest-create-publish platform

### Background
`wayfinder:task` — authoring, on map **J**. **Frontier ticket: unblocked.**

**Question:** How is the repositioning recorded in `docs/00_ADR.md` such that every derived doc has
a single authority to point at?

`ADR-006` (2026-07-23) defines knowledge-kit as a plugin-based knowledge platform running
ingest → generate → publish. It is not wrong — it is too narrow in two specific ways, and silent on
two mechanisms the delivered work now depends on. The four operator calls of 2026-08-02 are settled
(map **J** → Notes → Decisions so far); this ticket records them as authority, it does not reopen them.

Everything else on this map derives from the outcome. Per `99` the conflict rule is *fix authority
first* — so this runs before the PRD re-cut and before any derived-doc sweep.

**Open sub-question this ticket must settle:** whether ADR-006 is superseded outright or amended
with ADR-007 layered on top. Lean amend-plus-new-ADR — ADR-006's substrate decisions (plugin
manifest, data contract, `kk invoke`, registry discovery) all survive; only the product framing and
the `generate(Doc[])` signature change. Read the full ADR-006 text before choosing.
### Requirements
- **R1** — ADR-007 states the product decision: knowledge-kit is a spur-orchestrated
  **ingest → create → publish** platform. Creation and publishing are first-class, not downstream
  consequences of ingestion.
- **R2** — ADR-007 states the name is **historical** and deliberately retained; renaming was
  considered and rejected on migration cost against zero capability gain.
- **R3** — ADR-007 records **ingestion as optional**: the generator contract widens from
  `generate(Doc[]) → Content` to accept a `Brief` as an alternative input, making topic → article a
  first-class pipeline. Mechanism is delegated to `03`/`04` (ticket 0032), not specified here.
- **R4** — ADR-007 records **fan-in/fan-out as owned by `kk` and executed sequentially**, with the
  supporting finding: `type: parallel` in `@gobing-ai/ts-dual-workflow-engine@0.4.14` is a schema
  stub with no executor (`src/types.ts:77`, `src/schema.ts:100`, schema JSON only). Engine-level
  concurrency is explicitly deferred, not rejected.
- **R5** — ADR-007 records **partial-success publish semantics with a non-zero exit**, and
  reconciles this against the fail-loud hardening of tasks 0023/0025 and the `postsurfing`
  always-exit-0 anti-pattern from audit 0002 — stating why partial success is not a regression.
- **R6** — ADR-007 states its relationship to ADR-006 explicitly (amends / supersedes-in-part /
  supersedes), and ADR-006 carries a pointer forward so a reader landing there is not misled.
- **R7** — ADR-001..005 are stated as unaffected. This is a product decision, not a toolchain change.
- **R8** — Frontmatter contract per `99` §4.3 is honoured: `version`, `updated_at` bumped.
### Acceptance Criteria
- [x] `docs/00_ADR.md` contains an ADR-007 entry dated 2026-08-02 or later, outcome-shaped title,
      following the `99` §6.1 ADR template (Status / Decision / Rationale / Consequences).
- [x] Each of R1–R5 is traceable to a named sentence in ADR-007 — not implied.
- [x] ADR-006 carries a forward pointer; a reader starting at ADR-006 cannot conclude that
      ingestion is mandatory or that publishing is deferred.
- [x] The engine-stub finding is cited with file:line evidence, so a future reader can re-verify
      it against a newer engine version rather than trusting the claim.
- [x] `docs/00_ADR.md` frontmatter `version` and `updated_at` are bumped.
- [x] [docs-only] The repositioning has an authority decision

- [x] Map **J** → Notes → *Decisions so far* gains one line: WBS + title + one-line gist.
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design

Authored `ADR-007` in `docs/00_ADR.md` per `99` §6.1 as an amendment to `ADR-006`, preserving substrate decisions (plugin manifest, data contract, `kk invoke`, discovery) while repositioning product scope to co-equal ingest → create → publish.

### Plan

- [x] Read `ADR-006`, `docs/99_PROJECT_CONSTITUTION.md` §6.1, and Map J decisions.
- [x] Draft `ADR-007` in `docs/00_ADR.md` covering R1–R7 with traceable sentences and engine stub line references.
- [x] Update `ADR-006` status and add forward pointer amendment banner.
- [x] Bump `docs/00_ADR.md` frontmatter `version` (1.5.0) and `updated_at` (2026-08-02).
- [x] Update Map J `Decisions so far` section with task 0030 summary entry.
- [x] Populate task 0030 documentation sections, run verification, and record pipeline results.

### Solution

- `docs/00_ADR.md:197`: Added ADR-007 entry (R1–R7 explicit statements, file:line citations), updated `docs/00_ADR.md:118` ADR-006 status and amendment forward pointer, bumped frontmatter version (1.5.0) and updated_at (2026-08-02).
- `docs/features/J_reposition-knowledge-kit-as-an-ingest-create-publish-platform-wayfinder-map.md:127`: Added task 0030 decision entry under `Decisions so far`.

### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | ADR-007 states product decision: knowledge-kit is a spur-orchestrated ingest -> create -> publish platform (docs/00_ADR.md:200-201). |
| R2 | MET | ADR-007 states name is historical and deliberately retained (docs/00_ADR.md:202). |
| R3 | MET | ADR-007 records ingestion as optional and generator contract widens to Brief \| Doc[] (docs/00_ADR.md:203). |
| R4 | MET | ADR-007 records sequential fan-in/fan-out owned by kk and cites engine parallel stub in ts-dual-workflow-engine@0.4.14 (docs/00_ADR.md:204-205). |
| R5 | MET | ADR-007 records partial-success publish semantics with non-zero exit code (docs/00_ADR.md:206). |
| R6 | MET | ADR-007 explicitly states relationship to ADR-006 and ADR-006 carries a forward pointer (docs/00_ADR.md:121, 191, 207). |
| R7 | MET | ADR-007 states ADR-001..005 are unaffected (docs/00_ADR.md:207). |
| R8 | MET | Frontmatter contract honoured: version bumped to 1.5.0 and updated_at to 2026-08-02 (docs/00_ADR.md:6-8). |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| ADR-007 entry created following 99 §6.1 template | MET |  | docs/00_ADR.md:197-211 |
| Each of R1-R5 traceable to named sentence | MET |  | docs/00_ADR.md:200-206 |
| ADR-006 carries forward pointer | MET |  | docs/00_ADR.md:121, 191 |
| Engine-stub finding cited with file:line evidence | MET |  | docs/00_ADR.md:205 |
| docs/00_ADR.md frontmatter version and updated_at bumped | MET |  | docs/00_ADR.md:6-8 |
| Map J Decisions so far updated | MET |  | docs/features/J_reposition-knowledge-kit-as-an-ingest-create-publish-platform-wayfinder-map.md:127 |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review

| Severity | Finding | Evidence | Resolution / Residual Risk |
| --- | --- | --- | --- |
| P1 | None | N/A | No security or critical flaws |
| P2 | None | N/A | No architectural conflicts |
| P3 | Engine parallel stub dependency | `@gobing-ai/ts-dual-workflow-engine@0.4.14` `src/types.ts:77` | Grounded in source findings; sequential fan-out owned by `kk` avoids dependency |
| P4 | None | N/A | No style or minor cleanup issues |

Disposition: PASS

### References

<!-- Links to docs, tasks, decisions, or external references. -->

### History
- 2026-08-03T00:19:32.425Z todo → wip (system)
- 2026-08-03T00:20:28.512Z wip → testing (system)
- 2026-08-03T00:20:30.009Z testing → done (system)
