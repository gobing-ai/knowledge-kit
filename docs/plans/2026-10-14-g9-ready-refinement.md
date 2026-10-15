# G9 implement-ready refinement

Run g9-refine-ready-20261014-01; depth=ready; inline/auto; verdict **clean**. Frozen set: 0281 → 0282 → 0283 → 0284 → 0285 → 0286. Six tasks refined; 24 corrections; no dropped issues, exclusions, cancellations, merges or status transitions. All remain todo/P2 with existing estimates (50 hours total). Readiness is specification readiness; upstream implementation dependencies remain enforced.

| WBS | Outcome | Corrections | Dropped | Status | Failed checklist IDs |
| --- | --- | --- | --- | --- | --- |
| 0281 | refined | 4 | 0 | todo → todo | none |
| 0282 | refined | 4 | 0 | todo → todo | none |
| 0283 | refined | 4 | 0 | todo → todo | none |
| 0284 | refined | 4 | 0 | todo → todo | none |
| 0285 | refined | 4 | 0 | todo → todo | none |
| 0286 | refined | 4 | 0 | todo → todo | none |

The initial generic plans now map to local requirements and observable tests. The design satellite §13 freezes shared artifact/optional-stage handoffs, direct collection versus workflow catalog preflight, exact host scope, revision-based offline scoring, remaining choice vocabularies, provider attempt/import rules, installed fixture isolation and actual subprocess cancellation verification. Narrative selection uses fixed templates and validated references; arbitrary prose is outside the automatically validated report. ADR-039 and product scope remain unchanged; docs/04_DESIGN.md already points to the same satellite, so no index fact changed (constitution §5 sync-check).

## Corrections

### 0281

- Collection preflight required later catalogs → 0283 creates them → default direct collection to require_decisions=false; 0285 enables the workflow check.
- Mock transport alone claimed network enforcement → it cannot observe real Bun lookup/peer/TLS behavior → require real local HTTP/HTTPS transport compatibility tests with test-only loopback permission.
- Apex/www scope and artifact handoff were ambiguous → no public-suffix dependency or existing SEO DTO exists → freeze exact www-toggle and shared envelope/page facts in design §13.
- Plan steps were generic → they did not map to R1–R3 → replace with ordered collection, boundary, parser and observable verification steps.

### 0282

- Saved-artifact scoring omitted optional-stage absence semantics → 0283/0284 are downstream → freeze explicit not-assessed outcomes for standalone use, strict predecessors for integrated use.
- Offline rescoring promised reproducibility without an output contract → overwrites would destroy source evidence → freeze new revision directory argv, immutable source digests and clock exclusions.
- Narrative prose appeared deterministically verifiable → references cannot validate arbitrary assertions → retain only method-owned fact/action/limit templates in final report.
- Plan and shared report ownership were generic → parallel extensions could silently redefine scoring → freeze 0282 scoring ownership, typed extension seams and R-mapped tests.

### 0283

- Choice vocabularies were not all frozen → vendor descriptions do not define catalog keys → freeze business-model/page-type/search-intent vocabularies in design §13.
- Candidate relevance and visibility prerequisites were implicit → no declared page param and 0284 is not a dependency → use compact page evidence with declared params; absent visibility suppresses keyword calls.
- Shared scoring ownership was implicit → 0282 owns scoring → restrict this slice to typed judgment adapters/registration and preserve upstream unknown handling.
- Plan was generic → it omitted observable child/cap/contract steps → replace with R1/R2-mapped catalog, transport, validation and real-loader checks.

### 0284

- Background prohibited every direct provider client → accepted §8 explicitly requires PSI/CrUX HTTP → prohibit direct model/paid SEO clients while allowing only these fixed official measurement endpoints.
- Provider bounds and fallback attempt math were implicit → all attempts must fit 12 calls → freeze three pages, PSI mobile/desktop, PHONE CrUX URL and at most one origin fallback per page.
- Future/stale visibility evidence lacked disposition → ready requires an implementable rule → reject future instants, exclude >90-day rows from recommendations and freeze count/position/citation validation.
- Shared report ownership and Plan were generic → 0282 owns scoring and 0285 integrates → restrict extensions to enrichment payloads and add R1-mapped observable tests.

