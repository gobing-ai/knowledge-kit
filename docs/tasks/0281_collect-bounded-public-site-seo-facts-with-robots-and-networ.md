---
schema_version: 1
name: Collect bounded public-site SEO facts with robots and network enforcement
status: done
template: feature-impl
created_at: 2026-10-15T04:45:13.280Z
updated_at: "2026-10-16T18:43:10.319Z"
feature_id: G9
priority: P2
tags:
  - seo
  - geo
estimate_hours: 12

done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0281-verdict.json
---

## 0281. Collect bounded public-site SEO facts with robots and network enforcement

### Background

Accepted design: docs/design/kk-smart-seo.md; vendor snapshot 55a184a3b0d09565a4c84268f725a47784e62528 reviewed in docs/plans/2026-10-14-smart-seo-vendor-review.md. Vendor code is reference-only. No Python, new dependency, direct provider client, site mutation or undocumented scope expansion.

Implements: R1 — Vendor review and rule dispositions ground the delivered audit; R2 — Public site collection respects network scope and resource limits; R3 — Crawl policy and distinct URL evidence survive collection.

Verified premises: apps/cli/src/commands/stage.ts:45 registers the canonical stage run verb; plugins/kk/scripts/kk-workflow-stages.ts:140 demonstrates lazy sibling dispatch; docs/00_ADR.md:745 scopes the FileSystem boundary and permits scripts to follow their existing builtin-only pattern.

Dependencies: none. Predecessor SEO stage artifacts are accepted design, not existing code; use the stated contracts once those tasks land.

**Refine corrections (2026-10-14)**

- Collection preflight required later catalogs → 0283 creates them → default direct collection to require_decisions=false; 0285 enables the workflow check.
- Mock transport alone claimed network enforcement → it cannot observe real Bun lookup/peer/TLS behavior → require real local HTTP/HTTPS transport compatibility tests with test-only loopback permission.
- Apex/www scope and artifact handoff were ambiguous → no public-suffix dependency or existing SEO DTO exists → freeze exact www-toggle and shared envelope/page facts in design §13.
- Plan steps were generic → they did not map to R1–R3 → replace with ordered collection, boundary, parser and observable verification steps.

Current-tree audit: no Smart SEO runtime files are present; all local requirements remain valid planned work. One current main worktree and no wip tasks were observed at kickoff. Bun 1.4.3 and Biome 2.5.15 match package/lock/tool pins; Bare-shell Spur initially reported 0.4.4. Freshness inspection confirmed bun-global Spur 0.4.6 equals npm latest and Superskill 0.3.37 equals npm latest; final writes/checks use the explicit bun-global Spur executable because PATH contains shadow copies (point-in-time evidence, no new pins). Implementation step 0 must recheck tool/environment and ownership drift. External-source dates are evidence, not a guarantee that a provider account is enabled.

### Requirements

- [x] R1. Retain vendor MIT attribution and the exhaustive review disposition while delivering seo-preflight and seo-collect through the existing stage runner without vendors imports.
- [x] R2. Implement connection-pinned public HTTP(S) transport, bounded responses/request counts/deadlines, scoped redirects, cancellation and run-bound atomic artifacts per design §3–5.
- [x] R3. Collect deterministic HTML facts with Bun HTMLRewriter, respect path-specific robots/full delay, preserve slash/query URL identity and support only the declared bounded XML subset with explicit unknowns.

### Acceptance Criteria

- [x] AC1 — Vendor review and rule dispositions ground the delivered audit (req: R1)
- [x] AC2 — Public site collection respects network scope and resource limits (req: R2)
- [x] AC3 — Crawl policy and distinct URL evidence survive collection (req: R3)

```gherkin
Feature: Collect bounded public-site SEO facts with robots and network enforcement

  Scenario: AC1 — Vendor review and rule dispositions ground the delivered audit (req: R1)
    Given the recorded jev-seo snapshot and its 52 deterministic rules
    When Smart SEO is delivered
    Then every source subsystem has a review disposition and every rule has an explicit native, adapted, informational or deferred disposition
    And the implementation retains upstream attribution without importing a vendors runtime path


  Scenario: AC2 — Public site collection respects network scope and resource limits (req: R2)
    Given a public homepage URL and bounded audit options
    When the collector follows pages, redirects and sitemap references
    Then every connection uses a validated public address within the permitted site scope
    And credentials, local addresses, DNS rebinding, oversized responses and exhausted quotas stop collection without a false clean result


  Scenario: AC3 — Crawl policy and distinct URL evidence survive collection (req: R3)
    Given robots policies, slash-distinct paths and supported sitemap documents
    When the bounded collector discovers and fetches pages
    Then it respects path-specific access and full declared delay within the shared deadline
    And robots failures, unsupported XML, blocked pages and inaccessible evidence remain explicit unknowns
    And redirect relationships do not erase distinct request URLs

```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-15T05:03:31.127Z

