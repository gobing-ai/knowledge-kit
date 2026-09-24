---
schema_version: 1
name: "gemini-tts plugin: Gemini VoiceboxClient adapter over the voice-gen pipeline"
status: done
template: feature-impl
created_at: 2026-09-24T17:58:49.690Z
updated_at: "2026-09-24T19:27:51.012Z"
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

- [x] R1. voice-gen seam edits: package.json exports '.' -> ./src/index.ts; VoiceboxClient.transcribe optional; processGeneratorIO accepts an optional generator tag (default 'kk:voice-gen'); voice-gen tests stay green.
- [x] R2. createGeminiVoiceClient(): VoiceboxClient over REST fetch (x-goog-api-key, GOOGLE_BASE_URL override): health asserts GEMINI_API_KEY and GEMINI_TTS_MODEL; resolveProfile via profiles.json / GEMINI_TTS_PROFILES with voice_/voicekey_ pass-through; generate posts /v1beta/interactions with speech_config voice and speech_metadata style and buffers the decoded WAV; waitUntilDone completes immediately; downloadAudio returns and evicts.
- [x] R3. GEMINI_TTS_MODEL accepts gemini-3.8-flash-tts (default) and gemini-3.8-flash-lite-tts; anything else exits 1 naming the allowed models.
- [x] R4. 429/5xx/network errors retry with exponential backoff honoring Retry-After up to GEMINI_TTS_MAX_ATTEMPTS (default 4); other 4xx fail at once naming a text excerpt of the segment, the HTTP status and the API message; each request bounded by AbortSignal.timeout(GEMINI_TTS_TIMEOUT_MS, default 120000).
- [x] R5. transcribe sends the WAV to GEMINI_TTS_ASR_MODEL (default gemini-3.8-flash) for verbatim transcription; GEMINI_TTS_ASR=off omits it; failures fall through voice-gen's existing soft path.
- [x] R6. Plugin entry src/index.ts, plugin.json (kind generator), package.json (@gobing-ai/voice-gen workspace dep), profiles.json with a robin-news placeholder; kk executor run gemini-tts produces the voice-gen Content shape with generator kk:gemini-tts.
- [x] R7. Tests stub fetch (no live API in the gate); per-file line and function coverage >= 90%; bun run gate passes including the plugin bundle step.

### Acceptance Criteria

- [x] AC1 — gemini-tts renders a VoiceScript DocList into an audio Content
- [x] AC2 — Model variant is chosen by environment without code change
- [x] AC3 — Profile names resolve to Gemini voices through the profile map
- [x] AC4 — Segment delivery hints map to Gemini speech style
- [x] AC5 — API failures are retried with backoff and reported actionably
- [x] AC6 — Loudness and repetition QC and MP3 output match voice-gen
- [x] AC7 — gemini-tts meets the workspace coverage and quality gate
- [x] AC8 — Empty input writes the notice Content without calling the API

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
- [x] voice-gen test for the generator tag (default + override)
- [x] gemini-client.ts with fetch-stub tests (request shape, profile map, model env, retry/backoff/Retry-After, non-retryable 4xx, network error, transcribe on/off)
- [x] index.ts main + plugin.json/package.json/profiles.json
- [x] end-to-end main tests via Bun.serve stub (Content shape, empty input, QC fail exit, missing args)
- [x] bun run format / lint / build (bundled layout check) / gate

### Solution

Adapter, not port (design D1/ADR-023): gemini-tts supplies a Gemini-3.8-TTS-backed `VoiceboxClient` to voice-gen's `processGeneratorIO`; VoiceScript parsing, verify-retry, speed, concat, QC, and MP3 remain voice-gen's.

**voice-gen reuse seam (R1 — pre-existing, commit 3d05f728):** `plugins/generations/voice-gen/package.json` exports `.` → `./src/index.ts`; `src/voicebox-client.ts:48` makes `transcribe?` optional (`src/index.ts:261`, `src/qc.ts:228` guard with `typeof client.transcribe === 'function'`); `src/index.ts:46` adds `processGeneratorIO(..., generator = 'kk:voice-gen')`, stamped into `metadata.generator` (`src/index.ts:321`).