### 0285

- Pointer-backed arbitrary prose was claimed fully validated → pointers do not establish sentence truth → replace with strict fact/action/limit template selection and deterministic rendering, rejecting text/unknown keys.
- Workflow preflight conflicted with earlier collection-only use → catalogs arrive in 0283 → enable require_decisions=true only for integrated workflow and isolate fixture contracts.
- Cancellation assumed inherited signals → runStage uses spawnSync with captured pipes → require actual workflow-to-grandchild cancellation proof and repair the existing seam if necessary.
- Stage ownership and generic Plan obscured integration → 0282/0283/0284 own their behavior → preserve payload contracts and explicitly verify required versus optional outcomes and report atomicity.

### 0286

- Packed fixture execution implicitly depended on bundled test data → bundle-plugins excludes tests → copy fixture input into the temporary consumer project, while resolving runtime assets only from its packed installation.
- All-in-one narrative guidance implied free-prose report acceptance → 0285 now accepts deterministic templates → document validated report selection separately from advisory consultation.
- Attribution ownership was duplicated → 0281 creates the MIT attribution → review/extend its existing file rather than re-own or replace it.
- Generic Plan omitted consumer isolation and lifecycle detail → readiness needs observable installed behavior → add R1/R2-mapped packed workflow, catalog preservation and capability quality checks.

## Checklist evidence

### 0281

Planning digest: `863f5c148b60acf80f26904d62d844669b26641522c9abca3b0696c88f98253a`.

| ID | Pass | Evidence |
| --- | --- | --- |
| requirements | yes | /Users/robin/xprojects/knowledge-kit/docs/tasks/0281_collect-bounded-public-site-seo-facts-with-robots-and-networ.md Requirements: all local R-items valid; non-goals in Design and satellite §1. |
| design | yes | /Users/robin/xprojects/knowledge-kit/docs/tasks/0281_collect-bounded-public-site-seo-facts-with-robots-and-networ.md Design plus satellite §13: frozen handoff, named files, algorithm and verification. |
| plan | yes | /Users/robin/xprojects/knowledge-kit/docs/tasks/0281_collect-bounded-public-site-seo-facts-with-robots-and-networ.md Plan: ordered R-mapped steps and named observable test files, environment step 0. |
| ac | yes | .spur/memory/evidence/g9-refine-ready-20261014-01/0281-check.json: parser/feature-title checks pass; original mapped scenarios retained. |
| decisions | yes | /Users/robin/xprojects/knowledge-kit/docs/tasks/0281_collect-bounded-public-site-seo-facts-with-robots-and-networ.md Q&A: closed seam choices; ADR-039 and owned deferrals linked. |
| dependencies | yes | /Users/robin/xprojects/knowledge-kit/docs/tasks/0281_collect-bounded-public-site-seo-facts-with-robots-and-networ.md Design: predecessor contracts and downstream responsibilities; frozen acyclic order 0281,0282,0283,0284,0285,0286. |
| premises | yes | apps/cli/src/commands/stage.ts:45; apps/cli/src/stage.ts:79; plugins/kk/scripts/kk-workflow-stages.ts:135; docs/00_ADR.md:745; docs/00_ADR.md:1364; current snapshot, no SEO runtime, tool pins and concurrency verified; dated correction records. |

### 0282

Planning digest: `810395e2eee35b83d276fe28000bc05548c3267861150b9be2310ef909db522a`.

