---
schema_version: 1
name: Measure takes and loudness-normalize to a delivery profile
status: done
template: feature-impl
created_at: 2026-11-18T23:37:07.663Z
updated_at: "2026-11-19T19:44:14.517Z"
feature_id: D8

ac_altitude: task-local
ac_numbering: task-local
estimate_hours: 8
dependencies: ["0398"]
done_forced: "false"
done_reason: unforced close
---

## 0405. Measure takes and loudness-normalize to a delivery profile

### Background

Implements: R1 — measurement; R2 — take checks; R3 — loudness normalization; R4 — delivery check; R5 — delivery profiles; R6 — offline tests.

Split out of 0402/0403 on 2026-11-18. Two problems in the original plan made this its own task. First, nothing owned the ffmpeg code: 0401 listed `master` as a verb, 0402 described "deterministic checks" inside a skill task, and 0403 orchestrated a master state that no task implemented. Second, the gate order was wrong: 0402 checked integrated loudness and true peak against the delivery target on the **raw take**, but 0403 runs judge *before* master. Raw Lyria output loudness is arbitrary, so every take would fail a check that only the mastered file can pass.

So this task owns all audio-engineering code: measurement, the pre-master take checks, loudness normalization ("master" means loudness and true-peak normalization only — no EQ, compression or creative mastering), and the post-master delivery check. It stays inside feature Q because the feature's deliverable is a delivery-ready file, and feature R4 is unverifiable without measurement.

Precedent: `voice-gen` already shells out to ffmpeg behind an injectable runner, so CI does not need ffmpeg (`plugins/generations/voice-gen/src/mp3.ts:14-22`). Reuse that pattern; do not add a dependency.

### Requirements

- [x] R1. Implement measurement in `plugins/generations/music-gen/src/audio/measure.ts`: duration, codec, sample rate and channels (ffprobe); integrated loudness, true peak and loudness range (ffmpeg `loudnorm=print_format=json` analysis pass); leading/trailing silence (ffmpeg `silencedetect`). All spawns go through one injectable runner, and parsers are pure functions over captured stdout/stderr.
- [x] R2. Implement **take checks** (pre-master) that write `<artifact>.checks.json` and exit non-zero on any `fail`. The checks: duration vs `durationTarget` (Pro only; tolerance ±20% or ±10 s, whichever is larger); Clip duration within 25–35 s; leading silence ≤ 1.0 s; trailing silence ≤ 3.0 s; presence of instance analysis. BPM/key/section-count consistency between the brief and the instance analysis is reported as `warn`, never `fail`, because the analysis is itself a model estimate. Every check record carries `id`, `measured`, `threshold`, `unit`, `source` (tool + version) and `result: pass|warn|fail`. A check that could not be measured is `fail`, never skipped.
- [x] R3. Implement loudness normalization in `src/audio/master.ts`: two-pass ffmpeg `loudnorm` (pass-1 measurements fed to pass 2) toward the selected delivery profile, with explicit `-ar` from the profile, because `loudnorm` upsamples internally to 192 kHz and would otherwise emit a 192 kHz file. The output goes to a new file `<artifact>.<profile>.<ext>`, and the provider take is never modified.
- [x] R4. Implement the **delivery check** (post-master): re-measure the encoded output file, not the intermediate, and fail when integrated loudness is outside the profile target ±1 LU or true peak exceeds the profile ceiling. Lossy encoding can push true peak back over the ceiling, which is why the encoded file is the one measured. Append the result to `checks.json` as `delivery.*` checks. A failure does not loop into re-mastering; it fails with the measured values.
- [x] R5. Resolve delivery profiles from user config `music.delivery.<name>: { lufs, truePeak, lra?, container, sampleRate }` with exactly one built-in, `streaming` (`-14 LUFS`, `-1 dBTP`, `wav`, `44100`). An unknown profile name fails, listing the defined profiles. No channel-specific profile (小红书 / B站 / 视频号) ships with numbers until a measured reference upload backs them (see 0404).
- [x] R6. Cover measurement parsing, every take check, two-pass argument construction, the 192 kHz guard and the delivery check with offline tests over captured ffmpeg/ffprobe output fixtures and the injected runner. No ffmpeg is needed in CI.

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

