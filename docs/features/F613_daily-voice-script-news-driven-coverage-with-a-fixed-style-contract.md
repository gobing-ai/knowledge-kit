---
schema_version: 1
id: "F613"
name: "Daily voice script: news-driven coverage with a fixed style contract"
status: done
priority: P2
tags: []
created_at: "2026-09-25T03:47:57.152Z"
updated_at: "2026-09-25T06:11:04.781Z"
---

# F613: Daily voice script: news-driven coverage with a fixed style contract

## Goal

Make each daily `kk-daily-ai-voice` episode's spoken coverage specific to that day's news items — intro hook, per-item leads and commentary written from the items' own facts — while the host persona, tone, segment structure, and pacing stay identical across episodes. Style is held by a checked-in style contract plus the deterministic `dailynews-gen` builder; content is authored per run by a prompt-driven `script-write` agent step reading the same plan the show notes render from.

## Scope

**In scope**

- A checked-in style contract for the daily voice (host persona, register, segment roles, fixed greeting/sign-off, banned phrases, length caps).
- A new `script-write` `agent.run` state in `plugins/kk/workflows/kk-daily-ai-voice.yaml`, before `script`, whose prompt (≤1000 chars, ADR-115) points at the style contract and reads `2-plan/<date>_03_plan_plan.json` (the show-notes source) to write a per-item script-plan JSON.
- `dailynews-gen` consuming the script plan: item-id binding, per-field caps, per-episode uniqueness, banned-phrase rejection; builder keeps segment order, emotion/speed/gap tokens, normalization, chunking, and `validate-voicescript`.
- Explicit template fallback when the script plan is absent or invalid, recorded as a warning in the run report.
- Tests for the plan contract, fallback, and the misfire regression (2026-09-24 policy story receiving the chip line).

**Out of scope**

- Reading the rendered show-notes markdown itself (rendered post-audio; the plan is its source).
- Changing voice drivers, audio QC, show-notes rendering, article-write, or publish stages.
- LLM authoring the full VoiceScript YAML or its pacing/emotion tokens.
- Cross-episode similarity scoring against previous days' scripts (follow-up if in-episode checks prove insufficient).
- English-language episode styling beyond keeping the existing `en` template path working.

## Acceptance Criteria

```gherkin
Feature: Daily voice script — news-driven coverage with a fixed style contract

  @core
  # covers: I2, I5
  Scenario: R1 — A checked-in style contract defines the daily host voice
    Given the dailynews-gen plugin directory
    When the style contract file is read
    Then it names the host persona, spoken register, the fixed greeting and sign-off wording, and the per-role segment purposes (intro hook, item lead, item insight, outro)
    And it lists banned phrases including every canned insight line currently in zhInsightFor
    And it states per-field character caps for intro, lead, insight, and outro

  @core
  # covers: I1, I3, I4, I6
  Scenario: R2 — script-write authors a per-item script plan from the show-notes plan source
    Given kk-daily-ai-voice has produced 2-plan/<run_date>_03_plan_plan.json
    When the workflow reaches the script-write state
    Then an agent.run with role scribe reads that plan.json and the style contract
    And its prompt stays within 1000 characters per ADR-115
    And it writes 2-script/<run_date>_08_script-write_plan.json holding an intro, an outro, and one entry per plan item keyed by the item id with a lead and an insight
    And the transition order is article → cover (optional) → script-write → script

  @core
  # covers: I1, I5
  Scenario: R3 — dailynews-gen builds the VoiceScript from a valid script plan
    Given a valid script plan whose item ids match the plan docs
    When dailynews-gen builds the VoiceScript
    Then the intro, each item lead, each item insight, and the outro text come from the script plan
    And segment order, emotion, speed, and gap_ms values are identical to the template path for the same docs
    And fact text is still normalized and chunked at MAX_FACT_SEGMENT_CHARS
    And the output passes validate-voicescript

  @core
  # covers: I2, I5
  Scenario: R4 — Script-plan text that breaks the style contract is rejected
    Given a script plan containing a banned phrase, a field over its character cap, an insight repeated within the episode, or an item id absent from the plan docs
    When dailynews-gen validates the script plan
    Then the plan is rejected with a message naming the offending item id and rule
    And no VoiceScript text is taken from the rejected plan

  @core
  # covers: I1, I6
  Scenario: R5 — A missing or rejected script plan falls back to templates and is reported
    Given the script-write output is absent or rejected
    When the script stage runs
    Then dailynews-gen builds the VoiceScript from the existing template path
    And the stage logs a warning naming the fallback reason
    And the run report for that run_date records that the script used the template fallback

  @core
  # covers: I1, I5
  Scenario: R6 — Commentary is grounded in each item instead of keyword buckets
    Given the 2026-09-24 plan item about US–China AI safety talks that mentions chip export controls
    And a script plan whose insight for that item discusses the safety-alert channel
    When dailynews-gen builds the VoiceScript
    Then the spoken insight for that item is the script-plan insight
    And the hardware-layer canned line is absent from the episode
```

## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0162 | Wire script-write agent step into kk-daily-ai-voice and report the script source | done |
| 0161 | dailynews-gen builds the VoiceScript from a validated script plan under a style contract | done |
<!-- END AUTO-GENERATED -->

## Notes

## History

- 2026-09-25T05:59:23.567Z backlog → active (system)
- 2026-09-25T06:11:04.495Z active → verifying (system)
- 2026-09-25T06:11:04.781Z verifying → done (system)

