---
title: kk-itc end-to-end — rough idea to multi-platform publish
status: accepted-design
feature: F41
adr: [ADR-021, ADR-022]
sync: [T1, T3, T4]
---

# kk-itc end-to-end (F41)

`plugins/kk/workflows/kk-itc.yaml` becomes the single IT-content pipeline: rough idea → research →
outline → draft → de-slop → judge (revise loop) → cover/illustrations → per-platform adaptation →
Content JSON → multi-platform publish → run report. The decision and its reason are in ADR-021
(composition in one YAML) and ADR-022 (draft default; `auto` never implies live). Brainstorm:
`docs/plans/2026-09-21-itc-end-to-end-publish-brainstorm.md`.

## 1. Invariants

| ID | Invariant |
| --- | --- |
| V1 | With default vars, the state path and artifacts equal today's kk-itc (F4). Every new state sits behind a var guard. |
| V2 | `kk` owns steps and spur owns orchestration. Deterministic logic lives in `kk stage itc-*` helpers; YAML only routes. |
| V3 | Every Content sent to a target carries an **explicit** draft/live switch for that target (§5). Absence is never relied on: `zenn-pub` defaults to live when `metadata.published` is missing. |
| V4 | `publish_live=true` is the only way to publish live, and it can only be set at launch. `auto` never sets it, and a live run always pauses at `publish-confirm`, even under `auto`. |
| V5 | Every loop is bounded: auto revise ≤ `max_revisions`, interactive revise ≤ 3 (existing), fan-out retry ≤ 1, and the browser loop ≤ the plan's browser list. |
| V6 | Stage helpers are node-builtin-only (ADR-018). They do not import `@gobing-ai/kk-core`; `ContentSchema` validation happens in `kk executor fan-out` and in tests. |
| V7 | No new workflow file, `kk` noun or slash command. |

## 2. Vars (added to kk-itc)

| Var | Default | Meaning |
| --- | --- | --- |
| `auto` | `false` | The AI picks the outline, draft-review is skipped, the judge is mandatory, and the revise loop is automatic. |
| `unslop` | `false` | Run `kk:taste-unslop` on the draft before review/judge. |
| `max_revisions` | `2` | Cap on the auto revise loop. |
| `cover_enabled` | `false` | Generate a cover through `kk:image-authoring`. This is the spend approval. |
| `inline_images` | `false` | Also generate inline illustrations (`metadata.positions`). This is also a spend approval. |
| `publish_targets` | `""` | Comma list of publish plugin names. Empty means no tail (V1). |
| `publish_live` | `false` | Live instead of draft (V4). |
| `source_locale` | `en` | Locale of the authored draft (`en`/`zh`/`ja`). `/workflow-run` maps `--playbook wechat` → `zh`. |
| `browser_target` | `""` | Internal cursor for the browser publish loop. Not operator-facing. |

Existing vars (`topic`, `input_file`, `work_dir`, `writer`, `playbook`, `research`, `judge`,
`outline`, `force`, `rubric`, `agent`) are unchanged.

## 3. State graph

New states: `outline-autopick`, `unslop`, `draft-autorevise`, `publish-entry`, `illustrate`,
`materialize`, `publish-plan`, `adapt`, `publish-gate`, `publish-confirm`, `publish-fanout`,
`publish-retry`, `publish-agent`, `report`. `publish-entry` and `publish-gate` are no-op `note`
states. They exist so the entry and confirm routing is written once instead of once per source
state.

| From | To | Guard | Change |
| --- | --- | --- | --- |
| outline-write | outline-autopick | `auto=true` ∧ `outline` empty | new |
| outline-write | outline-select | `auto≠true` ∧ `outline` empty | guard widened |
| outline-write | outline-commit | `outline` non-empty | — |
| outline-autopick | outline-commit | — (sets `outline` via `file.read.into-var`) | new |
| draft-write, draft-autorevise | unslop | `unslop=true` | new |
| draft-write, unslop | draft-review | `auto≠true` (draft-write: also `unslop≠true`) | guard widened |
| draft-write, unslop, draft-autorevise | judge | `auto=true` (draft-write/draft-autorevise: also `unslop≠true`) | new |
| draft-review | judge | yes ∧ `judge=true` | — |
| draft-review | done | yes ∧ `judge≠true` ∧ `publish_targets` empty | guard widened |
| draft-review | publish-entry | yes ∧ `judge≠true` ∧ `publish_targets` non-empty | new |
| judge | done | PASS ∧ `publish_targets` empty ∧ `auto≠true` | guard widened |
| judge | publish-entry | PASS ∧ `publish_targets` non-empty | new |
| judge | report | `auto=true` ∧ (PASS ∧ `publish_targets` empty, or FAIL, or NEEDS_REVISION ∧ count ≥ `max_revisions`) | new |
| judge | draft-autorevise | `auto=true` ∧ NEEDS_REVISION ∧ `.auto-revise-count` < `max_revisions` | new |
| judge | draft-revise | `auto≠true` ∧ NEEDS_REVISION ∧ `.revise-count` < 3 | new (R4) |
| judge | failed | `auto≠true` ∧ (FAIL, or NEEDS_REVISION ∧ `.revise-count` ≥ 3) | guard widened |
| publish-entry | illustrate / materialize | `cover_enabled=true ∨ inline_images=true` / else | new |
| illustrate | materialize | — | new |
| materialize | publish-plan | — | new |
| publish-plan | adapt / publish-gate | `plan.variants` needs adaptation / else | new |
| adapt | publish-gate | — | new |
| publish-gate | publish-confirm / publish-fanout | `auto≠true ∨ publish_live=true` / `auto=true ∧ publish_live≠true` | new |
| publish-confirm | publish-fanout / report | yes / no (report outcome `declined`) | new |
| publish-fanout | publish-retry | a fan-out result has `ok:false` ∧ `.publish-retry-count` < 1 | new |
| publish-fanout, publish-retry | publish-agent | a browser target has no `result.<target>.json` | new |
| publish-fanout, publish-retry | report | otherwise | new |
| publish-agent | publish-agent / report | browser target still pending / none left | new |
| report | done / failed | `report.json.outcome` is `done` / otherwise | new |

