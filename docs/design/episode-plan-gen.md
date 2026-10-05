# episode-plan-gen

`@gobing-ai/episode-plan-gen` (`plugins/generations/episode-plan-gen`, kind `generator`) — curates the
blended news `Doc[]` into the **episode plan**, the single upstream shared by the daily article, the
audio script, and the episode show notes (dogfood 2026-09-05: 59 raw items → curated plan).

## Why

The 20260905 dogfood episode exposed four content-quality gaps with one root cause: article, script,
and show notes each consumed the raw blended `Doc[]` independently — no shared selection, no dedup,
no cap, no translation point. Fixing selection in any single consumer left the others drifting.
The plan step pins selection once, upstream of all consumers.

## Surface

Executor: `kk executor run episode-plan-gen --in <blended Doc[] json> --out <Content json>`.

| Export | Kind | Notes |
| --- | --- | --- |
| `planEpisode(docs, options)` | function | annotate → `cleanBody` → gates → `planScore` → URL dedup → title dedup → per-source cap → top `maxItems` by score |
| `classifyCategory(doc)` | function | MECE category (`ai-news` / `ai-technical` / `ai-research` / `ai-industry` / `non-ai`), tag → source-deny → keyword precedence |
| `scoreDimensions(doc, planDate)` | function | Four QC dimensions (`quality`/`importance`/`urgency`/`impact`), integers 0–5; `planDate` required — pure function of (doc, planDate), never the wall clock |
| `filterAnnotated(docs, config)` | function | Quality-controller filter (`--mode filter`): annotated `Doc[]` → `{ kept, rejected }` by category allowlist + inclusive dimension minimums; `RejectedDoc = { doc, reasons[] }` |
| `filterConfigFromEnv(env?)` / `DEFAULT_FILTER_CONFIG` | function / const | Single QC defaults + env-parsing source (see Filter); invalid values fail loud |
| `rejectedOutPath(out)` | function | `<out>.json` → `<out>.rejected.json` sibling audit path |
| `cleanBody(text)` | function | Strip `⭐️ x.y/10` ratings + `### [title](url)` heading copies + `**「label」**` research-note section headings (`**「社区讨论」** 评论区…` → `评论区…`; a heading-only line disappears), collapse blank-line runs to one, trim |
| `normalizeUrl(url)` | function | Drop the whole query string + fragment, strip `www.`/`amp.` host prefixes + trailing slash → dedup key (`null` when absent/unparseable) |
| `titleSimilarity(a, b)` | function | Bigram Jaccard (0–1), CJK-aware |
| `docsToContent(docs, options)` | function | Wrap plan as markdown `Content` with the selected `Doc[]` in `metadata.docs` |
| `main()` | function | Executor entry; exit 0 success / 1 failure |

### Env

| Var | Required | Meaning |
| --- | --- | --- |
| `EPISODE_PLAN_MAX_ITEMS` | no | Selection cap (default `20`) |
| `EPISODE_PLAN_DATE` | no | Run date stamped into Content metadata (`planDate`) |
| `EPISODE_PLAN_MODE` | no | Mode selector for executor runs that cannot pass the flag: `plan` (default) or `filter`; precedence `--mode` flag > env > `plan`, unknown value → exit 1 naming both sources (0097) |
| `QC_CATEGORIES` | no (filter mode) | Category allowlist, comma list (default `ai-news,ai-industry`); unknown category → exit 1 |
| `QC_MIN_QUALITY` / `QC_MIN_IMPORTANCE` / `QC_MIN_URGENCY` / `QC_MIN_IMPACT` | no (filter mode) | Inclusive per-dimension minimums 0–5 (defaults 2/3/2/1 — 0099 calibration, see Filter); non-integer or out-of-range → exit 1, never clamped |

## Scoring

`planScore(doc)` — deterministic, no LLM; ordering matters more than absolute value:

