---
name: article-adapt
# Description rules: front-load the leading identity phrase; one trigger per genuine
# branch (collapse synonym triggers into one); never restate the body's identity line.
description: This skill should be used when a kk-itc publish plan contains variants with adapt=true and per-variant Content files must be written — "adapt the article", "translate for the target profile", "write content.zh-article.json", or when a spur workflow agent.run step invokes kk:article-adapt. Translates title and body to the variant locale, applies the plan limits, and preserves code blocks, URLs and references; it holds no platform table.
requires: [cli:kk, cli:spur, local-fs]
---

# article-adapt


This skill adapts one published article into one Content file per `publish-plan.json` variant with
`adapt: true`. It is deliberately **thin**: the plan (built by `buildItcPublishPlan` in
`apps/cli/src/itc-plan.ts` from each publish manifest's declared profiles) carries the per-variant locale, format and limits — this skill
holds **no platform table** and never decides which variants exist.

## Inputs

- `<work_dir>/4-publish/publish-plan.json` — `{live, sourceLocale, variants, fanout, browser}` where
  each `variants[<locale>-<format>]` entry is
  `{file, adapt, limits?, switches}`.
- `<work_dir>/4-publish/content.json` — the source article (the `sourceLocale` materialized draft).

## Output

For every `variants[*]` entry with `adapt: true`, write
`<work_dir>/4-publish/<entry.file>` (e.g. `content.zh-article.json`) as a Content JSON object:

```json
{
  "title": "<translated title>",
  "format": "<variant format suffix, e.g. article | wechat-article | short-note | short-post>",
  "body": "<translated body>",
  "metadata": { "coverImage": "...", "tags": [], "description": "..." },
  "references": [{ "url": "...", "title": "...", "cite": "id" }]
}
```

## Procedure

1. Read the plan. Collect the variants whose `adapt` is `true`. If there are none, report that and
   stop — do not write any file.
2. For each such variant, read `content.json` and produce the variant file:
   - **Translate** `title` and `body` into the variant locale (the locale is the part of the variant
     key before the first `-`). Keep every code block, URL and inline link verbatim — never
     translate code, identifiers, commands or URLs.
   - **Carry over** `references[]`, `metadata.coverImage`, `metadata.tags`, `metadata.keywords` and
     `metadata.description` unchanged.
   - **Apply the limits** from the entry's `limits` (e.g. a max character count): trim the body
     within the limit without dropping code blocks or breaking markdown; state in one closing line
     that the full article is available at the source URL when content had to be cut.
   - **Set `format`** to the variant key's format suffix (the part after the first `-`).
3. Write the file with `metadata` present (at minimum `{}`). A valid Content object always has a
   non-empty `title` and `body`.
4. Report each written path as the last line of stdout.

## Invariants

- **Never set draft or live switch keys.** Do not write `metadata.published`,
  `metadata.publishStatus` or `metadata.operation`: `itc-publish-fanout` stamps the plan's
  `switches` into each variant's metadata at send time (V3 — the switch is deterministic code, not
  model output).
- **No platform knowledge.** If the plan names a variant, adapt it; if a limit is missing, adapt
  without a limit. Never hard-code target names, locales or limits in this skill.
- **Faithful translation.** Do not add, remove or reorder sections relative to the source body; the
  approved outline's structure is preserved.

## Gotchas

1. **Read the plan, not the target list** — the plan, not `publish_targets`, is the adaptation
   contract.
2. **A missing source `content.json` is a blocking error** — the materialize state always writes it
   before publish-plan; if it is absent, fail loudly instead of inventing content.
3. **One file per adapt variant, exact path** — write `<entry.file>` under `4-publish/`; a
   follow-up `kk stage itc-adapt-verify` step fails the workflow when a variant file is missing or
   lacks `title`/`body`.

## Platform Notes

### Claude Code

Invoked from a spur workflow `agent.run` step; the prompt supplies the work_dir path.

### Codex / OpenClaw / OpenCode / Antigravity

Run file reads/writes via the available file tools; arguments arrive in the step prompt.
