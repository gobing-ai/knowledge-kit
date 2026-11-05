---
name: xhs-images
description: >-
  Use the xhs-images skill to turn source content into an ordered Xiaohongshu
  card series — "make XHS cards from this article", "generate a card series",
  "turn these notes into 小红书图文卡片". Plans N ordered cards (cover, content,
  closing) grounded in the source, renders them through the image-gen executor
  with the xhs-card/xhs-knowledge presets, packages a publishable Content, and
  hands off to kk:publish channel xhs. Never publishes directly.
requires: [cli:kk, local-fs]
---

# xhs-images — source-grounded XHS card series (plan → render → package → handoff)

Adapted from `baoyu-xhs-images` (MIT © Jim Liu) — layout, typography, and
consistency guidance only. Not imported: backend selection, batch/parallel
generation, `EXTEND.md` chain. Layout catalog:
`references/card-layouts.md`. Presets: `xhs-card` (format) +
`xhs-knowledge` (style). Rendering always goes through
`kk executor run image-gen` — this skill holds no transport.

## Inputs

| Input | Required | Notes |
| ----- | -------- | ----- |
| source file (md/txt) | yes | read-only; never written or modified |
| `--out <dir>` | yes | fresh dir = new plan; existing dir = resume |
| `--count <n>` | no | 1–10; default: cover + one card per major point, capped at 10 |
| `--style <name>` | no | default `xhs-knowledge` |
| `--live` | no | passed through to kk:publish as the operator's live request |

`--count` above `min(10, image.max_images)` is refused, naming
`KK_IMAGE_MAX_IMAGES` / `image.max_images`.

## Procedure

1. **Plan** — read the source; produce ordered cards: card 01 `role: cover`,
   then `content` cards in source order, then an optional `closing` card. Each
   card records `index`, `role`, `sourcePoint` (verbatim heading or sentence),
   `copy` (short Chinese on-card text), `layout` (from the reference catalog),
   `subject` (visual scene). Write `<out>/cards.json` with
   `{ source, cards: [{ index, role, sourcePoint, copy, layout, promptPath,
   imagePath, status: 'pending' }] }`.
2. **Envelopes** — for each card write `<out>/cards/NN.in.json`: the `image-gen`
   envelope with `job: free`, `format: xhs-card`, `style`, `vars` (role,
   layout, headline, points, subject, index), `provider`,
   `model`, `maxImages: 1`, `outputStem: card-NN`. For NN ≥ 02 add
   `referenceImages: [<cover path>]` **only when** `kk:image-authoring`
   `references/providers.md` marks the provider/model reference-capable.
3. **Dry-run + one confirmation** — run each envelope with `KK_IMAGE_DRY_RUN=1`;
   save the emitted `Content.body` as `<out>/cards/NN.prompt.txt` (the exact
   composed prompt; it must equal `ImageArtifact.prompt` after render). Resolve
   provider/model via `kk:image-authoring`'s preference chain (arguments >
   env > `$KK_CONFIG` > defaults). Show **one** spend preview for the series
   (provider, model, style, N, cover prompt, per-card copy list (typeset by
   image-gen's composer, not prompt text), plus the
   consistency path: cover-reference chain when the provider is
   reference-capable per `kk:image-authoring` `references/providers.md`, or an
   explicit weaker-consistency disclosure when it is not) and follow the
   `kk:image-authoring` Confirmation policy once before any paid render.
4. **Render sequentially** — card 01, then 02..N, each via
   `kk executor run image-gen --in cards/NN.in.json --out cards/NN.json`.
   On the first failure: stop spending, mark the card `failed`, later cards
   stay `pending`, report the retry.
5. **Package** — write `<out>/content.json`: `title` (XHS title, ≤ 20 chars),
   `body` (Chinese note + hashtags, ≤ 1000 chars), `format: 'text'`,
   `metadata.images` = each card's `cards/NN.json` `metadata.images[0]` in
   index order, `metadata.publishStatus: 'draft'`. Packaging refuses while any
   card is not `rendered` or its prompt/image file is missing.
6. **Handoff** — never spawn `xhs-pub` directly. Hand `content.json` to
   `kk:publish` channel `xhs`; pass `--live` through as the operator's live
   request.

## Resume

Re-running with the same `--out` reuses the existing `cards.json` and
`cards/NN.in.json` (no replanning) and renders only cards without an existing
image file — check existence via the artifact path recorded in the prior run's
`cards/NN.json` (or a `cards/card-NN-*` glob), since the provider decides the
extension. Replanning requires a new `--out`.

## Checks and limits

- N ≤ 10 and ≤ `image.max_images`; refusal names the cap env/key.
- Source file is never written.
- One spend confirmation per series; renders strictly sequential.
- Card text stays minimal (headline ≤ 12 chars, 2–4 short points): copy is
  typeset by image-gen's composer at fixed glyph floors, not rendered by the
  model — the provider prompt must stay text-free (0181). Keep the headline
  short and 2–4 points so the card fits the text panel; overflow fails loud
  before spend.
- Consistency: cover prompt fixes palette and illustration wording; per-card
  prompts reuse it verbatim and vary only layout/points/subject. When the
  provider is reference-capable, cards ≥ 02 reference the rendered cover.
