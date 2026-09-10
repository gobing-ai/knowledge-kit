---
name: image-generate
description: Generate images from a prompt or an article — covers, illustrations, or free-form — using named format and style presets.
argument-hint: "[prompt] [--format <name>] [--style <name>] [--content <file>] [--ref <path>] [--var K=V] [--dry-run] [--list-presets]"
allowed-tools: ["Skill"]
---

# image-generate

Thin wrapper for the `image-authoring` skill — all preset resolution, preference precedence,
confirmation and delegation logic lives in the skill. Forward `$ARGUMENTS` unchanged.

```text
Skill(skill="kk:image-authoring", args="$ARGUMENTS")
```
