# Curate policy

`curate` turns the QC candidates into the episode plan. The deterministic gates have already run before it:
store thresholds (`decisions/extract/ai-news.yaml`), the QC score floors and the minimum item count
(`daily-qc-content`). Curate adds judgement, not new numeric thresholds.

## Keep or drop

- Drop items that cross the topic boundary (SKILL.md shared rule 2) and give a Chinese reason.
- Merge near-duplicates (the same event from two sources) into the item with the richer facts. Never let the
  same story be spoken twice.
- Keep everything else that has a concrete actor and action. An opinion thread or tutorial with no news event
  stays only when the day is thin, and goes after the news items.

## Order and balance

1. Lead with the day's most consequential concrete news (urgency × impact), not the most technical item.
2. Mix categories (industry, research, tools) instead of running three reddit technical threads in a row.
3. Episode length comes from item count and complete facts, not from long commentary. The style contract
   gives the per-driver character rates. If kept items cannot reach the floor, keep more in-scope items rather
   than padding.

## Spoken Chinese adaptation

For items marked `needsTranslation`, adapt `title`, `body` and `metadata.brief` into spoken simplified Chinese:

- Keep every fact, number, name, quote and hedge. This is a full-length spoken adaptation, not a summary;
  the body is about 0.6–0.7× the source.
- Shrink generic background or concept explainers to one sentence.
- Titles read as news. Keep product and model names and body URLs verbatim, and use 「」 for quotes.
- Keep `id`, `sourceUri`, `mediaType` and `metadata` as they are. The output keeps the input's length and
  order. Dropped items are not deleted here; they are recorded as `excluded` (with a reason) in the script plan
  that `write` produces, which the builder already honours.
