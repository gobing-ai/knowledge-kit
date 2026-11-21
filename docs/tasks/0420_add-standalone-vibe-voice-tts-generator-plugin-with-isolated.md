---
schema_version: 1
name: Add standalone vibe-voice-tts generator plugin with isolated uv Python worker
status: done
template: feature-impl
created_at: 2026-11-21T07:41:11.812Z
updated_at: "2026-11-21T09:04:31.970Z"
feature_id: G16
priority: P2
estimate_hours: 5

done_forced: "false"
done_reason: unforced close
---

## 0420. Add standalone vibe-voice-tts generator plugin with isolated uv Python worker

### Background

Implements: R1 — VibeVoice generator produces compatible audio Content; R4 — VibeVoice runs without the vendored reference checkout; R5 — VibeVoice rejects invalid inputs, unanchored multi-segment profiles and vendor paths; R6 — VibeVoice worker execution is bounded and cleaned up.

Reuses `@gobing-ai/voice-gen`'s `processGeneratorIO` pipeline (`plugins/generations/voice-gen/src/index.ts:41`) and `VoiceboxClient` interface (`plugins/generations/voice-gen/src/voicebox-client.ts:36`) following the `voxcpm-tts` pattern (`plugins/generations/voxcpm-tts/src/index.ts:22`, `plugins/generations/voxcpm-tts/src/voxcpm-client.ts:258`). Upstream `vendors/VibeVoice` (`vendors/VibeVoice/README.md:47`) is strictly reference-only; the isolated uv Python 3.12 project installs `vibevoice==0.0.1` from PyPI (`VibeVoiceForConditionalGenerationInference` + `VibeVoiceProcessor`, plus `VibeVoiceStreamingForConditionalGenerationInference` + `VibeVoiceStreamingProcessor` for cached `.pt` prompts).

Rubric: E5 D2 L2 C1 R1 = 11 → decompose (two distinct deliverables: standalone generator plugin vs CLI/workflow/board driver wiring).

### Requirements

- [x] R1. Scaffold `plugins/generations/vibe-voice-tts` (`plugin.json`, `package.json`, `tsconfig.json`, `pyproject.toml` pinned to `requires-python = "==3.12.*"` and `vibevoice==0.0.1`, `uv.toml` with `link-mode = "hardlink"`, `uv.lock`, `profiles.json` with `robin-news` instruct placeholder, `README.md`) and register `vibe-voice-tts` in `packages/kk-core/tests/registry.test.ts`, `scripts/bundle-plugins.test.ts`, and `apps/cli/tests/package.test.ts`.
- [x] R2. Implement `src/index.ts` and `src/vibevoice-client.ts` (`createVibeVoiceClient`, `VIBEVOICE_TTS_GENERATOR = 'kk:vibe-voice-tts'`, `parseVibeVoiceRegistry`, `assertNoVendorPath`, `resolveVibeVoiceWorkerCommand`) supporting `--in`/`--out` and `--batch`/`VIBEVOICE_BATCH_MANIFEST`, sequential integer-id NDJSON framing (1 MiB cap, 64 KiB stderr tail), single in-flight render, `reference`/`cached_prompt`/`instruct` profile validation (refusing multi-segment `instruct` renders on segment > 1), and `SIGTERM` → 2s → `SIGKILL` process-group teardown.
- [x] R3. Implement `python/worker.py` with `isolate_protocol_stdout()` (`fd 1` duplicated for protocol JSON, `fd 1 -> fd 2` for library stdout), `assert_no_vendor` path/env guards, `load_backend` (`VIBEVOICE_MODEL` default `microsoft/VibeVoice-1.5B`, `VIBEVOICE_DEVICE` in `auto|cpu|cuda|mps`), and `_render` supporting `reference` mode (`VibeVoiceProcessor` + `VibeVoiceForConditionalGenerationInference` with `Speaker 1: <single-line text>` and `voice_samples`), `cached_prompt` mode (`VibeVoiceStreamingProcessor` + `VibeVoiceStreamingForConditionalGenerationInference` with `weights_only=True` `.pt` load), and `instruct` mode (single-segment unanchored synthesis), outputting validated 16-bit PCM mono WAV.
- [x] R4. Add model-free unit and integration tests (`tests/fake-worker.ts`, `tests/vibevoice-client.test.ts`, `tests/vibevoice-tts.test.ts`, `tests/test_worker.py`) covering NDJSON protocol framing, batch manifests, vendor path rejection, unanchored multi-segment rejection, process-group teardown, and packaged asset resolution with `>=90%` line and function coverage.

