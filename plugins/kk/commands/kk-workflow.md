---
description: >-
  Run STORM daily research end to end — a topic sentence XOR a markdown file becomes a
  grounded content.md report. Installs the workflow YAML on first run (0056 copy rule),
  creates the config with defaults if missing, computes the topic workspace, and shells
  spur workflow run against the installed workflow.
argument-hint: "[name] <topic|--in file> [--fixture] [--force]"
---

Thin wrapper around the **kk-storm-research** skill. Read
`plugins/kk/skills/kk-storm-research/SKILL.md` first — it is the craft SSOT (query framing,
evidence verification, better-report practices, fail-loud rows). This command owns the run
procedure: config create, YAML install, topic-id computation, and the `spur workflow run`.
No new `kk` CLI noun (ADR-011) — everything here is shell + the workflow.

**Args:** `$ARGUMENTS`

## 1. Parse `$ARGUMENTS`

Parse per the frozen rule:

- First token is the workflow **name** when it matches `^[a-z0-9][a-z0-9-]*$` and is not `--in`;
  otherwise `name=kk-storm-research` and that token is the topic.
- `--in <file>` → file mode. `--fixture` → force `fixture: "true"`. `--force` → overwrite an
  existing dest YAML.
- **XOR:** exactly one of `<topic>` / `--in <file>`. Both set or both empty → exit 1, stderr
  states the XOR rule, no writes.

Resolve these before step 2: `NAME`, `TOPIC`, `INPUT_FILE` (empty in sentence mode), `FIXTURE`
(`true`|`false`), `FORCE`.

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

## 3. Install the workflow YAML

`dest="$workflows_dir/$NAME.yaml"`. Copy from the **first hit** of, in order:

1. `$KK_WORKFLOWS_SOURCE/$NAME.yaml`
2. `plugins/kk/workflows/$NAME.yaml`
3. `.spur/workflows/$NAME.yaml`

- `dest` missing → copy from the first hit. Source missing from all three → exit 1, stderr
  lists the roots searched.
- `dest` exists + `--force` → overwrite from source.
- `dest` exists + identical bytes → no-op.
- `dest` exists + different bytes → **warn and leave** (run proceeds with the user's copy).

```bash
src=""
for d in "$KK_WORKFLOWS_SOURCE" "plugins/kk/workflows" ".spur/workflows"; do
  [ -n "$d" ] && [ -f "$d/$NAME.yaml" ] && { src="$d/$NAME.yaml"; break; }
done
[ -z "$src" ] && { echo "no source workflow for $NAME (searched KK_WORKFLOWS_SOURCE, plugins/kk/workflows, .spur/workflows)" >&2; exit 1; }
if [ ! -f "$dest" ] || [ "$FORCE" = true ]; then
  install -d "$(dirname "$dest")" && cp "$src" "$dest"
elif ! cmp -s "$src" "$dest"; then
  echo "warning: $dest differs from install source; leaving user copy (pass --force to replace)" >&2
fi
```

## 4. Compute the topic workspace (0056 `topicId`)

`raw` = `TOPIC` (sentence mode) or the first ATX H1 (`/^#\s+(.+)$/m`) else basename without
extension (`--in` mode). Then:

```bash
normalized=$(printf '%s' "$raw" | tr '[:upper:]' '[:lower:]' | tr -s '[:space:]' ' ' | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')
slug=$(printf '%s' "$normalized" | tr -cs 'a-z0-9' '-' | sed 's/^-*//; s/-*$//' | cut -c1-48 | sed 's/-*$//')
[ -z "$slug" ] && slug="topic"
hash=$(printf '%s' "$normalized" | shasum -a 256 | cut -c1-8)
topic_id="${slug}-${hash}"
work_dir="$works_dir/$topic_id"
```

- `raw` derives empty (no H1 and empty basename) → exit 1 with the derived value.
- Same `raw` → same workspace; **last write wins**; never fail on an existing works dir.

```bash
mkdir -p "$work_dir"
```

## 5. Run the workflow

All values are strings. Bind the vars first: `maxResults` and `fixture` from step 2;
`plugins_path` defaults to `./plugins` in a checkout, else the installed package `plugins/`
path or `KK_PLUGIN_PATH`; `render_script` stays `plugins/kk/scripts/render-md.ts`.

```bash
spur workflow run "$dest" --vars \
  "{\"topic\":\"$TOPIC\",\"input_file\":\"$INPUT_FILE\",\"maxResults\":\"$maxResults\",\"fixture\":\"$FIXTURE\",\"work_dir\":\"$work_dir\",\"plugins_path\":\"$plugins_path\",\"render_script\":\"$render_script\"}"
```

## 6. Report

Print the resolved `work_dir`, then the two artifacts to hand the operator:
`$work_dir/content.md` (report sidecar) and `$work_dir/content.json` (machine contract).
Per the skill's better-report practice (d), skim `content.md` citations against `docs.json`
ids before presenting. If the run ended `failed`, show the failing state
(`spur workflow trace <run-id> --json`) and the skill's fail-loud recovery row.
