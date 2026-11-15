# Content pipeline consolidation — design freeze (G61, task 0362)

**Status:** accepted 2026-11-13 · **Authority:** ADR-053 (`docs/00_ADR.md`) · **Feature:** G61

Shipped in part: 0363–0364 register `new`, `status`, the `content_types` registry and the five
`publish-*` step verbs (surface: `docs/04_DESIGN.md` §1.14). The launch verbs, the three workflows
and the retirement list below remain accepted design (tasks 0365–0369).

This document freezes the surface that Phases 2–4 of G61 implement. It does not change ADR-053.
The points that extend the ADR's pattern were accepted by the operator on 2026-11-13 and are
recorded as an amendment under ADR-053; see [Decisions](#decisions-2026-11-13).

Inventory basis: `main` at `901a4fe1`. Node counts — voice3 43, publish3 18, kk-itc 15,
kk-itc-author 16 states, kk-itc-publish-tail 7. Durations are measured from
`.works/kk-daily-ai-voice2/20261008/step-timing.json` (the fullest timing file on disk).

Exit codes used throughout:

| Code | Meaning |
| --- | --- |
| 0 | done (including "nothing to do": empty pool, no rows in the window) |
| 1 | the step ran and failed |
| 2 | usage error (unknown flag, unknown `--type`, missing required flag) |
| 5 | launch refused by preflight (dead executor, dirty harness path, missing bundle) |
| 6 | launch refused: another run holds the lock (task 0360) |

Every verb prints exactly one JSON object on stdout; diagnostics go to stderr.

---

## 1. Verb table

One registration function, `registerContentVerbs(program, noun, defaultType)` in
`apps/cli/src/commands/content.ts`, attaches the shared verbs to both nouns (ADR-053 §2); both calls
live in `apps/cli/src/cli.ts`.
`kk news` is `kk article` with `--type news` fixed, plus two news-only verbs.
Plain verbs are operator entry points; hyphenated verbs are workflow steps and take **named flags
only** — no positional arguments.

### 1.1 Plain verbs (both nouns)

| Verb | Flags | Exit | stdout | Reads | Writes | Wraps today |
| --- | --- | --- | --- | --- | --- | --- |
| `new` | `--type <t>` (article only; default `itc`), `--topic <text>` \| `--from <file.md>`, `--slug <s>`, `--run-date <YYYYMMDD>` (news), `--locale <l>`, `--title <s>`, `--tags <a,b>`, `--description <s>`, `--cover <path>`, `--variant <name=path>` (repeatable), `--work-dir <dir>` | 0, 1, 2 | `{workDir, run, type, created: boolean}` | config; the source file when `--from` | `<workDir>/request.json`; with `--from`: `content/<locale>/article.md`, `4-publish/content.json` | `apps/cli/src/itc-stage.ts:runItcStage` (`itc-prepare`), `plugins/kk/scripts/kk-workflow-stages.ts` (`prepare-itc`), `scripts/publish-article.ts` (seeding half), `apps/cli/src/commands/daily.ts` (`prepare`, directory half) |
| `generate` | `--type`, `--slug` \| `--run-date`, `--agent <executor>`, `--skip-review`, `--auto` (article: no human gates), `--publish` (launch `publish` for window `after-generate` on success), `--channels`, `--live-channels`, `--timeout-ms <n>` (default 13500000), `--allow-dirty`, `--dry-run` | 0, 1, 2, 5, 6 | the launch receipt (§3) | config, checkout state, lock | lock, `<workDir>/schedule-receipt.json`, everything the workflow writes | `plugins/kk/scripts/daily-scheduled-run.ts`, `scripts/daily-ai-news.ts` (`generate`), `kk-itc.yaml` node `child-author` (the inline supervisor shell) |
| `publish` | `--type`, `--slug` \| `--run-date` \| `--work-dir`, `--window <w>` (default `after-generate`), `--preset <name>`, `--channels <a,b>`, `--live-channels <a,b>`, `--live-confirm`, `--dummy`, `--retry`, `--agent`, `--unattended`, `--yes`, `--timeout-ms`, `--dry-run` | 0, 1, 2, 5, 6 | the launch receipt (§3) | `<workDir>/4-publish/bundle.json`, config, lock | lock, `<workDir>/4-publish/*` via the workflow | `plugins/kk/scripts/voice3-publish-window.ts`, `scripts/daily-ai-news.ts` (`publish`), `scripts/publish-article.ts` (launch half) |
| `status` | `--type`, `--slug` \| `--run-date` \| `--work-dir`, `--window <w>` | 0, 1 (run directory missing), 2 | `{workDir, type, generate: {status, runId, executor, checkoutCommit}, bundle: {frozen, runId, variants}, windows: {<w>: {status, published, targets}}}` | `schedule-receipt.json`, `4-publish/bundle.json`, `4-publish/outcome.*.json` | nothing | `scripts/daily-ai-news.ts` (`inspect`, `inspectGeneration`) |

`validate` from `scripts/daily-ai-news.ts` is not carried over: its checks are the launch
preflight (§3) plus a required-files list that stops being meaningful once the launcher is in the
binary. `generate --dry-run` and `publish --dry-run` run the preflight and print the receipt
without launching.

### 1.2 Publish step verbs (both nouns)

All take `--work-dir <dir>` (required) and `--window <w>` (default `after-generate`).

| Verb | Extra flags | Exit | stdout | Reads | Writes | Wraps today |
| --- | --- | --- | --- | --- | --- | --- |
| `publish-plan` | `--preset`, `--channels`, `--live-channels`, `--dummy`, `--run-date` | 0, 1, 2 | `{plan: <path>, rows: n, live: n, excluded: n, wait: {until?: iso}, gate: {rss?: 'hit'\|'miss'}}` | `4-publish/bundle.json`, preset file, RSS feed (window `overseas-rss`) | `4-publish/plan.<w>.json`, `4-publish/run-date.txt`, `4-publish/rss-gate.json` | `apps/cli/src/publish-matrix.ts:planPublishMatrix`, `:runPublishMatrixValidate`, `:runPublishMatrixRssGate`, `:runPublishMatrixWaitUntil`; `apps/cli/src/itc-stage.ts` (`itc-check-targets`, target half) |
| `publish-check` | `--preset`, `--all-windows` | 0 always (warn-only) | `{check: <path>, ready: n, warnings: [..]}` | plan, plugin probes | `4-publish/check.<w>.json` | `apps/cli/src/publish-matrix.ts:checkPublishMatrix`, `apps/cli/src/publish-core.ts:probePlugin` (0361) |
| `publish-send` | `--tier <0-3>`, `--retry` | 0, 1 | `{sent: n, failed: n, uncertain: n, receipts: <dir>}` | plan, bundle variants | `4-publish/receipts/*.json` | `apps/cli/src/publish-matrix.ts:sendPublishMatrix`, `apps/cli/src/publish-core.ts:sendRows` (0361), `apps/cli/src/itc-stage.ts` (`itc-send-targets`) |
| `publish-settle` | `--topic <t>`, `--db <path>` | 0, 1 (a required non-dummy row did not succeed) | the outcome object (`PublishOutcomeSchema`) | plan, receipts | `4-publish/outcome.<w>.json`, `publish-status.<w>.txt`, `settlement.<w>.json`, `partial.<w>.json`; appends the run id to `bundle.json` `runs[]`; store rows via `kk store mark-published` | `apps/cli/src/publish-matrix.ts:runPublishMatrixClassify`, `:classifyPublishMatrix`, `:runPublishMatrixSettle`; script stages `publish-matrix-partial`, `publish-matrix-patch-surfdash`; `apps/cli/src/itc-stage.ts` (`itc-reconcile-receipts`); inline `jq` of publish3 nodes `outcome-assert`, `bundle-runs` |
| `publish-report` | — | 0, 1 | `{report: <path>, seo?: <path>}` | outcome, settlement | `5-report/publish-<w>.md`, `5-report/seo.json` (types with `seo.mode` set); `kk ledger sync` | publish3 node `report` (inline `printf`/`jq`), `ledger`; `apps/cli/src/itc-stage.ts` (`itc-export-seo`, `itc-report-summary`) |

### 1.3 Generate step verbs — extension of the ADR-053 §2 pattern

ADR-053 §2 names the publish step verbs and `prepare`/`report`. Folding generation nodes into
verbs (ADR-053 §7) needs generation step verbs too; they follow the same `<plain>-<step>` shape.
Accepted (decision 1).

| Verb | Noun | Flags | Exit | stdout | Reads | Writes | Wraps today (stage names) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `prepare` | news | `--work-dir`, `--run-date`, `--ledger-sync` | 0 (pool empty is 0 with `pool: 'empty'`), 1 | `{pool: 'ok'\|'empty', candidates: n, selected: n, sessions: {warnings: [..]}}` | store, sources | `10-ingest/*`, `10-collect/pool.json`, `21-plan/*`, `pool-gate.json` (no skill snapshot, §2.2) | `daily-preflight`, `kk daily prepare`, `publish-matrix-check --all-windows`, `daily-extract`, `daily-plan`, `daily-qc-content`, `kk store select`, `daily-script-style` |
| `generate-check` | both | `--work-dir`, `--step <curate\|script\|outline\|judge\|adapt>`, `--final` | 0 for both `pass` and `fix` (a fix verdict writes the errors file the next node conditions on — exit 1 would fail the DAG, as today); 1 only when the step input is missing or unreadable; `--final` applies the documented fallback | `{step, verdict: 'pass'\|'fix'\|'fallback', errors: <path>?}` | the step's agent output | the step's `*_errors.json` beside its input (`21-plan/`, `24-script/`), fallback artefacts | `daily-curate-check`, `daily-script-check`, `itc-outline-pick`, `itc-decision`, `itc-author-verdict`, `itc-adapt-verify` |
| `generate-render` | news | `--work-dir` | 0, 1 | `{script, article, cover}` paths | curated items, script | `24-script/*`, `22-article/*`, `23-cover/*`, `20-editorial/*` | `daily-script`, `daily-editorial-render`, `daily-article`, `daily-cover`, `daily-cover-normalize`, `daily-wrap-docs` |
| `generate-voice` | news | `--work-dir`, `--engine <voxcpm\|gemini\|omnivoice>` | 0, 1 (retryable: the next node passes the next engine) | `{engine, audio, durationSec, quality: 'pass'\|'warn'}` | script | `30-audio/*` (audio, quality report, show notes) | `daily-generate`, `daily-intro`, `daily-voice-audit`, `daily-episode-duration`, `audio-quality`, `daily-quality-report`, `daily-quality-verdict`, `daily-show-notes` |
| `generate-cards` | news | `--work-dir` | 0, 1 (continue-on-failure in the workflow) | `{cards: n, dir}` | article | `25-xhs/*` | `daily-xhs-render` |
| `generate-bundle` | both | `--work-dir`, `--run-id`, `--run-date`, `--preset`, `--stage <variants\|freeze>` | 0, 1 | `{bundle: <path>, runId, variants: [..], safety: 'pass'\|'escalate'\|'exclude'\|null}` | rendered artefacts, safety verdicts | `31-publish/*`, `4-publish/variants/*`, safety manifest (`--stage variants`); `4-publish/bundle.json` (`--stage freeze`) | `daily-publish-prep`, `daily-bundle-variants`, `daily-safety-manifest`, `publish-matrix-bundle`; `itc-author-complete`, `itc-materialize-plan` |
| `report` | news | `--work-dir` | 0, 1 | `{report: <path>}` | run artefacts | `5-report/generation.md`; `kk ledger sync` | `kk daily run-report`, `kk ledger sync` |

`generate-bundle` has two stages because the nested safety review of the channel variants sits
between writing the variants and freezing the bundle, and a nested workflow call cannot run
inside a verb.

Directory names in the Writes column are the ones the stage bodies use today
(`.works/kk-daily-ai-voice2/20261112`); the verbs do not rename them (§4.3).

### 1.4 Hidden compatibility routes (ADR-037)

`kk itc candidates`, `kk daily prepare|publish-classify|run-report`, and every `kk stage run`
name in §6 stay registered and hidden for one release after the workflows that call them retire.
They call the same functions the new verbs call; none keeps a private implementation.

---

## 2. `content_types` config

```yaml
content_types:
  news:
    workflow: kk-news-generate
    writer_skill: kk:news-editorial
    publish_preset: daily-ai-voice
    channels:                 # operator switches; omitted channels keep the preset's mode
      xhs-pub: off
  itc:
    workflow: kk-article-generate
    writer_skill: kk:itc-generating
    publish_preset: itc-main
```

Zod-ready schema (lives in `apps/cli/src/content-types.ts`):

```ts
const ChannelModeSchema = z.enum(['off', 'dummy', 'draft', 'live']);
const ContentTypeSchema = z.strictObject({
    workflow: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),        // workflow name; also the run-directory parent (§4.3)
    writer_skill: z.string().regex(/^[a-z0-9-]+:[a-z0-9-]+$/), // `<plugin>:<skill>`
    publish_preset: z.string().min(1),                        // preset name under publish-presets/
    channels: z.record(z.string().min(1), ChannelModeSchema).default({}), // `<plugin>` or `<plugin>/<variant>` → mode
});
const ContentTypesSchema = z.record(z.string().regex(/^[a-z][a-z0-9-]*$/), ContentTypeSchema);
```

The block is deliberately four fields. Everything else a workflow needs (`research`, `judge`,
`unslop`, `max_revisions`, `seo`, `workspace.dated`, …) stays under the existing
`workflows.<name>` block read by `apps/cli/src/itc-config.ts`; `content_types` only answers
"which workflow, which writer, which preset, which channels are on".

### 2.1 Channel configuration — one switchboard

Who owns what:

| Layer | Owns | Changes when |
| --- | --- | --- |
| Publish preset (`publish-presets/<name>.json`, shipped) | structure: which rows exist, plugin, variant, tier, window, `required`, and a **default** `mode` | a channel is added or re-shaped (a code change) |
| `content_types.<type>.channels` (user config) | the **operator switch** per channel: `off \| dummy \| draft \| live` | the operator turns a channel on or off — no repo edit, no rebuild, no package sync |
| `--channels` / `--live-channels` (per run) | this run only | a re-send or a one-off |

- A key is a plugin name (`xhs-pub`, applies to every row of that plugin) or `<plugin>/<variant>`
  (`wechatmp-pub/article`, one row). The more specific key wins.
- Row mode = `--live-channels` promotion → `content_types.<type>.channels` → preset `mode`.
  `--channels` then narrows the result. A key that matches no preset row is a config error
  (exit 2 naming the key and the preset) — a typo must not silently leave a channel on.
- The plan records where each row's mode came from: `rows[].modeSource: 'flag' | 'config' | 'preset'`,
  and a row switched off by config lands in `excluded[]` with `reason: 'mode off (config)'`.
  `kk news status` prints the effective switchboard, so "why did xhs not post?" is one command.
- Turning 小红书 off after the 2026-11-13 risk-control event took a preset edit plus a doc edit
  (`d1d1ca0e`) and would not reach the schedule until the installed package was re-synced. With
  this block it is one line in `~/.config/kk/config.yaml`.

### 2.2 Writer skill — read in place, not copied

Today `daily-script-style` copies `plugins/kk/skills/news-editorial/` into every run
(`<run>/20-editorial/news-editorial/`, plus the style contract into `24-script/`), because
ADR-045 could not assume skill discovery on every executor and a workflow has no variable for
the package directory. The launching verb removes the second reason:

- `resolveContentType` resolves `writer_skill` (`<plugin>:<skill>`) to an absolute directory
  inside the kk package that is running (`<package>/plugins/<plugin>/skills/<skill>`, the same
  root the stage runner resolves) and fails as a preflight refusal (exit 5) when it holds no
  `SKILL.md`.
- The verb passes it as workflow var `skill_dir`; agent prompts cite
  `${vars.skill_dir}/SKILL.md`. Still no skill discovery, so pi/codex/inline behave alike, and
  it does not depend on what `superskill install kk` did on the host.
- The audit value of the copy is kept as two fields in `schedule-receipt.json`:
  `writerSkill: {dir, sha256}` (hash over `SKILL.md` and `references/`). No `20-editorial/`
  directory and no style-contract copy in new runs.

Ceiling: a package upgrade in the middle of a run can change the skill between `curate` and
`script-write`; the receipt hash shows which version started the run. Accepted — the schedule
does not upgrade mid-run.

**Why not `enable_<channel>` workflow variables.** Considered and not taken, for three reasons.
`kk-publish` is shared by every content type, and their channel sets differ (17 news rows over
9 plugins; three article presets), so the YAML would carry the union of all of them. The
workflow never branches per channel — `send` is one node — so the variables would only be
forwarded to `publish-plan`, which is exactly the pass-through padding ADR-053 §7 removes. And
a workflow file ships inside the package, so flipping a default there has the same
installed-copy staleness the preset has today. The per-run half of the idea is kept: the
workflow's existing `channels` and `live_channels` variables are the per-run override, set by
the launching verb.

**Resolution order**, per field: command flag (`--preset`; `--agent` is not a content-type field)
→ `content_types.<type>.<field>` in user config → `workflows.<workflow>.publish_preset`
(compatibility, `publish_preset` only; this is where `daily-ai-voice` lives today,
`plugins/kk/config.example.yaml:16`) → the built-in defaults above. The built-in table is the two
entries shown; a user entry merges over the built-in entry field by field.

**Unknown type:** `kk article <verb> --type foo` exits 2 with
`unknown content type 'foo' (known: itc, news); add content_types.foo to <config path>`.
`kk news` rejects `--type` outright.

**`--channels`:** a comma list of plan row ids, or plugin names (every row of the plugin). `publish` passes it to `publish-plan`, which
already drops non-listed rows into `plan.excluded[]` with `reason: 'not in --channels list'` (`publish-matrix.ts:488`)
(`apps/cli/src/publish-matrix.ts:planPublishMatrix`, `PublishPlanExcludedSchema`). The plan file
is therefore the record of the selection; nothing else stores it. An id that matches no preset row
exits 2 before the plan is written. `--live-channels` **overrides the config switchboard** for the
listed rows: a row whose config mode is `off` (or `dummy`, or `draft`) is promoted to `live`, and the
row's `modeSource` records `flag` (0372 R5 — the flag is per-run consent, so `off` does not silence a
channel the operator names on the command line).

