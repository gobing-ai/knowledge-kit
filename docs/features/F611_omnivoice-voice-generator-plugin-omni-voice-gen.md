---
schema_version: 1
id: "F611"
name: "OmniVoice voice generator plugin (omni-voice-gen)"
status: active
priority: P2
tags: []
created_at: "2026-09-13T05:52:20.651Z"
updated_at: "2026-09-13T19:42:26.098Z"
---

# F611: OmniVoice voice generator plugin (omni-voice-gen)

## Goal

Ship `plugins/generations/omni-voice-gen` — a Python (make + uv) generator plugin backed by the PyPI
`omnivoice` TTS package — as a drop-in alternative to `plugins/generations/voice-gen` (Voicebox backend).
Motivation: voice-gen output shows stochastic artifacts (loudness dents / flaws) traced to Voicebox and its
backend models; the pipeline needs a second, independently-backed TTS generator so `kk-daily-ai-voice` (and any
other pipeline) can swap TTS backends by plugin name alone.

Drop-in means: identical executor surface (`--in Doc[]` -> `--out Content`), identical VoiceScript input
contract (parse/merge/validate + precedence rules), and identical Content metadata shape
(`audioPath`, `mp3Path`, `duration`, `segments[]`, `qc`). The only required pipeline change is the plugin
name, exposed as a `voice_generator` workflow var.

Operator decisions (idea-eval 2026-09-12):
- Name: `omni-voice-gen` (not "omini").
- Backend: PyPI `omnivoice` package; `vendors/OmniVoice` is reference-only — never write to it, never
  reference it from the plugin.
- VoiceScript fields OmniVoice cannot honor (`engine`, `personality`, `effects_chain`, `effect_preset`):
  warn loudly on stderr and ignore; never fail, never silently drop.
- Python tooling: make + uv; pytest; per-file line AND function coverage >= 90%.

## Scope

- In:
  - New plugin `plugins/generations/omni-voice-gen`: Python package, `plugin.json` (`kind: generator`),
    executable entry (shebang) satisfying the kk `--in`/`--out` spawn contract; make + uv build; pytest suite.
  - VoiceScript parse/merge/validate ported from voice-gen with identical precedence (segment > speaker >
    script default > env > doc metadata) and identical limit constants.
  - Profile registry (JSON): profile name -> `ref_audio`+`ref_text` | saved voice-clone prompt (`.pt`) |
    voice-design `instruct`. `VOICEBOX_DEFAULT_PROFILE` and Doc `metadata.voiceProfile` honored for drop-in
    compatibility; unknown profile exits 1 naming the profile.
  - Per-segment generation through one in-process OmniVoice model load per run; verify-retry loop
    (transcription-fidelity floor + loudness-dip detection -> regenerate, max 2 retries) mirroring voice-gen.
  - WAV concat with `gap_ms` silence; QC audit (repetition, duration anomaly, transcription fidelity,
    loudness dip) with `metadata.qc` parity; `VOICE_GEN_FAIL_ON_QC` honored.
  - Env parity: `VOICE_GEN_MP3` (ffmpeg WAV->MP3 sibling), `VOICE_GEN_MAX_RUN_MS`, `VOICE_GEN_FAIL_ON_QC`,
    `VOICEBOX_DEFAULT_PROFILE`; OmniVoice-specific knobs under `OMNIVOICE_*` (model, device, speed).
  - `kk-daily-ai-voice.yaml`: new `voice_generator` var selecting `voice-gen` | `omni-voice-gen` in the
    `generate` state (default stays `voice-gen`).
  - `docs/design/omni-voice-gen.md` spec + `docs/04_DESIGN.md` surface sync (same commit, T3).
  - Fix-in-new (bugs found in voice-gen, fixed only in omni-voice-gen): concat gap placement depends on
    `gapsMs[0] === 0` (`concat.ts`); `metadata.duration` includes gaps while `qc.totalDuration` does not
    (duration accounting inconsistency).
- Out:
  - Any change to `plugins/generations/voice-gen` itself (issues are reported, not fixed there).
  - Any write to or runtime reference of `vendors/OmniVoice` (reference-only).
  - DSP implementation of `effects_chain` / `effect_preset` (warn-and-ignore per decision).
  - OmniVoice model provisioning automation beyond documented `uv sync` + first-run HF download.

## Acceptance Criteria

