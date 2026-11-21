---
kind: design
title: "VibeVoice voice driver (vibe-voice)"
status: accepted
created_at: 2026-11-20
updated_at: 2026-11-20
related: [G16]
tags: [contract, G16, plugin, workflow]
---

# VibeVoice voice driver (`vibe-voice`)

Status: implemented design (G16; ADR-055). Companion to `voice-gen.md` and `voxcpm-daily-voice-driver.md`; specifies the standalone `vibe-voice-tts` generator plugin, its private uv Python worker, profile registry, and the driver-switching wiring across `dailyGenerate`, `kk news generate-voice`, and the Spur Board manifest.

## 1. Outcome and boundaries

Both daily voice workflows (`kk-daily-ai-voice`, `kk-daily-ai-voice2`) and the consolidated news generation pipeline (`kk news generate-voice --engine vibe-voice`) accept `vdriver=vibe-voice` (and convenience alias `vdriver=vibevoice`). Existing workflow defaults (`voxcpm` on news/voice2, `gemini` on voice1) and fallback chains remain untouched unless explicitly configured by the operator.

`vendors/VibeVoice` is **reference-only** (ADR-020, ADR-036, ADR-055). No product import, subprocess, dependency, `PYTHONPATH`, model/cache/profile/reference path, symlink, fallback, copied upstream module, build input, or packaging source may access `vendors/`. Configured paths are canonicalized and validated before access (`assertNoVendorPath` in TypeScript, `assert_no_vendor` in Python), including external cache settings (`HF_HOME`, `HF_HUB_CACHE`, `UV_CACHE_DIR`, `PYTHONPATH`, etc.).

## 2. Standalone generator (`plugins/generations/vibe-voice-tts`)

### Layout

```text
plugins/generations/vibe-voice-tts/
  plugin.json                 # { name: "vibe-voice-tts", kind: "generator", entry: "./src/index.ts", version: "1.0.0" }
  package.json                # @gobing-ai/vibe-voice-tts; deps: @gobing-ai/voice-gen, @gobing-ai/ts-utils
  tsconfig.json               # extends shared tsconfig preset
  pyproject.toml              # requires-python = "==3.12.*", dependencies = ["vibevoice==0.0.1"]
  uv.toml                     # link-mode = "hardlink"
  uv.lock                     # locked uv dependency graph
  profiles.json               # committed placeholder registry (robin-news instruct placeholder)
  README.md                   # operator runbook + env reference
  src/
    index.ts                  # main(): --in/--out or --batch / VIBEVOICE_BATCH_MANIFEST -> processGeneratorIO(..., 'kk:vibe-voice-tts')
    vibevoice-client.ts       # createVibeVoiceClient(): VoiceboxClientHandle over private uv NDJSON worker
  python/
    worker.py                 # isolated fd-1 NDJSON inference worker over vibevoice==0.0.1
  tests/
    fake-worker.ts            # real-framing NDJSON fake inference worker for model-free TS tests
    vibevoice-client.test.ts  # protocol framing, vendor guards, registry validation, process-group teardown
    vibevoice-tts.test.ts     # end-to-end entry, batch manifest, Content/WAV/MP3/QC assertions
    test_worker.py            # pytest unit tests for worker.py (no model download)
```

### TypeScript entry and `VoiceboxClient` adapter

- Reuses `@gobing-ai/voice-gen`'s `processGeneratorIO(in, out, client, undefined, 'kk:vibe-voice-tts')` so VoiceScript parsing, segmentation, gaps, speed post-processing, verify-retry, loudness-dip detection, WAV concatenation, MP3 transcoding, and QC audit share one implementation.
- Supports `--batch <manifest.json>` (or `VIBEVOICE_BATCH_MANIFEST`): validates an array of `{ in, out }` string pairs and runs `processGeneratorIO` sequentially against one shared `VibeVoiceClientHandle` so the model loads at most once across all sections of an episode.
- Spawns `uv run --project <pluginRoot> --locked --no-dev python <pluginRoot>/python/worker.py` lazily on `health()` (after shared `Doc[]` validation, so empty input spawns nothing).
- Speaks sequential integer-id NDJSON (`id >= 1`, 1 MiB line cap, 64 KiB retained stderr tail, one in-flight render).
- Owns process-group cleanup (`detached: true`, `SIGTERM` to `-pgid` → 2 s grace → `SIGKILL` to `-pgid` → 1 s reap + scratch directory removal) on `close()` and `SIGTERM`/`SIGINT`.

## 3. Backend and profile registry

### Python package and model checkpoints

