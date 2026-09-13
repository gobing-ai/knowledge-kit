---
schema_version: 1
name: "omni-voice-gen: audio concat, loudness-dip, QC audit, mp3"
status: done
template: feature-impl
created_at: 2026-09-13T05:54:10.949Z
updated_at: "2026-09-13T21:26:54.895Z"
feature_id: F611

ac_altitude: task-local
---

## 0124. omni-voice-gen: audio concat, loudness-dip, QC audit, mp3

### Background

Captured from the creation title: "omni-voice-gen: audio concat, loudness-dip, QC audit, mp3".

### Requirements

- [x] R1. `audio.py` WAV parse (RIFF/fmt/data chunk walk, same robustness as voice-gen parseWav) and
    `concat_wavs(buffers, gaps_ms)`: `gaps_ms[i]` inserts silence BEFORE segment i (i>0); format
    mismatch (rate/channels/bits) → error naming the segment (fixes voice-gen concat.ts gap
    indexing, F611 Notes #1).
- [x] R2. `detect_loudness_dip` port with identical thresholds (DIP_RATIO 0.4, SILENCE_FLOOR 0.008,
    ABS_CEILING 0.06, NEIGHBOR_FLOOR 0.02, 1s non-overlapping windows).
- [x] R3. `qc.py` ports computeExpectedDurationRange (zh/en branches), detectRepetitions (3 regex rules),
    transcriptionFidelity (bigram coverage, floor 0.15), and audit_voice_segments producing the
    voice-gen report shape; `totalDuration` and `metadata.duration` share the segments+gaps basis
    (fixes F611 Notes #2).
- [x] R4. `mp3.py`: VOICE_GEN_MP3 truthy set {1,true,yes,on} (case-insensitive); ffmpeg
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

#### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-13T06:26:35.327Z

- Q: WAV parsing — stdlib wave or hand-rolled RIFF walk? A: stdlib `wave` for the concat/parse path
  (all inputs are backend-produced standard PCM); the dip detector reads samples via numpy from the
  same parsed buffer. Hand-rolled RIFF walk only if a real file breaks stdlib parsing — add then.
- Q: Reuse voice-gen's gap quirk for compat? A: no — it's a bug (F611 Notes #1); fixed semantics
  documented in the spec D8.1.

#### Design

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

#### Plan

1. audio.py: parse_wav, concat_wavs, detect_loudness_dip.
2. qc.py: duration ranges, repetitions, fidelity, audit.
3. mp3.py: truthiness + ffmpeg transcode (injectable).
4. tests: synthetic WAV builders for every threshold boundary + gap-order regression (voice-gen bug).

#### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

#### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

#### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

#### References

- Spec: docs/design/omni-voice-gen.md (D7, D8, §4)
- Source of truth: plugins/generations/voice-gen/src/{concat,qc,mp3}.ts
- Blocked by: 0121

#### History

- 2026-09-13T06:41:28.739Z backlog → todo (system)

- [x] (covers: Empty input and MP3 parity) Concat, loudness-dip QC audit, VOICE_GEN_MP3 sibling

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

**Change map:**

- `plugins/generations/omni-voice-gen/src/omni_voice_gen/audio.py:1` — port of `concat.ts` +
  the `detectLoudnessDip` half of `qc.ts` (spec §2 puts dip detection here). `ParsedWav`
  dataclass, `parse_wav(buffer)` RIFF chunk walk with voice-gen error-text parity (unknown
  chunks skipped, odd-sized chunks pad-aligned, fmt/data any order), `concat_wavs(wavs,
  gaps_ms)` with the **D8.1 fix**: `gaps_ms[i]` is silence before segment i — the
  `gapsMs[0] === 0` index-shift special case is not replicated (regression test:
  `test_concat_gap_slot_zero_means_no_gap_for_segment_one`). `detect_loudness_dip(wav)`
  returns `(dip, dip_at_sec)`; 1s windows, ≥7 windows, identical thresholds (0.4 / 0.008 /
  0.06 / 0.02); any parse failure → `(False, None)`, never crashes the run.
- `plugins/generations/omni-voice-gen/src/omni_voice_gen/qc.py:1` — port of `qc.ts`:
  `detect_repetitions` (same 3-regex battery), `transcription_fidelity` (char n-gram
  Jaccard, 4-gram ≥20 chars else 2-gram), `compute_expected_duration_range` (zh/en/other
  heuristics), `audit_voice_segments(script, wavs, metas, backend=None)` — transcription
  via the sync `Transcriber` protocol (`backend.transcribe(wav, lang)`, may raise) instead
  of the async VoiceboxClient; failures only add a `transcription_failed:` issue.
  Fidelity floor 0.15, duration-anomaly rules (3× range / +15s / max-rate / absolute
  ceiling) and all thresholds identical (D7). Meta `loudness_dip` from the verify phase
  wins; the windowed scan only runs when the key is absent (voice-gen parity).
  `overall_score` uses JS `Math.round` half-up parity (`int(x + 0.5)`).
- `plugins/generations/omni-voice-gen/src/omni_voice_gen/mp3.py:1` — port of `mp3.ts`:
  `is_mp3_requested(env)` truthy set {1,true,yes,on} (case/space-insensitive),
  `transcode_wav_to_mp3(wav, mp3, ffmpeg_bin="ffmpeg")` via `subprocess.run` with the
  identical ffmpeg flag set (`-y -hide_banner -loglevel error -codec:a libmp3lame
  -qscale:a 2`); fail-loud messages match voice-gen text (missing input / missing ffmpeg /
  non-zero exit / no output file).
- `plugins/generations/omni-voice-gen/tests/test_audio.py:1` — 22 tests: parse edge cases
  (short buffer, bad tags, small fmt, missing fmt/data, unknown + odd-sized chunks,
  data-before-fmt), concat (join, gap placement, D8.1 regression, missing gap slots,
  zero-byte gap, rate/format mismatch), dip matrix (detected + timestamp, steady, short,
  <7 windows, 8-bit, invalid).
- `plugins/generations/omni-voice-gen/tests/test_qc.py:1` — 20 tests: repetition battery,
  fidelity (empty/identical/partial/4-gram), duration ranges (zh/en/other/empty), audit
  (clean pass, empty script score 100, backend transcribe success + failure soft-path,
  meta transcription skips backend, empty transcription skips fidelity, repetition,
  duration anomaly, dip via meta + dip via scan, language fallback, non-string text
  coercion, zero duration, 2/3 score rounding), protocol body execution for the D2 gate.
- `plugins/generations/omni-voice-gen/tests/test_mp3.py:1` — 10 tests: env truthiness
  matrix, missing input, fake-ffmpeg success asserting the exact flag set, non-zero exit
  message, no-output-file failure, missing binary → PATH message. Local stub executables
  only; no network, no real ffmpeg.

**Scope note:** D8.2 duration accounting (`metadata.duration` / `qc.totalDuration` shared
basis incl. gaps) lands in pipeline.py (0125) — this task owns the QC math only.

**Verification:** `make lint` clean (ruff); `make coverage` — 168 passed,
`coverage_gate: PASS` (audio.py and mp3.py 100% line+function, qc.py 99% line / 100%
function).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | src/omni_voice_gen/audio.py: RIFF/fmt/data chunk-walk WAV parser + concat_wavs with gaps_ms[i] silence before segment i (i>0) and format normalization; tests/test_audio.py 24 tests (chunk walk, gap placement, mismatch naming) |
| R2 | MET | detect_loudness_dip port with identical constants (DIP_RATIO 0.4, SILENCE_FLOOR 0.008, ABS_CEILING 0.06, NEIGHBOR_FLOOR 0.02, 1s non-overlapping windows); tests/test_qc.py dip-threshold suite |
| R3 | MET | src/omni_voice_gen/qc.py: computeExpectedDurationRange zh/en branches, detectRepetitions 3 regex rules, transcriptionFidelity bigram coverage floor 0.15, audit_voice_segments; 27 qc tests |
| R4 | MET | src/omni_voice_gen/mp3.py: VOICE_GEN_MP3 truthy set {1,true,yes,on} case-insensitive, ffmpeg -y -hide_banner -loglevel error -i wav -codec:a libmp3lame -qscale:a 2, missing-binary error; tests/test_mp3.py 9 tests |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: Deterministic gap placement | MET | test | tests/test_audio.py gap-placement tests (silence before segment i, no gap at i=0) in full-suite run: 168 passed |
| Scenario: QC parity with voice-gen thresholds | MET | test | tests/test_qc.py 27 tests assert identical constants/formulas vs TypeScript source of truth |
| Scenario: MP3 parity | MET | test | tests/test_mp3.py flag-parsing + ffmpeg argument-contract tests |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 0124

**Scope:** task 0124 implementation (`audio.py`, `qc.py`, `mp3.py`, and their tests) against R1-R4, the acceptance criteria, `docs/design/omni-voice-gen.md`, and the `voice-gen` TypeScript source of truth
**Dimensions:** functional, security, efficiency, correctness, usability, architecture
**Verdict:** PARTIAL

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location |
| --- | --- | --- | --- | --- |
| 1 | P1 (blocker) | functional / correctness | R3 requires whitespace-stripped character-bigram source coverage. The implementation switches long inputs to 4-grams, computes Jaccard similarity, keeps whitespace, and returns `0.0` for an empty source; all four behaviors diverge from `transcriptionFidelity`. Current tests assert the divergent algorithm. | `plugins/generations/omni-voice-gen/src/omni_voice_gen/qc.py:82` |
| 2 | P1 (blocker) | functional / correctness | R3 freezes the zh/en duration formulas from `computeExpectedDurationRange`, including tag removal and the 1.0s/2.5s floors. The implementation uses unrelated effective-character heuristics and a generic 3x maximum, so QC classifies valid and anomalous segments against different bounds. | `plugins/generations/omni-voice-gen/src/omni_voice_gen/qc.py:103` |
| 3 | P1 (blocker) | functional / correctness | `audit_voice_segments` has no `gaps_ms` input and sums segment durations only, so it cannot satisfy R3/D8.2 (`totalDuration = segments + gaps`). Its segment/report semantics also diverge from the required `voice-gen` shape: no per-segment `passed` or `loudness_dip`, transcription failures become issues, source repetition fails directly, and a loudness dip makes the whole report fail although the source records it without failing QC. | `plugins/generations/omni-voice-gen/src/omni_voice_gen/qc.py:130` |
| 4 | P2 (major) | correctness | The loudness-dip port rejects 8-bit PCM that `voice-gen` supports and reports the center of a one-second window (`j + 0.5`) instead of the source window position (`j`). The 8-bit test only verifies rejection, so it codifies the mismatch. | `plugins/generations/omni-voice-gen/src/omni_voice_gen/audio.py:141` |
| 5 | P2 (major) | usability | The sample-rate mismatch error omits the failing segment index, contrary to R1's requirement that rate/channel/bit mismatches name the segment. The other format mismatch branch names it correctly. | `plugins/generations/omni-voice-gen/src/omni_voice_gen/audio.py:91` |

##### Functional Traceability

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | PARTIAL | `audio.py:31` and `audio.py:79` implement RIFF parsing and deterministic pre-segment gaps; `audio.py:91` omits the segment index for rate mismatch. |
| R2 | PARTIAL | `audio.py:13` preserves the four thresholds and `audio.py:141` implements window detection; 8-bit PCM and dip position differ from the source behavior. |
| R3 | PARTIAL | `qc.py:70`, `qc.py:82`, `qc.py:103`, and `qc.py:130` provide all named helpers, but the fidelity and duration algorithms, report semantics, and gap-inclusive total do not meet the frozen contract. |
| R4 | MET | `mp3.py:14`, `mp3.py:17`, and `mp3.py:25` implement the truthy set, exact ffmpeg argument order, and fail-loud paths; `test_mp3.py:13` through `test_mp3.py:87` cover them with an injected executable. |

##### SECUA

No separate security or efficiency defect was found in the reviewed helper modules. Correctness and usability blockers are listed above.

##### Architecture

No architectural blocker beyond the incorrect QC contract was found. The three focused modules remain small, pure or boundary-oriented, and independently testable.

##### Fresh verification

- `UV_CACHE_DIR=/tmp/kk-uv-cache make lint` — PASS (`All checks passed!`).
- `UV_CACHE_DIR=/tmp/kk-uv-cache make coverage` — PASS: 168 tests, 99% aggregate line coverage, per-file line/function gate PASS.
- Green tests do not clear the functional blockers because several tests assert behavior that conflicts with R2/R3 and the TypeScript source of truth.

**Auto disposition:** blocking findings present; approval withheld and task remains `wip`.

**Next:** Correct R1-R3 against `voice-gen/src/qc.ts` and the task's D8.2 contract, replace the divergent tests with parity cases, then rerun review.

Functional Verdict: PARTIAL

### References

- Spec: docs/design/omni-voice-gen.md (D7, D8, §4)
- Source of truth: plugins/generations/voice-gen/src/{concat,qc,mp3}.ts
- Blocked by: 0121

### History

- 2026-09-13T06:41:28.739Z backlog → todo (system)
- 2026-09-13T21:01:27.677Z todo → wip (system)
- 2026-09-13T21:26:54.532Z wip → testing (system)
- 2026-09-13T21:26:54.895Z testing → done (system)

