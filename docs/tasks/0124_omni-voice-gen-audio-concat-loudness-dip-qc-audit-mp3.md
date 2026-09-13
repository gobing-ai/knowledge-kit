---
schema_version: 1
name: "omni-voice-gen: audio concat, loudness-dip, QC audit, mp3"
status: backlog
template: feature-impl
created_at: 2026-09-13T05:54:10.949Z
updated_at: "2026-09-13T06:27:07.898Z"
feature_id: F611

ac_altitude: task-local
---

## 0124. omni-voice-gen: audio concat, loudness-dip, QC audit, mp3

### Background

Captured from the creation title: "omni-voice-gen: audio concat, loudness-dip, QC audit, mp3".

### Requirements

- [ ] R1. `audio.py` WAV parse (RIFF/fmt/data chunk walk, same robustness as voice-gen parseWav) and
    `concat_wavs(buffers, gaps_ms)`: `gaps_ms[i]` inserts silence BEFORE segment i (i>0); format
    mismatch (rate/channels/bits) → error naming the segment (fixes voice-gen concat.ts gap
    indexing, F611 Notes #1).
- [ ] R2. `detect_loudness_dip` port with identical thresholds (DIP_RATIO 0.4, SILENCE_FLOOR 0.008,
    ABS_CEILING 0.06, NEIGHBOR_FLOOR 0.02, 1s non-overlapping windows).
- [ ] R3. `qc.py` ports computeExpectedDurationRange (zh/en branches), detectRepetitions (3 regex rules),
    transcriptionFidelity (bigram coverage, floor 0.15), and audit_voice_segments producing the
    voice-gen report shape; `totalDuration` and `metadata.duration` share the segments+gaps basis
    (fixes F611 Notes #2).
- [ ] R4. `mp3.py`: VOICE_GEN_MP3 truthy set {1,true,yes,on} (case-insensitive); ffmpeg
    `-y -hide_banner -loglevel error -i <wav> -codec:a libmp3lame -qscale:a 2 <mp3>`; missing
    ffmpeg / non-zero exit / no output file → fail loud (injectable transcoder for tests).

### Acceptance Criteria

```gherkin
Feature: Audio concat, QC audit, mp3

  Scenario: Deterministic gap placement
    Given three segments with gaps [0, 500, 250]
    When concat runs
    Then 500ms silence precedes segment 2 and 250ms precedes segment 3 regardless of the first gap value

  Scenario: QC parity with voice-gen thresholds
    Given synthetic WAVs exercising dent, silence, normal-quiet, and loop cases
    When the QC audit runs
    Then dip detection, repetition rules, fidelity floor, and duration ranges match voice-gen behavior
    And report.totalDuration equals segment durations plus gap seconds

  Scenario: MP3 parity
    Given VOICE_GEN_MP3=true
    When the pipeline finishes
    Then a sibling MP3 exists and metadata.mp3Path is absolute
    And a missing ffmpeg exits 1 with no --out written
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-13T06:26:35.327Z

- Q: WAV parsing — stdlib wave or hand-rolled RIFF walk? A: stdlib `wave` for the concat/parse path
  (all inputs are backend-produced standard PCM); the dip detector reads samples via numpy from the
  same parsed buffer. Hand-rolled RIFF walk only if a real file breaks stdlib parsing — add then.
- Q: Reuse voice-gen's gap quirk for compat? A: no — it's a bug (F611 Notes #1); fixed semantics
  documented in the spec D8.1.

### Design

WHAT/WHY: pure-DSP modules (numpy + stdlib `wave` only — no torch import) porting voice-gen
concat.ts/qc.ts/mp3.ts with two deliberate fixes (F611 Notes #1/#2).

WHERE / frozen names + thresholds (verbatim ports):
- `src/omni_voice_gen/audio.py`: `ParsedWav` dataclass; `parse_wav(b: bytes) -> ParsedWav`;
  `concat_wavs(buffers: list[bytes], gaps_ms: list[int]) -> bytes` — gaps_ms[i] inserts silence
  BEFORE segment i for i>0 (FIX: no gapsMs[0]==0 special case); format mismatch → ValueError naming
  segment index and both formats; `detect_loudness_dip(wav: bytes) -> DipResult(dip: bool,
  dip_at_sec: float|None)` with DIP_RATIO=0.4, DIP_SILENCE_FLOOR=0.008, DIP_ABS_CEILING=0.06,
  DIP_NEIGHBOR_FLOOR=0.02, 1s non-overlapping windows, <7 windows → no dip (voice-gen exact).
- `src/omni_voice_gen/qc.py`: `TRANSCRIPTION_FIDELITY_FLOOR=0.15`; `detect_repetitions(text)` (the
  three regex rules verbatim); `transcription_fidelity(source, transcription)` (char-bigram
  coverage); `compute_expected_duration_range(text, language)` (zh: chars/7..chars/2.2+2.5; other:
  words/5..words/1.5+2.5, floors 1.0/2.5); `audit_voice_segments(script, wavs, segment_metadata,
  gaps_ms) -> VoiceQualityReport` — report fields identical to voice-gen VoiceQualityReport;
  FIX: report.totalDuration = Σ(segment durations) + Σ(gaps_ms)/1000, the same basis pipeline.py
  uses for metadata.duration.
- `src/omni_voice_gen/mp3.py`: `is_mp3_requested(env) -> bool` (truthy {1,true,yes,on},
  case-insensitive); `transcode_wav_to_mp3(wav_path, mp3_path, ffmpeg_bin="ffmpeg")` — subprocess
  flags `-y -hide_banner -loglevel error -i <wav> -codec:a libmp3lame -qscale:a 2 <mp3>`; missing
  binary / non-zero exit / no output file → RuntimeError (voice-gen messages mirrored).

Anti-patterns: do NOT use librosa/pydub for these helpers (heavy deps for what wave+numpy does in
stdlib); do NOT "improve" thresholds — every constant is dogfood-calibrated against production
failures (see qc.ts comments); do NOT return partial reports — any audit exception propagates.

Handoff: 0125 wires concat/dip/audit/mp3; nothing here reads env except is_mp3_requested.

### Plan

1. audio.py: parse_wav, concat_wavs, detect_loudness_dip.
2. qc.py: duration ranges, repetitions, fidelity, audit.
3. mp3.py: truthiness + ffmpeg transcode (injectable).
4. tests: synthetic WAV builders for every threshold boundary + gap-order regression (voice-gen bug).

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Spec: docs/design/omni-voice-gen.md (D7, D8, §4)
- Source of truth: plugins/generations/voice-gen/src/{concat,qc,mp3}.ts
- Blocked by: 0121

### History
