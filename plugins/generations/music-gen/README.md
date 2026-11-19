# music-gen

Music generation over the homelab Lyria 3 instance (`POST /api/lyria/generate`), as a
`kind: generator` plugin.

**Status: the plugin ships (task 0398).** The 0397 contract — the `MusicBrief` Zod schema, the
deterministic prompt renderer, the instance request mapping, preset resolution and the canonical
digest input — plus the plugin itself: `plugin.json`, the live instance adapter with the
non-idempotent paid-call policy, the cache-first analyse, the offline adapter
(`KK_MUSIC_DRY_RUN=1`), the artifact + take sidecar and the `Content` mapping. The format × theme
presets ship in 0399 (`presets/`, indexed below by a generator). The spend guard lands in 0400, the
`kk music` noun in 0401, the workflow in 0403 and measurement in 0405.

Contract authority: [`docs/design/music-gen.md`](../../../docs/design/music-gen.md). That document
owns the wire contract, the render order, preset precedence, the adapter contract, the paid-call
failure table, the environment variables and the artifact record. This README owns the **authoring
form** — the YAML a person writes — the preset index and how to run the plugin.

```text
plugins/generations/music-gen/
  plugin.json                 # kind: generator, entry ./src/index.ts, runtime.requires
  src/brief.ts                # MusicBrief schema + m:ss helpers + the field→target table
  src/render.ts               # kk-owned PROMPT text, frozen segment order
  src/request.ts              # POST /api/lyria/generate body, no instance defaults
  src/presets.ts              # brief > workflow > theme > format > built-in, portability guard
  src/digest.ts               # canonical digest input for 0400 dedupe / 0398 provenance
  src/job.ts                  # the --in envelope: brief from docs[0].body, knobs from metadata
  src/config.ts               # music.instance.* / music.prices.* + KK_MUSIC_* overrides
  src/adapter/instance.ts     # the live HTTP adapter and the paid-call policy
  src/adapter/offline.ts      # KK_MUSIC_DRY_RUN=1: silent WAV, synthetic manifest, zero network
  src/adapter/index.ts        # adapter selection (dry run → offline)
  src/audio.ts                # delivered-container detection + the deterministic silent WAV
  src/artifact.ts             # <slug>-<model>-<instanceId>.<ext> naming + the take sidecar
  src/content.ts              # Content mapping: format audio, liner notes, references, echoes
  src/plugin.ts               # the take loop: read → generate → persist → map
  src/index.ts                # the published contract surface + the plugin entry
  presets/formats/*.yaml      # 0399: job intent, model, duration target, section skeleton, lyrics policy
  presets/themes/*.yaml       # 0399: technical direction prose, avoid[], instrumentation palette
  presets/SOURCE.md           # 0399: provenance + evidence-promotion rules
  scripts/gen-preset-index.ts # 0399: README index generator (--check fails on drift)
  scripts/resolve-preset.ts   # 0399: resolve a brief through the presets and print the trace
  tests/                      # bun:test; fixtures/<name>/{brief.yaml,prompt.txt,request.json}
```

Nothing outside `src/adapter/` opens a socket, and nothing in the plugin (or its tests) ever makes a
paid call: the adapter takes an injected `fetch` seam and every test supplies its own.

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

`formats/` and `themes/` ship as data (task 0399). Any format pairs with any theme: the **format**
owns the arc (model, default duration target, section skeleton, lyrics policy) and the **theme** owns
the sound (the technical-direction prose the model reads, plus its default `avoid[]`). The table
below is generated from those files, so the index cannot drift from the data.

<!-- preset-index:start -->
`formats/`: 5 · `themes/`: 4. Regenerate with
`bun plugins/generations/music-gen/scripts/gen-preset-index.ts`; `--check` fails on drift.

### Formats

A format fixes the job intent, the instance selector (`pro|clip`), the default duration target and the
timestamped section skeleton. `lyrics` is the format’s policy: `forbidden` resolves `instrumental: true`.

