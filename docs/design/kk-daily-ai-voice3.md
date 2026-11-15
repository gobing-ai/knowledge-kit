# kk-daily-ai-voice3 — split generate / publish, channel matrix, dummy-first rollout

> **Status:** SHIPPED as designed (ADR-043; tasks 0321–0327 closed 2026-10-22/23 — T-a…T-e, publish3 and voice3).
> voice2 (`kk-daily-ai-voice2.yaml`) is untouched by the batch and remains the installed daily path until
> the operator installs the two publish3 schedules (§8 step 3); nothing in this design auto-flips that.
>
> **Superseded (0369 → retired 0372):** the publish3 DAG is replaced by the nine-node
> `plugins/kk/workflows/kk-publish.yaml` (G61, task 0366) and the voice3 DAG by
> `plugins/kk/workflows/kk-news-generate.yaml`. The scheduled lines are now
> `kk news generate --publish` and `kk news publish --window <w> --unattended`; the retired launchers
> and workflows were deleted in 0372 (`docs/design/content-pipeline-consolidation.md` owns the
> mapping). Both pairs produce the same `4-publish/` outcome per window.

## 1. Why a voice3

voice2 works but has three structural costs, all visible in its YAML:

| Symptom in voice2 | Root cause |
| --- | --- |
| 15 nodes repeat the same `kk store pool-count … --min 1` guard | content gating and publishing live in one DAG; every publish leaf must re-prove "there is an episode" because a done+skipped mix proceeds |
| ~10 vars per channel family (`xhs_enabled`, `xhs_live`, `xhs_cards`, `wechat_enabled`, `wechat_live`, `wechat_collection`, …) and a 25-flag `--setting` list in `prepare` | the channel matrix is encoded as workflow vars; adding a channel edits the shipped YAML in 4 places |
| A failed browser publish (wechat 2026-10-12, xhs 2026-10-21) can only be retried by re-running a 40 min–2 h generation, or by hand | no re-entry seam between "episode exists" and "episode is distributed" |
| `session-preflight` hard-codes `wechatmp-pub xhs-pub` | the probe list is not derived from the enabled channels |

## 2. Recommendation: two workflows joined by a frozen bundle

```
kk-daily-ai-voice3 (generate, kind: dag, fail-fast)          kk-daily-publish3 (publish, kind: dag, best-effort per channel)
  select → qc/translate → drafts → safety → review            plan targets (preset × bundle) → preflight probes
  → audio ∥ images → quality → FREEZE bundle.json  ───────►   T0 owned: surfdash → resolve links → podcast   (publication contract)
  → (auto_publish=true) nested `spur workflow run publish3`    T1 audio:  wechatmp 播客 · xhs 发播客
                                                               T2 long:   wechatmp 文章 · xhs 写长文 · x article · weibo 头条 · linkedin*
                                                               T3 social: xhs 上传图文 · 视频号图文* · x post · weibo post · threads · facebook* · instagram*
                                                               classify → mark-published → publish report → ledger
```
`*` = no plugin yet (§7).

### Trade-off

| | Split (recommended) | Single DAG (voice2 shape) |
| --- | --- | --- |
| Re-run a failed channel | `spur workflow run publish3 --vars '{"bundle":"…"}'`, seconds, no TTS | re-run generation, or a `startable` re-entry node (not verified for `kind: dag` in the installed engine) |
| Publish timing | generate 04:30, publish at audience peak or chained | same run, same moment |
| Failure semantics | generate = fail-fast; publish = per-target receipts, exit 0 unless the bundle is invalid | one DAG mixes both; needs `onError: continue` + soft stages everywhere |
| Testability | publish3 runs against a fixture bundle with `mode: dummy` targets in CI | needs a full generation to reach any publish node |
| Live approval | one `pause` node in publish3 only when a target is `live` (the retired ITC publish-tail pattern) | review pause mixes content approval and send approval |
| Cost | a versioned bundle contract; two runs to trace (linked by `parentRunId`) | none |

