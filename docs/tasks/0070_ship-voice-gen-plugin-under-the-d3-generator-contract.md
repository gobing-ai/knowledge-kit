---
schema_version: 1
name: "Ship voice-gen plugin under the D3 generator contract"
status: done
template: feature-impl
created_at: 2026-08-19T23:09:49.578Z
updated_at: "2026-08-20T00:43:43.383Z"
feature_id: D5
priority: P2
tags: ["generator", "voice", "voicebox"]
---

## 0070. Ship voice-gen plugin under the D3 generator contract

### Background
Implements feature D5 scenarios R1–R11 (discoverable plugin, plain-text /generate, VoiceScript multi-speaker concat, 50k fail-loud, Voicebox/profile/generation failure, empty DocList notice, invalid VoiceScript, offline fake HTTP tests, chunk knobs, instruct cap, paralinguistic tags pass-through).

Clone grain: `plugins/generations/content-gen` for `--in/--out` + `processGeneratorIO` + `ContentSchema` (`src/index.ts`); `plugins/publishings/emdash-pub` for injected/spied `fetch` and offline HTTP tests. Workspace glob `plugins/generations/*` already exists in root `package.json` — no workspaces edit. Feature satellite `docs/design/voice-gen.md` is the area lock; this task Design freezes implement names and algorithms.

Standalone: `dependencies[]` is empty. Quiz auto-skipped under idea `--auto`. Rubric: E2 D1 L1 C0 R1 = 5 → one cohesive task.

