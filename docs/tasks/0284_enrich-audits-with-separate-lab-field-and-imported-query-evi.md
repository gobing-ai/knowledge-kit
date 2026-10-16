---
schema_version: 1
name: Enrich audits with separate lab field and imported query evidence
status: done
template: feature-impl
created_at: 2026-10-15T04:45:13.287Z
updated_at: "2026-10-16T19:34:31.183Z"
feature_id: G9
priority: P2
tags:
  - seo
  - geo
estimate_hours: 6

dependencies: ["0281", "0282"]
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0284-verdict.json
---

## 0284. Enrich audits with separate lab field and imported query evidence

### Background

Accepted design: docs/design/kk-smart-seo.md; vendor snapshot 55a184a3b0d09565a4c84268f725a47784e62528 reviewed in docs/plans/2026-10-14-smart-seo-vendor-review.md. Vendor code is reference-only. No Python, new dependency, direct model or paid SEO provider client (fixed PSI/CrUX measurement HTTP is allowed), site mutation or undocumented scope expansion.

Implements: R7 — Performance and imported visibility preserve source and uncertainty.

Verified premises: vendors/jev-seo/jevseo/psi.py:48 currently reads PSI field/lab together; docs/design/kk-smart-seo.md:1 is the authoritative feature satellite for the replacement contract. The official PSI notice in the review announces future field-data removal, not a completed removal.

Dependencies: Collect bounded public-site SEO facts with robots and network enforcement; Produce reproducible SEO assessments and stable prioritized reports offline. Predecessor SEO stage artifacts are accepted design, not existing code; use the stated contracts once those tasks land.

**Refine corrections (2026-10-14)**

- Background prohibited every direct provider client → accepted §8 explicitly requires PSI/CrUX HTTP → prohibit direct model/paid SEO clients while allowing only these fixed official measurement endpoints.
- Provider bounds and fallback attempt math were implicit → all attempts must fit 12 calls → freeze three pages, PSI mobile/desktop, PHONE CrUX URL and at most one origin fallback per page.
- Future/stale visibility evidence lacked disposition → ready requires an implementable rule → reject future instants, exclude >90-day rows from recommendations and freeze count/position/citation validation.
- Shared report ownership and Plan were generic → 0282 owns scoring and 0285 integrates → restrict extensions to enrichment payloads and add R1-mapped observable tests.

Current-tree audit: no Smart SEO runtime files are present; all local requirements remain valid planned work. One current main worktree and no wip tasks were observed at kickoff. Bun 1.4.3 and Biome 2.5.15 match package/lock/tool pins; Bare-shell Spur initially reported 0.4.4. Freshness inspection confirmed bun-global Spur 0.4.6 equals npm latest and Superskill 0.3.37 equals npm latest; final writes/checks use the explicit bun-global Spur executable because PATH contains shadow copies (point-in-time evidence, no new pins). Implementation step 0 must recheck tool/environment and ownership drift. External-source dates are evidence, not a guarantee that a provider account is enabled.

### Requirements

- [x] R1. Implement optional PSI lab and independent CrUX field contracts plus strict normalized visibility import; preserve URL/origin/window/form-factor, source/locale/time/hash and measured-versus-estimated provenance; keep unavailable metrics null and record all affected pages.

### Acceptance Criteria

- [x] AC1 — Performance and imported visibility preserve source and uncertainty (req: R1)

```gherkin
Feature: Enrich audits with separate lab field and imported query evidence

  Scenario: AC1 — Performance and imported visibility preserve source and uncertainty (req: R1)
    Given optional PSI, CrUX or normalized locale-specific query evidence
    When the audit enriches saved observations
    Then lab and field data remain separate and missing metrics stay null
    And field CWV uses LCP, INP and CLS at p75 with URL or origin scope
    And imported evidence requires source, date, locale and subject identity without treating estimates as measured traffic

```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-15T05:03:35.993Z

