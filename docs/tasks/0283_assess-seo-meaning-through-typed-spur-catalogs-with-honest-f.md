---
schema_version: 1
name: Assess SEO meaning through typed Spur catalogs with honest fallbacks
status: done
template: feature-impl
created_at: 2026-10-15T04:45:13.286Z
updated_at: "2026-10-16T01:04:14.148Z"
feature_id: G9
priority: P2
tags:
  - seo
  - geo
estimate_hours: 8

dependencies: ["0281", "0282"]
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0283-verdict.json
---

## 0283. Assess SEO meaning through typed Spur catalogs with honest fallbacks

### Background

Accepted design: docs/design/kk-smart-seo.md; vendor snapshot 55a184a3b0d09565a4c84268f725a47784e62528 reviewed in docs/plans/2026-10-14-smart-seo-vendor-review.md. Vendor code is reference-only. No Python, new dependency, direct provider client, site mutation or undocumented scope expansion.

Implements: R5 — Semantic judgments use discoverable typed Spur catalogs; R6 — Missing or uncertain judgments remain unassessed.

Verified premises: plugins/kk/decisions/kk-items.yaml:1 is the existing flat catalog pattern; apps/cli/src/commands/store.ts:532 documents argv-based decision calls; .spur/config.yaml:264 registers the product decision root. These are patterns, not permission to reuse store label tables for SEO.

Dependencies: Collect bounded public-site SEO facts with robots and network enforcement; Produce reproducible SEO assessments and stable prioritized reports offline. Predecessor SEO stage artifacts are accepted design, not existing code; use the stated contracts once those tasks land.

**Refine corrections (2026-10-14)**

- Choice vocabularies were not all frozen → vendor descriptions do not define catalog keys → freeze business-model/page-type/search-intent vocabularies in design §13.
- Candidate relevance and visibility prerequisites were implicit → no declared page param and 0284 is not a dependency → use compact page evidence with declared params; absent visibility suppresses keyword calls.
- Shared scoring ownership was implicit → 0282 owns scoring → restrict this slice to typed judgment adapters/registration and preserve upstream unknown handling.
- Plan was generic → it omitted observable child/cap/contract steps → replace with R1/R2-mapped catalog, transport, validation and real-loader checks.

Current-tree audit: no Smart SEO runtime files are present; all local requirements remain valid planned work. One current main worktree and no wip tasks were observed at kickoff. Bun 1.4.3 and Biome 2.5.15 match package/lock/tool pins; Bare-shell Spur initially reported 0.4.4. Freshness inspection confirmed bun-global Spur 0.4.6 equals npm latest and Superskill 0.3.37 equals npm latest; final writes/checks use the explicit bun-global Spur executable because PATH contains shadow copies (point-in-time evidence, no new pins). Implementation step 0 must recheck tool/environment and ownership drift. External-source dates are evidence, not a guarantee that a provider account is enabled.

### Requirements

- [x] R1. Implement the four flat catalogs and 22 declared typed decisions, seo-judge argv transport, compact evidence packets, served-outcome ledger and bounded candidate relevance mapping per design §7; load/show contracts using isolated Spur config.
- [x] R2. Validate outcome values/confidence/provenance; skip inapplicable questions and preserve fallback/malformed/low-certainty/error/timeout/cap-exhaustion as unknown or review, excluding them from semantic scores.

### Acceptance Criteria

- [x] AC1 — Semantic judgments use discoverable typed Spur catalogs (req: R1)
- [x] AC2 — Missing or uncertain judgments remain unassessed (req: R2)

```gherkin
Feature: Assess SEO meaning through typed Spur catalogs with honest fallbacks

  Scenario: AC1 — Semantic judgments use discoverable typed Spur catalogs (req: R1)
    Given installed site, page, pair and keyword SEO catalogs
    When semantic assessment runs
    Then it calls spur decision run with declared parameters and bounded evidence through argument arrays
    And it records served values, source, reason, maker and confidence without direct vendor model calls


  Scenario: AC2 — Missing or uncertain judgments remain unassessed (req: R2)
    Given fallback, malformed, low-certainty, timed-out or unavailable decision results
    When findings and scores are derived
    Then those results remain unknown or review signals and never receive model provenance or a semantic pass
    And missing metadata suppresses inapplicable title, meta and heading questions
    And decision call limits prevent unbounded dispatch

```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-15T05:03:34.375Z