- Pinned package: independently published `vibevoice==0.0.1` on PyPI (wheel SHA256 `fe42a8ee9adcd4fa87b2abd72be502f635bb847387e682b672022d7a9d606add`) under Python 3.12 (`requires-python = "==3.12.*"`). Note that the `0.0.1` PyPI wheel ships `VibeVoiceProcessor` + `VibeVoiceForConditionalGenerationInference` (standard 1.5B reference/instruct synthesis); if a streaming checkpoint/`cached_prompt` profile is configured against `0.0.1`, `worker.py` fails loud with an actionable `WorkerError` reporting the missing streaming inference modules.
- Default model (`VIBEVOICE_MODEL`): `microsoft/VibeVoice-1.5B` (64K context, ~90 min generation, 24 kHz output sample rate, native English and Chinese support, reference-WAV cloning via `VibeVoiceProcessor` + `VibeVoiceForConditionalGenerationInference`).
- Optional streaming model: `microsoft/VibeVoice-Realtime-0.5B` (uses `VibeVoiceStreamingProcessor` + `VibeVoiceStreamingForConditionalGenerationInference` with prefilled `.pt` voice caches).
- Device selection (`VIBEVOICE_DEVICE`): `auto` (default: `cuda` → `mps` → `cpu`), `cpu`, `cuda`, `mps`. Explicit `mps` when `torch.backends.mps.is_available()` is false fails loud without silent CPU fallback. On `cuda`, uses `torch.bfloat16` with `flash_attention_2` (falling back to `sdpa` if `flash_attn` is absent); on `mps` and `cpu`, uses `torch.float32` with `sdpa`.

### Profile registry (`VIBEVOICE_PROFILES_PATH`)

Default path: `<plugin-root>/profiles.json`. Format: `{ "profiles": [ ... ] }` with unique non-empty `id` and `name`.

Supported profile modes (`VibeVoiceProfileMode = 'instruct' | 'reference' | 'cached_prompt'`):

