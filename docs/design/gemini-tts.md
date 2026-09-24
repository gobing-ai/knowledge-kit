# gemini-tts — Gemini 3.8 TTS voice generator (hosted)

Status: shipped (F612). Companion to `voice-gen.md`: gemini-tts **is** voice-gen's pipeline
with a different backend client, so only the client, profile map, and operator runbook are specified
here. Where this doc and `voice-gen.md` disagree, this doc wins for gemini-tts.

## 1. Decisions

- **D1 — Backend adapter, not a port.** voice-gen's `processGeneratorIO(in, out, clientOverride?, …)`
  already owns VoiceScript parsing, profile resolution order, instruct/emotion resolution
  (`resolveInstruct`), verify-retry, loudness-dip gate, `applySpeed`, `concatWavs`, QC audit, and MP3.
  gemini-tts implements the `VoiceboxClient` interface over the Gemini REST API and calls
  `processGeneratorIO` with it. No pipeline logic is duplicated (contrast omni-voice-gen, which had to
  port it to Python). Seam: ADR-023.
- **D2 — REST over `fetch`, no SDK.** Same precedent as `image-gen/src/providers/google.ts`
  (`x-goog-api-key` header, `GOOGLE_BASE_URL` override). `@google/genai` is not added.
- **D3 — Model by env.** `GEMINI_TTS_MODEL` ∈ {`gemini-3.8-flash-tts` (default),
  `gemini-3.8-flash-lite-tts`}; anything else exits 1 naming the allowed values.
- **D4 — Profile map.** `plugins/generations/gemini-tts/profiles.json` (override path:
  `GEMINI_TTS_PROFILES`) maps VoiceScript profile name → `{ "voice": "<voice_… id | prebuilt name>" }`.
  A raw `voice_…` / `voicekey_…` id passed as a profile is used as-is. Unknown name → exit 1 naming it.
  The shipped `robin-news` entry holds a placeholder; the operator writes the real id after §4.
- **D5 — Style.** The resolved `instruct` (instruct + emotion, already merged by voice-gen) becomes
  `annotations: [{ type: "speech_metadata", style }]` on the text part. Numeric speed stays with
  voice-gen's `applySpeed` post-process (Gemini has no numeric rate knob).
- **D6 — ASR parity via Gemini.** The adapter's `transcribe` sends the rendered WAV to a Gemini text
  model (`GEMINI_TTS_ASR_MODEL`, default `gemini-3.8-flash`) with a verbatim-transcription prompt. This
  keeps voice-gen's fidelity floor and the QC `repetition_detected` class (hard-failed upstream by 0139)
  working. Any ASR error is swallowed by voice-gen's existing try/catch → fidelity/repetition skipped,
  loudness + duration QC remain. `GEMINI_TTS_ASR=off` disables it (cost/latency escape hatch).
- **D7 — Failure policy.** Missing `GEMINI_API_KEY` → `health()` throws before any network call.
  429/5xx/network → exponential backoff (base 2 s, cap `GEMINI_TTS_MAX_ATTEMPTS`, default 4), honoring
  `Retry-After`. 4xx other than 429 → fail immediately with status + API `error.message`. Every request
  carries an `AbortSignal.timeout` (`GEMINI_TTS_TIMEOUT_MS`, default 120 000).
- **D8 — Opt-in.** `dailyGenerate`'s `VOICE_DRIVERS` gains `gemini: 'gemini-tts'`; the workflow default
  `vdriver` stays `voicebox` until an operator listening A/B (deferred I7).

## 2. Module layout

```
plugins/generations/gemini-tts/
  plugin.json          # { name: "gemini-tts", kind: "generator", entry: "./src/index.ts" }
  package.json         # @gobing-ai/gemini-tts; deps: @gobing-ai/voice-gen workspace:*
  profiles.json        # { "robin-news": { "voice": "voice_REPLACE_ME" } }
  README.md            # operator runbook (§4)
  src/gemini-client.ts # createGeminiVoiceClient(): VoiceboxClient
  src/voice-create.ts  # one-time replicated-voice creation CLI (§4)
  src/index.ts         # main(): parse --in/--out → processGeneratorIO(in, out, geminiClient, …, 'kk:gemini-tts')
  tests/*.test.ts      # fetch stubbed; no live API in the gate
```

voice-gen changes (the only edits outside the new plugin):

- `package.json`: `"exports": { ".": "./src/index.ts" }` (same shape as kk-core) so the workspace import resolves.
- `VoiceboxClient.transcribe` becomes optional (`transcribe?`) — both call sites already guard with
  `typeof client.transcribe === 'function'`.
- `processGeneratorIO` takes an optional generator tag (default `'kk:voice-gen'`) for `metadata.generator`.

## 3. Adapter mapping (`VoiceboxClient` → Gemini)

