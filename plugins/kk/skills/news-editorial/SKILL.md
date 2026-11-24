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
| `align` | selected items + judgment ledger snapshot → structured judgment proposal (may be empty) | Wired (`plugins/kk/scripts/news-editorial-ledger.ts` — `commitAlignment` validates and commits it, 0384) |

## Shared rules (every mode)

Read `references/style-contract.zh.md` first. Its prose sets the column's identity and the balance of news,
opinion and technical detail. Its fenced `json` block holds the caps and banned phrases that the dailynews-gen
validator enforces mechanically, so violating them means the plan is rejected.

1. **News first, for a white-collar listener (0385 R1).** Every item tells the listener who (company, lab,
   team) did what (released, open-sourced, raised, sued, disclosed) and when. Order by timeliness and by impact
   on a listener who is not an engineer — what they can use, what it costs, whether it changes how they work;
   research detail and pure implementation news go last or get one sentence. Explain necessary jargon in a
   plain clause ("也就是说……") before the term, never in a tutorial. The deep dive (full mechanism, tooling
   comparison, systematic evaluation) belongs to the weekly, not to the daily. Commentary is restrained and
   anchored to that item; technical detail is only the one or two sentences needed to understand it.
2. **Topic boundary (选题边界, calibrated 2026-11-18 / task 0392).** Exclude an item only when `AI 产业` is not
   its mainline. Out of scope: (a) the confirmed platform hard line in `plugins/kk/scripts/topic-boundary.json`
   (the top-leadership rule and the future-dated check) — the deterministic stage already drops those, never
   re-admit them; (b) a story whose mainline is partisan politics, an armed conflict or a non-AI crime/accident,
   i.e. the AI angle is only the nickname; (c) an item with no usable AI-industry fact.
   **In scope** — report normally, do not exclude: AI regulation and legislation, model/product liability and
   litigation, export controls and procurement that decide AI capacity, standards and safety enforcement, and
   company, lab, market and technical news. A public-policy story whose subject IS an AI system, model or vendor
   is in scope even though it reads as policy; only the story whose subject is the political actor is out.
   Record the exclusion with a Chinese reason naming the class from (a)-(c) and the sentence that shows it —
   "感觉不合适" is not a reason. (0385 applied this decision as the editorial projection; the policy below is
   binding.) Calibration samples live in `plugins/kk/tests/fixtures/topic-selection-cases.json`.
3. **Fact discipline (0385 R2).** Keep attributable fact, commentary and unverified inference visibly
   separate in the copy, so a listener hears which sentence is which. Every fact comes from that item's own plan
   content. Do not invent anything or borrow from other items. Never inflate numbers or actors. Attribute a
   quote only to its original speaker, and attribute a commercial claim (funding amount, user count,
   performance gain, compliance status) to the party that made it ("公司称") when nobody independent
   corroborates it. Unverified inference has exactly two legal shapes — explicit attribution (据报道 / 当事人称 /
   公司未证实) or omission. Keep hedges (据报道 / 称 / 承诺); never add scaffold hedges (读者宜另行核实 /
   仍待验证) to look careful. If the material is thin, write less — omission is the default, not a softening.
4. **Copy discipline.** Use reader-facing spoken Chinese. Do not use scaffold labels (可做角度 / 背景 /
   潜在影响) or hedge labels (读者宜另行核实 / 仍待验证), use 「」 for quotes, and never add a greeting,
   sign-off or AI-production footer. The builder adds those.

## Mode: write

Read the curated plan `Doc[]` (`--in`) and the curate exclusions (`--excluded`). For each doc in `--in`, write:

- `lead`: one spoken bridge into the item (≤80 chars). It is not the title and not a rhetorical question.
- `insight` (optional; omitting it and writing `""` are the same thing — both validate, and the builder and the
  renderer skip only the comment sentence, never the item): 2–4 sentences (≤380 chars) anchored to the doc's named actors, saying why it matters or what to watch. At most one sentence of commentary is required for a short item — leave the field as a single sentence, or omit the comment entirely when the item needs no judgement. Never restate the doc's facts, numbers or phrasing (the listener has just heard them), give no generic advice or methodology, and add no new facts. The cap is a ceiling, not a target.
