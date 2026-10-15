---
schema_version: 1
name: Produce reproducible SEO assessments and stable prioritized reports offline
status: todo
template: feature-impl
created_at: 2026-10-15T04:45:13.284Z
updated_at: "2026-10-15T05:04:59.078Z"
feature_id: G9
priority: P2
tags:
  - seo
  - geo
estimate_hours: 10

dependencies: ["0281"]
---

## 0282. Produce reproducible SEO assessments and stable prioritized reports offline

### Background

Accepted design: docs/design/kk-smart-seo.md; vendor snapshot 55a184a3b0d09565a4c84268f725a47784e62528 reviewed in docs/plans/2026-10-14-smart-seo-vendor-review.md. Vendor code is reference-only. No Python, new dependency, direct provider client, site mutation or undocumented scope expansion.

Implements: R4 — Technical findings and priorities remain reproducible from saved evidence; R12 — SEO and GEO advice reflects dated primary sources and measurement limits.

Verified premises: vendors/jev-seo/jevseo/checks.py:394 calls every absent finding passed; vendors/jev-seo/jevseo/score.py:329 ranks and renumbers actions; docs/design/kk-smart-seo.md:1 records the accepted unimplemented design rather than a shipped helper API.

Dependencies: Collect bounded public-site SEO facts with robots and network enforcement. Predecessor SEO stage artifacts are accepted design, not existing code; use the stated contracts once those tasks land.

**Refine corrections (2026-10-14)**

- Saved-artifact scoring omitted optional-stage absence semantics → 0283/0284 are downstream → freeze explicit not-assessed outcomes for standalone use, strict predecessors for integrated use.
- Offline rescoring promised reproducibility without an output contract → overwrites would destroy source evidence → freeze new revision directory argv, immutable source digests and clock exclusions.
- Narrative prose appeared deterministically verifiable → references cannot validate arbitrary assertions → retain only method-owned fact/action/limit templates in final report.
- Plan and shared report ownership were generic → parallel extensions could silently redefine scoring → freeze 0282 scoring ownership, typed extension seams and R-mapped tests.

Current-tree audit: no Smart SEO runtime files are present; all local requirements remain valid planned work. One current main worktree and no wip tasks were observed at kickoff. Bun 1.4.3 and Biome 2.5.15 match package/lock/tool pins; Bare-shell Spur initially reported 0.4.4. Freshness inspection confirmed bun-global Spur 0.4.6 equals npm latest and Superskill 0.3.37 equals npm latest; final writes/checks use the explicit bun-global Spur executable because PATH contains shadow copies (point-in-time evidence, no new pins). Implementation step 0 must recheck tool/environment and ownership drift. External-source dates are evidence, not a guarantee that a provider account is enabled.

### Requirements

- [ ] R1. Implement seo-check, seo-score and the deterministic seo-report path from validated saved facts; account for every vendor rule disposition and emit explicit pass/fail/unknown/not-applicable rows, stable rule/subject IDs, null empty scores and coverage denominators.
- [ ] R2. Apply dated SEO/GEO sources, correct FAQ retirement and crawler purposes, keep heuristics out of eligibility claims, and separate observed indexing signals from verified search/citation visibility.

### Acceptance Criteria

- [ ] AC1 — Technical findings and priorities remain reproducible from saved evidence (req: R1)
- [ ] AC2 — SEO and GEO advice reflects dated primary sources and measurement limits (req: R2)

