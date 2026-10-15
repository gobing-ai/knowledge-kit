---
schema_version: 1
name: Ship one Smart SEO skill and prove clean installed workflow use
status: todo
template: feature-impl
created_at: 2026-10-15T04:45:13.288Z
updated_at: "2026-10-15T05:05:03.218Z"
feature_id: G9
priority: P2
tags:
  - seo
  - geo
estimate_hours: 6

dependencies: ["0285"]
---

## 0286. Ship one Smart SEO skill and prove clean installed workflow use

### Background

Accepted design: docs/design/kk-smart-seo.md; vendor snapshot 55a184a3b0d09565a4c84268f725a47784e62528 reviewed in docs/plans/2026-10-14-smart-seo-vendor-review.md. Vendor code is reference-only. No Python, new dependency, direct provider client, site mutation or undocumented scope expansion.

Implements: R10 — One SEO skill operates and explains the evidence-grounded workflow; R11 — Installed audit assets work without checkout or vendor access.

Verified premises: scripts/bundle-plugins.ts:1 stages plugin distribution; apps/cli/src/stage.ts:61 owns source/install stage resolution; plugins/kk/scripts/itc-stages.ts:55 states builtin-only helper distribution. Ancestor-resolved linkedom/fast-xml-parser are not declared KK dependencies and must not be relied on.

Dependencies: Run Smart SEO workflow with validated narratives and terminal outcomes. Predecessor SEO stage artifacts are accepted design, not existing code; use the stated contracts once those tasks land.

**Refine corrections (2026-10-14)**

- Packed fixture execution implicitly depended on bundled test data → bundle-plugins excludes tests → copy fixture input into the temporary consumer project, while resolving runtime assets only from its packed installation.
- All-in-one narrative guidance implied free-prose report acceptance → 0285 now accepts deterministic templates → document validated report selection separately from advisory consultation.
- Attribution ownership was duplicated → 0281 creates the MIT attribution → review/extend its existing file rather than re-own or replace it.
- Generic Plan omitted consumer isolation and lifecycle detail → readiness needs observable installed behavior → add R1/R2-mapped packed workflow, catalog preservation and capability quality checks.

Current-tree audit: no Smart SEO runtime files are present; all local requirements remain valid planned work. One current main worktree and no wip tasks were observed at kickoff. Bun 1.4.3 and Biome 2.5.15 match package/lock/tool pins; Bare-shell Spur initially reported 0.4.4. Freshness inspection confirmed bun-global Spur 0.4.6 equals npm latest and Superskill 0.3.37 equals npm latest; final writes/checks use the explicit bun-global Spur executable because PATH contains shadow copies (point-in-time evidence, no new pins). Implementation step 0 must recheck tool/environment and ownership drift. External-source dates are evidence, not a guarantee that a provider account is enabled.

### Requirements

- [ ] R1. Deliver one all-in-one SEO/GEO skill for running, reviewing and interpreting live/saved audits and producing action plans; document sources, heuristic/measurement limits, crawler purpose and offline rescoring with no autonomous site mutation.
- [ ] R2. Prove workflow/helpers/catalogs/references resolve from a separately packed installation in unrelated cwd with vendors inaccessible; document and exercise supported catalog registration without overwriting existing paths/makers; retain existing workflow behavior and update surface/status docs.

### Acceptance Criteria

- [ ] AC1 — One SEO skill operates and explains the evidence-grounded workflow (req: R1)
- [ ] AC2 — Installed audit assets work without checkout or vendor access (req: R2)

```gherkin
Feature: Ship one Smart SEO skill and prove clean installed workflow use

  Scenario: AC1 — One SEO skill operates and explains the evidence-grounded workflow (req: R1)
    Given the installed smart-seo skill and either an audit URL or saved audit
    When an agent follows the skill
    Then it can run the workflow, review evidence, explain SEO and GEO findings and produce a prioritized action plan through one entry
    And it labels heuristics and separates search, training and user-triggered crawler policies
    And it does not mutate sites or promise rankings or citations


  Scenario: AC2 — Installed audit assets work without checkout or vendor access (req: R2)
    Given a separately packed KK installation in an unrelated working directory
    When the workflow and skill resolve their stages and decision catalogs
    Then all helpers, references and catalogs are available without ancestor dependencies, absolute developer paths or vendors access
    And unrelated KK workflows and decision catalogs retain their current behavior

```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-15T05:03:40.040Z

Closed by ready refinement (2026-10-14): design §13 and the refined handoff close the identified seam decisions. Owner is this WBS for its slice; later integration belongs to 0285 and installed acceptance to 0286. Existing deferred scope in §1 remains deferred to separate operator intake. No issue was dropped and no task merge/link/cancellation was authorized.

### Design

Chosen approach: native KK stage slice, per §2, §9–11 of the satellite.