- `card`: optional per-item card slot `{ "copy": "≤12字标题", "points": ["要点1", "要点2"], "subject": "English visual scene" }` (2–4 points). `subject` is composed per `../daily-news-illustrations/SKILL.md` mode `card` — the card series' artwork direction is that skill's, while `copy`/`points` and the episode `cards.title`/`body` stay here.

At the episode level, write:

- `intro` (≤150 chars): one short greeting (the builder's fixed line) plus one or two points only — name the top
  one or two concrete in-scope developments, then get to the first story. No opening thesis, no agenda list.
- `outro` (≤150 chars): a short close. The cross-item synthesis lives here and only when the day genuinely has
  a common thread: scale it by value and running time, or drop it and close in one sentence.
- `excluded`: copy the array from `--excluded` (`21-plan/<date>_03_curate_excluded.json`) verbatim so the script plan records every dropped candidate with its Chinese reason.
- Episode identity (0385 R4): the Chinese publish title is `第<YYMMDD>期 · 当日要点` from the frozen episode date
  and ONE point, and the cover headline reuses that same point (`plugins/kk/scripts/episode-identity.ts` freezes
  it; `daily-editorial-render` stamps it, `publish-prep` refuses to publish when admission removed the point's
  supporting source). Never invent a second title for a channel.
- `cover`: either one concrete visual scene in English (a plain string, ≤240 chars: objects, settings, symbols, metaphor; no text, letters, numbers, logos, flags, or recognizable people — compose it per `references/daily-visual-composition.md`) or — required for the 0385 R4 title — the object form
  `{ "scene": "…", "headline": "…", "sourceIds": ["<plan item id>"] }`:
  - `headline` (required, ≤25 chars): the 当日要点 the episode title freezes — one line, the day's most important
    development in plain language, no date/issue/column name. The title prefix supplies the rest.
  - `scene` (optional for validation, but then the cover image falls back to the default subject): same English
    visual contract as the string form.
  - `sourceIds` (optional): the plan item id(s) the point rests on — normally the lead. Name them so that when
    admission drops every one of them the point is withheld instead of being published unsupported. Omitting
    `sourceIds` means "the admitted lead", which is the usual case.
- `cards`: `{ "title": "≤20字总标题", "body": "中文导语段落 + 3-5个话题标签" }` for the episode card series.
- `social`: `{ "short": "≤100字 X/Threads/微博推广短帖钩子（bundle-variants 会统一前置节目标题、末尾注入 {{podcast_url}}；微博/X/Threads/LinkedIn 均不附上传图片，以链接展示 1200×630 OG 卡片；Jike 保留首张卡片图）", "long": "≤300字 LinkedIn 精选要点推广（禁止长文 Digest，bundle-variants 会前置标题与 {{podcast_url}} 并仅发链接以展示 OG 卡片）" }` (plain text, no markdown headings, no emoji spam, grounded in the plan).

Output:

```json
{
  "version": 1,
  "intro": "…",
  "outro": "…",
  "cover": { "scene": "…", "headline": "…", "sourceIds": ["…"] },
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
| `cap:<field>` | Shorten that field (`intro`, `outro`, `lead`, `insight`, `cover`, `coverHeadline`, `cardCopy`, `cardTitle`, `socialShort`, `socialLong`) below its cap in the contract. Cut opinion, not the actor |
| `banned:<phrase>` | Rephrase without the phrase (applies to spoken, card and social fields alike) |
| `redundant-insight` | Rewrite the insight as commentary; drop the restated facts |
| `duplicate-insight` | Make each insight specific to its own item |
| `missing-item` / `unknown-id` / `conflict-id` | Make `items` match `--in` and `excluded` match `--excluded` with no overlap |
| `schema` / `missing-plan` | Re-emit the whole plan per mode `write` — the fields the validator requires are `version: 1`, non-empty `intro`/`outro`, `items[]` each with `id` + `lead` (`insight` may be omitted or `""`), and `cover` as a string scene **or** the object `{ "scene": …, "headline": … }`. A `cover` that is only a string freezes no point, so the canonical title falls back to the legacy one |
| `r3:commentary-repeat` / `r3:commentary-in-facts` | Keep at most one 第一人称评论 marker (`我看`/`我觉得`/`我认为`/`在我看来`/`个人觉得`) per item, and move it into `insight` — a `lead` is the fact sentence |
| `r3:insight-multi-sentence` | Cut the comment back to one sentence: keep the judgement, drop the extra clauses |
| `r3:unattributed-claim` | Name the source in that same sentence (`据路透社报道`, `公司称`, `财报显示`, a link) or drop the figure/superlative |
| `r2:unexplained-jargon` | Gloss the term in the same sentence (`也就是说…`, `——也就是…`, or a 括号 explanation) or drop the term |

The `r2:`/`r3:` rows above are the **advisory** editorial findings (0385 AC R2/R3) that
`plugins/generations/dailynews-gen/src/editorial-claims.ts` reports on an already-accepted plan. They never
reject a plan, so they are written to `24-script/<date>_08_script-write_advisories.json` rather than the
`errors.json` that triggers this mode; fix them the same way when that file is handed to you.

## Mode: curate / curate --fix

See `references/selection.md`. Reads QC candidates (`--in`) and writes two JSON files:
1. `--out-plan` (`21-plan/<date>_03_plan_plan.json`): bare `Doc[]` of **kept** items only, in editorial order (lead first), with `title`, `body` and `metadata.brief` adapted into spoken simplified Chinese.
2. `--out-excluded` (`21-plan/<date>_03_curate_excluded.json`): `[{"id":"<Doc.id>","reason":"<具体中文原因>"}]` for every dropped candidate (`[]` when none dropped). Every candidate id must land in **exactly one** of the two files.

With `--fix <errors.json>` (`missing-plan`, `invalid-json`, `unknown-id`, `missing-item`, `conflict-id`, `empty-plan`), repair the partition so every candidate id is accounted for exactly once and at least one in-scope item is kept.

## Mode: align

Runs once, after the final selection and before drafting (design `每日AI乱炖编辑与分发设计` §2, ADR-054).
Inputs: the selected items with the IDs and provenance 0393's selection produced, and the current
`conclusion.md` ledger snapshot. Output: a proposal, or `{"version":1,"judgments":[]}` when this run
has no evidence-backed change — an empty proposal is the normal case, not a failure.

Write only judgments you can source in this run's selected items. Each entry:

```json
{
  "version": 1,
  "judgments": [
    {
      "id": "j-<stable-slug>",
      "selectedId": "<a selected item id from this run>",
      "storyKey": "<the item's story key, when known>",
      "date": "<YYYYMMDD>",
      "fact": "听众需要知道的事实（一句，中文）",
      "attribution": "谁说的 / 哪个来源",
      "comment": "编辑判断：为什么重要或该看什么",
      "evidence": { "url": "https://…", "checkedAt": "<ISO-8601>" },
      "supersedes": "<judgment id, or null>"
    }
  ],
  "preamble": "本期更正说明（仅当有 supersedes 时）"
}
```

Rules the deterministic commit enforces (a violation is a failed run, not a silent drop):

1. **No invention.** Every `selectedId` must be one of this run's selected ids; every `fact` must come
   from that item. A judgment with no evidence URL and check time is rejected.
2. **Stable ids.** Reuse the same `id` for the same judgment across runs. Re-proposing identical
   content is a no-op; re-proposing the same `id` with different content is refused — a confirmed
   judgment is never overwritten.
3. **Corrections supersede, never edit.** To fix an aired error, write a new judgment whose
   `supersedes` names the old id, with listener-facing wording ("上期说…有误，向听众致歉，以…为准")
   in `comment` and `preamble`. The old record stays in the ledger marked superseded, and the commit
   returns a stable correction id for the channel plugins (0396). Keep the apology, the wrong claim
   and the corrected fact together — the draft (0385) reads them from the frozen snapshot.
4. **Empty is legal.** No new evidence means an empty `judgments` array: the run reuses the committed
   ledger as its legal snapshot and appends nothing.

## References

- `references/style-contract.zh.md`: the column's style contract and machine block (caps, banned).
- `references/daily-visual-composition.md`: the shared cover-scene direction — the ten patterns, the protected headline/logo zones, eight worked examples and the refusal list. Read it before authoring `cover`, or follow `../daily-news-cover/SKILL.md` mode `scene`, which owns the scene contract.
- `../daily-news-illustrations/SKILL.md`: the card series' artwork direction (mode `card`) — one sourced scene per card, cover/closing from the existing fallback, never a new episode-level field.
- `references/selection.md`: curate policy (boundary, ordering, depth budget, translation).