| ID | Pass | Evidence |
| --- | --- | --- |
| requirements | yes | /Users/robin/xprojects/knowledge-kit/docs/tasks/0282_produce-reproducible-seo-assessments-and-stable-prioritized-.md Requirements: all local R-items valid; non-goals in Design and satellite §1. |
| design | yes | /Users/robin/xprojects/knowledge-kit/docs/tasks/0282_produce-reproducible-seo-assessments-and-stable-prioritized-.md Design plus satellite §13: frozen handoff, named files, algorithm and verification. |
| plan | yes | /Users/robin/xprojects/knowledge-kit/docs/tasks/0282_produce-reproducible-seo-assessments-and-stable-prioritized-.md Plan: ordered R-mapped steps and named observable test files, environment step 0. |
| ac | yes | .spur/memory/evidence/g9-refine-ready-20261014-01/0282-check.json: parser/feature-title checks pass; original mapped scenarios retained. |
| decisions | yes | /Users/robin/xprojects/knowledge-kit/docs/tasks/0282_produce-reproducible-seo-assessments-and-stable-prioritized-.md Q&A: closed seam choices; ADR-039 and owned deferrals linked. |
| dependencies | yes | /Users/robin/xprojects/knowledge-kit/docs/tasks/0282_produce-reproducible-seo-assessments-and-stable-prioritized-.md Design: predecessor contracts and downstream responsibilities; frozen acyclic order 0281,0282,0283,0284,0285,0286. |
| premises | yes | vendors/jev-seo/jevseo/checks.py:394; vendors/jev-seo/jevseo/score.py:329; docs/plans/2026-10-14-smart-seo-vendor-review.md; docs/00_ADR.md:1364; current snapshot, no SEO runtime, tool pins and concurrency verified; dated correction records. |

### 0283

Planning digest: `1386e9cd00054c9ed03f0c054824016031e56f1bdbe08d1e0676d5a6008a130c`.

| ID | Pass | Evidence |
| --- | --- | --- |
| requirements | yes | /Users/robin/xprojects/knowledge-kit/docs/tasks/0283_assess-seo-meaning-through-typed-spur-catalogs-with-honest-f.md Requirements: all local R-items valid; non-goals in Design and satellite §1. |
| design | yes | /Users/robin/xprojects/knowledge-kit/docs/tasks/0283_assess-seo-meaning-through-typed-spur-catalogs-with-honest-f.md Design plus satellite §13: frozen handoff, named files, algorithm and verification. |
| plan | yes | /Users/robin/xprojects/knowledge-kit/docs/tasks/0283_assess-seo-meaning-through-typed-spur-catalogs-with-honest-f.md Plan: ordered R-mapped steps and named observable test files, environment step 0. |
| ac | yes | .spur/memory/evidence/g9-refine-ready-20261014-01/0283-check.json: parser/feature-title checks pass; original mapped scenarios retained. |
| decisions | yes | /Users/robin/xprojects/knowledge-kit/docs/tasks/0283_assess-seo-meaning-through-typed-spur-catalogs-with-honest-f.md Q&A: closed seam choices; ADR-039 and owned deferrals linked. |
| dependencies | yes | /Users/robin/xprojects/knowledge-kit/docs/tasks/0283_assess-seo-meaning-through-typed-spur-catalogs-with-honest-f.md Design: predecessor contracts and downstream responsibilities; frozen acyclic order 0281,0282,0283,0284,0285,0286. |
| premises | yes | plugins/kk/decisions/kk-items.yaml:1; apps/cli/src/commands/store.ts:532; .spur/config.yaml:264; /Users/robin/xprojects/spur-new/apps/cli/src/commands/decision.ts:486; /Users/robin/xprojects/spur-new/packages/app/src/decision/decision-evidence-input.ts:13; current snapshot, no SEO runtime, tool pins and concurrency verified; dated correction records. |

### 0284

Planning digest: `740f7a5518e6eb63c513dc3a8bb97818a9c902b31ecbbefba7f2f6654e09357f`.