Frozen decisions: Use one fat smart-seo skill, references for detail and existing Superskill lifecycle validation/evaluation. Prefer existing package copy rules; extend only if acceptance demonstrates a missing asset. Consumer setup is an explicit catalog-path addition preserving existing config; audit preflight does not mutate user-global configuration. No new slash command/subagent.

Files owned: plugins/kk/skills/smart-seo/SKILL.md and references; plugins/kk/references/smart-seo-attribution.md; apps/cli/tests/smart-seo-installed.test.ts; package/bundle tests only if existing copy rules need extension; docs/04_DESIGN.md, docs/05_FEATURES.md.

Verification: run Superskill skill validate/evaluate on the source capability and check body budget; package/install in temp cwd, perform documented catalog setup and load decision status/show under offline maker, execute fixture workflow and resolve all references with no vendors/ancestor node_modules. Run existing stage compatibility and distribution regressions, final lint/tests/build/rules and feature verification.

Rejected alternatives: wrapping vendor Python, adding dependency/service abstractions or separating tests/docs from this behavior; each expands runtime or ceremony without improving this slice. Out of scope: all deferred capabilities in design §1.

Execution budget: 6h estimated; preserve partial artifacts at budget boundary and resume from current tree, never invent replacement APIs. requireDiff: production stage/catalog/skill plus its behavior checks and same-change docs.

Refined handoff: Consume 0285 completed fixture workflow and §9 narrative schema. Own one smart-seo skill/references and installed acceptance; review 0281 attribution without overwriting it. Keep documented direct collection, full-workflow registration, saved revision scoring and advisory consultation distinct. Copy test fixture input to a temporary unrelated consumer cwd; tests are intentionally not shipped. Resolve CLI/workflow/helpers/catalogs/references exclusively from separately packed KK installation, deny checkout/vendor/ancestor access and run fixture workflow with isolated offline maker. Exercise explicit project decisions.paths addition while preserving unrelated paths and maker settings. Extend bundle rules only if the acceptance test proves a runtime asset missing. No production fixture fallback or absolute developer path.

Shared-file protocol: implement sequentially in frozen order 0281, 0282, 0283, 0284, 0285, 0286. Change only this slice's registration/payload adapters; preserve predecessor tests and exports. Shared docs/04_DESIGN.md edits describe only shipped behavior. Recheck worktrees/wip ownership before writing; if another worker appears, coordinate rather than revert its edits.

### Plan

- [ ] Step 0: Recheck current task contract, cited source files, Bun/tool pins, worktrees/wip ownership and completed predecessor artifact interfaces before editing; preserve unrelated working-tree changes.
- [ ] (R1) Author one smart-seo SKILL.md and the four declared references from implemented stage/workflow contracts; cover sources/unknowns, exact www scope, strict narrative templates, conservative optional evidence and immutable offline revisions.
- [ ] (R1) Review existing 0281 MIT attribution, verify every local reference and body budget, and run installed Superskill skill validation/evaluation using noun help to select current verbs.
- [ ] (R2) In apps/cli/tests/smart-seo-installed.test.ts, pack/install into an isolated directory and copy fixture inputs into an unrelated consumer cwd; document/add project catalog path without replacing existing paths or makers.
- [ ] (R2) Resolve/load all runtime catalogs/assets and execute the real installed fixture workflow with checkout/vendor/ancestor dependencies inaccessible; test unrelated decision/workflow behavior and existing stage/package regressions. Change packaging only if a demonstrated missing asset requires it.
- [ ] (R1,R2) Update surface docs and feature status only after real task/feature verification PASS; record supported setup, evidence limits and operator-run live acceptance as remaining validation.
- [ ] Update docs/04_DESIGN.md in the same change for this shipped slice; preserve accepted/deferred scope and source checked-at dates.
- [ ] Run project lint, tests, build and rule gates; complete task-pipeline review and traceable requirement/AC verification before recording done. Never waive an upstream implementation dependency because refinement passed.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Feature G9: docs/features/G9_kk-smart-seo-evidence-grounded-seo-and-geo-audits.md
- Accepted design: docs/design/kk-smart-seo.md (§13 is the refined handoff). ADR-039: docs/00_ADR.md:1364.
- Vendor review: docs/plans/2026-10-14-smart-seo-vendor-review.md. Snapshot verified unchanged.
- Current premises: scripts/bundle-plugins.ts:37; apps/cli/src/stage.ts:45; plugins/kk/scripts/itc-stages.ts:55; apps/cli/tests/package.test.ts; docs/design/kk-smart-seo.md.
- Predecessors: 0285; dependent responsibilities are named in Design.
- Batch audit/checklist: docs/plans/2026-10-14-g9-ready-refinement.md; machine evidence: .spur/memory/evidence/g9-refine-ready-20261014-01/report.json.
- Concurrency at kickoff: git worktree list showed only current main; spur task list --status wip --json returned [].

### History
