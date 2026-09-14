# kk-daily-ai-voice Workflow Design

## 1. Purpose

`kk-daily-ai-voice` (`plugins/kk/workflows/kk-daily-ai-voice.yaml`) is the daily AI news end-to-end pipeline (F61 destination, extended 2026-09-03): collect (aihot-ingest + last30days-ingest + horizon-ingest) → blended core-facts (fan-in + core-facts-gen) → episode plan (episode-plan-gen: score/dedup/select + plan-translate agent step, 2026-09-05) → article (content-gen) + cover (wt-image-cover) + spoken broadcast script (dailynews-gen) + audio (voice generator plugin, `voice_generator` var, default `omni-voice-gen`) → publish fan-out (surfdash-pub + podcast-pub, article as episode show notes). Publish runs only with `publish_enabled: "true"`; cover only with `cover_enabled: "true"`; in-place plan translation only with `plan_translate_enabled: "true"`. Article/script/show notes all consume `2-plan/plan.json` (selection capped by `plan_max_items`, default `20`). `last30days_enabled: "false"` (default) routes `fetch` directly to Horizon and stubs `1-ingest/last30days-docs.json` as `[]` for fan-in. Article/script/cover/audio outputs are date-stamped (`${run_date}` = local `YYYYMMDD`, captured once in `prepare`) and skipped when the day's file already exists — fast re-runs never regenerate completed steps or mix days' content. Voice synthesis waits scale with segment length (`VOICEBOX_TIMEOUT_MS` base + 60s/100 chars) so long qwen segments don't trip the fixed deadline.

## 2. Architecture & Data Flow

```mermaid
flowchart TD
    A[prepare] -->|workspace + run_date + source configs| B[fetch: aihot-ingest]
    B -->|last30days_enabled| C[ingest-last30days]
    B -->|last30days disabled| D[ingest-horizon]
    C --> D[ingest-horizon]
    D -->|Doc[] x3| E[blend-facts: fan-in + core-facts-gen]
    E -->|1-ingest/blended.json + 2-facts/core-facts.md| P0[plan: episode-plan-gen]
    P0 -->|plan_translate_enabled| P1[plan-translate: agent.run in-place zh]
    P0 -->|translate disabled| F
    P1 -->|2-plan/plan.json| F[article: content-gen]
    F -->|cover_enabled| G[cover: wt-image-cover agent.run]
    F -->|cover disabled| H[script: dailynews-gen]
    G -->|2-cover/cover.png| H
    H -->|2-script/content-$run_date.json & voicescript-$run_date.yaml| I{skip_review?}
    I -->|false| J[review: hitl.confirm]
    I -->|true| K[wrap-docs]
    J -->|Approved| K[wrap-docs: VoiceScript -> Doc]
    J -->|Rejected| L[failed]
    K -->|3-audio/docs.json| M[generate: voice generator var]
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
- `run-date.txt`: Local `YYYYMMDD` captured at `prepare`; read into `${vars.run_date}` for all dated outputs.
- `1-ingest/source.json`: Executor-compatible Aihot input (`limit`, optional cursor/state path).
- `1-ingest/docs.json`: Fetched news articles formatted as `Doc[]`.
- `1-ingest/last30days-docs.json`: last30days `Doc[]` (or `[]` stub written by `prepare` when `last30days_enabled: "false"`).
- `1-ingest/blended.json`: Fan-in merged `Doc[]` + `2-facts/core-facts.md` blended core-facts markdown.
- `2-plan/content.json` / `2-plan/plan.json`: Episode plan Content and its extracted `Doc[]` — scored, deduped, capped at `plan_max_items` (cached short-circuit when `plan.json` exists).
- `2-article/content-${run_date}.json` / `2-article/article-${run_date}.md`: Generated article Content and markdown (skipped when the day's `.md` exists).
- `2-cover/cover-${run_date}.png`: Cover image (cover state skipped when the day's file exists).
- `2-script/content-${run_date}.json` / `2-script/voicescript-${run_date}.yaml`: Generator `Content` with VoiceScript YAML body and the human-readable VoiceScript (skipped when the day's `.yaml` exists).
- `3-audio/docs.json`: VoiceScript wrapped as a single `Doc` for the `voice_generator` plugin (default `omni-voice-gen`).
- `3-audio/content.json`: Synthesized audio `Content` metadata (generate state skipped when the file exists and `metadata.qc.passed` is true).
- `3-audio/content.wav`: Concatenated audio broadcast.
- `3-audio/content.mp3`: (Optional) Transcoded MP3 audio when `transcode_mp3: "true"`.

The workflow passes only the generic executor flags (`--in`, `--out`, optional `--plugins-path`).