| Format | Model | Default duration | Lyrics | Intended use | Status |
| --- | --- | --- | --- | --- | --- |
| `clip` | `clip` | — (clip is fixed at ~0:30) | allowed | Quick preview, a direction check before a pro run, or a short social cut. | `authored` |
| `jingle` | `pro` | `0:20` | allowed | Product or station ident — the hook states the name once and resolves fast. | `authored` |
| `loop` | `clip` | — (clip is fixed at ~0:30) | forbidden | Background bed for a talk-through, demo or menu loop; no vocals by design. | `authored` |
| `song` | `pro` | `2:30` | allowed | A complete track with a sung hook; the default for lyrical pieces. | `authored` |
| `underscore` | `pro` | `0:45` | forbidden | Underscore under spoken narration or a video essay; no hook or vocal required. | `authored` |

### Themes

A theme supplies the technical-direction prose the model reads — genre, tempo, key, instrumentation,
vocal character and production — plus its default `avoid[]`, rendered as one `Avoid: …` segment.

| Theme | Technical direction | Default avoid | Intended use | Status |
| --- | --- | --- | --- | --- |
| `ambient-tech` | glassy ambient techno; 100-115 BPM, steady and unaccented; C# minor | hard drops, talkbox vocals, pop hooks, vocal chops | Product walkthroughs, conference holds, editorial beds that must stay out of the way. | `authored` |
| `cinematic` | cinematic orchestral hybrid score; 60-90 BPM with rubato swells; D minor | horror stingers, orchestral hits on every downbeat, distorted electric guitar, pop chorus stacks | Trailer-style openings, story intros, a track that must feel like a scene. | `authored` |
| `lofi` | dusty sampled lo-fi hip-hop; 70-85 BPM, swung and unhurried; A minor | trap hi-hat rolls, hard drops, EDM riser clichés, over-compressed loudness | Study/focus background, calm narration bed, unhurried social cuts. | `authored` |
| `synthwave` | analog synthwave revival; 90-110 BPM, straight four-on-the-floor; A minor | festival supersaws, EDM risers, distorted djent guitars, modern trap percussion | Retro-tech explainers, night-drive montages, upbeat product stings. | `authored` |
<!-- preset-index:end -->

Evidence status: `authored` means written from the design contract with no generated take judged
against it yet, `evidence-pending` means queued for a real generation round, and `verified` means a
reviewed take exists — the rules live in [`presets/SOURCE.md`](presets/SOURCE.md). `corporate-tech`
and `xhs-pop` are deliberately not shipped: no generated track has produced evidence for them yet.

## 3. Running the plugin

The plugin is invoked the way every generator is — a `DocList` in, a `Content` out:

```bash
bun plugins/generations/music-gen/src/index.ts --in docs.json --out content.json
```

`docs[0].body` carries the brief in the YAML authoring form above. `docs[0].metadata.musicGen` carries
only what is *not* the brief, and is strict (an unknown key is an error, never silently dropped):

```yaml
metadata:
  musicGen:
    presets:                      # 0399 loads these from disk; accepted inline here
      format: { name: loop, style: "Glassy texture at 110 BPM." }
      theme: { name: ambient-tech }
    outputStem: midnight-cable-car # overrides the artifact slug (default: the brief title)
    force: true                    # a paid re-send the operator accepted (0400 records it)
    reason: "the first take was unusable"
```

### 3.1 Configuration

One reader, three layers: **environment override > `music:` config key > documented default**. The
config file is the existing kk user config (`KK_CONFIG`, else `~/.config/kk/config.yaml`).

