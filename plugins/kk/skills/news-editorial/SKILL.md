---
name: news-editorial
description: >-
  Use the news-editorial skill for the editorial judgement of a daily news episode — "curate today's
  news pool", "write the episode script plan", "fix the script plan against these validator errors",
  "apply the daily news style contract". Owns selection and topic boundary, ordering, the balance of
  news, opinion and technical detail, and the style contract. Modes: curate | write | write --fix.
requires: [cli:kk, local-fs]
---

# news-editorial — daily news editorial policy (curate | write | write --fix)

## Purpose

This skill holds every editorial judgement for a daily news episode: which items to keep, in what order, how
much opinion and technical detail each gets, and how the spoken words read. Everything deterministic stays
in code and is **out of scope**: collection and store extraction (`kk store extract`, `decisions/extract/*.yaml`),
score thresholds (`daily-qc-content`), the VoiceScript builder (fixed greeting and sign-off), validators,
duration gates, TTS, images and publishing (ADR-045).

A workflow reaches this skill through the run snapshot `<work_dir>/20-editorial/news-editorial/` (written by
`kk stage daily-script-style`). Read files relative to the `SKILL.md` you were pointed at; do not rely on skill
discovery.

## Invocation contract

`<mode> [--fix <errors.json>] --in <input> --out <output>`. The calling prompt supplies the paths. Write only
`--out`, as a single valid file (JSON with no comments or trailing commas). Never edit the input.

| Mode | Input → output | Status |
|---|---|---|
| `curate` | QC candidates `Doc[]` → kept translated `Doc[]` (`--out-plan`) + exclusions (`--out-excluded`) | Wired (`curate`, policy: `references/selection.md`) |
| `curate --fix` | QC candidates `Doc[]` + curate validator errors (`--fix`) → corrected plan + exclusions | Wired (`curate-fix`) |
| `write` | translated plan `Doc[]` + exclusions (`--excluded`) → master script plan JSON | Wired (`script-write`) |
| `write --fix` | plan `Doc[]` + previous script plan + validator errors → corrected master script plan | Wired (`script-write-fix`) |

## Shared rules (every mode)

Read `references/style-contract.zh.md` first. Its prose sets the column's identity and the balance of news,
opinion and technical detail. Its fenced `json` block holds the caps and banned phrases that the dailynews-gen
validator enforces mechanically, so violating them means the plan is rejected.

1. **News first.** Every item tells the listener who (company, lab, team) did what (released, open-sourced,
   raised, sued, disclosed) and when. Commentary is restrained and anchored to that item; technical detail is
   only the one or two sentences needed to understand it.
2. **Topic boundary (选题边界).** Never retell an item whose mainline is politics or diplomacy, trade controls,
   military affairs, public-policy disputes or social public events, whatever nickname it travels under. Exclude
   it with a Chinese reason. In-scope industry and institutional news is reported normally.
3. **Fact discipline.** Every fact comes from that item's own plan content. Do not invent anything or borrow
   from other items. Never inflate numbers or actors. Attribute a quote only to its original speaker. Keep
   hedges (据报道 / 称 / 承诺). If the material is thin, write less.
4. **Copy discipline.** Use reader-facing spoken Chinese. Do not use scaffold labels (可做角度 / 背景 /
   潜在影响) or hedge labels (读者宜另行核实 / 仍待验证), use 「」 for quotes, and never add a greeting,
   sign-off or AI-production footer. The builder adds those.

## Mode: write

Read the curated plan `Doc[]` (`--in`) and the curate exclusions (`--excluded`). For each doc in `--in`, write:

- `lead`: one spoken bridge into the item (≤80 chars). It is not the title and not a rhetorical question.
- `insight`: 2–4 sentences (≤380 chars) anchored to the doc's named actors, saying why it matters or what to watch. Never restate the doc's facts, numbers or phrasing (the listener has just heard them), give no generic advice or methodology, and add no new facts. The cap is a ceiling, not a target.
- `card`: optional per-item card slot `{ "copy": "≤12字标题", "points": ["要点1", "要点2"], "subject": "English visual scene" }` (2–4 points).

At the episode level, write:

- `intro` (≤150 chars): names the top two or three concrete in-scope developments.
- `outro` (≤150 chars): a short close tying the items together.
- `excluded`: copy the array from `--excluded` (`21-plan/<date>_03_curate_excluded.json`) verbatim so the script plan records every dropped candidate with its Chinese reason.
- `cover` (≤240 chars): one concrete visual scene in English for the lead item (objects, settings, symbols, metaphor; no text, letters, numbers, logos, flags, or recognizable people).
- `cards`: `{ "title": "≤20字总标题", "body": "中文导语段落 + 3-5个话题标签" }` for the episode card series.
- `social`: `{ "short": "≤140字 X/Threads 短帖", "long": "≤500字 微博/LinkedIn 长帖" }` (plain text, no markdown headings, no emoji spam, grounded in the plan).

Output:

```json
{
  "version": 1,
  "intro": "…",
  "outro": "…",
  "cover": "…",
  "cards": { "title": "…", "body": "…" },
  "social": { "short": "…", "long": "…" },
  "items": [
    {
      "id": "…",
      "lead": "…",
      "insight": "…",
      "card": { "copy": "…", "points": ["…", "…"], "subject": "…" }
    }
  ],
  "excluded": [{ "id": "…", "reason": "…" }]
}
```

Every doc id in `--in` appears in `items`, and `excluded` carries the curate exclusions; no id may appear in both.

## Mode: write --fix

Inputs: the plan `Doc[]`, the previous script plan, and `--fix <errors.json>` (`[{itemId, rule}]` from the
validator). Change only what the errors name and copy everything else unchanged. Fix by rule:

| Rule | Fix |
|---|---|
| `cap:<field>` | Shorten that field (`intro`, `outro`, `lead`, `insight`, `cover`, `cardCopy`, `cardTitle`, `socialShort`, `socialLong`) below its cap in the contract. Cut opinion, not the actor |
| `banned:<phrase>` | Rephrase without the phrase (applies to spoken, card and social fields alike) |
| `redundant-insight` | Rewrite the insight as commentary; drop the restated facts |
| `duplicate-insight` | Make each insight specific to its own item |
| `missing-item` / `unknown-id` / `conflict-id` | Make `items` match `--in` and `excluded` match `--excluded` with no overlap |
| `schema` / `missing-plan` | Write the full master plan per mode `write` |

## Mode: curate / curate --fix

See `references/selection.md`. Reads QC candidates (`--in`) and writes two JSON files:
1. `--out-plan` (`21-plan/<date>_03_plan_plan.json`): bare `Doc[]` of **kept** items only, in editorial order (lead first), with `title`, `body` and `metadata.brief` adapted into spoken simplified Chinese.
2. `--out-excluded` (`21-plan/<date>_03_curate_excluded.json`): `[{"id":"<Doc.id>","reason":"<具体中文原因>"}]` for every dropped candidate (`[]` when none dropped). Every candidate id must land in **exactly one** of the two files.

With `--fix <errors.json>` (`missing-plan`, `invalid-json`, `unknown-id`, `missing-item`, `conflict-id`, `empty-plan`), repair the partition so every candidate id is accounted for exactly once and at least one in-scope item is kept.

## References

- `references/style-contract.zh.md`: the column's style contract and machine block (caps, banned).
- `references/selection.md`: curate policy (boundary, ordering, depth budget, translation).
