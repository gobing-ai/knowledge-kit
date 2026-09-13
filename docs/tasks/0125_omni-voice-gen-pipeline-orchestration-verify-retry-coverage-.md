---
schema_version: 1
name: "omni-voice-gen: pipeline orchestration + verify-retry + coverage gate"
status: done
template: feature-impl
created_at: 2026-09-13T05:54:11.173Z
updated_at: "2026-09-13T22:12:29.341Z"
feature_id: F611

ac_altitude: task-local
---

## 0125. omni-voice-gen: pipeline orchestration + verify-retry + coverage gate

### Background

Captured from the creation title: "omni-voice-gen: pipeline orchestration + verify-retry + coverage gate".

### Requirements

- [x] R1. `pipeline.py` `run(in_path, out_path, backend=None, transcoder=None)`: delete-then-render
    semantics identical to voice-gen processGeneratorIO (stale --out/WAV/MP3 removed at start AND on
    failure).
- [x] R2. Per-segment loop: profile resolution order D4 (segment → speaker → script default →
    VOICEBOX_DEFAULT_PROFILE → doc metadata.voiceProfile; none → error listing every knob); per-
    segment stderr progress lines; VOICE_GEN_MAX_RUN_MS checked between segments with the voice-gen
    fail-loud message shape.
- [x] R3. Verify-retry: ≤2 verify attempts per segment; transcription fidelity < 0.15 or loudness dip →
    regenerate (resample; explicit seed pins attempt 0 only); surviving dip recorded in segment
    metadata; verifyRetries counted; ASR unavailable → keep audio (QC backstop), matching voice-gen.
- [x] R4. Content assembly: body = canonical YAML of the executed VoiceScript; metadata.generator
    "kk:omni-voice-gen"; audioPath/mp3Path/duration/segments/qc per spec §4; VOICE_GEN_FAIL_ON_QC=
    true + failing QC → exit 1 naming score and critical issues.
- [x] R5. Coverage gate: `make coverage` proves per-file line AND function coverage ≥ 90% with zero
    skipped/xfail-without-reason tests.

### Acceptance Criteria

```gherkin
Feature: Pipeline orchestration and verify-retry

  Scenario: End-to-end render with FakeBackend
    Given a two-segment VoiceScript Doc[] and FakeBackend returning deterministic WAVs
    When pipeline.run executes
    Then --out validates against the Content contract, the sibling WAV has both segments with the gap,
    and metadata matches spec §4 exactly

  Scenario: Verify-retry behavior
    Given FakeBackend returning low-fidelity audio on attempts 0-1 and clean audio on attempt 2
    When the segment renders
    Then verifyRetries is 2 and the clean audio is kept
    And a segment failing all attempts fails the run with no --out written

  Scenario: Render budget and QC gate
    Given VOICE_GEN_MAX_RUN_MS exceeded between segments
    Then the run fails before the next segment with progress in the message
    And VOICE_GEN_FAIL_ON_QC=true with a failing report exits 1 without --out

  Scenario: Coverage gate
    When make coverage runs
    Then every file reports line >= 90% and function >= 90%
```

#### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-13T06:26:35.802Z

- Q: Keep the two nested retry loops from voice-gen? A: collapse to one verify loop — the inner
  loop was transport retry (HTTP timeouts); in-process generation has no transport, one inline
  exception retry preserves the transient-failure semantics.
- Q: Seed semantics without an OmniVoice seed param? A: torch.manual_seed(explicit seed) before
  attempt 0; retries resample (diffusion decoding is stochastic by default) — verified generate()
  has no seed kwarg.
- Q: generationId meaning without a server history id? A: uuid4 hex[:16] per accepted render —
  keeps the metadata field shape; documented in spec §4.

#### Design

WHAT/WHY: direct port of voice-gen index.ts processGeneratorIO control flow (read 2026-09-12) with
the HTTP client replaced by backend.Backend (0123) and concat/QC/mp3 from 0124.

WHERE / frozen names:
- `src/omni_voice_gen/pipeline.py`: `run(in_path: str, out_path: str, backend: Backend|None=None,
  transcoder: Callable[[str,str],None]|None=None) -> None`. `__main__.py` (0121) lazy-imports this.
- Profile resolution order (D4, frozen): segment.profile_id ?? segment.profile ??
  speaker.profile_id ?? speaker.profile ?? script.default_profile_id ?? script.default_profile ??
  VOICEBOX_DEFAULT_PROFILE ?? doc[0].metadata.voiceProfile — none → error listing every knob
  (voice-gen message parity).
