# Voice generator (Voicebox)

Feature **D5** (accepted design — not yet built). Generator plugin instance
`plugins/generations/voice-gen` that turns `Doc[]` (plain text or kk VoiceScript)
into `Content` whose payload is TTS audio produced by a local Voicebox runtime.

> Chosen approach: REST `POST /generate` + kk-owned VoiceScript. No new kind, no
> core schema change, no ADR — extends the D3 generator seam. MCP and
> `POST /speak` are not the plugin transport.

Authority for the generic contract: [generator-plugin-specification.md](generator-plugin-specification.md).
Voicebox caps and request shapes: `vendors/voicebox/backend/models.py` (verified 2026-08-19).

---

## 1. Decisions

| ID | Choice | Rejected | Why |
|----|--------|----------|-----|
| D1 | New plugin dir `plugins/generations/voice-gen` (`kind: generator`) | New plugin kind; agent skill instead of plugin; wrap MCP as the entry | D3 instance pattern; `kk executor run voice-gen` is the invoke path; audio is still `Doc[] → Content` |
| D2 | Transport: `fetch` to Voicebox REST `POST /generate` | MCP `voicebox.speak`; `POST /speak` | `/generate` is the full contract (50k cap, `instruct`, chunk knobs). `/speak` is 10k and playback-oriented. MCP has no Stories/chunk knobs and needs an MCP client in Bun |
| D3 | Poll `GET /history/{id}` until `completed`/`failed` | Consume SSE `GET /generate/{id}/status` | Status route is `text/event-stream`. History is JSON `HistoryResponse` — fits a CLI plugin |
| D4 | kk-owned VoiceScript (YAML or JSON) as the multi-speaker input | Adopt a Voicebox document format; SSML; Stories import | Voicebox has none (plain `text` per request; Stories take `generation_id`s; SSML is “Coming Soon”) |
| D5 | Plain `Doc.body` (no `segments` key) = one segment using `VOICEBOX_DEFAULT_PROFILE` | Require VoiceScript for every call | Single-voice articles should not need YAML |
| D6 | Per-segment hard cap 50,000 characters; fail-loud, never truncate | Pre-split in kk; silent truncate; use `/speak`’s 10k | Matches `GenerationRequest.text` max_length. Voicebox already auto-chunks 100–5,000 chars (default 800) |
| D7 | `Content.format = "audio"`; bytes on disk; `metadata.audioPath` | Binary `Content.body`; new Zod field; `format` stays `markdown` with a hidden sidecar | `ContentSchema.format` is already `z.string()`; `body` stays inspectable text (canonical script). No core schema change |
| D8 | Sequential WAV concat in the plugin (optional `gap_ms`) | Voicebox Stories mix-down as v1 | Stories are a UI timeline of existing generations, not an input format. Concat is local and testable |
| D9 | Env `VOICEBOX_URL` (default loopback), `VOICEBOX_DEFAULT_PROFILE` for the plain-text path | MCP client id; config file; secrets in `plugin.json` | Local Voicebox has no auth. Profile name is required to generate |
| D10 | Fake HTTP Voicebox in unit tests | Live GPU in CI; skip tests | Same grain as publish-harness fakes |
| D11 | No ADR | ADR for “audio as generator output” | Extends D3; two-way door (delete the plugin). `format: "audio"` convention lives here; generator spec gets a one-line pointer at ship (T3) |
| D12 | `vendors/voicebox` is reference only | Workspace dependency on Voicebox Python; fork | External runtime, like Firecrawl |

---

## 2. Module layout

```
plugins/generations/voice-gen/
  plugin.json                 # name: voice-gen, kind: generator, entry: ./src/index.ts
  package.json                # @gobing-ai/voice-gen; workspace deps kk-core, ts-runtime, ts-utils, zod
  src/index.ts                # CLI --in/--out (copy content-gen processGeneratorIO grain)
  src/voicescript.ts          # parse + validate VoiceScript
  src/voicebox-client.ts      # health, profiles, generate, poll history, download audio
  src/concat.ts               # WAV PCM concat + gap_ms silence
  tests/voice-gen.test.ts
```

