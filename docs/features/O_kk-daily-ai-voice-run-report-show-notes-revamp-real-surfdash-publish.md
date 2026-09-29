---
schema_version: 1
id: "O"
name: "kk-daily-ai-voice: run report, show-notes revamp, real surfdash publish"
status: active
priority: P2
tags: []
created_at: "2026-09-11T23:50:41.670Z"
updated_at: "2026-09-16T18:30:34.493Z"
---

# O: kk-daily-ai-voice: run report, show-notes revamp, real surfdash publish

## Goal

Improve the `kk-daily-ai-voice` workflow (F61) so each run produces a tunable-quality surface instead of one-off output: a run report for time/scoring calibration, a timeline-style show notes with per-item briefings, timestamps, and surfdash article URLs, and a verified real surfdash publish stamped with the `ai-news` tag — followed by a dogfood verification round.

## Scope

### In scope

- Run summary report artifact per workflow run: per-step durations (stage boundaries), scoring breakdown per QC dimension (quality/importance/urgency/impact) over plan candidates, artifact inventory; assembled from existing run artifacts at the run end.
- Publish seam reorder in `kk-daily-ai-voice.yaml`: surfdash publish → show-notes render (with per-item surfdash article URL, 1–2-sentence briefings, per-item timestamps, timeline layout) → podcast publish; episode notes feed via `metadata.showNotes`.
- `ai-news` tag on every article published to surfdash (threaded via `content.metadata.tags`).
- Verify surfdash-pub real publish wiring live (creds/env), failing loud on residue; no new transport code.
- Graceful degradation: surfdash publish failure routes show-notes to fallback (no URLs) and podcast publish continues.
- Next dogfood round of the full workflow to verify + fix.

### Out of scope

