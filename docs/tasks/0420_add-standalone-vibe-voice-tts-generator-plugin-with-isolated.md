---
schema_version: 1
name: Add standalone vibe-voice-tts generator plugin with isolated uv Python worker
status: todo
template: feature-impl
created_at: 2026-11-21T07:41:11.812Z
updated_at: "2026-11-21T07:42:36.515Z"
feature_id: G16
priority: P2
estimate_hours: 5

---

## 0420. Add standalone vibe-voice-tts generator plugin with isolated uv Python worker

### Background

Implements: R1 — VibeVoice generator produces compatible audio Content; R4 — VibeVoice runs without the vendored reference checkout; R5 — VibeVoice rejects invalid inputs, unanchored multi-segment profiles and vendor paths; R6 — VibeVoice worker execution is bounded and cleaned up.

Reuses `@gobing-ai/voice-gen`'s `processGeneratorIO` pipeline (`plugins/generations/voice-gen/src/index.ts:41`) and `VoiceboxClient` interface (`plugins/generations/voice-gen/src/voicebox-client.ts:36`) following the `voxcpm-tts` pattern (`plugins/generations/voxcpm-tts/src/index.ts:22`, `plugins/generations/voxcpm-tts/src/voxcpm-client.ts:258`). Upstream `vendors/VibeVoice` (`vendors/VibeVoice/README.md:47`) is strictly reference-only; the isolated uv Python 3.12 project installs `vibevoice==0.0.1` from PyPI (`VibeVoiceForConditionalGenerationInference` + `VibeVoiceProcessor`, plus `VibeVoiceStreamingForConditionalGenerationInference` + `VibeVoiceStreamingProcessor` for cached `.pt` prompts).

Rubric: E5 D2 L2 C1 R1 = 11 → decompose (two distinct deliverables: standalone generator plugin vs CLI/workflow/board driver wiring).

### Requirements

- [ ] R1. Scaffold `plugins/generations/vibe-voice-tts` (`plugin.json`, `package.json`, `tsconfig.json`, `pyproject.toml` pinned to `requires-python = "==3.12.*"` and `vibevoice==0.0.1`, `uv.toml` with `link-mode = "hardlink"`, `uv.lock`, `profiles.json` with `robin-news` instruct placeholder, `README.md`) and register `vibe-voice-tts` in `packages/kk-core/tests/registry.test.ts`, `scripts/bundle-plugins.test.ts`, and `apps/cli/tests/package.test.ts`.
- [ ] R2. Implement `src/index.ts` and `src/vibevoice-client.ts` (`createVibeVoiceClient`, `VIBEVOICE_TTS_GENERATOR = 'kk:vibe-voice-tts'`, `parseVibeVoiceRegistry`, `assertNoVendorPath`, `resolveVibeVoiceWorkerCommand`) supporting `--in`/`--out` and `--batch`/`VIBEVOICE_BATCH_MANIFEST`, sequential integer-id NDJSON framing (1 MiB cap, 64 KiB stderr tail), single in-flight render, `reference`/`cached_prompt`/`instruct` profile validation (refusing multi-segment `instruct` renders on segment > 1), and `SIGTERM` → 2s → `SIGKILL` process-group teardown.
- [ ] R3. Implement `python/worker.py` with `isolate_protocol_stdout()` (`fd 1` duplicated for protocol JSON, `fd 1 -> fd 2` for library stdout), `assert_no_vendor` path/env guards, `load_backend` (`VIBEVOICE_MODEL` default `microsoft/VibeVoice-1.5B`, `VIBEVOICE_DEVICE` in `auto|cpu|cuda|mps`), and `_render` supporting `reference` mode (`VibeVoiceProcessor` + `VibeVoiceForConditionalGenerationInference` with `Speaker 1: <single-line text>` and `voice_samples`), `cached_prompt` mode (`VibeVoiceStreamingProcessor` + `VibeVoiceStreamingForConditionalGenerationInference` with `weights_only=True` `.pt` load), and `instruct` mode (single-segment unanchored synthesis), outputting validated 16-bit PCM mono WAV.
- [ ] R4. Add model-free unit and integration tests (`tests/fake-worker.ts`, `tests/vibevoice-client.test.ts`, `tests/vibevoice-tts.test.ts`, `tests/test_worker.py`) covering NDJSON protocol framing, batch manifests, vendor path rejection, unanchored multi-segment rejection, process-group teardown, and packaged asset resolution with `>=90%` line and function coverage.

### Acceptance Criteria

- [ ] AC1 — VibeVoice generator produces compatible audio Content
- [ ] AC2 — VibeVoice runs without the vendored reference checkout
- [ ] AC3 — VibeVoice rejects invalid inputs, unanchored multi-segment profiles and vendor paths
- [ ] AC4 — VibeVoice worker execution is bounded and cleaned up

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-21T07:42:35.907Z

