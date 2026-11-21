---
schema_version: 1
id: "G16"
name: "VibeVoice voice driver (vibe-voice) for TTS workflows"
status: done
priority: P2
tags: []
created_at: "2026-11-21T07:38:01.755Z"
updated_at: "2026-11-21T17:38:36.873Z"
---

# G16: VibeVoice voice driver (vibe-voice) for TTS workflows

## Goal

Allow knowledge-kit TTS workflows and CLI voice-generation steps to synthesize audio with Microsoft VibeVoice through an opt-in `vibe-voice` driver (`kk:vibe-voice-tts`) and switch smoothly between `vibe-voice` and existing drivers without depending on the vendored reference checkout.

## Scope

- In scope: standalone generator plugin `plugins/generations/vibe-voice-tts` (`kk:vibe-voice-tts`) reusing `@gobing-ai/voice-gen`'s `processGeneratorIO` pipeline via a TypeScript `VoiceboxClient` adapter and an isolated, invocation-scoped uv Python NDJSON worker (`vibevoice==0.0.1` on Python 3.12).
- In scope: voice profile registry (`profiles.json` / `VIBEVOICE_PROFILES_PATH`) supporting reference-WAV voice cloning (`reference_wav_path` with `microsoft/VibeVoice-1.5B`), prefilled streaming prompt caches (`prompt_pt_path` with `microsoft/VibeVoice-Realtime-0.5B`), and an instruct placeholder guard for multi-segment consistency.
- In scope: opt-in driver selection (`vdriver=vibe-voice` / `vdriver=vibevoice`, `kk news generate-voice --engine vibe-voice`, and Spur Board settings allowlist), single-worker batch section rendering (`--batch` / `VIBEVOICE_BATCH_MANIFEST`), driver-aware section/whole-document cache isolation, and installed-package asset bundling.
- Hard boundary: `vendors/VibeVoice` is reference-only. No product import, executable path, package/path dependency, `PYTHONPATH`, model/reference default, symlink, fallback, copied module, build input, or packaging source may resolve into `vendors/`.
- Out of scope: replacing existing workflow default drivers or fallback chains automatically; model fine-tuning or ASR capabilities; running a persistent HTTP daemon across invocations; redesigning `@gobing-ai/voice-gen` or QC.

## Acceptance Criteria

```gherkin
Feature: VibeVoice voice driver (vibe-voice) for TTS workflows

  @core
  Scenario: R1 — VibeVoice generator produces compatible audio Content
    # covers: I1, I3
    Given an independently installed VibeVoice backend and valid plain text or VoiceScript Doc input
    When the vibe-voice-tts generator renders the input
    Then it writes valid audio Content with generator identity kk:vibe-voice-tts, a playable WAV, duration and QC metadata
    And requested MP3 output and ordered VoiceScript segments and gaps use the existing voice-gen behavior

  @core
  Scenario: R2 — Daily and news workflows select VibeVoice explicitly and switch cleanly
    # covers: I1, I3
    Given dailyGenerate or kk news generate-voice with driver or engine set to vibe-voice
    When the whole-document or sequential section synthesis path runs
    Then it invokes vibe-voice-tts through the shared executor and supports single-worker batch section rendering
    And the existing ordered join, intro, duration, board settings allowlist and default driver behavior remain intact

  @core
  Scenario: R3 — Audio caches distinguish VibeVoice from other voice drivers
    # covers: I3
    Given cached audio from VoxCPM, Gemini, OmniVoice or Voicebox in a workflow work directory
    When the same script is rendered with vdriver or engine set to vibe-voice
    Then audio from any other driver is not reused as VibeVoice audio
    And repeating the same VibeVoice render reuses valid matching whole-document or section artifacts

  @core
  Scenario: R4 — VibeVoice runs without the vendored reference checkout
    # covers: I1, I2
    Given a packaged vibe-voice-tts plugin and installed locked backend dependencies outside vendors
    And the vendors directory is unavailable to the product
    When plugin discovery and a render smoke check run outside the repository
    Then the shipped entry, worker and profile assets resolve independently of the checkout
    And no product dependency, module, build input, executable, model or reference-audio path resolves into vendors

  @core
  Scenario: R5 — VibeVoice rejects invalid inputs, unanchored multi-segment profiles and vendor paths
    # covers: I1, I2, I3
    Given malformed input, a missing model or voice asset, an instruct placeholder used across multiple segments, or a configured path into vendors
    When vibe-voice-tts validates the request or loads its backend
    Then it reports an actionable nonzero failure without silently substituting another driver or voice
    And an old or partial output cannot establish a successful render

  @core
  Scenario: R6 — VibeVoice worker execution is bounded and cleaned up
    # covers: I1, I3
    Given a VibeVoice generator invocation across single or batched VoiceScript renders
    When rendering succeeds, the worker fails, the configured deadline expires, or the process receives a termination signal
    Then at most one model instance is loaded per worker invocation and owned child processes are terminated and reaped
    And native library or model logs on fd 1 cannot corrupt the NDJSON worker protocol or generator output
```

## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0420 | Add standalone vibe-voice-tts generator plugin with isolated uv Python worker | done |
| 0421 | Wire vdriver vibe-voice across dailyGenerate, kk news generate-voice, board manifest and docs | done |
<!-- END AUTO-GENERATED -->

## Notes

## History

- 2026-11-21T09:04:31.199Z backlog → active (system)
- 2026-11-21T09:49:18.411Z active → verifying (system)
- 2026-11-21T17:38:36.873Z verifying → done (system)

