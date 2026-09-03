# Ingestion Source Adapters: last30days + Horizon → `Doc[]`

Status: `wayfinder:research` brief for task 0089. **No production code, no plugin scaffolds.** This is the non-corpus companion to the corpus deliverable (task 0089 `## Solution`). Both sources terminate in `Doc[]` per `docs/design/ingestion-plugin-specification.md` §2.

Scope: exactly two sources (map F61). No dedup/merge semantics (0090's job). Adapter decision per source = **ingestion plugin (kind `ingestion`)** vs workflow shell step, with rationale.

## Shared recommendation

Both sources are external Python CLIs that already emit their own artifact and carry their own env/config/secrets. Chosen adapter for each: an **ingestion plugin (kind `ingestion`)** —

- `plugins/ingestions/last30days-ingest/` (plugin.json `kind: ingestion`, TS entry)
- `plugins/ingestions/horizon-ingest/` (plugin.json `kind: ingestion`, TS entry)

**Rationale (shared):**

1. **Pipeline uniformity.** The collect stage is `kk executor run <name>` per source, so `kk executor fan-in` merges plugin `--out` paths uniformly (0088 design; fan-in/fan-out are kk subcommands, not engine states). A shell step would put the mapping in ad-hoc workflow YAML — less testable, not reusable, and it breaks the "kk owns steps" contract.
2. **Contract for free** (spec §1.3–1.4, §2): env-inherited secrets (never in plugin.json), `--out` validated against `DocListSchema`, exit-code + partial-item failure semantics, empty-output → `[]` exit 0, discovery registration under `plugins/ingestions/` (ADR-009 / ADR-012).
3. **Single owned boundary.** The plugin is the one place that owns "external-tool artifact → `Doc[]`". A shell step splits that schema knowledge across workflow states.

**Honest caveat (Ponytail):** both plugins are thin wrappers around a heavy, stateful external tool; the actual fetch/score/enrich is the tool's job, not the plugin's. Neither crawl is network-free — the ingest step is the live boundary of the daily pipeline. The plugin adds the boundary, not the crawl.

**Rejected alternative:** a workflow shell step producing JSON. It was considered and rejected because it moves the `Doc[]` mapping into YAML, bypasses `DocSchema` validation, and leaves the external tool's schema knowledge split across states. (Both recommendations stay consistent with 0088's frozen home of "ingestion plugin" for 1.1/1.2; this brief nails the invocation + output-shape contract that 0088 deferred.)

---

## last30days

### Invocation contract

- **Tool / entry:** `~/.agents/skills/last30days/scripts/last30days.py`. SKILL_DIR = the directory holding the loaded `SKILL.md`; `scripts/` is a sibling.
- **Runtime:** Python 3.12+ (engine requires 3.12; select via `LAST30DAYS_PYTHON` or `python3`). Requires `node` + `python3` on PATH.
- **Machine-readable command (what the plugin runs):**

  ```bash
  python3 scripts/last30days.py "<topic>" \
    --emit=json --json-profile=agent \
    --save-dir "<LAST30DAYS_MEMORY_DIR>" \
    [--plan "$QUERY_PLAN_FILE"] [--days N] [--as-of YYYY-MM-DD] \
    [--web-backend auto|brave|exa|serper|parallel|parallel-mcp|keyless|none] \
    [--store] [--output "<abs-out>"]
  ```

- `--emit=json` is the machine-readable mode (default `--emit=compact` is the human report). `--json-profile=agent` (default) is the stable, versioned, flat agent contract; `--json-profile=raw` is the full internal `Report` dump (local Report only — the remote API backend supports `raw` only).
- `--plan "$QUERY_PLAN_FILE"` is **required on named-entity topics** (LAW 7) — the plan is an engine-readable JSON query file the plugin/host writes.
- **Env / config:** `LAST30DAYS_MEMORY_DIR` (save/store dir; default `~/Documents/Last30Days`); `LAST30DAYS_API_KEY` + `LAST30DAYS_API_BASE` (remote backend, optional); tuning `LAST30DAYS_ENRICH_BUDGET_SECONDS`, `LAST30DAYS_NATIVE_SEARCH`, `LAST30DAYS_LIBRARY_CONTEXT`.
- **Secrets (env-inherited, never committed):** `SCRAPECREATORS_API_KEY` (primary) + optional `OPENAI_API_KEY`, `XAI_API_KEY`, `OPENROUTER_API_KEY`, `PERPLEXITY_API_KEY`, `PARALLEL_API_KEY`, `BRAVE_API_KEY`, `APIFY_API_TOKEN`, `AUTH_TOKEN`, `CT0`, `BSKY_HANDLE`, `BSKY_APP_PASSWORD`, `TRUTHSOCIAL_TOKEN`, `XIAOHONGSHU_API_BASE`.
- **First-run setup gate:** `SETUP_COMPLETE=true` in `~/.config/last30days/.env` must be present (installs yt-dlp, Digg CLI, extracts browser cookies). Until then the tool degrades to WebSearch-only.
- **Doctor / preflight (non-crawl diagnostics):** `python3 scripts/last30days.py doctor [--json]`, `--preflight`, `--diagnose`. (Allowed probe; NOT a crawl.)
- **Output artifact:** `--emit=json --json-profile=agent --save-dir <dir>` emits the agent JSON on stdout; `--output <file>` writes it to an exact path. Discovery runs write `discover-nominations.json` / `discover-pending.json`; `--store` persists to `<save-dir>/research.db`.
- **Boundaries (non-goals):** live network fan-out over the full source roster — credit-gated, minutes-long; it is the live ingest boundary, not a doc-store read. R1 scope: don't run the first-run wizard or browser-cookie extraction here (setup belongs to the tool).

