# XHS card layouts — adapted from `baoyu-xhs-images`

Source: `vendors/baoyu-skills/skills/baoyu-xhs-images/SKILL.md` (MIT © Jim Liu).
Adapted: layout names, typography rules, consistency guidance. Not imported:
backend selection, batch/parallel generation, `EXTEND.md` chain.

## Layout catalog

| Layout | Use when | On-card structure |
| ------ | -------- | ----------------- |
| `cover` | Card 01 | Big headline (≤ 12 chars), one-line hook, small series label |
| `definition` | One concept to explain | Term + one-sentence definition + 2 short points |
| `list` | 3–4 parallel items | Numbered short lines, uniform phrasing |
| `comparison` | Two options | Two columns, 2–3 contrast points each |
| `steps` | Ordered process | 3–4 numbered steps, verb-first |
| `quote` | Key sentence from source | Large quote text + attribution line |
| `summary` | Closing card | 3 takeaways + one CTA line |

## Typography rules

- Headline: extra-large bold; ≤ 12 Chinese characters.
- Points: short lines, 2–4 per card, generous line spacing.
- Keep total on-card text minimal — the model renders text, so fewer words
  means fewer rendering defects.
- Language default: 简体中文 (`xhs-card` format `language` var).

## Consistency rules

- Compose the cover prompt first; fix palette/typography wording there.
- Per-card prompts reuse that wording verbatim; vary only
  layout/points/subject (via the `xhs-card` template variables).
- When the provider/model is reference-capable per `kk:image-authoring`
  `references/providers.md`, cards ≥ 02 set `referenceImages: [<cover path>]`.
- Renders are strictly sequential (card 01 → N) so the cover reference exists
  before dependents render.
