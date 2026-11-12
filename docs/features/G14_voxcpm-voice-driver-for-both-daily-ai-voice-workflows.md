---
schema_version: 1
id: "G14"
name: "VoxCPM voice driver for both daily AI voice workflows"
status: done
priority: P2
tags: []
created_at: "2026-10-12T00:05:13.508Z"
updated_at: "2026-10-13T18:57:16.279Z"
---

# G14: VoxCPM voice driver for both daily AI voice workflows

## Goal

Allow both daily AI voice workflows to synthesize audio with VoxCPM and compare its quality with the current driver, without depending on the vendored reference checkout.

## Scope

- In scope: opt-in `vdriver=voxcpm` for voice1 and voice2; independently installed backend; existing Doc/VoiceScript → audio Content contract; WAV, optional MP3, QC, profile mapping, bounded worker lifecycle, installed-package portability, and driver-aware cache reuse.
- In scope: reproducible render-only comparison using identical scripts and documented voice/model settings, including a representative daily episode and listener observations.
- Hard boundary: `vendors/` is reference-only. No product import, executable path, package/path dependency, PYTHONPATH, model/reference default, symlink, fallback, copied module, build input or packaging source may resolve there. Product smoke checks must work with that directory unavailable; do not modify or delete it to test.
- Out of scope: replacing Gemini defaults or fallback policy; training/fine-tuning; a new HTTP service; cross-invocation model daemon; redesigning voice-gen or QC; automatic publishing; a promise that VoxCPM is better.

## Acceptance Criteria

```gherkin
Feature: VoxCPM voice driver for both daily AI voice workflows

  @core
  Scenario: R1 — VoxCPM produces compatible audio Content
    # covers: I1
    Given an independently installed VoxCPM backend and valid plain text or VoiceScript Doc input
    When the voxcpm-tts generator renders the input
    Then it writes valid audio Content with generator identity kk:voxcpm-tts, a playable WAV, duration and QC metadata
    And requested MP3 output and ordered VoiceScript segments and gaps use the existing voice-gen behavior

  @core
  Scenario: R2 — Daily voice1 selects VoxCPM explicitly
    # covers: I1, I3
    Given kk-daily-ai-voice.yaml with vdriver set to voxcpm
    When daily-generate runs the whole-document path
    Then it invokes voxcpm-tts through the shared executor
    And the default driver and existing driver aliases retain their behavior

  @core
  Scenario: R3 — Daily voice2 selects VoxCPM for sequential sections
    # covers: I1, I2
    Given kk-daily-ai-voice2.yaml with vdriver set to voxcpm and section_concurrency set to 1
    When daily-generate renders the opening, item sections and closing
    Then each section uses voxcpm-tts and the existing ordered join, intro, duration and publish-preparation contracts remain usable
    And completed valid sections can be reused after a later section fails

  @core
  Scenario: R4 — Audio caches distinguish the selected driver
    # covers: I2, I3, I4
    Given cached Gemini or Voicebox audio in a daily workflow work directory
    When the same script is rendered with vdriver set to voxcpm
    Then audio from the other driver is not reused as VoxCPM audio
    And repeating the same VoxCPM render reuses valid matching artifacts
    And comparison runs with different model or profile settings use separate work directories

  @core
  Scenario: R5 — VoxCPM runs without the vendor checkout
    # covers: I1, I5
    Given a packaged voxcpm-tts plugin and installed locked backend dependencies outside vendors
    And the vendors directory is unavailable to the product
    When plugin discovery and a render smoke check run outside the repository
    Then the shipped entry, worker and profile assets resolve independently of the checkout
    And no product dependency, module, build input, executable, model or reference-audio path resolves into vendors

  @core
  Scenario: R6 — VoxCPM rejects invalid inputs and unsupported profiles
    # covers: I1, I5
    Given malformed input, a missing model or reference, an unsupported profile mode, or a configured path into vendors
    When voxcpm-tts validates the request or loads its backend
    Then it reports an actionable nonzero failure without silently substituting another driver or voice
    And an old or partial output cannot establish a successful render

  @core
  Scenario: R7 — VoxCPM worker execution is bounded and cleaned up
    # covers: I1
    Given a VoxCPM generator invocation using multiple VoiceScript segments
    When rendering succeeds, the worker fails, the configured deadline expires, or the executor cancels the invocation
    Then at most one model instance is loaded per invocation and owned child processes are terminated and reaped
    And model logs cannot corrupt the worker protocol or the generator output

  @core
  Scenario: R8 — Matched audio comparison records quality and operating cost
    # covers: I2, I3, I4
    Given fixed Chinese and mixed Chinese-English script samples and a representative daily episode
    When VoxCPM and the current Gemini driver render the same text in isolated render-only work directories
    Then the comparison records script identity, model and package versions, voice settings, hardware, elapsed time, audio duration and QC findings
    And it records listener observations for pronunciation, completeness, timbre, prosody, pauses and artifacts or explicitly records that listening is pending
    And it reports better, comparable, worse or inconclusive from the available evidence without changing defaults or publishing
```

## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0256 | Add standalone VoxCPM generator using the shared voice pipeline | done |
| 0263 | Register the G14 documents in the API/library claim registry and write their claim blocks | done |
| 0258 | Compare VoxCPM and Gemini daily audio with recorded quality evidence | done |
| 0257 | Wire VoxCPM into both daily workflows with driver-aware audio reuse | done |
<!-- END AUTO-GENERATED -->

## Notes

## History

- 2026-10-12T07:51:32.821Z backlog → active (system)
- 2026-10-13T15:30:55.225Z active → verifying (system)
- 2026-10-13T18:57:16.279Z verifying → done (system)