The judge input gains `docs.json` as evidence when `research=true` (R5). `draft-revise` shows the
verdict `feedback[]` when entered from `judge` (R4). Every success edge stays walkable under
`spur workflow run --dry-run` (empty verdict = PASS, the existing convention).

## 4. Stage helpers (`kk stage itc-*`)

These live in the new sibling module `plugins/kk/scripts/itc-stages.ts`. They are dispatched from
the shared runner's `switch` like the `daily-*` stages. Every failure exits 1 with a message that
names the artifact or target.

| Stage | Args | Writes | Fails when |
| --- | --- | --- | --- |
| `itc-outline-pick` | `<work_dir>` | `2-outline/.auto-pick` (letter) | `outline-recommendation.json` is missing, or `pick ∉ {a,b,c}`, or the picked option file is missing |
| `itc-materialize` | `<work_dir> <publish_live>` | `4-publish/content.json` | the draft is missing or has no H1, or the body is empty |
| `itc-publish-plan` | `<work_dir> <targets> <source_locale> <publish_live>` | `4-publish/publish-plan.json` | the target is unknown, is non-article (`podcast-pub`), is live-only while `publish_live=false` (`x-pub`), or needs a cover when none exists |
| `itc-publish-fanout` | `<work_dir> [--retry]` | `4-publish/fanout-result.<variant>.json` | the plan is missing. Target failures are data, not an exit 1. |
| `itc-publish-next` | `<work_dir>` | `4-publish/.next-browser` (empty when none are pending) | the plan is missing |
| `itc-report` | `<work_dir>` | `5-report/report.md`, `5-report/report.json`. It records the verdict and revision count, plus per-target Results when a publish tail ran. | the report cannot be written |

**Content mapping (`itc-materialize`):**

- `title` ← the draft's first H1, removed from `body`.
- `outline` ← `2-outline/outline-approved.md`.
- `references[]` ← `docs.json` `{url,title,cite:id}`, when present.
- `metadata.coverImage` ← `4-illustrations/cover.*`, when present.
- `metadata.tags` / `metadata.keywords` / `metadata.description` ← the brief frontmatter, when
  present.
- `metadata.published` ← `publish_live`, always set as a boolean (V3).

**Plan shape:**

```json
{"live":false,"sourceLocale":"en",
 "variants":{"en-article":{"file":"content.json","adapt":false,"switches":{"publishStatus":"draft","published":false}},
             "zh-article":{"file":"content.zh-article.json","adapt":true,"limits":{},"switches":{"published":false}}},
 "fanout":[{"variant":"en-article","targets":["medium-pub"]}],
 "browser":[{"target":"juejin-pub","variant":"zh-article"}]}
```

**Draft switches (V3):** `itc-publish-plan` computes `variants[*].switches` as the union of the
draft/live keys that the variant's targets read (§5). Targets that share a variant file can read
different keys: medium reads `publishStatus` and surfdash reads `published`, and both use
`content.json`. Before sending, `itc-publish-fanout` writes these switches into each variant file's
`metadata`. The switch is therefore set by deterministic code at send time, never by the LLM adapt
step.

**Fan-out:** `itc-publish-fanout` spawns `kk executor fan-out --content <variant file> --target …
--out fanout-result.<variant>.json` once per group. With `--retry`, it passes
`--retry-from fanout-result.<variant>.json` for groups that have failures.

**Report outcome:**

- `failed` when:
  - the verdict is FAIL, or
  - revisions are exhausted, or
  - any target result is `ok:false`.
- `done` when every target is ok, the publish was declined, or no targets were set.

`report.md` prints the exact `kk executor fan-out --retry-from …` command for the failed fan-out
targets.

## 5. Target profile table

The code SSOT is the `TARGET_PROFILES` const in `itc-stages.ts`, mirrored in `04_DESIGN` §3. A
locale of `source` means the draft's own `source_locale`. The variant key is `<locale>-<format>`.
When the variant key equals `<source_locale>-article`, the target uses `content.json` and is not
adapted.