- Verify loop (frozen): `for verify_attempt in 0..2`: render (backend exception → one immediate
  inline retry, voice-gen network-attempt parity) → transcribe best-effort → fidelity < 0.15 →
  regenerate → dip → regenerate → accept. Seed: explicit spec seed pins attempt 0 via
  torch.manual_seed; retries pass seed=None (resample — no seed param in OmniVoice.generate,
  verified 2026-09-12). Surviving dip → segment metadata loudnessDip=True (record, never fail).
- Budget: VOICE_GEN_MAX_RUN_MS checked before each segment; exceeded → RuntimeError with
  "render budget <ms>ms exceeded after <i>/<n> segments" (voice-gen shape).
- Content assembly: body = yaml.safe_dump of the executed VoiceScript; metadata = {generator:
  "kk:omni-voice-gen", audioPath: abs, duration: Σ(dur+gap/1000), segments: [{generationId: uuid4
  hex16, profile, speaker?, emotion?, duration, verifyRetries, transcription?, loudnessDip?}], qc:
  report, mp3Path?}; Content validated through contract.Content before write; failure at any point
  deletes out_path + sibling .wav/.mp3 (start AND failure cleanup, voice-gen parity).

Anti-patterns: do NOT keep voice-gen's nested network/verify loop structure (no transport layer
exists); do NOT swallow backend exceptions into QC (render failures fail the run); do NOT write
partial --out then fix up (single validated write at the end); no stdout output (stderr only).

Handoff: 0126 smoke-tests this via `kk executor run omni-voice-gen`.

#### Plan

1. run() skeleton: IO, cleanup, empty-input delegate to 0121 path.
2. Segment loop: profile resolution, spec build, progress, budget check.
3. Verify-retry loop + segment metadata.
4. Content assembly + QC gate + mp3 hook.
5. Full FakeBackend test matrix; make coverage green; spur-check wiring for python tests if needed.

#### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

#### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

#### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

#### References

- Spec: docs/design/omni-voice-gen.md (§4, §5, D6–D8)
- Source of truth: plugins/generations/voice-gen/src/index.ts (processGeneratorIO)
- Blocked by: 0122, 0123, 0124

#### History

- 2026-09-13T06:41:27.212Z backlog → todo (system)

- [x] (covers: Verify-retry loop mirrors voice-gen; Coverage and quality gate) Verify-retry with QC gate; per-file line/function coverage >= 90% via make coverage

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-13T06:26:35.802Z

- Q: Keep the two nested retry loops from voice-gen? A: collapse to one verify loop — the inner
  loop was transport retry (HTTP timeouts); in-process generation has no transport, one inline
  exception retry preserves the transient-failure semantics.
- Q: Seed semantics without an OmniVoice seed param? A: torch.manual_seed(explicit seed) before
  attempt 0; retries resample (diffusion decoding is stochastic by default) — verified generate()
  has no seed kwarg.
- Q: generationId meaning without a server history id? A: uuid4 hex[:16] per accepted render —
  keeps the metadata field shape; documented in spec §4.

### Design

WHAT/WHY: direct port of voice-gen index.ts processGeneratorIO control flow (read 2026-09-12) with
the HTTP client replaced by backend.Backend (0123) and concat/QC/mp3 from 0124.

WHERE / frozen names:
- `src/omni_voice_gen/pipeline.py`: `run(in_path: str, out_path: str, backend: Backend|None=None,
  transcoder: Callable[[str,str],None]|None=None) -> None`. `__main__.py` (0121) lazy-imports this.
- Profile resolution order (D4, frozen): segment.profile_id ?? segment.profile ??
  speaker.profile_id ?? speaker.profile ?? script.default_profile_id ?? script.default_profile ??
  VOICEBOX_DEFAULT_PROFILE ?? doc[0].metadata.voiceProfile — none → error listing every knob
  (voice-gen message parity).
- Verify loop (frozen): `for verify_attempt in 0..2`: render (backend exception → one immediate
  inline retry, voice-gen network-attempt parity) → transcribe best-effort → fidelity < 0.15 →
  regenerate → dip → regenerate → accept. Seed: explicit spec seed pins attempt 0 via
  torch.manual_seed; retries pass seed=None (resample — no seed param in OmniVoice.generate,
  verified 2026-09-12). Surviving dip → segment metadata loudnessDip=True (record, never fail).
- Budget: VOICE_GEN_MAX_RUN_MS checked before each segment; exceeded → RuntimeError with
  "render budget <ms>ms exceeded after <i>/<n> segments" (voice-gen shape).
- Content assembly: body = yaml.safe_dump of the executed VoiceScript; metadata = {generator:
  "kk:omni-voice-gen", audioPath: abs, duration: Σ(dur+gap/1000), segments: [{generationId: uuid4
  hex16, profile, speaker?, emotion?, duration, verifyRetries, transcription?, loudnessDip?}], qc:
  report, mp3Path?}; Content validated through contract.Content before write; failure at any point
  deletes out_path + sibling .wav/.mp3 (start AND failure cleanup, voice-gen parity).