Closed by ready refinement (2026-10-14): design §13 and the refined handoff close the identified seam decisions. Owner is this WBS for its slice; later integration belongs to 0285 and installed acceptance to 0286. Existing deferred scope in §1 remains deferred to separate operator intake. No issue was dropped and no task merge/link/cancellation was authorized.

### Design

Chosen approach: native KK stage slice, per §7 of the satellite.

Frozen decisions: Catalog defaults.minConfidence=0 retains raw served observations; KK applies sufficient-confidence policy separately. Nouls retain probability and nullable confidence. CLI does not expose vendor probability vectors. Keep existing/new/unclear static keyword-page choices and use bounded per-candidate relevance calls for existing mapping; all calls consume the shared quota. Makers are inherited from Spur config.

Files owned: plugins/kk/decisions/kk-seo-site.yaml, kk-seo-page.yaml, kk-seo-pair.yaml, kk-seo-keyword.yaml; plugins/kk/scripts/seo-decisions.ts, seo-stages.ts, seo-rules.ts; plugins/kk/tests/smart-seo-decisions.test.ts; docs/04_DESIGN.md.

Verification: use executable spur stubs for model/default/nonzero/timeout/malformed JSON/out-of-range results, large multibyte evidence and instruction-bearing HTML. Assert serialized evidence <=1800 units, no shell evaluation, <=max_decision_calls, cancellation kills children, default is never model, unknown does not score, and absent title/meta/H1 suppresses calls. Validate real catalogs with an offline typesafe maker in isolated config; no operator maker changes.

Rejected alternatives: wrapping vendor Python, adding dependency/service abstractions or separating tests/docs from this behavior; each expands runtime or ceremony without improving this slice. Out of scope: all deferred capabilities in design §1.

Execution budget: 8h estimated; preserve partial artifacts at budget boundary and resume from current tree, never invent replacement APIs. requireDiff: production stage/catalog/skill plus its behavior checks and same-change docs.

Refined handoff: Consume 0281 validated facts and 0282 assessment/audit validators; emit judgments.json and its ledger, extend seo-stages.ts only for seo-judge and seo-rules.ts only for judgment-to-assessment adaptation. 0282 retains score/ID ownership. Freeze all choice keys and candidate mapping per design §7/13. Per-candidate calls use only subject_id/locale plus bounded keyword/page evidence; ties/exhaustion produce unclear. Visibility fixture validation is shared with the declared §8 shape, not an import of unfinished 0284 code: missing visibility makes keyword questions not-assessed. 0285 integrates live enrichment before judgment. All fixture runs use executable local decision stubs/isolated offline makers, never configured operator models. Source/default distinction and nullable confidence remain unchanged.

Shared-file protocol: implement sequentially in frozen order 0281, 0282, 0283, 0284, 0285, 0286. Change only this slice's registration/payload adapters; preserve predecessor tests and exports. Shared docs/04_DESIGN.md edits describe only shipped behavior. Recheck worktrees/wip ownership before writing; if another worker appears, coordinate rather than revert its edits.

### Plan

