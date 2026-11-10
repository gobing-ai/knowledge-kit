---
schema_version: 1
id: "G9"
name: "kk-smart-seo: evidence-grounded SEO and GEO audits"
status: active
priority: P2
tags: []
created_at: "2026-10-15T04:39:32.556Z"
updated_at: "2026-10-16T06:41:46.142Z"
---

# G9: kk-smart-seo: evidence-grounded SEO and GEO audits

## Goal

Provide a repeatable, read-only SEO/GEO audit and prioritized action plan from a public website URL, grounded in observed evidence and typed Spur decisions, with one agent skill to operate and interpret it. The audit runs end to end as `plugins/kk/workflows/kk-smart-seo.yaml` over the native `kk stage run seo-*` stages.

## Scope

- In: `plugins/kk/workflows/kk-smart-seo.yaml`; site/page/pair/keyword decision catalogs; one `smart-seo` skill; native bounded audit helpers reached through `kk stage run`; JSON/Markdown reports; optional PSI/CrUX evidence and normalized imported query/citation evidence; fixtures, clean-install acceptance and documentation.
- In: comprehensive vendor source review, all 52 deterministic rule dispositions, provenance, explicit unknowns, SEO/GEO source refresh, model fallback handling and offline rescoring.
- Out: modifying a live site or local website repository, account changes, search submissions, publication, autonomous removal/redirect advice execution, training-crawler policy changes, browser rendering, paid DataForSEO collection, rank tracking, PDF/XLSX exports, new runtime/dependencies, Board UI and scheduled runs. These require separate intake.
- Vendor source remains reference-only; any adapted text/code carries MIT attribution; fonts and report assets are not copied.

## Acceptance Criteria

```gherkin
Feature: Smart SEO and GEO audit

  @core
  Scenario: R1 — Vendor review and rule dispositions ground the delivered audit
    # covers: I1, I7, I8
    Given the recorded jev-seo snapshot and its 52 deterministic rules
    When Smart SEO is delivered
    Then every source subsystem has a review disposition and every rule has an explicit native, adapted, informational or deferred disposition
    And the implementation retains upstream attribution without importing a vendors runtime path

  @core
  Scenario: R2 — Public site collection respects network scope and resource limits
    # covers: I2, I6
    Given a public homepage URL and bounded audit options
    When the collector follows pages, redirects and sitemap references
    Then every connection uses a validated public address within the permitted site scope
    And credentials, local addresses, DNS rebinding, oversized responses and exhausted quotas stop collection without a false clean result

  @core
  Scenario: R3 — Crawl policy and distinct URL evidence survive collection
    # covers: I2, I6, I7
    Given robots policies, slash-distinct paths and supported sitemap documents
    When the bounded collector discovers and fetches pages
    Then it respects path-specific access and full declared delay within the shared deadline
    And robots failures, unsupported XML, blocked pages and inaccessible evidence remain explicit unknowns
    And redirect relationships do not erase distinct request URLs

  @core
  Scenario: R4 — Technical findings and priorities remain reproducible from saved evidence
    # covers: I2, I6, I7
    Given collected page facts and a versioned rule method
    When checks and prioritization run offline
    Then each applicable check is pass, fail, unknown or not-applicable with source and evidence references
    And no eligible evidence produces null scores rather than a clean score
    And findings keep stable subject-based identifiers across sorting and rescoring

  @core
  Scenario: R5 — Semantic judgments use discoverable typed Spur catalogs
    # covers: I3, I4, I6
    Given installed site, page, pair and keyword SEO catalogs
    When semantic assessment runs
    Then it calls spur decision run with declared parameters and bounded evidence through argument arrays
    And it records served values, source, reason, maker and confidence without direct vendor model calls

  @core
  Scenario: R6 — Missing or uncertain judgments remain unassessed
    # covers: I3, I4, I7
    Given fallback, malformed, low-certainty, timed-out or unavailable decision results
    When findings and scores are derived
    Then those results remain unknown or review signals and never receive model provenance or a semantic pass
    And missing metadata suppresses inapplicable title, meta and heading questions
    And decision call limits prevent unbounded dispatch

  @core
  Scenario: R7 — Performance and imported visibility preserve source and uncertainty
    # covers: I2, I6, I7
    Given optional PSI, CrUX or normalized locale-specific query evidence
    When the audit enriches saved observations
    Then lab and field data remain separate and missing metrics stay null
    And field CWV uses LCP, INP and CLS at p75 with URL or origin scope
    And imported evidence requires source, date, locale and subject identity without treating estimates as measured traffic

  @core
  Scenario: R8 — Narrative claims resolve to recorded facts before final output
    # covers: I2, I5, I6, I7
    Given audit facts and an optional agent-authored structured narrative
    When final JSON and Markdown reports are materialized
    Then every claim reference resolves to its fact or action and invalid claims cannot enter the final report
    And absent narrative yields a labeled deterministic report with coverage and limits

  @core
  Scenario: R9 — Workflow stages stop or degrade according to their recorded outcomes
    # covers: I2, I3, I6
    Given kk-smart-seo and a unique run workspace
    When preflight, collection, checks, optional enrichment, judgments, narrative and reporting execute
    Then each stage consumes validated predecessor artifacts and writes atomic run-bound outputs
    And required-stage errors reach failed while optional unavailable evidence yields a partial report
    And cancellation prevents further network and decision dispatch

  @core
  Scenario: R10 — One SEO skill operates and explains the evidence-grounded workflow
    # covers: I5, I7
    Given the installed smart-seo skill and either an audit URL or saved audit
    When an agent follows the skill
    Then it can run the workflow, review evidence, explain SEO and GEO findings and produce a prioritized action plan through one entry
    And it labels heuristics and separates search, training and user-triggered crawler policies
    And it does not mutate sites or promise rankings or citations

  @core
  Scenario: R11 — Installed audit assets work without checkout or vendor access
    # covers: I2, I3, I4, I5, I6, I8
    Given a separately packed KK installation in an unrelated working directory
    When the workflow and skill resolve their stages and decision catalogs
    Then all helpers, references and catalogs are available without ancestor dependencies, absolute developer paths or vendors access
    And unrelated KK workflows and decision catalogs retain their current behavior

  @core
  Scenario: R12 — SEO and GEO advice reflects dated primary sources and measurement limits
    # covers: I1, I7
    Given the reviewed vendor and the recorded official source registry
    When the report proposes SEO or GEO work
    Then retired FAQ rich-result advice and mandatory llms.txt advice are absent
    And editorial quality is not presented as measured answer-engine visibility
    And snippet controls, indexing observations and actual visibility evidence remain distinct
```

## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0283 | Assess SEO meaning through typed Spur catalogs with honest fallbacks | done |
| 0286 | Ship one Smart SEO skill and prove clean installed workflow use | done |
| 0285 | Run Smart SEO workflow with validated narratives and terminal outcomes | done |
| 0281 | Collect bounded public-site SEO facts with robots and network enforcement | done |
| 0284 | Enrich audits with separate lab field and imported query evidence | done |
| 0282 | Produce reproducible SEO assessments and stable prioritized reports offline | done |
<!-- END AUTO-GENERATED -->

## Notes

## History

- 2026-10-16T00:00:24.514Z backlog → active (system)

