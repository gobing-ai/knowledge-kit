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
  `kk-storm-research` (default), `kk-itc`, `kk-solo-podcast`. Any other name after successful copy → exit 1 listing
  `kk-storm-research`, `kk-itc`, `kk-solo-podcast`.
- `--in <file>` → file mode. `--force` → overwrite an existing dest YAML / existing `brief.md`.
- Profile `kk-storm-research`: `--dir <path>` (default `$works_dir/kk-storm-research/<topic-id>`),
  `--fixture` → force `fixture: "true"`.
- Profile `kk-itc`: `--dir <path>` (default `$works_dir/kk-itc/<kebab>`), `--playbook generic|english|wechat` (default `generic`),
  `--research` (`true`|`false`, default `false`), `--judge` (`true`|`false`, default `false`),
  `--outline <a|b|c>` (default empty), `--writer itc-generating|topic` (default `itc-generating`).
  `--fixture` passed with `kk-itc` or `kk-solo-podcast` → exit 1 (`fixture is storm-only`).
- Profile `kk-solo-podcast`: `--dir <path>` (default `$works_dir/kk-solo-podcast/<date>`), `--outline <a|b|c>`
  (default empty), `--duration <min>` (default `8`), `--language <code>` (default `en`),
  `--script-approved` (sets `script_approved=true`; default off). `--fixture` is storm-only.
- **XOR:** exactly one of `<topic>` / `--in <file>`. Both set or both empty → exit 1, stderr
  states the XOR rule, no writes.

Resolve these before step 2: `NAME`, `TOPIC`, `INPUT_FILE` (empty in sentence mode), `FIXTURE`
(`true`|`false`), `FORCE` (`true`|`false`), `DIR`, `PLAYBOOK`, `RESEARCH`, `JUDGE`, `OUTLINE`,
`WRITER`, `DURATION` (`8`), `LANGUAGE` (`en`), `SCRIPT_APPROVED` (`true`|`false`),
`VOICE_PROFILE` (from `VOICEBOX_DEFAULT_PROFILE`, default empty).

## 2. Resolve the config

`config_path="${KK_CONFIG:-$HOME/.config/kk/config.yaml}"`.

- **Missing file → create-on-first-run** with compiled defaults (never overwrite an existing
  file — no merge, no rewrite):

```bash
install -d "$(dirname "$config_path")"
cat > "$config_path" <<'EOF'
works_dir: "$HOME/.config/kk/works"
workflows_dir: "$HOME/.config/kk/workflows"
defaults:
  maxResults: 8
  fixture: false
EOF
```

- **Unreadable / unparseable / invalid types** (e.g. `maxResults: "eight"`) → exit 1, stderr
  names the key and expected vs actual type; touch nothing.
- Read the four values with precedence **command flag > env > file > compiled default**:

| Value | Env override | Compiled default |
| --- | --- | --- |
| `works_dir` | `KK_WORKS_DIR` | `$HOME/.config/kk/works` |
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
- Sidecars (`plugins/kk/scripts/validate-voicescript.ts`, `plugins/kk/scripts/wrap-voicescript-doc.ts`) are **not copied** —
  the workflow's own fallback chain resolves them via `$KK_WORKFLOWS_DIR`, the package
  root, then `$HOME/.config/kk/workflows`.

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

`raw` = `TOPIC` or file-mode first ATX H1 else basename without extension.
`kebab` = lower-case, `[^a-z0-9]+` → `-`, trimmed dashes (no length cap, no sha256 hash).
`work_dir="${DIR:-$works_dir/kk-itc/$kebab}"`. Empty derived `kebab` → exit 1. An explicit
`--dir` still wins, and the default never writes into the caller's cwd.

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

Bind vars: `topic`, `input_file`, `work_dir`, `writer`, `playbook`, `research`, `judge`, `outline`,
`force`, `rubric` (`tech-accuracy`), `agent`. The judge verdict lands at `$work_dir/.itc-verdict.json`
(fixed path inside the workflow).

```bash
spur workflow run "$dest" --vars \
  "{\"topic\":\"$TOPIC\",\"input_file\":\"$INPUT_FILE\",\"work_dir\":\"$work_dir\",\"writer\":\"$WRITER\",\"playbook\":\"$PLAYBOOK\",\"research\":\"$RESEARCH\",\"judge\":\"$JUDGE\",\"outline\":\"$OUTLINE\",\"force\":\"$FORCE\",\"rubric\":\"tech-accuracy\",\"agent\":\"$AGENT\"}"
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

## 6. Report

- **`kk-storm-research`**: print resolved `work_dir`, then `$work_dir/content.md` (report sidecar)
  and `$work_dir/content.json` (machine contract). Skim `content.md` citations against `docs.json`
  ids before presenting.
- **`kk-itc`**: print resolved `work_dir`, then `$work_dir/brief.md`, `$work_dir/2-outline/outline-approved.md`,
  and `$work_dir/3-draft-draft-article.md`. If `judge=true`, also print the verdict path.
- **`kk-solo-podcast`**: print resolved `work_dir`, then `$work_dir/1-briefing-briefing.md`,
  `$work_dir/3-script-voicescript.yaml`, `$work_dir/4-audio/content.json`, and
  `$work_dir/4-audio/content.wav`.

If the run ended `failed`, show the failing state (`spur workflow trace <run-id> --json`) and the
fail-loud recovery line.