| Setting | Environment | Config key | Default |
| --- | --- | --- | --- |
| Instance base URL | `KK_MUSIC_INSTANCE_URL` | `music.instance.url` (alias `music.baseUrl`) | `http://127.0.0.1:3000` |
| Generate timeout (ms) | `KK_MUSIC_TIMEOUT_MS` | `music.instance.timeoutMs` (alias `music.timeoutMs`) | `180000` |
| Connect timeout (ms) | — | `music.instance.connectTimeoutMs` | `5000` |
| Offline adapter | `KK_MUSIC_DRY_RUN=1` | — | unset (live) |
| Unit prices | — (0400) | `music.prices.{pro,clip,analyze}` | `pro 0.08`, `clip 0.04`, `analyze` unpriced |

A key that is *present* but of the wrong type throws, naming the key — a silently defaulted endpoint
or timeout would send a paid request somewhere unexpected. The default base URL is provisional: it
assumes the instance listens on loopback port 3000, and 0404's dogfood pins the real value.

### 3.2 The paid-call policy

`POST /api/lyria/generate` and `POST /api/ai/analyze` are **non-idempotent**: the instance may have
billed and persisted a take even when kk never saw the response. The adapter therefore:

- **retries only connect-phase failures** (`ECONNREFUSED`, `ENOTFOUND`, `EAI_AGAIN`,
  `EHOSTUNREACH`, `ENETUNREACH`, a connect timeout), bounded to 3 attempts — the request provably
  never reached the instance;
- treats `401`, `402`, `403`, `404`, `429` and the all-keys-rejected `502` as **terminal**: one
  request sent, no retry, the instance's own error text plus a remediation;
- **never re-sends after an ambiguous outcome** (a timeout after send, `ECONNRESET`, any other `5xx`,
  an unparseable `200`, a `200` with no audio). It reconciles against `GET /api/generations` and
  adopts the earliest take whose `prompt` is byte-equal to what kk sent, whose `model` matches and
  whose `generatedAt` is at or after the request start — flagging it `adoptedByReconciliation` and
  listing any later matches as `unclaimed`. No match fails naming the endpoint, the elapsed time and
  the `--force` remediation.

`analyze` is **cache-first**: the instance caches analysis per generation, so the manifest is read
first and the paid `POST /api/ai/analyze` is issued only when no analysis is cached. An ambiguous
analyse re-reads the manifest — it never pays twice.

### 3.3 Artifacts and sidecars

One artifact per take, in the `--out` directory:

```text
<slug>-<model>-<instanceId>.<ext>          # e.g. midnight-cable-car-clip-gen_01.mp3
<slug>-<model>-<instanceId>.<ext>.take.json
```

The delivered container (`ext`) is detected from the returned bytes, never assumed from the request's
`audio_format`. The sidecar carries the 0397 digest and digest input, the instance id, the model, the
unit price charged, the adoption flag, the unclaimed extra takes, the exact request body and
`language` / `durationTarget` / `batchCount` **exactly as the instance recorded them** (absent when the
manifest lacked them, never defaulted). The instance's `generations/` library is never mirrored into a
kk workspace.

`takes: N` is N sequential single-take requests. A failure on take k leaves takes 1..k-1 on disk for
a resume (0400's run-scoped dedupe skips them) and writes no `--out` file.

### 3.4 Offline

```bash
KK_MUSIC_DRY_RUN=1 bun plugins/generations/music-gen/src/index.ts --in docs.json --out content.json
```

The offline adapter emits a deterministic 1-second silent WAV, a synthetic manifest (`offline-take-<n>`)
and a synthetic analysis, with **zero network calls by construction** — it holds no fetch seam. It is
the default for this plugin's whole test suite, so no test can spend money.

## 4. Tests

```bash
bun test plugins/generations/music-gen
```

Fully offline. The four golden fixtures pin the prompt text and request JSON byte for byte; the
preset-portability test spawns a loader to prove the non-zero exit; and every adapter test runs
against an injected `fetch` stub, covering success, format detection, manifest mapping, cache-first
analyse, each terminal status, the connect-retry bound, timeout → reconciliation adopt,
timeout → miss → fail, and malformed JSON. The discoverability test runs kk-core's own registry over
`plugins/` and compares `plugin.json`'s `runtime.requires` against the modules `src/` imports.