- [x] Step 0: Recheck current task contract, cited source files, Bun/tool pins, worktrees/wip ownership and completed predecessor artifact interfaces before editing; preserve unrelated working-tree changes.
- [x] (R1) Add four flat catalogs with exactly 22 IDs, explicit required parameters, fixed choices/descriptive 0–3 levels and conservative defaults; load/status/show each using isolated config and an offline maker.
- [x] (R1) Implement compact serialized evidence, deterministic page/pair/candidate selection and argv-based child dispatch in seo-decisions.ts with measured attempts and shared deadline/call quota.
- [x] (R2) Validate served type/range/source/confidence/reason/maker, suppress inapplicable questions and missing visibility, classify default/error/timeout as unknown and insufficient confidence as review; adapt only model-qualified results to existing 0282 scoring.
- [x] (R1,R2) In plugins/kk/tests/smart-seo-decisions.test.ts, execute real stub children for malformed/default/timeout/cancel/cap cases; exercise real catalog loading, >2000-unit/multibyte evidence, literal argv, candidate ties and absent metadata/visibility.
- [x] Update docs/04_DESIGN.md in the same change for this shipped slice; preserve accepted/deferred scope and source checked-at dates.
- [x] Run project lint, tests, build and rule gates; complete task-pipeline review and traceable requirement/AC verification before recording done. Never waive an upstream implementation dependency because refinement passed.

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `docs/04_DESIGN.md:24` |
| `docs/04_DESIGN.md:599` |
| `docs/04_DESIGN.md:603` |
| `docs/features/G9_kk-smart-seo-evidence-grounded-seo-and-geo-audits.md:9` |
| `plugins/kk/scripts/kk-workflow-stages.ts:1784` |
| `plugins/kk/scripts/seo-stages.ts:3` |
| `plugins/kk/scripts/seo-stages.ts:767` |
| `plugins/kk/scripts/seo-stages.ts:802` |
| `plugins/kk/scripts/seo-stages.ts:813` |
| `plugins/kk/decisions/kk-seo-keyword.yaml:1` |
| `plugins/kk/decisions/kk-seo-page.yaml:1` |
| `plugins/kk/decisions/kk-seo-pair.yaml:1` |
| `plugins/kk/decisions/kk-seo-site.yaml:1` |
| `plugins/kk/scripts/seo-decisions.ts:1` |
| `plugins/kk/tests/smart-seo-decisions.test.ts:1` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Four flat catalogs implemented under `plugins/kk/decisions/` declaring exactly 22 typed decisions (`plugins/kk/decisions/kk-seo-site.yaml:1`, `plugins/kk/decisions/kk-seo-page.yaml:1`, `plugins/kk/decisions/kk-seo-pair.yaml:1`, `plugins/kk/decisions/kk-seo-keyword.yaml:1`); `plugins/kk/scripts/seo-decisions.ts:30` implements compact evidence packet serialization (<=1800 units) and bounded argv child dispatch; `plugins/kk/scripts/seo-stages.ts:770` implements `seo-judge`. Verified in `plugins/kk/tests/smart-seo-decisions.test.ts:25`. |
| R2 | MET | `plugins/kk/scripts/seo-decisions.ts:160` implements outcome validation with confidence thresholds (>=0.8), suppresses inapplicable questions (missing title/meta/headings, deterministic homepage), and excludes fallback/timeout/errors from semantic scores. Verified in `plugins/kk/tests/smart-seo-decisions.test.ts:90`. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Semantic judgments use discoverable typed Spur catalogs (req: R1) | MET | test | `plugins/kk/tests/smart-seo-decisions.test.ts:25` verifies 22 decisions discoverable via `spur decision list`, compact evidence serialization, and argv transport without direct vendor calls. |
| AC2 — Missing or uncertain judgments remain unassessed (req: R2) | MET | test | `plugins/kk/tests/smart-seo-decisions.test.ts:90` verifies low-certainty / fallback qualification rejection, inapplicable question suppression, and decision call quota enforcement. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

- Feature G9: docs/features/G9_kk-smart-seo-evidence-grounded-seo-and-geo-audits.md
- Accepted design: docs/design/kk-smart-seo.md (§13 is the refined handoff). ADR-039: docs/00_ADR.md:1364.
- Vendor review: docs/plans/2026-10-14-smart-seo-vendor-review.md. Snapshot verified unchanged.
- Current premises: plugins/kk/decisions/kk-items.yaml:1; apps/cli/src/commands/store.ts:532; .spur/config.yaml:264; /Users/robin/xprojects/spur-new/apps/cli/src/commands/decision.ts:486; /Users/robin/xprojects/spur-new/packages/app/src/decision/decision-evidence-input.ts:13.
- Predecessors: 0281, 0282; dependent responsibilities are named in Design.
- Batch audit/checklist: docs/plans/2026-10-14-g9-ready-refinement.md; machine evidence: .spur/memory/evidence/g9-refine-ready-20261014-01/report.json.
- Concurrency at kickoff: git worktree list showed only current main; spur task list --status wip --json returned [].

### History

- 2026-10-16T00:37:29.285Z todo → wip (system)
- 2026-10-16T01:04:07.694Z wip → testing (system)
- 2026-10-16T01:04:14.073Z testing → done (system)