Anti-patterns: do NOT keep voice-gen's nested network/verify loop structure (no transport layer
exists); do NOT swallow backend exceptions into QC (render failures fail the run); do NOT write
partial --out then fix up (single validated write at the end); no stdout output (stderr only).

Handoff: 0126 smoke-tests this via `kk executor run omni-voice-gen`.

### Plan

1. run() skeleton: IO, cleanup, empty-input delegate to 0121 path.
2. Segment loop: profile resolution, spec build, progress, budget check.
3. Verify-retry loop + segment metadata.
4. Content assembly + QC gate + mp3 hook.
5. Full FakeBackend test matrix; make coverage green; spur-check wiring for python tests if needed.

### Solution

#### Change map

- `plugins/generations/omni-voice-gen/src/omni_voice_gen/pipeline.py:251-289` — **R1** `run(in_path, out_path, backend=None, transcoder=None) -> None`. It owns all IO: it deletes stale `--out`/`<stem>.wav`/`<stem>.mp3` up front (`:266`), reads the input (`cannot read input …`), wraps parse errors as `Invalid DocList input: …`, and writes the empty-input notice without building a backend (0121 path). Any render failure unlinks all three and re-raises (`:288`). `--out` is written once, after `Content` validation.
- `plugins/generations/omni-voice-gen/src/omni_voice_gen/pipeline.py:158-248` — **R2/R4** `_render`. The flow is parse → merge → validate. The one D5 warning goes to stderr, then env and registry checks run before `backend.load()`. The render budget is checked before every segment (`:184`, `render budget <ms>ms exceeded after <i>/<n> segments — …`), with per-segment progress on stderr. Assembly steps:
  - `concat_wavs` writes the WAV.
  - The QC audit reuses `loudness_dip` and `transcription`; its `qc.totalDuration` is overridden to the D8.2 basis (`:226`).
  - `VOICE_GEN_FAIL_ON_QC=true` with a failing QC raises `Voice Quality Control failed (<score>/100):` plus the critical issues (`:236`).
  - The MP3 goes through an injectable transcoder (`:239`).
  - The body is canonical YAML of the executed VoiceScript (`:244`).
  - `metadata.generator` is `kk:omni-voice-gen` (`:46`).
- `plugins/generations/omni-voice-gen/src/omni_voice_gen/pipeline.py:87-107` — `resolve_profile_target`: the frozen D4 order is segment profile_id/profile → speaker → script default_profile_id/default_profile → `VOICEBOX_DEFAULT_PROFILE` → doc `metadata.voiceProfile`. If none is set, the error lists every knob.
- `plugins/generations/omni-voice-gen/src/omni_voice_gen/pipeline.py:118-155` — **R3** verify loop (spec §5), attempts 0..`MAX_VERIFY_RETRIES`(2):
  - A backend exception gets one inline retry; a second failure propagates and fails the run.
  - Transcription is best-effort; if ASR raises, the audio is kept.
  - Fidelity < 0.15 or a loudness dip triggers a regenerate.
  - An explicit `seed` applies to attempt 0 only; retries pass `seed=None`.
  - The final attempt is always accepted, and a surviving dip is recorded as `loudnessDip: true`.
- `plugins/generations/omni-voice-gen/src/omni_voice_gen/pipeline.py:64-84` — `_plain`: turns dataclasses into a plain tree and drops `None` (JS `undefined` parity). It is used for the YAML body, the segment metadata, and the camelCase `qc` report (`segmentIndex`, `totalDuration`, `overallScore`, …).
- `plugins/generations/omni-voice-gen/src/omni_voice_gen/__main__.py:20-35` — thin voice-gen `main()` equivalent: argument check, lazy `from .pipeline import run` (`:30`), and any exception → `omni-voice-gen failed: <msg>`, exit 1 (`:34`). The read/parse/notice logic moved into `pipeline.run`, per the frozen signature.
- `plugins/generations/omni-voice-gen/tests/test_pipeline.py:96-322` — **R5** FakeBackend matrix (no network, no model):
  - two-segment e2e with gap: exact §4 metadata, WAV bytes, stale MP3 removed, clean stdout, single warning (`:96`)
  - fidelity retries 0–1 then clean attempt 2, `verifyRetries=2`, seed pinning (`:151`)
  - low fidelity on every attempt keeps audio and QC flags it (`:165`)
  - surviving dip recorded (`:177`)
  - ASR unavailable (`:189`)
  - inline render retry (`:200`)
  - render failing both attempts → no `--out`/WAV (`:210`)
  - budget exceeded before segment 2 (`:222`)
  - invalid budget fails before load (`:243`)
  - `FAIL_ON_QC` via `main()` → exit 1, no outputs (`:253`)
  - MP3 transcoder path (`:270`)
  - empty input clears stale audio without loading (`:291`)
  - D4 order (`:304`)
