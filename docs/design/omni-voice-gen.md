# omni-voice-gen — OmniVoice-backed voice generator (Python)

Status: proposed (F611). Companion to `voice-gen.md`; only deltas and the ported contract are
specified here. Where this doc and `voice-gen.md` disagree, this doc wins for omni-voice-gen.

## 1. Decisions

- **D1 — Drop-in generator plugin.** Same executor surface as voice-gen: `--in Doc[]` → `--out Content`,
  sibling `<outStem>.wav`, optional `<outStem>.mp3`, identical `metadata` shape. The only pipeline change
  to swap backends is the plugin name (`voice_generator` var in kk-daily-ai-voice).
- **D2 — Python, make + uv.** The only non-TypeScript plugin in the repo (operator-approved). Build/test
  via `make` targets over `uv`. pytest + coverage; per-file line AND function coverage >= 90%.
- **D3 — PyPI `omnivoice` backend.** `vendors/OmniVoice` is reference-only: never written to, never
  referenced by the plugin. `uv sync` resolves `omnivoice` from PyPI into the plugin venv.
- **D4 — Profile registry replaces Voicebox profiles.** A JSON file maps profile name → one of:
  `{ "ref_audio": path, "ref_text": str }` (clone), `{ "prompt": path.pt }` (saved clone prompt),
  `{ "instruct": str }` (voice design). Resolution order for a segment is identical to voice-gen:
  segment profile(_id) → speaker profile(_id) → script default_profile(_id) → `VOICEBOX_DEFAULT_PROFILE`
  → doc `metadata.voiceProfile`. Unknown name → exit 1 naming the profile.
- **D5 — Warn-and-ignore for unhonorable fields.** `engine`, `personality`, `effects_chain`,
  `effect_preset` are accepted (VoiceScript stays valid), reported in one stderr warning per run, and
  ignored. Never fail, never silently drop.