**Premises verified 2026-08-19 against the tree:**
- `plugins/generations/voice-gen` is absent.
- `kindContract('generator')` is `DocListSchema` → `ContentSchema` (`packages/kk-core/src/kinds.ts`).
- `ContentSchema.format` is `z.string().default('markdown')` — `"audio"` needs no schema change.
- Voicebox REST: `GET /profiles` returns a JSON **array** of `{ id, name, … }` (`routes/profiles.py`); MCP’s `{ profiles: [] }` wrapper is not this path.
- `GET /generate/{id}/status` is SSE; `GET /history/{id}` is JSON (`status`, `duration`, `error`).
- `GET /health` is 200 even when `model_loaded` is false — do not require a loaded TTS model.
- `POST /generate` body is `GenerationRequest` (`models.py`): `text` max 50_000, `instruct` max 500, `max_chunk_chars` 100–5000 default 800, `crossfade_ms` 0–500 default 50.
- `POST /speak` is 10_000 chars — not used.
- Generator spec §2.3 still says Phase-1 wrappers SHOULD NOT emit a non-markdown `format`; D5 amends that one line at ship (R12).
- `docs/05_FEATURES.md` has no D5 row yet (T4 at ship). `docs/04_DESIGN.md` §0 already lists the satellite as draft (D5).
### Requirements
- [x] **R1 — Discoverable & Invocable**: `plugins/generations/voice-gen/` has `plugin.json` (`name: "voice-gen"`, `kind: "generator"`, `entry: "./src/index.ts"`), `package.json` (`@gobing-ai/voice-gen`), `tsconfig.json`. Discovered by `@gobing-ai/kk-core`'s registry under kind `generator` and runnable via `kk executor run voice-gen --in <docs.json> --out <content.json>`.
- [x] **R2 — Plain-Text Doc Generation**: A plain-text Doc (`body` string) generates speech via Voicebox REST `POST /generate` (not `/speak` or `/mcp`), polls `GET /history/{id}`, downloads audio via `GET /audio/{id}`, writes a sibling `<outStem>.wav` beside `--out`, and writes `--out` `Content` with `format: "audio"`, `metadata.audioPath` set to the absolute WAV path, `metadata.duration` total duration in seconds, `metadata.generator: "kk:voice-gen"`, and `body` containing canonical VoiceScript YAML.
- [x] **R3 — VoiceScript Generation & Multi-Speaker Concat**: Input docs with VoiceScript YAML/JSON containing `speakers` and `segments` generate each segment sequentially in script order with the resolved speaker's profile, concatenate resulting WAV clips into `metadata.audioPath` using in-process RIFF WAVE stitching with `gap_ms` zero-silence padding, and populate `metadata.segments` with per-segment generation IDs, profile names, and durations.
- [x] **R4 — Length Limits (50,000 chars)**: Segment `text` exceeding 50,000 characters fails loud before dispatching to Voicebox without writing `--out` or `<outStem>.wav`. `stderr` contains `50,000-character`. Text is never silently truncated.
- [x] **R5 — Voicebox Offline & Error Semantics**: When Voicebox is unreachable (`GET /health` non-2xx or connection refused), a requested voice profile does not exist on `/profiles`, generation fails (`status: "failed"` on `/history/{id}`), or generation times out, the plugin fails loud, exits 1, cleans up partial `--out` / WAV files, and logs actionable diagnostics naming `VOICEBOX_URL`, the missing profile, the failure reason, or the timeout.
- [x] **R6 — Empty Input Handling**: Empty `DocList` input (`[]`) writes a notice `Content` object (`title: "Notice"`, `format: "markdown"`, `body: "# Notice\nNo documents provided for generation."`), exits 0, and makes zero Voicebox calls.
- [x] **R7 — Invalid VoiceScript Schema Handling**: When a Doc body begins with `{` (JSON) or is a YAML mapping with voice keys (`segments`, `speakers`, `default_profile`, `default_engine`) but lacks a valid `segments` array or has invalid types, the plugin fails loud with exit 1 without falling back to plain text. `stderr` contains `segments`.
- [x] **R8 — Offline Unit Test Harness**: All unit tests in `plugins/generations/voice-gen/tests/voice-gen.test.ts` run offline against injectable fetch/client fakes with no live Voicebox instance or GPU required.
- [x] **R9 — Auto-Chunk & Crossfade Knobs**: Expose `max_chunk_chars` (default 800, range 100–5000) and `crossfade_ms` (default 50, range 0–500) configurable per segment, per VoiceScript, or via env vars `VOICEBOX_MAX_CHUNK_CHARS` and `VOICEBOX_CROSSFADE_MS`. Values outside bounds fail loud before HTTP dispatch.
- [x] **R10 — Instruct Length Policy**: Segment or speaker `instruct` exceeding 500 characters fails loud before HTTP dispatch; `stderr` contains `500`.
- [x] **R11 — Paralinguistic Tag Passthrough**: Paralinguistic tags in segment text (e.g. `[laugh]`, `[sigh]`) are passed through uninterpreted to Voicebox `POST /generate` without stripping or escaping.
- [x] **R12 — Documentation & Quality Gate**: Update `docs/03_ARCHITECTURE.md`, `docs/04_DESIGN.md` satellite row, `docs/design/generator-plugin-specification.md` §2.3, and `docs/05_FEATURES.md`. Full quality gate `bun run spur-check` passes 100% green with >=90% test coverage.
### Acceptance Criteria

