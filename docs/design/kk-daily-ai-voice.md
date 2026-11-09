# kk-daily-ai-voice Workflow Design

## 1. Purpose

`kk-daily-ai-voice` (`plugins/kk/workflows/kk-daily-ai-voice.yaml`) is the daily AI news end-to-end pipeline (F61 destination, extended 2026-09-03): collect (aihot-ingest + last30days-ingest + horizon-ingest) → blended core-facts (fan-in + core-facts-gen) → episode plan (episode-plan-gen: score/dedup/select + plan-translate agent step, 2026-09-05) → article (content-gen) + cover (F614 0163: lead-item subject brief agent.run → pinned daily-news presets via `kk stage daily-cover`) + script-write (agent-authored per-item script plan, F613 0162: guarded by `script_write_enabled`+zh, `onError: continue`) + spoken broadcast script (dailynews-gen, plan-aware since F613) + audio (voice driver selected by the `vdriver` var: `gemini` → gemini-tts default (2026-09-29 operator override), `voicebox` → voice-gen, `ominivoice` → omni-voice-gen, `voxcpm` → voxcpm-tts opt-in (ADR-036; provisional 5.6 字/秒 estimate)) → publish fan-out (surfdash-pub + podcast-pub, article as episode show notes) → xhs draft (E8: lead-item card plan agent.run → pinned `xhs-card` × `xhs-knowledge` presets via `kk stage daily-xhs-render` → `kk stage daily-publish-xhs`). Publish runs only with `publish_enabled: "true"`; cover only with `cover_enabled: "true"`; in-place plan translation only with `plan_translate_enabled: "true"`; the script-write plan authoring only with `script_write_enabled: "true"` and `language: "zh"` (and only when neither today's plan nor VoiceScript exists — resume-safe); the XHS target only with `xhs_enabled: "true"` — **on by default** since 2026-09-29 (operator decision; daily runs fill the creator draft box — 2026-09-28 had it off after an XHS warning about automated login/publish activity, see §7) — and a live post additionally needs the launch-time `xhs_live` switch, ADR-022); the WeChat MP target only with `wechat_enabled: "true"` (2026-09-29, §8 — draft-only, same launch-time rail via `wechat_live`). Article/script/show notes all consume `${run_date}_03_plan_plan.json` (selection capped by `plan_max_items`, default `20`). `last30days_enabled: "false"` (default) routes `fetch` directly to Horizon and stubs `10-ingest/last30days-docs.json` as `[]` for fan-in (the `prepare`-written executor configs keep fixed names — see section 4). Step outputs follow the naming convention `{run_date}_{NN}_{step_name}_{artifact}.{ext}` (`${run_date}` = local `YYYYMMDD`, captured once in `prepare`; `NN` = 1-based ordinal of the owning state) and are skipped when the step's output file already exists — fast re-runs never regenerate completed steps or mix days' content. Voice synthesis waits scale with segment length (`VOICEBOX_TIMEOUT_MS` base + 60s/100 chars) so long qwen segments don't trip the fixed deadline.

## 2. Architecture & Data Flow

```mermaid
flowchart TD
    A[prepare] -->|workspace + run_date + source configs| B[fetch: aihot-ingest]
    B -->|last30days_enabled| C[ingest-last30days]
    B -->|last30days disabled| D[ingest-horizon]
    C --> D[ingest-horizon]
    D -->|Doc[] x3| E[blend-facts: fan-in + core-facts-gen]
    E -->|10-ingest/{run_date}_02_collect_blended.json + 20-facts/{run_date}_02_collect_core-facts.md| P0[plan: episode-plan-gen]
    P0 -->|plan_translate_enabled| P1[plan-translate: agent.run in-place zh]
    P0 -->|translate disabled| F
    P1 -->|21-plan/plan.json| F[article: content-gen]
    F -->|cover_enabled| G[cover: subject-brief agent.run -> kk stage daily-cover]
    F -->|cover disabled| G2[script-write]
    G -->|23-cover/{run_date}_07_cover_cover.png| G2
    G2 -->|script_write_enabled+zh, no plan/YAML yet| SW[script-write: daily-script-style + agent.run, onError continue]
    G2 -->|disabled/non-zh/cached| H
    SW -->|24-script/{run_date}_08_script-write_plan.json| H[script: dailynews-gen]
    H -->|24-script/{run_date}_08_script_content.json & {run_date}_08_script_voicescript.yaml| SG{publish_enabled?}
    SG -->|true| SR[safety-review: daily-safety-prep + kk:content-safety agent.run]
    SR --> SJ[safety-judge: kk:content-judge compliance agent.run + daily-safety-gate]
    SJ -->|pass + skip_review| K
    SJ -->|pass, or escalate| J
    SJ -->|revise (budget left)| SV[safety-revise: kk:content-safety detect+revise agent.run + daily-safety-revise]
    SV -->|edited drafts re-reviewed| SR
    SJ -->|exclude (admission-only residue)| K
    SJ -->|block / no status| L
    SG -->|false| I{skip_review?}
    I -->|false| J[review: hitl.confirm]
    I -->|true| K[wrap-docs]
    J -->|Approved| K[wrap-docs: VoiceScript -> Doc]
    J -->|Rejected| L[failed]
    K -->|30-audio/{run_date}_10_wrap-docs_docs.json| M[generate: voice generator var]
    M -->|30-audio/content.wav + content.mp3| N[quality-control]
    N -->|publish_enabled| O[publish-prep: article + audio seam]
    O --> P1[publish-surfdash -> show-notes -> publish-podcast]
    P1 -->|xhs_enabled| XW[xhs-write: lead-item card plan agent.run -> kk stage daily-xhs-render]
    XW --> XP[xhs-publish: kk stage daily-publish-xhs, draft unless xhs_live]
    XP --> WC[wechat-publish: kk stage daily-publish-wechat, draft unless wechat_live]
    WC --> P[publish: classify full|partial|none]
    P1 -->|xhs disabled| WC
    P --> Q[done]
    N -->|publish disabled| Q
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
- The `prepare`-written executor configs (`10-ingest/source.json`, `10-ingest/last30days.json`, `10-ingest/horizon.json`, `10-ingest/last30days-docs.json`) — written before `${vars.run_date}` is captured.
- Plugin-fixed intermediates: `23-cover/content.json` + the `content-daily-news-cover-01.<ext>` artifact it records (image-gen names them after the format preset; `daily-cover-normalize` reads the path from the manifest, F614 — the pre-F614 `content-cover-01.{png,jpg}` names are cleaned up as stale), `25-xhs/content.json` + `25-xhs/cards.json` + `25-xhs/cards/card-NN.*` (the card series the publisher and the render stage read back by fixed stem, E8 — see §7), `30-audio/content.wav` / `content.mp3` (voice generator siblings of the `--out` file).

Convention-named artifacts:
- `${run_date}_02_collect_blended.json`: Fan-in merged `Doc[]`; `${run_date}_02_collect_content.json` / `${run_date}_02_collect_core-facts.md`: blended core-facts Content + markdown.
- `${run_date}_03_plan_content.json` / `${run_date}_03_plan_plan.json`: Episode plan Content and its extracted `Doc[]` — scored, deduped, capped at `plan_max_items` (cached short-circuit when the plan `Doc[]` file exists; the `plan-translate` agent step rewrites it in place).
- `${run_date}_04_quality-control-content_annotated.json` / `${run_date}_04_quality-control-content_candidates.json`: QC filter input/output; `episode-plan-gen` derives `${run_date}_04_quality-control-content_candidates.rejected.json` from the candidates `--out` path (the `run-report` state's `NEWS_REPORT_REJECTED_FILE` points at the same file). Task 0189 R2: the stage then applies the topic-boundary admission pass (rules from `plugins/kk/scripts/topic-boundary.json`; since 2026-10-22 the single `prc-leadership` rule — PRC 现任及历任国家最高领导人 — replaced the five broad 0189 rules; date-conflict = `publishedAt` after the run date) — exclusions (id/rule/matched keyword) land in `${run_date}_04_quality-control-content_exclusions.json` and the candidates are rewritten in place with only kept docs.
- `${run_date}_06_article_content.json` / `${run_date}_06_article_article.md`: Generated article Content and markdown (skipped when the day's `.md` exists).
- `${run_date}_07_cover-brief.json` / `${run_date}_07_cover_image-gen-in.json`: the cover brief the lead-item agent.run writes (single `subject` field; missing/invalid brief falls back to the pinned format's default subject, F614) and the pinned image-gen envelope the `daily-cover` stage derives from it (+ `fallback` when the `cover_fallback` var is set — `""` the default keeps the provider pin, `true` retries down AUTO_ORDER, a comma list pins the provider order; D6 0166). MiniMax retries explicit transient failures on the same provider/model at most three times under one request deadline (0339); this does not enable cross-provider fallback or retry permanent policy/auth/quota/parameter errors.
- `${run_date}_07_cover_cover.png`: Cover image (cover state skipped when the day's file exists).
- `${run_date}_08_script-write_style.md` / `${run_date}_08_script-write_plan.json`: the style contract snapshot (idempotent copy of the `kk:news-editorial` skill's `references/style-contract.zh.md`; the whole skill is also snapshotted to `20-editorial/news-editorial/`, ADR-045) and the agent-authored per-item plan (F613 0162). `kk stage daily-script-check` dry-runs the validator and writes `${run_date}_08_script-write_errors.json` on a missing or rejected plan, which triggers one `script-write-fix` pass (0345 R4); a plan still rejected after that falls back to templates. The script step also passes `DAILYNEWS_DATE=${vars.run_date}` (task 0189): the broadcast greeting carries the episode's run date even on a backfilled/retried run.
- `${run_date}_08_script_content.json` / `${run_date}_08_script_voicescript.yaml`: Generator `Content` with VoiceScript YAML body and the human-readable VoiceScript (skipped when the day's `.yaml` exists; Content.metadata stamps `scriptSource`/`scriptPlanErrors`, surfaced by run-report's `脚本来源` line — see `docs/design/daily-voice-script-plan.md`).
- `${run_date}_09_safety-review_request.json` / `${run_date}_09_safety-review_report.json` / `${run_date}_09_safety-judge_verdict.json` / `${run_date}_09_safety-judge_status.txt` / `${run_date}_09_safety-judge_stamp.json` (in `24-script/`, task 0189 R10; revise loop 20261005): the content-safety verdict gate, run only when `publish_enabled`. `daily-safety-prep` digests the article Content + VoiceScript (sha256), drops every artifact of an earlier review, and writes the request (`digest`, `platforms` from the `safety_platforms` var). The `kk:content-safety` agent.run writes the report; the `kk:content-judge` (`compliance` rubric) agent.run writes the verdict. `daily-safety-gate` projects both into `safety_status`, which **routes around a problem instead of stopping the run** (2026-10-05 operator decision) —
  `revise`: non-PASS and the `.safety-revise-count` budget (`safety_max_revise`, default 2) is not spent — the `safety-revise` state runs `kk:content-safety` in `detect+revise` mode, the agent applies the revision proposals to the article + VoiceScript, `daily-safety-revise` re-validates both and spends one unit, and `safety-review` re-opens on the edited bytes (fresh request/digest by construction);
  `exclude`: the budget is spent and the residue is **admission-only** (every verdict `fail` is `jurisdictional-rules`, and every BLOCKed platform's findings are category 1–2 — the CN 资质口径/播报形态 class) — those platforms are named in the stamp's `excludedPlatforms`, the per-target stages skip them (`daily-publish-wechat` refuses a `wechatmp` exclusion), and every other target publishes; since 20261007 it is also the landing for a clean pass whose `RISK` findings all carry `gap`/`note`/`fix` dispositions — published at recorded risk with an empty `excludedPlatforms`;
  `escalate`: a finding marked `disposition: "escalate"` on an otherwise clean pass (routes to `review` even when `skip_review` is `"true"`; 20261007 — a legacy report with no `disposition` field anywhere keeps the old rule, any `RISK` decision or `escalate: true` pauses); a disposition-contract report must also carry report-level `confidence: HIGH\|MEDIUM\|LOW` — the reviewer's self-graded certainty, mirroring the verdict hardening; missing or out-of-enum blocks (20261007 amendment, ADR-033 R5);
  `pass`: explicit PASS on the unchanged drafts with no BLOCK and no `RISK` finding at all;
  `block`: draft integrity (a BLOCKed platform carrying a category-3 PII finding — the same bytes ship to every target — or a verdict `fail` outside the admission criteria: prohibited claims / disclosure / data-handling), a missing/unparsable/malformed report or verdict, a verdict or confidence outside `PASS|FAIL|NEEDS_REVISION` × `HIGH|MEDIUM|LOW`, or drafts whose digest changed since the request — the drafts are quarantined and never publish.
  The stamp (written for pass/escalate/exclude) carries `{digest, status, excludedPlatforms}`; `daily-publish-prep` refuses to package when the stamp is absent, non-publishing, or the digest differs from the current drafts, so an edit after PASS (including a HITL edit at `review`) or an older draft never publishes, and the merge carries `metadata.safetyExcludedPlatforms` forward. The program holds no platform policy: rules live in the skill's `references/platforms/*.md`.
- `${run_date}_10_wrap-docs_docs.json`: VoiceScript wrapped as a single `Doc` for the voice driver selected by `vdriver` (default `voicebox` → voice-gen).
- `${run_date}_11_generate_content.json`: Synthesized audio `Content` metadata (generate state skipped when the file exists and `metadata.qc.passed` is true). Carries `metadata.mp3Path` since 0171 — `transcode_mp3` defaults to `"true"` and rides the `VOICE_GEN_MP3` env channel.
- `${run_date}_13_publish-prep_content.json`: Article + audio merged for the publish seam. 0171: `publish-prep` publishes the MP3 (`metadata.mp3Path ?? audioPath`), fails loud when that file is not `.mp3` (naming `transcode_mp3`), and stamps the enclosure's ID3v2.3 tags in place (§6).
- `${run_date}_14_publish-surfdash_result.json` / `${run_date}_16_publish-podcast_result.json`: per-target fan-out results; `${run_date}_15_show-notes_show-notes.md`: rendered show notes.
- `${run_date}_17_publish_result.json` / `${run_date}_17_publish_publish-status.txt`: merged publish result and the `full|partial|none` routing flag (read by the publish/locales transition guards).
- `25-xhs/cards.json` / `25-xhs/content.json` / `25-xhs/cards/card-NN.{in.json,json,prompt.txt}`: the XHS card series (E8) — the ordered card manifest (role, source point, layout, prompt + image path per card), the packaged `Content` whose `metadata.images` are the card artifacts **in card order** and whose `metadata.publishStatus` is `draft`, and per card the pinned image-gen envelope, the rendered `Content`, and the exact composed prompt (the retry path). The stage fixes the `card-NN` stem, so each artifact lands as `25-xhs/cards/card-NN-xhs-card-01.<ext>` — the provider picks the extension, so the stage reads the recorded path back rather than guessing it.
- `${run_date}_19_publish-xhs_content.json` / `${run_date}_19_publish-xhs_result.json`: the publish payload (`metadata.publishStatus` resolved from the `xhs_live` var) and the `xhs-pub` Result. Deliberately **not** read by `daily-publish-classify` — XHS is an independent, non-blocking target and contributes no `publish_status` target (see §7).
- `${run_date}_19_run-report_report.json` / `${run_date}_19_run-report_report.md` (work-dir root) plus inputs `${run_date}_19_run-report_episode-plan.json` and the shared rejected audit in `21-plan/`. The report also carries the `## 发布完整性` table read from `${run_date}_17_publish_completeness.json` (`NEWS_REPORT_COMPLETENESS_FILE`, 20261016) — the independent channels' state belongs in the artifact the operator reads, not only in the completeness sidecar.
- `${run_date}_20_translate-en_*` / `${run_date}_22_translate-ja_*` / `${run_date}_24_translate-sync_*`: locale scaffolds, post-path markers, and sync results in `31-publish/`.

The workflow passes only the generic executor flags (`--in`, `--out`, optional `--plugins-path`).

**Publish completeness.** The independent channels (en/ja locales, XHS, WeChat) and the surfdash CMS
re-sync never enter `publish_status`, so a tail that skips them was indistinguishable from a complete
run in every artifact the pipeline wrote — that is how 20261002 shipped zh-only surfdash with no XHS
and no WeChat draft, with a `full` status file and no warning anywhere. The terminal stage
`kk stage daily-publish-completeness <work_dir> <run_date>` (run in `run-report` onEnter, after translate
and patch-surfdash have finished) therefore writes `${run_date}_17_publish_completeness.json` (one row per channel:
`done | failed | skipped | not-run` plus the recorded reason) and prints a
`WARNING: publish completeness — …` line naming the gap (the `none` path has no snapshot by design, 0220);
`news-report-gen` renders the same rows as the report's `## 发布完整性` table (20261016), so the missing
draft is visible without reading the sidecar;
`daily-patch-surfdash` leaves a `${run_date}_23_patch-surfdash_emdash-resync.txt` marker when it skipped
the CMS re-sync because no `plugins_path` was passed. These rows exist to catch a hand-driven tail: the
workflow engine cannot start mid-graph, so the publish half of a run whose launch had `publish_enabled=false`
is sometimes driven stage by stage, and every channel the operator's chain omits is invisible otherwise.
When running a hand-driven publish tail, always end the chain with `kk stage daily-publish-completeness`.

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

## 6. Enclosure format & ID3 (0171)

Apple Podcasts validates the enclosure and shows its ID3 tags, so the daily run publishes an MP3
carrying tags — never the WAV render (`ffmpeg -c copy`, no re-encode):

- `transcode_mp3` defaults to `"true"`; the `generate` state forwards it to the voice driver as
  `VOICE_GEN_MP3`, so the voice `Content` records `metadata.mp3Path` alongside the WAV
  `metadata.audioPath`.
- `kk stage daily-publish-prep <work_dir> <run_date> [artist] [album]` rejects a resolved audio
  file that is not `.mp3` (exit 1, message names `transcode_mp3`), then stamps ID3v2.3 `title`
  (article `title`), `artist`, `album` and `date` (the digits-only `run_date` as `YYYY-MM-DD`) into
  `<audio>.id3.tmp.mp3` and renames it over the original; an ffmpeg failure fails the stage and
  leaves the episode untouched. The stage runs after `intro-music` because that state re-transcodes
  the MP3 and would strip tags stamped earlier.
- The two tag vars are `podcast_artist` (default `Robin Min`) and `podcast_album` (default
  `咸话咸说`); an empty value omits that tag rather than failing.
- `kk stage daily-intro` joins the intro to the raw `audioPath` when that file exists,
  falling back to `mp3Path` only when no raw render is available. It writes a distinct `<stem>.intro.wav`
  sibling, updates `audioPath`, preserves the source render, and re-transcodes `mp3Path`
  when present; this prevents ffmpeg from receiving the same path as input and output
  (0176).

## 7. XHS card target (E8)

The `xhs-write` → `xhs-publish` pair adds a Xiaohongshu image-card draft to every daily run. It
follows the cover's split (F614): the agent authors **copy only**, the stage owns the look.

- `xhs-write` — `agent.run` (`role: scribe`, `onError: continue`) reads the same lead plan item the
  cover brief reads and writes `25-xhs/${run_date}_18_xhs_plan.json`: `title`, `body` (Chinese note +
  hashtags), and exactly `${vars.xhs_cards}` ordered cards, each with `role`, `copy`, `points`,
  `layout`, `subject` and the `sourcePoint` it is grounded in. `kk stage daily-xhs-render` then
  validates that plan (count, cover-first, per-field non-empty, char caps) and renders one card per
  `kk executor run image-gen` call, sequentially, through the pinned `xhs-card` format × the
  `xhs_style` preset with the `xhs_provider`/`xhs_model` pin. The `xhs_fallback` var (0219, shipped
  `"true"`; `""` restores strict fail-fast) threads the cover stage's vendor-fallback opt-in into
  the render envelopes, so one transient provider timeout no longer loses the XHS channel; a card
  whose render still fails names itself — `xhs render: card <NN> failed (image-gen exit <S>); cards
  before it are kept — re-run daily-xhs-render to resume from card <NN>` — and earlier cards stay
  on disk, never re-billed. It packages `cards.json` + `content.json`
  (`metadata.publishStatus: draft`).
- `xhs-publish` — `kk stage daily-publish-xhs` resolves `draft` (default) or `public` (`xhs_live`),
  writes the payload, and runs `kk executor run xhs-pub` (its default `script` driver — ADR-024).
- **Draft by default.** A live post requires an explicit launch-time `xhs_live=true`; an unattended
  run never publishes publicly on its own (ADR-022).
- **Independent and non-blocking.** The chain sits between `publish-podcast` and the classification
  state, so XHS can never alter `publish_status` — surfdash + podcast remain the episode's
  publication contract, and a missing/expired XHS session or a changed creator console logs a loud
  failure while the run continues. The `xhs-publish` stage is `soft` on the plugin call for the same
  reason, and caches on the **requested** status so a cached draft can never satisfy a later live
  request.
- **Resume-safe spend.** A card whose recorded artifact is still on disk is reused, not re-rendered
  (and not re-billed); the first failed card stops the spend and leaves later cards pending for a
  resume run. `xhs_cards` is capped at 10 and refused before any plan is read.
- **Text-free card prompts (0181).** Card copy is typeset by image-gen's composer; the provider
  renders only the text-free illustration (`daily-xhs-render` sends no `language` var, and the
  guard refuses any Han text or card copy in the prompt pre-spend). A weak card is regenerated
  from an edited prompt; bitmap text repair is out of scope.
- **On by default (`xhs_enabled: "true"` since 2026-09-29), draft-only, and guarded.** 2026-09-28:
  the operator received an XHS warning about automated login/publish activity, and the target was
  flipped off. 2026-09-29 operator decision: back **on** as the best-practice default so daily
  runs fill the creator draft box — the guard rails stay: `xhs_live: "false"` keeps every
  scheduled run draft-only (a live post is a launch-time, by-hand opt-in), and `xhs-pub` itself
  enforces ADR-025. `xhs-pub` always launches a
  **headed** browser and drives the creator console (`goto` the publish URL, upload, type, click
  暂存离开), so the platform-flag risk the 2026-09-28 warning named is accepted, not eliminated.
  Independently of the workflow, `xhs-pub` itself now enforces ADR-025: a **headless session
  preflight** before any headed visit (so a missing/expired session is a fast refusal, not a 120 s
  headed login wait) and a **2h cap** of one publish cycle plus one session check. A capped or
  sessionless publish returns `ok: false`, which this stage treats as non-blocking.

## 8. WeChat MP draft target (2026-09-29, ADR-026)

The `wechat-publish` state appends the daily article to the WeChat MP console **draft box** — the
operator's editing surface, not the public feed. The article is already written by `article`
(`22-article/${run_date}_06_article_content.json`), so this target has no authoring step: the
stage re-packages that Content with `metadata.publishStatus` (`draft` default, `public` only when
`wechat_live: "true"` at launch — the ADR-022 rail) into
`31-publish/${run_date}_20_publish-wechat_content.json` and runs `kk executor run wechatmp-pub`.

- **Console browser transport** (`wechatmp-pub`, ADR-026) — persistent profile at
  `~/.config/kk/browser-profiles/wechatmp` (`WECHATMP_PROFILE_DIR` overrides). A headless session
  preflight (readiness = the console landing on `/cgi-bin/home`) refuses a sessionless run fast
  with `ok:false` — an unattended run can never open a headed QR-code wall. The headed flow then
  goes: MP home → 图文 menu → `#title` / `#author` / `.ProseMirror` (innerHTML paste of
  `markdownToWechatHtml(body)` + an `input` event) → summary `#js_description` → save draft (or
  发表 + confirm when live). A save click without an observed `.weui-desktop-toast` within 15 s is
  a loud failure — the plugin never reports success it did not see.
- **One-time login** — `bun plugins/publishings/wechatmp-pub/src/profile-check.ts login|check`
  (login opens the headed console for the QR scan; `check` verifies headlessly, read-only).
- **Draft by default; non-blocking; independent.** Same terms as the XHS target (§7): the outcome
  never enters `publish_status`, the stage is `soft` on the plugin call, and caching is per
  **requested** status so a cached draft can never satisfy a later `wechat_live=true` re-run.
- **No automation-guard (conscious).** WeChat has issued no automated-activity warning; the
  preflight + draft default are the guard. If a warning ever arrives, port the ADR-025 automation cap.
- Workflow vars: `wechat_enabled: "true"` (on by default, 2026-09-29 operator decision),
  `wechat_live: "false"`.
