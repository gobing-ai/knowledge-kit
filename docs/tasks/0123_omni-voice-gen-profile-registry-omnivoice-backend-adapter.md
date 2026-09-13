---
schema_version: 1
name: "omni-voice-gen: profile registry + OmniVoice backend adapter"
status: backlog
template: feature-impl
created_at: 2026-09-13T05:54:10.751Z
updated_at: "2026-09-13T06:27:07.569Z"
feature_id: F611

ac_altitude: task-local
---

## 0123. omni-voice-gen: profile registry + OmniVoice backend adapter

### Background

Captured from the creation title: "omni-voice-gen: profile registry + OmniVoice backend adapter".

### Requirements

- [ ] R1. `profiles.py` loads the registry JSON (default `<plugin>/profiles.json`, override
    `OMNIVOICE_PROFILE_REGISTRY`) mapping name → `{ref_audio, ref_text}` | `{prompt}` | `{instruct}`;
    resolution is case-insensitive by name; unknown profile → error naming the profile and the
    registry path.
- [ ] R2. `backend.py` defines the `Backend` protocol (`load`, `generate(SegmentSpec) -> (wav_bytes,
    duration_sec)`, `transcribe(wav: bytes, language: str) -> str`) and a `FakeBackend` importable
    by any test (lives in backend.py, not conftest, so 0125 reuses it).
- [ ] R3. Real backend `OmnivoiceBackend`: lazy single `OmniVoice.from_pretrained(OMNIVOICE_MODEL default
    k2-fsa/OmniVoice)` per instance; device auto-select cuda→mps→cpu unless `OMNIVOICE_DEVICE`;
    registry entry → ref_audio/ref_text | VoiceClonePrompt.load | instruct; `OMNIVOICE_SPEED`
    default 1.0; explicit seed → `torch.manual_seed` before generate; output normalized to 24kHz
    16-bit mono WAV bytes + duration (float seconds).
- [ ] R4. `transcribe` uses the model's own ASR: `model.load_asr_model()` lazily on first call, then
    `model.transcribe((waveform, 24000))` (public API — verified omnivoice 0.2.1 exposes both;
    default model `openai/whisper-large-v3-turbo`, override via new env `OMNIVOICE_ASR_MODEL`).
    Any ASR failure raises (caller treats transcription as best-effort).
- [ ] R5. Language strings pass straight to `OmniVoice.generate(language=...)` — OmniVoice validates
    against its LANG_IDS (600+); we do not pre-validate.

### Acceptance Criteria

```gherkin
Feature: Profile registry and backend adapter

  Scenario: Registry resolution
    Given a registry with clone, prompt, and instruct entries
    When profiles resolve by exact or mixed-case name
    Then the correct entry form is returned
    And an unknown name errors with the profile name and registry path

  Scenario: Backend maps registry forms to OmniVoice calls
    Given a FakeBackend-free unit boundary mocked at omnivoice.OmniVoice
    When generate runs for each registry form
    Then OmniVoice.generate receives ref_audio/ref_text, voice_clone_prompt, or instruct respectively
    And seed triggers torch.manual_seed
    And the returned WAV is 24kHz 16-bit mono

  Scenario: Single model load
    When ten segments render through one backend instance
    Then from_pretrained is called exactly once
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-13T06:26:34.852Z

- Q: Own Whisper pipeline vs model ASR? A: model's public load_asr_model()/transcribe (verified
  2026-09-12 — earlier draft assumed building our own transformers pipeline; unnecessary).
  OMNIVOICE_ASR_MODEL env added for the whisper override.
- Q: Language pre-validation? A: none — OmniVoice _resolve_language errors with valid-id guidance.
- Q: Cross-run voice cache? A: operator-managed .pt prompt entries only; no implicit caching
  (deterministic over implicit).

### Design

WHAT/WHY: the only torch/omnivoice-importing module, behind a Protocol so every other module and
all tests run without a GPU/model. Verified API surface (omnivoice 0.2.1 source, 2026-09-12):
from_pretrained(name, device_map=, dtype=), generate(text, language=, ref_audio=, ref_text=,
voice_clone_prompt=, instruct=, speed=, duration=, normalize_text=False) -> list[np.ndarray] @24kHz,
VoiceClonePrompt.load(path), load_asr_model()/transcribe(audio) (whisper-large-v3-turbo default).

WHERE / frozen names:
- `src/omni_voice_gen/profiles.py`: `ProfileKind = Literal["clone","prompt","instruct"]`;
  `ProfileEntry` dataclass (kind, ref_audio?, ref_text?, prompt?, instruct?);
  `load_registry(path: Path) -> dict[str, ProfileEntry]`; `resolve_profile(name, registry)
  -> ProfileEntry` (case-insensitive; unknown → ValueError naming profile + registry path).
- `src/omni_voice_gen/backend.py`: `SegmentSpec` TypedDict {text: str, language: str, profile:
  ProfileEntry, instruct: str|None, seed: int|None, speed: float|None}; `Backend` Protocol;
  `OmnivoiceBackend` (env: OMNIVOICE_MODEL/OMNIVOICE_DEVICE/OMNIVOICE_SPEED/OMNIVOICE_ASR_MODEL);
  `FakeBackend(wavs: list[bytes], durations: list[float], transcriptions: dict[int,str])` with a
  `calls: list[SegmentSpec]` record.
- WAV encode: numpy float32 [-1,1] → int16 via `np.clip` + `struct`/`wave` stdlib write at 24000 Hz
  mono; duration = samples/24000. (soundfile is an omnivoice dep and acceptable, but stdlib `wave`
  removes a variable — pick one, do not mix.)

Anti-patterns: do NOT shell out to omnivoice-infer per segment (model reload per segment turns a
render into hours — the entire point of D6 is one load); do NOT cache clone prompts implicitly —
if the operator wants speed they save a .pt and use a prompt entry; do NOT read VOICEBOX_URL /
VOICEBOX_TIMEOUT_MS / VOICEBOX_POLL_MS (transport knobs, meaningless in-process).

Handoff: 0125 consumes Backend/SegmentSpec/FakeBackend exactly as named; QC transcription flows
through backend.transcribe only.

### Plan

1. profiles.py + registry schema + sample profiles.json placeholders.
2. Backend protocol + SegmentSpec + FakeBackend.
3. Real backend with lazy load, device select, seed, WAV normalization, lazy ASR.
4. tests: registry matrix, backend mapping (mock omnivoice), single-load, device precedence.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Spec: docs/design/omni-voice-gen.md (D4, D6, §3 Backend protocol)
- OmniVoice API reference: PyPI omnivoice 0.2.1 (generate/create_voice_clone_prompt/VoiceClonePrompt)
- Blocked by: 0121

### History
