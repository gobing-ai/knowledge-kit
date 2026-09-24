---
schema_version: 1
name: "gemini-tts plugin: Gemini VoiceboxClient adapter over the voice-gen pipeline"
status: todo
template: feature-impl
created_at: 2026-09-24T17:58:49.690Z
updated_at: "2026-09-24T18:06:19.393Z"
feature_id: F612
priority: P2
tags:
  - gemini-tts
  - voice
estimate_hours: 6

---

## 0158. gemini-tts plugin: Gemini VoiceboxClient adapter over the voice-gen pipeline

### Background

Feature F612 (docs/design/gemini-tts.md, ADR-023). Adds plugins/generations/gemini-tts, a thin generator that supplies a Gemini 3.8 TTS backed VoiceboxClient to voice-gen's processGeneratorIO, so the whole VoiceScript/QC/WAV pipeline is reused. Covers feature scenarios R1, R2, R3, R4, R6, R7, R9, R10.

### Requirements

- [ ] R1. voice-gen seam edits: package.json exports '.' -> ./src/index.ts; VoiceboxClient.transcribe optional; processGeneratorIO accepts an optional generator tag (default 'kk:voice-gen'); voice-gen tests stay green.
- [ ] R2. createGeminiVoiceClient(): VoiceboxClient over REST fetch (x-goog-api-key, GOOGLE_BASE_URL override): health asserts GEMINI_API_KEY and GEMINI_TTS_MODEL; resolveProfile via profiles.json / GEMINI_TTS_PROFILES with voice_/voicekey_ pass-through; generate posts /v1beta/interactions with speech_config voice and speech_metadata style and buffers the decoded WAV; waitUntilDone completes immediately; downloadAudio returns and evicts.
- [ ] R3. GEMINI_TTS_MODEL accepts gemini-3.8-flash-tts (default) and gemini-3.8-flash-lite-tts; anything else exits 1 naming the allowed models.
- [ ] R4. 429/5xx/network errors retry with exponential backoff honoring Retry-After up to GEMINI_TTS_MAX_ATTEMPTS (default 4); other 4xx fail at once naming a text excerpt of the segment, the HTTP status and the API message; each request bounded by AbortSignal.timeout(GEMINI_TTS_TIMEOUT_MS, default 120000).
- [ ] R5. transcribe sends the WAV to GEMINI_TTS_ASR_MODEL (default gemini-3.8-flash) for verbatim transcription; GEMINI_TTS_ASR=off omits it; failures fall through voice-gen's existing soft path.
- [ ] R6. Plugin entry src/index.ts, plugin.json (kind generator), package.json (@gobing-ai/voice-gen workspace dep), profiles.json with a robin-news placeholder; kk executor run gemini-tts produces the voice-gen Content shape with generator kk:gemini-tts.
- [ ] R7. Tests stub fetch (no live API in the gate); per-file line and function coverage >= 90%; bun run gate passes including the plugin bundle step.

### Acceptance Criteria

- [ ] AC1 — gemini-tts renders a VoiceScript DocList into an audio Content
- [ ] AC2 — Model variant is chosen by environment without code change
- [ ] AC3 — Profile names resolve to Gemini voices through the profile map
- [ ] AC4 — Segment delivery hints map to Gemini speech style
- [ ] AC5 — API failures are retried with backoff and reported actionably
- [ ] AC6 — Loudness and repetition QC and MP3 output match voice-gen
- [ ] AC7 — gemini-tts meets the workspace coverage and quality gate
- [ ] AC8 — Empty input writes the notice Content without calling the API

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-24T18:06:19.049Z