- Engine-side workflow timing ledger (report assembles timing from run logs; upgrade path noted).
- Renaming `surfdash-pub` plugin or new plugin kinds.
- Batch scoring-weights tuning itself (the report enables it; tuning is a follow-up).
- New dedicated news-article generator skill (deferred unless dogfood shows daily-article-gen can't meet the new format).
- Locale (en/ja) show-notes rewrites beyond existing translate steps.

## Acceptance Criteria

---
schema_version: 1
id: "O"
name: "kk-daily-ai-voice: run report, show-notes revamp, real surfdash publish"
status: backlog
priority: P2
tags: []
created_at: "2026-09-11T23:50:41.670Z"
updated_at: "2026-09-11T23:51:00.982Z"
---

# O: kk-daily-ai-voice: run report, show-notes revamp, real surfdash publish

### Goal

Improve the `kk-daily-ai-voice` workflow (F61) so each run produces a tunable-quality surface instead of one-off output: a run report for time/scoring calibration, a timeline-style show notes with per-item briefings, timestamps, and surfdash article URLs, and a verified real surfdash publish stamped with the `ai-news` tag — followed by a dogfood verification round.

### Scope

### In scope

- Run summary report artifact per workflow run: per-step durations (stage boundaries), scoring breakdown per QC dimension (quality/importance/urgency/impact) over plan candidates, artifact inventory; assembled from existing run artifacts at the run end.
- Publish seam reorder in `kk-daily-ai-voice.yaml`: surfdash publish → show-notes render (with per-item surfdash article URL, 1–2-sentence briefings, per-item timestamps, timeline layout) → podcast publish; episode notes feed via `metadata.showNotes`.
- `ai-news` tag on every article published to surfdash (threaded via `content.metadata.tags`).
- Verify surfdash-pub real publish wiring live (creds/env), failing loud on residue; no new transport code.
- Graceful degradation: surfdash publish failure routes show-notes to fallback (no URLs) and podcast publish continues.
- Next dogfood round of the full workflow to verify + fix.

### Out of scope

- Engine-side workflow timing ledger (report assembles timing from run logs; upgrade path noted).
- Renaming `surfdash-pub` plugin or new plugin kinds.
- Batch scoring-weights tuning itself (the report enables it; tuning is a follow-up).
- New dedicated news-article generator skill (deferred unless dogfood shows daily-article-gen can't meet the new format).
- Locale (en/ja) show-notes rewrites beyond existing translate steps.

### Acceptance Criteria

Feature: kk-daily-ai-voice run report, timeline show notes, real surfdash publish

- R1: Run report emitted with per-step timing and scoring breakdown
  ```gherkin
  Scenario: A completed daily-voice run emits a run report
    Given a `kk-daily-ai-voice` workflow run reaches its terminal state (`done`, `done-no-content`, or `failed`)
    When the pipeline finishes
    Then a run report artifact exists in the run workspace (<work_dir> summary report)
    And the report states the wall-clock duration of every executed workflow step
    And the report states the total run duration
  Scenario: The report carries the scoring breakdown of plan candidates
    Given the run's episode plan contains annotated candidates scored by quality, importance, urgency, and impact
    When the report is rendered
    Then each candidate's scores per QC dimension appear in the report
    And the report aggregates per-dimension min/max/count and count of items rejected by each minimum threshold
  ```

- R2: Show notes become a timeline with briefings, timestamps, and article URLs
  ```gherkin
  Scenario: Show notes render one briefing line per news item
    Given an episode plan with at least one QC-admitted news item
    When show notes are rendered
    Then each item shows a 1-2 sentence Chinese briefing derived from its body instead of the full body text
    And each item renders as an entry in a timeline-style layout ordered by timestamp
  Scenario: Show notes carry a timestamp per item
    Given an episode plan item has an associated timestamp source (plan metadata or voice segment timing)
    When show notes are rendered
    Then that item's entry displays a HH:MM timestamp
  Scenario: Show notes link each item's surfdash article
    Given the run's surfdash publish target succeeded and its result declares `metadata.postPath`
    When show notes are rendered
    Then each item ends with the surfdash article URL corresponding to that item
    And the final line of the show notes carries the surfdash URL for the episode article
  Scenario: Surfdash publish failed -> show notes degrade without URLs
    Given the run's surfdash publish target failed or `publish` classified `none`
    When show notes are rendered
    Then the show notes render without article URLs, using the standard full-body/original fallback layout
  ```

- R3: Episode page show notes adopt the enhanced timeline format
  ```gherkin
  Scenario: Podcast episode publishes with the timeline show notes
    Given show notes were rendered under enhanced mode with article URLs
    When the podcast publish target maps the Content
    Then the episode page's show notes content is the enhanced show-notes markdown (carried via `metadata.showNotes`)
  Scenario: Fallback keeps the legacy episode notes on degraded runs
    Given surfdash publish failed so no article URLs exist
    When the podcast publish target maps the Content
    Then the episode show notes content falls back to the article body as it is today
  ```

- R4: Every surfdash article is tagged `ai-news`
  ```gherkin
  Scenario: Article publish stamps the tag
    Given the daily AI voice workflow publishes an article to surfdash
    When the surfdash publish transport maps the Content into frontmatter
    Then the frontmatter `tags` include `ai-news`
    And no other workflow path removes the tag on later sync/scaffold-locale operations
  ```

- R5: Real surfdash publish verified live
  ```gherkin
  Scenario: Publish path is the real transport with no simulated residue
    Given the surfdash pub plugin's publish operation runs against the live postsurfing/orchestrator CLIs
    When a publish target invocation completes
    Then the result status is `published` only when a real post exists on the surfdash site
    And any missing credential (`SURFDASH_ROOT` / `POSTSURFING_BIN`) fails loudly with the existing error contract, never a silent dummy success
  ```

- R6: Workflow end-to-end dogfood round verifies the landed changes
  ```gherkin
  Scenario: Next dogfood run exercises all enhancements
    Given the enhanced pipeline lands
    When a dogfood run of `kk-daily-ai-voice` executes end to end
    Then the run report exists with step timings and scoring breakdown
    And the published episode page shows the timeline show notes with per-item timestamps, briefings, and article URLs
    And the published surfdash article carries the `ai-news` tag
    And verification records the evidence (report path, episode URL, article URL) in the wrap report
  ```

### Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0117 | Run report generator plugin and workflow report step | todo |
| 0118 | Timeline show notes with briefings, timestamps, and article URLs | todo |
| 0119 | Stamp ai-news tag on daily AI voice articles | todo |
| 0120 | Dogfood verify round of the enhanced AI-voice pipeline | todo |
<!-- END AUTO-GENERATED -->

### Notes

### History

## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0117 | Run report generator plugin and workflow report step | done |
| 0118 | Timeline show notes with briefings, timestamps, and article URLs | done |
| 0119 | Stamp ai-news tag on daily AI voice articles | done |
| 0120 | Dogfood verify round of the enhanced AI-voice pipeline | done |
| 0138 | Fix daily-ai-voice content quality and QC gating defects | done |
<!-- END AUTO-GENERATED -->

## Notes

## History

- 2026-09-12T03:28:22.174Z backlog → active (system)
- 2026-09-12T03:28:22.396Z active → verifying (system)
- 2026-09-16T18:30:34.493Z verifying → active (system)