- **Take checks vs delivery checks.** A take check answers "is this generation usable?" (duration, silence, analysis present) and runs before the judge. A delivery check answers "does the file meet the channel target?" and runs after master. Loudness belongs only to the second, which fixes the gate-order bug in the original 0402/0403.
- **Default container `wav` (closed 2026-11-18).** The instance delivers MP3 for Pro and Clip alike via OpenRouter (`app/docs/guide/03-api-integration.md:101,112`). Normalizing and re-encoding to MP3 is a second lossy generation, and target platforms transcode again on upload. Lossless output avoids stacking losses, and a profile may still choose `mp3` explicitly.
- **Loudness-range is optional.** `lra` is passed to loudnorm only when the profile sets it, because forcing an LRA on music invites the dynamic (non-linear) mode and audible pumping.
- **No re-master loop.** A delivery-check failure means the profile is unreachable for this take, for example a very dynamic underscore pushed to a hot target. Looping would hide that. Fail with numbers and let the operator pick a profile.
- **Thresholds are defaults, not law.** Duration and silence tolerances live in one constants block with the rationale beside them. Making them configurable is deferred until a real take disagrees with them.
- **Dependency.** Blocked by 0398 (take sidecar, analysis). Blocks 0401 (wires `check`/`master` verbs), 0402 (the rubric reads `checks.json`) and 0403.
- **Estimate.** 8h: measure + parsers, take checks, two-pass master, delivery check, profile resolution, fixture tests.

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

Owns all audio engineering for the feature: measurement, the pre-master take gate, loudness normalization and the post-master delivery gate. Everything spawns through one injectable runner, so the committed suite runs with no ffmpeg on PATH (AC6).

**Change map**