**gemini-tts plugin (R2–R6 — pre-existing, commit 46ff24f8, verified):** `src/gemini-client.ts` `createGeminiVoiceClient({env?, fetch?, sleep?})` posts `{GOOGLE_BASE_URL:-https://generativelanguage.googleapis.com}/v1beta/interactions` with `x-goog-api-key: $GEMINI_API_KEY`; `health()` asserts the key and the model allowlist (`gemini-3.8-flash-tts` default, `gemini-3.8-flash-lite-tts`; anything else names the allowed models → exit 1, R3); `resolveProfile` passes `voice_*`/`voicekey_*` through and resolves named profiles via `GEMINI_TTS_PROFILES` or shipped `profiles.json` (placeholder `voice_REPLACE_ME` fails with a remediation pointer); `generate` sends `speech_config` voice + `speech_metadata` style, requests WAV 24 kHz, buffers the decoded audio under `response.id#seq`; `waitUntilDone` completes from the buffer; `downloadAudio` returns and evicts; 429/5xx/network errors retry with exponential backoff honoring `Retry-After` up to `GEMINI_TTS_MAX_ATTEMPTS` (default 4) and each request is bounded by `AbortSignal.timeout(GEMINI_TTS_TIMEOUT_MS, default 120000)`; non-retryable 4xx fail at once naming a ≤30-char segment excerpt, HTTP status, and API message (R4); `transcribe` posts inline WAV base64 to `GEMINI_TTS_ASR_MODEL` (default `gemini-3.8-flash`) and is omitted when `GEMINI_TTS_ASR=off`, falling through voice-gen's soft QC path (R5). `src/index.ts` `main(argv)` parses `--in/--out` and calls `processGeneratorIO(in, out, createGeminiVoiceClient(), undefined, 'kk:gemini-tts')`; missing args exit 1. `plugin.json` (kind generator), `package.json` (`@gobing-ai/voice-gen` runtime dep; `@gobing-ai/kk-core` is devDep-only for test imports), `profiles.json` with the `robin-news` placeholder.

**Changed in this implement pass (only real gap found):** `plugins/generations/voice-gen/tests/voice-gen.test.ts` — new test "R1 — processGeneratorIO stamps a custom generator tag and keeps the kk:voice-gen default": `processGeneratorIO(..., 'kk:gemini-tts')` writes `metadata.generator === 'kk:gemini-tts'` and the no-tag call keeps `kk:voice-gen`. This closes the previously unchecked Plan item; only default-tag assertions existed before (voice-gen.test.ts:184, :1119). `bun run format` ran (biome fixed formatting in that same file only).

**Test approach (R7):** all tests stub the API — client units via an injected `fetch` stub (model env, allowlist health, request shape incl. key header/speech style/WAV format, profile map + pass-through + unknown/placeholder rejection, Retry-After backoff `waits=[3000, 4000]`, attempt cap, non-retryable 4xx, network-error retry, no-audio error, ASR on/off) and `main` end-to-end against a local `Bun.serve` stub via `GOOGLE_BASE_URL` (audio Content with `generator kk:gemini-tts` + sibling WAV + QC pass, QC-fail exit 1 with no output, empty-input Notice with zero requests, missing-args exit 1). MP3 transcode is voice-gen's shared `processGeneratorIO` path (Q&A: no duplicate test).

