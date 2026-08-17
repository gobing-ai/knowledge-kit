---
schema_version: 1
id: "C5"
name: "STORM research workflow evidence hardening"
status: done
priority: P2
tags: []
created_at: "2026-08-16T03:01:11.655Z"
updated_at: "2026-08-17T03:41:03.330Z"
---

# C5: STORM research workflow evidence hardening

## Goal

## Scope

- In:
- Out:

## Acceptance Criteria
```gherkin
Feature: STORM research workflow evidence hardening

  @core
  Scenario: R1 — Live ingest scrapes and normalizes full content into a per-reference cache
    Given web-search returns a Doc[] whose items carry sourceUri and search-snippet bodies
    And FIRECRAWL_API_KEY is set and markitdown is installed
    When the live ingest runs
    Then each source is fetched via Firecrawl /v2/scrape and normalized with the markitdown binary
    And works/<topic-id>/references/<doc-id>.md exists for every emitted Doc

  @core
  Scenario: R2 — Doc bodies use the normalized full content while docs.json stays contract-valid
    Given the references/ cache files exist from the scrape pass
    When docs.json is written
    Then each Doc body is the normalized full content
    And docs.json still parses against DocListSchema with the unchanged Doc[] shape

  @core
  Scenario: R3 — A per-URL scrape failure is non-fatal with snippet fallback
    Given one source URL whose /v2/scrape call fails
    When the live ingest runs
    Then that Doc keeps its search-snippet body and a warning names the failed URL
    And the ingest exits 0 and docs.json is written

  @core
  Scenario: R4 — Re-running ingest reuses the cached normalized body
    Given references/<doc-id>.md already exists for a source and the query is unchanged
    When ingest re-runs for the same topic
    Then the cached file is reused without a new /v2/scrape call for that source

  @core
  Scenario: R5 — Live ingest fails loud when markitdown is unavailable
    Given live mode with FIRECRAWL_API_KEY set and no markitdown binary on PATH
    When the ingest runs
    Then it exits 1 with a diagnostic naming markitdown
    And no docs.json is written

  @core
  Scenario: R6 — The generated report digests sources instead of indexing them
    Given a grounded DocList with normalized bodies
    When content-gen writes the draft
    Then the report body synthesizes findings across the sources rather than listing them one per line

  @core
  Scenario: R7 — Render resolves the references tail to cached files
    Given content.json whose references carry cite ids matching references/<doc-id>.md files
    When render runs
    Then content.md ends with a compact References list whose entries resolve to cached files
    And no outline replay is appended

  @core
  Scenario: R8 — [doc-only] The works layout and skill document the references cache and digest contract
    Given the C5 change lands
    When the 0056 works-layout table and storm-research SKILL.md are read
    Then references/ is listed in the layout and the skill records the digest-don't-index practice

  @edge
  Scenario: R9 — Fixture mode performs no scrape and needs no key or markitdown
    Given fixture is "true"
    When the ingest runs
    Then it emits the canned docs with no network calls, no FIRECRAWL_API_KEY, and no markitdown invocation

  @edge
  Scenario: R10 — Live ingest with FIRECRAWL_API_KEY unset fails loud before scraping
    Given live mode with FIRECRAWL_API_KEY unset
    When the ingest runs
    Then it exits 1 naming FIRECRAWL_API_KEY and writes no docs.json

  @edge
  Scenario: R11 — A scrape returning unusable content falls back to the snippet body
    Given a source whose scrape returns empty or unparsable content
    When the live ingest runs
    Then that Doc keeps the search-snippet body and the failure is warned, not fatal

  @core
  Scenario: R12 — Scraped HTML is normalized with markitdown and cached per reference
    Given a successful /v2/scrape response carrying html and markdown formats
    When the live ingest normalizes a source
    Then the markitdown output is written to references/<doc-id>.md with doc-id = computeId(sourceUri)
    And the references/ directory is created as a sibling of the --out file when missing

  @edge
  Scenario: R13 — Live ingest is unit-testable without network or the real markitdown binary
    Given SearchDeps carries injected scrape and markitdown runners
    When the web-search suite runs
    Then no network call is made and the real markitdown binary is never invoked

  @core
  Scenario: R14 — The report markdown drops the Outline replay block
    Given content.json whose content carries a non-empty outline
    When renderContentMarkdown runs
    Then content.md contains no ## Outline replay block
    And content.json still keeps the outline field

  @core
  Scenario: R15 — The outline removal lands identically in both render copies
    Given packages/kk-core and plugins/kk both ship render-md
    When the same content renders through both copies
    Then both outputs drop the outline block byte-identically and the SYNC comment is preserved

  @core
  Scenario: R16 — [doc-only] SKILL.md fail-loud table documents the markitdown requirement
    Given the storm-research SKILL.md
    When the fail-loud table is read
    Then a row states live mode requires markitdown on PATH, and a missing binary exits 1 naming markitdown with no docs.json written

  @core
  Scenario: R17 — [doc-only] SKILL.md records the digest-don't-index practice
    Given the storm-research SKILL.md
    When the better-report practices are read
    Then references are framed as evidence, not the deliverable — the report states conclusions

  @core
  Scenario: R18 — [doc-only] The works-layout invariant carries the ADR-013 references/ exception
    Given the SKILL.md invariant that sidecars must not be renamed or added
    When the references/ cache row is read
    Then an explicit ADR-013 exception accompanies it so the row does not contradict the invariant
```
## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0062 | Live ingest caches normalized full content per reference | done |
| 0063 | Report digests sources with a compact references tail | done |
| 0064 | Document the references cache and digest contract in storm-research SKILL.md | done |
<!-- END AUTO-GENERATED -->

## Notes

## History
- 2026-08-16T17:40:07.118Z backlog → active (system)
- 2026-08-16T17:40:07.256Z active → verifying (system)
- 2026-08-16T17:42:42.469Z verifying → done (system)