| Target | Transport | Locale | Format | Cover | Draft/live switch written per variant |
| --- | --- | --- | --- | --- | --- |
| `medium-pub` | fan-out | en | article | — | `metadata.publishStatus: draft\|public` |
| `substack-pub` | browser | en | article | — | `kk:publish` default draft; `--live` only when `publish_live` |
| `emdash-pub` | fan-out | source | article | — | `metadata.published` |
| `surfdash-pub` | fan-out | source | article | — | `metadata.published` |
| `zenn-pub` | fan-out | ja | article | — | `metadata.published` (V3: never omitted) |
| `qiita-pub` | fan-out | ja | article | — | `metadata.published` |
| `wechatmp-pub` | fan-out | zh | wechat-article | required | `metadata.operation: draft`; the plugin refuses every live operation (`wechatmp-pub/src/index.ts:171`), so it is rejected when `publish_live=true` |
| `juejin-pub` | browser | zh | article | — | `kk:publish` default draft |
| `infoq-pub` | browser | zh | article | — | `kk:publish` default draft |
| `xhs-pub` | browser | zh | short-note (≤1000 chars) | required | `kk:publish` default draft |
| `x-pub` | fan-out | en | short-post (≤280) | — | **live-only** (`operation: post` has no draft); rejected unless `publish_live=true` |
| `podcast-pub` | — | — | — | — | rejected: not an article target |

The profile-table task checks the switch column against each plugin's `src/`, because that column
is where V3 is enforced. A plugin whose draft switch cannot be confirmed is left out of the table
and is rejected by `itc-publish-plan` until it is fixed.

## 6. Model-bearing steps (`agent.run`)

| State | Skill | Contract |
| --- | --- | --- |
| outline-write (changed prompt) | writer (`itc-generating`) | when `auto=true`, also writes `2-outline/outline-recommendation.json` `{pick, rationale}` |
| unslop | `kk:taste-unslop` | edits `3-draft-draft-article.md` in place |
| judge (changed prompt) | `kk:content-judge` | adds `docs.json` as evidence when present |
| draft-autorevise | writer | applies `.itc-verdict.json` `feedback[]` and increments `.auto-revise-count` |
| illustrate | `kk:image-authoring` | writes `4-illustrations/cover.*` / `inline-*.{png,jpg}`; `KK_NONINTERACTIVE=1 KK_IMAGE_AUTO_CONFIRM=1` |
| adapt | **new** `kk:article-adapt` | for each `plan.variants[*]` with `adapt:true`, writes its Content file: translates `title`/`body`, applies `limits`, keeps code/URLs/references, and copies the draft switch from the plan |
| publish-agent | `kk:publish <browser_target>` | `--in <variant file>` → `4-publish/result.<target>.json`; always writes a Result, including `ok:false` |

`kk:article-adapt` is a thin skill in `plugins/kk/skills/article-adapt/`. The plan carries
per-variant constraints, so the skill holds no platform table (V2, a single SSOT).

## 7. Entry (`/workflow-run kk-itc`)

The kk-itc profile gains these flags:

- `--auto`
- `--unslop true|false`
- `--cover true|false`
- `--inline-images true|false`
- `--targets a,b`
- `--live`
- `--max-revisions N`
- `--source-locale en|zh|ja`

`--auto` defaults `research`, `judge` and `unslop` to `true` unless the operator passes them
explicitly. `--live` is never implied (V4). `--playbook wechat` without `--source-locale` binds
`zh`.

## 8. Test strategy

| Layer | File | Covers |
| --- | --- | --- |
| Stage unit | `apps/cli/tests/itc-stages.test.ts` | every §4 helper and failure row, the §5 table, V3 per target. Validates the materialized Content with `ContentSchema` (tests may import kk-core). |
| YAML structure | `apps/cli/tests/kk-itc-workflow.test.ts` (extended) | the §3 edge table; the V1 default path is unchanged; V5 caps are present |
| Dry-run walk | same file | `spur workflow run --dry-run` over `{auto:true, publish_targets:…}` reaches `done` |
| Tail integration | `apps/cli/tests/kk-itc-publish-tail.test.ts` | seeded work_dir → materialize → plan → real `kk executor fan-out` with `KNOWLEDGE_KIT_PUBLISH_TRANSPORT=fake` (zenn-pub, qiita-pub, surfdash-pub) → report. Asserts drafts plus per-target Results. |
| Profile | `apps/cli/tests/workflow-run-command.test.ts` (extended) | §7 binding |

Agent-bearing states are not executed in CI. This follows the kk-daily-ai-voice integration
pattern, where agent steps are disabled by vars. A live smoke run (fixture research, one draft
target) is recorded as manual evidence in the final task.

## 9. Artifact layout (additions)

```
<work_dir>/
  2-outline/outline-recommendation.json   .auto-pick
  .auto-revise-count  .publish-retry-count
  4-illustrations/cover.*  inline-*.*
  4-publish/content.json  content.<variant>.json  publish-plan.json
            fanout-result.<variant>.json  result.<target>.json  .next-browser
  5-report/report.md  report.json
```
