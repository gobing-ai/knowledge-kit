---
kind: plan
title: "Brainstorm: VibeVoice TTS Voice Driver (vibe-voice)"
status: proposed
created_at: 2026-11-20
updated_at: 2026-11-20
related: []
tags: [brainstorm, tts, voice-driver]
needs_design: true
run_id: a63f2cd3-800a-4fe1-b00e-5166fbd3c32c
---

# Brainstorm: VibeVoice TTS Voice Driver (`vibe-voice`)

## Overview

The daily AI news and podcast pipelines in `knowledge-kit` support pluggable voice drivers (`vdriver` in workflow settings and `kk news generate-voice --engine <engine>`), currently routing across `voxcpm` (`voxcpm-tts`), `gemini` (`gemini-tts`), `omnivoice` (`omni-voice-gen`), and `voicebox` (`voice-gen`). Each existing driver faces operational trade-offs: VoxCPM2 exhibits a 40 ms cepstrum echo lattice on long renders and slow CPU fallbacks, OmniVoice is prone to 16 GB host OOMs, and Gemini faces cloud quota/billing walls (HTTP 402/429).

The operator wants to introduce a new voice driver `vibe-voice` based on Microsoft's open-source VibeVoice framework (`https://github.com/microsoft/VibeVoice`, downloaded to `vendors/VibeVoice` for reference) and wire it into the existing `vdriver` / `--engine` surfaces so the pipeline can switch in and out smoothly.

Inspection of `vendors/VibeVoice`, PyPI, and HuggingFace reveals a critical upstream detail:
1. In `vendors/VibeVoice` (`16fb2cb`), Microsoft removed the full multi-speaker TTS inference script (`modeling_vibevoice_inference.py`) from the Git `main` branch in September 2025, leaving `VibeVoiceForConditionalGeneration` (training forward pass) and `VibeVoiceProcessor` in `vibevoice/`, alongside `VibeVoiceStreamingForConditionalGenerationInference` (`microsoft/VibeVoice-Realtime-0.5B`, which uses prefilled `.pt` voice caches and is English-focused).
2. However, the independently published PyPI package `vibevoice==0.0.1` (wheel `vibevoice-0.0.1-py3-none-any.whl`, SHA256 `fe42a8ee9adcd4fa87b2abd72be502f635bb847387e682b672022d7a9d606add`) contains the complete `vibevoice.modular.modeling_vibevoice_inference.VibeVoiceForConditionalGenerationInference` and `VibeVoiceProcessor` implementation, which pairs with the official HuggingFace checkpoint `microsoft/VibeVoice-1.5B` (64K context, ~90 min generation, native English + Chinese support, and raw `.wav` reference voice cloning).

## Approaches

### Approach 1: TypeScript `VoiceboxClient` Adapter + Isolated `uv` Python NDJSON Worker (`vibe-voice-tts`) ⭐ Recommended

**Description:** Mirror the ADR-036 `voxcpm-tts` architecture. Create `plugins/generations/vibe-voice-tts` (`@gobing-ai/vibe-voice-tts`, generator identity `kk:vibe-voice-tts`) as a TypeScript plugin that delegates VoiceScript parsing, segmentation, loudness-dip detection, speed post-processing, WAV concatenation, MP3 transcoding, and QC to `@gobing-ai/voice-gen`'s `processGeneratorIO`. The plugin spawns an invocation-scoped, isolated `uv` Python worker (`python/worker.py`) over integer-id NDJSON with fd-1 protocol isolation, process-group teardown, and single-worker batch manifest support (`--batch` / `VIBEVOICE_BATCH_MANIFEST`).