---

## 3. Launch contract

A plain verb launches and supervises exactly one workflow (ADR-053 §3). `generate` and `publish`
share one implementation, `launchWorkflow()` in `apps/cli/src/launch.ts`:

1. resolve type, run and work directory (§4.3); `--dry-run` stops after step 4;
2. `kk lock acquire --name "<workflow>-<run>"` — held → exit 6, receipt untouched (0360);
3. preflight: dirty harness paths (unless `--allow-dirty`), checkout-vs-install divergence,
   executor probe (`inline` probes role `scribe`); failure → exit 5 with a `refused` receipt;
4. write `schedule-receipt.json` with `status: 'running'`;
5. one `spur workflow run <workflow> --vars …` with the timeout;
6. on exit, signal or timeout: `spur workflow cancel` if still running, `kk store release`,
   `kk ledger sync`, lock release, final receipt. The engine has no `finally`, so this cleanup
   lives here and nowhere in the YAML.

Receipt: `{schemaVersion: 1, workflow, type, run, runId, status: 'running'|'done'|'no-content'|'incomplete'|'failed'|'refused'|'timeout', executor, checkoutCommit, startedAt, finishedAt?, workDir, window?, reason?}`.

### 3.1 `plugins/kk/scripts/daily-scheduled-run.ts` (581 lines) — line map

