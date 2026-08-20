---
title: Voice generator plugin (Voicebox)
date: 2026-08-19
needs_design: true
idea: Build plugins/generations/voice-gen as a generator plugin over the installed Voicebox TTS runtime
sources:
  - vendors/voicebox/README.md
  - vendors/voicebox/backend/models.py
  - vendors/voicebox/backend/mcp_server/tools.py
  - vendors/voicebox/backend/mcp_server/README.md
  - vendors/voicebox/backend/routes/generations.py
  - vendors/voicebox/backend/routes/speak.py
  - vendors/voicebox/backend/routes/stories.py
  - vendors/voicebox/backend/utils/chunked_tts.py
  - vendors/voicebox/docs/content/docs/overview/generating-speech.mdx
  - docs/design/generator-plugin-specification.md
  - packages/kk-core/src/schemas.ts
---

# Brainstorm: Voice generator plugin (Voicebox)

**Date:** 2026-08-19

## Overview

knowledge-kit has no voice generator. Robin already runs Voicebox locally (open-source AI
voice studio; Tauri + Python backend on `127.0.0.1:17493`) and checked its source into
`vendors/voicebox` as reference. The intended home is a new `kind: generator` plugin at
`plugins/generations/voice-gen`, composed later with other generators into a podcast
workflow.

Two facts must be locked before implementation, and they are now answered from Voicebox
source (not guessed):

1. **Input format.** Voicebox does **not** accept YAML, XML, SSML, or any document-level
   script format. Every generate/speak path takes a single plain `text` string plus
   generation knobs (`profile_id`, `engine`, `instruct`, `language`, chunking). Multi-voice
   “Stories” are a **timeline of already-generated clips** in Voicebox’s database — there
   is no script import. SSML is listed as “Coming Soon”. We must own a kk VoiceScript.
2. **Length.** `POST /generate` (and MCP `voicebox.speak`, which wraps that model) hard-caps
   **1–50,000 characters** per request. `POST /speak` is a thinner wrapper capped at
   **10,000 characters**. Long text is auto-split at sentence boundaries into chunks of
   **100–5,000 chars** (default **800**) and crossfaded. Output is an audio file plus
   `duration` seconds; there is no documented output-duration cap besides engine behavior
   (TADA markets “700s+ coherent audio”). A typical podcast episode fits one 50k-char
   single-voice request; **multi-speaker requires multiple generate calls** because each
   request is one `profile_id`.

The work is a new generator **instance** under kind parent **D**, not a new plugin kind
and not the podcast workflow itself.

## Research findings (Voicebox, 2026-08-19)

### Surfaces

| Surface | What it takes | What it returns | Use for `voice-gen`? |
| --- | --- | --- | --- |
| `POST /generate` | `GenerationRequest`: `profile_id`, `text` (1–50,000), optional `engine`, `instruct` (≤500), `language`, `max_chunk_chars` (100–5,000, default 800), `crossfade_ms` (0–500, default 50), `personality`, `effects_chain` | Async `GenerationResponse` (`status=generating`, poll `/generate/{id}/status`); audio at `GET /audio/{id}` | **Yes — automation path** |
| `POST /speak` | `SpeakRequest`: `text` (1–**10,000**), optional `profile` name/id, `engine`, `personality`, `language` | Same generation envelope; also plays on speakers / MCP pill | No — tighter cap, playback-oriented |
| MCP `voicebox.speak` | `text`, optional `profile`, `engine`, `personality`, `language`, `model_size` | `{ generation_id, status, poll_url }` — internally builds `GenerationRequest` (50k cap) | Agent convenience only; four tools total (`speak`, `transcribe`, `list_captures`, `list_profiles`). No stories, no chunk knobs |
| Stories REST | Create story by `name`; add items by **`generation_id`** + track + `start_time_ms` | Mixed export via `export_story_audio` | Optional mix-down later, not v1 input |