Picked up by the existing workspace glob `plugins/generations/*`. No new `packages/` crate.
No change to `apps/cli`.

---

## 3. Interfaces

```ts
export const VOICEBOX_TEXT_MAX = 50_000;
export const VOICEBOX_INSTRUCT_MAX = 500;
export const VOICEBOX_CHUNK_CHARS_MIN = 100;
export const VOICEBOX_CHUNK_CHARS_MAX = 5_000;
export const VOICEBOX_CHUNK_CHARS_DEFAULT = 800;
export const VOICEBOX_CROSSFADE_MS_MAX = 500;
export const VOICEBOX_CROSSFADE_MS_DEFAULT = 50;

export interface VoiceSpeaker {
    profile: string;          // Voicebox profile name or id
    engine?: string;          // qwen | qwen_custom_voice | luxtts | chatterbox | chatterbox_turbo | tada | kokoro
    language?: string;
    instruct?: string;        // default delivery for this speaker; ≤ 500
}

export interface VoiceSegment {
    speaker?: string;         // key into speakers; omit → default_profile
    profile?: string;         // inline override
    text: string;             // 1..50_000
    instruct?: string;
    engine?: string;
    language?: string;
    gap_ms?: number;          // silence inserted *before* this clip; default 0
    max_chunk_chars?: number; // 100..5000
    crossfade_ms?: number;    // 0..500
}

export interface VoiceScript {
    title?: string;
    language?: string;
    default_engine?: string;
    default_profile?: string;
    max_chunk_chars?: number;
    crossfade_ms?: number;
    speakers?: Record<string, VoiceSpeaker>;
    segments: VoiceSegment[];
}

export function parseDocToVoiceScript(doc: Doc, envDefaultProfile?: string): VoiceScript;
export function validateVoiceScript(script: VoiceScript): void; // throws named errors; engine/language enums enforced

export interface VoiceboxGenerateBody {
    profile_id: string;
    text: string;
    language: string;
    engine?: string;
    instruct?: string;
    max_chunk_chars: number;
    crossfade_ms: number;
    personality: false;       // v1: never personality-rewrite
}

export interface VoiceboxClient {
    health(): Promise<void>;
    resolveProfile(nameOrId: string): Promise<{ id: string; name: string }>;
    generate(body: VoiceboxGenerateBody): Promise<{ id: string }>;
    waitUntilDone(id: string): Promise<{ status: 'completed' | 'failed'; duration?: number; error?: string }>;
    downloadAudio(id: string): Promise<Uint8Array>;
}
```

`parseDocToVoiceScript`:

1. Trim `doc.body`.
2. If it parses as YAML or JSON **and** the object has a `segments` array → VoiceScript.
3. Else → `{ segments: [{ text: body }], default_profile: env or doc.metadata.voiceProfile }`.
4. A YAML/JSON object **without** `segments` (or with empty `segments`) is invalid VoiceScript —
   fail-loud; do not fall through to plain text.

---

## 4. Env

| Variable | Required | Default | Role |
|----------|----------|---------|------|
| `VOICEBOX_URL` | no | `http://127.0.0.1:17493` | Origin, no trailing slash |
| `VOICEBOX_DEFAULT_PROFILE` | plain-text path only | — | Profile name or id when a segment omits speaker/profile |
| `VOICEBOX_TIMEOUT_MS` | no | `600000` | Per-generation wait (poll budget) |
| `VOICEBOX_POLL_MS` | no | `1000` | `GET /history/{id}` interval |
| `VOICEBOX_MAX_CHUNK_CHARS` | no | `800` | Default chunk size if script omits it |
| `VOICEBOX_CROSSFADE_MS` | no | `50` | Default crossfade if script omits it |

No secrets on local loopback. If a future remote Voicebox needs a token, add an env var then;
never `plugin.json`.

---

## 5. HTTP