```gherkin
Feature: Voice generator (Voicebox)

  @core
  Scenario: R1 — Plugin is discoverable and invocable
    Given plugins/generations/voice-gen with a valid plugin.json (kind=generator)
    When the registry discovers it and kk executor run invokes it
    Then the entry executes and writes a Content output file

  @core
  Scenario: R2 — Plain-text Doc generates speech via REST /generate
    Given a one-item DocList whose body is plain text and a reachable Voicebox /generate endpoint
    When the plugin runs
    Then it POSTs /generate (not /speak and not MCP)
    And the Content parses against ContentSchema with format audio and metadata.audioPath pointing at a workspace audio file

  @core
  Scenario: R3 — VoiceScript multi-speaker input becomes sequential generations
    Given a Doc whose body is a valid VoiceScript with two speakers and two segments
    When the plugin runs
    Then it issues one /generate call per segment using that segment's profile
    And it concatenates the resulting audio in script order into the Content audioPath

  @core
  Scenario: R4 — Segment text over 50,000 characters fails loud
    Given a VoiceScript segment whose text exceeds 50,000 characters
    When the plugin runs
    Then it exits non-zero without writing --out
    And stderr names the 50,000-character Voicebox /generate cap
    And the text is not truncated

  @core
  Scenario: R5 — Voicebox unavailable or generation failure fails loud
    Given Voicebox is unreachable, the named profile is missing, or /generate ends in status failed
    When the plugin runs
    Then it exits non-zero without writing --out
    And stderr names the failure

  @core
  Scenario: R6 — Empty DocList follows the generator empty-input contract
    Given an empty DocList input
    When the plugin runs
    Then it exits 0 with a valid Content notice body and no Voicebox call

  @core
  Scenario: R7 — Invalid VoiceScript fails loud
    Given a Doc body that looks like VoiceScript but is missing speakers or segments
    When the plugin runs
    Then it exits non-zero without inventing a single-speaker fallback

  @core
  Scenario: R8 — Unit tests run offline against a fake Voicebox HTTP server
    Given a fake /generate and /audio fixture
    When the plugin unit tests run
    Then they pass with no live Voicebox or GPU

  @edge
  Scenario: R9 — Auto-chunk knobs pass through to /generate
    Given a VoiceScript or env that sets max_chunk_chars and crossfade_ms
    When the plugin generates
    Then the /generate body includes those fields within Voicebox's 100–5000 and 0–500 bounds

  @edge
  Scenario: R10 — Instruct over 500 characters fails loud
    Given a segment whose instruct exceeds 500 characters
    When the plugin runs
    Then it exits non-zero before calling Voicebox

  @edge
  Scenario: R11 — Paralinguistic tags are passed through uninterpreted
    Given segment text containing [laugh] or similar tags
    When the plugin generates
    Then the /generate text field contains those tags unchanged
    And the plugin does not strip or expand them
```

### Q&A
Closed during `--depth ready` refine (2026-08-19):

- **Transport:** REST `POST /generate` + JSON poll `GET /history/{id}`. Rejected MCP and `POST /speak` (10k cap, playback).
- **Profiles list shape:** REST is a JSON array, not MCP’s `{ profiles: [] }`.
- **Health:** HTTP 2xx is enough; do not require `model_loaded` (false until first TTS).
- **VoiceScript detection:** `{` → JSON object (invalid if no `segments`); leading `[` → plain text so `[laugh]` is not a script; YAML mapping is a script only if it carries `segments` / `speakers` / `default_profile` / `default_engine`.
- **YAML library:** `Bun.YAML.parse` / `stringify` — no `yaml` npm package.
- **Multi-doc:** parse each Doc, merge speakers (duplicate key fails), flatten segments in list order. No extra feature AC (behavior is frozen here).
- **Fetch seam:** inject `VoiceboxClient`; optional extra `runInvoke`+fetch spy for R1.
- **Concat:** in-process RIFF; no ffmpeg / Stories export.
- **`format: "audio"`:** allowed by `z.string()`; generator-spec Phase-1 markdown SHOULD NOT is amended with a one-liner at ship (R12), not by a kk-core change.
- **AC titles:** left byte-identical to feature D5 R1–R11 (DD-09). R12 is docs-only (no new feature scenario).

Deferred (out of this task, no owner on 0070): podcast workflow, Stories mix-down, audio publish, `seed` / `model_size` / `effects_chain`.
### Design
**WHAT.** A D3 generator plugin `voice-gen` that turns `Doc[]` into `Content` whose `format` is `"audio"` and whose bytes live in a sibling WAV. TTS is the local Voicebox REST `/generate` API.

**WHY.** Voicebox has no document script format and `/speak`/MCP are the wrong cap and shape. kk owns VoiceScript; REST `/generate` is the 50k automation path. Extends D3; two-way door; no ADR.

**WHERE.** Only `plugins/generations/voice-gen/` plus T3/T4 doc pointers at ship. No `packages/`, no `apps/cli`, no `vendors/voicebox` import.

**Frozen names**

