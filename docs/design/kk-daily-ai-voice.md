# kk-daily-ai-voice Workflow Design

## 1. Purpose

`kk-daily-ai-voice` (`plugins/kk/workflows/kk-daily-ai-voice.yaml`) is the daily AI news end-to-end pipeline (F61 destination, extended 2026-09-03): collect (aihot-ingest + last30days-ingest + horizon-ingest) → blended core-facts (fan-in + core-facts-gen) → episode plan (episode-plan-gen: score/dedup/select + plan-translate agent step, 2026-09-05) → article (content-gen) + cover (wt-image-cover) + spoken broadcast script (dailynews-gen) + audio (voice driver selected by the `vdriver` var: `voicebox` → voice-gen default, `ominivoice` → omni-voice-gen, `gemini` → gemini-tts) → publish fan-out (surfdash-pub + podcast-pub, article as episode show notes). Publish runs only with `publish_enabled: "true"`; cover only with `cover_enabled: "true"`; in-place plan translation only with `plan_translate_enabled: "true"`. Article/script/show notes all consume `${run_date}_03_plan_plan.json` (selection capped by `plan_max_items`, default `20`). `last30days_enabled: "false"` (default) routes `fetch` directly to Horizon and stubs `1-ingest/last30days-docs.json` as `[]` for fan-in (the `prepare`-written executor configs keep fixed names — see section 4). Step outputs follow the naming convention `{run_date}_{NN}_{step_name}_{artifact}.{ext}` (`${run_date}` = local `YYYYMMDD`, captured once in `prepare`; `NN` = 1-based ordinal of the owning state) and are skipped when the step's output file already exists — fast re-runs never regenerate completed steps or mix days' content. Voice synthesis waits scale with segment length (`VOICEBOX_TIMEOUT_MS` base + 60s/100 chars) so long qwen segments don't trip the fixed deadline.

## 2. Architecture & Data Flow

