# Page shapes

A page is `<frontmatter block>` then a body. The frontmatter is flat: `key: value` lines, arrays as
`- item` lines, no nested maps.

```markdown
---
title: Vector index
type: concept
tags:
  - retrieval
sources:
  - raw/html/a1
updated_at: 2026-11-10
---

# Vector index

One paragraph a reader can act on. Mention other pages by title — the CLI links the first
occurrence of every existing title it sees in your text.

## Summary

Two to four sentences: what it is, why it matters, what it costs.

## Detail

Structured notes. Keep headings at `##` or deeper; `## AI Updates` and `## Summary` are reserved.
```

## Rules the lint enforces

| Rule | Consequence |
| --- | --- |
| `title` and `type` present | Missing either is `missing-frontmatter` / `invalid-frontmatter` |
| Slugs are title-derived | Two pages with the same title produce `duplicate-slug` |
| Links resolve | `[[unknown-page]]` is a `broken-link` |
| Pages are reachable | A page no other page links to is an `orphan` (`index.md`/`MAP.md` exempt) |

## What the skill must not produce

- Navigation prose ("In this article we will…"), TODOs, or placeholder headings.
- A page that duplicates an existing title; extend that page instead.
- `user_edited: true` on a page it authored — that flag belongs to the operator.