### Output shape

`--emit=json --json-profile=agent` — flat, versioned. Top-level keys:

```json
{
  "schema_version": "<semver>",
  "query": "<topic>",
  "generated_at": "<iso8601>",
  "window_days": "<int>",
  "source_status": { "<source>": "<state>" },
  "freshness_verdicts": [ { "source": "...", "verdict": "...", "detail": "..." } ],
  "clusters": [
    { "title": "...", "summary": "...", "sources": ["..."], "engagement_total": "<int>" }
  ],
  "results": [
    {
      "candidate_id": "<stable candidate id>",
      "title": "...", "source": "...", "url": "...", "published_at": "...",
      "summary": "...", "engagement": "...", "relevance_score": "<0-1>",
      "cluster": "<index into clusters>"
    }
  ]
}
```

(`results[]` is the item-level grain; `clusters[]` is the grouped view. `source_status` states: `ok|no-results|partial|rate-limited|auth-failed|unreachable|timeout|schema-drift|skipped-unconfigured|error`. The agent profile carries **no** prose "What I learned" synthesis — that lives only in `--emit=compact`.)

### `Doc[]` mapping (adapter responsibility)

One Doc per `results[]` item (item-level grain = blend-friendly unit):

| Doc field | Source value |
| --- | --- |
| `id` | `last30days:{candidate_id}` (engine's stable id; fallback `sha256(url)`) |
| `title` | `results[].title` |
| `body` | `results[].summary` (the agent snippet) — join title + source + engagement when more context is needed |
| `sourceUri` | `results[].url` |
| `mediaType` | `text/markdown` |
| `metadata` | `{ topic: query, window_days, cluster: { index, title }, source, engagement, relevance_score, published_at?, schema_version }` |

- `id` determinism: derive from `candidate_id`/url so unchanged input → identical ids (spec §2.3).
- Empty `results` → plugin writes `[]` exit 0 (spec §2.4). Partial item failure → skip + stderr warning + exit 0.
- Optional: also emit cluster-level docs (one per `clusters[]`) if the blend wants a grouped grain. Report-level synthesis is not in agent JSON (would require parsing `--emit=compact` `--output` md — out of scope for v1).

### Adapter choice

**Ingestion plugin (`last30days-ingest`, kind `ingestion`).** Entry shells out to `last30days.py ... --emit=json --json-profile=agent`, captures stdout (or `--output` file), maps `results[]` → `Doc[]`.

Rationale: `results[]` is already structured in the agent JSON, so the plugin is a thin mapper only; secrets stay env-inherited; the topic passes via `--in` JSON config (spec §2.2 API-source semantics: `--in` = `{ topic, save_dir, web_backend, days, as_of, plan }`). A shell step was rejected because it would duplicate the mapping in YAML and split the `Doc` schema knowledge across states. **Weakness, stated:** last30days is a topic-research query (one report per `--in`), not a static document store, but the plugin boundary (`--in` topic config → `--out` `Doc[]`) still holds and keeps collect-stage uniform with Horizon.

---

## Horizon

### Invocation contract

- **Command:** `(cd ~/tools/Horizon && uv run horizon [--hours N] [-d <data-dir>] [-c <config>] [-l <level>])`. `uv` + Python 3.11+; deps in `pyproject.toml`; optional `--extra` (openbb/twitter/trafilatura) via `uv sync`.
- **Defaults:** `-d data`, `-c <data-dir>/config.json`, `-l WARNING`. `--hours N` forces fetch from last N hours; otherwise `collection.time_window_hours`.
- **Config (`data/config.json`, or `--config`):**
  - `sources`: `rss`, `github`, `hackernews`, `reddit`, `telegram`, `twitter` (Apify), `openbb` (extra), `ossinsight`, `gdelt`, `google_news`.
  - `collection.time_window_hours`.
  - `processing`: `profiles_dir` (default `profiles`), `default_profile`, `profile_settings` (`threshold` 0-10 or null, `topic_dedup`).
  - `digest`: `max_items`, `profile_order`, `category_groups`, `default_group`, `default_group_limit`.
  - `ai`: `provider`, `model`, `api_key_env`, `throttle_sec`, `analysis_concurrency`, `enrichment_concurrency`, `base_url?`, `languages`.
  - `display.icon_style`; optional `email` / `webhook` (out of scope for ingest).
- **Profiles** (`profiles/<id>/`): `profile.json` + `match.md` + `analysis.md` + `enrichment.md`. Built-ins: `finance-news`, `tech-news`, `tech-blog`. A `profile` on a source routes items; `default_profile` is the fallback.
- **Secrets (.env at repo root; `load_dotenv`):** `api_key_env` names env vars (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`, `MINIMAX_API_KEY`, `DASHSCOPE_API_KEY`, `DEEPSEEK_API_KEY`, …) and `APIFY_TOKEN` for Twitter. Secrets never live in config.json.
- **Output artifact:** `uv run horizon` fetches → routes to a profile → analyzes (0-10 score/reason/summary/tags) → filters (`threshold`) → dedups (`topic_dedup`) → enriches (localized blocks per `ai.languages`) → writes `<data-dir>/summaries/horizon-<YYYY-MM-DD>-<lang>.md` per language (and copies publishable MD into `docs/` for the GitHub Pages site).
- **MCP alternative (machine-readable):** `uv run horizon-mcp` exposes `hz_validate_config`, `hz_fetch_items`, `hz_score_items`, `hz_filter_items`, `hz_enrich_items`, `hz_generate_summary`, `hz_run_pipeline`.
- **Diagnostic (allowed probe):** `uv run horizon --help`; `horizon-webhook --dry-run` (render preview, no full pipeline). Running `uv run horizon` IS the live ingest boundary (network fetch + AI scoring).
- **Boundaries (non-goals):** Horizon is itself a multi-stage pipeline; the ingest step is the live boundary. No scheduling, no email/webhook subscription.

### Output shape

Primary artifact per language: `<data-dir>/summaries/horizon-<YYYY-MM-DD>-<lang>.md`.

- H1 title `# Horizon … - <date>`.
- Per-profile H2 sections (localized profile name), each with a ranked index list and the item blocks.
- Each item H3 block:
  - anchor `<a id="item-<profile>-<n>"></a>`
  - `### [title](url) ⭐️ <score>/10`
  - source line: `<source> · <sub/author> · <date> · [community discussion](url)`
  - localized enrichment blocks (per `profile.json` `enrichment.blocks`), e.g. `「背景说明」`, `「实际影响」`, `「社区讨论」`.
  - `<details><summary>参考链接</summary>` reference list.
  - `**标签**: #tag1 #tag2`.

`enrichment.blocks` ids, the 0-10 `score`, source category, and `tags` are the structured pieces an adapter parses.

### `Doc[]` mapping (adapter responsibility)

One Doc per item per language file (default single language; flatten `metadata.lang` if multi-lang):

| Doc field | Source value |
| --- | --- |
| `id` | `horizon:{url-slug}` (or `horizon:{date}-{profile}-{n}` anchor id) — deterministic from url/anchor |
| `title` | item title (the `### [title](url)` text) |
| `body` | the localized enrichment blocks joined (markdown body between the source line and the reference `<details>`) |
| `sourceUri` | item url |
| `mediaType` | `text/markdown` |
| `metadata` | `{ lang, profile, score, source_line, author, published_at, tags[], references[], date }` |

- `id` determinism: from the item URL / anchor id so unchanged items yield identical ids (spec §2.3).
- Empty digest → plugin writes `[]` exit 0.
- Robustness: parse the generated summary MD deterministically (no MCP session required); the MCP `hz_run_pipeline` JSON is the structured alternative when a session is available.

### Adapter choice

**Ingestion plugin (`horizon-ingest`, kind `ingestion`).** Entry runs `uv run horizon` (or the MCP pipeline), reads `<data-dir>/summaries/*.md`, maps each item block → `Doc[]`.

Rationale: Horizon already produces a durable, language-partitioned, item-level artifact, so the plugin is a thin reader+parser. `--in` (spec §2.2 API-source JSON config) carries `{ data_dir, config, hours, languages }`; secrets inherit via the process env. A shell step was rejected for the same uniformity/validation reason as last30days (mapping in YAML; no DocSchema validation; schema split across states). Cleaner fit than last30days — Horizon is genuinely a "source → `Doc[]`" ingestion pipeline.

---

## Handoff

- **0090 consumes both output shapes:** `last30days-ingest` emits `Doc[]` from `--emit=json --json-profile=agent` `results[]` (metadata: topic/cluster/source/relevance_score); `horizon-ingest` emits `Doc[]` from `<data-dir>/summaries/horizon-<date>-<lang>.md` item blocks (metadata: lang/profile/score/tags/references). 0090's blend (`kk executor fan-in`) merges these two `Doc[]` streams (plus any existing `Doc[]` source) into the core-facts contract/template.
- **0088's capability map gains the two source rows**, replacing the `missing` rows for 1.1/1.2 with concrete `Doc[]`-producing ingestion plugins: 1.1 `last30days-ingest` → `Doc[]` via last30days agent JSON `results[]`; 1.2 `horizon-ingest` → `Doc[]` via Horizon summary Markdown item blocks.