The cost is real but already paid once: the retired `kk-itc` DAG used exactly this seam
(`4-publish/publish-plan.json`, `itc-check-targets`, `itc-send-targets --retry`, frozen
`parentRunId`, "never resend an `uncertain` live receipt"). voice3 should **reuse and generalize that
machinery, not invent a second one** (task T-a, §10).

**Default operation stays one entry**: generate's last node runs publish3 nested when
`auto_publish=true` (same `env -u SPUR_WORKFLOW_RUN_ACTIVE -u SPUR_EXPECTED_DEFINITION_DIGEST`
boundary the safety node uses). The cron schedule does not change.

## 3. Where channel switches live

Three layers, each owning one question. Nothing channel-specific stays in workflow vars.

| Layer | Owns | Example |
| --- | --- | --- |
| **Publish preset** `plugins/kk/publish-presets/daily-ai-voice.json` (shipped) overridden by `.kk/publish-presets/daily-ai-voice.json` (project) — the resolver already exists (`apps/cli/src/itc-plan.ts:186`) | WHICH channels, operation, asset variant, tier, `mode: off \| dummy \| draft` | see below |
| **`~/.config/kk/config.yaml` → `workflows.kk-daily-ai-voice3`** — the block shape already exists for `kk-itc` (`publish_preset: itc-main`) | which preset this operator uses; operator-stable knobs (vdriver, episode minutes) | `publish_preset: daily-ai-voice` |
| **Launch vars** (`--vars`) | one-off overrides only: `channels` (comma filter), `live_channels` (ADR-022: live is launch-only, never in a file) | `{"channels":"surfdash-pub,podcast-pub","live_channels":"xhs-pub"}` |

```json
{
  "schemaVersion": 1,
  "name": "daily-ai-voice",
  "targets": [
    { "plugin": "surfdash-pub",  "operation": "post",    "variant": "article",     "tier": 0, "mode": "draft", "required": true },
    { "plugin": "podcast-pub",   "operation": "episode", "variant": "episode",     "tier": 0, "mode": "draft", "required": true },
    { "plugin": "wechatmp-pub",  "operation": "播客",    "variant": "episode",     "tier": 1, "mode": "dummy" },
    { "plugin": "xhs-pub",       "operation": "发播客",  "variant": "episode",     "tier": 1, "mode": "dummy" },
    { "plugin": "wechatmp-pub",  "operation": "文章",    "variant": "article",     "tier": 2, "mode": "draft", "options": { "collection": "每日AI资讯" } },
    { "plugin": "xhs-pub",       "operation": "写长文",  "variant": "article",     "tier": 2, "mode": "dummy" },
    { "plugin": "x-pub",         "operation": "article", "variant": "article",     "tier": 2, "mode": "dummy" },
    { "plugin": "weibo-pub",     "operation": "article", "variant": "article",     "tier": 2, "mode": "dummy" },
    { "plugin": "xhs-pub",       "operation": "上传图文", "variant": "cards",       "tier": 3, "mode": "off" },
    { "plugin": "x-pub",         "operation": "post",    "variant": "social:x",    "tier": 3, "mode": "dummy" },
    { "plugin": "weibo-pub",     "operation": "post",    "variant": "social:weibo","tier": 3, "mode": "dummy" },
    { "plugin": "threads-pub",   "operation": "post",    "variant": "social:threads","tier": 3, "mode": "dummy" }
  ]
}
```

Why a preset file and not config.yaml alone: the matrix is a reviewable, diffable registry the repo
can ship a default for, `plugin`+`operation` pairs are validated against each plugin's declared
operations at plan time, and the project-over-package precedence already avoids the
ADR-042 "stale override silently wins" trap (the plan records `presetName` + `presetDigest`).
config.yaml only *selects* it.

Every target also carries a `window` (§5a): `after-generate`, `cn-peak` or `overseas-rss`. A
target that has no draft mode (x `post`, threads, …) may not use `after-generate` unless it is live.

`mode` semantics: `off` = not planned; `dummy` = planned, payload built and schema-validated, a
synthetic receipt `{ status: "succeeded", effect: "none", dummy: true }` written, **no plugin process
spawned**; `draft` = real plugin, draft switch forced (ADR-022); `live` = only reachable through
`live_channels`, and the plan then requires the send-confirm pause.

