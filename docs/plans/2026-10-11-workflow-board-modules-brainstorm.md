---
kind: plan
title: Workflow Board modules brainstorm
status: accepted
created_at: 2026-10-11
updated_at: 2026-10-11
tags: [brainstorm, board, workflows]
needs_design: true
run_id: 7245e062-08e9-499d-8710-648cdf951599
---

# Idea Evaluation Report

## Enhanced Idea
Add three native, read-only Spur Board modules—Collect, Daily AI Voice, and IT Content—with a shared run selector and four consistent tabs: Summary, Results, Execution progress, and Workflow Config Summary. Each tab remains bound to one workflow/run identity. Present existing pipeline evidence rather than inventing a second orchestration or success model. Add searchable/paged run history in the selector and contextual diagnostics within tabs; no extra empty tabs. Reuse Spur run APIs for execution and a small loopback Knowledge Kit artifact reader for result/config projections.

## Requirement inventory
- I1 — Use the upgraded Spur Board dynamic-module extension mechanism. (source: "new version which supports dynamic modules in the Spur Board")
- I2 — Add one module for plugins/kk/workflows/kk-collect.yaml. (source: "plugins/kk/workflows/kk-collect.yaml")
- I3 — Add one module for plugins/kk/workflows/kk-daily-ai-voice2.yaml. (source: "plugins/kk/workflows/kk-daily-ai-voice2.yaml")
- I4 — Add one module for plugins/kk/workflows/kk-itc.yaml. (source: "plugins/kk/workflows/kk-itc.yaml")
- I5 — Provide a Summary tab in every module. (source: "Summary")
- I6 — Provide a Results tab in every module. (source: "Results")
- I7 — Provide Execution progress in every module. (source: "Execution progress")
- I8 — Provide Workflow Config Summary in every module. (source: "Workflow Config Summary")
- I9 — Mature the idea and resolve useful supporting views. (source: "etc." and "refine it to make it mature enough") — resolve as run history, provenance, freshness, and inline diagnostics; mutations and additional speculative tabs deferred.

## Scores
| Dimension | Score (0–5) | Rationale |
|---|---|---|
| Urgency | 3 | Daily operations already run on a schedule; visibility requires manually joining traces and files. |
| Necessity | 3 | CLI/ledger workarounds exist, but cannot offer one run-bound view of progress and outputs. |

## Premises
- The installed Spur supports native contributions with apiVersion 1, compiled ESM, host React facades and bootstrap.modules (installed package contract; source corroborated in spur-new/docs/design/downstream-board-modules.md §4).
- Spur's downstream module loader is UI-only: it does not load project server routes. Artifact data therefore needs a KK-owned boundary.
- kk-daily-ai-voice2 is kind: dag, while kk-collect and kk-itc are state machines. Progress must support both without manufacturing sequential completion percentages.
- Workspaces are not reliable run identities: collect defaults to minute stamps, daily uses date folders, and ITC allows caller-supplied directories. Later runs can overwrite a folder.
- This is local operator visibility, not a remote multi-user application. The artifact reader must bind to loopback and restrict Board origins and run-bound artifact access.

## Pros
- All three workflows expose consistent navigation with domain-specific useful results.
- Existing Spur run/status/progress evidence remains authoritative, including failures and retries.
- Native modules integrate into the shipped Board without editing Spur or rebuilding its shell.

## Cons
- React host compatibility and packaging become a maintained integration contract.
- A separate local reader must be running for artifacts/config; outage must not hide Spur progress.
- Legacy runs may have no provable artifact ownership or captured effective config; show unavailable rather than guessing.

## Better Alternatives
1. Three iframe dashboards: simple isolation, but duplicates navigation and application shell; no existing dashboard to embed. Confidence medium.
2. Static JSON snapshots served as module assets: less backend code, but introduces refresh/export jobs and copied media; cannot reliably show run-bound current artifacts. Confidence high on limitations.
3. Native modules plus a minimal KK read-only reader and existing Spur run APIs: recommended; meets the complete request with no upstream fork. Confidence high on extension contract, medium on historical artifact completeness.