- **Transcription request shape — CLOSED (HIGH).** Confirmed by a live probe 2026-09-24: `POST /v1beta/interactions` `{model:"gemini-3.8-flash", input:[{type:"text",text:prompt},{type:"audio",data:<b64>,mime_type:"audio/wav"}]}` → `steps[]` containing a `thought` step and a `model_output` step with `content[{type:"text",text}]`. TTS response confirmed the same way: `model_output.content[{type:"audio",data:<b64 RIFF s16 mono 24000>}]`. The design's "fall back to soft-skip" branch is not needed.
- **R4 error identity — CLOSED.** The client cannot see the segment index (voice-gen calls `generate(body)` per segment), so errors name a ≤30-char text excerpt: `gemini-tts generate ("<excerpt>"): HTTP <status> after N attempt(s): <api message>`. Feature F612 AC R6 is reworded to match.
- **MP3 test — CLOSED, not duplicated.** MP3 transcode is voice-gen's `transcodeMp3` inside the shared `processGeneratorIO`, and voice-gen's suite already covers it. gemini-tts passes `undefined` (the default transcoder) and adds no MP3 test.
- **kk-core dependency — CLOSED.** Tests import `ContentSchema`/`Doc` from `@gobing-ai/kk-core`, so it is a `devDependency` (`workspace:*`). Runtime code does not import it.

### Design

- Approach: adapter, not port (design D1/ADR-023). The only backend-specific code is the VoiceboxClient implementation; everything else is voice-gen's processGeneratorIO.
- Rejected: copying the pipeline (drift between two QC contracts); extracting a packages/ library now (bigger diff, one consumer); @google/genai SDK (new dependency; image-gen uses raw REST).
- Invariants: output WAV 24 kHz mono s16le (request response_format sample_rate 24000); voice-gen behaviour unchanged for its own callers; no secret in logs or error messages.
- Signatures: createGeminiVoiceClient(opts?: { fetch?: typeof fetch; sleep?: (ms:number)=>Promise<void>; env?: Record<string,string|undefined> }): VoiceboxClient; processGeneratorIO(in, out, client?, transcodeMp3?, generator = 'kk:voice-gen').

**Current state (handoff, 2026-09-24): implementation is largely present in the uncommitted working tree.**

| File | State |
| --- | --- |
| `plugins/generations/voice-gen/package.json` | done: `exports` added |
| `plugins/generations/voice-gen/src/voicebox-client.ts` | done: `transcribe?` optional + doc comment |
| `plugins/generations/voice-gen/src/index.ts` | done: `processGeneratorIO(..., generator = 'kk:voice-gen')` → `metadata.generator` |
| `plugins/generations/gemini-tts/{plugin.json,package.json,tsconfig.json,profiles.json}` | done (package.json has kk-core devDep) |
| `plugins/generations/gemini-tts/src/gemini-client.ts` | done: 100% lines |
| `plugins/generations/gemini-tts/src/index.ts` | done: `main(argv)` |
| `plugins/generations/gemini-tts/tests/gemini-tts.test.ts` | done: 15 tests pass (client + `main` against a `Bun.serve` stub via `GOOGLE_BASE_URL`) |

The gemini-tts and voice-gen suites pass together (67/67). **Not yet run:** `bun run format`, `bun run lint` (Biome + tsc), `bun run build` (confirm `scripts/bundle-plugins.ts` bundles gemini-tts with voice-gen inlined into `dist/index.js` and ships `profiles.json`), `bun run gate`.

**Remaining work for the implementer:**
1. Add one voice-gen test asserting that `processGeneratorIO(..., 'kk:x')` writes `metadata.generator === 'kk:x'` and that the default stays `kk:voice-gen`.
2. Run `bun run format` then `bun run lint`, and fix any Biome/tsc findings (watch the `as unknown as typeof fetch` cast in tests and line width).
3. Run `bun run build` and inspect `apps/cli/plugins/generations/gemini-tts/`: `dist/index.js` present, and `profiles.json` copied. `DEFAULT_PROFILES_PATH` resolves `../profiles.json` relative to `src/` or `dist/`, which is valid in both layouts. Verify this in the bundled tree.
4. Run `bun run gate`, then fill Solution/Testing through the pipeline.

### Plan

- [x] voice-gen seam edits
- [ ] voice-gen test for the generator tag (default + override)
- [x] gemini-client.ts with fetch-stub tests (request shape, profile map, model env, retry/backoff/Retry-After, non-retryable 4xx, network error, transcribe on/off)
- [x] index.ts main + plugin.json/package.json/profiles.json
- [x] end-to-end main tests via Bun.serve stub (Content shape, empty input, QC fail exit, missing args)
- [ ] bun run format / lint / build (bundled layout check) / gate

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
