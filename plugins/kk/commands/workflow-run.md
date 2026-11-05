---
name: workflow-run
description: >-
  Run STORM daily research, IT content authoring, or solo-podcast end to end.
  Resolves the workflow YAML from the user override, KK_WORKFLOWS_SOURCE, bun/npm
  global installs, the kk package root, or a repo checkout — runs in place from any cwd;
  creates the config with defaults if missing; computes the workspace; shells
  spur workflow run against the resolved YAML.
argument-hint: "[name] <topic|--in file> [--dir <path>] [--playbook generic|english|wechat] [--research] [--judge] [--outline <a|b|c>] [--writer itc-generating|topic] [--duration <min>] [--language <code>] [--script-approved] [--fixture] [--force]"
---

Thin runner around the **storm-research**, **itc-generating** / **topic**, and **kk-solo-podcast**
capabilities. Read `plugins/kk/skills/storm-research/SKILL.md` or
`plugins/kk/skills/itc-generating/SKILL.md` for craft; solo-podcast craft lives in the
`audio-authoring` skill. This command owns the run procedure: config create,
workflow YAML resolution (user override → `$KK_WORKFLOWS_SOURCE` → **bun/npm global
install** → **installed package root** → repo checkout, runs in place from any cwd), workspace
computation, and the
`spur workflow run` of the resolved YAML. Design-time SSOT remains
`plugins/kk/workflows/` in the package/repo. No new `kk` CLI noun (ADR-011) — everything here
is shell + the workflow.

**Args:** `$ARGUMENTS`

## 1. Parse `$ARGUMENTS`

Parse per the frozen rule:

- First token is the workflow **name** when it matches `^[a-z0-9][a-z0-9-]*$` and is not `--in`;
  otherwise `name=kk-storm-research` and that token is the topic. Supported profile names:
  `kk-storm-research` (default), `kk-itc`, `kk-solo-podcast`, `kk-daily-ai-voice`. Any other name after successful copy → exit 1 listing
  `kk-storm-research`, `kk-itc`, `kk-solo-podcast`, `kk-daily-ai-voice`.
- `--in <file>` → file mode. `--force` → overwrite an existing dest YAML / existing `brief.md`.
- Profile `kk-storm-research`: `--dir <path>` (default `$works_dir/kk-storm-research/<topic-id>`),
  `--fixture` → force `fixture: "true"`.
- Profile `kk-itc`: `--dir <path>` (default `$works_dir/kk-itc/<kebab>[/<run-date>]`),
  `--from-collect <topic-profile>` (a third source, XOR with `<topic>` / `--in`),
  `--topic-profile <slug>`, `--run-date <YYYYMMDD>`, `--playbook generic|english|wechat`,
  `--research`, `--judge`, `--outline <a|b|c>`, `--writer itc-generating|topic`, `--auto`,
  `--unslop true|false`, `--max-revisions <N>`, `--cover`, `--inline-images`, `--targets <a,b>`,
  `--publish-preset <name>`, `--seo off|handoff`, `--live`, `--source-locale en|zh|ja`. Unpassed
  flags take `workflows.kk-itc` config, then compiled defaults (`generic`, `itc-generating`, `en`,
  `seo: off`, max revisions `2`, booleans `false`) — resolved once by `itc-prepare` (§4).
  `--fixture` passed with `kk-itc` or `kk-solo-podcast` → exit 1 (`fixture is storm-only`).
- Profile `kk-solo-podcast`: `--dir <path>` (default `$works_dir/kk-solo-podcast/<date>`), `--outline <a|b|c>`
  (default empty), `--duration <min>` (default `8`), `--language <code>` (default `en`),
  `--script-approved` (sets `script_approved=true`; default off). `--fixture` is storm-only.
- Profile `kk-daily-ai-voice`: `--dir <path>` (default `$works_dir/kk-daily-ai-voice/<date>`),
  `--publish <true|false>` (default `false`), `--last30days <true|false>` (default `false`),
  `--skip-review` (sets `skip_review=true`; default off). `--fixture` is storm-only.