| Mode | Required fields | Optional fields | Backend behavior |
| --- | --- | --- | --- |
| `reference` | `reference_wav_path` | `cfg_scale` (default `1.5`), `ddpm_steps` (default `10`) | Loads `VibeVoiceProcessor` + `VibeVoiceForConditionalGenerationInference`; formats segment text as `Speaker 1: <single-line text>`, passes `voice_samples=[[reference_wav_path]]`, runs `model.set_ddpm_inference_steps(ddpm_steps)` and `model.generate(..., cfg_scale=cfg_scale, tokenizer=processor.tokenizer, generation_config={'do_sample': False})`. |
| `cached_prompt` | `prompt_pt_path` | `cfg_scale` (default `1.5`), `ddpm_steps` (default `5`) | Loads `VibeVoiceStreamingProcessor` + `VibeVoiceStreamingForConditionalGenerationInference`; loads `.pt` prompt with `torch.load(..., weights_only=True)` under `safe_globals([BaseModelOutputWithPast, DynamicCache])` and runs `processor.process_input_with_cached_prompt` + `model.generate(..., all_prefilled_outputs=copy.deepcopy(prompt))`. |
| `instruct` | `instruct` | `cfg_scale`, `ddpm_steps` | Shipped placeholder mode for `robin-news` in committed `profiles.json`. Carries no voice reference, so the adapter warns once per invocation and **refuses on segment > 1** (matching `voxcpm-tts`'s speaker-consistency guard), directing the operator to configure a `reference` or `cached_prompt` profile via `VIBEVOICE_PROFILES_PATH`. |

Relative asset paths (`reference_wav_path`, `prompt_pt_path`) resolve against the directory containing the profile registry file and must pass `assertNoVendorPath`. Mixed-mode fields or serialized OmniVoice `prompt` fields are rejected.

### Control mapping

- `seed`: non-null integer calls `torch.manual_seed(seed)` before `model.generate`.
- `engine` (non-empty), `personality: true`, active `effects_chain`: rejected with an actionable error.
- `max_chunk_chars`, `crossfade_ms`, `language`: advisory (warn once per invocation on stderr; VoiceScript segmentation is the request boundary and language is inferred from text).
- Output audio: worker extracts `outputs.speech_outputs[0]`, validates finite non-empty mono waveform, clips to `[-1.0, 1.0]`, and writes 16-bit PCM WAV at the processor's audio sampling rate (`24000` Hz).

### Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `VIBEVOICE_MODEL` | `microsoft/VibeVoice-1.5B` | HuggingFace repo id or local non-vendor directory |
| `VIBEVOICE_DEVICE` | `auto` | Inference device (`auto`, `cpu`, `cuda`, `mps`) |
| `VIBEVOICE_PROFILES_PATH` | `<plugin-root>/profiles.json` | Voice profile registry JSON path |
| `VIBEVOICE_BATCH_MANIFEST` | — | Path to JSON array of `{ in, out }` pairs for single-worker batch rendering |
| `VOICEBOX_TIMEOUT_MS` | `600000` | Worker startup and base per-segment render deadline |
| `VOICE_GEN_MAX_RUN_MS` | unlimited | Shared between-segment invocation deadline |
| `VOICE_GEN_MP3` | off | Shared ffmpeg MP3 transcoding flag |
| `VOICE_GEN_FAIL_ON_QC` | off | Shared QC gate switch |

## 4. Pipeline and CLI driver switching

1. **`plugins/kk/scripts/daily-stages.ts` (`dailyGenerate`, `spokenCharRate`, `scriptFloorCharRate`):**
   - Add `'vibe-voice': 'vibe-voice-tts'` and `'vibevoice': 'vibe-voice-tts'` to `VOICE_DRIVERS`.
   - In `dailyGenerate`'s sectioned synthesis path (`sectionConcurrency === '1'`), generalize the single-worker batch branch (currently checking `voiceGenerator === 'voxcpm-tts'`) so both `voxcpm-tts` (`VOXCPM_BATCH_MANIFEST`) and `vibe-voice-tts` (`VIBEVOICE_BATCH_MANIFEST`) synthesize pending sections in one worker batch with one retry on remaining unrendered sections.
   - In `spokenCharRate(vdriver)`: return `5.2` for `vdriver === 'vibe-voice' || vdriver === 'vibevoice'` (matching VoxCPM's conservative local diffusion speaking rate until live episode calibration).
   - Whole-document and per-section caches key on `voiceGenerator` (`kk:vibe-voice-tts`), preventing cross-driver cache pollution when switching between `vibe-voice`, `voxcpm`, `gemini`, `ominivoice`, and `voicebox`.
2. **`apps/cli/src/commands/content-generate.ts`:**
   - Extend `VOICE_ENGINES` to `['voxcpm', 'gemini', 'omnivoice', 'voicebox', 'vibe-voice'] as const`.
   - Extend `ENGINE_DRIVERS` with `'vibe-voice': 'vibe-voice'`.
3. **`apps/cli/src/board/manifest.ts`:**
   - Extend `FAMILY_SETTINGS['kk-daily-ai-voice2'].vdriver.values` to `['voicebox', 'ominivoice', 'gemini', 'voxcpm', 'vibe-voice', 'vibevoice']`.
4. **Packaging and registry (`scripts/bundle-plugins.ts`, `packages/kk-core/tests/registry.test.ts`):**
   - `bundle-plugins.ts` automatically bundles `src/index.ts` → `dist/index.js` and copies `python/worker.py`, `pyproject.toml`, `uv.lock`, `uv.toml`, and `profiles.json` while pruning `.venv/` and `tests/`.
   - Update plugin registry and package staging tests to include `vibe-voice-tts`.

#### API/library claim sources and confidence

| Claim | Source | Local verification | Confidence |
| --- | --- | --- | --- |
| PyPI `vibevoice==0.0.1` ships `vibevoice.modular.modeling_vibevoice_inference.VibeVoiceForConditionalGenerationInference` and `vibevoice.processor.vibevoice_processor.VibeVoiceProcessor`, whereas upstream GitHub HEAD removed `modeling_vibevoice_inference.py` | https://pypi.org/project/vibevoice/0.0.1/ | Inspected `vibevoice-0.0.1-py3-none-any.whl` (SHA256 `fe42a8ee9adcd4fa87b2abd72be502f635bb847387e682b672022d7a9d606add`) and `vendors/VibeVoice/README.md:47` | HIGH |
| `VibeVoiceProcessor` formats scripts as `Speaker <id>: <text>` lines, normalizes 1-based speaker IDs to 0-based, and accepts `voice_samples` as a list of WAV paths per script | `vendors/VibeVoice/vibevoice/processor/vibevoice_processor.py:246` | Read `_process_single` and `_parse_script` at `vendors/VibeVoice/vibevoice/processor/vibevoice_processor.py:246-304` and `:596-632` | HIGH |
| `VibeVoiceStreamingForConditionalGenerationInference` and `VibeVoiceStreamingProcessor` load prefilled `.pt` prompt caches via `torch.load(..., weights_only=True)` with `safe_globals([BaseModelOutputWithPast, DynamicCache])` and output 24 kHz mono speech | `vendors/VibeVoice/demo/realtime_model_inference_from_file.py:227` | Read `vendors/VibeVoice/demo/realtime_model_inference_from_file.py:164-292` and `vendors/VibeVoice/vibevoice/processor/vibevoice_streaming_processor.py:108` | HIGH |
| The shared `VoiceboxClient` and `processGeneratorIO` seam in `@gobing-ai/voice-gen` supports custom generator identity tags without modifying `voice-gen` | `plugins/generations/voice-gen/src/index.ts:41` | Read `processGeneratorIO` at `plugins/generations/voice-gen/src/index.ts:41-47` and `voxcpm-tts` at `plugins/generations/voxcpm-tts/src/index.ts:53` | HIGH |
