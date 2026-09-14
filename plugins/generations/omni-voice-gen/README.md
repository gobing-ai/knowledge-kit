# omni-voice-gen

OmniVoice-backed voice generator plugin for [knowledge-kit](../../../README.md).
Drop-in replacement for `voice-gen` — same `kk executor run` contract (`--in Doc[] --out Content`),
same audio metadata shape, same QC pipeline. `kk-daily-ai-voice` selects it by default via the
`voice_generator` var; fall back to the Voicebox backend with:

```bash
spur workflow run plugins/kk/workflows/kk-daily-ai-voice.yaml \
  --vars '{"voice_generator":"voice-gen"}'   # other vars per your kk config
```

> **Voice identity:** the shipped `robin-news` profile is an instruct placeholder. For a real
> operator voice, record a 3–10 s clip into a private registry (`OMNIVOICE_PROFILE_REGISTRY`)
> and it supersedes the committed entry.

## Setup

### 1. Install dependencies

```bash
make sync          # runs `uv sync` — creates .venv, installs omnivoice from PyPI + dev deps
```

> **First-run note:** `omnivoice` pulls `k2-fsa/OmniVoice` from Hugging Face on first generate
> (~2–4 GB depending on device). The Whisper ASR model used for transcription-fidelity QC loads
> lazily on the first QC transcription (`OMNIVOICE_ASR_MODEL` overrides it). Subsequent runs
> use the HF cache. `OMNIVOICE_MODEL` overrides the model id or points to a local checkout.
> GPU (`cuda`) is auto-selected when available; MPS (Apple Silicon) and CPU are fallbacks.
> Set `OMNIVOICE_DEVICE` to override (e.g. `cpu` for CI).

### 2. Verify

```bash
make test          # pytest (FakeBackend — no model load, no network)
make coverage      # pytest + per-file line/function >= 90% gate
make lint          # ruff check
```

## Profile registry

Profiles map a name to one of three voice-specification kinds. The registry lives at
`profiles.json` (override with `OMNIVOICE_PROFILE_REGISTRY`).

### Kinds

| Kind | JSON shape | When to use |
|------|-----------|-------------|
| **Clone** | `{ "ref_audio": "<path>", "ref_text": "<transcript>" }` | 3–10 s reference clip + its transcript |
| **Saved prompt** | `{ "prompt": "<path>.pt" }` | Pre-computed clone prompt via `create_voice_clone_prompt` |
| **Instruct** | `{ "instruct": "<description>" }` | Text description of the desired voice style |

### Creating a profile (clone example)

1. Record a 3–10 second WAV clip of the target voice.
2. Transcribe it (the exact words spoken in the clip).
3. Add an entry to `profiles.json`:

```json
{
    "robin-news": {
        "ref_audio": "/path/to/robin-ref.wav",
        "ref_text": "This is Robin, bringing you today's AI news."
    }
}
```

> **Never commit private audio paths or real operator clips.** The shipped `profiles.json` contains
> only documented placeholder entries. Copy and edit locally; the file is operator-private.

### Resolution order

Segment `profile` → speaker `profile` → script `default_profile` → `VOICEBOX_DEFAULT_PROFILE` env
→ doc `metadata.voiceProfile`. Unknown name → exit 1 naming the profile.

Relative `ref_audio` / `prompt` paths in registry entries resolve against the process working
directory (they are passed to the backend unmodified) — prefer absolute paths.

## Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `VOICEBOX_DEFAULT_PROFILE` | no | — | Fallback profile name (parity with voice-gen) |
| `VOICE_GEN_MP3` | no | off | `true`/`1`/`yes`/`on` → ffmpeg sibling MP3; missing ffmpeg → exit 1 |
| `VOICE_GEN_MAX_RUN_MS` | no | unlimited | Total render budget (ms), checked between segments |
| `VOICE_GEN_FAIL_ON_QC` | no | off | `true` + failing QC → exit 1 |
| `OMNIVOICE_MODEL` | no | `k2-fsa/OmniVoice` | HF model id or local path |
| `OMNIVOICE_ASR_MODEL` | no | omnivoice default Whisper | ASR model for transcription-fidelity QC (loads lazily on first QC) |
| `OMNIVOICE_DEVICE` | no | auto (`cuda`→`mps`→`cpu`) | Torch device |
| `OMNIVOICE_SPEED` | no | `1.0` | Speaking-rate factor |
| `OMNIVOICE_PROFILE_REGISTRY` | no | `<plugin>/profiles.json` | Profile registry path override |

**Not honored** (Voicebox-transport knobs): `VOICEBOX_URL`, `VOICEBOX_TIMEOUT_MS`,
`VOICEBOX_POLL_MS`, `VOICEBOX_MAX_CHUNK_CHARS`, `VOICEBOX_CROSSFADE_MS`. The render budget is
`VOICE_GEN_MAX_RUN_MS`.

## Make targets

| Target | Description |
|--------|-------------|
| `make sync` | `uv sync` — install/update deps into `.venv` |
| `make test` | `uv run pytest -q` |
| `make coverage` | pytest + `scripts/coverage_gate.py` (per-file line/function >= 90%) |
| `make lint` | `uv run ruff check src tests scripts` |

## Usage with kk-solo-podcast

`kk-solo-podcast.yaml` currently uses `voice-gen` directly. It can adopt the same `voice_generator`
var pattern later — out of F611 scope (one-line change when ready).

## See also

- [Design spec](../../../docs/design/omni-voice-gen.md) — decisions, interfaces, invariants
- [voice-gen](../voice-gen/) — the Voicebox-backed sibling this plugin replaces
- [kk-daily-ai-voice.yaml](../../kk/workflows/kk-daily-ai-voice.yaml) — the workflow that selects the generator
