# Curate policy

`curate` turns the QC candidates into the episode plan. The deterministic gates have already run before it:
store thresholds (`decisions/extract/ai-news.yaml`), the QC score floors and the minimum item count
(`daily-qc-content`). Curate adds judgement, not new numeric thresholds.

## Keep or drop

- Drop items that cross the topic boundary (SKILL.md shared rule 2) and give a specific Chinese reason.
- Drop low-value items (pure PR fluff, minor point-release changelogs with no architectural or developer impact, thin stubs with no verifiable actor/action) and give a specific Chinese reason.
- Merge near-duplicates (the same event from two sources) into the item with the richer facts; drop the duplicate id into `--out-excluded` with a Chinese reason (e.g., `与另一条候选同属一事，已合并至信息更完整条目`). Never let the same story be spoken twice.
- Keep everything else that has a concrete actor and action. An opinion thread or tutorial with no news event
  stays only when the day is thin, and goes after the news items.

## Output invariant (two files)

`curate` writes two JSON files:
1. `--out-plan` (`21-plan/<date>_03_plan_plan.json`): a bare `Doc[]` array containing **only the kept docs**, ordered with the day's lead news item first, with `title`, `body` and `metadata.brief` adapted into spoken simplified Chinese.
2. `--out-excluded` (`21-plan/<date>_03_curate_excluded.json`): `[{ "id": "<Doc.id>", "reason": "<具体中文原因>" }]` for every dropped candidate (`[]` when nothing is dropped).

Every candidate `id` from `21-plan/<date>_04_quality-control-content_candidates.json` (`metadata.docs`) must land in **exactly one** of the two files — never both (`conflict-id`), never neither (`missing-item`), and with no invented ids (`unknown-id`).

## Order and balance

1. Lead with the day's most consequential concrete news (urgency × impact), not the most technical item.
   0385 R1 makes the audience explicit: urgency is *today's* news, and impact is measured on a white-collar
   listener (product, ops, market, staff roles — not necessarily an engineer): what they can use, what it
   costs, whether it changes how they work. Prefer the story a commuter can act on over the one only a model
   engineer can appreciate; the deep technical story is the weekly's, not the daily's lead.
2. Mix categories (industry, research, tools) instead of running three reddit technical threads in a row.
3. Episode length comes from item count and complete facts, not from long commentary. The style contract
   gives the per-driver character rates. If kept items cannot reach the floor, keep more in-scope items rather
   than padding.

## Spoken Chinese adaptation

For kept items (especially those marked `needsTranslation`), adapt `title`, `body` and `metadata.brief` into spoken simplified Chinese:

- Keep every fact, number, name, quote and hedge. This is a full-length spoken adaptation, not a summary;
  the body is about 0.6–0.7× the source.
- Shrink generic background or concept explainers to one sentence.
- Titles read as news. Keep product and model names and body URLs verbatim, and use 「」 for quotes.
- Keep `id`, `sourceUri`, `mediaType` and `metadata` as they are.

## Mode: curate --fix

When `daily-curate-check` writes `21-plan/<date>_03_curate_errors.json` (`[{ "itemId": "...", "rule": "..." }]`), inspect the rules and rewrite both `--out-plan` and `--out-excluded`:
- `missing-plan` / `invalid-json` / `empty-plan`: write a valid non-empty `Doc[]` to `--out-plan` and valid `[{id, reason}]` to `--out-excluded`.
- `missing-item`: add the missing candidate id either to `--out-plan` (translated) or to `--out-excluded` (with a Chinese reason).
- `conflict-id`: remove the id from one of the two files so it appears in only one.
- `unknown-id`: remove any id that does not exist in `candidates.json`'s `metadata.docs`.
