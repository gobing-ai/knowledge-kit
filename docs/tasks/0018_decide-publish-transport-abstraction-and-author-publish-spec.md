---
template: standard
schema_version: 1
name: "Decide publish transport abstraction and author publish spec"
description: ""
status: todo
type: task
profile: standard
feature_id: E2
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: "2026-07-30T23:42:20.492Z"
updated_at: "2026-07-30T23:56:26.094Z"
---

## 0018. Decide publish transport abstraction and author publish spec

### Background



### Requirements
- R1. A common transport interface is defined covering FileCli and Browser/Playwright; Surfdash fits FileCli and a browser target fits without contract changes (E1 audit input).
- R2. Content→frontmatter mapping conventions are defined against Surfing's frontmatter requirements (E1).
- R3. Result conventions are defined — ok/target/url/id/message/error usage plus every failure mode with an explicit Result and exit-code contract.
- R4. `docs/design/publish-plugin-specification.md` authored citing ingestion spec §1 (no re-derivation); `docs/04_DESIGN.md` §6 index row added in the same commit (T3).
### Acceptance Criteria
```gherkin
Feature: Publish design and test harness

  Scenario: Transport abstraction is specified
    Given the E1 audit (File/CLI vs Browser transports)
    When the design defines a common transport interface
    Then Surfdash (FileCli) and a browser target both fit without contract changes

  Scenario: Content-to-frontmatter mapping is specified
    Given the Content schema and Surfing frontmatter requirements (E1)
    When the design defines the mapping conventions
    Then a plugin author can map any Content to target frontmatter fields

  Scenario: Result conventions are specified
    Given the Result schema and fail-loud mandate
    When the design defines ok, target, url, and error usage
    Then success and every failure mode have an explicit Result and exit-code contract

  Scenario: Design cites the generic contract
    Given the generic plugin-instance contract (ingestion spec section 1)
    When the publish spec is authored
    Then it cites section 1 for manifest, invocation, secrets, and exit-code rules

  Scenario: Design is validated against the platform as built
    Given kindContract('publish') and runInvoke as implemented
    When the design is reviewed against them
    Then no requirement contradicts the platform without an ADR entry
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design

<!-- Chosen approach, key tradeoffs, invariants, and impacted surfaces. Keep snippets short. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History
