---
schema_version: 1
name: "Wrap last30days + Horizon as Doc[] ingestion sources"
status: done
template: feature-impl
created_at: 2026-09-03T04:21:27.333Z
updated_at: "2026-09-03T06:48:53.112Z"
feature_id: F61
---

## 0089. Wrap last30days + Horizon as Doc[] ingestion sources

### Background

**Type:** `wayfinder:research` — resolve with evidence reading + `--help`-level probing, no full crawls. Map: feature F61.

**Sharp question:** how do the `last30days` skill and Horizon (`(cd ~/tools/Horizon && uv run horizon)`) each become `Doc[]` inputs to the pipeline — what is the thinnest adapter per source (ingestion plugin vs workflow shell step), and what are their invocation contracts and output shapes?

**Evidence:** `~/.agents/skills/last30days/` (SKILL.md, scripts); `~/tools/Horizon` (pyproject, docs/, profiles/); `docs/design/ingestion-plugin-specification.md`.

**Deliverable:** per-source adapter recommendation (plugin vs shell step) + invocation/output-shape notes in `## Solution`.

### Requirements

- [x] R1. last30days invocation contract + output shape documented; adapter recommended.
- [x] R2. Horizon invocation contract (profiles/config) + output shape documented; adapter recommended.
- [x] R3. Both adapters terminate in `Doc[]` per `docs/design/ingestion-plugin-specification.md`, or a justified shell-step alternative is recorded.

Non-goals: no live 30-day pulls or full Horizon crawls; no plugin code written; dedup/merge semantics belong to 0090, not here.

### Acceptance Criteria
- [x] Both sources have a documented, evidence-backed path to `Doc[]`.
- [x] Recommendation names plugin vs shell step for each source, with rationale.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-03T04:40:22.648Z

- None open. Both source paths verified present on disk 2026-09-02 (`~/.agents/skills/last30days`, `~/tools/Horizon`).

### Design

**WHAT:** a two-source adapter brief — per source: invocation contract, output shape, recommended adapter (ingestion plugin vs workflow shell step), rationale.

**WHY:** the blend contract (0090) and the workflow extension both need to know whether last30days/Horizon arrive as plugins (`kk executor run <name>`) or as shell steps producing JSON.

**WHERE — frozen read set (verified present 2026-09-02):** `~/.agents/skills/last30days/SKILL.md` + its `scripts/`; `~/tools/Horizon/{pyproject.toml, docs/, profiles/}`; `docs/design/ingestion-plugin-specification.md`; the `Doc` contract in `packages/kk-core/src/`.

**Probe budget:** `--help` / doctor-level invocations only; no full crawls, no network fan-out, no API-key spend.

**Deliverable contract — `## Solution` carries two named subsections:** `last30days` and `Horizon`, each with invocation / output shape / adapter choice / rationale.

**Anti-patterns:** do not scaffold `last30days-ingest` or `horizon-ingest` (that is implement work graduated after this ticket); do not design dedup (0090); do not broaden the source roster beyond these two (map fog).

**Handoff:** 0090 consumes both output shapes; 0088's capability map gains the two source rows from this brief.

### Plan
- [x] 1. Read `last30days` SKILL.md + scripts; probe help/doctor only. (R1)
- [x] 2. Read Horizon pyproject/docs/profiles; probe `uv run horizon --help`. (R2)
- [x] 3. Read the ingestion-plugin spec + `Doc` contract in kk-core. (R3)
- [x] 4. Choose adapter per source (plugin vs shell step) with rationale. (R1–R3)
- [x] 5. Write `## Solution` per the deliverable contract + handoff lines. (R1–R3)

Verification intent: `spur task check 0089` clean; reviewer confirms both sources have an invocation contract, an output shape, and a `Doc[]` path (or justified alternative).

### Solution

#### last30days

**Invocation contract.** Tool: `~/.agents/skills/last30days/scripts/last30days.py` (SKILL_DIR = dir of the loaded `SKILL.md`; `scripts/` is a sibling). Runtime: Python 3.12+ (`LAST30DAYS_PYTHON`/`python3`); needs `node`+`python3` on PATH; first-run setup gate requires `SETUP_COMPLETE=true` in `~/.config/last30days/.env` (else degraded to WebSearch-only). Machine-readable command (what the plugin runs):