- **XOR:** exactly one of `<topic>` / `--in <file>`. Both set or both empty → exit 1, stderr
  states the XOR rule, no writes.

Resolve these before step 2: `NAME`, `TOPIC`, `INPUT_FILE` (empty in sentence mode), `FIXTURE`
(`true`|`false`), `FORCE` (`true`|`false`), `DIR`, `PLAYBOOK`, `RESEARCH`, `JUDGE`, `OUTLINE`,
`WRITER`, `AUTO` (`true`|`false`), `UNSLOP` (`true`|`false`), `MAX_REVISIONS` (`2`), `COVER`
(`true`|`false`), `INLINE_IMAGES` (`true`|`false`), `TARGETS`, `LIVE` (`true`|`false`),
`SOURCE_LOCALE` (`en`), `DURATION` (`8`), `LANGUAGE` (`en`), `SCRIPT_APPROVED` (`true`|`false`),
`VOICE_PROFILE` (from `VOICEBOX_DEFAULT_PROFILE`, default empty).

## 2. Resolve the config

`config_path="${KK_CONFIG:-$HOME/.config/kk/config.yaml}"`.

- **Missing file → create-on-first-run** with compiled defaults (never overwrite an existing
  file — no merge, no rewrite):

```bash
install -d "$(dirname "$config_path")"
cat > "$config_path" <<EOF
works_dir: "$PWD/.works"
defaults:
  maxResults: 8
  fixture: false
EOF
```

`workflows_dir` is deliberately omitted (ADR-042): the shipped fallback chain is the primary
source, and a stale user override silently wins over newer package copies. `works_dir` is pinned
to the CURRENT directory's `.works` at creation time — the compiled default is cwd-relative, and
a headless/cron caller needs a fixed root.

- **Unreadable / unparseable / invalid types** (e.g. `maxResults: "eight"`) → exit 1, stderr
  names the key and expected vs actual type; touch nothing.
- Read the four values with precedence **command flag > env > file > compiled default**:

| Value | Env override | Compiled default |
| --- | --- | --- |
| `works_dir` | `KK_WORKS_DIR` | `<cwd>/.works` (ADR-042) |
| `workflows_dir` | `KK_WORKFLOWS_DIR` | `$HOME/.config/kk/workflows` |
| `defaults.maxResults` | — | `8` |
| `defaults.fixture` | — | `false` |

`--fixture` sets `fixture=true` regardless of the file. `FIRECRAWL_API_KEY` is **never** read
from config — env-only.

## 3. Resolve the workflow YAML (run anywhere)

The workflow YAML runs **in place** — no copy on the happy path. Resolve the `kk`
package root from the binary itself (works under bun/npm/nvm/homebrew prefixes):

```bash
kbin="$(command -v kk 2>/dev/null || true)"
while [ -L "$kbin" ]; do
  link="$(readlink "$kbin")"
  case "$link" in /*) kbin="$link";; *) kbin="$(dirname "$kbin")/$link";; esac
done
pkg=""; [ -n "$kbin" ] && pkg="$(cd "$(dirname "$kbin")/.." 2>/dev/null && pwd || true)"
# Global-install roots — the common no-config case (package installed with `bun install -g`
# or `npm i -g` and no `workflows_dir` written yet). Each probe is guarded, so a missing
# package manager never breaks the chain.
bun_global_workflows=""
if command -v bun >/dev/null 2>&1; then
  bg="$(dirname "$(bun pm bin -g 2>/dev/null)")/install/global/node_modules/@gobing-ai/knowledge-kit/plugins/kk/workflows"
  [ -d "$bg" ] && bun_global_workflows="$bg"
fi
npm_global_workflows=""
if command -v npm >/dev/null 2>&1; then
  ng="$(dirname "$(npm root -g 2>/dev/null)")/node_modules/@gobing-ai/knowledge-kit/plugins/kk/workflows"
  [ -d "$ng" ] && npm_global_workflows="$ng"
fi
```