## 4. Generate workflow (voice3) — optimized from the proposed list

Changes against the proposed flow are marked ▲.

| Phase | Nodes (one `kk` command or one `agent.run` each) | Output in the bundle |
| --- | --- | --- |
| 0 prepare | `executor-probe` (one real prompt; a dead executor fails here, ADR-053 §5 — the sole root node) · `preflight` (stages exist in the installed runner) · `prepare` · read work_dir/run_date | — |
| 1 选题 | `extract` → `plan` → `qc-content` → `select` (ledger at QC, unchanged) | `plan.json` |
| 2 选题精选 (curate) ▲ | `script-style` (snapshot skill) → `curate` (editorial select + title dedup) → `curate-check` → `curate-fix` (if errors) → `curate-final` (final validation / fallback) | `21-plan/plan.json`, `curate_excluded.json` |
| 3 初稿与渲染 ▲ | `script-write` (master plan with speech, cover brief, card plan, social) → `script-check` → `script-write-fix` (if errors) → `script` (dailynews-gen) → `editorial-render` (deterministic article body, cover brief, cards, social) · `show-notes` · advisory `editorial-judge` (news-balance rubric) | `24-script/script-write_plan.json`, `22-article/*`, `23-cover/*`, `25-xhs/*`, `26-social/*` |
| 3b 润色 ▲ | **not a node per draft.** Polish rules (taste-unslop, copy discipline) go into each authoring prompt; the gate is the existing content-safety state machine, extended to read every draft, not only the script | `safety/verdict.json` |
| 3c 审核 ▲ | `review` pause (content approval only — send approval moves to publish3) | — |
| 4 语音 | `wrap-docs` (条目切分) → `generate` + fallback chain (分条录音, ADR-034 one request per section) → `intro` → `duration` → `voice-audit` (组装/校准) | `episode.mp3`, duration |
| 5 图片 ▲ parallel with 4 | `cover` → `cover-normalize` · `cards-render` | `cover.png`, `cards/*.png` |
| 6 质检 | `quality` (audio QC + asset completeness) | `quality.json` |
| 7 冻结 ▲ | `bundle` — writes `bundle.json` (schemaVersion, runId, every asset path + sha256, episode metadata, link placeholders) and verifies it | `bundle.json` |
| 8 | `run-report` (generation half) · `publish` (nested publish3 when `auto_publish=true`) · `ledger` | — |

Notes:
- ▲ **Safety + operator review were missing from the proposed list** and must stay: they are the
  only gate between an LLM draft and an external post.
- ▲ Images move after safety (cards copy can be revised by the safety loop); the cover brief can
  stay early because it only reads the plan.
- ▲ "生成报告" splits into a generation report (end of voice3) and a publish report (end of
  publish3); `kk daily run-report` merges both when both exist.
- The `pool-count` guard collapses to **one** node condition chain: everything after `qc-content`
  depends on `select`, and the publish leaves no longer exist in this DAG.

## 5. Publish workflow (publish3)

| Node | Action |
| --- | --- |
| `plan` | `kk stage run publish-matrix-plan <workDir> --bundle … --preset … --window … --channels … --live-channels …` → `4-publish/plan.<window>.json` (targets × variant payloads, digests). Refuses an unknown plugin/operation pair, a missing asset, or a `live` without a launch var. |
| `check` | readiness probes (`kk plugin check`) for the planned **non-dummy** browser targets only — replaces the hard-coded `session-preflight`; warn-only |
| `send-confirm` | `pause`, condition: plan has any live target |
| `t0-owned` | send tier 0 (surfdash → podcast, serial) — **the only blocking tier**; fails the run if a `required` target fails |
| `resolve-links` | fill `{{article_url}}`/`{{podcast_url}}` in show notes and social copy from T0 receipts (podcast show-notes render moves here, after surfdash — same ordering voice2 has today) |
| `t1-audio` · `t2-long` | send tiers (exit 0 on per-target failure; receipts carry the failure) |
| `t3-social` | after `resolve-links` (needs public URLs) |
| `retry` | one retry of `effect: none` failures across tiers (itc rule: never resend an uncertain live receipt) |
| `classify` → `mark-published` → `report` → `ledger` | publish status = T0 only (unchanged contract); other tiers reported per target |

