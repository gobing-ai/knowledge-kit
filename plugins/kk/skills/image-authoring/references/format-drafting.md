# Format drafting from reference images

Loaded by the image-authoring skill when `extract-style` runs with
`--emit-format <name> --job <job>`. Produces a **draft** `FormatPreset` from the same
reference images, for the operator to confirm and fine-tune. This is drafting, not
extraction: a picture supplies measurements and visual defaults, never job semantics
or variable contracts — those are **declared** or **reused**, and the report must say
which is which.

## Field provenance — three tiers, never blurred

| Tier | Fields | Source |
| ---- | ------ | ------ |
| **Measured** | `aspectRatio`, `width`, `height` | Observed pixel dimensions of the largest reference; `aspectRatio` is the nearest named ratio from `21:9`, `4:3`, `1:1`, `16:9`, `3:4`, `9:16`. No taste involved. |
| **Declared** | `name`, `job` | The operator's `--emit-format <name>` and `--job <job>`. `job` is never inferred from pixels — a picture does not know whether it is a cover. |
| **Drafted** | `description`, `keywords`, visual `variables` defaults, `template` | Agent vision over the same references the style came from. Fine-tuning expected. |
| **Reused** | `defaultStyle`, `outputFilename`, variable names, template grammar | See skeleton rule below. `defaultStyle` is the `--extract-style <name>` of this same run — the pairing is the point of doing both in one pass. |

## The skeleton rule

Start from the shipped format of the **same job** —
`plugins/generations/image-gen/presets/formats/<job>.yaml` — read it first, then:

- **Keep** its variable names, `outputFilename` grammar, and template placeholder
  structure. The variable-to-article mapping (`{{title}}`, `{{topics}}`, …) is a
  contract with the skill's `cover`/`illustration` branches; renaming variables
  silently breaks `--content` derivation.
- **Re-author** the visual defaults from the image analysis: `description`,
  `keywords`, and the default values of the visual variables (`visual_style`,
  `composition`, `color_palette`, `atmosphere`, `mood`, or their skeleton
  equivalents) so the drafted prompt would reproduce the reference look.
- A `free` job needs no `--content` variables; keep the skeleton minimal.

## Output rules

Emit **YAML only**, filling **exactly** the `FormatPreset` fields of
`plugins/generations/image-gen/src/presets.ts` (`name`, `description`, `job`,
`aspectRatio`, optional `width`/`height`, `defaultStyle`, `keywords`,
`outputFilename`, `variables`, `template`) — inventing a field is a defect, same rule
as style extraction. Multi-image merge follows the style-extraction rule: visual
defaults reflect traits present in **every** reference; discarded divergent traits are
named in the report.

## Where the preset goes

Write to the **user root**: `~/.config/kk/image-presets/formats/<name>.yaml`, after
showing the composed YAML and getting confirmation (interactive; the Confirmation
policy governs). Same-name shipped formats are shadowed whole-file — intended, as
with styles. No registration step; the 0102 loader scans the roots.

## Validation

Before reporting done, run one `KK_IMAGE_DRY_RUN=1` generation whose `format` is the
new preset's name (and whose `style` is the run's extracted style), then report the
composed prompt from that run's `Content.body`. The report must list each field's
tier — measured / declared / drafted / reused — so the operator knows exactly what to
fine-tune.