**Trade-offs:**
- **Pros:**
  - Reuses 100% of `@gobing-ai/voice-gen`'s battle-tested VoiceScript, QC, WAV, and MP3 pipeline without code duplication.
  - Supports both `reference` mode (cloning directly from `.wav` files like `~/.config/kk/voices/robin-news.wav` via `VibeVoiceForConditionalGenerationInference` + `VibeVoiceProcessor` from `vibevoice==0.0.1` with `microsoft/VibeVoice-1.5B`) and `cached_prompt` mode (loading prefilled `.pt` speaker caches via `VibeVoiceStreamingForConditionalGenerationInference` when a streaming model checkpoint is selected).
  - Keeps `vendors/VibeVoice` strictly reference-only (`assertNoVendorPath` in both TS and Python), satisfying repo boundary rules and `bundle-plugins.ts` packaging.
  - Supports single-worker batch rendering in `dailyGenerate` so multi-section daily episodes load the model once per run while keeping per-section hash caching and resume.
- **Cons:**
  - Requires a dedicated `uv` Python virtual environment under `plugins/generations/vibe-voice-tts` (mitigated via `uv.toml` `link-mode = "hardlink"`).

**Implementation Notes:**
- Pin `vibevoice==0.0.1` in `plugins/generations/vibe-voice-tts/pyproject.toml` with `requires-python = "==3.12.*"` and `uv.lock`.
- Format single-segment text for `VibeVoiceProcessor` as `Speaker 1: <segment_text>` paired with `voice_samples=[[reference_wav_path]]`, calling `VibeVoiceForConditionalGenerationInference.generate(..., cfg_scale=..., tokenizer=processor.tokenizer, generation_config={'do_sample': False})`.
- Register `vibe-voice` (and `vibevoice` alias) in `dailyGenerate` (`plugins/kk/scripts/daily-stages.ts`), `VOICE_ENGINES` / `ENGINE_DRIVERS` (`apps/cli/src/commands/content-generate.ts`), and `FAMILY_SETTINGS['kk-daily-ai-voice2'].vdriver` (`apps/cli/src/board/manifest.ts`).