Resolution order — first hit wins:

1. **User override** `$workflows_dir/$NAME.yaml` (default `~/.config/kk/workflows/`) —
   when it exists it always wins, and nothing is copied.
2. `$KK_WORKFLOWS_SOURCE/$NAME.yaml`
3. **bun global install** — `$(dirname $(bun pm bin -g))/install/global/node_modules/@gobing-ai/knowledge-kit/plugins/kk/workflows/$NAME.yaml`
4. **npm global install** — `$(dirname $(npm root -g))/node_modules/@gobing-ai/knowledge-kit/plugins/kk/workflows/$NAME.yaml`
5. `$pkg/plugins/kk/workflows/$NAME.yaml` — the installed package copy (resolved from the `kk` binary)
6. `plugins/kk/workflows/$NAME.yaml` — repo checkout (development)

A corrupt `config.yaml` already exited 1 in step 2; none of these probes runs before that check,
so no fallback masks a config error.

```bash
dest=""
if [ -f "$workflows_dir/$NAME.yaml" ]; then
  dest="$workflows_dir/$NAME.yaml"
else
  for d in "$KK_WORKFLOWS_SOURCE" "$bun_global_workflows" "$npm_global_workflows" ${pkg:+"$pkg/plugins/kk/workflows"} "plugins/kk/workflows"; do
    [ -n "$d" ] && [ -f "$d/$NAME.yaml" ] && { dest="$d/$NAME.yaml"; break; }
  done
  [ -z "$dest" ] && { echo "no source workflow for $NAME (searched $workflows_dir, KK_WORKFLOWS_SOURCE, bun/npm global installs, kk package root, plugins/kk/workflows)" >&2; exit 1; }
fi
# --force: refresh the user override from the best available source, then run the override.
if [ "$FORCE" = true ]; then
  src=""
  for d in "$KK_WORKFLOWS_SOURCE" "$bun_global_workflows" "$npm_global_workflows" ${pkg:+"$pkg/plugins/kk/workflows"} "plugins/kk/workflows"; do
    [ -n "$d" ] && [ -f "$d/$NAME.yaml" ] && { src="$d/$NAME.yaml"; break; }
  done
  [ -z "$src" ] && { echo "no source workflow for $NAME to force-install (searched KK_WORKFLOWS_SOURCE, bun/npm global installs, kk package root, plugins/kk/workflows)" >&2; exit 1; }
  install -d "$workflows_dir" && cp "$src" "$workflows_dir/$NAME.yaml"
  dest="$workflows_dir/$NAME.yaml"
fi
```

- To customize a workflow, copy it to `$workflows_dir/$NAME.yaml` yourself (or use
  `--force` to place a fresh copy there) — that override wins on every later run.
- No auto-copy, no drift warnings: the package copy is versioned with the CLI and
  never goes stale; overrides are explicit.
- Sidecars (`plugins/kk/scripts/kk-workflow-stages.ts`, plus the
  `validate-voicescript.ts` / `wrap-voicescript-doc.ts` it delegates to) are **not copied** —
  the workflow resolves the stage runner from the package root, and the runner resolves each
  sidecar via the explicit var, `$KK_WORKFLOWS_DIR`, the package copy, then
  `$HOME/.config/kk/workflows`.

## 4. Compute workspace

### Profile `kk-storm-research` (0056 `topicId`)

`raw` = `TOPIC` (sentence mode) or the first ATX H1 (`/^#\s+(.+)$/m`) else basename without
extension (`--in` mode). Then:

```bash
normalized=$(printf '%s' "$raw" | tr '[:upper:]' '[:lower:]' | tr -s '[:space:]' ' ' | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')
slug=$(printf '%s' "$normalized" | tr -cs 'a-z0-9' '-' | sed 's/^-*//; s/-*$//' | cut -c1-48 | sed 's/-*$//')
[ -z "$slug" ] && slug="topic"
hash=$(printf '%s' "$normalized" | shasum -a 256 | cut -c1-8)
topic_id="${slug}-${hash}"
work_dir="${DIR:-$works_dir/kk-storm-research/$topic_id}"
```