Closed by ready refinement (2026-10-14): design §13 and the refined handoff close the identified seam decisions. Owner is this WBS for its slice; later integration belongs to 0285 and installed acceptance to 0286. Existing deferred scope in §1 remains deferred to separate operator intake. No issue was dropped and no task merge/link/cancellation was authorized.

### Design

Chosen approach: native KK stage slice, per §8 of the satellite.

Frozen decisions: Use builtins and fixed official endpoints with explicit credential environment names; never reuse unsafe site fetching for provider auth. Default performance=false makes no provider requests. Missing keys or insufficient samples are partial outcomes. Validate imported snapshots before keyword use and reject wrong scope/locale. No DFS API client or Search Console OAuth.

Files owned: plugins/kk/scripts/seo-enrich.ts, seo-stages.ts, seo-report.ts; plugins/kk/tests/smart-seo-enrich.test.ts and fixtures; docs/04_DESIGN.md.

Verification: mock PSI/CrUX responses including absent INP, all-null metrics, URL-to-origin fallback, malformed JSON/429/timeouts, multiple failing URLs and stage call cap. Assert CWV field p75 uses all three metrics; lab TBT cannot pass INP. Test missing/future/stale import dates, invalid numeric ranges, unknown fields, scope/locale mismatch, citation denominator and zero-vs-null distinctions.

Rejected alternatives: wrapping vendor Python, adding dependency/service abstractions or separating tests/docs from this behavior; each expands runtime or ceremony without improving this slice. Out of scope: all deferred capabilities in design §1.

Execution budget: 6h estimated; preserve partial artifacts at budget boundary and resume from current tree, never invent replacement APIs. requireDiff: production stage/catalog/skill plus its behavior checks and same-change docs.

Refined handoff: Consume 0281 scope/envelope and 0282 optional-stage validators; own seo-enrich.ts and only enrichment registration/report payload adapters, preserving score/ID rules. 0283 consumes the declared visibility shape independently; 0285 supplies enrichment before judge. Use the fixed PSI/CrUX endpoints and credential names in §8/13; forbid provider redirects/secret-bearing logs, bound responses to 2 MiB and clip request timeouts to the 300-second deadline. Missing keys/samples/HTTP failures persist unavailable entries and exit zero; invalid supplied visibility JSON is a required input error before keyword use, never silently unavailable. Stale snapshots remain evidence but do not drive recommendations. Counts are integer/nonnegative, position >=1, citations require platform/sampleCount and cannot exceed sampleCount. Default disabled mode performs no provider requests.

Shared-file protocol: implement sequentially in frozen order 0281, 0282, 0283, 0284, 0285, 0286. Change only this slice's registration/payload adapters; preserve predecessor tests and exports. Shared docs/04_DESIGN.md edits describe only shipped behavior. Recheck worktrees/wip ownership before writing; if another worker appears, coordinate rather than revert its edits.

### Plan