| Kind | Name |
|------|------|
| Plugin dir | `plugins/generations/voice-gen/` |
| `plugin.json` | `{ "name": "voice-gen", "kind": "generator", "entry": "./src/index.ts", "version": "1.0.0" }` |
| package.json `name` | `@gobing-ai/voice-gen` |
| Files | `src/index.ts`, `src/voicescript.ts`, `src/voicebox-client.ts`, `src/concat.ts`, `tests/voice-gen.test.ts`, `tsconfig.json` (extends `../../../tooling/typescript/base.json`) |
| Exports | `parseDocToVoiceScript`, `validateVoiceScript`, `createVoiceboxClient`, `concatWavs`, `processGeneratorIO`, `main`, constants `VOICEBOX_TEXT_MAX` (50000) / `VOICEBOX_INSTRUCT_MAX` (500) / chunk 100–5000 default 800 / crossfade 0–500 default 50 |
| Env | `VOICEBOX_URL` default `http://127.0.0.1:17493` (strip trailing slash); `VOICEBOX_DEFAULT_PROFILE`; `VOICEBOX_TIMEOUT_MS` default `600000`; `VOICEBOX_POLL_MS` default `1000`; `VOICEBOX_MAX_CHUNK_CHARS` default `800`; `VOICEBOX_CROSSFADE_MS` default `50` |
| HTTP | `GET /health`, `GET /profiles` (JSON **array**), `POST /generate`, `GET /history/{id}`, `GET /audio/{id}` |
| Empty Content | `{ title: 'Notice', body: '# Notice\nNo documents provided for generation.', format: 'markdown', references: [] }` |
| stderr prefix | `voice-gen failed: ` (same grain as `content-gen failed: `) |

No new `kk` flags. No new Zod in kk-core.

**Parse algorithm (`parseDocToVoiceScript`)**

1. Trim `doc.body`.
2. If it starts with `{`: `JSON.parse`. Success as a plain object → VoiceScript path (even without `segments` — that fails validate). Parse throw → invalid VoiceScript (looks like JSON), not plain text.
3. If it starts with `[`: **plain text** (Chatterbox `[laugh] …` must not be classified as a script).
4. Else `Bun.YAML.parse`. Throw → plain text. Result is a plain object **and** has any of `segments` / `speakers` / `default_profile` / `default_engine` → VoiceScript path. Other YAML (scalar, array, unrelated mapping) → plain text.
5. Plain text → `{ segments: [{ text: body }], default_profile: env or string(doc.metadata?.voiceProfile) }`.
6. Multi-doc: parse each Doc independently; combine `speakers` (duplicate keys fail loud naming the key); concatenate `segments` in DocList order. Title = first script `title`, else first Doc `title`, else `"Generated voice"`.

`validateVoiceScript`: `segments` is a non-empty array; each `text` length 1..50000; `instruct` ≤500; chunk/crossfade in range; `gap_ms` ≥ 0; `engine` in `qwen|qwen_custom_voice|luxtts|chatterbox|chatterbox_turbo|tada|kokoro`; `language` in Voicebox’s 23-code enum (default `en`); referenced `speaker` keys exist.

**Field precedence (high → low)**

- **profile_id:** `segment.profile` → `speakers[segment.speaker].profile` → `script.default_profile` → `VOICEBOX_DEFAULT_PROFILE` → `doc.metadata.voiceProfile`. Then `GET /profiles` match `id` or `name` case-insensitively (first hit). Missing after that → R5.
- **engine:** segment → speaker → `script.default_engine` → omit (Voicebox default).
- **language:** segment → speaker → `script.language` → `en`.
- **instruct:** segment → speaker → omit.
- **max_chunk_chars / crossfade_ms:** segment → script → env → 800 / 50.

**HTTP + I/O**

`createVoiceboxClient({ fetch = globalThis.fetch, sleep })`: `health()` once per `processGeneratorIO` non-empty run (2xx only; ignore `model_loaded`); `resolveProfile`; `generate` POSTs JSON `{ profile_id, text, language, engine?, instruct?, max_chunk_chars, crossfade_ms, personality: false, normalize: true }`; `waitUntilDone` polls `GET /history/{id}` every `VOICEBOX_POLL_MS` until `completed`/`failed` or `VOICEBOX_TIMEOUT_MS`; `downloadAudio` returns `Uint8Array`.

`processGeneratorIO` copies content-gen: delete `--out` at start; `DocListSchema.parse`; empty → notice Content; else generate + `ContentSchema.parse`; write JSON. On throw: delete `--out` **and** sibling WAV; `main` returns 1 with `voice-gen failed:`. WAV path = `parse(outputPath).dir` + `parse(outputPath).name` + `.wav` (absolute in `metadata.audioPath`).