- `raw` derives empty (no H1 and empty basename) → exit 1 with the derived value.
- Same `raw` → same workspace; **last write wins**; never fail on an existing works dir.

```bash
mkdir -p "$work_dir"
```

### Profile `kk-itc` (authoring workspace)

The workspace and every config-backed option are resolved and **frozen** by
`kk stage run itc-prepare` (0303) — never re-derived here. Pre-generate the run id first, so the
frozen `itc-options.json` binds to the run that will consume it:

```bash
RUN_ID="kk-itc-$(date +%Y%m%dT%H%M%S)-$$"
launch="$(mktemp)"
# Unpassed flags stay "" and are dropped: they fall to workflows.kk-itc config, then compiled defaults.
jq -n --arg topic "$TOPIC" --arg inputFile "$INPUT_FILE" --arg fromCollect "$FROM_COLLECT" --arg dir "$DIR" \
  --arg parentRunId "$RUN_ID" --arg topicProfile "$TOPIC_PROFILE" --arg runDate "$RUN_DATE" \
  --arg writer "$WRITER" --arg playbook "$PLAYBOOK" --arg sourceLocale "$SOURCE_LOCALE" \
  --arg publishTargets "$TARGETS" --arg publishPreset "$PRESET" --arg seo "$SEO" --arg maxRevisions "$MAX_REVISIONS" \
  --arg research "$RESEARCH" --arg judge "$JUDGE" --arg auto "$AUTO" --arg unslop "$UNSLOP" --arg force "$FORCE" \
  --arg publishLive "$LIVE" --arg coverEnabled "$COVER" --arg inlineImages "$INLINE_IMAGES" \
  '$ARGS.named | with_entries(select(.value != ""))
    | with_entries(if (.key | IN("research","judge","auto","unslop","force","publishLive","coverEnabled","inlineImages"))
        then .value = (.value == "true") else . end)
    | if has("maxRevisions") then .maxRevisions |= tonumber else . end' > "$launch"
work_dir=$(kk stage run itc-prepare --request "$launch" | jq -r '.workDir')
```

Exactly one of `topic` | `inputFile` | `fromCollect`. An invalid key, config file or source fails
before any workspace is written.

Binding (0153), applied once by `itc-prepare`: `--auto` binds `auto=true` and defaults `research`, `judge` and `unslop` to
`true` unless the operator passed them explicitly. `--live` is never implied — `publish_live`
stays `false` unless `--live` is passed explicitly (ADR-022). `--playbook wechat` without
`--source-locale` binds `source_locale=zh`; an explicit `--source-locale` always wins.
`--targets <a,b>` binds `publish_targets`; `--cover` / `--inline-images` bind
`cover_enabled` / `inline_images` (`false` unless passed); `--max-revisions` binds
`max_revisions` (default `2`). Each lands in `itc-options.json` under its camelCase key.

Two var-only child options skip the options snapshot: `outline_bullets_only=true` keeps the
outline stage to heading-plus-bullets options (no prose paragraphs), and `plan_only=true`
stops the parent DAG after the confirmed publish plan (no `send-confirm` pause, no fanout-send,
no recovery, no settle) — a plan preview, not a send.

**Collected topic (`--from-collect <profile>`, 0299).** `itc-prepare` without `--chosen` returns
an *intake* snapshot (`status: intake`, `workDir: null`). Choose the topic in a run-scoped intake
dir, then finalize:

1. `kk stage run itc-topic-extract --request` `{parentRunId, intakeDir, topicProfile}` → the pool.
2. The agent (or `kk itc candidates`) writes `$intakeDir/topic-candidates.json` (≤5 candidates `a|b|c` up to `d|e` with
   `title`/`reason`/`itemIds` from the pool); `kk stage run itc-topic-validate --request`
   `{parentRunId, intakeDir}` must pass.
