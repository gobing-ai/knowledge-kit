---
name: image-authoring
description: >-
  Use the image-authoring skill to generate images — "generate an image",
  "create a cover for this article", "illustrate this article", "make a hero
  image", "extract a style from this reference image", "clone this look",
  "list the image formats and styles". Three operations — generate,
  extract-style, list-presets — over named format and style presets, with a
  confirmation gate before any paid generation.
requires: [cli:kk, cli:spur, local-fs]
---

# image-authoring — image generation agent surface (generate | extract-style | list-presets)

## Purpose

Turn an operator request into **generated or derived image artefacts** by driving the
deterministic `kk:image-gen` generator plugin. One fat skill with three operations —
`generate` (default), `extract-style`, `list-presets` — sharing one invocation contract,
`--in` envelope, preference chain and confirmation policy. The job is not an operation:
it is **data** — each format preset declares its own `job` field
(0102), and `--format` selects the work. This is the `audio-authoring` shape applied to
a job axis that lives in YAML.

**The judgment line — the plugin executes a decided plan; this skill decides it.** The
plugin (`plugins/generations/image-gen/`) is deterministic: preset resolution and
shadowing, prompt composition, provider selection and the API call, artefact naming and
writing, and markdown insertion at a given anchor. Everything needing reading, taste or
ambiguity resolution is **this skill's**: deriving `--var` values from an article (title,
subtitle, topics), style auto-detection, illustration **position detection**, caption and
alt-text authoring, style extraction from reference images, preference precedence
resolution, and spend approval. The skill's single output to the engine is the `--in`
envelope; nothing model-shaped ever crosses it.

## When to use

- A user asks for an image: a free-form picture from a prompt, a cover for an article,
  or illustrations inserted into an article body.
- A user hands over reference images wanting the look captured as a reusable style
  preset, or asks what formats and styles exist.
- A workflow `agent.run` step needs one image job non-interactively (Confirmation
  policy — the node must set `KK_NONINTERACTIVE=1`).

## Do not use this skill for

- Speech or spoken-audio authoring (that is `kk:audio-authoring`).
- Hand-written programmatic generation: call `kk executor run image-gen` directly with
  your own `--in` envelope — this skill's value is the deciding, not the spawn.
- Editing an existing image (image-to-image): regenerate with a tweaked prompt instead.
- A coordinator subagent over this skill: none is wanted; `/kk:image-generate` is the
  whole entry surface.

## Operations

### generate (default)

Sequence: **resolve preferences** (Preference chain) → **resolve the format** →
**validate arguments** → **decide the work** → **confirm** (Confirmation policy) →
**preview** (`KK_IMAGE_DRY_RUN=1`) → **paid run** → **report**.

1. Resolve the format preset from `--format` and read its `job` field — that is the
   branch. Never hardcode format names: an operator-authored format must work with
   zero edits here (its `job` field is the only fact the skill needs).
2. If the `job` value is one of the branches below, proceed. Anything else: **stop,
   name the unimplemented branch and the format**, and never fall back to `free`.
   - `free` — the positional prompt is the subject; no `--content` needed.
   - `cover` — read `--content` and derive the format's template variables from the
     article (title, subtitle, topics) — model work, this skill's — into `vars`.
   - `illustration` — detect insertion positions and author captions per
     [references/illustration-positions.md](references/illustration-positions.md);
     the chosen anchors cross as `metadata.positions`, one image per anchor.
3. Resolve the visual direction before locking the style: `--style`, else the preference `image.style`, else the format's
   `defaultStyle`. Use each preset's `description` and `bestFor` as routing evidence. If the direction is unclear,
   offer **two or three visibly different styles** with one-sentence tradeoffs — do not force a weak third — and wait
   for the user's choice before writing a long prompt. Commit to **one primary style**; never blend style presets or
   mixed reference bundles automatically. Explicit user constraints (subject, aspect ratio, text, people, brand,
   forbidden content) override preset defaults. When the direction is clear or the user delegates the choice, the
   skill may auto-detect one style — taste, this skill's — shown in the preview for approval.
4. Resolve the provider and model per Preference chain; the credential and
   reference-image facts per provider live in
   [references/providers.md](references/providers.md).
5. Write the `--in` envelope (Artifact contract), then follow the Confirmation policy.
6. Report the `--out` path, every artefact, and for illustration the captions.
   `--dry-run` stops after the preview and reports the composed prompt.

### extract-style

Requires `--ref` (one to five images). **Authoritative procedure:
[references/style-extraction.md](references/style-extraction.md)** — read it first; it
owns the schema-fill rules, the multi-image merge rules, the cap-5 refusal wording,
where the preset is written (user root, shadowing by design), and the validation step:
read the images with your own vision, write `~/.config/kk/image-presets/styles/<name>.yaml`
filling exactly the `StylePreset` fields, then validate with a `KK_IMAGE_DRY_RUN=1` run
whose `style` is the new preset's name. Extraction writes `styles/*.yaml`; with
`--emit-format <name> --job <job>` it additionally **drafts** a `formats/*.yaml` from
the same references — a different act with its own authoritative procedure:
[references/format-drafting.md](references/format-drafting.md).

