---
schema_version: 1
id: "G83"
name: "Daily AI Voice Ops Console: day-centric digest, debug tabs and guarded redo tools"
status: backlog
priority: P2
tags: []
created_at: "2026-11-26T00:25:31.429Z"
updated_at: "2026-11-26T00:26:34.860Z"
---

# G83: Daily AI Voice Ops Console: day-centric digest, debug tabs and guarded redo tools

## Goal

Replace the run-centric Daily AI Voice Board module with a day-centric ops console that serves the operator's daily job on the Daily AI Voice episode: one place that says what happened today across generation and every publish window, lets the operator drill into a generation or publishing detail to debug it, and offers safe tools to redo or fine-tune a particular step — built on the existing workflows, run evidence and CLI verbs, with backend enhancements only where they are justified (a shared day-digest projection, and a guarded action path that requires an ADR-035 amendment).

## Scope

**In scope**

- A new Daily AI Voice Board module that replaces `apps/board/src/daily-voice/` (same module route id), including removal of the retired voice2 fallback layout from the board.
- A day-centric daily summary (digest) covering the day's `kk-news-generate` run(s), its `kk-publish` window runs (after-generate, cn-peak, overseas-rss) and the safety outcome, with an attention list of things that need the operator.
- One shared day projection in `apps/cli/src/board/` served by new read-only reader routes (day detail and a bounded day list) and rendered by a `kk news digest` CLI verb (markdown and JSON).
- A Generation detail tab (node timeline, attempts, engine fallbacks, step timings, artifacts and bounded diagnostics) and a Publishing detail tab (window × target matrix with status, effect, receipts, errors and provenance checks).
- A History view over recent days (per-day health and per-node duration trend).
- Redo/fine-tune tools: every attention item and detail row offers a pre-filled recipe for an existing verb (`spur workflow run --from <node> --from-run <runId>`, `kk news publish --window --retry/--channels/--dummy`, step re-render verbs with allowlisted overrides, `spur workflow cancel`, `kk store release`).
- A guarded, default-off action plane on the KK loopback reader that executes those recipes (closed allowlist, preview then single-use confirm token, single-flight per day, append-only audit log, typed confirmation for live sends), preceded by an ADR-035 amendment.
- Updates to `docs/04_DESIGN.md`, `docs/03_ARCHITECTURE.md`, `docs/05_FEATURES.md` and a design satellite for the console.

**Out of scope**

- Editing script/article text in the browser before re-render (filed as a follow-up feature).
- Pushing the digest to the operator by notification or email (filed as a follow-up feature).
- Keeping voice2-era (`kk-daily-ai-voice2`, `kk-daily-ai-voice`) days readable in the new module — excluded by the operator's "give up existing one".
- Changing the Collect or IT Content modules, the Spur Board host, or the workflows' own node graphs.
- New execution logic: every action launches an existing verb; Spur keeps run authority.
- Multi-user authentication or remote (non-loopback) access.

## Acceptance Criteria

