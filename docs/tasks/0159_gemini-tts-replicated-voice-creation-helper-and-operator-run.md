---
schema_version: 1
name: gemini-tts replicated-voice creation helper and operator runbook
status: done
template: feature-impl
created_at: 2026-09-24T17:58:49.694Z
updated_at: "2026-09-24T21:36:17.928Z"
feature_id: F612
priority: P2
tags:
  - gemini-tts
  - voice
  - ops
estimate_hours: 2

dependencies: ["0158"]
---

## 0159. gemini-tts replicated-voice creation helper and operator runbook

### Background

Feature F612 (docs/design/gemini-tts.md, ADR-023). One-time operator step: create the stored replicated robin-news voice from a source clip plus the zh-CN consent clip, and document renewal. The operator recorded the consent clip in Voicebox as 'gemini-consent-clip' and put gemini-tts env keys in ~/.config/kk/config.yaml. Covers feature scenario R8.

### Requirements

- [x] R1. src/voice-create.ts CLI: --source, --consent, --name, [--store true|false, default true], [--model, default GEMINI_TTS_MODEL or gemini-3.8-flash-tts]; validates both inputs are RIFF PCM 24 kHz mono 16-bit WAV and the source length is 10–30 s; exits 1 with an actionable message otherwise (the message names the actual rate/channels/bits/duration).
- [x] R2. Posts POST {GOOGLE_BASE_URL}/v1beta/voices {store, voice:{model, type:'replicated', display_name, replicated:{source_audio:{mime_type:'audio/wav',data}, consent_audio:{mime_type:'audio/wav',data}}}} with base64 WAV data and prints the returned voice id on stdout; API errors exit 1 with status and message, never echoing the key.
- [x] R3. plugins/generations/gemini-tts/README.md runbook: the consent statement, exporting a Voicebox profile sample, ffmpeg conversion when a clip is not 24 kHz mono s16, running voice-create, writing the id into the operator profile map + GEMINI_TTS_PROFILES, renewal before the 1-year expiry, keeping clips out of git.
- [x] R4. Operator run: fetch the Voicebox 'gemini-consent-clip' sample, create the stored voice from it plus the robin-news source clip, write the voice id into the operator profile map, and verify one live TTS render with it on both model variants.

### Acceptance Criteria

- [x] AC1 — Operator can create the replicated robin-news voice from a source clip and a consent clip

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-24T18:06:46.840Z

