---
schema_version: 1
name: Measure takes and loudness-normalize to a delivery profile
status: backlog
template: feature-impl
created_at: 2026-11-18T23:37:07.663Z
updated_at: "2026-11-19T00:14:06.546Z"
feature_id: D8

ac_altitude: task-local
ac_numbering: task-local
estimate_hours: 8
---

## 0394. Measure takes and loudness-normalize to a delivery profile

### Background

Implements: R1 — measurement; R2 — take checks; R3 — loudness normalization; R4 — delivery check; R5 — delivery profiles; R6 — offline tests.

Split out of 0389/0390 on 2026-11-18. Two problems in the original plan made this its own task. First, nothing owned the ffmpeg code: 0388 listed `master` as a verb, 0389 described "deterministic checks" inside a skill task, and 0390 orchestrated a master state that no task implemented. Second, the gate order was wrong: 0389 checked integrated loudness and true peak against the delivery target on the **raw take**, but 0390 runs judge *before* master. Raw Lyria output loudness is arbitrary, so every take would fail a check that only the mastered file can pass.

So this task owns all audio-engineering code: measurement, the pre-master take checks, loudness normalization ("master" means loudness and true-peak normalization only — no EQ, compression or creative mastering), and the post-master delivery check. It stays inside feature Q because the feature's deliverable is a delivery-ready file, and feature R4 is unverifiable without measurement.

Precedent: `voice-gen` already shells out to ffmpeg behind an injectable runner, so CI does not need ffmpeg (`plugins/generations/voice-gen/src/mp3.ts:14-22`). Reuse that pattern; do not add a dependency.

### Requirements

- [ ] R1. Implement measurement in `plugins/generations/music-gen/src/audio/measure.ts`: duration, codec, sample rate and channels (ffprobe); integrated loudness, true peak and loudness range (ffmpeg `loudnorm=print_format=json` analysis pass); leading/trailing silence (ffmpeg `silencedetect`). All spawns go through one injectable runner, and parsers are pure functions over captured stdout/stderr.
- [ ] R2. Implement **take checks** (pre-master) that write `<artifact>.checks.json` and exit non-zero on any `fail`. The checks: duration vs `durationTarget` (Pro only; tolerance ±20% or ±10 s, whichever is larger); Clip duration within 25–35 s; leading silence ≤ 1.0 s; trailing silence ≤ 3.0 s; presence of instance analysis. BPM/key/section-count consistency between the brief and the instance analysis is reported as `warn`, never `fail`, because the analysis is itself a model estimate. Every check record carries `id`, `measured`, `threshold`, `unit`, `source` (tool + version) and `result: pass|warn|fail`. A check that could not be measured is `fail`, never skipped.
- [ ] R3. Implement loudness normalization in `src/audio/master.ts`: two-pass ffmpeg `loudnorm` (pass-1 measurements fed to pass 2) toward the selected delivery profile, with explicit `-ar` from the profile, because `loudnorm` upsamples internally to 192 kHz and would otherwise emit a 192 kHz file. The output goes to a new file `<artifact>.<profile>.<ext>`, and the provider take is never modified.
- [ ] R4. Implement the **delivery check** (post-master): re-measure the encoded output file, not the intermediate, and fail when integrated loudness is outside the profile target ±1 LU or true peak exceeds the profile ceiling. Lossy encoding can push true peak back over the ceiling, which is why the encoded file is the one measured. Append the result to `checks.json` as `delivery.*` checks. A failure does not loop into re-mastering; it fails with the measured values.
- [ ] R5. Resolve delivery profiles from user config `music.delivery.<name>: { lufs, truePeak, lra?, container, sampleRate }` with exactly one built-in, `streaming` (`-14 LUFS`, `-1 dBTP`, `wav`, `44100`). An unknown profile name fails, listing the defined profiles. No channel-specific profile (小红书 / B站 / 视频号) ships with numbers until a measured reference upload backs them (see 0391).
- [ ] R6. Cover measurement parsing, every take check, two-pass argument construction, the 192 kHz guard and the delivery check with offline tests over captured ffmpeg/ffprobe output fixtures and the injected runner. No ffmpeg is needed in CI.