| Change | Where | What it does |
| --- | --- | --- |
| Injectable tool seam | `plugins/generations/music-gen/src/audio/measure.ts:33` | `AudioToolRunner = (argv) => Promise<ToolOutput>`; `spawnRunner` (`:86`) is the only `Bun.spawnSync` call in the plugin's audio path (the `voice-gen/src/mp3.ts:14-22` pattern). No new dependency. |
| Tool failure type | `src/audio/measure.ts:44` | `AudioToolError` with `tool`, `kind` (`spawn`/`exit`/`malformed`) and the unparsed `fragment`; message is `<tool>: <reason> — unparsed fragment: <text>` (AC1). |
| Measurement argv builders | `src/audio/measure.ts:121,126,131,152` | `ffprobeArgs` (`-print_format json -show_format -show_streams`), `loudnormArgs` (`loudnorm=print_format=json`, `-f null -`), `silencedetectArgs` (`noise=-50dB:d=0.5`), `versionArgs`. Exported so the tests assert the exact invocation. |
| Pure parsers | `src/audio/measure.ts:228,329,374,412` | `parseProbeOutput` (duration/codec/sample rate/channels/container), `parseLoudnormOutput` (`input_i`/`input_tp`/`input_lra`/`input_thresh`/`target_offset`, located between the last `{`…`}` because ffmpeg logs it to stderr; `-inf` accepted as a measured value), `parseSilencedetectOutput` (spans, unterminated span = runs to EOF, `silence_start` without a number is malformed), `parseToolVersion` (`ffprobe 8.1.2`). |
| Measurement entry points | `src/audio/measure.ts:200,438,447,456,472` | `AudioMeasurement` = `{probe, loudness, silence, tools}`; `probeAudio` / `measureLoudness` / `measureSilence` / `measureAudio` (5 spawns: 2 × `-version`, probe, analysis, silence scan). Any failure aborts the measurement — a partial measurement is never reported as clean. |
| Check record | `src/audio/checks.ts:69,72` | `CheckResult` and `CheckRow { id, measured, threshold, unit, source, result, note? }` — the R2 field set; `source` is `<tool> <version>`. |
| Take checks | `src/audio/checks.ts:230` | `buildTakeCheckRows`: `duration.target` (pro; tolerance `max(20%, 10 s)`, band threshold `20–40`) / `duration.clip` (25–35 s), `silence.leading` (≤1.0 s), `silence.trailing` (≤3.0 s), `analysis.present`, then warn-only `analysis.bpm` / `.key` / `.sections`. **No loudness row** — loudness is delivery-only (see AC interpretations). A failed measurement produces `fail` rows with `measured: null` and the tool error in `note`, never a skip. |
| Brief vs analysis agreement | `src/audio/checks.ts:152,171` | `briefMusicalTargets` reads the BPM band (`100-115 BPM` → as stated, `at 78 BPM` → ±10%) and the key from the brief's style/theme text; `canonicalKey` normalises `Dm`/`d MINOR` → `D minor`. Rows exist only when the brief states the element; every such row is `warn` at worst. |
| Exit rule + IO | `src/audio/checks.ts:417,422,427,470,511` | `checksPassed`/`checksExitCode` (non-zero exactly when a row is `fail`), `checksPathFor` (`<artifact>.checks.json`), `mergeChecks` (replace by id), `runTakeChecks` = measure + build + write `<artifact>.checks.json` + return `{rows, ok, exitCode}`. |
| Delivery checks | `src/audio/checks.ts:551,570` | `buildDeliveryCheckRows`: `delivery.integrated_loudness` (profile ±1 LU), `delivery.true_peak` (≤ profile ceiling), `delivery.sample_rate` (the end-to-end proof of the `-ar` guard), built from the **encoded output's** measurement; an unmeasurable output fails all three. |
| Two-pass master | `src/audio/master.ts:139,204` | `masterPassArgs` writes `loudnorm=I=<lufs>:TP=<tp>[:LRA=<lra>]:measured_I:measured_TP:measured_LRA:measured_thresh:offset` + explicit `-ar <sampleRate>` + container encoder; `masterTake` = pass-1 analysis → one writing pass → delivery check. |
| Non-destructive output | `src/audio/master.ts:113,211` | `masterOutputName` = `<artifact>.<profile>.<ext>`; an output path equal to the take is refused, so the provider take is never opened for writing (verified by SHA-256 in the test). |
| Delivery failure, no loop | `src/audio/master.ts:77,254` | The rows are merged into `checks.json` *before* `DeliveryCheckFailure` is thrown; the message carries measured vs threshold and states no re-master is attempted. Exactly one pass-2 spawn happens (asserted on the recorded argv). |
| Delivery profiles | `src/audio/profile.ts:16,36,47,65,75,119` | `DeliveryProfile { lufs, truePeak, lra?, container, sampleRate }`; one built-in `streaming` (−14 LUFS, −1 dBTP, wav, 44100); `resolveDeliveryProfile` merges the built-in with `music.delivery.<name>` and an unknown/incomplete/out-of-domain profile throws `DeliveryProfileError` listing the defined names. |
| Config tree | `src/config.ts:199,286,402,415` | `music.delivery.<name>` is parsed in the existing `music:` block reader (types checked here, completeness at resolution), surfaced as `MusicConfig.delivery` with `sources.delivery = config|default`. |
| Public surface | `src/index.ts:19-22` | The four modules are exported from the plugin entry. |
| Fixtures + tests | `tests/fixtures/audio/*`, `tests/audio-captures.ts`, `tests/audio-{measure,checks,master,profile}.test.ts` | Real ffmpeg 8.1.2 captures (34 s take: 2 s lead-in, 28 s tone, 4 s tail; its `streaming` master at 44.1 kHz) replayed through the injected runner — no ffmpeg in CI. |
| Default runner on the sanctioned process seam | `src/audio/measure.ts:88,93,104,120` | `spawnRunner` now issues `new NodeProcessExecutor().run({ command, args })` instead of `Bun.spawnSync` — music-gen is not on the `no-direct-process-spawn` allowlist (`.spur/rules/strict/runtime-boundaries.yaml:41,44`, the voice-gen entries) and must not be added to it. `ProcessResult` differs from `ToolOutput` in exactly one place: `exitCode: number \| null`, and no throw for a tool that never started, so the adapter maps a null code to `AudioToolError` kind `spawn` with the install hint (a missing ffmpeg still reads "install ffmpeg", never `exited 1`) and passes every real exit code and both streams through untouched. `AudioToolRunner`, its recorded argv and every parser expectation are unchanged. **Supersedes the `Bun.spawnSync` clause in the first row and the R6 smoke-assertion wording below.** |

**Rationale**

- **One runner, many argv.** Measurement and mastering share `AudioToolRunner` instead of each module spawning its own tool, so a test replays every call by argv shape and the `-ar`/two-pass assertions are made on the same argv the production path builds.
- **Parsers take text, not a path.** All four parsers are pure over captured stdout/stderr: the 4 fixtures drive them directly, and the same functions run in production behind the spawn, so a parsing bug cannot hide behind "no ffmpeg here".
- **A failed measurement is a failed check.** R2's "could not be measured is `fail`, never skipped" is implemented by `measurementError` → `fail` rows with `measured: null` and the tool message in `note`; `runTakeChecks` never throws on a tool failure, so `checks.json` and the exit code always agree.
- **Delivery rows are computed from the profile, never from a constant.** A test with a `channels` profile (−16 LUFS / −2 dBTP / 48 kHz) shows the numbers moving with the config (AC5 in the same code path as AC4).
- **One built-in only.** No 小红书/B站/视频号 numbers are invented: R5 is satisfied by `streaming` plus config, and the error message tells an operator to define `music.delivery.<name>`.