- **D6 — Single in-process model load per run.** The backend loads `OmniVoice.from_pretrained` once and
  renders all segments in-process (replaces voice-gen's per-segment HTTP + polling). There is no
  per-generation poll; the run budget is `VOICE_GEN_MAX_RUN_MS`, checked between segments (same
  fail-loud semantics as voice-gen).
- **D7 — QC parity.** Repetition detection, transcription-fidelity floor (0.15), loudness-dip detection,
  and duration-anomaly ranges are ported with identical thresholds. Transcription reuses OmniVoice's
  bundled Whisper (lazy; unavailable → keep audio, QC audit is the backstop — same as voice-gen).
- **D8 — Bug fixes not replicated** (found in voice-gen, reported; fixed here):
  1. Gap placement: `gap_ms[i]` is silence inserted **before segment i** (no `gapsMs[0] === 0` special
     case). Deterministic, documented.
  2. Duration accounting: `metadata.duration` and `qc.totalDuration` use the same basis — sum of segment
     durations plus gap seconds.

## 2. Module layout

```
plugins/generations/omni-voice-gen/
  plugin.json                 # { name, kind: "generator", entry: "./bin/omni-voice-gen", version }
  pyproject.toml              # uv project; dep: omnivoice (PyPI); dev: pytest, pytest-cov, pyyaml, pydantic
  Makefile                    # sync / test / coverage / lint (ruff) / run
  bin/omni-voice-gen          # executable; exec uv run --project <plugin> python -m omni_voice_gen "$@"
  profiles.json               # operator profile registry (D4); sample entries committed
  src/omni_voice_gen/
    __main__.py               # argparse --in/--out → pipeline.run; exit codes mirror voice-gen main()
    contract.py               # pydantic Doc/DocList/Content models mirroring @gobing-ai/kk-core shapes
    voicescript.py            # parse/merge/validate + limit constants + warn-ignore collector (D5)
    profiles.py               # registry load/resolve (D4)
    backend.py                # OmnivoiceBackend protocol + real backend (D6) + FakeBackend for tests
    audio.py                  # WAV parse/concat with gaps (D8.1), loudness-dip detector
    qc.py                     # repetition / fidelity / duration-range / audit (D7)
    mp3.py                    # VOICE_GEN_MP3 truthiness + ffmpeg transcode (same flags as voice-gen)
    pipeline.py               # processGeneratorIO equivalent: render loop, verify-retry, Content assembly
  tests/                      # pytest; FakeBackend everywhere — no model load, no network
```

## 3. Interfaces

### Entry (kk executor contract, ADR-006)

`bin/omni-voice-gen --in <docs.json> --out <content.json>` — non-.ts/.js entries are spawned directly as
executables by the kk executor, so the shebang wrapper is the entire integration seam. Exit 0 on success,
exit 1 with `omni-voice-gen failed: <reason>` on stderr otherwise. On failure after render start, delete
`--out` and sibling audio (same cleanup semantics as voice-gen).

Empty `Doc[]` → notice Content (`format: "markdown"`), no model load, exit 0.

### Backend protocol (test seam)

```python
class SegmentSpec(TypedDict):
    text: str
    language: str
    profile: ProfileEntry      # resolved by profiles.py
    instruct: str | None
    seed: int | None
    speed: float | None

class Backend(Protocol):
    def load(self) -> None: ...
    def generate(self, spec: SegmentSpec) -> tuple[bytes, float]: ...  # wav bytes, duration sec
    def transcribe(self, wav: bytes, language: str) -> str: ...        # lazy whisper; may raise
```

Real backend maps `SegmentSpec` → `OmniVoice.generate(text, ref_audio/ref_text | voice_clone_prompt |
instruct, speed=..., normalize_text=False)`; `seed` → `torch.manual_seed`. `audio_chunk_duration` /
`audio_chunk_threshold` left at OmniVoice defaults (duration-based chunking supersedes char-based
`max_chunk_chars`/`crossfade_ms`, which are still validated for surface compatibility).

### Env

| Variable | Required | Default | Role |
|----------|----------|---------|------|
| `VOICEBOX_DEFAULT_PROFILE` | plain-text path only | — | Drop-in parity with voice-gen (D4 order) |
| `VOICE_GEN_MP3` | no | off | truthy → ffmpeg sibling MP3; missing ffmpeg → exit 1, no `--out` |
| `VOICE_GEN_MAX_RUN_MS` | no | unlimited | Total render budget, checked between segments (D6) |
| `VOICE_GEN_FAIL_ON_QC` | no | off | `true` + failing QC → exit 1, no `--out` |
| `OMNIVOICE_MODEL` | no | `k2-fsa/OmniVoice` | HF model id or local path |
| `OMNIVOICE_DEVICE` | no | auto (`cuda`→`mps`→`cpu`) | Torch device |
| `OMNIVOICE_SPEED` | no | `1.0` | Speaking-rate factor passed to generate |
| `OMNIVOICE_PROFILE_REGISTRY` | no | `<plugin>/profiles.json` | Registry path override |

`VOICEBOX_URL` / `VOICEBOX_TIMEOUT_MS` / `VOICEBOX_POLL_MS` / `VOICEBOX_MAX_CHUNK_CHARS` /
`VOICEBOX_CROSSFADE_MS` are Voicebox-transport knobs and are **not** honored; the render budget is
`VOICE_GEN_MAX_RUN_MS` (D6).

## 4. Content mapping

Identical to voice-gen §6 with two exceptions: `metadata.generator` is `"kk:omni-voice-gen"`, and
`metadata.duration` / `qc.totalDuration` share one basis (D8.2). Per-segment metadata carries
`{ generationId (uuid), profile, speaker?, emotion?, duration, verifyRetries, transcription?,
loudnessDip? }`.

## 5. Verify-retry loop

Per segment, up to 2 verify attempts (same as voice-gen): render → transcribe (best-effort) → fidelity
floor check → loudness-dip check → accept or regenerate. Retries resample (diffusion decoding is
stochastic; explicit `seed` pins attempt 0 only, via `torch.manual_seed`). A dip surviving the last
attempt is recorded in segment metadata and QC, never fails the run by itself (voice-gen parity).

## 6. Invariants

- No write to or import from `vendors/OmniVoice`.
- No network in tests; `FakeBackend` covers every pipeline branch (coverage gate D2).
- All warnings to stderr; stdout stays machine-clean (kk executor parses exit code + files only).
- `profiles.json` contains no secrets (local paths only).
- Spec sync: changes to this surface keep this doc and `docs/04_DESIGN.md` in the same commit (T3).
