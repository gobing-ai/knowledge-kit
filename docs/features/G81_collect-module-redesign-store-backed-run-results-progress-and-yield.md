---
schema_version: 1
id: "G81"
name: "Collect module redesign: store-backed run results, progress and yield"
status: active
priority: P2
tags: []
created_at: "2026-10-17T05:00:32.680Z"
updated_at: "2026-10-17T06:44:51.881Z"
---

# G81: Collect module redesign: store-backed run results, progress and yield

## Goal

Make the Collect Board module answer the operator's two real questions about `kk-collect` — **what did this run produce** and **is collection healthy over time** — by reading the facts already recorded in `.works/kk.db` (`collect_runs`, `items`, `labels`, `selections`) through a read-only reader seam, joined with Spur's own run history, and presenting them as a run funnel, cross-run trends, label quality and downstream yield instead of a list of artifact files.

## Scope

**In scope**

- Dated ADR-035 amendment and `workflow-board-modules.md` §9 revision: the Collect module may read the kk store **read-only** (`openStore({migrate:false})`, no writes, no DDL) from the loopback KK reader; artifacts-only stays the rule for the other two modules.
- Reader store routes (loopback, GET only, `schemaVersion: 1`): a Collect overview, a per-run store detail and a paged per-run item list. Bounded `page` and enumerated filter query parameters are allowed on these routes only; all other routes keep refusing queries.
- **Overview tab (new default):** cadence health (last stored collection vs the 6 h schedule, Spur runs with no store row shown with their Spur outcome — failed, in progress, or done without a store row — never as zero), per-run trend of collected/inserted/updated by source, label fallback rate per run, downstream yield (selected / published / dropped items first seen in each collect run).
- **Run detail:** stage funnel collected → stored (inserted / updated / unchanged) → labeled (distinct items and label rows, by label source heuristic / model / default) → downstream selected / published; per-source counts; decision × value histogram with confidence mix (from `labels_current` for effective values and the run's own label rows for the run's work); the shipped artifact downloads.
- **Items browser:** paged items seen in the run (new vs re-seen), each with title, link, source, story id, effective labels and selection status; filters by source, new/re-seen, decision value and selection status. Titles/URLs are rendered as text; item bodies are never served.
- Explicit availability: a missing, locked, unreadable or schema-newer store is an `unavailable` diagnostic in the affected panel while Spur-backed progress and config keep working.
- Execution progress and Workflow Config Summary tabs keep their shipped behaviour; run selection and deep links (`?run=&tab=`) extend to the new tabs.
- `docs/04_DESIGN.md` (`kk board` reader surface) updated in the same commit as the routes; installed-Board browser verification against the real `.works/kk.db`.

**Out of scope**

- Any write to the store, any execution control (start/retry/cancel), relabelling or selection editing from the Board.
- Changing `kk-collect.yaml`, the store schema or `kk store ingest` timing semantics (the `collect_runs.started_at == finished_at` stamp is documented and bypassed by Spur timing, not fixed here).
- Store-backed views for Daily AI Voice or IT Content modules.
- Item body/full-text display, search engine, exports beyond the existing artifact downloads, charts library additions beyond what the board workspace already ships.
- Remote / multi-user access.

## Acceptance Criteria

```gherkin
Feature: Collect module redesign — store-backed run results, progress and yield

  @core
  Scenario: R1 — The reader opens the kk store read-only
    Given the KK board reader is serving a project whose .works/kk.db exists
    When any Collect store route is requested
    Then the store is opened with migrations disabled and no statement writes, migrates or creates tables
    And the store file's schema and row counts are byte-for-byte unchanged after the request
    And the other workflow modules' routes never open the store

  @core
  Scenario: R2 — An unavailable store degrades only the store panels
    Given the store file is missing, unreadable, locked past the busy timeout or newer than the reader's schema
    When the Collect overview or run store detail is requested
    Then the response is 200 with availability unavailable and a bounded diagnostic code
    And no count is reported as zero in place of the missing data
    And Execution progress and Workflow Config Summary still render from Spur and the capture

  @core
  Scenario: R3 — Overview shows cadence health across Spur runs and store rows
    Given Spur run history for kk-collect and collect_runs rows keyed by the same run id
    When the operator opens the Collect Overview tab
    Then each listed run shows its Spur status and timing beside its store counts
    And a run without a collect_runs row is labelled no store row with its Spur outcome, never shown as zero collected
    And the panel states the time since the last stored collection against the 6 hour schedule

  @core
  Scenario: R4 — Overview trends collection, label fallback and downstream yield per run
    Given at least two collect runs with store rows
    When the Overview tab renders
    Then it shows per run the collected count by source and the inserted and updated counts
    And it shows per run the share of that run's label rows whose source is default
    And it shows per run how many items first seen in that run were later selected, published or dropped

  @core
  Scenario: R5 — Run detail shows the stage funnel
    Given a selected collect run with a store row
    When the operator opens that run's detail
    Then the funnel shows collected per source, inserted, updated and unchanged, distinct items labeled and label rows by source heuristic, model and default, then items selected and published downstream
    And each stage names whether it counts items or label rows
    And wall-clock duration comes from Spur run detail, not from collect_runs timestamps

  @core
  Scenario: R6 — Run detail shows label quality by decision
    Given a selected collect run whose label rows cover several decisions
    When the label quality panel renders
    Then for each decision it shows the value histogram of the run's own label rows with HIGH, MEDIUM and LOW confidence counts
    And it distinguishes the run's own rows from the effective value currently resolved by labels_current

  @core
  Scenario: R7 — Items browser pages and filters a run's items
    Given a selected collect run with stored items
    When the operator opens the items browser and changes page or filters by source, new or re-seen, decision value or selection status
    Then the reader returns at most one bounded page of items matching only enumerated filter values
    And each row shows title, link, source, story id, effective labels and selection status as plain text
    And an unknown filter value or out-of-range page is refused with 400 and item bodies are never returned

  @core
  Scenario: R8 — Store routes keep the reader's security envelope
    Given the reader's loopback, origin, method and identity checks
    When a store route is called from a non-loopback host, a forbidden origin, a non-GET method or with an unknown run id
    Then it is refused with the same status codes as the shipped routes
    And query parameters are accepted only on the store routes that declare them

  @core
  Scenario: R9 — Navigation keeps deep links and the shipped tabs
    Given the Collect module with run selection in the URL
    When the operator switches between Overview, Run detail, Items, Execution progress and Workflow Config Summary
    Then the run and tab are reflected in ?run=&tab= and survive reload
    And Execution progress and Workflow Config Summary behave as shipped

  @core
  Scenario: R10 — Decision and surface docs are updated with the change
    Given the shipped artifacts-only rule for the Collect module
    When the store-backed reader routes ship
    Then docs/00_ADR.md carries a dated ADR-035 amendment allowing read-only store reads for Collect only
    And workflow-board-modules.md and docs/04_DESIGN.md describe the routes, shapes and query parameters in the same commit

  @core
  Scenario: R11 — Installed Board verification against the real store
    Given a built board and a running reader over the project's .works/kk.db
    When the Collect module is opened in the installed Spur Board in a browser
    Then Overview, Run detail and Items render real runs with no console errors
    And a repeatable verification artifact records the checked runs and screenshots
```

## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0307 | Serve read-only Collect store projections from the KK board reader | done |
| 0308 | Redesign the Collect Board module with Overview, Run detail and Items tabs | done |
| 0309 | Verify the redesigned Collect module in the installed Spur Board against the real store | done |
<!-- END AUTO-GENERATED -->

## Notes

## History

- 2026-10-17T06:44:51.881Z backlog → active (system)

