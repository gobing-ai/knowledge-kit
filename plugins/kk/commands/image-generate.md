---
name: image-generate
description: Generate images from a prompt or an article — covers, illustrations, or free-form — using named format and style presets.
argument-hint: "[--format free|cover|illustration] [--style vibrant|minimalist|photorealistic|technical-diagram|editorial|fresh|warm|cute|sketch|clean-webapp-ui|<custom>] [--content <file>] [--ref <img>…] [--var K=V] [--dry-run] [--list-presets] [prompt]"
allowed-tools: ["Skill"]
---

# image-generate

Thin wrapper for the `image-authoring` skill — all preset resolution, preference precedence,
confirmation and delegation logic lives in the skill. Forward `$ARGUMENTS` unchanged.

```text
Skill(skill="kk:image-authoring", args="$ARGUMENTS")
```

## Built-in presets (user presets under `~/.config/kk/image-presets/` shadow these)

**Formats** (`--format`; default `free`):

| Format         | Job                                               | Aspect | Default style     |
| -------------- | ------------------------------------------------- | ------ | ----------------- |
| `free`         | free-form image from the positional prompt        | 1:1    | vibrant           |
| `cover`        | article cover; requires `--content <file>`        | 21:9   | vibrant           |
| `illustration` | auto-insert illustrations into `--content <file>` | 4:3    | technical-diagram |

**Styles** (`--style`): `vibrant` · `minimalist` · `photorealistic` · `technical-diagram` ·
`editorial` · `fresh` · `warm` · `cute` · `sketch` · `clean-webapp-ui` — or any custom style
preset name. Omit to use the preference `image.style` or the format's default.

Run `--list-presets` for the live list with origins and shadows.