| ID | Pass | Evidence |
| --- | --- | --- |
| requirements | yes | /Users/robin/xprojects/knowledge-kit/docs/tasks/0284_enrich-audits-with-separate-lab-field-and-imported-query-evi.md Requirements: all local R-items valid; non-goals in Design and satellite §1. |
| design | yes | /Users/robin/xprojects/knowledge-kit/docs/tasks/0284_enrich-audits-with-separate-lab-field-and-imported-query-evi.md Design plus satellite §13: frozen handoff, named files, algorithm and verification. |
| plan | yes | /Users/robin/xprojects/knowledge-kit/docs/tasks/0284_enrich-audits-with-separate-lab-field-and-imported-query-evi.md Plan: ordered R-mapped steps and named observable test files, environment step 0. |
| ac | yes | .spur/memory/evidence/g9-refine-ready-20261014-01/0284-check.json: parser/feature-title checks pass; original mapped scenarios retained. |
| decisions | yes | /Users/robin/xprojects/knowledge-kit/docs/tasks/0284_enrich-audits-with-separate-lab-field-and-imported-query-evi.md Q&A: closed seam choices; ADR-039 and owned deferrals linked. |
| dependencies | yes | /Users/robin/xprojects/knowledge-kit/docs/tasks/0284_enrich-audits-with-separate-lab-field-and-imported-query-evi.md Design: predecessor contracts and downstream responsibilities; frozen acyclic order 0281,0282,0283,0284,0285,0286. |
| premises | yes | vendors/jev-seo/jevseo/psi.py:48; docs/design/kk-smart-seo.md; https://developer.chrome.com/docs/crux/api/; https://developers.google.com/speed/docs/insights/v5/get-started; current snapshot, no SEO runtime, tool pins and concurrency verified; dated correction records. |

### 0285

Planning digest: `3ce7c14a0b52e6c768d1f6623ec4adcbb16a08fa4cc6d07409a6ba6f540e8110`.

| ID | Pass | Evidence |
| --- | --- | --- |
| requirements | yes | /Users/robin/xprojects/knowledge-kit/docs/tasks/0285_run-smart-seo-workflow-with-validated-narratives-and-termina.md Requirements: all local R-items valid; non-goals in Design and satellite §1. |
| design | yes | /Users/robin/xprojects/knowledge-kit/docs/tasks/0285_run-smart-seo-workflow-with-validated-narratives-and-termina.md Design plus satellite §13: frozen handoff, named files, algorithm and verification. |
| plan | yes | /Users/robin/xprojects/knowledge-kit/docs/tasks/0285_run-smart-seo-workflow-with-validated-narratives-and-termina.md Plan: ordered R-mapped steps and named observable test files, environment step 0. |
| ac | yes | .spur/memory/evidence/g9-refine-ready-20261014-01/0285-check.json: parser/feature-title checks pass; original mapped scenarios retained. |
| decisions | yes | /Users/robin/xprojects/knowledge-kit/docs/tasks/0285_run-smart-seo-workflow-with-validated-narratives-and-termina.md Q&A: closed seam choices; ADR-039 and owned deferrals linked. |
| dependencies | yes | /Users/robin/xprojects/knowledge-kit/docs/tasks/0285_run-smart-seo-workflow-with-validated-narratives-and-termina.md Design: predecessor contracts and downstream responsibilities; frozen acyclic order 0281,0282,0283,0284,0285,0286. |
| premises | yes | plugins/kk/workflows/kk-storm-research.yaml:24; apps/cli/src/stage.ts:79; plugins/kk/scripts/itc-stages.ts:1; /Users/robin/xprojects/spur-new/packages/app/src/workflow/actions/agent-run.ts:122; current snapshot, no SEO runtime, tool pins and concurrency verified; dated correction records. |

### 0286

Planning digest: `9a92bdf309009a8e432f9a9cb5a1e56c12a06e90ace79e9e16d9aa59dcd1d020`.