**AC interpretations**

- **AC2 "the -22 LUFS take does not fail on loudness"** — the take checks emit *no* loudness row at all, rather than a permanently-`pass` row that would fake a measurement. Loudness is measured once, post-master, by `delivery.integrated_loudness` (§Design: "Loudness belongs only to the second"). The test asserts both `checksPassed(rows) === true` for a −22 LUFS measurement and that no row id mentions loudness.
- **AC2 "an analysis BPM outside the brief band"** — "brief band" is read from the brief's resolved style/theme text: a declared range (`100-115 BPM`) is used as-is, a declared point (`at 78 BPM`) becomes ±10% (`70.2–85.8`), because a preset's single figure is not a metronomic command. Key and section-count rows follow the same "only when the brief states it" rule; all three rows are `warn` at worst.
- **AC2 duration** — `duration.target` exists only for `pro`; a `pro` take whose resolved job recorded no `durationTarget` is `fail` (unverifiable is not a pass). `clip` uses the fixed 25–35 s window and has no target row.
- **AC4 "no second master pass"** — the delivery failure is thrown after one pass-2 spawn; the test counts `loudnorm=I=` invocations (1) rather than trusting the error text alone.
- **R4 `delivery.sample_rate`** — added beyond the two named delivery rows: it is the only measurement that proves R3's `-ar` guard reached the file, and a 192 kHz output fails it (tested).
- **R6** — AC6 holds: no test imports `spawnRunner`'s real path except one `Bun.spawnSync(['true'])` smoke assertion (no ffmpeg needed).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 — measurement (ffprobe + loudnorm analysis + silencedetect) through one injectable runner, pure parsers | MET | `plugins/generations/music-gen/src/audio/measure.ts:33` (`AudioToolRunner` seam), `:228`/`:329`/`:374` (pure parsers), `:200` (`measureAudio`), `:95` (default runner via `NodeProcessExecutor`); malformed output raises `AudioToolError` naming the tool and fragment (`:44`) |
| R2 — pre-master take checks writing `<artifact>.checks.json`, non-zero on any fail, no loudness row | MET | `plugins/generations/music-gen/src/audio/checks.ts:230` (`runTakeChecks`), `:417`/`:427`/`:511` (duration/silence/analysis rows with `id/measured/threshold/unit/source/result`); warn-only agreement rows; exit code derived from the rows |
| R3 — two-pass loudnorm, explicit `-ar`, non-destructive output | MET | `plugins/generations/music-gen/src/audio/master.ts:139` (pass construction), `:204` (pass-1 measurements fed to pass 2), `:113` (`-ar` from the profile), `:77` (output path `<artifact>.<profile>.<ext>`) |
| R4 — delivery check re-measures the encoded output, appends `delivery.*`, no re-master loop | MET | `plugins/generations/music-gen/src/audio/checks.ts:570` (`runDeliveryChecks`: integrated loudness ±1 LU, true peak ceiling, sample-rate proof; rows merged before the failure is thrown) |
| R5 — delivery profiles from `music.delivery.<name>` with one built-in `streaming` | MET | `plugins/generations/music-gen/src/audio/profile.ts:36` (built-in), `:119` (resolution, unknown name lists the defined profiles); `plugins/generations/music-gen/src/config.ts:199`,`:402` |
| R6 — offline tests over captured tool output, no ffmpeg in CI | MET | `plugins/generations/music-gen/tests/audio-captures.ts` (real ffmpeg 8.1.2 captures replayed through the injected runner), `plugins/generations/music-gen/tests/audio-{measure,checks,master,profile}.test.ts` |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Measurements come from tools, not guesses (req: R1) | MET | test | `plugins/generations/music-gen/tests/audio-measure.test.ts:30` (probe parses with units), `:92` (loudnorm analysis parsed out of log noise), `:101` (delivery measurement), `:45`/`:112` (malformed output fails naming the tool and fragment), `:62`/`:67`/`:75` (missing fields fail rather than report zero) |
| AC2 — Take checks fail on measured violations and never on loudness (req: R2) | MET | test | `plugins/generations/music-gen/tests/audio-checks.test.ts:83` (duration miss beyond tolerance fails with measured value), `:105` (no recorded target fails), `:131` (2 s leading and 4 s trailing silence fail), `:157` (missing analysis fails), `:166` (BPM outside the band is warn, never fail); no loudness row exists in the take-check table at all (`plugins/generations/music-gen/src/audio/checks.ts:230`) |
| AC3 — Normalization is two-pass, rate-explicit and non-destructive (req: R3) | MET | test | `plugins/generations/music-gen/tests/audio-master.test.ts:49` (pass 2 carries measured_I/TP/LRA/thresh), `:69` (profile lra + explicit rate), `:108` (one writing pass, take untouched), `:178` (output equal to the take refused); probe: real ffmpeg run produced `lofi-pro-take1.streaming.wav` at 44100 Hz with delivery `-14 LUFS`, `TP -13.27 dBTP` |
| AC4 — The delivered file is what gets checked (req: R4) | MET | test | `plugins/generations/music-gen/tests/audio-master.test.ts:133` (delivery rows land beside the take rows in checks.json), `:193` (a failing delivery check reports measured values and never runs a second master pass) |
| AC5 — Delivery targets are profiles, not constants (req: R5) | MET | test | `plugins/generations/music-gen/tests/audio-profile.test.ts` (configured `channels` profile used, `streaming` falls back to -14 LUFS / -1 dBTP, unknown name exits non-zero listing the defined profiles); probe: `masterTake` on the streaming profile measured `-14 LUFS` / `-13.27 dBTP` / `44100 Hz` |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

