# music-gen

Music generation over the homelab Lyria 3 instance (`POST /api/lyria/generate`).

**Status: contract frozen (task 0397).** This tree currently holds the pure contract — the
`MusicBrief` Zod schema, the deterministic prompt renderer, the instance request mapping, preset
resolution and the canonical digest input, plus the four golden fixtures. The generator entry, the
live/offline adapter, the presets, the spend guard and the `kk music` CLI noun land in 0398–0401.

Contract authority: [`docs/design/music-gen.md`](../../../docs/design/music-gen.md). That document
owns the wire contract, the render order, preset precedence, the adapter contract, the paid-call
failure table, the environment variables and the artifact record. This README owns the **authoring
form** — the YAML a person writes — and the preset index.

```text
plugins/generations/music-gen/
  plugin.json                 # 0398: kind: generator, entry ./src/index.ts
  src/brief.ts                # MusicBrief schema + m:ss helpers + the field→target table
  src/render.ts               # kk-owned PROMPT text, frozen segment order
  src/request.ts              # POST /api/lyria/generate body, no instance defaults
  src/presets.ts              # brief > workflow > theme > format > built-in, portability guard
  src/digest.ts               # canonical digest input for 0400 dedupe / 0398 provenance
  src/index.ts                # the published contract surface
  tests/                      # bun:test; fixtures/<name>/{brief.yaml,prompt.txt,request.json}
```

## 1. Authoring a brief

The brief is the only input document. `src/brief.ts` is the only schema — this file is the authoring
form, not a second definition. Unknown keys are rejected, so a typo fails at parse time instead of
being silently dropped.

```yaml
# midnight-cable-car.yaml
title: Midnight Cable Car            # required — the instance's library title (request: title)
format: song                         # required — format preset name (resolution input)
theme: synthwave                     # required — theme preset name (resolution input)
model: pro                           # optional — pro | clip (default: format preset, then pro)
duration_target: "0:30"              # optional — m:ss, 0:05–3:00; required somewhere for Pro
language: EN                         # optional — short tag (default: EN, always sent)
instrumental: false                  # optional — true sends lyrics: "" and appends the directive
audio_format: mp3                    # optional — mp3 | wav (request: format)
style: |-                            # optional — technical direction, the first prompt segment
  Warm analog synthwave at 92 BPM in A minor: detuned pad, gated snare, round sub bass.
  Vocal: intimate female alto, close-mic, no reverb tail.
avoid:                               # optional — prompt deny-list, merged with the preset lists
  - trap hi-hats
  - EDM riser clichés
structure:                           # optional — timestamped sections, non-decreasing `at`
  - at: "0:00"
    section: Intro
    note: filtered pad, no drums for four bars
  - at: "0:20"
    section: Chorus
    note: hook lyric repeated, gated snare opens up
lyrics: |-                           # optional — song text; omitted → the model writes its own
  [Verse]
  Last tram humming through the rain
  [Chorus]
  Midnight cable car, carry me home
images: []                           # optional — up to 10 reference image paths, in order
takes: 1                             # optional — 1..4 sequential requests (batchCount is always 1)
meta:                                # optional — recorded in the take sidecar only, never sent
  author: operator
```

Field rules that bite:

| Field | Rule |
| --- | --- |
| `format` / `theme` | Must name a preset; an unknown name is a resolution error, never a silent fallback. |
| `duration_target` | `m:ss`, `0:05`–`3:00`. Required for `model: pro` from some layer (the instance would otherwise send `3:00`). Ignored for `clip` and must stay near `0:30` if you write it. |
| `language` | Always sent. kk never renders a `Lyrics (sing in …)` line — the instance appends that block itself. |
| `style` | Required from some layer. It is the technical direction segment — the only control surface the model has. kk never writes duration prose. |
| `avoid` | Rendered as one `Avoid: a, b` segment, omitted when empty. Additive across layers. |
| `structure` | Rendered as `[m:ss] Section — note` lines, in authored order. Replaced (not merged) by a higher-precedence layer. |
| `lyrics` | Sent as the request field. An `instrumental: true` brief may not also carry lyrics. |
| `takes` | N sequential, separately billed requests — never one batched call. |
| `meta` | Never sent to the instance; it lands in the take sidecar. |

Presets are portable data. A preset file may not declare a provider, API base URL, API model id,
credential or price — `assertPresetPortable` rejects the file with exit code 2. Prices live in user
config (`music.prices`, 0400); `model: pro|clip` is the instance's own selector and stays allowed.

## 2. Preset index

`formats/` and `themes/` are shipped by 0399. This table is generated from those data files by
0399's index script; until then it lists the planned set so the index cannot drift once generated.

| Format | Model | Default target | Intended use | Status |
| --- | --- | --- | --- | --- |
| `song` | `pro` | `2:30` | Full song with vocals and a section skeleton | 0399 |
| `clip` | `clip` | — (model fixed at ~0:30) | Short preview, loop sketch, direction check | 0399 |
| `jingle` | `pro` | `0:20` | Product/station ident, hook states the name once | 0399 |
| `loop` | `clip` | — | Instrumental loop bed | 0399 |
| `underscore` | `pro` | `0:45` | Instrumental bed under narration, no hook requirement | 0399 |

| Theme | Technical direction | Default avoid | Status |
| --- | --- | --- | --- |
| `cinematic` | Orchestral/hybrid score with a dramatic arc | trailer hits, horror stingers | 0399 |
| `lofi` | Dusty sampled hip-hop bed at 70–85 BPM | trap hi-hats, hard drops | 0399 |
| `synthwave` | Analog synth, 90–110 BPM, gated drums | EDM risers, distorted guitars | 0399 |
| `ambient-tech` | Glassy, spacious texture at 100–115 BPM | hard drops, talkbox vocals | 0399 |

`corporate-tech` and `xhs-pop` are deliberately not shipped: no generated track has produced
evidence for them yet.

## 3. Tests

```bash
bun test plugins/generations/music-gen
```

Fully offline: the four golden fixtures pin the prompt text and request JSON byte for byte, and the
preset-portability test spawns a loader to prove the non-zero exit. No socket is opened.