- CLOSED: Reuses `@gobing-ai/voice-gen`'s `processGeneratorIO` + `VoiceboxClient` seam (`plugins/generations/voice-gen/src/index.ts:41`) with an isolated uv Python 3.12 NDJSON worker (`ADR-055`, `docs/design/vibe-voice-driver.md`).
- CLOSED: Installs `vibevoice==0.0.1` from PyPI (`VibeVoiceForConditionalGenerationInference` + `VibeVoiceProcessor`) with default checkpoint `microsoft/VibeVoice-1.5B`; `vendors/VibeVoice` stays strictly reference-only (`assertNoVendorPath` / `assert_no_vendor`).
- CLOSED: Supports `reference` (`.wav`), `cached_prompt` (`.pt`), and single-segment `instruct` placeholder modes, refusing multi-segment `instruct` renders on segment > 1 to guarantee speaker consistency.

### Design

Approach: Implement `plugins/generations/vibe-voice-tts` as a TypeScript `VoiceboxClient` adapter over a private, invocation-scoped uv Python 3.12 NDJSON worker (`ADR-055`, `docs/design/vibe-voice-driver.md`).
- Frozen exports & constants: `VIBEVOICE_TTS_GENERATOR = 'kk:vibe-voice-tts'`, `VIBEVOICE_DEFAULT_MODEL = 'microsoft/VibeVoice-1.5B'`, `VIBEVOICE_DEFAULT_DEVICE = 'auto'`, `VIBEVOICE_DEVICES = ['auto', 'cpu', 'cuda', 'mps'] as const`, `createVibeVoiceClient(options?: VibeVoiceClientOptions): VibeVoiceClientHandle`, `parseVibeVoiceRegistry(raw: unknown, registryDir: string): VibeVoiceProfile[]`, `assertNoVendorPath(candidate: string, label: string): string`, `resolveVibeVoiceWorkerCommand(pluginRoot: string): string[]`.
- Profile modes: `VibeVoiceProfileMode = 'instruct' | 'reference' | 'cached_prompt'`. `reference` requires `reference_wav_path`; `cached_prompt` requires `prompt_pt_path`; `instruct` requires `instruct` and is refused on segment > 1 to prevent mid-episode speaker changes.
- Anti-patterns (do not implement): no import/path/symlink/fallback into `vendors/VibeVoice`; no persistent HTTP daemon across CLI invocations; no duplication of `voice-gen` VoiceScript/QC/WAV/MP3 logic in Python; no live model download in unit tests.
- Primary file targets: `plugins/generations/vibe-voice-tts/**`, `packages/kk-core/tests/registry.test.ts`, `scripts/bundle-plugins.test.ts`, `apps/cli/tests/package.test.ts`.
- Handoff to dependent task: exposes discoverable `vibe-voice-tts` generator producing `metadata.generator = 'kk:vibe-voice-tts'` and honoring `VIBEVOICE_BATCH_MANIFEST`.

### Plan

1. Create `plugins/generations/vibe-voice-tts/{plugin.json,package.json,tsconfig.json,pyproject.toml,uv.toml,profiles.json,README.md}` and generate `uv.lock` for `vibevoice==0.0.1`.
2. Implement `plugins/generations/vibe-voice-tts/src/vibevoice-client.ts` and `src/index.ts` with `VoiceboxClient` adapter, batch manifest support, vendor path guards, profile registry parser, and process-group teardown.
3. Implement `plugins/generations/vibe-voice-tts/python/worker.py` with fd-1 protocol isolation, `assert_no_vendor`, `load_backend`, and `_render` for `reference`, `cached_prompt`, and single-segment `instruct` modes.
4. Write model-free TS tests (`tests/fake-worker.ts`, `tests/vibevoice-client.test.ts`, `tests/vibevoice-tts.test.ts`) and Python worker tests (`tests/test_worker.py`).
5. Update `packages/kk-core/tests/registry.test.ts`, `scripts/bundle-plugins.test.ts`, and `apps/cli/tests/package.test.ts` for `vibe-voice-tts` discovery and staging.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Feature: `docs/features/G16_vibevoice-voice-driver-vibe-voice-for-tts-workflows.md`
- ADR: `docs/00_ADR.md` (ADR-055)
- Design satellite: `docs/design/vibe-voice-driver.md`
- Reference patterns: `plugins/generations/voxcpm-tts/src/index.ts:22`, `plugins/generations/voxcpm-tts/src/voxcpm-client.ts:258`, `plugins/generations/voxcpm-tts/python/worker.py:1`

### History
