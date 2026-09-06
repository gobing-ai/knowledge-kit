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
| `planEpisode(docs, options)` | function | `cleanBody` → `planScore` → URL dedup → title dedup → top `maxItems` by score |
| `cleanBody(text)` | function | Collapse blank-line runs to one, trim |
| `normalizeUrl(url)` | function | Strip `utm_*`/tracking params + trailing slash → dedup key |
| `titleSimilarity(a, b)` | function | Bigram Jaccard (0–1), CJK-aware |
| `docsToContent(docs, options)` | function | Wrap plan as markdown `Content` with the selected `Doc[]` in `metadata.docs` |
| `main()` | function | Executor entry; exit 0 success / 1 failure |

### Env

| Var | Required | Meaning |
| --- | --- | --- |
| `EPISODE_PLAN_MAX_ITEMS` | no | Selection cap (default `20`) |
| `EPISODE_PLAN_DATE` | no | Run date stamped into Content metadata (`planDate`) |

## Scoring

`planScore(doc)` — deterministic, no LLM:

- +10 per source link beyond the first (`metadata.urls`), capped at +20
- +8 `aihot` source (human-curated), +4 `hackernews`, +1 otherwise
- +0–10 by body length (log-ish tiers)
- −5 when body is empty

## Dedup

1. **URL dedup** — same `normalizeUrl` key: higher score wins, loser recorded in winner's
   `metadata.mergedFrom` (`{source, title, url}`).
2. **Title dedup** — bigram Jaccard ≥ 0.6 across distinct URLs: higher score wins, loser likewise
   recorded in `mergedFrom`.

## Selection metadata (per surviving Doc)

| Key | Meaning |
| --- | --- |
| `planScore` | Final deterministic score |
| `mergedFrom` | Absorbed duplicates (`{source, title, url}[]`) |
| `needsTranslation` | `true` when the title is English-dominant — consumed by the workflow's `plan-translate` agent step |

## Workflow wiring (`kk-daily-ai-voice.yaml`)

```
blend-facts → plan → plan-translate → article
```

- `plan`: runs `episode-plan-gen`, then extracts `metadata.docs` from the Content artifact to
  `2-plan/plan.json` (fail loud when absent/empty). Cached short-circuit on existing `plan.json`.
- `plan-translate` (agent.run, gated by `plan_translate_enabled: "true"`): translates
  `needsTranslation` items' `title`/`body` to Simplified Chinese **in place** — same file, same
  order, same ids; everything else (metadata, URLs, sourceUri) untouched. Disabled → `plan` routes
  straight to `article`.
- `article` / `script` consume `--in 2-plan/plan.json`. The workflow no longer sets
  `DAILYNEWS_MAX_ITEMS` — the plan is the single limiter (`plan_max_items`, default `"20"`).

## Show notes contract (downstream, podcast-pub)

Uniform per-item format rendered from the plan:

```
## N. 标题
正文前 2 句。
[来源：{sourceName}]({URL})

详情见本期完整文章：[{articleTitle}]({articleUrl})
```

`h1` headings are dropped in HTML rendering — the microfeed theme renders the episode title itself.
