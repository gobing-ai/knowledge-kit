---
schema_version: 1
name: Run Smart SEO workflow with validated narratives and terminal outcomes
status: todo
template: feature-impl
created_at: 2026-10-15T04:45:13.288Z
updated_at: "2026-10-15T05:05:02.202Z"
feature_id: G9
priority: P2
tags:
  - seo
  - geo
estimate_hours: 8

dependencies: ["0282", "0283", "0284"]
---

## 0285. Run Smart SEO workflow with validated narratives and terminal outcomes

### Background

Accepted design: docs/design/kk-smart-seo.md; vendor snapshot 55a184a3b0d09565a4c84268f725a47784e62528 reviewed in docs/plans/2026-10-14-smart-seo-vendor-review.md. Vendor code is reference-only. No Python, new dependency, direct provider client, site mutation or undocumented scope expansion.

Implements: R8 — Narrative claims resolve to recorded facts before final output; R9 — Workflow stages stop or degrade according to their recorded outcomes.

Verified premises: plugins/kk/workflows/kk-storm-research.yaml:24 uses the shipped state-machine workflow format; apps/cli/src/stage.ts:79 explains the captured stage output behavior; plugins/kk/scripts/itc-stages.ts:1 is the existing narrative/stage sibling pattern, not a reusable SEO schema.

Dependencies: Produce reproducible SEO assessments and stable prioritized reports offline; Assess SEO meaning through typed Spur catalogs with honest fallbacks; Enrich audits with separate lab field and imported query evidence. Predecessor SEO stage artifacts are accepted design, not existing code; use the stated contracts once those tasks land.

**Refine corrections (2026-10-14)**

- Pointer-backed arbitrary prose was claimed fully validated → pointers do not establish sentence truth → replace with strict fact/action/limit template selection and deterministic rendering, rejecting text/unknown keys.
- Workflow preflight conflicted with earlier collection-only use → catalogs arrive in 0283 → enable require_decisions=true only for integrated workflow and isolate fixture contracts.
- Cancellation assumed inherited signals → runStage uses spawnSync with captured pipes → require actual workflow-to-grandchild cancellation proof and repair the existing seam if necessary.
- Stage ownership and generic Plan obscured integration → 0282/0283/0284 own their behavior → preserve payload contracts and explicitly verify required versus optional outcomes and report atomicity.

Current-tree audit: no Smart SEO runtime files are present; all local requirements remain valid planned work. One current main worktree and no wip tasks were observed at kickoff. Bun 1.4.3 and Biome 2.5.15 match package/lock/tool pins; Bare-shell Spur initially reported 0.4.4. Freshness inspection confirmed bun-global Spur 0.4.6 equals npm latest and Superskill 0.3.37 equals npm latest; final writes/checks use the explicit bun-global Spur executable because PATH contains shadow copies (point-in-time evidence, no new pins). Implementation step 0 must recheck tool/environment and ownership drift. External-source dates are evidence, not a guarantee that a provider account is enabled.

### Requirements

- [ ] R1. Implement bounded optional narrative schema, fact/action JSON-pointer references and digest validation before final materialization; reject unsupported claims and emit a labeled deterministic summary on absent/invalid/failed narrative.
- [ ] R2. Compose preflight, collection, checks, enrichment, judgments, scoring, one narrative action and report through existing stage run actions; enforce predecessor identity, atomic outputs, required failures, partial outcomes and cancellation without a new workflow engine.

### Acceptance Criteria

- [ ] AC1 — Narrative claims resolve to recorded facts before final output (req: R1)
- [ ] AC2 — Workflow stages stop or degrade according to their recorded outcomes (req: R2)

```gherkin
Feature: Run Smart SEO workflow with validated narratives and terminal outcomes

  Scenario: AC1 — Narrative claims resolve to recorded facts before final output (req: R1)
    Given audit facts and an optional agent-authored structured narrative
    When final JSON and Markdown reports are materialized
    Then every claim reference resolves to its fact or action and invalid claims cannot enter the final report
    And absent narrative yields a labeled deterministic report with coverage and limits


  Scenario: AC2 — Workflow stages stop or degrade according to their recorded outcomes (req: R2)
    Given kk-smart-seo and a unique run workspace
    When preflight, collection, checks, optional enrichment, judgments, narrative and reporting execute
    Then each stage consumes validated predecessor artifacts and writes atomic run-bound outputs
    And required-stage errors reach failed while optional unavailable evidence yields a partial report
    And cancellation prevents further network and decision dispatch

```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-15T05:03:37.529Z

Closed by ready refinement (2026-10-14): design §13 and the refined handoff close the identified seam decisions. Owner is this WBS for its slice; later integration belongs to 0285 and installed acceptance to 0286. Existing deferred scope in §1 remains deferred to separate operator intake. No issue was dropped and no task merge/link/cancellation was authorized.

