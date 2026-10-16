# voxcpm-tts

Standalone VoxCPM voice generator plugin for [knowledge-kit](../../../README.md). A TypeScript
generator that reuses **voice-gen's** pipeline (VoiceScript parsing, gaps, speed, WAV
concatenation, QC, optional MP3) behind the existing `VoiceboxClient` contract, backed by a
private **uv-managed Python worker** that runs `voxcpm==2.0.3` (ADR-036). The default daily
drivers are unchanged: opt in with `vdriver: voxcpm` (wired by task 0257).

`vendors/VoxCPM` is reference-only. No import, subprocess, dependency, cache, profile or model
path in this plugin may resolve into `vendors/` — every configured path is canonicalized and
refused, including symlinks and the Hugging Face cache tiers.

## Requirements

- `uv` on `PATH` (the worker is spawned as `uv run --project <plugin-root> --locked --no-dev`).
- Python 3.12 (the frozen interpreter; `uv` provisions it from the lock).
- `ffmpeg`/`ffprobe` only when `VOICE_GEN_MP3` requests an MP3 sibling.

## Layout

| Path | Purpose |
| --- | --- |
| `plugin.json` | `kk` manifest (`kind: generator`, entry `./src/index.ts` → bundled `./dist/index.js`) |
| `src/index.ts` | `main(--in/--out)` entry; injects the adapter into `processGeneratorIO` and closes it in `finally` |
| `src/voxcpm-client.ts` | registry/control/path validation + the bounded NDJSON worker adapter |
| `python/worker.py` | private NDJSON worker: health/render, one model load per invocation |
| `pyproject.toml` / `uv.lock` | independent uv project pinning `voxcpm==2.0.3` on Python 3.12 |
| `profiles.json` | frozen profile registry (`profiles` array; `robin-news` instruct profile) |

## Setup

```bash
uv lock --project plugins/generations/voxcpm-tts        # regenerate after editing pyproject.toml
uv run --project plugins/generations/voxcpm-tts --locked --no-dev python plugins/generations/voxcpm-tts/python/worker.py
```

Step 0 (before live use) is the installed-import/API probe: confirm the locked `voxcpm==2.0.3`
imports and exposes the expected signature. Source inspection does not prove hardware viability;
that evidence belongs to task 0258.

## Configuration (environment)

| Var | Default | Notes |
| --- | --- | --- |
| `VOXCPM_MODEL` | `openbmb/VoxCPM2` | Hub id or a local snapshot directory. Hub models use the normal external cache; local paths pass canonical vendor exclusion |
| `VOXCPM_DEVICE` | `auto` | `auto`/`cpu`/`cuda`/`mps`; an unavailable **requested** device fails |
| `VOXCPM_PROFILES_PATH` | `<plugin-root>/profiles.json` | Profile registry |
| `VOICEBOX_TIMEOUT_MS` | `600000` | Worker startup bound (shared with voice-gen) |
| `VOICE_GEN_MAX_RUN_MS` | unset | Positive value bounds the whole invocation (startup + every render) |
| `VOICE_GEN_MP3` | off | Request an MP3 sibling via ffmpeg |
| `VOICE_GEN_FAIL_ON_QC` | off | Fail generation when the QC audit fails |

## Profiles

```json
{ "profiles": [ { "id": "robin-news", "name": "robin-news", "mode": "instruct", "instruct": "清晰、自然、沉稳的中文新闻播报，语速适中。" } ] }
```

- `instruct`: needs a nonempty `instruct`; a per-request `instruct` overrides it.
- `reference`: needs `reference_wav_path`.
- `continuation`: needs `prompt_wav_path` + `prompt_text` together.
- Relative assets resolve against the registry directory; serialized OmniVoice prompts, duplicate
  ids/names, mixed mode fields and vendor paths are refused.

> **Voice identity — `instruct` pins no speaker, and multi-segment work is refused on it.** VoxCPM conditions on a reference clip when one is
> given; with `instruct` alone there is no prompt cache, so the model samples `torch.randn` per
> request and **every segment can change voice**. The shipped registry is an instruct placeholder
> (`mode: instruct`): a single segment still renders, but a second one fails the invocation, so a
> multi-segment episode can never ship a voice that changes mid-item. `kk-daily-ai-voice2` defaults
> to this driver with the operator's anchored `robin-news` clone (adopted 2026-10-15 after an A/B
> listen); the shipped placeholder exists only so the mode machinery is exercised. For a stable voice
> point `VOXCPM_PROFILES_PATH` at an operator-private registry holding a `reference` (or
> `continuation`) profile — e.g. `~/.config/kk/voxcpm-profiles/profiles.json` with
> `reference_wav_path` aimed at a clip in `~/.config/kk/voices/`, wired through
> `plugins.generations.voxcpm-tts.env` in `~/.config/kk/config.yaml`.
>
> Measured 2026-10-15 on the same three texts: `instruct` swung 141 Hz of median pitch (sd 58 Hz);
> a reference-anchored profile swung 22–26 Hz (sd 9–12 Hz) and correlated 0.95+ with its clip.
> Grade any render with `scripts/audit-speaker-consistency.py` (needs this plugin's venv):
> a per-item F0 spread over 45 Hz means the profile is not anchoring a speaker.

## Control policy

`normalize` maps directly; an explicit `seed` calls `torch.manual_seed` before synthesis (the
2.0.3 API has no `seed`/`instruct` keyword); `language` is automatic multilingual inference with
an advisory diagnostic; `max_chunk_chars`/`crossfade_ms` are advisory (one warning per invocation)
— the shared VoiceScript segmentation remains the request boundary. A per-request `instruct` is
**ignored** on a `reference`/`continuation` profile (advisory diagnostic): the daily pipeline sends
one for every segment, derived from its `emotion`, and the anchored clip already defines the voice.
A per-request `engine`,
`personality=true` or an active `effects_chain` is rejected. Speed stays in shared postprocessing.
Transcription is omitted, so ASR-dependent QC is reported unavailable (not passing evidence).