### 5a. Publish windows (D4)

publish3 is launched three times a day, each launch with `--vars '{"window":"…"}'`; `plan` keeps
only the targets whose preset `window` matches. Receipts are per target and keyed by bundle, so a
window never re-sends what another window already delivered.

| Window | Launch | Targets | Rule |
| --- | --- | --- | --- |
| `after-generate` | chained: voice3's last node, nested | T0 owned (surfdash, podcast) + every **draft-capable** domestic target (公众号 文章/播客, 小红书 暂存, 微博 头条 draft, …) | drafts only (ADR-022). Promotion of a draft to live is the future approval console's job, not this run's |
| `cn-peak` | scheduled, **09:00 Asia/Shanghai** | domestic targets with **no draft mode** | live by construction, so the schedule entry itself carries `live_channels` (operator-installed launch var = ADR-022 consent) |
| `overseas-rss` | scheduled, **07:00 America/Los_Angeles** | X / Threads / LinkedIn / Facebook / Instagram (zh copy, D3) | runs only after the RSS gate below passes |

Time zones: the schedules render as launchd plists, whose calendar intervals follow the machine's
local zone. 09:00 Beijing is 18:00 PDT today but 17:00 PST after DST ends (2026-11-01), so the
`cn-peak` entry fires at 17:00 local and its first node `wait-until 09:00 Asia/Shanghai` sleeps the
remainder (≤ 1 h). The overseas entry is defined in local time and needs no adjustment.

**RSS gate (`overseas-rss` only).** First node: fetch `https://podcast.salty.vip/rss/` and pass
when the feed contains today's episode — matched on the podcast-pub receipt's item `guid` when the
bundle's T0 receipt exists, else on the `每日AI乱炖 · <YYYY-MM-DD>` title. Probe on 2026-10-22: the
feed's newest items are `· 2026-10-21` (pubDate 22:22 GMT = 15:22 PDT) and `· 2026-10-20` (13:43 PDT).
Both episodes landed after 07:00 PDT of their run date (the review pause sits before publish), so a
same-date 07:00 gate would have missed on both observed days. The gate therefore checks the
*previous* run date unless generation + review finish earlier — to confirm at implementation.

On a gate miss the run cancels all overseas targets and starts `diagnose`: an `agent.run` that
reads the day's ledger row, the voice3/publish3 traces and the bundle/receipts, classifies the miss
(`no-run` · `generation-failed@<node>` · `no-content` · `t0-failed` · `rss-lag`) and writes
`incident.json` + `incident.md`. Automatic repair is limited to the one safe action: re-sending T0
targets whose receipt is `effect: none` (same rule as `--retry`). Every other class is reported, not
fixed — re-running a 1–2 h generation unattended is the operator's (later: the console's) call.

### 5b. Hooks for the later approval / monitoring console (out of scope now)

Nothing is built for the console; these four files are kept stable so it can attach without
changing the workflows:

1. `publish-plan.json` — one row per target with `window`, `mode`, `approval: none | required` and
   `status`. A console approves by flipping `approval` → granted and launching `kk stage run publish-matrix-send`.
2. `receipts/<target>.json` — fixed schema: `ok`, `effect`, `mode`, `url`, `dummy`, `error`, timestamps.
3. `publish-events.jsonl` — append-only: planned / sent / failed / skipped / gate-miss / incident.
4. `bundle.json` `parentRunId` + every publish3 run id appended to `bundle.runs[]` — one daily
   episode is traceable across its generation run and its three publish runs.

**One node per tier, not per channel.** Adding a channel is a preset edit, not a YAML edit. Browser
targets inside a tier run serially (fanout `serialTargets`); API targets in parallel. Board
visibility per channel comes from the receipts in the report, not from DAG nodes.