### Acceptance Criteria

```gherkin
Scenario: AC1 — Measurements come from tools, not guesses (req: R1)
  Given captured ffprobe and ffmpeg loudnorm/silencedetect outputs for one take
  When the parsers run
  Then duration, sample rate, integrated LUFS, true peak, LRA and silence spans are extracted with units
  And a malformed tool output fails with the tool name and the unparsed fragment

Scenario: AC2 — Take checks fail on measured violations and never on loudness (req: R2)
  Given takes with a duration miss beyond tolerance, 2 s of leading silence, no instance analysis, an analysis BPM outside the brief band, and a raw integrated loudness of -22 LUFS
  When the take checks run
  Then the duration, silence and missing-analysis cases fail with measured value, threshold and source
  And the BPM case is warn and the -22 LUFS take does not fail on loudness
  And the command exits non-zero exactly when any check is fail

Scenario: AC3 — Normalization is two-pass, rate-explicit and non-destructive (req: R3)
  Given a take and the streaming profile
  When master runs
  Then the second ffmpeg invocation carries the first pass's measured_I, measured_TP, measured_LRA and measured_thresh
  And the output invocation carries -ar 44100
  And the original take's bytes are unchanged and the output is a new file

Scenario: AC4 — The delivered file is what gets checked (req: R4)
  Given a mastered output whose encoded true peak measures -0.4 dBTP against a -1 dBTP ceiling
  When the delivery check runs
  Then delivery.true_peak fails with -0.4 and -1 recorded
  And no second master pass is attempted

Scenario: AC5 — Delivery targets are profiles, not constants (req: R5)
  Given user config defining a profile "channels" and no override for "streaming"
  When master resolves "channels", "streaming" and "unknown"
  Then "channels" uses the configured values, "streaming" uses -14 LUFS / -1 dBTP
  And "unknown" exits non-zero listing the defined profile names

Scenario: AC6 — The suite needs no ffmpeg (req: R6)
  Given a PATH without ffmpeg
  When the music-gen audio tests run
  Then they pass using the injected runner and captured fixtures
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

- **Take checks vs delivery checks.** A take check answers "is this generation usable?" (duration, silence, analysis present) and runs before the judge. A delivery check answers "does the file meet the channel target?" and runs after master. Loudness belongs only to the second, which fixes the gate-order bug in the original 0389/0390.
- **Default container `wav` (closed 2026-11-18).** The instance delivers MP3 for Pro and Clip alike via OpenRouter (`app/docs/guide/03-api-integration.md:101,112`). Normalizing and re-encoding to MP3 is a second lossy generation, and target platforms transcode again on upload. Lossless output avoids stacking losses, and a profile may still choose `mp3` explicitly.
- **Loudness-range is optional.** `lra` is passed to loudnorm only when the profile sets it, because forcing an LRA on music invites the dynamic (non-linear) mode and audible pumping.
- **No re-master loop.** A delivery-check failure means the profile is unreachable for this take, for example a very dynamic underscore pushed to a hot target. Looping would hide that. Fail with numbers and let the operator pick a profile.
- **Thresholds are defaults, not law.** Duration and silence tolerances live in one constants block with the rationale beside them. Making them configurable is deferred until a real take disagrees with them.
- **Dependency.** Blocked by 0385 (take sidecar, analysis). Blocks 0388 (wires `check`/`master` verbs), 0389 (the rubric reads `checks.json`) and 0390.
- **Estimate.** 8h: measure + parsers, take checks, two-pass master, delivery check, profile resolution, fixture tests.

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-19T00:14:06.546Z feature_id Q → D8 (system)