**Confidence:** HIGH. Caps are Pydantic `Field(..., max_length=…)` in
`vendors/voicebox/backend/models.py` (`GenerationRequest` L83, `SpeakRequest` L351).
MCP wiring is `backend/mcp_server/tools.py` `_speak` → `GenerationRequest`. Stories
`StoryItemCreate` is `generation_id` only (`models.py` L633–638). SSML: generating-speech
docs, “Coming Soon”.

### What Voicebox treats as “formatting”

Not a document schema. Inline hints inside the same `text` string:

- Punctuation for pauses.
- ALL CAPS / `*italics*` / `**bold**` as emphasis hints (engine-dependent).
- Chatterbox Turbo only: paralinguistic tags such as `[laugh]`, `[sigh]`, `[gasp]`.
  Other engines **read those tags aloud as text**. The chunker treats `[…]` as atomic.
- Qwen engines: separate `instruct` string (“speak slowly”, “whisper”), max 500 chars —
  not inline markup.

### Length implications for podcasts

- **Per generate call:** 50,000 chars ≈ 8–12k English words ≈ 50–80 minutes at ~150 wpm.
  One speaker-turn or even a whole single-voice episode can ship without kk-side splitting.
- **Voicebox already chunks** long `text` internally. kk does **not** need to pre-split a
  single speaker’s 50k blob for the engine to run. Post-generation *edit* is only needed
  for multi-speaker mix, trims, or when a segment exceeds 50k (fail-loud, do not truncate).
- **`POST /speak` / naive MCP-via-/speak` is the trap:** 10k chars would force mid-episode
  splits that `/generate` does not need. Plugin transport must be `/generate`.
- **Output:** WAV (or imported original format) served from Voicebox’s data dir. Copy into
  the kk workspace; do not treat Voicebox’s internal path as durable pipeline output.

## Approaches

### Approach 1: REST `/generate` plugin + kk-owned VoiceScript ⭐ Recommended

**Description:** Ship `plugins/generations/voice-gen` as a `kind: generator` plugin in the
D3 contract (`Doc[]` → `Content`, `--in`/`--out`, fail-loud). Input `Doc.body` is either
plain text (one default voice) or a **kk VoiceScript** (YAML or JSON we define). The
plugin maps each segment to `POST http://127.0.0.1:17493/generate`, polls status, copies
`GET /audio/{id}` into the workspace, concatenates segments in order, and writes
`Content` with `format: "audio"`, `body` = the script/transcript, and
`metadata.audioPath` / `duration` / `segments[]`.

**Trade-offs:**
- **Pros:**
  - Matches how `content-gen` and `qiita-pub`/`emdash-pub` wrap an external runtime.
  - Uses the full generation contract (50k cap, chunk knobs, `instruct`, engine).
  - VoiceScript is the podcast-workflow foundation the operator asked for.
  - Offline-testable with a fake HTTP transport (same pattern as publish fakes).
- **Cons:**
  - Requires Voicebox.app (or its server) running; fail-loud if `/health` is down.
  - We own a schema Voicebox does not validate — must keep it a thin projection of
    `GenerationRequest` plus `speaker` / `profile` mapping.
  - Sequential GPU queue inside Voicebox: long multi-speaker jobs are slow by nature.

**Implementation Notes:**
- Env (non-secret, overridable): `VOICEBOX_URL` default `http://127.0.0.1:17493`;
  optional `VOICEBOX_DEFAULT_PROFILE`. No MCP client id required for `/generate`.
- Fake Voicebox in tests: enqueue → completed fixture WAV. Never hit a live GPU in CI.
- v1 mix-down: sequential concat of segment WAVs (pause/gap as a VoiceScript field).
  Stories API is a later mix-down option, not the input format.
- `ContentSchema` already allows any `format` string and free `metadata` — **no kk-core
  schema change** if we convention `format: "audio"` + sidecar path in metadata.