```gherkin
Feature: Daily AI Voice Ops Console: day-centric digest, debug tabs and guarded redo tools

  @core
  Scenario: R1 — The new day-centric module replaces the old Daily AI Voice module
    # covers: I1, I2, I14
    Given the Board is started from this checkout
    When the operator opens the Daily AI Voice module at its existing route id
    Then the new console renders with the Today, Generation, Publishing, History and Actions log tabs
    And no code path for the retired kk-daily-ai-voice2 or kk-daily-ai-voice layout remains in the board module
    And the shared contract no longer names a retired Daily workflow that only the old module consumed

  @core
  Scenario: R2 — One shared day projection joins generation, publish windows and safety
    # covers: I3, I4, I9
    Given the day 20261125 has one kk-news-generate run and kk-publish runs for windows after-generate, cn-peak and overseas-rss bound to the same work directory
    When the day projection is built for 20261125
    Then it returns one digest with the generation run, every earlier generation attempt, one entry per publish window and the safety verdict
    And every figure names the run artifact or Spur run state that supplied it
    And a publish window with no recorded run reads as not run, never as succeeded

  @core
  Scenario: R3 — Today tab answers what happened and what needs the operator
    # covers: I2, I3, I4
    Given the 20261125 digest where shipinhao-pub.audio failed with effect none in window after-generate
    When the operator opens the Today tab for 20261125
    Then the tab shows the day's overall status, generation outcome and per-window publish status
    And an attention list orders items by severity and names the failed target, its window and its recorded error
    And a day with nothing failed shows an explicit all-clear rather than an empty list

  @core
  Scenario: R4 — The digest is available from the CLI as markdown and JSON
    # covers: I3, I4, I11
    Given the same day projection used by the Board
    When the operator runs kk news digest --run-date 20261125 and kk news digest --run-date 20261125 --json
    Then the markdown and the JSON report the same status, attention items and window results as the Today tab
    And a missing day exits nonzero with an actionable message

  @core
  Scenario: R5 — Generation detail tab shows node-level evidence for debugging
    # covers: I5
    Given a generation run whose voice engine fell back from its first engine to gemini
    When the operator opens the Generation tab and selects that run
    Then every workflow node shows its producer state, attempts with timing, and step duration from step-timing.json
    And the fallback chain shows which engine produced the audio and which attempts failed
    And available artifacts open through the reader while unavailable ones show their availability reason

  @core
  Scenario: R6 — Publishing detail tab shows window by target evidence for debugging
    # covers: I6
    Given windows after-generate and cn-peak recorded for 20261125
    When the operator opens the Publishing tab
    Then a window by target matrix shows tier, mode, status, delivery effect, URL and recorded error per target
    And each window shows its recorded outcome and provenance checks for date, bundle, parent run and digest
    And receipt and plan references render as text, never as followed links

  @core
  Scenario: R7 — History view shows recent day health and node duration trend
    # covers: I2, I10
    Given recorded days from 20261115 to 20261125
    When the operator opens the History tab
    Then each day shows its overall status and publish window outcomes
    And a per-node duration trend over those days is shown from recorded run evidence
    And selecting a day opens that day in the Today tab

  @core
  Scenario: R8 — Every attention item and detail row offers a pre-filled redo recipe
    # covers: I7, I8, I9, I13
    Given a failed publish target, a failed generation node and a completed voice step
    When the operator expands each row
    Then the failed target offers kk news publish --run-date 20261125 --window after-generate --retry --channels shipinhao-pub with a dry-run variant
    And the failed node offers spur workflow run kk-news-generate.yaml --from <node> --from-run <runId>
    And the voice step offers its re-render verb with only allowlisted override flags
    And every recipe is copyable and contains no secret or free-text field

  @core
  Scenario: R9 — The action plane decision is recorded before any write path ships
    # covers: I11, I12
    Given the KK reader serves GET, HEAD and OPTIONS only under ADR-035
    When the action plane is designed
    Then docs/00_ADR.md carries a dated ADR-035 amendment that states why the reader gains an action endpoint, that Spur keeps run authority and that only existing verbs are launched
    And the design satellite for the console defines the action allowlist and its safety envelope

  @core
  Scenario: R10 — Actions execute only after a preview and a single-use confirmation
    # covers: I7, I8, I10, I11
    Given the action plane is enabled in config and the operator chooses retry failed targets for window after-generate
    When the console requests the action
    Then the reader first returns the resolved command and its dry-run output with a single-use confirm token
    And the command runs only when that token is presented once, and a reused or expired token is refused
    And the spawned run id is returned and the console follows that run until it is terminal
    And an append-only audit line records the action, its argv, the operator origin, the run id and the result

  @edge
  Scenario: R11 — The action plane refuses unsafe requests
    # covers: I10, I12
    Given the action plane endpoint
    When a request arrives with actions disabled, an action kind outside the allowlist, a non-loopback host, a foreign origin, a second action while one runs for the same day, or a live publish without typed confirmation
    Then the reader refuses it with a bounded diagnostic and launches nothing
    And the refusal is written to the audit log

  @edge
  Scenario: R12 — Unknowns and missing evidence stay explicit across the console
    # covers: I2, I9
    Given a day whose publish runs predate work directory binding, or whose report artifacts are missing
    When any tab renders that day
    Then the affected figures show an unknown marker with its reason
    And no figure is rendered as zero or success in place of missing evidence

  @core
  Scenario: R13 — Surface docs and end-to-end evidence ship with the change
    # covers: I1, I9, I10
    Given the implemented console, reader routes, CLI digest and action plane
    When the change is reviewed
    Then docs/04_DESIGN.md, docs/03_ARCHITECTURE.md, docs/05_FEATURES.md and the console design satellite describe the routes, CLI verb, tabs and action envelope
    And a repeatable end-to-end test drives the Board against fixture days and records a committed artifact of the Today, Generation, Publishing and History renders and one previewed and confirmed dummy action
```

## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0441 | Daily AI Voice Generation and Publishing detail tabs | todo |
| 0440 | Daily AI Voice console module shell, Today and History tabs, retire the old module | todo |
| 0442 | Daily AI Voice guarded action plane and Actions log tab | todo |
| 0439 | Daily AI Voice day projection, /api/days reader routes and kk news digest | todo |
| 0443 | Daily AI Voice console end-to-end evidence and docs sync | todo |
<!-- END AUTO-GENERATED -->

## Notes

## History