```gherkin
Feature: Produce reproducible SEO assessments and stable prioritized reports offline

  Scenario: AC1 — Technical findings and priorities remain reproducible from saved evidence (req: R1)
    Given collected page facts and a versioned rule method
    When checks and prioritization run offline
    Then each applicable check is pass, fail, unknown or not-applicable with source and evidence references
    And no eligible evidence produces null scores rather than a clean score
    And findings keep stable subject-based identifiers across sorting and rescoring


  Scenario: AC2 — SEO and GEO advice reflects dated primary sources and measurement limits (req: R2)
    Given the reviewed vendor and the recorded official source registry
    When the report proposes SEO or GEO work
    Then retired FAQ rich-result advice and mandatory llms.txt advice are absent
    And editorial quality is not presented as measured answer-engine visibility
    And snippet controls, indexing observations and actual visibility evidence remain distinct
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-15T05:03:32.753Z

Closed by ready refinement (2026-10-14): design §13 and the refined handoff close the identified seam decisions. Owner is this WBS for its slice; later integration belongs to 0285 and installed acceptance to 0286. Existing deferred scope in §1 remains deferred to separate operator intake. No issue was dropped and no task merge/link/cancellation was authorized.

### Design

Chosen approach: native KK stage slice, per §4, §6, §9, §12 of the satellite.

Frozen decisions: Replace implicit clean scores and ordinal IDs with explicit assessment rows, technical pass ratio plus coverage and SHA-based subject identities. Deterministic report.json/report.md are projections of audit.json; semantic arrays may be empty before the judgment slice exists. Reject all-invalid artifacts, retain optional unassessed areas. No blended overall grade or predicted impact.

Files owned: plugins/kk/scripts/seo-rules.ts, seo-report.ts, seo-stages.ts; plugins/kk/tests/smart-seo-analysis.test.ts and fixtures; docs/04_DESIGN.md.

Verification: fixtures cover no HTML pages, no eligible rules, uncertain robots/canonical signals, sampled orphan wording, score denominator/null propagation, stable IDs under sort/rescore, unsupported schema checks, FAQ retirement, deliberate training-bot blocks, Markdown escaping and atomic report failure. Rescore performs zero network or decision calls.

Rejected alternatives: wrapping vendor Python, adding dependency/service abstractions or separating tests/docs from this behavior; each expands runtime or ceremony without improving this slice. Out of scope: all deferred capabilities in design §1.

Execution budget: 10h estimated; preserve partial artifacts at budget boundary and resume from current tree, never invent replacement APIs. requireDiff: production stage/catalog/skill plus its behavior checks and same-change docs.

Refined handoff: Consume 0281 envelope/page facts without redefining network policy. Own the exhaustive rule disposition registry, assessment/action identity and audit/report schemas in design §6/13. Initial workflow scoring is seo-score <work-dir>, refusing an existing audit. Offline rescoring requires seo-score <saved-work-dir> <new-revision-dir>; copy validated bounded inputs and original runId plus new revisionId into the absent/empty destination, leave saved inputs unchanged, and run seo-report <revision-dir> on local artifacts. Optional judgments/performance/visibility absent in standalone use become typed not-assessed sections, never successes; malformed present sections are errors. 0283 and 0284 extend only their payloads using these validators; 0285 owns narrative acceptance and final workflow status integration. Final audit facts carry scalar value/unit/source; action/limit collections provide typed narrative targets. No free-prose narrative is accepted by this slice.

Shared-file protocol: implement sequentially in frozen order 0281, 0282, 0283, 0284, 0285, 0286. Change only this slice's registration/payload adapters; preserve predecessor tests and exports. Shared docs/04_DESIGN.md edits describe only shipped behavior. Recheck worktrees/wip ownership before writing; if another worker appears, coordinate rather than revert its edits.

### Plan

- [ ] Step 0: Recheck current task contract, cited source files, Bun/tool pins, worktrees/wip ownership and completed predecessor artifact interfaces before editing; preserve unrelated working-tree changes.
- [ ] (R1) Consume 0281 minimal fixture; freeze strict rule/subject assessment, audit, action, limit and optional-stage outcome validators in seo-rules.ts/seo-report.ts and validate upstream envelopes.
- [ ] (R1,R2) Implement every native/adapted/informational/deferred rule disposition, sampled-scope wording and dated source metadata; retain explicit unknown/not-applicable and intent-dependent signals.
- [ ] (R1) Implement technical ratio/coverage, semantic not-assessed defaults, stable action IDs/order, deterministic JSON/escaped Markdown and immutable revision-based offline scoring.
- [ ] (R1,R2) In plugins/kk/tests/smart-seo-analysis.test.ts, verify all dispositions, null denominators, optional absence versus corruption, source-date/FAQ/crawler limits, stable IDs and rescore source preservation with network/maker dispatch forbidden.
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
- Current premises: vendors/jev-seo/jevseo/checks.py:394; vendors/jev-seo/jevseo/score.py:329; docs/plans/2026-10-14-smart-seo-vendor-review.md; docs/00_ADR.md:1364.
- Predecessors: 0281; dependent responsibilities are named in Design.
- Batch audit/checklist: docs/plans/2026-10-14-g9-ready-refinement.md; machine evidence: .spur/memory/evidence/g9-refine-ready-20261014-01/report.json.
- Concurrency at kickoff: git worktree list showed only current main; spur task list --status wip --json returned [].

### History