| Lines | What it does | Fate | Reason |
| --- | --- | --- | --- |
| 12–30 | option table | **keep, trimmed** | `repo`, `works-dir`, `run-id`, `timeout-ms`, `agent`, `allow-dirty`, `window` survive as verb flags; `retry-agent` dropped (0360, one executor var); `workflow` dropped (comes from `content_types`); `required-channels`, `wechat-live`, `publish-live-channels` become `--channels` / `--live-channels`; `publish-preset` becomes `--preset`; `generate-only` inverts into `--publish`; `skip-probe` dropped (the probe is the point of the launch) ; `receipt` dropped (path is fixed) |
| 31–50 | argv parsing, usage exit 2 | **drop** | Commander does it |
| 51–133 | stamp, work-dir and path derivation | **keep** | moves to `resolveRun()` (§4.3) |
| 134–156 | `executorProbe` | **keep** | step 3; also the workflow's first node (0360) |
| 157–212 | `runPreflight`: dirty harness paths, checkout-vs-install divergence, probe; exit 5 | **keep** | step 3 |
| 213–293 | workflow argv assembly and spawn | **keep, simplified** | one `--vars` set per workflow (§5) |
| 294–325 | signal handler | **keep** | step 6 |
| 326–423 | cleanup: workflow cancel, `kk store release`, `kk ledger sync` | **keep** | step 6 |
| 424–482 | timeout watchdog and exit mapping | **keep** | step 5 |
| 483–555 | generation inspection and triage (which artefacts exist, why it stopped) | **move** | becomes `status`; the receipt carries only `status` + `reason` |
| 556–581 | receipt write | **keep** | steps 4 and 6; gains `checkoutCommit`, `executor` (0360) |