### Acceptance Criteria

- [x] AC1 — VibeVoice generator produces compatible audio Content
- [x] AC2 — VibeVoice runs without the vendored reference checkout
- [x] AC3 — VibeVoice rejects invalid inputs, unanchored multi-segment profiles and vendor paths
- [x] AC4 — VibeVoice worker execution is bounded and cleaned up

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

Added the standalone `plugins/generations/vibe-voice-tts` generator plugin (`@gobing-ai/vibe-voice-tts`, generator id `kk:vibe-voice-tts`) backed by an isolated uv Python 3.12 NDJSON worker (`vibevoice==0.0.1`, default model `microsoft/VibeVoice-1.5B`) and registered it in discovery, bundling, rule allowlists, and package staging tests:

- `plugins/generations/vibe-voice-tts/plugin.json`:1, `package.json`:1, `tsconfig.json`:1, `pyproject.toml`:1, `uv.toml`:1, `uv.lock`:1, `profiles.json`:1, `README.md`:1 — standalone plugin metadata, locked Python 3.12 (`vibevoice==0.0.1`) dependency graph verified free of `vendors/` references, committed `robin-news` instruct placeholder, and operator documentation.
- `plugins/generations/vibe-voice-tts/src/index.ts`:22 — CLI entry (`main`) supporting `--in`/`--out` and `--batch`/`VIBEVOICE_BATCH_MANIFEST`, delegating synthesis, VoiceScript segmentation, QC, and optional MP3 transcoding to `@gobing-ai/voice-gen`'s `processGeneratorIO` with `VIBEVOICE_TTS_GENERATOR = 'kk:vibe-voice-tts'` and guaranteed `handle.close()` teardown.
- `plugins/generations/vibe-voice-tts/src/vibevoice-client.ts`:85-760 — `VoiceboxClient` adapter implementing `assertNoVendorPath`, `assertEnvPathsSafe`, `parseVibeVoiceRegistry` (`reference`, `cached_prompt`, `instruct` + `cfg_scale`/`ddpm_steps`), `resolveVibeVoiceWorkerCommand`, single-segment `instruct` consistency guard, 1 MiB NDJSON framing/64 KiB stderr caps, 16-bit PCM mono WAV validation, and detached process-group `SIGTERM` → 2 s → `SIGKILL` cleanup.
- `plugins/generations/vibe-voice-tts/python/worker.py`:45-395 — `isolate_protocol_stdout` (`fd 1 -> fd 2`, saved fd 1 protocol channel), `assert_no_vendor`, `resolve_device` (fail-closed `cuda`/`mps`), `load_backend` (with explicit actionable error when streaming classes are missing in `vibevoice==0.0.1`), and `_render` supporting `reference`, `cached_prompt` (`weights_only=True` under `safe_globals`), and single-segment `instruct` synthesis.
- `plugins/generations/vibe-voice-tts/tests/` (`fake-worker.ts`:1, `vibevoice-client.test.ts`:1, `vibevoice-tts.test.ts`:1, `test_worker.py`:1) — model-free unit/integration tests and outside-checkout bundle smoke test (`100.00%` funcs / `98.39%` lines on `src/index.ts`; `96.88%` funcs / `96.56%` lines on `src/vibevoice-client.ts`; 13/13 pytest passing).
- `.spur/rules/strict/runtime-boundaries.yaml`:94,185, `packages/kk-core/tests/registry.test.ts`:281,661, `scripts/bundle-plugins.test.ts`:142,185, `apps/cli/tests/package.test.ts`:33, `bun.lock` — runtime-boundary allowlist entries and plugin registry/bundling/package verification.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `plugins/generations/vibe-voice-tts/plugin.json:1-6`, `plugins/generations/vibe-voice-tts/pyproject.toml:1-9`, `plugins/generations/vibe-voice-tts/uv.lock:1-10`, `plugins/generations/vibe-voice-tts/profiles.json:1-10`, `packages/kk-core/tests/registry.test.ts:281,661`, `scripts/bundle-plugins.test.ts:142,185-195`, `apps/cli/tests/package.test.ts:33-38`, `.spur/rules/strict/runtime-boundaries.yaml:94-97,185-189` |
| R2 | MET | `plugins/generations/vibe-voice-tts/src/index.ts:22-96`, `plugins/generations/vibe-voice-tts/src/vibevoice-client.ts:10-250,286-760` (`VIBEVOICE_TTS_GENERATOR`, `parseVibeVoiceRegistry`, `assertNoVendorPath`, `resolveVibeVoiceWorkerCommand`, `--batch`/`VIBEVOICE_BATCH_MANIFEST`, `instructSegments > 1` guard, `terminateChild`) |
| R3 | MET | `plugins/generations/vibe-voice-tts/python/worker.py:49-125,157-218,275-372,385-492,522-570` (`assert_no_vendor`, `resolve_device`, `load_backend`, `_render` across `reference`/`cached_prompt`/`instruct`, `write_pcm16_wav`, `isolate_protocol_stdout`) |
| R4 | MET | `plugins/generations/vibe-voice-tts/tests/fake-worker.ts:1-155`, `plugins/generations/vibe-voice-tts/tests/vibevoice-client.test.ts:1-421`, `plugins/generations/vibe-voice-tts/tests/vibevoice-tts.test.ts:1-309`, `plugins/generations/vibe-voice-tts/tests/test_worker.py:1-258`; 42/42 TS tests (`src/index.ts` 100.00% funcs / 98.39% lines, `src/vibevoice-client.ts` 96.88% funcs / 96.56% lines) and 13/13 pytest tests passed |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — VibeVoice generator produces compatible audio Content | MET | test | `plugins/generations/vibe-voice-tts/src/index.ts:53-91`, `plugins/generations/vibe-voice-tts/tests/vibevoice-tts.test.ts:132-192` (`bun test plugins/generations/vibe-voice-tts/tests/` 42/42 pass; plain text, multi-segment VoiceScript, MP3 sibling, `--batch`/`VIBEVOICE_BATCH_MANIFEST`) |
| AC2 — VibeVoice runs without the vendored reference checkout | MET | test | `plugins/generations/vibe-voice-tts/pyproject.toml:5-6`, `plugins/generations/vibe-voice-tts/uv.lock:1`, `plugins/generations/vibe-voice-tts/tests/vibevoice-tts.test.ts:268-308`, `packages/kk-core/tests/registry.test.ts:281,661`, `scripts/bundle-plugins.test.ts:185-195`, `apps/cli/tests/package.test.ts:33-38`; `rg -n "vendors"` clean on runtime/lock files; locked `vibevoice==0.0.1` import probe OK |
| AC3 — VibeVoice rejects invalid inputs, unanchored multi-segment profiles and vendor paths | MET | test | `plugins/generations/vibe-voice-tts/src/vibevoice-client.ts:91-230,554-580`, `plugins/generations/vibe-voice-tts/python/worker.py:49-125,157-218,385-456`, `plugins/generations/vibe-voice-tts/tests/vibevoice-client.test.ts:80-228,270-310`, `plugins/generations/vibe-voice-tts/tests/test_worker.py:22-160` |
| AC4 — VibeVoice worker execution is bounded and cleaned up | MET | test | `plugins/generations/vibe-voice-tts/src/vibevoice-client.ts:329-485`, `plugins/generations/vibe-voice-tts/python/worker.py:522-570`, `plugins/generations/vibe-voice-tts/tests/vibevoice-client.test.ts:230-390,392-420`, `plugins/generations/vibe-voice-tts/tests/test_worker.py:131-143` (fd-1 isolation, 1 MiB cap, timeout, `SIGTERM`→2 s→`SIGKILL` descendant reaping) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

- Feature: `docs/features/G16_vibevoice-voice-driver-vibe-voice-for-tts-workflows.md`
- ADR: `docs/00_ADR.md` (ADR-055)
- Design satellite: `docs/design/vibe-voice-driver.md`
- Reference patterns: `plugins/generations/voxcpm-tts/src/index.ts:22`, `plugins/generations/voxcpm-tts/src/voxcpm-client.ts:258`, `plugins/generations/voxcpm-tts/python/worker.py:1`

### History

- 2026-11-21T08:54:36.667Z todo → wip (system)
- 2026-11-21T09:04:29.926Z wip → testing (system)
- 2026-11-21T09:04:31.963Z testing → done (system)

