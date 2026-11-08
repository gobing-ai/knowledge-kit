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
| `curate` | QC candidates `Doc[]` → the same array, kept and translated, plus exclusions | Policy: `references/selection.md`. Wired in the next migration step (task 0345 R5) |
| `write` | translated plan `Doc[]` → script plan JSON | Wired (`script-write`) |
| `write --fix` | plan `Doc[]` + previous script plan + validator errors → corrected script plan | Wired (`script-write-fix`) |

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

Read the plan `Doc[]` (`--in`). For each doc not excluded, write:

- `lead`: one spoken bridge into the item. It is not the title and not a rhetorical question.
- `insight`: 2–4 sentences anchored to the doc's named actors, saying why it matters or what to watch. Never
  restate the doc's facts, numbers or phrasing (the listener has just heard them), give no generic advice or
  methodology, and add no new facts. The cap is a ceiling, not a target.

`intro` names the top two or three concrete in-scope developments. `outro` is a short close. Write `excluded`
for every boundary item, including any id the article's closing note (`22-article/*_06_article-write_body.md`)
names, with a Chinese reason. Output:

```json
{"version":1,"intro":"…","outro":"…","items":[{"id":"…","lead":"…","insight":"…"}],"excluded":[{"id":"…","reason":"…"}]}
```

Every doc id appears exactly once, either in `items` or in `excluded`, never both.

## Mode: write --fix

Inputs: the plan `Doc[]`, the previous script plan, and `--fix <errors.json>` (`[{itemId, rule}]` from the
validator). Change only what the errors name and copy everything else unchanged. Fix by rule:

| Rule | Fix |
|---|---|
| `cap:<field>` | Shorten that field below its cap in the contract. Cut opinion, not the actor |
| `banned:<phrase>` | Rephrase without the phrase |
| `redundant-insight` | Rewrite the insight as commentary; drop the restated facts |
| `duplicate-insight` | Make each insight specific to its own item |
| `missing-item` / `unknown-id` / `conflict-id` | Make the ids match the docs exactly once (`items` or `excluded`) |
| `schema` / `missing-plan` | Write the full plan per mode `write` |

## Mode: curate

See `references/selection.md`. It covers keep and drop, order, how deep each item goes, and the spoken
Chinese adaptation of title, body and brief.

## References

- `references/style-contract.zh.md`: the column's style contract and machine block (caps, banned).
- `references/selection.md`: curate policy (boundary, ordering, depth budget, translation).
