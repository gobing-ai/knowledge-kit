---
schema_version: 1
name: "omni-voice-gen: pipeline orchestration + verify-retry + coverage gate"
status: backlog
template: feature-impl
created_at: 2026-09-13T05:54:11.173Z
updated_at: "2026-09-13T06:27:08.221Z"
feature_id: F611

ac_altitude: task-local
---

## 0125. omni-voice-gen: pipeline orchestration + verify-retry + coverage gate

### Background

Captured from the creation title: "omni-voice-gen: pipeline orchestration + verify-retry + coverage gate".

### Requirements

- [ ] R1. `pipeline.py` `run(in_path, out_path, backend=None, transcoder=None)`: delete-then-render
    semantics identical to voice-gen processGeneratorIO (stale --out/WAV/MP3 removed at start AND on
    failure).
- [ ] R2. Per-segment loop: profile resolution order D4 (segment → speaker → script default →
    VOICEBOX_DEFAULT_PROFILE → doc metadata.voiceProfile; none → error listing every knob); per-
    segment stderr progress lines; VOICE_GEN_MAX_RUN_MS checked between segments with the voice-gen
    fail-loud message shape.
- [ ] R3. Verify-retry: ≤2 verify attempts per segment; transcription fidelity < 0.15 or loudness dip →
    regenerate (resample; explicit seed pins attempt 0 only); surviving dip recorded in segment
    metadata; verifyRetries counted; ASR unavailable → keep audio (QC backstop), matching voice-gen.
- [ ] R4. Content assembly: body = canonical YAML of the executed VoiceScript; metadata.generator
    "kk:omni-voice-gen"; audioPath/mp3Path/duration/segments/qc per spec §4; VOICE_GEN_FAIL_ON_QC=
    true + failing QC → exit 1 naming score and critical issues.
- [ ] R5. Coverage gate: `make coverage` proves per-file line AND function coverage ≥ 90% with zero
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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Spec: docs/design/omni-voice-gen.md (§4, §5, D6–D8)
- Source of truth: plugins/generations/voice-gen/src/index.ts (processGeneratorIO)
- Blocked by: 0122, 0123, 0124

### History