## 6. Responsibility boundaries (restated)

| Layer | Owns | Must not |
| --- | --- | --- |
| **Generator plugin** | `Doc[] \| Brief → Content` for one artifact (audio, image, article) incl. its own QC metadata | know about channels |
| **Publish plugin** | `Content → Result` for one platform: operation validation, draft/live switch, platform limits, session probe (`check`), receipt with `effect` | build copy, pick assets, retry |
| **kk stage (`publish-matrix-*`)** | deterministic glue: bundle freeze, preset → plan, payload per variant, dummy receipts, retry policy, classification | contain platform DOM logic or prompts |
| **agent.run nodes** | authoring only (drafts, copy) with an `expectFile` | publish, mutate the bundle |
| **Workflow YAML** | ordering, gating, pause points | channel lists, per-channel options, payload shaping |

## 7. Channel capability map (verified against plugin sources 2026-10-22)

| Target in proposed flow | Plugin / operation | Status |
| --- | --- | --- |
| podcast (microfeed → Apple/小宇宙/YT Music via RSS) | `podcast-pub` | shipped |
| surfdash | `surfdash-pub` | shipped |
| 公众号 播客 | `wechatmp-pub` `播客` (`modes.ts:27`) | operation exists, never run in daily |
| 小红书 发播客 | `xhs-pub` `发播客` | shipped (0236 follow-up) |
| 公众号 文章 | `wechatmp-pub` `文章` | shipped |
| 小红书 写长文 | `xhs-pub` `写长文` | operation exists |
| X Articles / X post | `x-pub` `article` (browser) / `post` (API) | exist |
| 微博 头条 / 微博 post | `weibo-pub` `article` / `post` | exist |
| 小红书 上传图文 | `xhs-pub` `上传图文` | shipped; currently `xhs_enabled=false` (draft-evidence issue 2026-10-21) |
| threads | `threads-pub` `post` | **text only** — images need a public host (could use surfdash asset URLs) |
| 视频号 图文 | `shipinhao-pub` is short-video only | **missing operation** |
| LinkedIn / Facebook / Instagram | — | **missing plugins** |

Gap rows run as `mode: dummy` from day one, so the flow is complete before the plugins are.

Two things the proposed list assumes that do not hold:
1. "视频发布" is audio (公众号播客, 小红书发播客), so it is an audio-distribution tier.
2. "视频号 using the 公众号 article link" needs a **published** article URL; a 草稿箱 draft has none.
   In draft mode 视频号 must link the owned platforms (surfdash/podcast) instead.

## 8. Rollout

1. publish3 + `publish-matrix-plan|send` stages with every target `dummy` against a recorded voice2 work dir
   converted to a bundle (E2E: fixture bundle → report with N dummy receipts).
2. voice3 generate in shadow mode (`publish_enabled=false`) next to voice2 for 3 days; diff bundles.
3. Flip T0 to `draft`, then tier by tier; voice2 stays scheduled until T0+T1+T2 match voice2's
   channels for 3 consecutive days, then the schedule moves to voice3 and voice2 is frozen.

**Rollout note (2026-11-05):** the operator cut over early — supervised dogfood run of voice3 +
nested publish3 (after-generate draft matrix) succeeded, so `.spur/config.yaml`'s
`kk-daily-ai-voice` job now runs `kk-daily-ai-voice3 --window 72h` (was voice2 + `--wechat-live`);
voice2 stays shipped but unscheduled. 72h pinned in place of the default 24h: heuristic-labeled
store bodies keep the fresh pool thin (24h → 3 items → an 8.4-min script the duration gate refuses;
72h reliably clears the 15-min floor). Tiers remain dummy/draft as configured in the `daily-ai-voice`
preset — publish3's live windows (cn-peak, overseas-rss) are NOT yet scheduled (§5a).

## 9. Decisions (operator, 2026-10-22)