- [x] Step 0: Recheck current task contract, cited source files, Bun/tool pins, worktrees/wip ownership and completed predecessor artifact interfaces before editing; preserve unrelated working-tree changes.
- [x] (R1) Add strict performance/visibility payload validators using existing envelopes and frozen import shape; enforce scope, locale, UTC instant, size/count/number rules and future/stale dispositions.
- [x] (R1) Implement fixed-origin PSI/CrUX requests with separate keys and lab/field outputs; select at most three pages, count each attempt toward 12, honor 300 seconds and record URL-to-origin PHONE fallback without substituting passing data.
- [x] (R1) Integrate disabled/unavailable/available entries with existing audit/report payloads; preserve null metrics, p75 units/window/scope and all affected-page findings without modifying 0282 scoring.
- [x] (R1) In plugins/kk/tests/smart-seo-enrich.test.ts, exercise HTTP client request construction and response fixtures for redirect/refused origin/key leakage/oversize/429/deadline/cap, missing INP, null-versus-zero, all failing URLs and malformed/future/stale/wrong-market imports.
- [x] Update docs/04_DESIGN.md in the same change for this shipped slice; preserve accepted/deferred scope and source checked-at dates.
- [x] Run project lint, tests, build and rule gates; complete task-pipeline review and traceable requirement/AC verification before recording done. Never waive an upstream implementation dependency because refinement passed.

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `docs/04_DESIGN.md:24` |
| `docs/04_DESIGN.md:599` |
| `docs/04_DESIGN.md:604` |
| `docs/features/G9_kk-smart-seo-evidence-grounded-seo-and-geo-audits.md:9` |
| `plugins/kk/scripts/kk-workflow-stages.ts:1784` |
| `plugins/kk/scripts/seo-stages.ts:4` |
| `plugins/kk/scripts/seo-stages.ts:768` |
| `plugins/kk/scripts/seo-stages.ts:819` |
| `plugins/kk/scripts/seo-stages.ts:833` |
| `plugins/kk/scripts/seo-enrich.ts:1` |
| `plugins/kk/tests/smart-seo-enrich.test.ts:1` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | PSI lab parsing at `plugins/kk/scripts/seo-enrich.ts:309`; independent CrUX field parsing with p75 LCP/INP/CLS at `plugins/kk/scripts/seo-enrich.ts:335` and `plugins/kk/scripts/seo-enrich.ts:347`; deterministic page selection at `plugins/kk/scripts/seo-enrich.ts:159`; pinned fixed-endpoint provider transport with 2 MiB cap at `plugins/kk/scripts/seo-enrich.ts:25` and `plugins/kk/scripts/seo-enrich.ts:174`; strict visibility import at `plugins/kk/scripts/seo-enrich.ts:382` preserving measured-versus-estimated at `plugins/kk/scripts/seo-enrich.ts:116`; artifacts at `plugins/kk/scripts/seo-enrich.ts:508` and `plugins/kk/scripts/seo-enrich.ts:554` |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Performance and imported visibility preserve source and uncertainty (req: R1) | MET | test | Lab/field separation at `plugins/kk/tests/smart-seo-enrich.test.ts:78`; missing metrics null at `plugins/kk/tests/smart-seo-enrich.test.ts:88`; no-snapshot visibility not-assessed with null measurement kind at `plugins/kk/tests/smart-seo-enrich.test.ts:157`; all three p75 metrics required at `plugins/kk/tests/smart-seo-enrich.test.ts:95`; attempt cap at `plugins/kk/tests/smart-seo-enrich.test.ts:195`; origin fallback at `plugins/kk/tests/smart-seo-enrich.test.ts:226`; affected pages recorded at `plugins/kk/tests/smart-seo-enrich.test.ts:252`; stalled-body timeout at `plugins/kk/tests/smart-seo-enrich.test.ts:401`; snapshot provenance at `plugins/kk/tests/smart-seo-enrich.test.ts:456` and `plugins/kk/tests/smart-seo-enrich.test.ts:545`; 132 pass / 0 fail this run |
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
- Current premises: vendors/jev-seo/jevseo/psi.py:48; docs/design/kk-smart-seo.md; https://developer.chrome.com/docs/crux/api/; https://developers.google.com/speed/docs/insights/v5/get-started.
- Predecessors: 0281, 0282; dependent responsibilities are named in Design.
- Batch audit/checklist: docs/plans/2026-10-14-g9-ready-refinement.md; machine evidence: .spur/memory/evidence/g9-refine-ready-20261014-01/report.json.
- Concurrency at kickoff: git worktree list showed only current main; spur task list --status wip --json returned [].

### History

- 2026-10-16T01:44:38.029Z todo → wip (system)
- 2026-10-16T03:43:56.455Z wip → testing (system)
- 2026-10-16T03:43:57.197Z testing → done (system)

