# Migrating from the wt image commands

For operators arriving from the `wt` plugin (`/wt:image-generate` and its
three skills). The kk surface is **one command** (`/kk:image-generate`)
driving **one skill** (`kk:image-authoring`). Flag by flag:

| wt flag | kk replacement | Why |
| --- | --- | --- |
| `--template <name>` | `--format <name>` | Templates are formats now — data presets (0102). wt's `default` → `free`; `cover` → `cover`; `illustrator` → `illustration`. A custom template like `cover-xhs` becomes a YAML file in `~/.config/kk/image-presets/formats/` — no skill or plugin edit needed. |
| `--resolution WxH` | *(dropped)* | The format's `aspectRatio` owns dimensions (0102 R1) — a portable ratio beats per-call pixels across twelve providers. A different shape means a different or overridden format. |
| `--backend <name>` | `--provider <name>` | 0103's inventory replaces wt's three backends: `gemini` → `google`; `nano_banana` → `replicate`; `huggingface` has no kk equivalent. Omitting `--provider` auto-selects (see providers.md). |
| `--list-templates` | `--list-presets` | Lists formats **and** styles from the real preset roots, with origin and shadowing diagnostics. |
| `--output <path>` | `--out <dir\|file>` | A path ending `.json` is used verbatim; anything else is a directory, and generated images land as its siblings. |

Kept, unchanged in meaning: the positional prompt, `--style`,
`--var KEY=VALUE`, `--content <file>`.

Also different, by design:

- The command validates nothing — the skill does. Thinner command, same
  refusals, one place that knows the rules.
- The three wt skills' model work (content analysis, style auto-detection,
  position detection) lives inside this one skill as named capabilities, not
  three skills.
- The `wt:image-generator` coordinator subagent is deliberately **not
  ported** — a forwarder over a single skill is an indirection with nothing
  in it.
- Spend control: kk previews the real prompt via a `KK_IMAGE_DRY_RUN=1` run
  and asks once before the paid run; workflow nodes must set
  `KK_NONINTERACTIVE=1`. The wt `--resolution`-style per-call budget has no
  equivalent — `maxImages` (env/config) is the cap.
