---
schema_version: 1
id: "F5"
name: "Solo-podcast workflow (voice-gen dogfood)"
status: done
priority: P2
tags: []
created_at: "2026-08-20T05:11:48.508Z"
updated_at: "2026-08-20T06:23:14.595Z"
---

# F5: Solo-podcast workflow (voice-gen dogfood)

## Goal
Ship a `kk-solo-podcast` product workflow that turns given text plus a target duration into a Voicebox WAV by authoring a validated VoiceScript and invoking `voice-gen` behind existing Spur HITL — no new skill, HITL kind, `kk` noun, or `/workflow-run` profile.
## Scope
- In:
  - `plugins/kk/workflows/kk-solo-podcast.yaml` as a state-machine product workflow (F4 YAML home)
  - XOR `topic` / `input_file` prepare into `${work_dir}` (`brief.md`, `1-briefing/`, `2-outline/`, `3-script/`, `4-audio/`)
  - `agent.run` steps for understand, outline-write, and script-write (`role: scribe`, `input:` only)
  - Outline HITL via existing `hitl.select` over `a|b|c` (skip when `vars.outline` is set); script HITL via `hitl.confirm` plus bounded `hitl.input` revise (cap 3)
  - Tiny helper `plugins/kk/lib/validate-voicescript.ts` that parses YAML/JSON and calls shipped `validateVoiceScript` (not under `plugins/kk/scripts/` — `shipped-script-isolation`)
  - Wrap approved VoiceScript as `Doc[]` and `kk executor run voice-gen` → `content.json` plus sibling `.wav`
  - Target duration as a script-authoring word/char budget plus a post-generate `metadata.duration` check (fail-loud outside 0.5×–2×)
  - Static YAML-invariant tests (kk-itc grain), `spur workflow validate`, and `--dry-run`
  - Design satellite `docs/design/kk-solo-podcast.md` and `04` index row
- Out:
  - MP3 / ffmpeg transcode
  - A duration (or length) flag on `voice-gen`; any D5 plugin contract change
  - A fat `solo-podcast` / `voice-script` agent skill
  - A `/workflow-run` profile for this workflow
  - A new Spur `hitl.*` kind; a new `kk` first-layer noun (ADR-011)
  - Multi-host / interview podcast; audio publish
  - Live Voicebox in CI (dogfood is local; CI is static + dry-run)
  - Reopening feature D5
## Acceptance Criteria
```gherkin
Feature: Solo-podcast workflow (voice-gen dogfood)

  @core
  Scenario: R1 — Product YAML lives at plugins/kk/workflows/kk-solo-podcast.yaml
    Given knowledge-kit product workflows live only under plugins/kk/workflows
    When F5 ships
    Then plugins/kk/workflows/kk-solo-podcast.yaml exists
    And its name is kk-solo-podcast and its kind is state-machine
    And no solo-podcast.yaml exists under .spur/workflows

  @core
  Scenario: R2 — Prepare XOR topic or input_file into a works layout
    Given a topic sentence XOR a markdown input file and a work_dir
    When the prepare state runs
    Then work_dir/brief.md is written from exactly one of those inputs
    And the briefing, outline, script, and audio subdirectories exist
    And setting both inputs or neither fails with a named XOR recovery

  @core
  Scenario: R3 — Outline HITL is hitl.select unless outline is pre-set
    Given outline-option-a.md and outline-option-b.md exist under work_dir/2-outline
    When vars.outline is empty
    Then outline-select pauses with hitl.select over a, b, and c
    And the chosen file is copied to outline-approved.md
    And when vars.outline is set, outline-select is skipped and that option is committed

  @core
  Scenario: R4 — Approved outline becomes a validated VoiceScript
    Given an approved outline, target_duration_min, and a resolvable voice_profile
    When script-write and script-validate run
    Then work_dir/3-script/voicescript.yaml is a VoiceScript with a non-empty segments array
    And validateVoiceScript accepts it
    And the spoken budget is derived from target_duration_min (words for space-delimited languages, characters for CJK)

  @core
  Scenario: R5 — Script HITL gates live TTS
    Given a validated VoiceScript
    When script-review runs
    Then the operator hitl.confirm the script before generate
    And a rejected script can be revised via hitl.input at most three times

  @core
  Scenario: R6 — Generate invokes voice-gen and writes sibling WAV
    Given an approved VoiceScript
    When generate runs
    Then kk executor run voice-gen is invoked with Doc[] --in and Content --out
    And the Content has format audio
    And a sibling .wav exists at metadata.audioPath

  @core
  Scenario: R7 — Target length is a script budget and a duration post-check
    Given vars.target_duration_min and an approved VoiceScript
    When generate writes content.json
    Then the workflow does not pass a duration field to voice-gen
    And the run reads metadata.duration from content.json
    And a value below 0.5 times or above 2 times the target seconds fails the run

  @core
  Scenario: R8 — No new skill, HITL kind, kk noun, or workflow-run profile
    Given the F5 delivery
    When the repository is inspected
    Then agent.run steps use input and role only
    And only hitl.select, hitl.confirm, and hitl.input appear
    And /workflow-run still lists only kk-storm-research and kk-itc as profiles
    And no plugins/kk/skills/solo-podcast directory exists

  @edge
  Scenario: R9 — Missing or unsafe inputs fail loud
    Given both topic and input_file set, or neither, or an empty voice_profile without VOICEBOX_DEFAULT_PROFILE, or invalid VoiceScript YAML
    When the corresponding state runs
    Then the run stops with a named recovery
    And generate is not invoked

  @edge
  Scenario: R10 — Existing brief.md is not overwritten without force
    Given work_dir/brief.md already exists
    When prepare runs with force not equal to true
    Then the run fails naming the path
    And the existing file is unchanged
```
## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0071 | Ship kk-solo-podcast workflow and VoiceScript validator | todo |
<!-- END AUTO-GENERATED -->

## Notes

## History
- 2026-08-20T06:21:39.463Z backlog → active (system)
- 2026-08-20T06:22:54.732Z active → verifying (system)
- 2026-08-20T06:23:14.595Z verifying → done (system)