| VoiceboxClient | Gemini behaviour |
| --- | --- |
| `health()` | assert `GEMINI_API_KEY` + valid `GEMINI_TTS_MODEL`; no network |
| `resolveProfile(name)` | profile map lookup → `{ id: voice, name }` |
| `generate(body)` | `POST /v1beta/interactions` `{ model, input:[{type:"user_input", content:[{type:"text", text, annotations:[{type:"speech_metadata", style}]}]}], response_format:{type:"audio", mime_type:"audio/wav", sample_rate:24000}, generation_config:{speech_config:[{voice}]} }`; decode the `model_output` step's `audio` content `data` (base64 WAV) into an in-memory map keyed by a local id; ignores `max_chunk_chars`/`crossfade_ms`/`engine`/`effects_chain` |
| `waitUntilDone(id)` | `{ status: "completed", duration }` immediately (synthesis is unary; duration from the WAV header) |
| `downloadAudio(id)` | returns and evicts the buffered WAV |
| `transcribe(wav)` | D6 |

Output is 24 kHz mono s16le WAV — the format `concatWavs`, `detectLoudnessDip`, and `daily-intro`
(`rate … '24000'`) already assume. Per-request limits (8,192 in / 16,384 out tokens ≈ 10.9 min audio)
are far above a VoiceScript segment.

## 4. Operator runbook — replicated `robin-news` voice (one-time, renew yearly)

Needed once before the first `vdriver: gemini` run, and again when the stored voice expires
(1-year TTL) or is deleted. Max 200 stored voices per project.

1. **Source clip** (10–30 s, clean speech): `plugins/generations/omni-voice-gen/voices/robin-news.wav`
   (already 24 kHz mono s16, 28.4 s — usable as-is).
2. **Consent clip**: the same speaker reads, verbatim:
   「我是此声音的拥有者并授权谷歌使用此声音创建语音合成模型」
   Recorded in Voicebox as the profile `gemini-consent-clip`; export its sample:
   `GET /profiles` → match name → `GET /profiles/{id}/samples` → `GET /samples/{sample_id}` (24 kHz mono s16 WAV).
3. **Convert** only a clip that is not already 24 kHz mono 16-bit WAV:
   `ffmpeg -i consent.m4a -ar 24000 -ac 1 -sample_fmt s16 consent.wav`
4. **Create**: `GEMINI_API_KEY=… bun plugins/generations/gemini-tts/src/voice-create.ts --source robin-news.wav --consent consent.wav --name robin-news`
   — validates format/length, `POST /v1beta/voices` with `store: true`, `type: "replicated"`,
   prints the `voice_…` id. (UI alternative: Google AI Studio → Generate speech.)
5. **Wire**: write the id into an operator-private map (`~/.config/kk/gemini-tts-profiles.json`,
   `{"robin-news":{"voice":"voice_…"}}`) and set `GEMINI_TTS_PROFILES` to it under
   `plugins.generations.gemini-tts.env` in `~/.config/kk/config.yaml`; the committed `profiles.json`
   keeps the placeholder. Then run the daily workflow with `--vars '{"vdriver":"gemini"}'`.

Consent/source clips are personal biometric data: keep them out of git (operator-private path).

## 5. Env

| Var | Default | Purpose |
| --- | --- | --- |
| `GEMINI_API_KEY` | — (required) | API key |
| `GOOGLE_BASE_URL` | `https://generativelanguage.googleapis.com` | endpoint override (tests/proxy) |
| `GEMINI_TTS_MODEL` | `gemini-3.8-flash-tts` | or `gemini-3.8-flash-lite-tts` |
| `GEMINI_TTS_PROFILES` | plugin `profiles.json` | profile map path |
| `GEMINI_TTS_ASR` / `GEMINI_TTS_ASR_MODEL` | on / `gemini-3.8-flash` | D6 |
| `GEMINI_TTS_MAX_ATTEMPTS` / `GEMINI_TTS_TIMEOUT_MS` | 4 / 120000 | D7 |

`VOICE_GEN_MP3`, `VOICE_GEN_FAIL_ON_QC`, `VOICE_GEN_MAX_RUN_MS`, `VOICEBOX_DEFAULT_PROFILE` keep their
voice-gen meaning (they are read by the shared pipeline).

## 6. Cost and risk

- ≈ $0.22 (flash) / $0.14 (flash-lite) per ~16-min episode through 2026-12-31; doubles 2027-01-01.
  ASR adds audio-input tokens on a text model (small; disable via `GEMINI_TTS_ASR=off`).
- Voice likeness is unverified until the operator A/B — the reason D8 keeps it opt-in.
- Script text leaves the machine (Google API). Acceptable for already-public news content.

Sources: ai.google.dev/gemini-api/docs/models/gemini-3.8-flash-tts, …/docs/speech-generation,
…/docs/voice-replication, …/docs/pricing (read 2026-09-24).