### Design

Chosen approach: native KK stage slice, per §3–4, §9 of the satellite.

Frozen decisions: One bounded narrative attempt with deterministic fallback; no revision loop. Native stage calls consume validated options-file paths instead of shell-interpolated URLs. iterationBound=12; failureStates=[failed]; done/partial describe assessment completeness. Preserve underlying stage errors and workflow cancellation; no scheduler/Board surface.

Files owned: plugins/kk/workflows/kk-smart-seo.yaml; plugins/kk/scripts/seo-stages.ts, seo-report.ts; plugins/kk/tests/smart-seo-workflow.test.ts and fixtures; docs/04_DESIGN.md.

Verification: validate YAML using spur workflow validate, then run fixture workflow end to end with no live network/maker. Verify required failure, optional unavailable evidence, empty site, invalid narrative IDs/pointers/numbers/digests, workspace collision, wrong predecessor hash, literal shell metacharacters in path arguments, cancel during request/decision and report atomicity. Assert no site-mutating or publishing step.

Rejected alternatives: wrapping vendor Python, adding dependency/service abstractions or separating tests/docs from this behavior; each expands runtime or ceremony without improving this slice. Out of scope: all deferred capabilities in design §1.

Execution budget: 8h estimated; preserve partial artifacts at budget boundary and resume from current tree, never invent replacement APIs. requireDiff: production stage/catalog/skill plus its behavior checks and same-change docs.

Refined handoff: Consume the immutable 0281 envelopes, 0282 audit/report schema, 0283 decision ledger and 0284 enrichment outcomes. Own workflow YAML, catalog-required workflow preflight, typed narrative selection validation and report terminal status integration; leave prior stage semantics and score ownership intact. Narrative schema is exactly design §9: allow only summary/priorities/limits headings, fact/action/limit templates and audit.json pointers to approved matching target collections/types. Reject unknown keys/text/prototype paths/stale digest or mismatched target; reject the entire narrative, then use deterministic fallback. Numeric values/units and remediation text originate only in validated audit records. Add apps/cli/src/stage.ts and its existing tests to conditional ownership only if real cancellation proves its synchronous child seam insufficient; preserve alias, output and exit contracts.

Shared-file protocol: implement sequentially in frozen order 0281, 0282, 0283, 0284, 0285, 0286. Change only this slice's registration/payload adapters; preserve predecessor tests and exports. Shared docs/04_DESIGN.md edits describe only shipped behavior. Recheck worktrees/wip ownership before writing; if another worker appears, coordinate rather than revert its edits.

### Plan

- [ ] Step 0: Recheck current task contract, cited source files, Bun/tool pins, worktrees/wip ownership and completed predecessor artifact interfaces before editing; preserve unrelated working-tree changes.
- [ ] (R2) Validate all predecessor schemas/digests; compose eight stages plus terminal states using quoted environment data, resolved workspace binding and require_decisions=true workflow preflight; verify iterationBound=12 and failureStates=[failed].
- [ ] (R1) Implement strict narrative template/reference schema, approved pointer/type validation and deterministic rendering from immutable audit facts/actions/limits; persist rejection diagnostics and labeled fallback for absent/failed/invalid agent output.
- [ ] (R1,R2) Wire one fresh agent.run attempt with timeoutMs=120000, answerFile and action-level onError=continue; unconditional report edge must materialize deterministic output on failure without permitting failed required stages to continue.
- [ ] (R2) Exercise actual fixture workflow cancellation through kk stage run to sockets/decision grandchildren; repair existing stage subprocess signal forwarding only if needed, extending apps/cli/tests/stage.test.ts and commands/stage.test.ts to preserve captured output/aliases/exit status.
- [ ] (R1,R2) Validate YAML and run plugins/kk/tests/smart-seo-workflow.test.ts with fixture network/makers forbidden; cover all required failures, empty/partial evidence, malformed narrative/template/pointer/digest, literal paths, collision, report status and atomic writes.
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
- Current premises: plugins/kk/workflows/kk-storm-research.yaml:24; apps/cli/src/stage.ts:79; plugins/kk/scripts/itc-stages.ts:1; /Users/robin/xprojects/spur-new/packages/app/src/workflow/actions/agent-run.ts:122.
- Predecessors: 0282, 0283, 0284; dependent responsibilities are named in Design.
- Batch audit/checklist: docs/plans/2026-10-14-g9-ready-refinement.md; machine evidence: .spur/memory/evidence/g9-refine-ready-20261014-01/report.json.
- Concurrency at kickoff: git worktree list showed only current main; spur task list --status wip --json returned [].

### History
