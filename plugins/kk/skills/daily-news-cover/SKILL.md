---
name: daily-news-cover
description: >-
  Use the daily-news-cover skill to author the one text-free visual scene a daily AI news episode's
  cover and social crop are rendered from — "write today's cover scene", "author the cover brief",
  "fix the cover subject", "why did the cover miss the story". Owns scene selection and wording
  against the shipped composition reference; never owns the headline, the pins or the renderer.
  Modes: scene | brief.
requires: [cli:kk, local-fs]
---

# daily-news-cover — the episode's one text-free scene

## Purpose

One episode, one scene. This skill turns the episode's selected lead into a single concrete visual
scene that the pinned cover format renders and the deterministic compositor then carries the frozen
headline onto. Everything deterministic stays in code and is **out of scope**: the headline and
`sourceIds` (`news-editorial` mode `write`), the format/style/provider/model pins, the 1344 × 576 PNG
and 1200 × 630 JPG outputs, typography, cropping and caching (`plugins/kk/scripts/cover-compositor.ts`,
`kk stage daily-cover`, `kk stage daily-cover-normalize`).

The composition knowledge is shared, not restated here: read
`../news-editorial/references/daily-visual-composition.md` first. It owns the ten patterns, the
protected regions and the eight worked examples; this skill owns how a caller reaches them.

## Invocation contract

| Mode | Input → output | Caller |
| --- | --- | --- |
| `scene` | the episode's selected lead (plan item `title` + `metadata.brief`) → the `cover` object inside the master script plan | `kk-news-generate` node `script-write` / `script-fix` |
| `brief` | the lead plan item → `{"subject": "…"}` at `23-cover/<run_date>_07_cover-brief.json` | legacy `kk-daily-ai-voice` / `kk-daily-ai-voice2` cover nodes |

The calling prompt supplies the paths. Write only the file it names, as one valid JSON value, and
never edit the input plan.

## Rules

1. **Pick the lead, once.** Use the episode's selected lead — the item whose `sourceIds` the frozen
   headline rests on. When the lead's mainline is a political figure, an armed conflict or a non-AI
   event, take the first in-scope item instead; an AI-subject public-policy story is in scope.
2. **Pick one pattern** from the shared reference (product-led, then comparison, then metaphor) and
   say which one in one clause. Never stack two.
3. **Place the subject for the crop.** Focal subject in the upper-centre or right-third band; the
   lower third stays empty for the composited headline; the subject's readable detail must survive
   the 1:1 feed crop (the middle column, `x 384..960` of 1344).
4. **Ground every noun in the sources.** No product, benchmark, number, place or person the plan item
   does not name. A thin story gets a smaller, simpler object — never an invented one.
5. **Scene only.** English, ≤240 characters, objects/settings/metaphor only. No text, letters,
   numbers, logos, flags, or recognizable people; no style, colour, lighting or composition
   instruction — the pinned style owns those.
6. **Never touch the frozen identity.** `headline` and `sourceIds` come from editorial and stay
   byte-identical; a scene edit is never a reason to re-freeze the title.

## Mode: scene

Return the plan's `cover` field, keeping whatever the editorial layer already froze:

```json
{
  "scene": "…",
  "headline": "…",
  "sourceIds": ["…"]
}
```

`scene` is the only field this skill authors. `headline` and `sourceIds` are copied through unchanged
when present. When the plan's `cover` is still the plain-string form, emit the object form only if the
headline is available to the caller; otherwise emit the string and let the title fall back to the
legacy shape.

## Mode: brief

Write the legacy-compatible subject brief the existing render entry points already read:

```json
{ "subject": "…" }
```

This is the same scene, wrapped for the pre-0385 shape. `kk stage daily-cover` reads `subject` and
degrades to the format's default subject when the brief is missing or invalid — so a brief you are not
sure about is still worth writing, but it is never worth inventing facts for.

## Rejections

Return the scene again (or nothing, for a legacy brief) instead of spending a render when the draft
carries lettering, a logo, a flag, a recognizable person, a style instruction, a subject in the
headline zone, an unnamed product, or more than 240 characters. The shared reference's **Refusals**
section is the binding list.

## References

- `../news-editorial/references/daily-visual-composition.md`: the ten patterns, protected regions,
  eight worked examples, refusals.
- `../news-editorial/SKILL.md`: editorial ownership of the plan, the lead and the frozen headline.
- `plugins/kk/scripts/cover-compositor.ts`: the real crop and headline geometry.
