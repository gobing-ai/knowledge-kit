# Core-Facts Template & Blend Contract (F61 2.1)

> **Prototype** (task 0090, `wayfinder:prototype`) — the draft contract + markdown template for the F61
> daily-pipeline **blend-facts** stage (2.1). Rough and cheap on purpose: it is an artifact to react to, not
> a shipped generator. Hardening graduates to an implement task (consumes this verbatim from task 0090
> `## Solution`). **No production plugin; no `kk-core` schema change.**

## 1. The blend mechanism (decided)

Per `docs/design/fan-in-and-fan-out-specification.md` (§1.1, shipped under B6/task 0042) and the 0088
blend-home recommendation (merge = kk subcommand, render = generator):

- **Merge (N `Doc[]` → 1 `Doc[]`): `kk executor fan-in`** — a kk subcommand, never a workflow-engine state.
  It takes repeatable `--in <Doc[]>` files and writes one deduplicated `Doc[]` to `--out`
  (`docs/design/fan-in-and-fan-out-specification.md:50-55`; implemented in `apps/cli/src/fanin.ts`).
- **Render (merged `Doc[]` → `2-facts/core-facts.md`): a `generator`** (kind `generation`) that maps the
  merged `Doc[]` into a single dated core-facts markdown `Content` (`body` = the facts markdown). 0090
  prototypes this render with a mechanical script — **no LLM** in the prototype (LLM blending is a later
  implement decision). The render's contract + template is this document.
- The workflow state `blend-facts` only wraps these two kk steps; it does not own the merge logic.

## 2. Dedup rule

`kk executor fan-in` dedupes by `Doc.id`, **first-seen wins**; a later identical `id` contributes only its
provenance, merged into `metadata.sources` (`apps/cli/src/fanin.ts:29-46`). The core-facts template carries
that rule in frontmatter (`dedup_rule: id`).

**Known ceiling (honest):** the three source namespaces are disjoint — `aihot:`, `last30days:`,
`horizon:` — so the same real-world story reported by two different sources is **not** deduped by the `id`
rule. Cross-source same-story dedupe needs a later content-based or normalized-URI rule (out of scope here;
residual risk).

## 3. Template placeholder syntax

Placeholders use the repo's `{{...}}` double-brace convention (as in `docs/.tasks/task.md`,
`plugins/kk/skills/content-judge/SKILL.md`). The generator fills each `{{...}}` value. The `{{headlines}}`
slot is a repeat block: the generator emits one `###` block per merged Doc, in fan-in first-seen order.

## 4. Template

```markdown
---
date: {{date}}                      # YYYY-MM-DD run date
sources:                            # source roster: every ingestion plugin that contributed
{{sources_roster}}                  #   repeated: `  - <plugin> (<file>)`
dedup_rule: id                      # first-seen id wins; later dups merge provenance into metadata.sources
doc_count: {{doc_count}}
---

# Core Facts — {{date}}

> Daily AI news core-facts digest. Merge: `kk executor fan-in` (id dedupe, first-seen wins).
> Render: core-facts generator (mechanical; no LLM).

## Headlines

{{headlines}}                       # repeat block, once per merged Doc in first-seen order:
### {{item_title}}
**Source:** {{source_label}} · **URI:** {{source_uri}} · **ID:** `{{item_id}}`
**Date:** {{item_date}} · **Score:** {{item_score}}
{{item_body}}
```

## 5. Per-item source attribution

Every headline block carries `source_label`, `source_uri`, and the authoritative `item_id`. `source_label`
derives from `Doc.metadata.source` (the originating tool/site), falling back to the provening
`metadata.sources[0].file` basename. This gives each item a per-item attribution independent of the
frontmatter roster.

## 6. R3 — can the four stage-2 consumers render from the facts file alone?

The four consumers (article 2.2 / script 2.3 / cover 2.4 / voice 2.5) are **generators that consume the
merged `Doc[]`** (`1-ingest/blended.json`), not the markdown facts render. The markdown `2-facts/core-facts.md`
is the human/audit form of that `Doc[]`. So "render from the facts file alone" holds for each consumer
because the source of truth for all four is the same merged `Doc[]` the facts render is drawn from; the
markdown render is not itself the consumer input. Full walk with per-consumer dispositions is in task 0090
`## Solution`.

## References

- `docs/design/fan-in-and-fan-out-specification.md` · `docs/design/generator-plugin-specification.md`
- `apps/cli/src/fanin.ts` (`mergeDocLists`) · `packages/kk-core/src/schemas.ts` (`DocSchema`)
- Task 0090 · Feature F61 · Tasks 0088 (blend home) / 0089 (source `Doc[]` shapes)
