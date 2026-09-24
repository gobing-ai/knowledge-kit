---
schema_version: 1
id: "F612"
name: "Gemini TTS voice generator plugin (gemini-tts)"
status: active
priority: P2
tags: []
created_at: "2026-09-24T17:41:01.637Z"
updated_at: "2026-09-24T19:02:56.917Z"
---

# F612: Gemini TTS voice generator plugin (gemini-tts)

## Goal

Add a third voice driver, `gemini-tts`, that renders the daily VoiceScript through Google's Gemini 3.8 TTS models (`gemini-3.8-flash-tts` by default, `gemini-3.8-flash-lite-tts` optional) in the replicated `robin-news` voice, and drops into `kk-daily-ai-voice` via `vdriver: gemini` with the same `Content{format:"audio"}` contract as `voice-gen` / `omni-voice-gen` — removing the local Voicebox render dependency for operators who opt in.

## Scope

**In scope**

- New generator plugin `plugins/generations/gemini-tts` (`kind: generator`, VoiceScript DocList → audio `Content`) with the same output metadata shape as `voice-gen` (`audioPath`, `duration`, `segments[]`, `qc`, optional `mp3Path`).
- Gemini 3.8 TTS over REST (`fetch`, `GEMINI_API_KEY`); model selectable by env (flash default, flash-lite optional); no `@google/genai` dependency.
- Profile map from VoiceScript profile names (e.g. `robin-news`) to Gemini voice ids (replicated `voice_…` or prebuilt voice name); `instruct`/`emotion` mapped to `speech_metadata.style`.
- Reuse of voice-gen's pipeline (VoiceScript parsing, verify-retry, speed, concat, QC, MP3) through a Gemini-backed `VoiceboxClient` adapter (ADR-023), including transcription via a Gemini text model for fidelity and repetition QC.
- `VOICE_DRIVERS` entry `gemini: 'gemini-tts'` in `dailyGenerate`, so `vdriver: gemini` selects the driver.
- Operator runbook + helper for the one-time replicated-voice creation (source clip + zh-CN consent clip → `voice_…` id), including renewal on 1-year expiry.
- Docs: design satellite, `docs/04_DESIGN.md` index + env vars, `docs/05_FEATURES.md` row.

**Out of scope**

- Flipping the workflow default `vdriver` to `gemini` (needs an operator listening A/B).
- Changes to `voice-gen` / `omni-voice-gen` behavior.
- Streaming-transcription or diarization; ASR is a single verbatim-transcription call per segment (design D6).
- Streaming synthesis and multi-speaker dialogue mode.
- Recording the consent clip itself (operator action).

## Acceptance Criteria

```gherkin
Feature: Gemini TTS voice generator plugin (gemini-tts)

  @core
  # covers: I2, I3
  Scenario: R1 — gemini-tts renders a VoiceScript DocList into an audio Content
    Given a Doc[] JSON file wrapping a VoiceScript YAML document that voice-gen accepts
    And GEMINI_API_KEY is set and the Gemini TTS endpoint is stubbed to return 24 kHz mono s16le WAV
    When "kk executor run gemini-tts --in docs.json --out content.json" runs
    Then exit code is 0
    And content.json validates against the kk Content contract with format "audio"
    And metadata carries generator "kk:gemini-tts", audioPath, duration, segments, and qc
    And a sibling WAV exists next to content.json at <outStem>.wav

  @core
  # covers: I4, I5
  Scenario: R2 — Model variant is chosen by environment without code change
    Given GEMINI_TTS_MODEL is unset
    When the plugin renders a segment
    Then the request body names model "gemini-3.8-flash-tts"
    And with GEMINI_TTS_MODEL="gemini-3.8-flash-lite-tts" the request body names that model instead
    And an unsupported GEMINI_TTS_MODEL value exits 1 naming the allowed models

  @core
  # covers: I6, I3
  Scenario: R3 — Profile names resolve to Gemini voices through the profile map
    Given a profile map entry "robin-news" pointing at a replicated voice id "voice_abc"
    When a segment with profile "robin-news" is rendered
    Then the request speech_config carries voice "voice_abc"
    And a profile entry naming a prebuilt voice is sent as that prebuilt voice name
    And a VoiceScript naming an unknown profile exits 1 with the profile name in the error

  @core
  # covers: I3, I5
  Scenario: R4 — Segment delivery hints map to Gemini speech style
    Given a segment carrying instruct "calm news anchor" and emotion "warm"
    When the plugin builds the request
    Then speech_metadata.style contains both hints
    And a VoiceScript speed other than 1.0 is applied to the rendered WAV by the shared speed helper

  @core
  # covers: I3
  Scenario: R5 — vdriver gemini selects gemini-tts in the daily voice workflow
    Given kk-daily-ai-voice runs the daily-generate stage with vdriver "gemini"
    When dailyGenerate resolves the voice driver
    Then it invokes "kk executor run gemini-tts" with the same --in and --out paths used for voicebox
    And daily-intro, daily-quality-report, and publish stages read the resulting content unchanged
    And the workflow default vdriver stays "voicebox"

  @core
  # covers: I5
  Scenario: R6 — API failures are retried with backoff and reported actionably
    Given the Gemini endpoint answers 429 or 5xx for a segment
    When the plugin renders that segment
    Then it retries with exponential backoff up to the configured attempt cap
    And after the cap it exits 1 naming a text excerpt of the failing segment, the HTTP status, and the API error message
    And a missing GEMINI_API_KEY exits 1 before any network call, naming the variable

  @core
  # covers: I3
  Scenario: R7 — Loudness and repetition QC and MP3 output match voice-gen
    Given a rendered episode and a stubbed Gemini transcription endpoint
    When the QC audit runs
    Then qc reports fidelity, repetition, loudness-dip, and duration results in the voice-gen qc shape
    And when transcription fails or GEMINI_TTS_ASR=off the audio is kept and fidelity and repetition are reported as not measured
    And VOICE_GEN_FAIL_ON_QC=true with a failing QC report exits 1 and writes no --out file
    And with VOICE_GEN_MP3=true a sibling MP3 is produced and metadata.mp3Path is set

  @core
  # covers: I1, I6, I5
  Scenario: R8 — Operator can create the replicated robin-news voice from a source clip and a consent clip
    Given a 10 to 30 second source WAV and a zh-CN consent WAV recorded by the same speaker
    When the operator runs the gemini-tts voice-create helper with both files
    Then it validates both files are 24 kHz mono 16-bit WAV and the source length is within 10 to 30 seconds
    And it posts a stored replicated voice to the Gemini voices endpoint and prints the returned voice id
    And the plugin README documents recording, conversion, creation, the profile map update, and renewal before the 1-year expiry

  @core
  # covers: I2
  Scenario: R9 — gemini-tts meets the workspace coverage and quality gate
    When "bun run gate" runs
    Then gemini-tts per-file line and function coverage are both >= 90%
    And no test is skipped or suppressed to pass

  @edge
  # covers: I3
  Scenario: R10 — Empty input writes the notice Content without calling the API
    Given an empty Doc[] input
    When the plugin runs
    Then it writes the notice Content and exits 0 without any network request
```

## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0158 | gemini-tts plugin: Gemini VoiceboxClient adapter over the voice-gen pipeline | testing |
| 0159 | gemini-tts replicated-voice creation helper and operator runbook | todo |
| 0160 | Wire vdriver gemini into kk-daily-ai-voice and sync docs | todo |
<!-- END AUTO-GENERATED -->

## Notes

## History

- 2026-09-24T19:02:56.917Z backlog → active (system)

