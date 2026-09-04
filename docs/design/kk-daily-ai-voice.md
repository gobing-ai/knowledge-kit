# kk-daily-ai-voice Workflow Design

## 1. Purpose

`kk-daily-ai-voice` (`plugins/kk/workflows/kk-daily-ai-voice.yaml`) is the daily AI news end-to-end pipeline (F61 destination, extended 2026-09-03): collect (aihot-ingest + last30days-ingest + horizon-ingest) → blended core-facts (fan-in + core-facts-gen) → article (content-gen) + cover (wt-image-cover) + spoken broadcast script (dailynews-gen) + audio (voice-gen) → publish fan-out (surfdash-pub + podcast-pub, article as episode show notes). Publish runs only with `publish_enabled: "true"`; cover only with `cover_enabled: "true"`.

## 2. Architecture & Data Flow

```mermaid
flowchart TD
    A[prepare] -->|workspace + source configs| B[fetch: aihot-ingest]
    B --> C[ingest-last30days]
    C --> D[ingest-horizon]
    D -->|Doc[] x3| E[blend-facts: fan-in + core-facts-gen]
    E -->|1-ingest/blended.json + 2-facts/core-facts.md| F[article: content-gen]
    F -->|cover_enabled| G[cover: wt-image-cover agent.run]
    F -->|cover disabled| H[script: dailynews-gen]
    G -->|2-cover/cover.png| H
    H -->|2-script/content.json & voicescript.yaml| I{skip_review?}
    I -->|false| J[review: hitl.confirm]
    I -->|true| K[wrap-docs]
    J -->|Approved| K[wrap-docs: VoiceScript -> Doc]
    J -->|Rejected| L[failed]
    K -->|3-audio/docs.json| M[generate: voice-gen]
    M -->|3-audio/content.wav + content.mp3| N[quality-control]
    N -->|publish_enabled| O[publish-prep: article + audio seam]
    O --> P[publish: fan-out surfdash-pub + podcast-pub]
    N -->|publish disabled| Q[done]
    P --> Q
```

## 3. Invocation

```bash
spur workflow run plugins/kk/workflows/kk-daily-ai-voice.yaml \
  --vars '{"work_dir":"/tmp/ai-news-today","limit":"10","language":"zh","voice_profile":"Robin","transcode_mp3":"true","skip_review":"true"}'
```

## 4. Pipeline Artifacts Layout

Within `${vars.work_dir}`:
- `1-ingest/source.json`: Executor-compatible Aihot input (`limit`, optional cursor/state path).
- `1-ingest/docs.json`: Fetched news articles formatted as `Doc[]`.
- `2-script/content.json`: Generator `Content` with VoiceScript YAML body and references.
- `2-script/voicescript.yaml`: Human-readable VoiceScript for inspection or manual edits.
- `3-audio/docs.json`: VoiceScript wrapped as a single `Doc` for `voice-gen`.
- `3-audio/content.json`: Synthesized audio `Content` metadata.
- `3-audio/content.wav`: Concatenated audio broadcast.
- `3-audio/content.mp3`: (Optional) Transcoded MP3 audio when `transcode_mp3: "true"`.

The workflow passes only the generic executor flags (`--in`, `--out`, optional `--plugins-path`).
Daily-news language/title/profile are inherited environment values for the plugin process. The
default `voice_profile` is `Robin`; review approval requires the explicit answer `yes`.