Closed by ready refinement (2026-10-14): design §13 and the refined handoff close the identified seam decisions. Owner is this WBS for its slice; later integration belongs to 0285 and installed acceptance to 0286. Existing deferred scope in §1 remains deferred to separate operator intake. No issue was dropped and no task merge/link/cancellation was authorized.

### Design

Chosen approach: native KK stage slice, per §2–5 of the satellite.

Frozen decisions: Use builtin HTTP(S) socket lookup pinning and peer checks because validate-then-fetch leaves a DNS race. No browser path. Use Bun HTMLRewriter and the explicit non-expanding sitemap subset. Reject compressed/unsupported XML rather than silently approximate it. Output crawl.json and evidence/page facts use manifest input hashes.

Files owned: plugins/kk/scripts/seo-stages.ts, seo-fetch.ts, seo-facts.ts; lazy seo dispatch in plugins/kk/scripts/kk-workflow-stages.ts; plugins/kk/tests/smart-seo-collect.test.ts and fixtures; plugins/kk/references/smart-seo-attribution.md; docs/04_DESIGN.md.

Verification: offline tests cover mixed DNS/rebinding/private IPv6/scoped redirects, robots error and group/path/wildcard cases, full-delay exhaustion, streaming/total byte limits, deadline/cancel, XML refusal, chunked HTML callbacks, slash/query identity, empty evidence and atomic write failure. No live public DNS/paid calls. Fixture collection may inject transport, but actual local HTTP/HTTPS compatibility tests must exercise the real pinned transport per §13.

Rejected alternatives: wrapping vendor Python, adding dependency/service abstractions or separating tests/docs from this behavior; each expands runtime or ceremony without improving this slice. Out of scope: all deferred capabilities in design §1.

Execution budget: 12h estimated; preserve partial artifacts at budget boundary and resume from current tree, never invent replacement APIs. requireDiff: production stage/catalog/skill plus its behavior checks and same-change docs.

Refined handoff: Own the shared envelope/options/facts validators and preflight/collect registrations; leave rule/scoring ownership to 0282, catalogs to 0283 and full-workflow catalog readiness to 0285. Design §13 freezes the fourth preflight argument require_decisions (literal true|false, default false), exact www-toggle scope, page availability and empty-crawl behavior. Export only the minimum shared envelope/facts functions used by these stages; no generic SDK. Provide one valid minimal crawl fixture for 0282. Collection failures caused by missing evidence yield partial artifacts; invalid input, identity or write failures exit nonzero. Respect all §3–5 resource caps.

Shared-file protocol: implement sequentially in frozen order 0281, 0282, 0283, 0284, 0285, 0286. Change only this slice's registration/payload adapters; preserve predecessor tests and exports. Shared docs/04_DESIGN.md edits describe only shipped behavior. Recheck worktrees/wip ownership before writing; if another worker appears, coordinate rather than revert its edits.

### Plan