### 3.2 `scripts/daily-ai-news.ts` (1013 lines) — command map

| Lines | What it does | Fate | Reason |
| --- | --- | --- | --- |
| 1–281 | constants, config path, `inspectGeneration`, helpers | **move** | `inspectGeneration` becomes `status`; the rest is path arithmetic done by `resolveRun()` |
| 282–328 | `generate [--full]` → spawns the supervisor | **drop** | `kk news generate` is the supervisor |
| 329–413 | `publish`: unattended posture reads the receipt and re-runs generation unless `done\|no-content\|incomplete\|running`; interactive posture inspects, refuses invalid/running/no-content, offers generation for today only | **keep, as two rules** | (a) `publish` exits 5 when the bundle is missing or the generate receipt is `running`; (b) `publish --unattended` on a missing bundle with a receipt that is absent or `failed` runs `generate` once, then continues. The interactive "offer to generate" prompt is dropped — the operator runs `kk news generate` |
| 414–669 | `inspect` | **move** | `status` |
| 670–1008 | `validate` (quick/full rehearsal, required-files list) | **drop** | preflight covers the live checks; the offline rehearsal is a test, and stays in `apps/cli/tests/` |
| 1009–1013 | entry | **drop** | — |

### 3.3 The other two launchers

- `plugins/kk/scripts/voice3-publish-window.ts` (206 lines): window and CN-consent validation
  against the preset → **keep** inside `publish` (validation before step 2); the
  `spur workflow run` assembly and `--dry-run` → **keep** as steps 5 and 1; the file → **drop**.
- `scripts/publish-article.ts` (426 lines): seeding a work directory from Markdown → **move** to
  `kk article new --from`; driving `kk-itc-publish-tail.yaml` → **replaced** by
  `kk article publish`; `--plan-only` → `publish --dry-run` plus `publish-plan`; `--copy-source`
  → **drop** (`new --from` always copies; a symlinked source made receipts unreproducible).
- The inline shell in `kk-itc.yaml` node `child-author` (launch/continue the child, trap, cancel)
  → **drop**: the author states become nodes of `kk-article-generate` itself, so there is no
  child to supervise.

---

## 4. Bundle and plan contract

### 4.1 `4-publish/bundle.json` — one schema, diff against `BundleSchema` (`apps/cli/src/publish-matrix.ts:51`)

| Field | Today (news) | Frozen | Note |
| --- | --- | --- | --- |
| `schemaVersion` | `1` | `1` | every change below is additive or a relaxation, so old bundles still parse |
| `runId`, `runDate`, `parentRunId?`, `runs[]` | present | unchanged | `runDate` is the slug's creation date for articles |
| `contentType` | — | **added**, optional, default `'news'` | the type the bundle was generated as; `publish` refuses a `--type` that disagrees |
| `title` | — | **added**, optional | neutral title; articles set it, news derives it from `episode.title` |
| `episode{title, guid?}` | required | **optional** | news-only; the RSS gate and podcast rows require it and say so when it is missing |
| `variants: record<key, {path, sha256}>` | present | unchanged | an article's variants are its adapted files (`ItcPublishPlan.variants[*].file`) |
| `safety?` | present | unchanged | articles omit it until an article safety review exists |

Dropped on the article side — these `ItcPublishPlan` fields (`apps/cli/src/itc-plan.ts`) describe
generation, not a publishable artefact, and stay in `4-publish/content.json`:
`sourceLocale`, `variants[*].adapt`, `variants[*].limits`, `variants[*].switches`, `warnings`.