```gherkin
Feature: OmniVoice voice generator plugin (omni-voice-gen)

  Scenario: Drop-in CLI surface
    Given a Doc[] JSON file wrapping a VoiceScript YAML document that voice-gen accepts
    When "kk executor run omni-voice-gen --in docs.json --out content.json" runs with a configured profile registry
    Then exit code is 0
    And content.json validates against the kk Content contract with format "audio"
    And metadata carries generator "kk:omni-voice-gen", audioPath, duration, segments, and qc
    And a sibling WAV exists next to content.json at <outStem>.wav

  Scenario: Profile registry resolution
    Given a VoiceScript segment whose profile name exists in the registry (ref_audio, .pt prompt, or instruct form)
    When the plugin renders the segment
    Then the resolved OmniVoice voice inputs match the registry entry
    And a VoiceScript naming an unknown profile exits 1 with the profile name in the error

  Scenario: Incompatible VoiceScript fields warn and are ignored
    Given a VoiceScript carrying engine, personality, effects_chain, or effect_preset
    When the plugin runs
    Then it exits 0, renders audio, and prints a stderr warning naming every ignored field

  Scenario: Verify-retry loop mirrors voice-gen
    Given a rendered segment whose transcription fidelity is below the floor or which has a loudness dip
    When the verify step runs
    Then the segment is regenerated up to 2 times before being accepted or failing the run
    And VOICE_GEN_FAIL_ON_QC=true with a failing QC report exits 1 and writes no --out file

  Scenario: Empty input and MP3 parity
    Given an empty Doc[] input
    When the plugin runs
    Then it writes the notice Content and exits 0 without loading the model
    And with VOICE_GEN_MP3=true a sibling MP3 is produced via ffmpeg and metadata.mp3Path is set

  Scenario: Coverage and quality gate
    When "make coverage" (uv + pytest) runs in plugins/generations/omni-voice-gen
    Then per-file line coverage and function coverage are both >= 90%
    And no test is skipped or suppressed to pass

  Scenario: Workflow backend swap
    Given kk-daily-ai-voice.yaml with voice_generator=omni-voice-gen
    When the generate state runs
    Then it invokes omni-voice-gen via the same kk executor run seam with no other YAML change
```

## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0121 | omni-voice-gen: plugin scaffold + kk contract layer | wip |
| 0122 | omni-voice-gen: VoiceScript parse/merge/validate with warn-ignore | todo |
| 0123 | omni-voice-gen: profile registry + OmniVoice backend adapter | todo |
| 0124 | omni-voice-gen: audio concat, loudness-dip, QC audit, mp3 | todo |
| 0125 | omni-voice-gen: pipeline orchestration + verify-retry + coverage gate | todo |
| 0126 | omni-voice-gen: workflow voice_generator var + docs sync | todo |
<!-- END AUTO-GENERATED -->

## Notes

Feasibility evidence (2026-09-12 discovery):
- kk executor spawns non-.ts/.js plugin entries directly as executables (apps/cli/src/invoke.ts
  pluginEntryCmd), so a Python entry with a shebang satisfies the ADR-006 --in/--out contract unchanged.
- OmniVoice (PyPI `omnivoice`) covers the Voicebox backend surface used by voice-gen: voice cloning
  (ref_audio/ref_text, savable .pt prompt), voice design (instruct — 1:1 with VoiceScript instruct/emotion),
  zh/en/ja + 600 languages, internal long-text chunking with crossfade (audio_chunk_duration /
  audio_chunk_threshold), speed/duration knobs, bundled Whisper ASR (reused for transcription-fidelity QC).
- No OmniVoice seed parameter: explicit seed maps to torch.manual_seed; verify retries resample naturally
  (diffusion decoding is stochastic by default).

Issues found in voice-gen during discovery (report-only; fixed in omni-voice-gen per operator instruction):
1. concat.ts gap placement: `gapsMs[0] === 0 ? gapsMs[i] : gapsMs[i-1]` makes gap indexing depend on the
   first gap value — inconsistent placement.
2. Duration accounting: index.ts metadata.duration adds gap time per segment, qc.ts totalDuration sums
   segment durations only — the two duration numbers disagree by total gap time.

Known limitations vs voice-gen (accepted): effects_chain/effect_preset, engine, personality are
warn-and-ignore; OmniVoice chunking is duration-based, so max_chunk_chars/crossfade_ms are validated for
surface compatibility and mapped approximately, not char-exact.

## History

- 2026-09-13T19:42:26.098Z backlog → active (system)