| ID | Pass | Evidence |
| --- | --- | --- |
| requirements | yes | /Users/robin/xprojects/knowledge-kit/docs/tasks/0286_ship-one-smart-seo-skill-and-prove-clean-installed-workflow-.md Requirements: all local R-items valid; non-goals in Design and satellite §1. |
| design | yes | /Users/robin/xprojects/knowledge-kit/docs/tasks/0286_ship-one-smart-seo-skill-and-prove-clean-installed-workflow-.md Design plus satellite §13: frozen handoff, named files, algorithm and verification. |
| plan | yes | /Users/robin/xprojects/knowledge-kit/docs/tasks/0286_ship-one-smart-seo-skill-and-prove-clean-installed-workflow-.md Plan: ordered R-mapped steps and named observable test files, environment step 0. |
| ac | yes | .spur/memory/evidence/g9-refine-ready-20261014-01/0286-check.json: parser/feature-title checks pass; original mapped scenarios retained. |
| decisions | yes | /Users/robin/xprojects/knowledge-kit/docs/tasks/0286_ship-one-smart-seo-skill-and-prove-clean-installed-workflow-.md Q&A: closed seam choices; ADR-039 and owned deferrals linked. |
| dependencies | yes | /Users/robin/xprojects/knowledge-kit/docs/tasks/0286_ship-one-smart-seo-skill-and-prove-clean-installed-workflow-.md Design: predecessor contracts and downstream responsibilities; frozen acyclic order 0281,0282,0283,0284,0285,0286. |
| premises | yes | scripts/bundle-plugins.ts:37; apps/cli/src/stage.ts:45; plugins/kk/scripts/itc-stages.ts:55; apps/cli/tests/package.test.ts; docs/design/kk-smart-seo.md; current snapshot, no SEO runtime, tool pins and concurrency verified; dated correction records. |

## Cross-task proposals

- 0283/0284: Keep separate behavior slices; sequential execution avoids overlapping stage/report edits. Parallel work needs isolated worktrees and named integration owner; no dependency added.
- 0281/0286: 0281 creates attribution; 0286 reviews/extends it. Packaging tests use consumer-local fixture input because tests are pruned.
- No merge candidates: shared integration files are complementary changes, not duplicate root causes. All six tasks already belong to G9. No merge, relink or artificial dependency mutation performed.

## Evidence and limits

Per-task before/after, final checks and machine checklist rows: `.spur/memory/evidence/g9-refine-ready-20261014-01/`. Source snapshot remained 55a184a3b0d09565a4c84268f725a47784e62528; no SEO runtime implementation exists. Current main was the only worktree; no wip task was present. Bun 1.4.3, Biome 2.5.15 and lockfile pins agree. Bare-shell Spur initially reported 0.4.4; freshness inspection confirmed bun-global Spur 0.4.6 and Superskill 0.3.37 match npm latest. Final writes and checks used /Users/robin/.bun/bin/spur explicitly. Multiple PATH copies remain; implementation step 0 must use the latest bun-global binary. Provider seams rechecked against [CrUX API](https://developer.chrome.com/docs/crux/api/) and [PSI API](https://developers.google.com/speed/docs/insights/v5/get-started) on 2026-10-14; no real request, key or account activation was tested.

Final corpus/feature/rule/diff check outcomes are recorded alongside report.json after this pass. Existing L4 prerequisite-not-done advisories remain correct: the dependent tasks are specified but not executable until predecessors finish. Earlier smart-seo-20261014-01 ready evidence is historical; these new planning digests supersede it. This refinement changed no production source, dependencies or commits. Unrelated .spur/config.yaml and concurrent Board CSS/build edits were preserved. Full product tests/build were not rerun for this planning-only change.

Next: `/sp:dev-runall --feature G9 --auto`. Implementation will prove transport compatibility/cancellation, provider behavior and clean installed operation; these are test obligations, not claims established by this refinement.

Final checks: six task checks and feature check PASS (expected prerequisite/unverified advisories); bun run lint exit 0; latest-CLI recommended-pre-check 59 rules, zero findings; git diff --check clean. Machine receipt: `.spur/memory/evidence/g9-refine-ready-20261014-01/verification.json`. Product tests/build were not rerun for this planning-only refinement.
