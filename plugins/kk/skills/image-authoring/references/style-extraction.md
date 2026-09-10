# Style extraction from reference images

Loaded by the image-authoring skill when the operator hands over one or more
reference images and wants the look captured as a reusable style preset.
Extraction is a **skill operation** — the running agent reads the image(s) with
its own vision and writes a YAML file. No plugin code, no vision API call, no
provider credential is involved.

There are two mechanisms for using a reference image, and this file owns the
boundary between them:

| baoyu usage | kk mechanism | What happens |
| --- | --- | --- |
| `direct` | pass-through | The file rides `ImageJobSpec.referenceImages` (0104) to a provider whose `supportsReferenceImages(model)` is true (0103). Highest fidelity; produces one image, nothing reusable. |
| `style` | extraction (this file) | The look is analysed and written as a `styles/<name>.yaml`. Works with every provider; reusable and editable. |
| `palette` | extraction, partial | Same procedure, but only `palette`, `name` and `description` are filled; `modifiers` stays a one-line summary. |

## Where the preset goes

Write to the **user root**: `~/.config/kk/image-presets/styles/<name>.yaml`. A cloned
look is usually the operator's, not the repository's. An operator who wants the
preset shared with a team writes to the project root
(`<KNOWLEDGE_KIT_PROJECT_ROOT>/.kk/image-presets/styles/`) instead — it ranks
higher in the loader chain. No registration step exists or is needed: the
loader discovers presets by scanning these directories (0102). If the chosen
name matches a shipped preset, the new file **shadows** it whole-file and the
loader emits a `shadowed` diagnostic naming both paths — that is the intended
way to adjust a shipped style, not an accident.

## Input rules

- **One to five reference images.** Count them before reading anything.
- **Cap refusal (exact wording):** if the operator supplies more than 5, refuse
  before reading any of them:
  `Refusing extraction: <N> reference images requested; the cap is 5. Split the set into coherent groups, or drop the least representative references and re-run.`
  The cap is a constant, not a design commitment; changing it means changing
  this number and this message only.

## Output rules — the schema is frozen

Emit **YAML only** — no prose, no code fence. The document fills **exactly**
the `StylePreset` fields of `plugins/generations/image-gen/src/presets.ts` and
nothing else. **Inventing a field outside this list is a defect, not an
enhancement.** Field-by-field:

| Field | Required | Rule |
| --- | --- | --- |
| `name` | yes | kebab-case, derived from the look, never from the filename. |
| `description` | yes | One or two sentences naming the look and where it works. |
| `modifiers` | yes | A comma-separated prompt fragment in the same voice as the shipped styles under `plugins/generations/image-gen/presets/styles/` — `composePrompt` concatenates it as segment 3 of a comma-joined prompt. Read two shipped styles before writing one; a style in the wrong voice produces a prompt in two voices. |
| `palette` | no | 3–6 entries of `{role, name, hex}`. `role` from `{primary, secondary, accent, background, text}`. `hex` uppercase `#RRGGBB`, sampled from the image, never invented. (A merged set may legitimately keep fewer than 3 — only colours common to every reference survive; see merge rules.) |
| `typography` | no | Only when the image evidences it. Omit rather than guess. |
| `visualElements` | no | Array of strings naming recurring visual devices (borders, banding, grain, iconography). Only what the image shows. |
| `bestFor` | no | The content types this look suits. Inferred from the image's own subject matter. |
| `negative` | no | What this look must avoid — inferred from what is conspicuously absent. |
| `source` | yes for extraction | `kind: extracted`, `refImages` = the absolute input paths **in the order given**, `extractedAt` = ISO-8601 timestamp, `confidence` = the judgement below. |

### The `confidence` decision rule (human-judged, not computed)

- `high` — a single clean image with an obvious, consistent look.
- `medium` — mixed or noisy references, or a merged set where the references
  disagree on any of the four fidelity axes.
- `low` — the look is ambiguous, or the image is photographic content rather
  than a designed style (a photo *of* something is not a style).

## Multi-image merge rules

With N references (1 ≤ N ≤ 5) the output is **one merged preset**, not N
presets and not an average:

- `palette` — colours **common to the set**. A colour appearing in one image
  only is dropped, not averaged into a muddy midpoint.
- `modifiers` — traits present in **every** image. Divergent traits are
  dropped, and each discarded trait is **named in the extraction report** so
  the operator sees exactly what was thrown away.
- `confidence` — capped at `medium` when the set disagrees on any fidelity axis.
- `source.refImages` — all N absolute paths, in the order given.

## What extraction never writes

**Style only — no format extraction in v1.** A `FormatPreset` carries
`template`, `variables`, `keywords`, `defaultStyle`, `outputFilename` — none of
which is recoverable from a picture. Never write a `formats/*.yaml` file. What
an image *does* yield is arithmetic, not extraction: the extraction report
**states the observed pixel dimensions and the nearest named aspect ratio** of
each reference, chosen from `21:9`, `4:3`, `1:1`, `16:9`, `3:4`, `9:16`, as a
suggestion for which existing format to pair the style with.

## Pass-through degradation (visible, never silent)

When the operator wants `direct` (pass-through) and the selected provider's
`supportsReferenceImages(model)` returns `false`, the skill must state it in
these terms and offer the alternative:

`Provider <name> cannot accept reference images for model <model> (supportsReferenceImages: false). Pass-through is unavailable; offering style extraction instead.`

**Never silently proceed without the reference.** A plausible image generated
from a dropped reference is the worst outcome available — worse than an error.

## Validate after writing

After writing the YAML, run the dry run: `KK_IMAGE_DRY_RUN=1` `image-gen`
(0104) with a job whose `style` is the new preset's name. A malformed or
unloadable file fails there loudly, naming the file and the schema violation,
before any provider spend. No validator is written; 0102's loader and the dry
run already are one.

## Fidelity check (v1 method: human eyeball)

To answer "did the clone work": extract from reference **I**, regenerate with
the extracted preset using a prompt describing **I's own subject** (so subject
variance does not contaminate the comparison), then compare **I** and the
regeneration on exactly four axes — **palette, rendering technique,
composition density, typographic treatment**. The v1 comparison method is a
human eyeballing the pair; no metric is computed. Record the verdict in the
preset's `source.confidence`; if the fidelity verdict disagrees with the
extraction-side judgement, take the lower.

## Worked output shape

```yaml
name: example-look
description: Flat colour-band composition with deep teal over warm cream.
modifiers: flat colour-band composition, deep teal and warm cream palette, hard edges, no gradients, minimal detail
palette:
    - { role: primary, name: deep teal, hex: '#1D5C63' }
    - { role: background, name: warm cream, hex: '#F5EFE0' }
source:
    kind: extracted
    refImages:
        - /absolute/path/to/reference.png
    extractedAt: '2026-09-09T18:00:00Z'
    confidence: high
```
