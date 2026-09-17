# @gobing-ai/knowledge-kit

**Ingest → Create → Publish** — a content pipeline CLI. `knowledge-kit` turns documents (or
just a topic brief) into finished, published content across multiple channels.

> **The name is historical.** knowledge-kit is not only a knowledge-management tool: content
> creation and multi-channel publishing are first-class, co-equal capabilities, and
> **ingestion is optional** — a pipeline may start from a `Brief` (topic → article) with no
> ingested documents.

The binary installs as both `kk` and `knowledge-kit`. Pipelines are expressed as **plugins**
(ingestion / generator / publish) wired together by [spur](https://www.npmjs.com/package/@gobing-ai/spur)
workflows — `kk` owns each step, `spur` owns the orchestration.

## Install

```bash
bun add -g @gobing-ai/knowledge-kit
```

Requires [Bun](https://bun.sh) ≥ 1.3.14.

### Optional: install the `kk` agent plugin collection

The npm tarball ships the `kk` plugin collection (skills, commands, agents, hooks, rules) for
coding agents. Install it globally via [superskill](https://www.npmjs.com/package/@gobing-ai/superskill):

```bash
bun add -g @gobing-ai/superskill
superskill install kk --marketplace https://github.com/gobing-ai/knowledge-kit
```

The repo is private, so superskill needs a GitHub token in the environment
(`GITHUB_TOKEN` or `GH_TOKEN`). It caches under `~/.cache/superskill/marketplaces`
(a warm cache works offline).

## Commands

| Command | What it does |
| --- | --- |
| `kk executor run <plugin> --in <path> --out <path>` | Invoke a plugin with input/output files and contract validation |
| `kk executor fan-in` | Merge N `Doc[]` JSON inputs into one deduplicated `Doc[]` output |
| `kk executor fan-out` | Publish one `Content` JSON to N targets, aggregating per-target results |
| `kk plugin status` | List discovered plugins grouped by kind with per-plugin health (`--kind`, `--json`) |
| `kk -v, --verbose` | Enable verbose diagnostics |
| `kk --help` / `kk <command> --help` | Full flag reference |

Hidden one-release aliases (`invoke`, `fanin`, `fanout`, `plugins list`, `plugins doctor`)
still work but are not listed in `kk --help`.

## The plugin model

Plugins are directories with a `plugin.json` manifest, discovered by a registry scan across
built-in, user, project, and `KK_PLUGIN_PATH` roots. Three kinds:

| Kind | Contract | Shipped examples |
| --- | --- | --- |
| `ingestion` | `source → Doc[]` | `karakeep-local`, `web-search`, `last30days-ingest` |
| `generator` | `Doc[] \| Brief → Content` | `content-gen` (owned STORM pipeline), `voice-gen` (Voicebox TTS) |
| `publish` | `Content → Result` | `surfdash-pub`, `zenn-pub`, `qiita-pub` |

Core contracts (`Doc`, `Brief`, `Content`, `Result`) and per-kind validation live in
`@gobing-ai/kk-core`. **LLM-as-judge is not a plugin kind** — quality gating is delivered as
agent skills + `agent.run` in the `kk` plugin collection.

## Documentation

Source repo: [gobing-ai/knowledge-kit](https://github.com/gobing-ai/knowledge-kit) —
architecture decisions (`docs/00_ADR.md`), command surface (`docs/04_DESIGN.md`), feature
status (`docs/05_FEATURES.md`), and per-kind plugin authoring specs (`docs/design/`).

## License

[Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0)