## Recommendation
reshape — proceed with three native workflow observability modules, four concrete tabs, shared history selection, and a deliberately read-only first release.

Stakes: a bounded local UI/backend addition; no pipeline actions, paid generation, or publishing are triggered by viewing. Historical evidence gaps remain explicit.

## Design Summary
Use one browser workspace and three small ESM contribution entries exporting webModule/apiVersion 1; share the run selector, tabs, loading/error states and presentation components. Read run lists/details/progress from the active Board origin. Read only allowlisted, schema-validated result/config projections and media from a loopback KK reader. The reader joins by workflow plus run ID, never by date/latest-file alone. Introduce a minimal run-scoped artifact manifest written by existing preparation/stage paths so future same-day reruns cannot silently reassign outputs. Use one workspace ownership marker and expose superseded/unverifiable historical files without copying media. Keep live status and semantic result outcome distinct. Include no new plugin kind, engine, database, workflow editor, launch/retry/cancel controls, or speculative extension framework.

## Spec self-review
PASS: all nine inventory items have a concrete interpretation; no placeholders; no speculative tabs; config/history gaps and DAG behavior are explicit. --auto accepts the reshape recommendation.

---
run_id: 7245e062-08e9-499d-8710-648cdf951599
generated_at: 2026-10-11T23:18:57.270200+00:00
---

## Decomposition and sizing

Parent rubric: E30 D4 L3 C1 R1 = 39; decompose into four independently demonstrable workflow/install deliverables. Shared foundation ships through the Collect vertical slice, rather than a horizontal backend or schema task. Collect spans 12h (above target, below forced 16h split) because the installed native/reader/provenance integration needs one review context. Daily 8h, ITC 6h and installed acceptance 4h remain distinct deliverables. No two-hour test-only fragments.

Dependency order: Collect first; Daily and ITC each depend on Collect; installed acceptance depends on both. Independent Daily/ITC implementation may require coordination on shared files; execution stays sequential by default.

The pre-batch sizing/order checkpoint is auto-skipped under the operator's --auto request.

## Planning handoff

Feature G8; fourteen acceptance scenarios; all inventory items covered; task checks pass.

| Task | Deliverable | Estimate | Dependencies |
|---|---|---|---|
| 0252 | Collect and common native/reader/provenance foundation | 12h | none |
| 0253 | Daily AI Voice DAG and multimedia visibility | 8h | 0252 |
| 0254 | IT Content authoring visibility | 6h | 0252 |
| 0255 | Installed-package/operator acceptance | 4h | 0253, 0254 |

Ready-evidence certification was skipped: the consumer checkout does not contain the harness
planning-digest implementation, and the installed helper does not export it. No digest was
fabricated. Task schema checks are clean; this is an evidence-certification limitation rather than
a claim of implementation readiness. The pipeline recommends exactly one next command:

`/sp-dev-refineall --feature G8 --auto --depth ready`

Implementation, live workflow runs and installed-browser acceptance have not been executed.

## Planning verification

Feature/inventory check and all four task checks pass. Dependencies are applied: 0253/0254 depend
on 0252, and 0255 depends on both. Repository lint and workspace build pass; recommended pre/post
rule presets report zero findings; git diff whitespace check passes. The existing unit suite
reports 2408 pass, 2 skip, 0 fail (2410 tests across 130 files); no test source was changed and no
new skips were introduced. Product/browser acceptance is assigned to the implementation tasks.

## Accepted refinement — 2026-10-11: existing Settings owns definitions

Operator requires reuse of Settings → Workflows. Keep the four tabs, but constrain Workflow Config
Summary to recorded run settings/provenance and link `/board/settings/workflows` for current
metadata, YAML and static graph. Remove the proposed KK current-definition/config endpoint.
Canonicalize repository YAML under `plugins/kk/workflows`, moving feature-verification unchanged
and aliasing `.spur/workflows` with a relative symlink. No upstream UI changes are required.