**Confidence:** HIGH
**Sources:**
- `vendors/voicebox/backend/models.py` GenerationRequest | **Verified**: 2026-08-19
- `docs/design/generator-plugin-specification.md` | **Verified**: 2026-08-19
- `packages/kk-core/src/schemas.ts` ContentSchema | **Verified**: 2026-08-19

### Approach 2: MCP `voicebox.speak` as the plugin transport

**Description:** Same plugin home, but drive generation through the MCP stdio binary
(`/Applications/Voicebox.app/Contents/MacOS/voicebox-mcp`) or HTTP MCP at `/mcp`, using
`voicebox.speak` + `voicebox.list_profiles`.

**Trade-offs:**
- **Pros:**
  - Matches the config Robin already uses in Claude Desktop.
  - Profile resolution by name with client bindings.
- **Cons:**
  - MCP tool set cannot assemble Stories, cannot set `max_chunk_chars` / `instruct` /
    `effects_chain`.
  - Speak is playback-oriented (speakers + DictateWindow pill), a poor fit for a
    headless `kk executor run` step.
  - If anyone routes through `POST /speak` they inherit the **10k** cap.
  - Bun plugin would need an MCP client; REST is one `fetch`.

**Implementation Notes:** Keep MCP as the *agent* surface (skills talking to the user).
Do not make it the generator plugin transport.

**Confidence:** HIGH
**Sources:**
- `vendors/voicebox/backend/mcp_server/README.md` | **Verified**: 2026-08-19
- `vendors/voicebox/backend/models.py` SpeakRequest max_length=10000 | **Verified**: 2026-08-19

### Approach 3: Script-only generator now; TTS wiring as a follow-up feature

**Description:** v1 only authors/validates VoiceScript and emits `Content` whose `body`
is the script; a later task or plugin calls Voicebox.

**Trade-offs:**
- **Pros:** Fast schema lock; no GPU/runtime flakiness in the first ship.
- **Cons:** Does not produce voice. Operator asked for a **voice content generator**,
  not a linter. Splits the D3 `Doc[] → Content` promise across two features for no
  contract reason — `/generate` is already a stable JSON API.

**Confidence:** HIGH (as an option we should reject)

## Recommendations

Ship **Approach 1**. Voicebox has no document script format; kk must define VoiceScript
as a thin, speaker-aware projection of `POST /generate`. Transport is REST `/generate`
(50k cap + chunk knobs), not MCP and not `/speak`. Feature node: child of **D** (next
free digit **D5**). Podcast *workflow* (research → script → voice-gen → publish) is a
follow-on under **F** or a later D/F child — out of this feature.

Pick Approach 2 only if Voicebox’s REST is unavailable on the operator’s machine and MCP
is the only live socket — that is a fallback, not the design. Do not ship Approach 3.

## Design Summary

`plugins/generations/voice-gen` is a `kind: generator` instance of the existing D3
contract. It does not add a fourth plugin kind. It does not patch `vendors/voicebox`.

```
Doc[] JSON (--in)
  → parse Doc.body as VoiceScript YAML/JSON, or as a single plain-text segment
  → validate: each segment.text length in [1, 50000]; profile names resolvable
  → for each segment:
        POST {VOICEBOX_URL}/generate  { profile_id, text, engine?, instruct?, … }
        poll GET /generate/{id}/status
        GET /audio/{id}  → copy into workspace
  → concat segment audio in script order
  → Content {
        title,
        body: voice-script (canonical YAML) or transcript,
        format: "audio",
        metadata: { generator: "kk:voice-gen", audioPath, duration, segments[] }
    }
```

**kk VoiceScript (v1 sketch — lock signatures in `docs/design/voice-gen.md`)**