3. `kk stage run itc-decision --topic "$intakeDir" "$RUN_ID"` prints the chosen id or `defer`.
   **`defer` stops** — ask the operator to pick (never fall back to the first candidate).
4. `kk stage run itc-topic-select --request` `{parentRunId, intakeDir, selectedCandidateId}`.
5. `work_dir=$(kk stage run itc-prepare --request "$launch" --chosen "$intakeDir" | jq -r .workDir)`
   finalizes the snapshot under the chosen title and copies the selection evidence into the workspace.

### Profile `kk-solo-podcast`

`date` = today's date in `YYYY-MM-DD` (`$(date +%Y-%m-%d)`).
`raw` = `TOPIC` or file-mode first ATX H1 else basename without extension.
`kebab` = lower-case, `[^a-z0-9]+` → `-`, trimmed dashes (no length cap, no sha256 hash).
`work_dir="${DIR:-$works_dir/kk-solo-podcast/$date}"`.

### Profile `kk-daily-ai-voice`

Same `date` / `raw` / `kebab` derivation as `kk-solo-podcast`.
`work_dir="${DIR:-$works_dir/kk-daily-ai-voice/$date}"`.

Every profile's default puts its workspace in **its own** `$works_dir/<workflow-name>/` namespace;
an explicit `--dir` overrides all four defaults.

## 5. Run the workflow

All values are strings.

### Profile `kk-storm-research`

Bind vars: `maxResults` and `fixture` from step 2; `plugins_path` defaults to `./plugins`
in a checkout, else `$pkg/plugins` (package root from step 3) or `KK_PLUGIN_PATH`;
`render_script` is `plugins/kk/scripts/render-md.ts` in a checkout, else
`$pkg/plugins/kk/scripts/render-md.ts`.

```bash
spur workflow run "$dest" --vars \
  "{\"topic\":\"$TOPIC\",\"input_file\":\"$INPUT_FILE\",\"maxResults\":\"$maxResults\",\"fixture\":\"$FIXTURE\",\"work_dir\":\"$work_dir\",\"plugins_path\":\"$plugins_path\",\"render_script\":\"$render_script\"}"
```

### Profile `kk-itc`

Launch under the **same** `RUN_ID` the snapshot was frozen for; the `prepare` node refuses a
snapshot owned by another run unless `force=true`. Downstream nodes read options from
`$work_dir/itc-options.json`, so the vars only locate the workspace and carry run-local inputs:
`work_dir`, `topic_profile`, `publish_preset`, `seo_mode`, `from_collect`, `run_date`, `outline`,
`force`, `rubric` (`tech-accuracy`), `agent`. The judge verdict lands at
`$work_dir/.itc-verdict.json`. A live plan with targets pauses at `send-confirm`: resuming
(`spur workflow continue $RUN_ID`) approves the send, cancelling rejects it.

```bash
spur workflow run "$dest" --run-id "$RUN_ID" --vars \
  "{\"work_dir\":\"$work_dir\",\"topic_profile\":\"$TOPIC_PROFILE\",\"publish_preset\":\"$PRESET\",\"seo_mode\":\"$SEO\",\"from_collect\":\"$FROM_COLLECT\",\"run_date\":\"$RUN_DATE\",\"outline\":\"$OUTLINE\",\"force\":\"$FORCE\",\"rubric\":\"tech-accuracy\",\"agent\":\"$AGENT\"}"
```

### Profile `kk-solo-podcast`

Bind vars: `topic`, `input_file`, `work_dir`, `outline`, `script_approved`, `force`,
`target_duration_min`, `language`, `voice_profile` (from `VOICEBOX_DEFAULT_PROFILE` or empty),
`validate_script` (`$workflows_dir/validate-voicescript.ts` when that override exists, else
empty), `wrap_script` (`$workflows_dir/wrap-voicescript-doc.ts` when that override exists,
else empty) — empty binds let the workflow's fallback chain resolve via the package root.
`plugins_path` (empty → ADR-012 default discovery), `agent`. `$dest` is the user override
when present, else the package/checkout YAML resolved in step 3 — never a hardcoded path.