**Sources:**
- [ADR-036: VoxCPM reuses the TypeScript voice pipeline with an isolated Python worker](file:///Users/robin/xprojects/knowledge-kit/docs/00_ADR.md#L1430-L1439) | **Verified**: 2026-11-20
- [PyPI vibevoice 0.0.1](https://pypi.org/project/vibevoice/0.0.1/) | **Verified**: 2026-11-20
- [HuggingFace microsoft/VibeVoice-1.5B](https://huggingface.co/microsoft/VibeVoice-1.5B) | **Verified**: 2026-11-20

### Approach 2: Pure-Python Standalone Plugin (`omni-voice-gen` Pattern)

**Description:** Mirror `plugins/generations/omni-voice-gen` (ADR-020) by writing the entire generator plugin in Python (`bin/vibe-voice-tts` bash wrapper executing a Python package that re-implements `Doc[]` parsing, VoiceScript validation, WAV concatenation, loudness-dip detection, ffmpeg MP3 transcoding, and QC).

**Trade-offs:**
- **Pros:**
  - Single runtime per invocation without a Node-to-Python NDJSON pipe.
- **Cons:**
  - Duplicates ~1,000 lines of VoiceScript parsing, WAV stitching, MP3 transcoding, and QC logic already maintained in `@gobing-ai/voice-gen`.
  - Violates ADR-020 / ADR-036 precedent, which explicitly favored the TypeScript `VoiceboxClient` adapter + thin Python worker for all new local neural TTS models after `omni-voice-gen`.

**Implementation Notes:**
- Would require copying `omni_voice_gen/{contract,voicescript,audio,qc,mp3,pipeline}.py` and maintaining a third copy of the VoiceScript contract.

**Sources:**
- [ADR-020: omni-voice-gen — the plugin tree admits one Python plugin](file:///Users/robin/xprojects/knowledge-kit/docs/00_ADR.md#L888-L920) | **Verified**: 2026-11-20
- [omni-voice-gen design doc](file:///Users/robin/xprojects/knowledge-kit/docs/design/omni-voice-gen.md#L1-L58) | **Verified**: 2026-11-20

### Approach 3: Persistent Local HTTP Server (`voice-gen` / Voicebox Pattern)

**Description:** Wrap VibeVoice in a FastAPI/Uvicorn daemon modelled on `demo/vibevoice_realtime_demo.py` and connect to it over HTTP via `voice-gen`'s REST `VoiceboxClient`.

**Trade-offs:**
- **Pros:**
  - Keeps model weights warm across separate CLI invocations if a daemon is running.
- **Cons:**
  - Introduces port management, orphan daemon lifecycle issues, and permanent VRAM/RAM consumption even when `vdriver` is switched to another driver.
  - Unnecessary because `VOXCPM_BATCH_MANIFEST`-style batching already renders all sections of an episode in a single worker invocation without a resident daemon.

**Implementation Notes:**
- Would require an `ensureVibeVoiceRunning()` spawner and port health-checking.

**Sources:**
- [voxcpm-daily-voice-driver.md §Standalone generator](file:///Users/robin/xprojects/knowledge-kit/docs/design/voxcpm-daily-voice-driver.md#L29-L59) | **Verified**: 2026-11-20

## Recommendations

Adopt **Approach 1 (TypeScript `VoiceboxClient` Adapter + Isolated `uv` Python NDJSON Worker)**. It follows the exact architecture established by `voxcpm-tts` (ADR-036 / Feature G14), keeps one shared TypeScript implementation of VoiceScript, QC, WAV concatenation, and MP3 transcoding, guarantees process-group cleanup and `vendors/` isolation, and lets operators switch seamlessly between `vibe-voice`, `voxcpm`, `gemini`, `omnivoice`, and `voicebox`.

## Design Summary

1. **Plugin & Package (`plugins/generations/vibe-voice-tts`):**
   - Manifest `plugin.json`: `{ "name": "vibe-voice-tts", "kind": "generator", "entry": "./src/index.ts", "version": "1.0.0" }`.
   - Workspace package `@gobing-ai/vibe-voice-tts` depending on `@gobing-ai/voice-gen` and `@gobing-ai/ts-utils`.
   - Entry `src/index.ts` supports `--in <docs.json> --out <content.json>` and `--batch <manifest.json>` (or `VIBEVOICE_BATCH_MANIFEST`), passing `createVibeVoiceClient()` and generator identity `'kk:vibe-voice-tts'` to `processGeneratorIO`.
2. **Adapter & Protocol (`src/vibevoice-client.ts`):**
   - Implements `VoiceboxClient` over an invocation-scoped child process (`uv run --project <pluginRoot> --locked --no-dev python <pluginRoot>/python/worker.py`).
   - Enforces `assertNoVendorPath` on plugin root, worker script, profile registry, audio assets, and environment variables (`PYTHONPATH`, `HF_HOME`, `UV_CACHE_DIR`, etc.).
   - Sequential integer-id NDJSON protocol (`health`, `render`) with 1 MiB frame bound, 64 KiB stderr tail retention, `VOICEBOX_TIMEOUT_MS` startup/render deadlines, and SIGTERM → 2s grace → SIGKILL process-group teardown.
   - Profile registry (`profiles.json`, override `VIBEVOICE_PROFILES_PATH`):
     - `mode: "reference"`: requires `reference_wav_path` (e.g. `~/.config/kk/voices/robin-news.wav`), optional `cfg_scale` (default `1.5`), optional `ddpm_steps` (default `10`). Used with `microsoft/VibeVoice-1.5B`.
     - `mode: "cached_prompt"`: requires `prompt_pt_path` (prefilled `.pt` voice preset), optional `cfg_scale` (default `1.5`), optional `ddpm_steps` (default `5`). Used with `microsoft/VibeVoice-Realtime-0.5B`.
     - `mode: "instruct"`: shipped placeholder in committed `profiles.json` (`robin-news`) so repo tests and discovery work out-of-the-box; warns once per invocation and refuses on segment > 1 (or when no reference asset is supplied) with an actionable error pointing to `VIBEVOICE_PROFILES_PATH`, matching `voxcpm-tts`'s speaker-consistency guard.
3. **Python Worker (`python/worker.py` & `pyproject.toml`):**
   - `pyproject.toml` pins `requires-python = "==3.12.*"` and `dependencies = ["vibevoice==0.0.1"]` with `uv.toml` (`link-mode = "hardlink"`).
   - At startup, duplicates `fd 1` for protocol output and redirects `fd 1 → fd 2` (`isolate_protocol_stdout()`) so PyTorch/Transformers/tqdm C and Python writes cannot corrupt NDJSON responses.
   - `load_backend`: resolves `VIBEVOICE_MODEL` (default `microsoft/VibeVoice-1.5B`) via `huggingface_hub.snapshot_download` (or local non-vendor directory), selects device (`VIBEVOICE_DEVICE` ∈ `auto|cpu|cuda|mps`; MPS/CPU uses `torch.float32` + `sdpa`, CUDA uses `torch.bfloat16` + `flash_attention_2` with `sdpa` fallback), and loads `VibeVoiceProcessor` + `VibeVoiceForConditionalGenerationInference` (or `VibeVoiceStreamingProcessor` + `VibeVoiceStreamingForConditionalGenerationInference` when the model config or profile selects streaming mode).
   - `_render`: formats segment text as `Speaker 1: <text>` (normalizing curly quotes and stripping embedded newlines into spaces so `_parse_script` treats the segment as one speaker turn), passes `voice_samples=[[reference_wav_path]]` to `processor(...)`, runs `model.generate(...)` with `torch.manual_seed(seed)` when `seed` is provided, extracts the 24 kHz mono waveform from `outputs.speech_outputs[0]`, converts to 16-bit PCM WAV, and returns `{ ok: true, duration, wav_path, sample_rate: 24000, model: { path, revision, package } }`.
4. **Driver Switching & Pipeline Wiring:**
   - `plugins/kk/scripts/daily-stages.ts`:
     - Register `'vibe-voice': 'vibe-voice-tts'` and `'vibevoice': 'vibe-voice-tts'` in `dailyGenerate`'s `VOICE_DRIVERS`.
     - Extend the single-worker batch synthesis branch in `dailyGenerate` (currently gated on `voiceGenerator === 'voxcpm-tts'`) to also batch `vibe-voice-tts` via `VIBEVOICE_BATCH_MANIFEST` so multi-section renders load the model only once.
     - Add `vibe-voice` / `vibevoice` rate handling in `spokenCharRate` and `scriptFloorCharRate` (defaulting to the conservative 5.2 chars/s local diffusion rate until calibrated).
   - `apps/cli/src/commands/content-generate.ts`:
     - Add `'vibe-voice'` to `VOICE_ENGINES` and `ENGINE_DRIVERS` (`'vibe-voice': 'vibe-voice'`) so `kk news generate-voice --engine vibe-voice` works seamlessly.
   - `apps/cli/src/board/manifest.ts`:
     - Add `'vibe-voice'` (and `'vibevoice'`) to `FAMILY_SETTINGS['kk-daily-ai-voice2'].vdriver.values`.
   - Registry & packaging tests (`packages/kk-core/tests/registry.test.ts`, `scripts/bundle-plugins.test.ts`, `apps/cli/tests/package.test.ts`):
     - Include `vibe-voice-tts` in the product plugin enumerations and verify staged asset copying (`python/worker.py`, `pyproject.toml`, `uv.lock`, `profiles.json`).

## Next Steps

1. Author ADR and design satellite (`docs/design/vibe-voice-driver.md` + `docs/00_ADR.md` + `docs/04_DESIGN.md`).
2. Implement standalone `plugins/generations/vibe-voice-tts` plugin (TypeScript `VoiceboxClient` adapter, NDJSON protocol, `python/worker.py`, `pyproject.toml` + `uv.lock`, `profiles.json`, model-free unit tests for TS and pytest for Python worker).
3. Wire `vdriver=vibe-voice` / `--engine vibe-voice` into `daily-stages.ts`, `content-generate.ts`, `board/manifest.ts`, and packaging/registry tests with driver-aware cache and batch-mode tests.

---

**Generated by:** sp-brainstorm
**Research delegation:** sp-source-driven-development (inline)