```yaml
title: string
language: en                    # optional; Voicebox language enum
default_engine: qwen            # optional
default_profile: Morgan         # used when a segment omits speaker
speakers:
  host:
    profile: Morgan             # Voicebox profile name or id
    engine: chatterbox_turbo    # optional override
segments:
  - speaker: host
    text: "Welcome to the show."
    instruct: "warm, conversational"   # Qwen delivery; omit on Turbo
    gap_ms: 400                        # silence before next clip
```

Plain `Doc.body` with no VoiceScript envelope → one segment, `default_profile` (env or
doc metadata). Invalid envelope → fail-loud, do not guess.

**Length policy (normative for this feature)**

| Limit | Value | Plugin behavior |
| --- | --- | --- |
| Per-segment `text` | 1–50,000 chars | Fail-loud if exceeded; never silent truncate |
| Voicebox auto-chunk | 100–5,000 chars/chunk, default 800 | Pass through; do not pre-split under the cap |
| Crossfade | 0–500 ms, default 50 | Pass through |
| `instruct` | ≤500 chars | Fail-loud if exceeded |
| `POST /speak` | 10,000 chars | Do not use this path |
| Output duration | none documented | Record `duration`; no kk-side max in v1 |
| Transcribe uploads | 200 MB | Out of scope (STT, not this generator) |

**Invariants**
- Voicebox is an **external runtime** (like Firecrawl). `vendors/voicebox` is reference
  only; we do not import its Python or fork it.
- Secrets: none expected for local loopback. If a future remote Voicebox needs a token,
  it goes in env, never `plugin.json`.
- Empty `Doc[]` → D3 empty-input `Content` notice, exit 0.
- Voicebox down / profile missing / generation `failed` → stderr + exit 1, no `--out`.
- No core schema change: `format` is already `z.string()`; audio lives in `metadata`.
- v1 does not: publish audio, drive Stories UI, clone voices, transcribe, personality
  rewrite, or author the podcast spur workflow.

**Rejected**
- Treating MCP as the plugin transport (Approach 2).
- Script-only v1 with no TTS (Approach 3).
- Waiting for Voicebox SSML / YAML import (docs say SSML is coming; Stories have no import).
- New plugin kind for audio (ADR-007 still has three kinds).
- Widening `ContentSchema.body` to binary (keep files on disk, path in metadata).

**Open design items (system-design, not blockers to proceed)**
- Canonical VoiceScript serialization: YAML in `Doc.body` vs JSON vs `metadata.voicescript`.
- Concat implementation: local WAV concat vs optional Stories export mix-down.
- Whether `format: "audio"` needs a one-line convention in the generator spec (T3) vs
  a short ADR if publish plugins would otherwise assume markdown.

## Spec self-review

- No `TODO` / `TBD` / `???` / empty required sections.
- No contradiction with ADR-007 (three kinds) or D3 (`Doc[]` → `Content`, fail-loud).
- Scope is one generator plugin + VoiceScript + REST client. Not the podcast workflow,
  not STT, not Voicebox patches.
- Feature parent is **D** (MECE: D owns generator instances). D1–D4 exist and are done;
  D5 is free (historical D5 was rehomed as F2).
- D’s Phase-1 Scope line “Out: audio/other formats this phase” is historical; D was
  reopened for plugin intake. D5 is that intake, with its own AC — do not silently
  rewrite D’s rolled-up markdown scenarios.

## Next Steps

1. Taste-gate this evaluation (`idea-eval`).
2. `spur feature create "Voice generator (Voicebox)" --parent D` → D5.
3. Author R-numbered AC; `spur feature check --strict`.
4. System-design satellite `docs/design/voice-gen.md` (VoiceScript + REST + Content mapping).
5. Decompose and batch-create under D5.
6. After refine: `/sp-dev-runall --feature D5` (or `--tasks feature:D5`).

---

**Generated by:** sp-brainstorm
**Research delegation:** Voicebox source + kk generator spec, 2026-08-19 (inline; no subprocess)
**Operator review:** pending idea-eval taste gate (`--auto` does not pre-approve taste)