```
GET  {VOICEBOX_URL}/health
GET  {VOICEBOX_URL}/profiles
POST {VOICEBOX_URL}/generate          Content-Type: application/json
GET  {VOICEBOX_URL}/history/{id}      JSON poll (not SSE)
GET  {VOICEBOX_URL}/audio/{id}
```

`POST /generate` body is `VoiceboxGenerateBody`. Success: `{ id, status: "generating", … }`.

Poll `GET /history/{id}` until `status` is `completed` or `failed`. On `failed`, exit 1 with
`error`. On `completed`, `GET /audio/{id}` (WAV).

Profile resolution: `GET /profiles`, match `profile` name or id case-insensitively (same
precedence as Voicebox MCP, minus client bindings). Missing profile → exit 1 naming the
profile. Unreachable `/health` → exit 1 naming `VOICEBOX_URL`.

Do **not** call `POST /speak` or `/mcp`.

---

## 6. Content mapping

| Input | Content field |
|-------|----------------|
| VoiceScript `title`, else first Doc `title`, else `"Generated voice"` | `title` |
| Canonical YAML of the executed VoiceScript (resolved profile ids recorded in metadata, not required in body) | `body` |
| `"audio"` | `format` |
| Workspace WAV written beside `--out` (`<outStem>.wav`) | `metadata.audioPath` (absolute) |
| Sum of segment durations plus gaps | `metadata.duration` (seconds, number) |
| Per-segment `{ generationId, profile, duration, audioBytes? }` | `metadata.segments` |
| `{ generator: "kk:voice-gen" }` | `metadata.generator` |

`--out` is the Content JSON. The WAV is a sibling file so publish/workflow steps can copy it
without parsing JSON first. If `--out` is `/tmp/episode.json`, audio is `/tmp/episode.wav`.

Empty `Doc[]`: D3 notice Content, `format: "markdown"`, no Voicebox call, exit 0.

---

## 7. Length policy

| Limit | Source | Plugin behavior |
|-------|--------|-----------------|
| `text` 1–50,000 per segment | `GenerationRequest.text` | Fail-loud; never truncate; stderr names the cap |
| `instruct` ≤ 500 | `GenerationRequest.instruct` | Fail-loud before HTTP |
| `max_chunk_chars` 100–5,000 (default 800) | same | Clamp-fail (out of range → exit 1); pass through |
| `crossfade_ms` 0–500 (default 50) | same | Same |
| `POST /speak` 10,000 | `SpeakRequest.text` | Path not used |
| Output duration | none documented | Record only |
| Voicebox internal auto-chunk | `chunked_tts.py` | Relied on; kk does not pre-split under 50k |

Multi-speaker episodes are N generate calls (one `profile_id` each). Concat is kk’s job.

---

## 8. Concat

v1 concatenates PCM from each segment WAV in script order, inserting `gap_ms` of silence
before a clip when set. All clips must share sample rate; mismatch → fail-loud (Voicebox
writes `.wav`; stories code comments 24 kHz as a default, but we read the file header).

Stories `export_story_audio` is **not** v1. It remains a later mix-down option if overlap
or per-clip trim is needed.

---

## 9. Invariants

- No `@gobing-ai/kk-core` schema change.
- No `apps/cli` change.
- `vendors/voicebox` is never imported at runtime.
- Tests run offline; live `fetch` is injected.
- v1 does not: clone voices, transcribe, personality-rewrite, author effects, publish audio,
  or ship a podcast workflow.
- Paralinguistic `[tags]` pass through uninterpreted (Chatterbox Turbo may honor them;
  other engines may speak them — that is Voicebox’s problem, not kk’s).

---

## 10. 03 / 04 / 01 / 05 sync

- `04` §0 index row: this satellite, status **draft (D5)** now; **shipped (D5)** at implement.
- `03` module list: add `voice-gen` **when the plugin ships** (constitution §6.4 — current
  architecture only).
- Generator spec §2.3: one-line `format: "audio"` convention pointer **at ship** (T3), not now.
- `01` / `05`: at ship (T4 / T6), not now.