**Deferred by design:** the `VOICE_DRIVERS` `gemini: 'gemini-tts'` workflow entry is F612 scenario R5, owned by task 0160 (not 0158's R1–R7). **Not run here (pipeline-owned):** `bun run lint`, `bun run build` (verify `scripts/bundle-plugins.ts` bundles gemini-tts with voice-gen inlined and ships `profiles.json` beside `dist/` — `DEFAULT_PROFILES_PATH` resolves `../profiles.json` from `import.meta.url`, valid in both src/ and dist/ layouts), the ≥90% per-file coverage aggregate, and `bun run gate`.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `plugins/generations/voice-gen/package.json:5-7` exports `.` to `./src/index.ts`; `plugins/generations/voice-gen/src/voicebox-client.ts:48` optional `transcribe?`; guards `plugins/generations/voice-gen/src/index.ts:261` and `plugins/generations/voice-gen/src/qc.ts:228`; `plugins/generations/voice-gen/src/index.ts:46` default `kk:voice-gen` stamped at `:321`; test `plugins/generations/voice-gen/tests/voice-gen.test.ts:1139-1155` passed this run |
| R2 | MET | `plugins/generations/gemini-tts/src/gemini-client.ts:55-77` POST `{base}/v1beta/interactions` with `x-goog-api-key`, `GOOGLE_BASE_URL` at `:59`; health `:114-120`; resolveProfile `:123-135`; generate speech_config `:145`, speech_metadata `:139`, WAV 24000 `:144`, buffer `:151-154`; waitUntilDone `:157-162`; downloadAudio evicts `:164-168`; tests `plugins/generations/gemini-tts/tests/gemini-tts.test.ts:113-166` passed this run |
| R3 | MET | Allowlist `plugins/generations/gemini-tts/src/gemini-client.ts:3-4`; health rejects other models naming both allowed ids at `:116-119`; `plugins/generations/gemini-tts/src/index.ts:25-27` returns 1; tests `plugins/generations/gemini-tts/tests/gemini-tts.test.ts:85-104` passed this run |
| R4 | MET | Retry loop `plugins/generations/gemini-tts/src/gemini-client.ts:67-99`; `GEMINI_TTS_MAX_ATTEMPTS` default 4 at `:61`; `AbortSignal.timeout` at `:76` with `GEMINI_TTS_TIMEOUT_MS` default 120000 at `:62`; non-retryable 4xx at `:93-95` names excerpt `:46-48`, status, and API message; tests `plugins/generations/gemini-tts/tests/gemini-tts.test.ts:168-224` (waits 3000 then 4000) passed this run |
| R5 | MET | `plugins/generations/gemini-tts/src/gemini-client.ts:172-186` posts inline WAV to `GEMINI_TTS_ASR_MODEL` default `gemini-3.8-flash` (`:5`); `GEMINI_TTS_ASR=off` leaves `transcribe` unset (`:172`); failures fall through `plugins/generations/voice-gen/src/index.ts:272-274` and `plugins/generations/voice-gen/src/qc.ts:232-234`; test `plugins/generations/gemini-tts/tests/gemini-tts.test.ts:232-242` passed this run |
| R6 | MET | `plugins/generations/gemini-tts/src/index.ts:7-28` parses `--in/--out`, missing args return 1 at `:17-20`, calls `processGeneratorIO(..., undefined, 'kk:gemini-tts')` at `:23`; `plugins/generations/gemini-tts/plugin.json:3` kind generator; `plugins/generations/gemini-tts/package.json:10` voice-gen workspace dep and `:13` kk-core devDependency; `plugins/generations/gemini-tts/profiles.json:2` robin-news placeholder; e2e `plugins/generations/gemini-tts/tests/gemini-tts.test.ts:288-300` asserts audio Content and `metadata.generator` `kk:gemini-tts`; discovery `packages/kk-core/tests/registry.test.ts:224` |
| R7 | MET | Fetch is stubbed at `plugins/generations/gemini-tts/tests/gemini-tts.test.ts:47-59` and `Bun.serve` at `:254-260`. This run: gemini-tts 15 pass; full `bun test` retry 1327 pass / 0 fail exit 0; coverage gemini-client.ts 94.74% funcs / 100% lines, index.ts 100% / 96%; aggregate 98.64% funcs / 98.21% lines. `bun run format`, build, lint, typecheck, 48 pre-check rules, and 2 post-check rules passed. First `bun run gate` exited 1 on two unrelated 5s timeouts in `apps/cli/tests/kk-itc-workflow.test.ts` (0149, 0152); those tests passed in isolation (1542ms, 1969ms). Bundle `apps/cli/plugins/generations/gemini-tts/dist/index.js:22901` inlines `processGeneratorIO` and `:23266` calls it with `kk:gemini-tts`; staged `profiles.json` matches source. This --force verify rewrote `.spur/run/0158-verdict.json` and `.spur/run/0158-verify-answer.txt`; no plugin source was edited |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — gemini-tts renders a VoiceScript DocList into an audio Content | MET | test | `plugins/generations/gemini-tts/tests/gemini-tts.test.ts:288-300` exit 0 this run: Content.format audio, metadata.generator kk:gemini-tts, duration 1, sibling content.wav |
| AC2 — Model variant is chosen by environment without code change | MET | test | `plugins/generations/gemini-tts/tests/gemini-tts.test.ts:85-104` this run; model read at `plugins/generations/gemini-tts/src/gemini-client.ts:60`, allowlist `:3-4` |
| AC3 — Profile names resolve to Gemini voices through the profile map | MET | test | `plugins/generations/gemini-tts/tests/gemini-tts.test.ts:143-166` this run; resolver `plugins/generations/gemini-tts/src/gemini-client.ts:123-135` |
| AC4 — Segment delivery hints map to Gemini speech style | MET | test | `plugins/generations/gemini-tts/src/gemini-client.ts:139` maps instruct to speech_metadata style; asserted `plugins/generations/gemini-tts/tests/gemini-tts.test.ts:113-141` this run |
| AC5 — API failures are retried with backoff and reported actionably | MET | test | `plugins/generations/gemini-tts/tests/gemini-tts.test.ts:168-224` this run: Retry-After waits 3000 then 4000, attempt cap names excerpt status and API message, 4xx fails once, network errors retry then fail; missing key `:106-111` |
| AC6 — Loudness and repetition QC and MP3 output match voice-gen | MET | test | Shared `processGeneratorIO` at `plugins/generations/gemini-tts/src/index.ts:23` passes the default transcoder. QC pass `plugins/generations/gemini-tts/tests/gemini-tts.test.ts:297-299` and QC-fail exit 1 with no output `:302-309` this run. MP3 sibling path is voice-gen `plugins/generations/voice-gen/tests/voice-gen.test.ts:1186-1209` (Q&A: no duplicate MP3 test) |
| AC7 — gemini-tts meets the workspace coverage and quality gate | MET | command | `bun run format` no fixes; `bun run build` exit 0; lint and typecheck exit 0; pre-check 48 rules passed; `NODE_ENV=test bun test --dots --coverage --coverage-dir=.coverage --coverage-reporter=lcov --coverage-reporter=text apps packages plugins scripts` retry 1327 pass / 0 fail exit 0; `bun run test-post-check` 2 rules passed. Per-file gemini-tts coverage >= 90% (gemini-client.ts 94.74/100.00, index.ts 100.00/96.00). No tests skipped |
| AC8 — Empty input writes the notice Content without calling the API | MET | test | `plugins/generations/gemini-tts/tests/gemini-tts.test.ts:311-316` this run: exit 0, title Notice, requests length 0 |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 0158

**Scope:** working-tree diff on 46ff24f8 (voice-gen.test.ts override-tag test, kk-core registry.test.ts +gemini-tts, task Solution corpus) plus the gemini-tts plugin surface it verifies (plugins/generations/gemini-tts/, voice-gen seam)
**Dimensions:** functional, security, efficiency, correctness, usability, architecture
**Verdict:** PASS

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location |
|---|----------|-----------|---------|----------|
| 1 | P3 (minor) | usability | Test "R#" label namespace is ambiguous: gemini-tts.test.ts labels cite F612 feature-scenario IDs ("R6 — retries 429/5xx", "R7 — transcribe", "R10 — empty input"), which are offset from task 0158's R1–R7 (task R4 = retry = feature R6), and voice-gen.test.ts now carries two different "R1" meanings — :1139 (new) means task-0158-R1 (seam edits) while :127 means voice-gen-feature-R1 (discoverability). A reviewer mapping the task file onto tests will mis-annotate. Fix: one comment block per test file mapping feature-scenario R# → task R#, or relabel to task IDs | `plugins/generations/voice-gen/tests/voice-gen.test.ts:1139`, `plugins/generations/gemini-tts/tests/gemini-tts.test.ts:137` |
| 2 | P4 (advisory) | correctness | A 200 response with invalid JSON throws a raw SyntaxError from `res.json()` outside the retry loop — no label/attempt context and no retry. Improbable for this API; wrap and route through the same `${label}: HTTP …` formatting if the file is touched | `plugins/generations/gemini-tts/src/gemini-client.ts:88` |
| 3 | P4 (advisory) | correctness | `new URL('../profiles.json', import.meta.url).pathname` mis-decodes spaces/non-ASCII and is Windows-hostile; `fileURLToPath` is the robust form. Non-issue for the current ASCII checkout and verified in both src/ and dist/ bundled layouts | `plugins/generations/gemini-tts/src/gemini-client.ts:12` |
| 4 | P4 (advisory) | usability | Shared pipeline logs hardcode the `voice-gen:` prefix and "local render" wording, so a gemini-tts run logs "voice-gen: N segments queued for local render" — misleading for a hosted backend. Derive the log prefix from the `generator` tag | `plugins/generations/voice-gen/src/index.ts:146` |
| 5 | P4 (advisory) | architecture | Second retry/backoff implementation now coexists with voicebox-client's — accepted under ADR-023 adapter-not-port (Retry-After honoring is gemini-specific), but hoist a shared retry helper or extract the pipeline when a third backend arrives; also `processGeneratorIO` now has 3 trailing optional positional params — switch to an options object if a 4th is added | `plugins/generations/gemini-tts/src/gemini-client.ts:60` |

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `plugins/generations/voice-gen/package.json` exports `.` → src/index.ts; `transcribe?` optional at voicebox-client.ts:48 with guards at src/index.ts:261 and qc.ts:228; `generator = 'kk:voice-gen'` param at src/index.ts:46 stamped into `metadata.generator` at :321; new override+default test voice-gen.test.ts:1139-1155 (asserts `kk:gemini-tts` and `kk:voice-gen`) |
| R2 | MET | gemini-client.ts posts `{base}/v1beta/interactions` with `x-goog-api-key` (:73-83, GOOGLE_BASE_URL override :38); health asserts key + model (:119-127); resolveProfile `voice_/voicekey_` pass-through + GEMINI_TTS_PROFILES/profiles.json + placeholder rejection (:130-147); generate sends speech_config voice + speech_metadata style, requests WAV 24 kHz, buffers under `id#seq` (:150-170); waitUntilDone completes immediately (:177-181); downloadAudio returns and evicts (:183-187) |
| R3 | MET | `GEMINI_TTS_MODELS` allowlist (gemini-client.ts:8-9); health rejects others naming the allowed models (:121-126); tests gemini-tts.test.ts:60-77 cover default, flash-lite, and unsupported-model error |
| R4 | MET | 429/5xx/network retry with exp backoff honoring Retry-After (gemini-client.ts:74-116); `GEMINI_TTS_MAX_ATTEMPTS` default 4 (:40); non-retryable 4xx fails at once with ≤30-char excerpt + status + API message (:95-103, excerpt :31-33); per-request `AbortSignal.timeout(GEMINI_TTS_TIMEOUT_MS default 120000)` (:82); backoff sequence verified `waits=[3000, 4000]` (gemini-tts.test.ts:139-163) |
| R5 | MET | transcribe posts inline b64 WAV to `GEMINI_TTS_ASR_MODEL` (default gemini-3.8-flash), omitted when `GEMINI_TTS_ASR=off` (gemini-client.ts:189-202); failures fall through voice-gen's soft path (src/index.ts:261 try/catch, qc.ts:228 guard); ASR on/off tested at gemini-tts.test.ts:190-201 |
| R6 | MET | src/index.ts `main(argv)` → `processGeneratorIO(in, out, client, undefined, 'kk:gemini-tts')`, missing args exit 1; plugin.json kind generator; package.json voice-gen workspace dep (kk-core devDep-only, per Q&A); profiles.json robin-news placeholder; e2e Bun.serve test asserts audio Content + `generator kk:gemini-tts` + sibling WAV + QC pass (gemini-tts.test.ts:246-260) |
| R7 | MET | Fresh gate evidence today: 1327 pass / 0 fail, quality gate PASS (attempts: 1) — .spur/run/0158-test-gate.log; per-file coverage ≥90%: gemini-client.ts 94.74/100.00, gemini index.ts 100.00/96.00, voice-gen src files 93.75–100 / 91.41–98.41; all API traffic stubbed (injected fetch + Bun.serve), no live call in the gate; earlier partial run (1325/2 fail) predates the final recheck on this tree |

AC coverage: AC1←R2/R6 e2e test; AC2←R3 model env; AC3←R2/R3 profile map; AC4←R2 `instruct`→speech_metadata; AC5←R4 retry/error shape; AC6←shared processGeneratorIO (QC pass asserted e2e; MP3 via voice-gen's shared transcode per Q&A — no duplicate test); AC7←R7 gate; AC8←empty-input Notice with zero requests (gemini-tts.test.ts:295-299).

Security: key only in the `x-goog-api-key` header, never in URLs, logs, or error text; error bodies truncated to 300 chars with JSON `error.message` extraction; placeholder voice rejected with a remediation pointer — no secret-leak path found.

**Next:** no P1/P2 — proceed to the verify gate; findings 1–5 are follow-ups (P3 label map is the only one worth a small commit before 0160 wires vdriver).

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-24T18:36:24.462Z todo → wip (system)
- 2026-09-24T19:02:55.970Z wip → testing (system)
- 2026-09-24T19:04:40.132Z testing → done (system)