- source base: `aihot` 30 (human-curated), `rss` 12, `hackernews` 10, `youtube` 8, `github` 6, `reddit` 5, `grounding` 5, `polymarket` 4, unknown 5
- relevance bonus (first of `metadata.relevance_score`, then horizon `metadata.score`): 0–1 scale × 10; > 1 scale → `min(score × 10, 40) / 4` (capped at +10)
- engagement bonus: `log10(max engagement)` clamped to 0–10, × 1.5 (0 when absent)
- rounded to one decimal

## Annotate (category + dimension scores) — v1, tune later

Before any gate, `planEpisode` annotates every blended doc — deterministic heuristics only, no LLM,
nothing dropped (gates/caps/dedup run after annotation, unchanged):

- `metadata.category` — exactly one of the MECE taxonomy. First match wins:
  1. `metadata.tags` hit in `TAG_CATEGORY` — `ai-news` → ai-news; generic-AI and major-lab tags
     (`ai`, `artificial-intelligence`, `generative-ai`, `genai`, `llm`, `llms`, `openai`,
     `anthropic`, `deepmind`, `google-deepmind`, `meta-ai`, `mistral`, `xai`, `coding-agents`,
     `coding agent` — the 0099 expansion; 0098 dogfood r7 showed OpenAI/AI/LLM-tagged items
     falling through to non-ai under the v1 map) → ai-news; `research` / `research-paper` /
     `paper` / `alignment` → ai-research; `tutorial` / `guide` → ai-technical; `geopolitics` /
     `military-conflict` / `war` → non-ai.
  2. Source in `NON_AI_SOURCES` (currently `polymarket`) — default-deny, skips the keyword scan.
  3. Keyword scan of the title + first 200 chars of the body (whole-word boundary with common
     inflections for Latin words — `launch` still hits `launched`/`launching`, but `cli` never
     matches `client`; substring for CJK), groups in order, first hit wins: ingest-junk phrases
     (`error:`, `http error`, `unable to download` — the 0099 audit; a yt-dlp HTTP-403 error post
     used to absorb ai-industry's `policy` from its own "NO AI / NO LLM POLICY" checklist) →
     non-ai; technical terms (api, tutorial, benchmark, architecture, sdk, inference…) →
     ai-technical; launch/release/announce verbs + product names (sora, gpt, claude, gemini,
     llama…) → ai-news; company/funding/policy words (funding, raises, policy, 法案…) →
     ai-industry.
  4. Default `non-ai`.

- `metadata.scores` — four integer 0–5 QC dimensions, from `scoreDimensions(doc, planDate)` — a
  pure function of (doc, planDate); the plan date is always passed in, never defaulted from the
  wall clock. Ranking still uses `planScore`; these are QC thresholds (consumed by the quality
  controller's filter mode):
  - `quality`: `1 + min(4, round(body.length / 1500))`, +1 when `sourceUri` is present (cap 5)
  - `importance`: source tier — `aihot` → 4, `rss` → 3, `hackernews` → 3, others → 2; +1 when
    `metadata.relevance_score ≥ 0.8` (cap 5)
  - `urgency`: publication date vs plan date — same-day → 5, ≤2d → 4, ≤7d → 3, older → 1; undated
    → 3 (curated same-day sources)
  - `impact`: max engagement magnitude — >1000 → 5, >100 → 4, >10 → 3, >1 → 2, else 1

## Filter (quality controller) — `--mode filter`

`--mode filter` (0094, ADR-019 D3) is the visible, threshold-driven, auditable QC node: it consumes
an annotated `Doc[]` (typically the plan's output), never recomputes scores, and splits it into
survivors plus a rejection audit.

- `filterAnnotated(docs, config)` — a doc survives iff `metadata.category` is in the allowlist AND
  every dimension score ≥ its inclusive minimum (score == min passes). Every failed check lands in
  `RejectedDoc.reasons` — `category:not-in-allowlist`, then `quality:2<3` / `importance:…` /
  `urgency:…` / `impact:…` — in that fixed order. Pure: kept docs come back as-is
  (`sourceUri`/`metadata.urls` byte-identical); inputs are never mutated.
- Config: `DEFAULT_FILTER_CONFIG` — allowlist `ai-news,ai-industry`; mins quality 2, importance 3,
  urgency 2, impact 1 (0099 calibration: the shipped 3/3/2/2 rejected 20/20 live 0098-r7
  candidates — the strongest ai-news items died solely on `impact:1<2`, and discussion-tier
  last30days content scores quality 2; the workflow's `QC_*` pins move in lockstep) — with
  `filterConfigFromEnv()` reading `QC_CATEGORIES` + the four `QC_MIN_*`
  vars. Non-integer, out-of-range, or unknown-category values exit 1 (fail loud, no clamping).
- IO: `--out` gets the same ContentSchema wrapper as plan mode with `metadata.docs` = survivors
  (an empty array stays a valid exit-0 — the workflow maps `metadata.docs | length == 0` to
  done-no-content); the rejection audit lands at `<out>.rejected.json`
  (`candidates.json` → `candidates.rejected.json`) as `{ rejected, config, total }` (total = input
  doc count).
- Fail loud on unannotated input: a missing/invalid `metadata.category` or `metadata.scores` on any
  doc exits 1 naming the first offending doc id — unannotated docs are never silently passed.

r6 replay invariant (locked in tests): with permissive thresholds (full allowlist, mins 0) the
filter over the r6 gated plan reproduces it byte-for-byte — 4 survivors; under the 0099-calibrated
default QC config exactly the GPT-6 doc (3/3/5/1) survives, and the three category-mismatched
docs are rejected with per-dimension reasons. The r7 dogfood evidence
(`.spur/run/daily-dogfood-20260906-r3/21-plan/candidates.rejected.json`, 20/20 rejected under
3/3/2/2) replays as locked-in tests too: the flagship impact-1 item is admitted, the
OpenAI coding-agents item classifies ai-news, and the yt-dlp error-log post lands non-ai.

## Dedup

1. **URL dedup** — same `normalizeUrl` key: higher score wins, loser recorded in winner's
   `metadata.mergedFrom` (`{source, title, url}`).
2. **Title dedup** — bigram Jaccard ≥ 0.6 across distinct URLs: higher score wins, loser likewise
   recorded in `mergedFrom`.

## Selection metadata (per surviving Doc)

| Key | Meaning |
| --- | --- |
| `planScore` | Final deterministic score |
| `category` | MECE category from the annotate pass (see Annotate) |
| `scores` | QC dimensions `{quality, importance, urgency, impact}`, integers 0–5 (see Annotate) |
| `mergedFrom` | Absorbed duplicates (`{source, title, url}[]`) |
| `needsTranslation` | `true` when the title is English-dominant — consumed by the workflow's `plan-translate` agent step |

## Workflow wiring (`kk-daily-ai-voice.yaml`)

```text
blend-facts → plan → plan-translate → article
```

- `plan`: runs `episode-plan-gen`, then extracts `metadata.docs` from the Content artifact to
  `21-plan/plan.json` (fail loud when absent/empty). Cached short-circuit on existing `plan.json`.
- `plan-translate` (agent.run, gated by `plan_translate_enabled: "true"`): translates
  `needsTranslation` items' `title`/`body` to Simplified Chinese **in place** — same file, same
  order, same ids; everything else (metadata, URLs, sourceUri) untouched. Disabled → `plan` routes
  straight to `article`.
- `article` / `script` consume `--in 21-plan/plan.json`. The workflow no longer sets
  `DAILYNEWS_MAX_ITEMS` — the plan is the single limiter (`plan_max_items`, default `"20"`).
- `--mode filter` adds the quality-control seam: since 0097 the `quality-control-content` state
  runs it through the executor seam as `EPISODE_PLAN_MODE=filter` (`kk executor run` forwards only
  `--in`/`--out`, so the mode rides the env channel), with the `done-no-content` terminal for an
  empty kept set, the `qc_*` vars as workflow tunables, and the rejection audit at
  `21-plan/candidates.rejected.json`.

## Show notes contract (downstream, podcast-pub)

Uniform per-item format rendered from the plan:

```text
## N. 标题
正文前 2 句。
[来源：{sourceName}]({URL})

详情见本期完整文章：[{articleTitle}]({articleUrl})
```

`h1` headings are dropped in HTML rendering — the microfeed theme renders the episode title itself.