Content: `body` = `Bun.YAML.stringify` of the combined VoiceScript (no resolved ids); `format: "audio"`; `metadata.generator = "kk:voice-gen"`; `metadata.duration` = sum of segment durations + `gap_ms/1000`; `metadata.segments = [{ generationId, profile, duration }]` — **no `audioBytes`**.

**Concat (`concatWavs`)**

Parse RIFF/WAVE `fmt` + `data`. Require identical `audioFormat` (1 PCM or 3 IEEE float), channels, sampleRate, bitsPerSample. Concatenate PCM; insert `gap_ms` of zero samples before a clip when `gap_ms > 0`. Rewrite sizes. One segment: still write that WAV to the sibling path. Sample-rate mismatch → fail loud (`sample rate` on stderr). No ffmpeg, no extra npm.

**Anti-patterns (do not implement)**

- MCP client, `POST /speak`, SSE `GET /generate/{id}/status` as the poll
- `new yaml` / `ffmpeg` / `wav` dependencies; importing `vendors/voicebox`
- Silent truncate; falling through invalid JSON `{…}` to plain text
- Treating a leading `[` as VoiceScript
- Binary `Content.body`; new kk-core fields; `personality: true`; requiring `model_loaded`
- SpyOn `globalThis.fetch` as the **only** seam — inject `VoiceboxClient` (a `runInvoke` + fetch spy for R1 is extra, not the only seam)
- Writing audio inside Voicebox’s data dir as the durable output

**Tests**

`bun:test`. Inject `VoiceboxClient` (or `fetch` + `sleep`) returning a minimal PCM WAV fixture. Cover: discover+`runInvoke` (relative import of `apps/cli/src/invoke` like content-gen), plain text, two-speaker YAML, 50k, health/profile/failed/timeout, empty list, invalid `{segments:[]}`, chunk knobs, instruct 501, `[laugh]` unchanged, no live network.

**Later work (not this task)**