### list-presets

Enumerate the **real** preset roots the 0102 loader scans — builtin
(`plugins/generations/image-gen/presets/`), then `~/.config/kk/image-presets/`, then
`$KNOWLEDGE_KIT_PROJECT_ROOT/.kk/image-presets/`, then each `:`-separated
`KK_IMAGE_PRESET_PATH` entry — printing every format and style with its **origin
root**, plus (formats) `job`, `aspectRatio`, `defaultStyle`. Surface the loader's
diagnostics verbatim: `shadowed` names **both** paths (losing shipped file, winning
user file); `invalid` names the file and the schema violation. **Never read a shipped
markdown gallery** — no gallery exists; the roots are the one source of truth. This
output is also the text an unknown `--format`/`--style` refusal quotes.

## Invocation contract

`$ARGUMENTS` (or the Skill call args) parse as:

```
[prompt] [--format <name>] [--style <name>] [--var KEY=VALUE]... [--content <file>]
         [--ref <path>]... [--count <n>] [--provider <name>] [--model <id>]
         [--out <dir|file>] [--dry-run] [--list-presets] [--extract-style <name>]
         [--emit-format <name> --job <job>]
```

| Token | Meaning | Default |
| --- | --- | --- |
| `prompt` | free-form subject text | required for `free`; optional otherwise |
| `--format <name>` | format preset; its `job` field selects the branch | `image.format`, else `free` |
| `--style <name>` | style preset | format's `defaultStyle` |
| `--var KEY=VALUE` | template variable (repeatable) | preset `variables` defaults |
| `--content <file>` | markdown source for `cover` / `illustration` | none |
| `--ref <path>` | reference image (repeatable, **max 5**) | none |
| `--count <n>` | images to produce — **`illustration` job only** | number of `positions` anchors, else 1 |
| `--provider <name>` | 0103 provider name | auto (`AUTO_ORDER`) |
| `--model <id>` | provider model id | provider default |
| `--out <dir\|file>` | the plugin's `--out`; see Artifact contract | temp dir under the works dir |
| `--dry-run` | compose and price, generate nothing | off |
| `--list-presets` | → the `list-presets` operation | — |
| `--extract-style <name>` | → the `extract-style` operation; **requires `--ref`** | — |
| `--emit-format <name>` | with `--extract-style`: also draft a format preset from the same refs; **requires `--job`** | — |
| `--job free\|cover\|illustration` | declared job for the drafted format — never inferred from pixels | — |

**Validation is this skill's, before any plugin spawn**, each refusal naming the
offending argument: unknown `--format` or `--style` (quote what `list-presets` would
show); `--count` on a non-`illustration` job; more than five `--ref` paths;
`--extract-style` without `--ref`; `--emit-format` without `--extract-style` or
without `--job`, or a `--job` outside `free|cover|illustration`; a `--content` file
that does not exist. Flags the
wt plugin retired are **answered, not ignored** — state the replacement and stop; the
table lives in
[references/migrating-from-wt.md](references/migrating-from-wt.md)
(`--template` → `--format`, `--resolution WxH` → the format's `aspectRatio`,
`--backend` → `--provider`, `--list-templates` → `--list-presets`).

## Artifact contract

The skill writes exactly one input file — the `--in` JSON: a `Doc[]` whose **first
element** carries the whole job spec at `metadata.imageGen` (strict schema; a typo'd
key fails loud), plus `metadata.positions` for the illustration job:

```json
[{
  "id": "doc-1", "title": "Article title", "body": "<article text>",
  "metadata": {
    "imageGen": {
      "job": "cover", "format": "cover", "style": "vibrant",
      "provider": "seedream", "model": "doubao-seedream-5-0-260128",
      "vars": { "title": "Article title", "subtitle": "Derived subtitle" },
      "maxImages": 4, "outputStem": "article-title"
    },
    "positions": ["## A heading that occurs exactly once in the body"]
  }
}]
```

| Path | Rule |
| --- | --- |
| `--out` ending `.json` | used verbatim as the plugin's `--out` |
| `--out` anything else | treated as a directory; the plugin's `--out` becomes `<dir>/content.json` |
| generated images | **siblings** of `--out` (0104), named from the format's `outputFilename` |
| output `metadata.images[]` | one entry per image: absolute `path`, `format`, `style`, `provider`, `model`, the exact `prompt`, `bytes` |
| output `metadata.captions[]` | illustration only: `{index, path, caption, altText, anchor}` |