```mermaid
flowchart TD
    A[prepare] -->|workspace + run_date + source configs| B[fetch: aihot-ingest]
    B -->|last30days_enabled| C[ingest-last30days]
    B -->|last30days disabled| D[ingest-horizon]
    C --> D[ingest-horizon]
    D -->|Doc[] x3| E[blend-facts: fan-in + core-facts-gen]
    E -->|1-ingest/{run_date}_02_collect_blended.json + 2-facts/{run_date}_02_collect_core-facts.md| P0[plan: episode-plan-gen]
    P0 -->|plan_translate_enabled| P1[plan-translate: agent.run in-place zh]
    P0 -->|translate disabled| F
    P1 -->|2-plan/plan.json| F[article: content-gen]
    F -->|cover_enabled| G[cover: wt-image-cover agent.run]
    F -->|cover disabled| H[script: dailynews-gen]
    G -->|2-cover/cover.png| H
    H -->|2-script/{run_date}_08_script_content.json & {run_date}_08_script_voicescript.yaml| I{skip_review?}
    I -->|false| J[review: hitl.confirm]
    I -->|true| K[wrap-docs]
    J -->|Approved| K[wrap-docs: VoiceScript -> Doc]
    J -->|Rejected| L[failed]
    K -->|3-audio/{run_date}_10_wrap-docs_docs.json| M[generate: voice generator var]
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

Within `${vars.work_dir}` every step output follows the naming convention
`{run_date}_{NN}_{step_name}_{artifact}.{ext}` — `NN` is the 1-based ordinal of the owning state in
the workflow's `states:` list, and the artifact base is the semantic file name (e.g. `${run_date}_02_collect_blended.json`).

**Redo by delete:** each step cache-hits when its output file(s) exist and re-runs when they do not.
To redo a specific step, delete its output file(s) and re-run the workflow — the step regenerates,
and later steps stay cached until their own outputs are deleted.

Fixed-name exceptions (outside the convention):
- `run-date.txt` — its content defines `${vars.run_date}`, so it cannot embed the value it defines; the `prepare` stage also runs while `${vars.run_date}` is still empty (it mints the stamp).
- `step-timing.json` — shared append-across-states timing log.
- The `prepare`-written executor configs (`1-ingest/source.json`, `1-ingest/last30days.json`, `1-ingest/horizon.json`, `1-ingest/last30days-docs.json`) — written before `${vars.run_date}` is captured.
- Plugin-fixed intermediates: `2-cover/content.json` + `content-cover-01.{png,jpg}` (kk:image-authoring contract), `3-audio/content.wav` / `content.mp3` (voice generator siblings of the `--out` file).

Convention-named artifacts:
- `${run_date}_02_collect_blended.json`: Fan-in merged `Doc[]`; `${run_date}_02_collect_content.json` / `${run_date}_02_collect_core-facts.md`: blended core-facts Content + markdown.
- `${run_date}_03_plan_content.json` / `${run_date}_03_plan_plan.json`: Episode plan Content and its extracted `Doc[]` — scored, deduped, capped at `plan_max_items` (cached short-circuit when the plan `Doc[]` file exists; the `plan-translate` agent step rewrites it in place).
- `${run_date}_04_quality-control-content_annotated.json` / `${run_date}_04_quality-control-content_candidates.json`: QC filter input/output; `episode-plan-gen` derives `${run_date}_04_quality-control-content_candidates.rejected.json` from the candidates `--out` path (the `run-report` state's `NEWS_REPORT_REJECTED_FILE` points at the same file).
- `${run_date}_06_article_content.json` / `${run_date}_06_article_article.md`: Generated article Content and markdown (skipped when the day's `.md` exists).
- `${run_date}_07_cover_cover.png`: Cover image (cover state skipped when the day's file exists).
- `${run_date}_08_script_content.json` / `${run_date}_08_script_voicescript.yaml`: Generator `Content` with VoiceScript YAML body and the human-readable VoiceScript (skipped when the day's `.yaml` exists).
- `${run_date}_10_wrap-docs_docs.json`: VoiceScript wrapped as a single `Doc` for the voice driver selected by `vdriver` (default `voicebox` → voice-gen).
- `${run_date}_11_generate_content.json`: Synthesized audio `Content` metadata (generate state skipped when the file exists and `metadata.qc.passed` is true).
- `${run_date}_13_publish-prep_content.json`: Article + audio merged for the publish seam.
- `${run_date}_14_publish-surfdash_result.json` / `${run_date}_16_publish-podcast_result.json`: per-target fan-out results; `${run_date}_15_show-notes_show-notes.md`: rendered show notes.
- `${run_date}_17_publish_result.json` / `${run_date}_17_publish_publish-status.txt`: merged publish result and the `full|partial|none` routing flag (read by the publish/locales transition guards).
- `${run_date}_19_run-report_report.json` / `${run_date}_19_run-report_report.md` (work-dir root) plus inputs `${run_date}_19_run-report_episode-plan.json` and the shared rejected audit in `2-plan/`.
- `${run_date}_20_translate-en_*` / `${run_date}_22_translate-ja_*` / `${run_date}_24_translate-sync_*`: locale scaffolds, post-path markers, and sync results in `3-publish/`.

The workflow passes only the generic executor flags (`--in`, `--out`, optional `--plugins-path`).

## 5. Stage ownership (0133, ADR-115)

Every over-cap stage body lives in `plugins/kk/scripts/kk-workflow-stages.ts` (the `daily-*` verbs,
shared with the kk-solo-podcast / kk-itc / kk-storm-research stages); each delegated YAML action keeps
the five-line package-root resolution prelude plus one `bun "$st" daily-<stage> …` call line — six YAML lines per
delegated action; the two
`agent.run` prompts stay in the YAML, and the bodies that already fit the ADR-115 budget
willingly stayed inline (`collect:onEnter:0`'s `kk executor fan-in --source` at 7 commands, the HITL/guard
states) — `publish-partial:onEnter:0` was in budget at 9 commands but moved with its siblings. The step-timing append, the per-step cache predicate and its
message, the plugins-path argv and every plugin invocation moved verbatim — the fake-`kk`
integration test (`apps/cli/tests/kk-daily-ai-voice-workflow.test.ts`) still drives the deterministic
half of the chain — `prepare → collect → plan → quality-control-content → article → script →
wrap-docs → generate`, `publish_enabled=false` — end to end and asserts the call order, the env
channels and every artifact path it reaches; the publish/locale tail is not covered by that run —
the runner suite's per-verb tests cover `classify` / `publish-prep` / `publish-partial` /
`translate-en`, and `show-notes` (task 0137), while the remaining tail verbs
(`publish-surfdash`, `publish-podcast`, `run-report`) stay tracked from task 0137.