No dependent WBS. Podcast workflow, Stories mix-down, and audio publish stay out.
### Plan
1. Scaffold `plugins/generations/voice-gen` (`plugin.json` name `voice-gen`, `package.json` `@gobing-ai/voice-gen`, tsconfig) — **R1**.
2. Implement `voicescript.ts`: JSON `{` / YAML mapping detection, merge of N Docs, 50k / instruct / chunk / speaker validation — **R3, R4, R7, R10**.
3. Implement `voicebox-client.ts`: health, `GET /profiles` array resolve, POST `/generate` with frozen body, poll `GET /history/{id}`, GET `/audio/{id}`, timeout — **R2, R5, R9**.
4. Implement `concat.ts`: RIFF PCM/float concat + `gap_ms` zeros; fail-loud on fmt mismatch — **R3**.
5. Wire `index.ts` `processGeneratorIO` / `main` like content-gen; sibling `<outStem>.wav`; Content mapping; delete out+wav on failure; empty-list notice with zero HTTP — **R2, R6, R11**.
6. Add `tests/voice-gen.test.ts` (injected client + one `runInvoke` path) for R1–R11; no live Voicebox — **R8**.
7. T3/T4 doc sync: `03` module line, `04` satellite shipped, generator-spec §2.3 `format: "audio"` one-liner, `05` D5 row — **R12**.
8. `bun run autofix && bun run spur-check`.
### Solution
- `plugins/generations/voice-gen/plugin.json:2` — `"name": "voice-gen"`.
- `plugins/generations/voice-gen/plugin.json:3` — `"kind": "generator"`.
- `plugins/generations/voice-gen/package.json:2` — `@gobing-ai/voice-gen`.
- `plugins/generations/voice-gen/src/voicescript.ts:102` — `parseDocToVoiceScript`.
- `plugins/generations/voice-gen/src/voicescript.ts:150` — `mergeVoiceScripts`.
- `plugins/generations/voice-gen/src/voicescript.ts:242` — `validateVoiceScript`.
- `plugins/generations/voice-gen/src/voicebox-client.ts:50` — `createVoiceboxClient`.
- `plugins/generations/voice-gen/src/concat.ts:14` — `parseWav`.
- `plugins/generations/voice-gen/src/concat.ts:120` — `concatWavs`.
- `plugins/generations/voice-gen/src/index.ts:34` — `processGeneratorIO`.
- `plugins/generations/voice-gen/src/index.ts:189` — `main`.
- `docs/03_ARCHITECTURE.md:32` — `voice-gen/` module line.
- `docs/04_DESIGN.md:33` — satellite shipped (D5).
- `docs/design/generator-plugin-specification.md:57` — `format: "audio"`.
- `docs/05_FEATURES.md:67` — D5 Voice generator (Voicebox).
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `plugins/generations/voice-gen/tests/voice-gen.test.ts:116` |
| R2 | MET | `plugins/generations/voice-gen/tests/voice-gen.test.ts:139` |
| R3 | MET | `plugins/generations/voice-gen/tests/voice-gen.test.ts:178` |
| R4 | MET | `plugins/generations/voice-gen/tests/voice-gen.test.ts:239` |
| R5 | MET | `plugins/generations/voice-gen/tests/voice-gen.test.ts:265` |
| R6 | MET | `plugins/generations/voice-gen/tests/voice-gen.test.ts:313` |
| R7 | MET | `plugins/generations/voice-gen/tests/voice-gen.test.ts:339` |
| R8 | MET | `plugins/generations/voice-gen/tests/voice-gen.test.ts:364` |
| R9 | MET | `plugins/generations/voice-gen/tests/voice-gen.test.ts:382` |
| R10 | MET | `plugins/generations/voice-gen/tests/voice-gen.test.ts:438` |
| R11 | MET | `plugins/generations/voice-gen/tests/voice-gen.test.ts:467` |
| R12 | MET | `plugins/generations/voice-gen/tests/voice-gen.test.ts:898` |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R1 — Plugin is discoverable and invocable | MET | test | `plugins/generations/voice-gen/tests/voice-gen.test.ts:116` |
| R2 — Plain-text Doc generates speech via REST /generate | MET | test | `plugins/generations/voice-gen/tests/voice-gen.test.ts:139` |
| R3 — VoiceScript multi-speaker input becomes sequential generations | MET | test | `plugins/generations/voice-gen/tests/voice-gen.test.ts:178` |
| R4 — Segment text over 50,000 characters fails loud | MET | test | `plugins/generations/voice-gen/tests/voice-gen.test.ts:239` |
| R5 — Voicebox unavailable or generation failure fails loud | MET | test | `plugins/generations/voice-gen/tests/voice-gen.test.ts:265` |
| R6 — Empty DocList follows the generator empty-input contract | MET | test | `plugins/generations/voice-gen/tests/voice-gen.test.ts:313` |
| R7 — Invalid VoiceScript fails loud | MET | test | `plugins/generations/voice-gen/tests/voice-gen.test.ts:339` |
| R8 — Unit tests run offline against a fake Voicebox HTTP server | MET | test | `plugins/generations/voice-gen/tests/voice-gen.test.ts:364` |
| R9 — Auto-chunk knobs pass through to /generate | MET | test | `plugins/generations/voice-gen/tests/voice-gen.test.ts:382` |
| R10 — Instruct over 500 characters fails loud | MET | test | `plugins/generations/voice-gen/tests/voice-gen.test.ts:438` |
| R11 — Paralinguistic tags are passed through uninterpreted | MET | test | `plugins/generations/voice-gen/tests/voice-gen.test.ts:467` |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
**SECUA Code Review**

1. **Security**:
   - Zero unsanitized input execution; no direct shell execution; no new network dependencies.
   - All HTTP interactions are directed to the local Voicebox REST endpoint (`127.0.0.1:17493` by default) with configurable timeouts and strict error handling.
   - Atomic file management prevents leaking stale or corrupt audio artifacts.

2. **Error Handling**:
   - Strict fail-loud policy: 50,000-character cap, 500-character instruct cap, and chunk parameter bounds are checked before HTTP dispatch.
   - Connection failures, missing profiles, CUDA OOM errors, and timeouts produce clear, actionable error messages.
   - Atomic cleanup deletes output files on any failure.