`metadata.imageGen` accepts only: `job`, `format`, `style`, `vars`, `extra`, `provider`,
`model`, `referenceImages`, `count`, `maxImages`, `seed`, `outputStem`. **No credential
is ever written into this file** — see Preference chain.

## Preference chain

Every preference resolves through the repo's frozen order — **arguments >
environment > `$KK_CONFIG` > compiled defaults** — and the winners are written into
`metadata.imageGen`:

| Key | 1. argument | 2. environment | 3. `$KK_CONFIG` `image:` | 4. compiled default |
| --- | --- | --- | --- | --- |
| format | `--format` | — | `image.format` | `free` |
| style | `--style` | — | `image.style` | the format's `defaultStyle` |
| provider | `--provider` | `IMAGE_GEN_PROVIDER` | `image.provider` | auto (`AUTO_ORDER`) |
| model | `--model` | — | `image.model` | provider default |
| auto-confirm | — | `KK_IMAGE_AUTO_CONFIRM=1` | `image.auto_confirm` | `false` |
| max images | — | `KK_IMAGE_MAX_IMAGES` | `image.max_images` | `4` |
| preset roots | — | `KK_IMAGE_PRESET_PATH` | `image.preset_path` | none |

- `$KK_CONFIG` defaults to `~/.config/kk/config.yaml`. The environment **wins over the
  config file**: an exported `KK_IMAGE_MAX_IMAGES` beats `image.max_images`.
- Loading is **non-blocking**: a missing or malformed `image:` block earns **one
  notice line naming the block**, then the compiled defaults. Every key has a working
  default; refusing to draw over a missing optional config is a worse failure than
  drawing with defaults. (A malformed *preset* is a different matter and fails loud.)
- **No `EXTEND.md`** — do not read, create, or mention one: baoyu's ranks file above
  environment, the opposite of this chain, and one product gets one precedence rule.
- **Credentials are not in this chain.** `plugins.generations.image-gen.env` values
  reach the plugin only through `invoke.ts`'s process environment at spawn. They never
  enter this skill's context, the `--in` file, or any report.

## Confirmation policy

The skill is in exactly one of two contexts, signalled **explicitly**:
`KK_NONINTERACTIVE=1` means non-interactive. Never infer from a TTY probe — a wrong
guess is either a hang or an unapproved spend.

**Interactive** (default). Before any paid run: execute once with `KK_IMAGE_DRY_RUN=1`,
then present the **spend preview** — resolved format and style, provider and model,
image count, and the **composed prompt taken from that run's `Content.body`** (the real
string the provider will receive, not a reconstruction) — and ask **once** for
confirmation (`AskUserQuestion` where available). `--dry-run` stops here and reports.
Declining ends the run with no plugin spawn beyond the dry run. A modification request
re-runs the preview; the loop is bounded at **3 revision rounds**, after which state
the bound and ask the operator to restate the request — never a paid round.

**Non-interactive** (`KK_NONINTERACTIVE=1`, e.g. a `spur workflow` `agent.run` step).
**Never prompt — never emit a question.** Proceed only if `image.auto_confirm: true`
or `KK_IMAGE_AUTO_CONFIRM=1`; otherwise **fail immediately, naming both switches**.
Hanging is unrecoverable, and spending unapproved money is worse than a failed node.
A workflow node invoking this skill **must set `KK_NONINTERACTIVE=1`** (and choose its
auto-confirm switch) — that is the caller's contract.

The cap is the backstop under both paths: `maxImages` rides the envelope and the
plugin refuses before the first provider call (0104 R6). Confirmation is a courtesy;
the cap is the control.

## Failure and recovery

- **Unknown format/style** — refuse, listing what `list-presets` shows.
- **Unimplemented `job` branch** — stop, naming the branch and format; never fall back
  to `free`.
- **Malformed preset** — the 0102 loader's `invalid` diagnostic names the file and the
  schema violation; the dry run fails loud before any spend. Fix or delete the file.
- **Provider cannot accept `--ref`** — when `supportsReferenceImages(model)` is false,
  say so and offer `extract-style`; never silently drop a reference.
- **Declined confirmation** — end cleanly; only the dry run ran, nothing was spent.
- **Failed run** — the plugin deletes `--out` and every artefact of that run before
  rethrowing; report the error verbatim and stop.
- **No credential anywhere** — name the provider and the env var it needs
  (references/providers.md); never solicit a secret in chat.

## References

- [references/style-extraction.md](references/style-extraction.md) — `extract-style` (0105): schema-fill rules, merge rules, cap, fidelity check.
- [references/illustration-positions.md](references/illustration-positions.md) —
  position detection and caption authoring for `illustration`, with the wt example.
- [references/providers.md](references/providers.md) — the operator digest of 0103's
  provider inventory: env vars, default models, reference capability, auto order.
- [references/migrating-from-wt.md](references/migrating-from-wt.md) — the retired wt
  flags and their frozen replacements.