```bash
python3 scripts/last30days.py "<topic>" \
  --emit=json --json-profile=agent \
  --save-dir "<LAST30DAYS_MEMORY_DIR>" \
  [--plan "$QUERY_PLAN_FILE"] [--days N] [--as-of YYYY-MM-DD] \
  [--web-backend auto|brave|exa|serper|parallel|parallel-mcp|keyless|none] \
  [--store] [--output "<abs-out>"]
```

`--emit=json` is the machine-readable mode (last30days `scripts/last30days.py` line 630); `--json-profile=agent` (default) is the stable, versioned, flat agent contract, `--json-profile=raw` is the full internal `Report` (local-only; remote API supports raw only) (last30days `scripts/last30days.py` line 638). `--plan` is required on named-entity topics (LAW 7 backstop last30days `scripts/lib/render.py` lines 762 and 1290). Env: `LAST30DAYS_MEMORY_DIR` (default `~/Documents/Last30Days`, last30days `scripts/lib/library.py` line 14), `LAST30DAYS_API_KEY`+`LAST30DAYS_API_BASE` (remote, optional), `LAST30DAYS_ENRICH_BUDGET_SECONDS`, `LAST30DAYS_NATIVE_SEARCH`, `LAST30DAYS_LIBRARY_CONTEXT`. Secrets (env-inherited): `SCRAPECREATORS_API_KEY` primary; optional `OPENAI/XAI/OPENROUTER/PERPLEXITY/PARALLEL/BRAVE/APIFY/AUTH_TOKEN/CT0/BSKY_*/TRUTHSOCIAL_TOKEN/XIAOHONGSHU_API_BASE`. Non-crawl diagnostics (`doctor [--json]`, `--preflight`, `--diagnose`) are allowed probes; this is otherwise a live network fan-out. Non-goals: no first-run wizard / browser-cookie extraction here; no full report synthesis (that's `--emit=compact`).

**Output shape.** `--emit=json --json-profile=agent` flat contract (last30days `scripts/lib/schema.py` line 879 top-level, line 891 `results`, line 842 `clusters`; `AGENT_EXPORT_SCHEMA_VERSION = "1.2"` at last30days `scripts/lib/schema.py` line 642): `{ schema_version, query, generated_at, window_days, source_status{source→state}, freshness_verdicts[], clusters[{title,summary,sources,engagement_total}], results[{candidate_id,title,source,url,published_at?,summary,engagement?,relevance_score,cluster}] }`. `source_status` states: `ok|no-results|partial|rate-limited|auth-failed|unreachable|timeout|schema-drift|skipped-unconfigured|error`. `results[]` is the item-level grain; no prose "What I learned" in agent JSON.

**Adapter choice + rationale.** Ingestion plugin `last30days-ingest` (kind `ingestion`). Entry shells out to the command above, captures the agent JSON (stdout or `--output` file, last30days `scripts/last30days.py` line 747), maps `results[]` → `Doc[]` (one Doc per item: `id=last30days:{candidate_id}` (fallback sha256(url)), `title`, `body=results[].summary`, `sourceUri`, `mediaType=text/markdown`, `metadata={topic,window_days,cluster{index,title},source,engagement,relevance_score,published_at,schema_version}`). id is derived deterministically for id stability (`docs/design/ingestion-plugin-specification.md:61`); empty `results` → `[]` exit 0 (`:68`); partial failure → skip + stderr warning + exit 0. Plugin `--in` carries the JSON config (`{ topic, save_dir, web_backend, days, as_of, plan }`) per API-source semantics (`docs/design/ingestion-plugin-specification.md:57`). Weakness, stated: last30days is a topic-research query (one report per run), not a static doc store — but the plugin boundary still holds and keeps collect-stage uniform with Horizon. `Doc[]` terminates the path (`packages/kk-core/src/kinds.ts:58`).

#### Horizon

**Invocation contract.** Command: `(cd ~/tools/Horizon && uv run horizon [--hours N] [-d <data-dir>] [-c <config>] [-l <level>])` (Horizon `src/main.py` line 38 entry, line 45 `--hours`; Horizon `docs/configuration.md` line 16-17 `-d`/`-c`). `uv` + Python 3.11+; deps in `pyproject.toml` (optional `--extra` openbb/twitter/trafilatura). Defaults `-d data`, `-c <data-dir>/config.json`, `-l WARNING`; `--hours N` overrides `collection.time_window_hours`. Config (`data/config.json` or `--config`): `sources` (rss/github/hackernews/reddit/telegram/twitter(Apify)/openbb/ossinsight/gdelt/google_news), `collection.time_window_hours`, `processing{profiles_dir,default_profile,profile_settings{threshold,topic_dedup}}`, `digest{max_items,profile_order,category_groups}`, `ai{provider,model,api_key_env,throttle_sec,analysis_concurrency,enrichment_concurrency,languages}`, `display.icon_style` (optional `email`/`webhook`, out of scope). Profiles (`profiles/<id>/{profile.json,match.md,analysis.md,enrichment.md}`); built-ins `finance-news`,`tech-news`,`tech-blog` (Horizon `docs/profiles.md` line 40); `profile` on a source routes it. Secrets via `.env` at repo root (`load_dotenv`): `api_key_env` names env vars (`ANTHROPIC/OPENAI/GOOGLE/MINIMAX/DASHSCOPE/DEEPSEEK_API_KEY`, `APIFY_TOKEN`); secrets never live in config.json. Output artifact: `uv run horizon` fetches → routes → analyzes (0-10 score/reason/summary/tags) → filters (`threshold`) → dedups (`topic_dedup`) → enriches (localized blocks per `ai.languages`) → writes `<data-dir>/summaries/horizon-<YYYY-MM-DD>-<lang>.md` (Horizon `docs/configuration.md` line 915). MCP alternative: `uv run horizon-mcp` exposes `hz_validate_config`, `hz_fetch_items`, `hz_score_items`, `hz_filter_items`, `hz_enrich_items`, `hz_generate_summary`, `hz_run_pipeline`. Diagnostics: `uv run horizon --help`, `horizon-webhook --dry-run`. This is the live ingest boundary (network fetch + AI scoring).

**Output shape.** Per language: `<data-dir>/summaries/horizon-<date>-<lang>.md` (directory Horizon `docs/configuration.md` line 915; filename Horizon `src/storage/manager.py` line 125). H1 title; per-profile H2 sections (localized profile name); each item H3 block = anchor `<a id="item-<profile>-<n>">`, `### [title](url) ⭐️ <score>/10`, source line (`<source> · <sub/author> · <date> · [community discussion](url)`), localized enrichment blocks (per `profile.json` `enrichment.blocks`), `<details><summary>参考链接</summary>` reference list, `**标签**: #tag…`. `enrichment.blocks` ids, the 0-10 `score`, source category, and `tags` are the structured pieces to parse.

**Adapter choice + rationale.** Ingestion plugin `horizon-ingest` (kind `ingestion`). Entry runs `uv run horizon` (or the MCP pipeline), reads `<data-dir>/summaries/*.md` (Horizon `docs/configuration.md` line 915), maps each item block → `Doc[]` (one Doc per item: `id=horizon:{url-slug}` or `horizon:{date}-{profile}-{n}` anchor, `title`, `body` = joined enrichment blocks, `sourceUri`, `mediaType=text/markdown`, `metadata={lang,profile,score,source_line,author,published_at,tags,references,date}`). id deterministic from url/anchor for stability (`docs/design/ingestion-plugin-specification.md:61`); empty digest → `[]` exit 0 (`:68`). `--in` config `{ data_dir, config, hours, languages }` per API-source semantics (`docs/design/ingestion-plugin-specification.md:57`); secrets env-inherited. Robustness: parse the generated summary MD deterministically (no MCP session needed). Cleaner fit than last30days — Horizon is a genuine "source → `Doc[]`" pipeline (`docs/design/ingestion-plugin-specification.md:52`; `packages/kk-core/src/kinds.ts:58`). A shell step was rejected (same uniformity/validation reasons as above). `Doc[]` terminates the path.

**Handoff.**

- **0090 consumes both output shapes:** `last30days-ingest` emits `Doc[]` from `--emit=json --json-profile=agent` `results[]` (last30days `scripts/lib/schema.py` line 891; metadata: topic/cluster/source/relevance_score); `horizon-ingest` emits `Doc[]` from `<data-dir>/summaries/horizon-<date>-<lang>.md` item blocks (directory Horizon `docs/configuration.md` line 915, filename Horizon `src/storage/manager.py` line 125; metadata: lang/profile/score/tags/references). 0090's blend (`kk executor fan-in`) merges these two `Doc[]` streams into the core-facts contract/template.
- **0088's capability map gains the two source rows** (replacing its `missing` rows for 1.1/1.2 with concrete `Doc[]`-producing ingestion plugins): 1.1 `last30days-ingest` → `Doc[]` via last30days agent JSON `results[]`; 1.2 `horizon-ingest` → `Doc[]` via Horizon summary Markdown item blocks.

### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `docs/tasks/0089_wrap-last30days-horizon-as-doc-ingestion-sources.md:73-91` (#### last30days) — invocation contract + output shape documented; anchors re-read this run: last30days `scripts/last30days.py` line 630 (`--emit` choices incl. json), line 638 (`--json-profile` default agent), last30days `scripts/lib/schema.py` line 642 (`AGENT_EXPORT_SCHEMA_VERSION = "1.2"`), lines 877-892 (top-level keys schema_version/query/generated_at/window_days/source_status/freshness_verdicts/clusters/results); adapter recommended = ingestion plugin `last30days-ingest` |
| R2 | MET | `docs/tasks/0089_wrap-last30days-horizon-as-doc-ingestion-sources.md:92-99` (#### Horizon) — invocation contract + output shape documented; anchors re-read this run: Horizon `src/main.py` line 45 (`--hours`), Horizon `docs/configuration.md` lines 16-17 (`-d`/`-c`), line 915 (`data/summaries/` directory), Horizon `src/storage/manager.py` line 125 (`horizon-{date}-{language}.md` filename); adapter recommended = ingestion plugin `horizon-ingest` |
| R3 | MET | Both adapters terminate in `Doc[]`: `packages/kk-core/src/kinds.ts:59` (`ingestion: input null, output DocListSchema`) and `docs/design/ingestion-plugin-specification.md:52-55` (§2.1 kind def) re-read this run; explicit `results[]`→`Doc[]` and item-block→`Doc[]` mappings in `docs/tasks/0089_wrap-last30days-horizon-as-doc-ingestion-sources.md:90` and `:98`; shell-step alternative documented and rejected with rationale |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Both sources have a documented, evidence-backed path to `Doc[]`. | MET | command | `grep -c 'maps .*→ `Doc\[\]`' docs/tasks/0089_wrap-last30days-horizon-as-doc-ingestion-sources.md` → 2 (run this turn): last30days `results[]`→`Doc[]` and Horizon item-block→`Doc[]` mappings, each anchored to re-verified external source lines |
| Recommendation names plugin vs shell step for each source, with rationale. | MET | command | `grep -c 'Ingestion plugin `' docs/tasks/0089_wrap-last30days-horizon-as-doc-ingestion-sources.md` → 2 (run this turn): `last30days-ingest` + `horizon-ingest`, kind `ingestion`, each with rationale incl. shell-step rejection |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review

**Review Report — task 0089 (last30days + Horizon → `Doc[]`)** · scope: doc-only research brief; `docs/tasks/0089_wrap-last30days-horizon-as-doc-ingestion-sources.md` `## Solution` + companion `docs/design/ingestion-source-adapters.md`. No plugin code written (anti-patterns respected; `plugins/ingestions/` still holds only `aihot-ingest`, `karakeep-local`, `web-search`).

**Dimensions:** functional traceability · SECUA correctness · architecture depth
**Verdict:** PASS-with-findings (P4-only; no P1/P2/P3)

#### Findings (ranked)

| # | Severity | Dimension | Finding | Location |
| --- | ---------- | ----------- | --------- | ---------- |
| 1 | P4 | traceability | R1/R2/R3 and both AC boxes remain `- [ ]` unchecked though the `## Solution` deliverable is complete. Housekeeping — tick on the `spur task check 0089` verify step. | task file Requirements/AC |
| 2 | P4 | correctness | `:28` cited as the "exit-code contract" but line 28 is §1.3 (Secrets/secrets-never-committed clause); the exit-code contract is §1.4 (lines 30-33). Substance correct; line mis-cited. | `docs/design/ingestion-plugin-specification.md` |
| 3 | P4 | traceability | `LAST30DAYS_MEMORY_DIR` default `~/Documents/Last30Days` cited at `scripts/last30days.py:734`; the default actually lives at `scripts/lib/library.py:14` (line 734 is the `--save-dir` argparse). | last30days |
| 4 | P4 | traceability | LAW 7 `--plan`-required-on-named-entity claim cited at `scripts/last30days.py:766`; 766 is the `--plan` argparse help — the LAW 7 backstop lives at `scripts/lib/render.py:1252,1287-1290` and `scripts/lib/pipeline.py:2206`. | last30days |
| 5 | P4 | traceability | `horizon-<date>-<lang>.md` filename cited at `docs/configuration.md:915`; 915 confirms the `data/summaries/` directory, exact filename is `src/storage/manager.py:125`. | Horizon |
| 6 | P4 | traceability | built-in profile names cited at `docs/profiles.md:40` (table header row); the names are rows 42-45. Note: `profiles/` also carries a 4th profile `ai-creator` not listed in the doc's built-in table (completeness note, does not contradict the brief's assertion about the doc). | Horizon profiles |

#### Functional Traceability

| Req/AC | Status | Evidence |
| -------- | -------- | ---------- |
| R1 | MET | `last30days` subsection — invocation command, `--emit=json --json-profile=agent` contract, output shape (`schema.py:879` top-level, `:891` results), adapter = `last30days-ingest` plugin |
| R2 | MET | `Horizon` subsection — `uv run horizon` command + `-d`/`-c`, profiles/config, output shape (`storage/manager.py:125`), adapter = `horizon-ingest` plugin |
| R3 | MET | Both terminate in `Doc[]` per spec §2 (`kinds.ts:58` `DocListSchema`); shell-step alternative documented + justified |
| AC1 | MET | Both sources have an evidence-backed `Doc[]` path (verified against actual tool + spec) |
| AC2 | MET | Each source names plugin vs shell step with rationale (incl. shell-step rejection) |
| Handoff → 0090 | MET | `## Solution` Handoff — both output shapes consumed by 0090 blend (`kk executor fan-in`) |
| Handoff → 0088 | MET | Handoff — replaces 0088 `missing` rows 1.1/1.2 with `last30days-ingest`/`horizon-ingest` (0088 lines 79-80, 93-94) |

#### Verified against reality (fresh evidence, not doc-reading)

- last30days: `--emit`/`--json-profile` argparse (`last30days.py:629-642`), `AGENT_EXPORT_SCHEMA_VERSION="1.2"` (`schema.py:642`), agent-JSON top-level keys + `results[]` item grain (`candidate_id/title/source/url/published_at/summary/engagement/relevance_score/cluster`) at `schema.py:853-891` — matches the claimed shape exactly.
- Horizon: `--hours`/`-d`/`-c` (`main.py:45`, `configuration.md:16-17`); artifact filename `horizon-<date>-<lang>.md` (`storage/manager.py:125`); item anchor `item-<profile>-<n>` + `### [title](url) ⭐️ <score>/10` + reference `<details>` + `标签` (`summarizer.py:76-77,208,422-423,455`).
- Ingestion-plugin spec §2: kind `ingestion`, input `null`, output `DocListSchema` (`:52`); API-source `--in` JSON config (`:57`); id-stability determinism (`:61`); empty → `[]` exit 0 / partial → skip+stderr+exit 0 (`:68`). kk-core `kinds.ts:58` (`ingestion` → `DocListSchema`) and `schemas.ts:4` (`DocSchema`) confirm the contract.
- Architecture: `kk executor run|fan-in|fan-out` are kk subcommands (`kk-cli-surface.md:38,84-85`); `plugins/ingestions/<name>/` layout (spec §1.5 / ADR-009). Shell-step rejection (mapping in YAML, bypasses `DocSchema` validation, splits schema knowledge across states) is justified and consistent with the contract.

#### Residual risk

Low. Both plugins will be thin wrappers around heavy, stateful external tools; the ingest step is the live network boundary of the daily pipeline (stated honestly in both the `## Solution` and the companion brief). No dedup/merge semantics on 0089 (deferred to 0090). The only findings are citation-precision/housekeeping nits that change no substantive claim.

#### Final disposition

**PASS-with-findings.** All three requirements and both acceptance criteria have correctly-verified, evidence-backed content; both handoff lines present; no plugin code written (anti-patterns respected); the adapter recommendations (ingestion plugin for both) and the shell-step rejection are consistent with the ingestion-plugin spec and the fan-in/fan-out architecture. Six (6) P4 findings — five (5) citation-precision nits + one (1) housekeeping nit (unchecked requirement/AC boxes) — with no P1/P2/P3. Nothing blocks; the box-tick belongs to `spur task check 0089`.

### References

- Map: `docs/features/F61_daily-ai-news-end-to-end-pipeline-wayfinder-map.md`
- `docs/design/ingestion-plugin-specification.md` · `packages/kk-core` Doc contract
- Dependents: 0090 (blend consumes both output shapes)

### History

- 2026-09-03T05:34:06.492Z todo → wip (system)
- 2026-09-03T05:39:24.340Z wip → testing (system)
- 2026-09-03T05:39:25.162Z testing → done (system)