- **D1 — accepted:** split generate (voice3) / publish (publish3), joined by `bundle.json`.
- **D2 — accepted:** channel matrix in a publish preset; config.yaml selects the preset.
- **D3 — zh everywhere for now:** the audio is zh only, so every channel, overseas included, gets
  the zh variants. Per-locale variants are revisited once other-language audio exists (the preset's
  `variant` field is where a locale suffix would go; no schema change needed).
- **D4 — three windows (§5a):** draft-capable targets → drafts right after generation; no-draft
  domestic targets → live at 09:00 Beijing; overseas → 07:00 PDT behind the RSS gate, a miss
  triggers `diagnose`. Windows are re-tuned later from engagement data — a preset edit only.
- Approval / monitoring console: out of scope; integration surface reserved in §5b.

## 10. Follow-up tasks found while reviewing (T-a…T-e shipped 2026-10-22/23; T-f, T-g open)

Tracked as feature **G15** (under G1): T-a → 0321, T-b → 0322, T-c → 0325, T-d → 0326, T-e → 0327, publish3 → 0323, voice3 → 0324, T-f → 0328 (E9; LinkedIn first). Surface frozen 2026-10-22 as `kk stage run publish-matrix-*` (no new `kk publish` noun, so no ADR-037 inventory change).

- **T-a** Generalize `itc-check-targets` / `itc-send-targets` / `publish-plan.json` out of
  `itc-publish.ts` into `kk stage run publish-matrix-plan|check|send` (ITC keeps working on top of it). Prerequisite of publish3.
- **T-b** `dummy` mode in the send path (synthetic receipt, no spawn).
- **T-c** `session-preflight` derives its probe list from enabled targets (voice2 too — small).
- **T-d** `daily-publish-classify --fold-tail` folds surfdash patching and the partial marker into
  classification; split them so classify only classifies.
- **T-e** Channel copy shaping in `daily-stages.ts` (`dailyPublishXhs` numbered lines / follow-ups,
  `dailyPublishWechat` collection) moves into per-variant payload builders on the generate side (bundle variants).
- **T-f** `shipinhao-pub` 图文 operation; `threads-pub` image support via a public asset host;
  new `linkedin-pub`, `facebook-pub`, `instagram-pub`.
- **T-g** agent.run retry in spur, then delete every `-retry` sibling.

**Shipped in 0360 (2026-11-13).** One executor var: `agent` is the single source for every primary
`agent.run` node, and the retry siblings (`curate-fix`, `script-write-fix`, and the safety machine's
three retries) declare the literal `agent: inline` with `role: reviewer`, so they resolve by role
above the primary's rung instead of pinning a second executor. Both nested safety launches and the
nested publish3 launch forward `agent`. The first node is `executor-probe` — `role: scribe`,
`agent: ${vars.agent}`, a 120 s bound and the prompt `Reply with exactly: OK`, with no `onError`, so
a dead executor fails the run at minute 0 instead of at first spend.

## 11. Migration rehearsal (task 0334) — prepared surface, nothing installed

The voice2→voice3 cutover keeps voice2's production scheduling untouched (D1: voice2 stays
scheduled until §8 step 3's parity bar). 0334 ships the REHEARSAL surface so an operator can prove
the new pipeline end-to-end in throwaway runs before deciding anything. Every artifact below is
shipped but none is installed; installing any schedule, or promoting any row to `live`, is the
operator's separate cutover action.

**What ships:**

- **The retired publish-window launcher** — the script both publish-window cron entries used to
  call. Owns the problems the old inline entries had (F08/F09/F10): the LA date math lives in
  TypeScript because a crontab command ends at the first unescaped `%` (`date +%F` silently
  truncated the old entry); the bundle is the GENERATION artifact at
  `<works>/kk-daily-ai-voice2/<digits>/bundle.json`, never the publish3 output dir; and live tokens
  are validated against the pinned preset's window rows before spur is exec'd — the legacy baked
  `wechatmp-pub,xhs-pub,weibo-pub,x-pub` cn-peak list is refused by name. Flags: `--window
  cn-peak|overseas-rss`, optional `--run-date`, `--preset` (pinned in the entry), `--live-channels`
  (cn-peak consent, in-window tokens only), `--dummy` (mutually exclusive with live tokens),
  `--dry-run` (print forwarded vars, exec nothing). `KK_SPUR_BIN` pins spur (same convention as
  board/capture.ts).
