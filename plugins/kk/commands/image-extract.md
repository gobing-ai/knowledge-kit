---
name: image-extract
description: Extract a reusable style preset (and optionally draft a format preset) from 1-5 reference images, saved to ~/.config/kk/image-presets/ after confirmation.
argument-hint: "--name <style-name> --ref <img> [--ref <img>…] [--emit-format <name> --job free|cover|illustration]  (max 5 refs)"
allowed-tools: ["Skill"]
---

# image-extract

Thin wrapper for the `image-authoring` skill's `extract-style` operation — all vision
analysis, schema-fill, merge, and validation logic lives in the skill. Forward
`$ARGUMENTS` with one substitution: this command's `--name <style-name>` is the skill's
`--extract-style <name>` (the flag doubles as the operation selector there — rewrite it,
do not pass `--name` through). `--ref`, `--emit-format`, and `--job` pass through unchanged.

```text
Skill(skill="kk:image-authoring", args="$ARGUMENTS with --name rewritten to --extract-style")
```

## What it does

- Reads 1–5 reference images (`--ref`, repeatable; more than 5 is refused), analyses
  the look, and shows you the composed `StylePreset` YAML for `--name <style-name>`.
- **Confirms with you before writing**, then saves to the user root
  `~/.config/kk/image-presets/styles/<name>.yaml` — usable immediately via
  `/kk:image-generate --style <name>`, shadowing any shipped preset of the same name.
- With `--emit-format <name> --job <job>`, additionally **drafts** a format preset from
  the same images: measured dimensions + declared job + visual defaults authored from
  the analysis, skeleton (variables, template grammar) reused from the shipped format
  of the same job. Shown for confirmation and fine-tuning, then written to
  `~/.config/kk/image-presets/formats/<name>.yaml` with `defaultStyle` set to the
  style just extracted.
- Validates each new preset with a dry-run generation (`KK_IMAGE_DRY_RUN=1`).

Examples:

```text
/kk:image-extract --name flat-retro --ref a.png --ref b.png
/kk:image-extract --name flat-retro --ref a.png --emit-format retro-cover --job cover
```