- `plugins/generations/omni-voice-gen/tests/test_main.py:49-60` — the delegate test now uses the `run(in_path, out_path)` signature and checks that exceptions map to exit 1. The existing unreadable/invalid/empty-notice (no torch) tests pass unchanged through `pipeline.run`.
- `docs/04_DESIGN.md:481-482` — T3 surface sync: the `__main__` row now delegates, and a new `pipeline.run` row was added.
- `docs/design/omni-voice-gen.md:33-34` / `docs/design/omni-voice-gen.md:112` — clarified the D8.2 basis (gaps concat actually inserts, none before segment 1) and the `generationId` format (uuid4 hex[:16]).

#### Interpretations (flag for verify)

- **"A segment failing all attempts fails the run"** is read as render failure: a backend exception on both the initial and inline-retry generate. Low fidelity or a dip on the final attempt keeps the audio and QC flags it, matching voice-gen `index.ts` and spec §5 ("never fails the run by itself"). With `VOICE_GEN_FAIL_ON_QC=true`, that case exits 1 (tested).
- **D8.2 basis**: `concat_wavs` inserts `gaps_ms[i]` only for i > 0, so the gap on segment 1 is not counted. That keeps `metadata.duration` equal to the real WAV length and to `qc.totalDuration`.
- **`loudnessDip`** is always emitted as a bool (voice-gen parity; the schema field is optional).
- **Invalid `VOICE_GEN_MAX_RUN_MS`** (non-integer) fails loud before the model load instead of silently running unlimited.

#### Verification (targeted probes, run in `plugins/generations/omni-voice-gen`)

- `uv run pytest tests/test_pipeline.py tests/test_main.py -q` → 19 passed.
- `make lint` → `All checks passed!`
- `make coverage` → 181 passed, 0 skipped/xfail. `pipeline.py` 146 stmts at 100%, `__main__.py` at 100%. `coverage_gate: PASS (line and function coverage >= 90% per file)`.
- The project full gate (`bun run spur-check`) was not run; the pipeline `test` hop owns it.

#### Deferred / follow-ups

- **Plain-text clone-path bypass** (0123 scope note: a `VOICEBOX_DEFAULT_PROFILE` that is a filesystem path rather than a registry name) is not implemented. The profile target always goes through `resolve_profile` (unknown name → exit 1 naming it). Needs a follow-up WBS if plain-text inputs must clone from a raw path.
- **spur-check wiring for Python tests** (Plan step 5, "if needed"): not added. The root `package.json`/`lefthook.yml` have no Python hook, and adding one is a cross-cutting gate change outside this task's surfaces. `make coverage` remains the plugin's gate.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | src/omni_voice_gen/pipeline.py run(in_path, out_path, backend=None, transcoder=None) delete-then-render; tests/test_pipeline.py lifecycle tests |
| R2 | MET | Per-segment loop with D4 profile resolution order (segment → speaker → script default → env); test_pipeline resolution-order tests |
| R3 | MET | Verify-retry: ≤2 verify attempts per segment; fidelity < 0.15 or loudness dip triggers re-render; test_pipeline verify-retry tests |
| R4 | MET | Content assembly: body = canonical YAML of executed VoiceScript, metadata.generator = kk:omni-voice-gen; test_pipeline assembly tests |
| R5 | MET | make coverage gate: per-file line AND function ≥ 90% zero-tolerance; gate run green in test stage (test-gate PASS) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: End-to-end render with FakeBackend | MET | test | tests/test_pipeline.py FakeBackend end-to-end render test in full suite: 181 passed |
| Scenario: Verify-retry behavior | MET | test | verify-retry loop tests mirror voice-gen (≤2 attempts, dip/fidelity triggers) |
| Scenario: Render budget and QC gate | MET | test | budget + QC gate tests (audit_voice_segments outcomes gate success) |
| Scenario: Coverage gate | MET | command | make coverage: per-file line/function ≥ 90%, zero tolerance — PASS at record time |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |

### References

- Spec: docs/design/omni-voice-gen.md (§4, §5, D6–D8)
- Source of truth: plugins/generations/voice-gen/src/index.ts (processGeneratorIO)
- Blocked by: 0122, 0123, 0124

### History

- 2026-09-13T06:41:27.212Z backlog → todo (system)
- 2026-09-13T22:04:46.530Z todo → wip (system)
- 2026-09-13T22:12:29.000Z wip → testing (system)
- 2026-09-13T22:12:29.341Z testing → done (system)

