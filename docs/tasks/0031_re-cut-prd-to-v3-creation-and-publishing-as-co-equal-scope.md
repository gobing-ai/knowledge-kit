---
template: meta
schema_version: 1
name: "Re-cut PRD to v3 — creation and publishing as co-equal scope"
description: ""
status: done
type: meta
profile: standard
feature_id: J
parent_wbs: null
priority: P2
tags: ["meta"]
dependencies: ["0030"]
created_at: "2026-08-03T00:11:44.563Z"
updated_at: "2026-08-03T03:28:31.864Z"
---

## 0031. Re-cut PRD to v3 — creation and publishing as co-equal scope

### Background
`wayfinder:task` — authoring, on map **J**. Blocked on **0030** (ADR-007).

**Question:** What does `docs/01_PRD.md` say is in scope, out of scope, and deferred, once creation
and publishing are co-equal with knowledge management?

PRD v2.1.0 has three statements that contradict the repositioned canon:

1. **Publish multi-channel suite (E) sits under "Out of scope / deferred" as a Phase-2 item.** If
   publishing is co-equal, that deferral is a scope error, not a sequencing choice.
2. **The framework table states `ContentGeneratorPlugin: generate(Doc[]) → Content`** — the exact
   signature that forbids creation without ingestion.
3. **Goals are framed around "prove one reference vertical"** — a Phase-1 acceptance goal that B5
   already met. The goals section describes work that is finished.

Re-cutting scope forces a re-cut of phases: with publishing promoted, "Phase 2 — Depth" no longer
describes the remaining work. The phase table in `02_ROADMAP` derives from this ticket's output;
producing a coherent phase story is part of the work, not a follow-on.

**Not this ticket:** the feature tree (0035) and the `02`/`03`/`04`/`05` sweep (0036). This ticket
settles *what the scope is*; those propagate it.
### Requirements
- **R1** — `01_PRD` version bumps to **v3.0.0** (major: this changes scope, per `99` §6.2) with a
  header note pointing at ADR-007 as the governing decision.
- **R2** — **Product** and **Goals** are restated for the ingest → create → publish platform.
  Completed Phase-1 goals (reference vertical proven) move to a stated-as-achieved position rather
  than reading as open work.
- **R3** — The three-kind framework table is corrected: the generator row states input as
  `Doc[] | Brief`, and the table no longer implies ingestion is a required upstream step.
- **R4** — **Multi-channel publish is removed from "Out of scope / deferred"** and placed in scope,
  with its phase position stated.
- **R5** — Creation-from-brief is stated as in-scope with a named user-facing outcome
  (topic → published article without a prior ingest), so it is testable as scope rather than vibe.
- **R6** — "Out of scope / deferred" is re-derived, retaining: engine-level parallel execution,
  package rename, LLM wiki (**I**). Each carries a one-line reason.
- **R7** — Phases are re-cut so that every in-scope area lands in exactly one phase, and no phase
  describes finished work as current.
- **R8** — Users and Problem sections are checked against the widened scope and corrected if they
  describe only knowledge-management users.
### Acceptance Criteria
- [ ] `docs/01_PRD.md` frontmatter reads `version: 3.0.0` with `updated_at` bumped.
- [ ] No occurrence of `generate(Doc[]) → Content` as the sole generator signature remains.
- [ ] "Out of scope / deferred" contains no row promoting publish channels to Phase 2.
- [ ] Every row in the in-scope table names a phase, and every phase in `02_ROADMAP` has at least
      one in-scope row (checked after 0036 propagates; stated as the contract here).
- [ ] A reader can answer "can I run this to write an article about X with nothing ingested?" from
      the PRD alone, and the answer is yes.
- [x] [docs-only] Scope authority reflects co-equal publishing

- [ ] Map **J** → *Decisions so far* gains one line: WBS + title + gist.
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design

<!-- Approach and tradeoffs for process/docs/config changes. Keep this short. -->

### Plan

<!-- Ordered checklist. Fill before moving to todo/wip. -->

### Solution
- Updated `docs/01_PRD.md:1-102` to v3.0.0 per ADR-007:
  - Bumped version to 3.0.0 in `docs/01_PRD.md:6` with header note referencing ADR-007 (`docs/01_PRD.md:15`).
  - Restated Product (`docs/01_PRD.md:18-24`) and Goals (`docs/01_PRD.md:55-63`) to promote creation-from-brief and multi-channel publishing to co-equal scope alongside ingestion. Moved completed Phase-1 goals to an achieved state.
  - Updated framework table contract signature (`docs/01_PRD.md:27-39`) for generator to `generate(Doc[] | Brief) → Content` and clarified optional ingestion.
  - Removed multi-channel publish from "Out of scope / deferred" and placed it in scope (`docs/01_PRD.md:73-84`).
  - Explicitly stated creation-from-brief as in-scope with testable outcome (`docs/01_PRD.md:85`).
  - Re-derived out-of-scope / deferred table (`docs/01_PRD.md:87-95`) with reasons (engine-level parallel execution, package/binary rename, LLM wiki).
  - Re-cut phase structure and verified user (`docs/01_PRD.md:41-48`) and problem (`docs/01_PRD.md:49-54`) sections address creation + publishing users.
- Updated Map J (`docs/features/J_reposition-knowledge-kit-as-an-ingest-create-publish-platform-wayfinder-map.md:128`) under "Decisions so far" with task 0031 outcome summary.
### Testing
- Ran `bun run autofix && bun run spur-check`:
  - `bun run format`: 0 errors
  - `bun run typecheck`: clean across all 6 workspace packages
  - `bun run lint`: 0 errors (Biome 2.5.5)
  - `spur rule run --preset recommended-pre-check`: 30 rules passed
  - `bun test`: 77 unit tests passed across 14 files (99.49% functions, 97.37% lines coverage)
  - `spur rule run --preset recommended-post-check`: 2 rules passed (coverage gate >= 90% lines/funcs)
- Verification gate: PASS
### Review
| Priority | Category | Location | Finding | Disposition |
| --- | --- | --- | --- | --- |
| P1 | Critical | — | None | Resolved |
| P2 | High | — | None | Resolved |
| P3 | Medium | — | None | Resolved |
| P4 | Low | — | None | Resolved |

- **Summary of Findings:** No issues found across SECUA categories (Security, Error Handling, Correctness, Usability, Architecture). Changes align `docs/01_PRD.md` with ADR-007 and update Map J.
- **Residual Risk:** None. All automated quality gates (`bun run spur-check`) pass clean.
- **Disposition:** APPROVED
### References

<!-- Links to docs, tasks, decisions, or external references. -->

### History
- 2026-08-03T00:44:26.988Z todo → wip (system)
- 2026-08-03T00:44:31.246Z wip → testing (system)
- 2026-08-03T00:44:32.904Z testing → done (system)