- [x] Step 0: Recheck current task contract, cited source files, Bun/tool pins, worktrees/wip ownership and completed predecessor artifact interfaces before editing; preserve unrelated working-tree changes.
- [x] (R1,R2) Confirm Bun 1.4.3, predecessor-free stage seam and ADR-016/018; add lazy seo dispatch without eagerly loading optional helpers. Implement strict options/envelope/workspace validation and collection-only preflight with create-new writes.
- [x] (R2) Implement pinned HTTP(S), public address policy, peer verification, original Host/SNI, no proxies/reuse, scoped redirects and shared budgets; run actual local HTTP/HTTPS compatibility tests before allowing live crawl.
- [x] (R3) Implement robots grouping/path matching/full delay, bounded sitemap subset and streaming HTMLRewriter facts; preserve exact request URLs, null facts and explicit blocked/unavailable/partial outcomes.
- [x] (R1–R3) In plugins/kk/tests/smart-seo-collect.test.ts, verify attribution/disposition linkage, socket boundary, parser refusal, budget/cancellation, distinct URLs and atomic failure through the real collector; hand a minimal valid artifact fixture to 0282.
- [x] Update docs/04_DESIGN.md in the same change for this shipped slice; preserve accepted/deferred scope and source checked-at dates.
- [x] Run project lint, tests, build and rule gates; complete task-pipeline review and traceable requirement/AC verification before recording done. Never waive an upstream implementation dependency because refinement passed.

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `docs/04_DESIGN.md:24` |
| `docs/04_DESIGN.md:599` |
| `packages/kk-core/src/content-limits.ts:104` |
| `packages/kk-core/src/content-limits.ts:182` |
| `packages/kk-core/src/content-limits.ts:191` |
| `packages/kk-core/src/content-limits.ts:200` |
| `packages/kk-core/src/content-limits.ts:85` |
| `packages/kk-core/src/content-limits.ts:92` |
| `packages/kk-core/src/thread-segmentation.ts:15` |
| `packages/kk-core/src/thread-segmentation.ts:9` |
| `plugins/kk/scripts/kk-workflow-stages.ts:131` |
| `plugins/kk/scripts/kk-workflow-stages.ts:1757` |
| `plugins/kk/scripts/kk-workflow-stages.ts:1777` |
| `packages/kk-core/tests/thread-segmentation.test.ts:1` |
| `plugins/kk/references/smart-seo-attribution.md:1` |
| `plugins/kk/scripts/seo-facts.ts:1` |
| `plugins/kk/scripts/seo-fetch.ts:1` |
| `plugins/kk/scripts/seo-stages.ts:1` |
| `plugins/kk/tests/fixtures/smart-seo-minimal-crawl.json:1` |
| `plugins/kk/tests/smart-seo-collect.test.ts:1` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Upstream MIT attribution notice at `plugins/kk/references/smart-seo-attribution.md:1`; the exhaustive 52-rule disposition contract at `docs/plans/2026-10-14-smart-seo-vendor-review.md:70`; seo-preflight and seo-collect stages at `plugins/kk/scripts/seo-stages.ts:172` and `plugins/kk/scripts/seo-stages.ts:276`; the no-vendors-import guard test at `plugins/kk/tests/smart-seo-collect.test.ts:84` |
| R2 | MET | Public-address classification at `plugins/kk/scripts/seo-fetch.ts:220`; DNS resolve-and-pin requiring every answer public at `plugins/kk/scripts/seo-fetch.ts:234`; pinned single request with 2 MiB byte cap at `plugins/kk/scripts/seo-fetch.ts:289` and body-inclusive timeout at `plugins/kk/scripts/seo-fetch.ts:325`; scoped redirects at `plugins/kk/scripts/seo-fetch.ts:452`; 40 MiB run budget at `plugins/kk/scripts/seo-stages.ts:325`; atomic artifact writes at `plugins/kk/scripts/seo-fetch.ts:747` |
| R3 | MET | HTMLRewriter fact extraction at `plugins/kk/scripts/seo-facts.ts:341`; RFC 9309 robots parsing at `plugins/kk/scripts/seo-fetch.ts:555` with Crawl-delay honored at `plugins/kk/scripts/seo-stages.ts:590`; bounded sitemap subset refusing DOCTYPE/ENTITY at `plugins/kk/scripts/seo-fetch.ts:698`; URL scope check at `plugins/kk/scripts/seo-facts.ts:183` |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Vendor review and rule dispositions ground the delivered audit (req: R1) | MET | test | MIT attribution test at `plugins/kk/tests/smart-seo-collect.test.ts:37`; 52-rule disposition test at `plugins/kk/tests/smart-seo-collect.test.ts:48`; no vendor runtime imports at `plugins/kk/tests/smart-seo-collect.test.ts:84`; 131 pass / 0 fail this run |
| AC2 — Public site collection respects network scope and resource limits (req: R2) | MET | test | IP classification at `plugins/kk/tests/smart-seo-collect.test.ts:155`; loopback fail-closed at `plugins/kk/tests/smart-seo-collect.test.ts:184`; pinning and peer mismatch at `plugins/kk/tests/smart-seo-collect.test.ts:275` and `plugins/kk/tests/smart-seo-collect.test.ts:286`; off-scope redirect stop at `plugins/kk/tests/smart-seo-collect.test.ts:317`; stalled-body timeout at `plugins/kk/tests/smart-seo-collect.test.ts:326`; byte-limit abort at `plugins/kk/tests/smart-seo-collect.test.ts:336` |
| AC3 — Crawl policy and distinct URL evidence survive collection (req: R3) | MET | test | Robots longest-match test at `plugins/kk/tests/smart-seo-collect.test.ts:348`; XXE refusal at `plugins/kk/tests/smart-seo-collect.test.ts:404`; HTML facts at `plugins/kk/tests/smart-seo-collect.test.ts:414`; slash/query identity at `plugins/kk/tests/smart-seo-collect.test.ts:127`; robots blocked/unavailable and crawl delay at `plugins/kk/tests/smart-seo-collect.test.ts:718` and `plugins/kk/tests/smart-seo-collect.test.ts:766` |
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
- Current premises: apps/cli/src/commands/stage.ts:45; apps/cli/src/stage.ts:79; plugins/kk/scripts/kk-workflow-stages.ts:135; docs/00_ADR.md:745; docs/00_ADR.md:1364.
- Predecessors: none; dependent responsibilities are named in Design.
- Batch audit/checklist: docs/plans/2026-10-14-g9-ready-refinement.md; machine evidence: .spur/memory/evidence/g9-refine-ready-20261014-01/report.json.
- Concurrency at kickoff: git worktree list showed only current main; spur task list --status wip --json returned [].

### History

- 2026-10-15T23:12:50.168Z todo → wip (system)
- 2026-10-15T23:57:01.101Z wip → testing (system)
- 2026-10-15T23:57:57.864Z testing → done (system)

