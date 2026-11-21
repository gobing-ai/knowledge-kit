# vibe-voice-tts

Standalone Microsoft VibeVoice generator plugin for [knowledge-kit](../../../README.md). A
TypeScript generator that reuses **voice-gen's** pipeline (VoiceScript parsing, gaps, speed, WAV
concatenation, QC, optional MP3) behind the existing `VoiceboxClient` contract, backed by a
private **uv-managed Python worker** that runs PyPI `vibevoice==0.0.1` (ADR-055). Existing daily
defaults are unchanged: opt in with `vdriver: vibe-voice` / `vdriver: vibevoice` or
`kk news generate-voice --engine vibe-voice`.

`vendors/VibeVoice` is reference-only. No import, subprocess, dependency, cache, profile or model
path in this plugin may resolve into `vendors/` — every configured path is canonicalized and
refused, including symlinks and the Hugging Face / uv cache tiers.

## Requirements

- `uv` on `PATH` (the worker is spawned as `uv run --project <plugin-root> --locked --no-dev`).
- Python 3.12 (`requires-python = "==3.12.*"`).
- `ffmpeg`/`ffprobe` only when `VOICE_GEN_MP3` requests an MP3 sibling.

## Layout

| Path | Purpose |
| --- | --- |
| `plugin.json` | `kk` manifest (`kind: generator`, entry `./src/index.ts` → bundled `./dist/index.js`) |
| `src/index.ts` | `main(--in/--out` \| `--batch`) entry; injects adapter into `processGeneratorIO` and closes in `finally` |
| `src/vibevoice-client.ts` | registry/control/vendor-path validation + bounded NDJSON worker adapter (`kk:vibe-voice-tts`) |
| `python/worker.py` | private NDJSON worker: fd-1 isolation, `health`/`render`, one model load per invocation |
| `pyproject.toml` / `uv.lock` | independent uv project pinning `vibevoice==0.0.1` on Python 3.12 |
| `profiles.json` | frozen profile registry (`profiles` array; `robin-news` instruct placeholder) |

## Setup

```bash
uv lock --project plugins/generations/vibe-voice-tts
uv run --project plugins/generations/vibe-voice-tts --locked --no-dev python plugins/generations/vibe-voice-tts/python/worker.py
```

## Configuration (environment)

| Var | Default | Notes |
| --- | --- | --- |
| `VIBEVOICE_MODEL` | `microsoft/VibeVoice-1.5B` | Hub id or local snapshot directory (checked against vendor exclusion) |
| `VIBEVOICE_DEVICE` | `auto` | `auto`/`cpu`/`cuda`/`mps`; unavailable **requested** device fails without CPU fallback |
| `VIBEVOICE_PROFILES_PATH` | `<plugin-root>/profiles.json` | Profile registry (`reference`, `cached_prompt`, or single-segment `instruct`) |
| `VIBEVOICE_BATCH_MANIFEST` | unset | Path to JSON array of `{ in, out }` pairs for single-worker batch rendering |
| `VOICEBOX_TIMEOUT_MS` | `600000` | Worker startup and base per-segment render deadline in ms |
| `VOICE_GEN_MAX_RUN_MS` | unset | Positive value bounds the whole invocation (startup + every render) |
| `VOICE_GEN_MP3` | off | Request an MP3 sibling via ffmpeg |
| `VOICE_GEN_FAIL_ON_QC` | off | Fail generation when the QC audit fails |

## Profiles

- `reference`: needs `reference_wav_path` (optional `cfg_scale`, default `1.5`; optional `ddpm_steps`, default `10`). Uses `VibeVoiceProcessor` + `VibeVoiceForConditionalGenerationInference` with `Speaker 1: <text>`.
- `cached_prompt`: needs `prompt_pt_path` (optional `cfg_scale`, default `1.5`; optional `ddpm_steps`, default `5`). Loaded with `torch.load(..., weights_only=True)` under `safe_globals([BaseModelOutputWithPast, DynamicCache])` against a streaming checkpoint + streaming processor.
- `instruct`: shipped placeholder for `robin-news`; carries no speaker reference, so multi-segment renders fail on segment > 1 to guarantee speaker consistency. Configure `VIBEVOICE_PROFILES_PATH` with a `reference` profile (e.g., `~/.config/kk/voices/robin-news.wav`) for episodes.
- Relative asset paths resolve against the registry directory; duplicate ids/names, mixed mode fields, serialized OmniVoice prompts, and `vendors/` paths are refused.

#### API/library claim sources and confidence

| Claim | Source | Local verification | Confidence |
| --- | --- | --- | --- |
| PyPI `vibevoice==0.0.1` (`vibevoice-0.0.1-py3-none-any.whl`) ships `vibevoice.modular.modeling_vibevoice_inference.VibeVoiceForConditionalGenerationInference` and `vibevoice.processor.vibevoice_processor.VibeVoiceProcessor`, while streaming inference modules are absent from the `0.0.1` wheel | https://pypi.org/pypi/vibevoice/0.0.1/json | Verified wheel SHA256 `fe42a8ee9adcd4fa87b2abd72be502f635bb847387e682b672022d7a9d606add` entries and `python/worker.py` `load_backend` | HIGH |
| `VibeVoiceProcessor` parses `Speaker <id>: <text>` scripts and accepts `voice_samples=[[reference_wav_path]]`, and `VibeVoiceForConditionalGenerationInference.generate` accepts `cfg_scale`, `tokenizer`, `generation_config`, and `set_ddpm_inference_steps` | `vibevoice==0.0.1` `demo/inference_from_file.py` and `vibevoice/processor/vibevoice_processor.py` | Inspected wheel contents (`demo/inference_from_file.py:319-351`, `vibevoice_processor.py:246-304`) and `python/worker.py` | HIGH |
| `VIBEVOICE_MODEL` defaults to `microsoft/VibeVoice-1.5B` and output audio writes 16-bit mono PCM WAV at `processor.audio_processor.sampling_rate` (default `24000`) | `plugins/generations/vibe-voice-tts/src/vibevoice-client.ts` & `python/worker.py` | Inspected `VIBEVOICE_DEFAULT_MODEL` in `src/vibevoice-client.ts` and `write_pcm16_wav` in `python/worker.py` | HIGH |
