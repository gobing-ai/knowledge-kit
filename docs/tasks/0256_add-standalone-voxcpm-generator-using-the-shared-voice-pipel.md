---
schema_version: 1
name: Add standalone VoxCPM generator using the shared voice pipeline
status: todo
template: feature-impl
created_at: 2026-10-12T00:07:13.357Z
updated_at: "2026-10-12T00:09:49.134Z"
feature_id: G14
priority: P2
estimate_hours: 8

---

## 0256. Add standalone VoxCPM generator using the shared voice pipeline

### Background

G14 needs a selectable local TTS backend without copying the existing VoiceScript/QC/audio pipeline. Gemini already injects a client in plugins/generations/gemini-tts/src/index.ts:29; the client contract is plugins/generations/voice-gen/src/voicebox-client.ts:39. The model API inspected in vendors is reference evidence only; verify compatibility against the pinned independently installed release before writing the adapter. Packaging copies non-JS assets and bundles TS entries in scripts/bundle-plugins.ts:53.

### Requirements

- [ ] R1. Create discoverable voxcpm-tts with a TypeScript VoiceboxClient adapter that reuses processGeneratorIO, produces compatible WAV/audio Content, QC and optional MP3, and preserves VoiceScript segments and gaps.
- [ ] R2. Install a pinned external VoxCPM package in an isolated uv project with lock and a supported Python version; package worker/profile assets for use outside the repository. Prohibit all product access to vendors, including canonicalized configured paths.
- [ ] R3. Validate Doc input, worker protocol, sample rate/waveform, profiles and model/reference paths; provide an explicit robin-news profile; reject unsupported controls/modes and missing assets without silent substitution or stale successful output.
- [ ] R4. Own at most one model instance per invocation and a bounded sequential worker; isolate library logs to stderr and terminate/reap children on success, failure, timeout and executor cancellation.
- [ ] R5. Add model-free adapter/worker/contract and installed-package tests; document setup and new surfaces in docs/04_DESIGN.md in the same change. Do not claim ASR checks when transcription is unavailable.

### Acceptance Criteria

- [ ] AC1 — VoxCPM produces compatible audio Content
- [ ] AC2 — VoxCPM runs without the vendor checkout
- [ ] AC3 — VoxCPM rejects invalid inputs and unsupported profiles
- [ ] AC4 — VoxCPM worker execution is bounded and cleaned up

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

ADR-036 and docs/design/voxcpm-daily-voice-driver.md are the decided design. vendors/ is reference-only: no product imports, path dependencies, subprocess paths, model/reference defaults, symlinks, copied modules or build inputs may resolve there. No default driver change, publishing, daemon, training or speculative abstraction. Use existing Bun/TypeScript/Biome and private uv worker; no .github/workflows changes.

Chosen design: new plugins/generations/voxcpm-tts/{plugin.json,package.json,tsconfig.json,src/,python/,pyproject.toml,uv.lock,profiles.json,tests/,README.md}. Reuse the Gemini injection pattern; export only the existing client types from @gobing-ai/voice-gen if necessary. Implement a private NDJSON stdin/stdout worker with request ids and invocation-scoped WAV paths; configure VOXCPM_MODEL/DEVICE/PROFILES_PATH and existing shared audio budgets. Read actual tts_model.sample_rate, convert finite mono output to PCM16, never assume OmniVoice 24kHz. Installed package compatibility is a required first probe, not a premise. Omit optional transcribe initially and report missing ASR. Reject duplicate Python pipeline and HTTP service.

Execution budget: one implementation run, model-free test/cleanup/distribution probes and one final project gate; live model/quality evidence belongs to the comparison task. Persist targeted logs and version probe under .spur/run/<run-id>/voxcpm/. requireDiff: new plugin plus minimal exports/lock/docs; no vendor changes. Fake dependencies use the same real worker framing to expose protocol errors.

Verified upstream mapping (reference only): vendors/VoxCPM/README.md:147 uses a parenthesized description prefix in text for VoxCPM2 voice design; core.py:208 has no instruct keyword. Verify that syntax against the pinned installed release, then map profile instruct to that prefix while preserving the source transcript for QC/comparison. Reference continuation uses paired prompt_wav_path/prompt_text; reference-only cloning uses reference_wav_path. No reads of vendor audio or code at product runtime.

### Plan

- [ ] Verify a published VoxCPM release supports the selected model/API; pin it and interpreter in uv lock without local path dependencies. Record the compatibility probe.
- [ ] Implement manifest, entry, profiles, client and isolated worker; reuse shared VoiceScript/QC/audio handling and minimal existing type exports.
- [ ] Exercise plain text and VoiceScript, native-rate WAV, optional MP3, invalid profiles/paths/protocol/waveforms and stale output protection with fakes.
- [ ] Exercise timeout, exception and executor cancellation; assert owned workers are reaped and stdout protocol remains valid.
- [ ] Stage and run plugin discovery/render with fake inference outside the checkout; assert worker/assets resolve and vendors is unavailable without changing it.
- [ ] Update plugin README and docs/04_DESIGN.md; run lint, full tests, build and relevant Spur rules, retaining real failures.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