- **Consent clip location — CLOSED.** In Voicebox (`http://127.0.0.1:17493`) it is a cloned-voice *profile* named `gemini-consent-clip` (id `a545fcf6-0990-4ee0-97a9-9ac5277f1def`), not a history entry. Its single sample is `50d17c43-817b-4408-9900-ee93cc0d29c3`, whose `reference_text` is exactly 「我是此声音的拥有者并授权谷歌使用此声音创建语音合成模型」. `GET /samples/50d17c43-817b-4408-9900-ee93cc0d29c3` returns `audio/wav`, RIFF PCM **24000 Hz mono 16-bit, 7.13 s** (probed 2026-09-24). Discovery path for renewals: `GET /profiles` → match by name → `GET /profiles/{id}/samples` → `GET /samples/{sample_id}`. (`GET /history` returns 500 on this Voicebox build, so don't use it.)
- **Source clip — CLOSED.** `plugins/generations/omni-voice-gen/voices/robin-news.wav` is already 24000 Hz mono s16, 28.39 s (ffprobe 2026-09-24): inside 10–30 s, and it matches the consent speaker. No conversion is needed for either clip. ffmpeg stays in the README only for future re-recordings.
- **Where the voice id lives — CLOSED.** In the operator-private map `~/.config/kk/gemini-tts-profiles.json` (`{"robin-news":{"voice":"voice_…"}}`), with `GEMINI_TTS_PROFILES: <that path>` added under `plugins.generations.gemini-tts.env` in `~/.config/kk/config.yaml`. The committed `profiles.json` keeps the `voice_REPLACE_ME` placeholder, whose clear error is covered by 0158. Rationale: the id is bound to the operator's Google project and TTL, so it is not repo data.
- **Creation model / cross-model use — CLOSED with a live check.** Create with `gemini-3.8-flash-tts`. The docs list replication for both variants but don't say whether a stored voice is model-bound (MEDIUM). R4's operator run renders one short line with `GEMINI_TTS_MODEL` set to each variant. If flash-lite rejects the voice, the README states that `GEMINI_TTS_MODEL` must match the creation model, and the run creates a second voice only if the operator asks.
- **Authorization — CLOSED.** Robin authorized using the Voicebox consent clip to create the replicated voice in session 2026-09-24 ("You can help to get the remaining things done when needed"). Uploading the clips to Google is in scope. Nothing else leaves the machine.
- **Secrets — CLOSED.** Read `GEMINI_API_KEY` from env, or during the operator run from `~/.config/kk/config.yaml` via a shell variable without echoing it. Never print it, write it to a file, or put it in task evidence.

### Design

- Approach: a small Bun CLI in the plugin using REST fetch like the adapter. Validate WAV by reusing voice-gen's exported `parseWav` (`ParsedWav` at `plugins/generations/voice-gen/src/concat.ts:1`: `audioFormat` (1 = PCM), `numChannels`, `sampleRate`, `bitsPerSample`, `byteRate`, `dataBytes`; duration = `dataBytes.length / byteRate`; it throws on non-RIFF) — no new audio code and no dependency.
- Rejected: AI Studio UI only (not reproducible for renewal); SDK (new dependency); a Voicebox-fetch mode inside voice-create (couples the helper to Voicebox; the README documents the three GET calls instead).
- Invariants: consent/source clips never committed (operator-run temp copies go to a scratch dir outside the repo); key read from env only; `--store` defaults to true (an unstored voice is useless for a daily workflow).
- Signatures: `validateVoiceWav(bytes: Uint8Array, role: 'source'|'consent'): void` (throws with actual format); `createReplicatedVoice(opts: { source: Uint8Array; consent: Uint8Array; name: string; store: boolean; model: string; env?: Record<string,string|undefined>; fetch?: typeof fetch }): Promise<{ id: string }>`; `main(argv): Promise<number>` behind `import.meta.main`.
- Response field: the created voice id is at `json.name` or `json.id` per docs (`voice_…`). Accept whichever holds a `voice_`/`voicekey_`-prefixed string, else fail with the raw keys listed.
- Tests (`tests/voice-create.test.ts`, fetch stub, no live API): valid pair → request shape + printed id; wrong rate / stereo / 8-bit / non-RIFF → exit 1 naming the field; source 9 s and 31 s → exit 1; HTTP 400 → exit 1 with API message and no key in output; missing key → exit 1 before any fetch. Keep plugin coverage ≥ 90%.

**Operator run (R4), exact steps:**
```sh
T=$(mktemp -d)   # outside the repo
bun -e 'const r=await fetch("http://127.0.0.1:17493/samples/50d17c43-817b-4408-9900-ee93cc0d29c3");await Bun.write(process.argv[1],r)' "$T/consent.wav"
KEY=$(awk '/gemini-tts:/{f=1} f&&/GEMINI_API_KEY:/{gsub(/["'\'' ]/,"",$2);print $2;exit}' ~/.config/kk/config.yaml)
GEMINI_API_KEY="$KEY" bun plugins/generations/gemini-tts/src/voice-create.ts \
  --source plugins/generations/omni-voice-gen/voices/robin-news.wav --consent "$T/consent.wav" --name robin-news
# → voice_…  ; write ~/.config/kk/gemini-tts-profiles.json and add GEMINI_TTS_PROFILES to config.yaml
rm -rf "$T"
```
Then run a one-segment VoiceScript through `kk executor run gemini-tts --in … --out …` once per model variant, and listen to/record duration + QC in Testing.

### Plan

- [x] validateVoiceWav (reuse voice-gen parseWav) + tests
- [x] createReplicatedVoice + CLI main + fetch-stub tests
- [x] README runbook (Voicebox sample export, ffmpeg fallback, create, wire, renew, git hygiene)
- [x] bun run gate
- [x] operator run: create voice from Voicebox consent sample + robin-news.wav; write operator profile map + GEMINI_TTS_PROFILES; one live render per model variant

### Solution

Built `voice-create.ts` helper and runbook, resolved upstream consent requirements, and successfully performed operator run.

- `plugins/generations/gemini-tts/src/voice-create.ts:23-47` CLI validates 24 kHz mono 16-bit PCM WAV for both source (10–30s) and consent clips using `parseWav`. `plugins/generations/gemini-tts/src/voice-create.ts:67-118` posts to `{GOOGLE_BASE_URL}/v1beta/voices` with `{store: true, voice: {model, type: 'replicated', display_name, replicated: {source_audio, consent_audio}}}` in base64. `plugins/generations/gemini-tts/src/voice-create.ts:126-176` implements the CLI driver with key redaction on errors.
- Unit tests in `plugins/generations/gemini-tts/tests/voice-create.test.ts:67-240` (8 test suites) pass with 100% func / 99.3% line coverage.
- Runbook in `plugins/generations/gemini-tts/README.md:10-100` documents both zh-CN and en-US consent statements, Voicebox sample export, ffmpeg conversion, API replication helper, profile map wiring, renewal, and security hygiene.
- **R4 Operator Run**:
  - The operator recorded English consent clip `gemini-consent-clip-en` in Voicebox (11.04s, 24kHz mono s16).
  - Executed API replication with English consent statement matching Google verification criteria, avoiding cross-lingual embedding drift.
  - Successfully created persistent replicated voice: `voice_yrfq18e9eep9` (model `gemini-3.8-flash-tts`, retained through 2027-09-24T21:30:15Z).
  - Wired into `~/.config/kk/gemini-tts-profiles.json` mapping `robin-news` to the created voice ID, and added `GEMINI_TTS_PROFILES` to `~/.config/kk/config.yaml`.
  - Verified live synthesis on both `gemini-3.8-flash-tts` and `gemini-3.8-flash-lite-tts`, as well as end-to-end multi-segment rendering via `kk executor run gemini-tts`.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `plugins/generations/gemini-tts/src/voice-create.ts:23-47` validateVoiceWav checks RIFF PCM 24kHz mono 16-bit WAV, 10-30s source; `plugins/generations/gemini-tts/src/voice-create.ts:126-176` main CLI options; tests `plugins/generations/gemini-tts/tests/voice-create.test.ts:67-82`, `243-311` passed |
| R2 | MET | `plugins/generations/gemini-tts/src/voice-create.ts:67-118` POST {base}/v1beta/voices with store, type: replicated, source/consent base64; `:170` prints voice id; `:62-64`, `:94`, `:105` redact key; tests `plugins/generations/gemini-tts/tests/voice-create.test.ts:85-122`, `124-151`, `153-185`, `187-240` passed |
| R3 | MET | `plugins/generations/gemini-tts/README.md:10-100` documents zh-CN & en-US consent statements, Voicebox sample export, ffmpeg conversion, voice-create helper & resolution notes, profile map & config.yaml wiring, renewal & git hygiene |
| R4 | MET | Operator run completed with Voicebox English consent clip (24kHz mono s16 11.04s); replicated voice created via API: voice_yrfq18e9eep9; wired into ~/.config/kk/gemini-tts-profiles.json and GEMINI_TTS_PROFILES in config.yaml; verified live TTS renders on both gemini-3.8-flash-tts and gemini-3.8-flash-lite-tts |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R8 — Operator can create the replicated robin-news voice from a source clip and a consent clip | MET | command | Operator run created replicated voice_yrfq18e9eep9 via voice-create.ts API call with clean English consent clip; profile mapped in ~/.config/kk/gemini-tts-profiles.json; verified live TTS synthesis on both flash and flash-lite models |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | design-conformance | — | 4/4 requirements MET; replicated voice created, wired into operator profile map, dual-model live TTS verified |
| P4 | tests-pass | — | 23/23 tests in gemini-tts pass; repo-wide test suite passes |
| P4 | lint-clean | — | biome check . and typecheck clean across all 29 workspaces/plugins |
| P4 | coverage | — | voice-create.ts 100% funcs / 99.30% lines; gemini-client.ts 94.74% funcs / 100% lines; index.ts 100% funcs / 96% lines |
| P4 | evidence-rule-pass | — | Behavior-bearing AC evaluated with command and live test evidence |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-24T19:48:20.451Z todo → wip (system)
- 2026-09-24T21:36:14.905Z wip → testing (system)
- 2026-09-24T21:36:17.928Z testing → done (system)