```bash
vs_arg=""; [ -f "$workflows_dir/validate-voicescript.ts" ] && vs_arg="$workflows_dir/validate-voicescript.ts"
ws_arg=""; [ -f "$workflows_dir/wrap-voicescript-doc.ts" ] && ws_arg="$workflows_dir/wrap-voicescript-doc.ts"
spur workflow run "$dest" --vars \
  "{\"topic\":\"$TOPIC\",\"input_file\":\"$INPUT_FILE\",\"work_dir\":\"$work_dir\",\"outline\":\"$OUTLINE\",\"script_approved\":\"$SCRIPT_APPROVED\",\"force\":\"$FORCE\",\"target_duration_min\":\"$DURATION\",\"language\":\"$LANGUAGE\",\"voice_profile\":\"$VOICE_PROFILE\",\"validate_script\":\"$vs_arg\",\"wrap_script\":\"$ws_arg\",\"plugins_path\":\"\",\"agent\":\"$AGENT\"}"
```

### Profile `kk-daily-ai-voice`

Bind vars: `work_dir`, `run_date`, `publish_enabled`, `last30days_enabled`, `skip_review`,
`plugins_path` (empty → ADR-012 default discovery), `agent`. `$dest` resolves like solo-podcast.
The run is topicless — no `topic`/`input_file`/`fixture` vars. `run_date` is optional: empty →
today (manual path), or a dashed/digits date for backfills (headless cron path). `daily-prepare`
derives the digits-only stamp from it and composes `work_dir` when empty:
`$works_dir/kk-daily-ai-voice/<yyyymmdd>`; an explicit `work_dir` wins. Either way the effective
workspace lands in the anchor `.spur/runs/kk-daily-ai-voice/work-dir.txt` and the stamp in
`$work_dir/run-date.txt`. The `review` state pauses the run for operator approval of the
VoiceScript; resume with `spur workflow continue [run-id]`.

```bash
spur workflow run "$dest" --vars \
  "{\"work_dir\":\"$work_dir\",\"run_date\":\"\",\"publish_enabled\":\"$PUBLISH\",\"last30days_enabled\":\"$L30D\",\"skip_review\":\"$SKIP_REVIEW\",\"plugins_path\":\"\",\"agent\":\"$AGENT\"}"
```

## 6. Report

- **`kk-storm-research`**: print resolved `work_dir`, then `$work_dir/content.md` (report sidecar)
  and `$work_dir/content.json` (machine contract). Skim `content.md` citations against `docs.json`
  ids before presenting.
- **`kk-itc`**: print resolved `work_dir`, then `$work_dir/brief.md`, `$work_dir/2-outline/outline-approved.md`,
  and `$work_dir/3-draft-draft-article.md`. If `judge=true`, also print the verdict path.
- **`kk-solo-podcast`**: print resolved `work_dir`, then `$work_dir/1-briefing-briefing.md`,
  `$work_dir/3-script-voicescript.yaml`, `$work_dir/4-audio/content.json`, and
  `$work_dir/4-audio/content.wav`.
- **`kk-daily-ai-voice`**: print resolved `work_dir` (read the date from `$work_dir/run-date.txt`),
  then `$work_dir/22-article/<date>_06_article_article.md`,
  `$work_dir/24-script/<date>_08_script_voicescript.yaml`,
  `$work_dir/30-audio/<date>_11_generate_content.json` (carries the audio path and QC metrics),
  and `$work_dir/<date>_19_run-report_report.md`. With `publish_enabled=true` also print
  `$work_dir/31-publish/<date>_17_publish_publish-status.txt` and the
  `<date>_14_publish-surfdash_result.json` / `<date>_16_publish-podcast_result.json` outcomes.

If the run ended `failed`, show the failing state (`spur workflow trace <run-id> --json`) and the
fail-loud recovery line.