3. **Correctness & Contract Adherence**:
   - Fully conforms to the D3 generator plugin specification (`DocListSchema` $\rightarrow$ `ContentSchema`).
   - Sibling WAV audio file strictly written beside `--out` as `<outStem>.wav` and referenced via absolute path in `Content.metadata.audioPath`.
   - `Content.format` set to `"audio"`, `Content.body` preserves canonical VoiceScript YAML.

4. **Maintainability & Simplicity**:
   - Zero external npm packages added for YAML, WAV parsing, or HTTP (uses standard `Bun.YAML`, native DataView RIFF parser, and standard `fetch`).
   - Clean modular separation: `voicescript.ts`, `voicebox-client.ts`, `concat.ts`, `index.ts`.

**Priority Findings**

| Priority | Finding | Action | Status |
| -------- | ------- | ------ | ------ |
| P1 | None | None | Resolved |
| P2 | None | None | Resolved |
| P3 | None | None | Resolved |
| P4 | None | None | Resolved |

**Traceability Matrix (P1–P4)**

| Req | Description | Implementation File | Test File & Case | Verdict |
| --- | ----------- | ------------------- | ---------------- | ------- |
| R1 | Plugin Discovery & Invocation | `plugins/generations/voice-gen/plugin.json` | `tests/voice-gen.test.ts` (R1) | **PASS** |
| R2 | Plain-Text Doc Generation | `src/index.ts`, `src/voicescript.ts` | `tests/voice-gen.test.ts` (R2) | **PASS** |
| R3 | VoiceScript Multi-Speaker Concat | `src/voicescript.ts`, `src/concat.ts` | `tests/voice-gen.test.ts` (R3) | **PASS** |
| R4 | Length Policy (50,000 chars) | `src/voicescript.ts` | `tests/voice-gen.test.ts` (R4) | **PASS** |
| R5 | Offline & Error Semantics | `src/voicebox-client.ts`, `src/index.ts` | `tests/voice-gen.test.ts` (R5) | **PASS** |
| R6 | Empty Input Notice | `src/index.ts` | `tests/voice-gen.test.ts` (R6) | **PASS** |
| R7 | Invalid VoiceScript Handling | `src/voicescript.ts` | `tests/voice-gen.test.ts` (R7) | **PASS** |
| R8 | Offline Unit Test Harness | `tests/voice-gen.test.ts` | `tests/voice-gen.test.ts` (all) | **PASS** |
| R9 | Auto-Chunk & Crossfade Knobs | `src/voicescript.ts`, `src/index.ts` | `tests/voice-gen.test.ts` (R9) | **PASS** |
| R10 | Instruct Length Cap (500 chars) | `src/voicescript.ts` | `tests/voice-gen.test.ts` (R10) | **PASS** |
| R11 | Paralinguistic Tags Passthrough | `src/voicescript.ts` | `tests/voice-gen.test.ts` (R11) | **PASS** |
| R12 | Documentation & Quality Gate | `docs/03_ARCHITECTURE.md`, `docs/04_DESIGN.md`, `docs/05_FEATURES.md` | `bun run spur-check` (405 tests pass) | **PASS** |
### References
- Feature D5: `docs/features/D5_voice-generator-voicebox.md`
- Satellite: `docs/design/voice-gen.md`
- Generator contract: `docs/design/generator-plugin-specification.md`
- Clone grain: `plugins/generations/content-gen/src/index.ts`, `plugins/publishings/emdash-pub/src/index.ts`
- Voicebox (reference only): `vendors/voicebox/backend/models.py` (`GenerationRequest`, `SpeakRequest`), `routes/generations.py`, `routes/history.py`, `routes/profiles.py`, `routes/health.py`, `utils/chunked_tts.py`
- Brainstorm: `docs/plans/2026-08-19-voice-gen-brainstorm.md`
- kk-core: `packages/kk-core/src/schemas.ts`, `packages/kk-core/src/kinds.ts`
### History
- 2026-08-20T00:24:18.878Z todo → wip (system)
- 2026-08-20T00:24:23.968Z wip → testing (system)
- 2026-08-20T00:24:24.246Z testing → done (system)