### 4.2 `4-publish/plan.<window>.json` — one schema, diff against `PublishPlanSchema` (`:109`) and ITC `publish-plan.json`

| Field | Matrix plan | ITC plan | Frozen |
| --- | --- | --- | --- |
| `window`, `bundleRunId`, `parentRunId`, `presetName`, `presetDigest`, `runDate?` | present | `presetName?`, `presetDigest?`, `origin?` | matrix shape; `origin` dropped (the bundle's `contentType` says it) |
| `excluded[{id, plugin, reason}]` | present | — | unchanged; carries `--channels` drops |
| `rows[]`: `id, plugin, operation?, variant, tier, window, mode, required, approval, status, profile?, payloadPath, payloadDigest, variantPath?, variantDigest?` | present | `targets[]`: `target, plugin, profile, variant, transport, mode?, payloadPath?, payloadDigest?, metadata` | matrix row, plus two optional fields below |
| `rows[].transport` | — | `'fanout' \| 'browser'` | **added**, optional, default `'fanout'`; `sendRows` already switches on it (`apps/cli/src/itc-publish.ts:700`) |
| `rows[].metadata` | — | per-target record | **added**, optional; opaque to the core, passed to the plugin |
| `rows[].modeSource` | — | — | **added**, optional: `'flag' \| 'config' \| 'preset'` (§2.1) |
| `live` (plan-wide) | — | boolean | **dropped**; `rows[].mode` is per row |
| `fanout[]`, `browser[]` | — | grouping lists | **dropped**; derived from `rows[].transport` |

Mapping for an article row: `id = target`, `tier = 0`, `window = 'after-generate'` (the existing
default at `publish-matrix.ts:420`), `required = true`, `approval = mode === 'live' ? 'required' : 'none'`.
An article preset is therefore an ordinary publish preset with one window; no second preset
format survives.

### 4.3 Work directories (ADR-042) and how `publish` finds a bundle

```
<works>/<workflow>/<run>/             workflow = content_types.<type>.workflow (ADR-042: directory name = workflow name)
    request.json                      written by `new`
    schedule-receipt.json             written by the launching verb
    pool-gate.json                    news; replaces the `.spur/run/<runId>-pool-gate.status` token
    10-collect/ … 31-publish/         generation artefacts, private to the type (names owned by the stage bodies)
    4-publish/
        bundle.json                   frozen by generate-bundle; never rewritten except runs[]
        variants/                     the files bundle.variants point at
        plan.<window>.json  check.<window>.json  outcome.<window>.json  settlement.<window>.json
        receipts/
    5-report/
```

| Workflow | `<run>` | Example |
| --- | --- | --- |
| `kk-news-generate` | `<YYYYMMDD>` (daily cadence) | `.works/kk-news-generate/20261113` |
| `kk-article-generate` | `<topic-slug>` (topic cadence); `<YYYYMMDD>-<slug>` when `workflows.kk-article-generate.workspace.dated` | `.works/kk-article-generate/bun-sqlite-wal` |
| `kk-publish` | **none of its own** | writes `4-publish/` and `5-report/` inside the bundle's run directory |

`kk-publish` owns no directory because plans, receipts and settlements are facts about one
bundle: a re-send must find the earlier receipts, and `bundle.json` `runs[]` already lists every
publish run id. A separate tree would need a pointer file in both directions for no gain.

What the new layout fixes, and what it deliberately leaves:

| Old problem | Now |
| --- | --- |
| The directory is `kk-daily-ai-voice2` while the workflow is `kk-daily-ai-voice3`; a stray `kk-daily-ai-voice3/` exists beside it | directory name = workflow name, one rule, no `works_namespace` knob |
| Run state lives outside the run (`.spur/run/<runId>-pool-gate.status`), so a copied or archived run is incomplete | every fact about a run is inside its directory |
| News and articles share nothing above the phase directories; ITC is dated-or-slug by a separate setting | both types share `request.json`, `schedule-receipt.json`, `4-publish/`, `5-report/`; only generation phases are type-private |
| The store, ledger and Board key on the stale name | they key on the workflow name passed by the launching verb; the Board manifest gains the two new names at cut-over (0369) |
| `31-publish/` (publish prep) next to `4-publish/` (matrix); duplicate prefixes `10-collect`/`10-ingest`, `20-editorial`/`20-facts` | **left as is.** These names are literals in the stage bodies and their tests (about 500 source and 950 test references). Renaming them changes no behaviour and would be the riskiest edit in the feature; it belongs with any future move of the stage bodies |

History is not migrated. Runs under `.works/kk-daily-ai-voice2/` and `.works/kk-itc/` stay where
they are and remain publishable with `--work-dir`; ledger rows written before the cut-over keep
their old workflow name.

`resolveRun()`: `--work-dir` wins; otherwise `<works>/<workflow>/<run>` with `<run>` from
`--run-date` (news; default: today in `America/Los_Angeles`) or `--slug` (article; required).
`publish` then requires `<workDir>/4-publish/bundle.json` — missing → exit 5 naming the path
(or the single auto-generate under `--unattended`, §3.2).

---

## 5. Workflow node maps

Every workflow declares one executor variable, `agent`, default `inline` (ADR-053 §5); retry
nodes use `role: reviewer` (0360). A node below is an **agent** call, a **pause**, or a retry
**boundary**; for each boundary the minutes it protects are stated.

Conventions for the tables below: nodes are declared in the order shown and each depends on the
row above it unless a condition says otherwise; a conditional node that is skipped does not skip
its successors (the engine skips a node only when all its dependencies were skipped); `onError`
is the engine default (fail the run) except where a row says "continue on failure".

### 5.1 `kk-news-generate` (DAG, 20 nodes; replaces voice3's 43)

Vars: `work_dir`, `run_date`, `run_id`, `agent`, `skill_dir`, `skip_review`, `preset`.

| # | Node | Kind | Action | Earns its place |
| --- | --- | --- | --- | --- |
| 1 | `executor-probe` | agent | `agent.run`, role `scribe`, input "Reply with exactly: OK", 2 m (0360 R4) | stops before any spend |
| 2 | `prepare` | boundary | `kk news prepare` | re-running from here skips nothing expensive; it is the pool gate every later node conditions on (`pool == ok`) |
| 3 | `curate` | agent (scribe, 10 m) | kk:news-editorial | — |
| 4 | `curate-check` | boundary | `kk news generate-check --step curate` | guards a 10-minute agent call from re-running |
| 5 | `curate-fix` | agent (reviewer) | condition: check failed | — |
| 6 | `curate-final` | boundary | `generate-check --step curate --final` | applies the untranslated-candidates fallback |
| 7 | `script-write` | agent (scribe) | failure → template fallback (0345) | — |
| 8 | `script-check` | boundary | `generate-check --step script` | guards a 10-minute agent call |
| 9 | `script-fix` | agent (reviewer) | condition: check failed | — |
| 10 | `editorial-judge` | agent (reviewer, advisory) | nothing depends on it | — |
| 11 | `render` | boundary | `kk news generate-render` | ~0.5 min itself; separates agent output (≤40 min behind it) from TTS |
| 12 | `safety` | nested | `kk-daily-safety` | agent calls inside |
| 13 | `review` | pause | skipped when `skip_review=true` | — |
| 14 | `voice` | boundary | `generate-voice --engine voxcpm` | **141 min** measured |
| 15 | `voice-fallback` | boundary | `--engine gemini`, condition: 14 failed | 141 min |
| 16 | `voice-fallback2` | boundary | `--engine omnivoice`, condition: 15 failed | 141 min |
| 17 | `cards` | boundary | `generate-cards`, continue on failure | **46 min** measured |
| 18 | `variants` | boundary | `generate-bundle --stage variants` | needed before the nested safety call |
| 19 | `safety-variants` | nested | `kk-daily-safety`, `safety_scope_dir=4-safety-variants` | agent calls inside |
| 20 | `freeze` | boundary | `generate-bundle --stage freeze` then `kk news report` | protects 3+ h of generation from a report failure re-run |

Publishing is not a node: `kk news generate --publish` launches `kk news publish` after the
workflow exits 0. That removes the nested `publish` node and keeps "one verb, one workflow".

Fate of the 43 voice3 nodes:

| Current node(s) | Fate |
| --- | --- |
| `prepare`, `read-work-dir`, `read-run-date`, `session-preflight`, `extract`, `plan`, `qc-content`, `pool-gate`, `select`, `script-style` | → node 2 (`work_dir`/`run_date` now arrive as vars from the launching verb) |
| `curate`, `curate-check`, `curate-fix`, `curate-final` | → nodes 3–6 |
| `script-write`, `script-check`, `script-write-fix`, `editorial-judge` | → nodes 7–10 |
| `script`, `editorial-render`, `article`, `cover`, `cover-normalize`, `wrap-docs` | → node 11 (`wrap-docs` moves before `review`; it only reads rendered files) |
| `safety`, `review` | → nodes 12, 13 |
| `generate`, `generate-fallback`, `generate-fallback2` | → nodes 14–16 |
| `intro`, `voice-audit`, `duration`, `quality`, `show-notes` | → inside `generate-voice` (run after the engine succeeds; `voice-audit` stays advisory, `duration` stays a gate) |
| `cards-render` | → node 17 |
| `publish-prep`, `bundle-variants` | → node 18 |
| `safety-variants` | → node 19 (its `daily-safety-manifest` half moves into node 18) |
| `bundle-freeze`, `generation-report`, `ledger` | → node 20 |
| `publish` | **removed**; `generate --publish` |
| `executor-probe` | → node 1 (the shared real-traffic probe) |

### 5.2 `kk-article-generate` (FSM, 13 states; replaces kk-itc's author half and kk-itc-author)

Vars: `work_dir`, `slug`, `run_id`, `agent`, `skill_dir`, `auto`, `preset`.

| State | Kind | Action |
| --- | --- | --- |
| `executor-probe` | agent | the 0360 probe node |
| `outline-write` | agent | writer skill from `content_types.<type>.writer_skill` |
| `outline-select` | pause (`hitl.select`) | skipped when `auto`; `generate-check --step outline` picks instead |
| `outline-review` | pause (`hitl.confirm` / `hitl.input`) | revise loops back to `outline-write` |
| `draft-write` | agent | — |
| `unslop` | agent | kk:taste-unslop, when `workflows.<wf>.unslop` |
| `draft-review` | pause (`hitl.confirm` / `hitl.input`) | revise loops to `draft-write`; `auto` routes to `judge` |
| `judge` | agent (reviewer) | then `generate-check --step judge`; fail → `draft-write` up to `max_revisions` |
| `illustrate` | agent | kk:image-authoring, conditional |
| `adapt` | agent | kk:article-adapt, then `generate-check --step adapt` |
| `freeze` | boundary | `generate-bundle --stage variants` then `--stage freeze`; protects the whole authoring session |
| `done` / `failed` | terminal | — |

Fate of the 16 kk-itc-author states: `author-init` → **removed** (`new` wrote the request);
`outline-write` → kept; `outline-select` → kept; `outline-autopick`, `outline-commit` → folded
into `outline-select`'s `auto` branch (`generate-check --step outline`); `outline-review`,
`outline-revise` → one state `outline-review`; `draft-write`, `unslop` → kept; `draft-review`,
`draft-revise` → one state `draft-review`; `draft-autorevise` → **removed** (the `judge` fail
edge already returns to `draft-write`); `judge` → kept; `author-finish` → `freeze`; `done`,
`failed` → kept.

Fate of the 15 kk-itc nodes: `executor-probe` → kept as the shared real-traffic probe; `prepare` → **removed** (`kk article new`); `child-author` →
**removed** (states inlined, §3.3); `verify-child-freeze` → **removed** (no child);
`illustrate` → kept; `materialize-plan` → `freeze`; `adapt`, `adapt-verify` → state `adapt`;
`check-targets`, `send-confirm`, `fanout-send`, `fanout-recovery`, `reconcile-settle`, `seo`,
`report` → **moved to `kk-publish`** (5.3 nodes 2–8).

### 5.3 `kk-publish` (DAG, 9 nodes; replaces publish3's 18 and the 7-node publish tail)

Vars: `work_dir`, `run_date`, `window`, `preset`, `channels`, `live_channels`, `live_confirm`,
`dummy`, `agent`.

| # | Node | Kind | Action | Earns its place |
| --- | --- | --- | --- | --- |
| 1 | `plan` | boundary | `publish-plan` (waits until the window opens, runs the RSS gate, validates the run date) | the wait is up to hours for `cn-peak`; nothing before it is worth repeating |
| 2 | `check` | boundary | `publish-check` (warn-only) | separates session warnings from the human approval that reads them |
| 3 | `send-confirm` | pause | only when `live_confirm=true` and the plan has live rows | — |
| 4 | `send` | boundary | `publish-send`, continue on failure | 1–5 min of browser automation per live row; a resume must not re-send |
| 5 | `send-retry` | boundary | `publish-send --retry`, condition: send left failed rows | same |
| 6 | `diagnose` | agent (scribe) | condition: RSS gate miss (`overseas-rss`); writes `incident.json` / `.md` | — |
| 7 | `repair` | boundary | `publish-send --window after-generate --retry --tier 0`, condition: 6 ran | re-sends only the podcast row |
| 8 | `settle` | boundary | `publish-settle`; exit 1 fails the run when a required row is unsettled | the only node that writes the store |
| 9 | `report` | boundary | `publish-report` | a report failure must not undo a settlement |

Fate of the 18 publish3 nodes: `wait-until`, `rss-gate`, `plan`, `validate` → node 1; `check` →
2; `send-confirm` → 3; `send` → 4; `send-retry` → 5; `classify`, `patch-surfdash`,
`partial-marker`, `settle`, `outcome-assert`, `bundle-runs` → node 8; `diagnose` → 6; `repair` →
7; `report`, `ledger` → node 9.

Fate of the 7 kk-itc-publish-tail nodes: `check-targets` → nodes 1–2; `send-confirm` → 3;
`fanout-send` → 4; `fanout-recovery` → 5; `reconcile-settle` → 8; `seo`, `report` → 9.
The same mapping applies to the identical seven nodes at the tail of `kk-itc.yaml`.

`kk-daily-safety` is unchanged by this feature beyond task 0360; it stays a nested workflow and
keeps its `kk stage run daily-safety-*` calls (they are agent-adjacent gates inside an FSM, not
padding between verbs). Moving them is not in G61.

---

## 6. Stage migration table

Every stage name called by the five in-scope workflows, in either spelling (`kk stage run <name>`
or the legacy `kk stage <name>`), plus the nested safety workflow's.

| Stage | Called from | Target |
| --- | --- | --- |
| `audio-quality` | voice3 | `kk news generate-voice` |
| `daily-article` | voice3 | `kk news generate-render` |
| `daily-bundle-variants` | voice3 | `kk news generate-bundle --stage variants` |
| `daily-cover` | voice3 | `kk news generate-render` |
| `daily-cover-normalize` | voice3 | `kk news generate-render` |
| `daily-curate-check` | voice3 | `kk news generate-check --step curate [--final]` |
| `daily-editorial-render` | voice3 | `kk news generate-render` |
| `daily-episode-duration` | voice3 | `kk news generate-voice` |
| `daily-extract` | voice3 | `kk news prepare` |
| `daily-generate` | voice3 | `kk news generate-voice --engine <e>` |
| `daily-intro` | voice3 | `kk news generate-voice` |
| `daily-plan` | voice3 | `kk news prepare` |
| `daily-preflight` | voice3 | `kk news prepare` |
| `daily-publish-prep` | voice3 | `kk news generate-bundle --stage variants` |
| `daily-qc-content` | voice3 | `kk news prepare` |
| `daily-quality-report` | voice3 | `kk news generate-voice` |
| `daily-quality-verdict` | voice3 | `kk news generate-voice` |
| `daily-safety-gate` | kk-daily-safety | kept (nested workflow unchanged) |
| `daily-safety-manifest` | voice3 | `kk news generate-bundle --stage variants` |
| `daily-safety-prep` | kk-daily-safety | kept |
| `daily-safety-revise` | kk-daily-safety | kept |
| `daily-safety-verdict` | kk-daily-safety | kept |
| `daily-script` | voice3 | `kk news generate-render` |
| `daily-script-check` | voice3 | `kk news generate-check --step script` |
| `daily-script-style` | voice3 | **not called** by the new workflow — replaced by the `skill_dir` var (§2.2); the body stays for `kk-daily-ai-voice.yaml` / `voice2`, which are out of scope |
| `daily-show-notes` | voice3 | `kk news generate-voice` |
| `daily-voice-audit` | voice3 | `kk news generate-voice` |
| `daily-wrap-docs` | voice3 | `kk news generate-render` |
| `daily-xhs-render` | voice3 | `kk news generate-cards` |
| `itc-adapt-verify` | kk-itc | `kk article generate-check --step adapt` |
| `itc-author-complete` | kk-itc, kk-itc-author | `kk article generate-bundle --stage freeze` |
| `itc-author-verdict` | kk-itc-author | `kk article generate-check --step judge` |
| `itc-check-targets` | kk-itc, publish-tail | `kk article publish-plan` + `publish-check` |
| `itc-decision` | kk-itc-author | `kk article generate-check --step outline` |
| `itc-export-seo` | kk-itc, publish-tail | `kk article publish-report` |
| `itc-materialize-plan` | kk-itc | `kk article generate-bundle --stage variants` |
| `itc-outline-pick` | kk-itc-author | `kk article generate-check --step outline` |
| `itc-prepare` | kk-itc | `kk article new` |
| `itc-reconcile-receipts` | kk-itc, publish-tail | `kk article publish-settle` |
| `itc-report-summary` | kk-itc, publish-tail | `kk article publish-report` |
| `itc-send-targets` | kk-itc, publish-tail | `kk article publish-send [--retry]` |
| `prepare-itc` | kk-itc | `kk article new` |
| `publish-matrix-bundle` | voice3 | `kk news generate-bundle --stage freeze` |
| `publish-matrix-check` | voice3, publish3 | `kk news prepare` (session warnings); `publish-check` |
| `publish-matrix-classify` | publish3 | `publish-settle` |
| `publish-matrix-partial` | publish3 | `publish-settle` |
| `publish-matrix-patch-surfdash` | publish3 | `publish-settle` (window `after-generate` only) |
| `publish-matrix-plan` | publish3 | `publish-plan` |
| `publish-matrix-rss-gate` | publish3 | `publish-plan` (window `overseas-rss`) |
| `publish-matrix-send` | publish3 | `publish-send [--retry] [--tier]` |
| `publish-matrix-settle` | publish3 | `publish-settle` |
| `publish-matrix-validate` | publish3 | `publish-plan` |
| `publish-matrix-wait-until` | publish3 | `publish-plan` (window `cn-peak`) |

No stage is deleted outright: each body is called by the verb that replaces its node. What is
deleted is the stage *name* as a public spelling, one release after cut-over (§1.4).

---

## 7. Retirement list

Deleted at Phase 4 cut-over, after one green scheduled day on the new jobs:

| Path | Replaced by |
| --- | --- |
| `scripts/daily-ai-news.ts` | `kk news generate` / `publish` / `status` |
| `scripts/publish-article.ts` | `kk article new --from` + `kk article publish` |
| `plugins/kk/scripts/daily-scheduled-run.ts` | `apps/cli/src/launch.ts` |
| `plugins/kk/scripts/voice3-publish-window.ts` | `kk news publish` |
| `plugins/kk/workflows/kk-daily-ai-voice3.yaml` | `kk-news-generate.yaml` |
| `plugins/kk/workflows/kk-daily-publish3.yaml` | `kk-publish.yaml` |
| `plugins/kk/workflows/kk-itc.yaml`, `kk-itc-author.yaml` | `kk-article-generate.yaml` |
| `plugins/kk/workflows/kk-itc-publish-tail.yaml` | `kk-publish.yaml` |
| `apps/cli/src/commands/itc.ts`, `daily.ts` (as visible nouns) | hidden routes for one release, then removed |

Not retired by G61: `kk-daily-ai-voice.yaml`, `kk-daily-ai-voice2.yaml` (out of scope, untouched),
`kk-daily-safety.yaml`, and the stage bodies in `plugins/kk/scripts/daily-stages.ts` — the new
verbs call them where they are. Moving 5,397 lines into `apps/cli` is a separate decision with
its own release-coupling cost (script stages are read as source, `apps/cli` as build output).

Replacement `.spur/config.yaml` job lines (names unchanged so history stays continuous):

```yaml
- name: kk-daily-ai-voice
  cron: "30 4 * * *"
  command: kk news generate --publish
- name: kk-daily-publish3
  cron: "0 7 * * *"
  command: kk news publish --window overseas-rss --unattended
- name: kk-daily-publish3-cn-peak
  cron: "0 17 * * *"
  command: kk news publish --window cn-peak --unattended
```

Today's lines are `bun scripts/daily-ai-news.ts generate --full` and
`… publish --window <w> --unattended` (`.spur/config.yaml:151,176,188`). Editing that file is an
operator-approved step of the cut-over task, not of this design.

---

## 8. Phase 2–4 task list

Each task is at most about a day, names the files it owns, and is filled to the 0360/0361
standard in the task corpus. Dependencies are the only allowed sharing of an owned file.

| Phase | Task | Owns | Depends on | Covers feature scenario |
| --- | --- | --- | --- | --- |
| 2 | **0363** `content_types` config + `kk article`/`kk news` nouns with `new` and `status` — **shipped** | `apps/cli/src/content-types.ts`, `apps/cli/src/commands/content.ts`, `apps/cli/src/cli.ts` | 0361 | — |
| 2 | **0364** Unified bundle/plan schema and the five `publish-*` step verbs — **shipped** | `apps/cli/src/publish-matrix.ts`, `apps/cli/src/commands/content-publish.ts` | 0361, 0363 | 5 (schema half) |
| 2 | **0365** `launchWorkflow()` and the plain verbs `generate` / `publish` | `apps/cli/src/launch.ts`, `apps/cli/src/commands/content-launch.ts` | 0360, 0363, 0364 | 2, 3 (re-proved in-binary) |
| 3 | **0366** `kk-publish.yaml` and news publish through it | `plugins/kk/workflows/kk-publish.yaml` | 0364, 0365 | 5, 6 |
| 3 | **0367** News generate step verbs and `kk-news-generate.yaml` | `apps/cli/src/commands/content-generate.ts`, `plugins/kk/workflows/kk-news-generate.yaml` | 0365, 0366 | 1 (re-proved) |
| 3 | **0368** Article generate verbs, `kk-article-generate.yaml`, article publish through `kk-publish` | `apps/cli/src/commands/content-generate-article.ts`, `plugins/kk/workflows/kk-article-generate.yaml`, `apps/cli/src/itc-config.ts` | 0366, 0367 | 5, 6 |
| 4 | **0369** Scheduler cut-over and retirement | `.spur/config.yaml` (operator-gated), every path in §7 | 0366, 0367, 0368 | 7 |

The chain is deliberately linear. Every task appends to the one verb list in
`apps/cli/src/commands/content.ts` and to `docs/04_DESIGN.md` §1.14 (surface docs ship in the same
commit as surface code), so two of them open at once would collide on those files. 0360 and 0361
are the only tasks that can run in parallel with each other.

---

## Decisions (2026-11-13)

Accepted by the operator; items 1, 2 and 5 are recorded as the 2026-11-13 amendment to ADR-053.

1. **Generate step verbs (§1.3)** — accepted: `generate-check`, `generate-render`,
   `generate-voice`, `generate-cards`, `generate-bundle`.
2. **Run directories (§4.3)** — renamed to the workflow name (`kk-news-generate`,
   `kk-article-generate`); `works_namespace` is not introduced; history is not migrated; phase
   directory names are unchanged.
3. **Stage bodies stay in `plugins/kk/scripts/` (§7)** — accepted.
4. **Schedule owner** — testing and the cut-over rehearsal run on the operator's laptop;
   production runs on the Mac mini. 0369 therefore has two stages: prove on the laptop, then
   install and enable on the Mac mini.
5. **Channel configuration (§2.1)** — `content_types.<type>.channels` in user config is the single
   operator switchboard; presets keep structure and defaults; `--channels`/`--live-channels`
   stay per-run. `enable_<channel>` workflow variables were considered and not taken.
6. **Writer skill is read in place (§2.2)** — the per-run copy under `20-editorial/` is dropped;
   the launching verb passes `skill_dir` and records the skill hash in the receipt. Amends the
   "How the skill reaches the writer" paragraph of ADR-045.
