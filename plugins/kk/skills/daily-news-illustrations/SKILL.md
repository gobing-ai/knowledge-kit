---
name: daily-news-illustrations
description: >-
  Use the daily-news-illustrations skill to author the artwork direction a daily AI news episode's
  Xiaohongshu card series renders from — "write the card scenes", "author the XHS card art", "why did
  card 3 miss the story". Owns the per-card `subject` scene only, composed against the shipped
  composition reference; never owns card copy, order, roles, the plan shape or the renderer.
  Modes: card.
requires: [cli:kk, local-fs]
---

# daily-news-illustrations — the card series' artwork direction

## Purpose

One ordered card series, one scene per card. This skill turns the episode's card plan into the
text-free English scenes the pinned `xhs-card` format renders, so every card in a day reads as one
series while still illustrating its own story. Everything deterministic stays in code and is **out of
scope**: `copy`, `points`, `role`, `layout`, card order, `title`/`body`, `sourcePoint`, `itemId`
(`news-editorial` mode `write`, `plugins/kk/scripts/daily-stages.ts` `dailyEditorialRender`), the
format/style/provider/model pins, the Chinese compositor, the published manifest and the resume path
(`kk stage daily-xhs-render`).

The composition knowledge is shared, not restated here: read
`../news-editorial/references/daily-visual-composition.md` first. It owns the ten patterns, the
protected regions and the eight worked examples. Card art differs from the cover only in what it
must survive: a card is composed with deterministic Chinese text, so the scene carries no lettering
and keeps its focal detail clear of the copy band.

## Invocation contract

`card` mode: the ordered plan plus the selected items → one `subject` string per card.

| Caller | Input | Output |
| --- | --- | --- |
| `kk-news-generate` `script-write` / `script-fix` (canonical master plan) | `items[].card` (`copy`, `points`) + the matching plan `Doc` | only `items[].card.subject` |
| `kk-daily-ai-voice` / `kk-daily-ai-voice2` `xhs-write` (legacy card plan) | `cards[]` (`role`, `copy`, `points`, `sourcePoint`) + the plan `Doc[]` | only `cards[].subject` |
| manual standalone work | the same `{title, body, cards}` plan | the same `subject` fields, then `kk news generate-cards --work-dir <dir>` |

Write only the field the caller names. The caller's plan shape, keys, order and guards stay
byte-identical.

## Rules

1. **One card, one story.** Derive each content card's scene from the item it illustrates — the
   approved `Doc`/lead and the fact that card's `sourcePoint` (or `points`) states. Never borrow a
   neighbouring item's subject, and never invent a fact the plan does not carry.
2. **Keep the derived cards derived.** The `cover` and `closing` cards take their scene from the
   existing episode fallback (`dailyEditorialRender` uses the cover scene, else the first content
   card's subject, else its neutral default). Do not ask for new episode-level fields and do not
   override that derivation.
3. **Choose one pattern** from the shared reference — a clear object, or a simple two-part comparison
   when the card's own fact is an A/B. Never stack patterns, never illustrate the copy literally.
4. **Compose for the text.** The compositor writes Chinese copy over the artwork: keep the focal
   detail out of the copy band, and keep it inside the middle column so a square crop still shows it.
5. **Scene only.** English, ≤240 characters, objects/settings/metaphor only. No text, letters,
   numbers, logos, flags or recognizable people; no style, colour, lighting or composition
   instruction — the pinned style owns those.
6. **Series coherence without repetition.** Cards of one episode share a world (materials, palette
   family, light) through the pinned style, not through copied scenes: two cards of the same episode
   must not carry the same scene.

## Mode: card

Emit the plan with **only** the `subject` fields filled in:

```json
{ "cards": [ { "role": "cover", "subject": "…" }, { "role": "content", "subject": "…" } ] }
```

`copy`, `points`, `layout`, `role`, `sourcePoint`, `itemId`, `title` and `body` are copied through
unchanged. A card whose `copy`/`points` are missing is the caller's defect, not yours to repair: leave
its `subject` empty and say so, so `daily-xhs-render` refuses the plan with its own named error rather
than rendering an unsourced scene.

## Rejections

Return the scene again instead of spending a render when the draft carries lettering, a logo, a flag,
a recognizable person, a style instruction, a scene copied from another card, an unnamed product, or
more than 240 characters. The shared reference's **Refusals** section is the binding list.

## References

- `../news-editorial/references/daily-visual-composition.md`: patterns, protected regions, worked
  examples, refusals.
- `../news-editorial/SKILL.md`: ownership of `cards.title/body`, `items[].card.copy/points` and the
  plan shape.
- `../daily-news-cover/SKILL.md`: the episode cover scene (0424), which the cover card reuses.
- `plugins/kk/scripts/daily-stages.ts`: `dailyEditorialRender` (card plan + fallback derivation) and
  `dailyXhsRender` (per-card render, cached-artifact reuse, manifest).