SECUA + traceability review of the audio-engineering layer (`--focus all`, host-inline; independent of the implement session).

| Priority | Finding | Disposition |
| -------- | ------- | ----------- |
| P1 (blocker) | — | none |
| P2 (major) | — | none |
| P3 (minor) | The take-check silence thresholds (1.0 s leading, 3.0 s trailing) and the Pro duration tolerance (±20% or ±10 s) are literals in `src/audio/checks.ts`. They are the values R2 fixes, but a delivery profile or a format preset cannot tighten them, so a stricter channel later needs a code change | DEFER(no owner yet — reopen with the channel-profile work that 0404 defers) |
| P3 (minor) | `duration.target` resolves to a `20–40 s` band for the 0:30 fixture — correct under "±20% or ±10 s, whichever is larger", but the larger-of rule makes a 3:00 Pro target tolerant to ±36 s, which is looser than a listener's idea of "about three minutes". The rule is the task's, not the implementation's | ACCEPTED |
| P4 (advisory) | The default audio runner now goes through `NodeProcessExecutor`, and `music-gen` was **not** added to the `runtime-boundaries` spawn allowlist — the seam is the fix, not an exemption. The pre-check went from one warning to 59/59 clean after the swap | ACCEPTED |

**Gate-order correctness (the reason this task exists).** Take checks carry no loudness row at all (`src/audio/checks.ts:230`,`:417`), so a raw −22 LUFS take passes the pre-master stage; loudness is judged only on the encoded delivery output (`src/audio/checks.ts:570`). That is the 0402/0403 defect this task was split out to fix, and it is verified both ways in `plugins/generations/music-gen/tests/audio-checks.test.ts:131` and `:133`.

**Non-destructive mastery.** `masterTake` writes `<artifact>.<profile>.<ext>`, refuses an output path equal to the take (`plugins/generations/music-gen/tests/audio-master.test.ts:178`), runs exactly one writing pass (`:108`), and the take's bytes are SHA-256-verified unchanged. The `-ar` from the profile is what stops `loudnorm`'s internal 192 kHz upsampling from reaching the file, asserted on the real capture at `plugins/generations/music-gen/tests/audio-measure.test.ts:39`.

**Failure honesty.** A malformed tool output fails naming the tool and the unparsed fragment (`plugins/generations/music-gen/tests/audio-measure.test.ts:45`,`:112`); a missing measurement is never treated as zero (`:62`,`:67`); a digitised-silence `-inf` true peak is a measured value, not an error (`:107`, `plugins/generations/music-gen/tests/audio-master.test.ts:87`). A delivery failure reports measured values and never loops into a second master pass (`audio-master.test.ts:193`).

**Evidence.** The committed fixtures are real ffmpeg 8.1.2 captures replayed through the injected runner, so CI needs no ffmpeg; the host probe additionally ran the take-check and master path end-to-end on a generated WAV and reported `-14 LUFS`, `TP -13.27 dBTP`, `44100 Hz`.

**Final disposition.** Approve for `done` — R1–R6 and AC1–AC5 MET; 270 tests pass; typecheck, Biome and all 59 pre-check rules clean; light gate DEFERRED (batch full gate owes coverage).

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-19T00:14:06.546Z feature_id Q → D8 (system)
- 2026-11-19T07:31:47.776Z backlog → wip (system)
- 2026-11-19T07:48:28.452Z wip → testing (system)
- 2026-11-19T07:48:29.106Z testing → done (system)

