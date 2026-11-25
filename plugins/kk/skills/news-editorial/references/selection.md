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

## CN lead constraint (0433)

The plan feeds a **CN-distributed cut** (小宇宙 / 微信公众号 / 视频号 / 即刻) and the overseas surfaces from the
same script. Platform review items `XY-02` (`../content-safety/references/platforms/xiaoyuzhou.md`) and `WX-01`
(`.../wechatmp.md`) block a 单集 whose mainline is **时政 / 贸易管制 / 公共安全审查** — political affairs, export
or trade controls (出口管制/实体清单/关税/制裁), state- or public-security review (国家安全审查/情报/审查委员会),
foreign-intelligence framing. So:

- **Never lead a CN cut with that mainline.** It may not be the lead title, the cover headline or the episode
  summary. It normally stays in scope as an **item** (SKILL.md shared rule 2 keeps regulation and export
  controls that decide AI capacity reportable, and the 2026-11-24 operator ruling grades an overseas vendor
  under its own regulator as `note`); only the lead position is constrained.
- **Chosen behaviour when it is also the day's biggest story: demote.** Move it to the best body position and
  lead with the first clean in-scope story, and rewrite the demoted title/`metadata.brief` as a neutral
  headline that names the AI-industry fact (融资、产能、客户、定价、产品) instead of the state-security or
  trade-control framing. Keep every fact, number and name — this is a framing change, never a fact change.
- **Tradeoff, recorded.** The alternative was **two cuts** (a CN lead and an overseas lead). The pipeline
  ships one zh script, one TTS pass and one bundle, so two leads would mean a second render path, a second
  headline slot and two audio variants — far more than the day's loss. Demote keeps one cut and one
  synthesis bill, at the cost of the CN surface not leading with the day's biggest story. If the losing
  story is genuinely the only consequential one, the run refuses before synthesis instead
  (`daily-curate-check --final` writes `21-plan/<date>_03_cn-lead-refusal.json` and exits non-zero rather
  than pay for an episode the CN rows would drop afterwards).
- **Enforced in code, not by this prose.** `daily-curate-check` runs `plugins/kk/scripts/cn-lead-gate.ts` on
  the lead (plan index 0). The scanned surface is the `title` plus the first of `metadata.brief` / `summary` /
  the body's first sentence — the same fallback the CN show notes use. A trip rejects the plan with rule
  `cn-lead:XY-02`, naming the matched terms in the error's `detail`. The vocabulary lives in that module,
  which cites `XY-02`/`WX-01` as its source of truth — re-verify against the platform files when a platform
  ruling changes.
- **Weak-lead fallback (0438).** On `--final`, when no candidate is clean, the first candidate whose hits all
  come from the two-signal heuristic (AI object × policy signal — it also fires on some product copy) leads,
  and the run logs `weak lead <id> (<terms>)` instead of refusing. The refusal is kept for a pool where every
  candidate carries an enumerated vocabulary term.
- **Re-measure before changing the gate.** `plugins/kk/tests/fixtures/cn-lead-calibration.json` holds 30
  class leads (≥28 must trip), 86 product leads (≤3 may trip) and the accepted misses; run
  `bun test plugins/kk/tests/cn-lead-gate-0438.test.ts`. Add rows for a new shape; never edit a row after
  seeing the gate's output, and pin each new term or actor with a class row that goes clean without it.

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
- `cn-lead:XY-02`: the lead (plan index 0) carries a 时政/贸易管制/公共安全审查 mainline in its `title` or
  `metadata.brief`; the error's `detail` names the matched terms. Demote that item to a body position, lead
  with the first clean in-scope story, and rewrite the demoted `title`/`metadata.brief` into a neutral headline
  (see § CN lead). Do **not** drop the item: it is still reportable, just not as the lead.