- **`plugins/kk/publish-presets/daily-ai-voice-migration.json`** — the shipped `daily-ai-voice`
  inventory with an explicit stable `id` per row (`surfdash.article`, `podcast.episode`,
  `wechatmp.podcast`, `xhs.podcast`, `wechatmp.article`, `xhs.article`, `xhs.cards`,
  `weibo.article`, `x.article`, `x.post`, `weibo.post`, `threads.post`, `shipinhao.cards`,
  `threads.images`), modes draft/dummy/off only (never live — live still needs launch tokens), so
  rehearsal receipts and plan rows address rows by id and diff cleanly across preset edits.
- **`kk-daily-ai-voice3` schedule + `publish_live_channels` var (R7)** — the shadow-generation
  cron entry (04:30, `auto_publish:false`) and the launch var that forwards operator consent to the
  nested window's `live_channels`. Empty by default: the var alone can never produce a live send.

**Rehearsal run:**

```bash
# generation preflight — print the planned launch without starting the workflow
kk news generate --dry-run
# window rehearsal without a generation run — point --run-date at a recorded day dir
kk news publish --window cn-peak --run-date <YYYYMMDD> --preset daily-ai-voice-migration --dry-run
```

**Scope and locale loss (D3 reaffirmed).** The accepted scope stays zh-only: the audio is zh, so
every channel — overseas included — receives the zh variants. What the rehearsal does NOT cover,
and what voice2 did not produce either: no en/ja audio or article variants (daily publishing has no
`kk-article-adapt` leg — that stays an explicit authoring path, not a scheduled one), no LinkedIn or
other T-f channels, and no per-platform asset transformations beyond what the preset rows carry. If
another-language audio ships later, the preset's `variant` field takes a locale suffix
(`article:ja`) — no schema change. Rollback: voice2's yaml and schedules are untouched by this
surface; deleting the merged voice3 cron lines restores the pre-rehearsal machine byte-for-byte.

## 12. Daily operator shortcuts (task 0344)

Use the root package entries instead of reassembling the supervisor, date and publish-window flags:

```bash
bun run daily-news:generate
bun run daily-news:publish
bun run daily-news:validate                      # quick file-readiness check (default)
bun run daily-news:validate -- --mode full        # complete live diagnosis + dogfood
```

Generation is always publish-inert (`auto_publish=false`, 72h extract, supervised receipt). Posting
defaults to today's `after-generate` window and requires a current, schema-valid frozen bundle whose
variant bytes and safety hashes still match; empty variants and `--dummy` never bypass that admission. A missing bundle prompts on a TTY before generation;
`--yes` explicitly accepts that dependency, while a non-TTY without it stops and prints the generate
command. An invalid existing bundle is never regenerated automatically. Select another existing
window with `--window cn-peak` or `--window overseas-rss`; their date, RSS and live-confirmation
rules stayed in the retired publish-window launcher and publish3; `kk news publish` owns them now.
Historical gaps never cause today's content to be substituted.

Validation defaults to quick mode: only the required workflow/config/launcher files, the dated
`bundle.json`, and every variant path it declares must exist. Quick mode performs no schema/hash/
safety quality validation and starts no tool, store, scheduler, preflight, or dogfood subprocess.
Use `--mode full` for the complete read-only diagnosis: PATH tools, required files, installed-stage
compatibility, store supply, scheduler configuration, dated generation/safety/receipt state and all
three publish outcomes. Full mode's default dogfood is the offline 17-case voice3 migration rehearsal;
add `--skip-dogfood` to omit only that rehearsal. Evidence lands under
`<works>/tmp/test-daily-ai-news/<timestamp>-<pid>/validation.json` with captured preflight/supply and
dogfood logs in full mode. A live failure exits 1 independently of dogfood. No entry installs schedules
or syncs the installed package, and neither validation mode generates or posts.
