---
schema_version: 1
name: "Design the kk agent surface: image skills and slash command"
status: backlog
template: feature-impl
created_at: 2026-09-09T18:29:34.102Z
updated_at: "2026-09-09T20:30:08.379Z"
feature_id: K

dependencies: ["0102", "0104", "0105"]
ac_altitude: task-local
---

## 0106. Design the kk agent surface: image skills and slash command

### Background

**Ticket type: `wayfinder:prototype`** — map K. **Blocked by 0102** (preset names) **and 0104** (the `--in` envelope and `Content` shape the surface is built over). Consumes 0103's provider facts and 0105's extraction prompt.

The plugin is the engine; the agent surface is what the operator actually touches. `wt` shipped **three** skills plus one slash command; baoyu ships one fat skill per job with a blocking preference load and a mandatory confirmation gate. The operator's requirement is explicit: **one slash-command interface drives every job**, with `--format` and `--style` as the axes that change the work.

**Evidence, verified against the tree on 2026-09-09.**

*The in-repo precedent is `plugins/kk/skills/audio-authoring/SKILL.md`* — the closest structural sibling and the shape to follow: one fat skill with named operations (`create | briefing | outline | script`), a single invocation-contract flag table, a single artifact-contract path table, modes whose unimplemented variants are **named extension points that fail loud** rather than silent no-ops, explicit operator gates (a selection gate, a review gate, ≤3 bounded revision rounds), co-located templates (`templates/voicescript.solo.yaml`), and a "Do not use this skill for" list. Its frontmatter is two keys — `name` and a `description` written as trigger phrases in the operator's own words.

*The command precedent is `plugins/kk/commands/tell-me.md`* — four frontmatter keys (`name`, `description`, `argument-hint`, `allowed-tools: ["Skill"]`) and a body that is a thin wrapper forwarding `$ARGUMENTS` unchanged, with an explicit statement that all logic lives in the skill. `plugins/kk/commands/` currently holds exactly two files (`tell-me.md`, `workflow-run.md`), so there is no competing convention to reconcile.

*The command being replaced* is `/Users/robin/projects/cc-agents/plugins/wt/commands/image-generate.md`, whose argument surface is `[prompt] --template --style --output --var KEY=VALUE` (repeatable) `--content <file> --resolution WxH --backend --list-templates`. Three of those flags are superseded by decisions already frozen: `--template` → `--format` (0102's vocabulary), `--resolution` → the format's `aspectRatio` (0102 R1's portability argument), `--backend` → `--provider` (0103).

*The three wt skills* (`image-generate`, `image-cover`, `image-illustrator`) each contribute exactly one thing beyond the engine — content analysis, style auto-detection, and position detection respectively. All three are **model work**, which is the fact that decides R1 and R3.

*Two constraints inherited from 0104, both non-negotiable:*

1. **A plugin cannot prompt.** It is a spawned subprocess (`apps/cli/src/invoke.ts:118-122`) with no interactive channel, so every confirmation gate is the skill's. 0104 provides the two mechanisms: the `maxImages` hard cap and `KK_IMAGE_DRY_RUN=1`.
2. **A plugin receives nothing but `--in` and `--out`.** Every preference the skill resolves must be materialised into the `--in` envelope's `metadata.imageGen` before the plugin is spawned. The skill is therefore the *only* place preference precedence can be implemented.

*There is no general operator-config loader in TypeScript.* `apps/cli/src/config.ts` holds only `binaryName` / `binaryVersion`; the operator YAML at `$KK_CONFIG` (default `~/.config/kk/config.yaml`, `apps/cli/src/invoke.ts:43-45`) is read **only** by `invoke.ts`, and only for `plugins.<collection>.<name>.env`. So the skill reads the file itself — which it can, being an agent — and nothing else needs building.

*baoyu's preference machinery* (`baoyu-image-gen/SKILL.md:36-49,155`) loads `EXTEND.md` from project → XDG → home with the precedence `CLI args > EXTEND.md > env vars > <cwd>/.baoyu-skills/.env > ~/.baoyu-skills/.env`. Note that **`EXTEND.md` outranks environment variables** — the exact opposite of kk's rule, where `process.env` wins over the config file (`apps/cli/src/invoke.ts:133-137`, tested at `apps/cli/tests/invoke.test.ts:581`). That contradiction is what R4 must resolve, not paper over.

*The best-structured agent surface in the vendored set* is `baoyu-cover-image/SKILL.md`: `Step 0: Load Preferences ⛔ BLOCKING`, `Confirmation Policy`, `Progress Checklist`, `Five Dimensions`, `Galleries`, `Image Modification`, `Changing Preferences`. Its `preferences-schema.md` is `version: 3` with `preferred_type/palette/rendering/text/mood`, `default_aspect`, `quick_mode` (the auto-confirm knob), `language`, `custom_palettes`, `preferred_image_backend`. `baoyu-article-illustrator/SKILL.md`'s `Batch Generation Policy` is the prior art for the N-image confirmation problem.

### Requirements

Produce, as the task's Design section and drafted artefacts:

- [ ] R1. **Skill decomposition** — one generic `image` skill with a job axis (the `audio-authoring` precedent), or three job-specific skills (the `wt` shape). Recommend one and justify against the `format × style` decision: if formats are data, three skills is probably three copies of the same skill.
- [ ] R2. **The slash command** — name, arguments, defaults, validation, and the delegation line. Must satisfy "same interface, different work": `--format` and `--style` are the only axes that change the job.
- [ ] R3. **Where judgment lives** — the plugin is deterministic; content analysis, style auto-detection, and illustration position detection are model work. Draw the line explicitly and state which side each capability lands on.
- [ ] R4. **Preference loading** — resolve the map's open question in a concrete proposal: reuse `~/.config/kk/config.yaml`, add a baoyu-style `EXTEND.md`, or both, with the precedence chain (CLI args > preferences > env > config > default).
- [ ] R5. **Confirmation policy** — a blocking confirmation before spending money interactively, and a defined non-interactive behaviour for `spur workflow` nodes. Both paths must be specified; a skill that hangs waiting for confirmation inside a workflow is a defect.
- [ ] R6. **Progressive disclosure** — what lives in `SKILL.md` versus `references/`, given the preset galleries could otherwise balloon the skill body.

Deliver drafted `SKILL.md` frontmatter (name, description, triggers) and the command file skeleton, not prose about them.

### Acceptance Criteria

Task-local acceptance criteria. Feature K is a `wayfinder-map` carrying a prose no-AC disclaimer, so these scenarios are the executable contract for this ticket alone.

#### Scenario: One skill and one command exist, at the frozen paths (R1, R2)

- **Given** the repo at this task's HEAD
- **When** `plugins/kk/skills/` and `plugins/kk/commands/` are listed
- **Then** `skills/image-authoring/SKILL.md` and `commands/image-generate.md` exist
- **And** no second image skill and no second image command were added
- **And** `SKILL.md`'s frontmatter has exactly `name: image-authoring` and a `description` written as operator trigger phrases

#### Scenario: The command is a thin wrapper (R2)

- **Given** `plugins/kk/commands/image-generate.md`
- **When** it is read
- **Then** its frontmatter carries `name`, `description`, `argument-hint` and `allowed-tools: ["Skill"]`
- **And** its body delegates with `Skill(skill="kk:image-authoring", args="$ARGUMENTS")`
- **And** it contains no argument parsing, no validation and no preset knowledge

#### Scenario: `--format` alone selects the job (R1, R2)

- **Given** the three shipped formats, each declaring its `job` (0102)
- **When** `/kk:image-generate --format cover --content article.md --dry-run` runs
- **Then** the `--in` envelope the skill writes has `metadata.imageGen.job === 'cover'`
- **And** running the same command with `--format illustration` yields `job === 'illustration'`
- **And** no `--job` flag exists on the command

#### Scenario: An operator-added format works with no skill change (R1)

- **Given** `~/.kk/image-presets/formats/cover-xhs.yaml` declaring `job: cover`
- **When** `/kk:image-generate --format cover-xhs --content article.md --dry-run` runs
- **Then** it succeeds and the envelope carries `job: 'cover'` and `format: 'cover-xhs'`
- **And** no file under `plugins/kk/` was edited to make it work

#### Scenario: A format naming an unimplemented job fails loud (R1)

- **Given** a preset file declaring a `job` value the skill has no branch for
- **When** a generate run selects it
- **Then** the skill stops, names the unimplemented branch and the format
- **And** it does **not** fall back to the `free` job

#### Scenario: Invalid arguments are rejected by the skill with actionable messages (R2)

- **Given** each of: an unknown `--format`; an unknown `--style`; `--count 3` with `--format cover`; six `--ref` paths; `--extract-style x` with no `--ref`; `--content missing.md`
- **When** each is invoked
- **Then** each fails before any plugin spawn, naming the offending argument
- **And** the unknown-format and unknown-style messages list the presets `list-presets` would show

#### Scenario: Retired wt flags are answered, not ignored (R2)

- **Given** `/kk:image-generate --template cover`
- **When** it runs
- **Then** the skill states that `--template` is now `--format` and stops
- **And** the same holds for `--resolution`, `--backend` and `--list-templates` with their frozen replacements

#### Scenario: The judgment line holds — the plugin makes no model calls (R3)

- **Given** the drafted `SKILL.md` and `plugins/generations/image-gen/src/`
- **When** the reviewer checks both
- **Then** `SKILL.md` assigns var derivation, style auto-detection, position detection, caption authoring and style extraction to the skill
- **And** `grep -rn 'agent.run\|AskUserQuestion\|anthropic' plugins/generations/image-gen/src/` returns nothing

#### Scenario: Preference precedence resolves in the frozen order (R4)

- **Given** `image.format: cover` in `$KK_CONFIG` and no environment override
- **When** `/kk:image-generate "a bicycle" --dry-run` runs with no `--format`
- **Then** the envelope carries `format: 'cover'`
- **And** with `--format free` also passed, the envelope carries `format: 'free'` — the argument wins
- **And** with `KK_IMAGE_MAX_IMAGES=7` set and `image.max_images: 4` in config, the envelope carries `maxImages: 7` — the environment wins over the config

#### Scenario: A missing config block is a notice, not a failure (R4)

- **Given** `$KK_CONFIG` pointing at a file with no `image:` block
- **When** a dry run executes
- **Then** it succeeds using the compiled defaults
- **And** the skill emits one notice line naming the missing block
- **And** the same holds for a malformed `image:` block

#### Scenario: No `EXTEND.md` is introduced (R4)

- **Given** the commit implementing this ticket
- **When** `git show --stat` and the drafted `SKILL.md` are read
- **Then** no `EXTEND.md` file is added and `SKILL.md` never instructs the reader to load one
- **And** `SKILL.md` states the single precedence chain: arguments > environment > `$KK_CONFIG` > compiled default

#### Scenario: No credential ever enters the envelope (R4)

- **Given** `plugins.generations.image-gen.env` populated in `$KK_CONFIG`
- **When** the skill writes the `--in` file
- **Then** the file contains no value from that block
- **And** `SKILL.md` states that credentials reach the plugin only via `invoke.ts`

#### Scenario: Interactive runs preview the real prompt before spending (R5)

- **Given** an interactive session with `KK_NONINTERACTIVE` unset
- **When** a generate run is requested
- **Then** the skill runs `KK_IMAGE_DRY_RUN=1` first and shows the format, style, provider, model, image count and the composed prompt taken from that run's `Content.body`
- **And** it asks for confirmation once before the paid run
- **And** declining ends the run with no plugin spawn beyond the dry run

#### Scenario: Revision rounds are bounded at three (R5)

- **Given** an interactive preview
- **When** the operator requests a modification four times
- **Then** the skill states the 3-round bound on the fourth and asks for a restated request
- **And** no paid generation happened during the rounds

#### Scenario: A workflow node never hangs and never spends unapproved (R5)

- **Given** `KK_NONINTERACTIVE=1` and neither `auto_confirm: true` nor `KK_IMAGE_AUTO_CONFIRM=1`
- **When** the skill is invoked from a `spur workflow` `agent.run` step
- **Then** it fails immediately, naming both switches
- **And** it never emits a question
- **And** with `KK_IMAGE_AUTO_CONFIRM=1` set, the same invocation proceeds without prompting

#### Scenario: `list-presets` reads the real roots, not a shipped gallery (R6)

- **Given** a user-root style shadowing a shipped one
- **When** `/kk:image-generate --list-presets` runs
- **Then** the output lists every format and style with its origin root
- **And** the shadowed pair is reported with both paths
- **And** no markdown gallery file of presets exists anywhere under `plugins/kk/skills/image-authoring/`

#### Scenario: `SKILL.md` stays small and the references carry the depth (R6)

- **Given** the drafted skill directory
- **When** its files are counted
- **Then** `SKILL.md` is ≤ 250 lines
- **And** `references/` contains `style-extraction.md`, `illustration-positions.md`, `providers.md` and `migrating-from-wt.md`
- **And** `SKILL.md` links each of them from the section that needs it

#### Scenario: The capability lifecycle gate is clean (deliverable)

- **Given** the drafted skill and command
- **When** `superskill skill validate` and `superskill command validate` are run against them
- **Then** both report no errors
- **And** `bun run lint` and `bun run test` still exit 0

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-09T20:26:37.507Z

**Q: One skill with a job axis, or three job-specific skills? (R1)**
One. 0102 made formats data and gave each format a `job` field, so three skills would differ only in a value they read out of YAML — and an operator-authored fourth format would have no skill at all. **Closed: one `image-authoring` skill, three operations (`generate`, `extract-style`, `list-presets`), job selected by `--format`.**

**Q: Should the command be named `image` or keep wt's `image-generate`?**
Keep `image-generate`. It is the one string in this migration an existing operator already types from memory, and nothing about it became wrong. **Closed.**

**Q: Reuse `~/.config/kk/config.yaml`, add an `EXTEND.md`, or both? (R4 — the map's open question)**
Reuse `config.yaml`; add no `EXTEND.md`. Not a style preference: baoyu ranks `EXTEND.md` **above** environment variables (`baoyu-image-gen/SKILL.md:155`) while kk ranks `process.env` above the config file (`apps/cli/src/invoke.ts:133-137`, tested at `apps/cli/tests/invoke.test.ts:581`). Shipping both gives one product two contradictory precedence rules over the same keys, and the resulting bug ("my exported env var did nothing") is intermittent and miserable to diagnose. **Closed — this resolves the map's open question; record it in `## Decisions so far` when the ticket closes.**

**Q: Should preference loading be blocking, as in baoyu's `Step 0 ⛔ BLOCKING`?**
No. Every key in the `image:` block has a working compiled default, so refusing to work over a missing optional config is a worse failure than proceeding with defaults. Malformed **presets** are a different matter and still fail loud (0102). **Closed: non-blocking, with a one-line notice.**

**Q: How does the skill know it is in a workflow rather than a chat? (R5)**
By `KK_NONINTERACTIVE=1`, set by the caller. TTY probing is unreliable inside an agent session, and a wrong guess fails badly in both directions — a hang in a workflow, or an unapproved spend in a chat. **Closed: explicit env flag, never inferred.** Follow-on for whoever authors the first image workflow: the node must set it. Flagged, not blocking.

**Q: What happens non-interactively when auto-confirm is not enabled?**
Fail loud, naming both `auto_confirm: true` and `KK_IMAGE_AUTO_CONFIRM=1`. Hanging is unrecoverable; spending unapproved money is worse than a failed node. **Closed.**

**Q: Is a confirmation gate enough to control spend?**
No, and it is not the control. The gate is a courtesy; the control is `maxImages`, enforced inside the plugin before the first provider call (0104 R6), where no agent can talk its way past it. **Closed.**

**Q: Should the skill ship preset galleries in `references/`, as baoyu does with its 22 style files? (R6)**
No. kk's presets are YAML the engine already parses; a markdown gallery is a second copy that goes stale on the first added preset. `list-presets` reads the real roots through 0102's loader. **Closed: no gallery file.**

**Q: Should `wt:image-generator` (the coordinator subagent) be ported?**
No. A subagent that only forwards to one skill is an indirection with nothing in it. **Closed, recorded as out of scope so it is not re-proposed.**

**Q: Who owns `plugins/kk/config.example.yaml` — this ticket or 0104?**
Both append to it: 0104 adds `plugins.generations.image-gen.env`, this ticket adds the `image:` block. They are different keys in the same file, so whichever lands second appends. **Closed, with the ordering noted in both tickets' handoffs.**

**Q: Does `--out` name a directory or a file?**
Both are accepted: a path ending in `.json` is used as the plugin's `--out` verbatim; anything else is treated as a directory and `--out` becomes `<dir>/content.json`. Artefacts are siblings either way (0104 R3). **Closed.**

**Q: Should the skill support modifying an already-generated image (baoyu's `Image Modification`)?**
Not in v1. Modification is either "regenerate with a tweaked prompt" — which the 3-round revision loop already covers — or true image-to-image editing, which is a provider capability nobody has inventoried yet. **Deferred**, owner: whoever first needs edit-in-place; it would start as a fourth operation and a `supportsImageEditing()` addition to 0103's interface.

### Design

**WHAT** — the frozen agent surface: one skill, one command, the judgment line between them and the plugin, the preference chain, the confirmation policy, and the disclosure split. Deliverables are the **drafted `SKILL.md` frontmatter and the command file skeleton**, not prose about them.

#### Frozen names

| Artefact | Path | Installed as |
| --- | --- | --- |
| Skill | `plugins/kk/skills/image-authoring/SKILL.md` | `kk:image-authoring` |
| Command | `plugins/kk/commands/image-generate.md` | `/kk:image-generate` |

`image-authoring` pairs with the existing `audio-authoring`, which is the sibling this design copies. The command keeps wt's `image-generate` name deliberately — it is the one string in the whole migration an existing operator already has in muscle memory, and nothing about it is now wrong.

#### R1 — one skill, three jobs

**One generic `image-authoring` skill.** The justification is the `format × style` decision itself: 0102 made formats **data**, and 0102's amendment makes each format declare its own `job`. Three job-specific skills would therefore be three copies of the same skill differing only in a value they read out of a YAML file — and a fourth operator-authored format (`cover-xhs`) would have no skill at all until someone wrote one. One skill, and `--format` selects the work. This is the `audio-authoring` precedent (one skill, four operations, one artifact contract) applied to a job axis that lives in data rather than in the operation name.

Operations (the skill's own axis, deliberately **not** the job axis):

| Operation | What it does |
| --- | --- |
| `generate` (default) | resolve preferences → compose → confirm → run `image-gen` → report. Job comes from `--format`'s `job` field. |
| `extract-style` | 0105's extraction: read N reference images, write `~/.kk/image-presets/styles/<name>.yaml`, validate with a dry run |
| `list-presets` | enumerate the resolved formats and styles across all four preset roots, with their origin and any `shadowed` diagnostics |

Unimplemented job branches must be **named extension points that fail loud**, the `audio-authoring` rule: if a format declares a `job` the skill has no branch for, say so and name the branch — never fall back to `free`.

#### R2 — the slash command

```
/kk:image-generate [prompt]
      --format <name>          # default: free
      --style <name>           # default: the format's defaultStyle
      --var KEY=VALUE          # repeatable; fills the format's template variables
      --content <file>         # markdown source for cover / illustration jobs
      --ref <path>             # repeatable, max 5 (0105)
      --count <n>              # illustration job only
      --provider <name>        # 0103 selectProvider
      --model <id>
      --out <dir|file>         # becomes the plugin's --out; artefacts are its siblings (0104)
      --dry-run                # compose and price, generate nothing
      --list-presets           # → list-presets operation
      --extract-style <name>   # → extract-style operation; requires --ref
```

Frontmatter and body, complete:

```markdown
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
```

Validation is the **skill's**, not the command's — `tell-me.md` establishes that the command forwards `$ARGUMENTS` unchanged, including empty. The skill rejects: an unknown `--format` or `--style` (listing what `list-presets` would show), `--count` on a non-`illustration` job, `--ref` beyond 5, `--extract-style` without `--ref`, and a `--content` file that does not exist.

Retired flags, with their replacements stated in the skill's migration note: `--template` → `--format`, `--resolution WxH` → the format's `aspectRatio`, `--backend` → `--provider`, `--list-templates` → `--list-presets`.

#### R3 — where judgment lives (the frozen line)

The rule: **the plugin executes a decided plan; the skill decides it.** Anything requiring reading, taste or ambiguity resolution is the skill's; anything deterministic is the plugin's.

| Capability | Side | Why |
| --- | --- | --- |
| Preset resolution, shadowing, diagnostics | **plugin** (0102) | pure file scanning |
| Prompt composition (`composePrompt`) | **plugin** (0102) | a frozen four-segment concatenation with a golden test |
| Provider selection and the API call | **plugin** (0103) | deterministic given a name and env |
| Artefact naming and writing | **plugin** (0104) | pure path arithmetic |
| Markdown image-reference **insertion** at a given anchor | **plugin** (0104) | deterministic string work |
| Deriving `--var` values from an article (title, subtitle, topics) | **skill** | reading and summarising |
| Style auto-detection ("which of the 9 suits this article?") | **skill** | taste |
| Illustration **position** detection | **skill** | reading; result crosses as `metadata.positions` (0104) |
| Caption and alt-text authoring | **skill** | writing |
| Style extraction from reference images | **skill** (0105) | vision |
| Preference precedence resolution | **skill** | the plugin gets only `--in` |
| Confirmation and spend approval | **skill** | a subprocess cannot prompt |

The skill's single output to the engine is the `--in` JSON: one `Doc[]` whose first element carries `metadata.imageGen` (0104's frozen envelope) and, for the illustration job, `metadata.positions`.

#### R4 — preference loading (the map's open question, resolved)

**Reuse `~/.config/kk/config.yaml`. Do not add an `EXTEND.md`.**

The decisive reason is not aesthetics: baoyu's chain ranks `EXTEND.md` **above** environment variables (`baoyu-image-gen/SKILL.md:155`), while kk's config loader ranks `process.env` above the config file (`apps/cli/src/invoke.ts:133-137`, pinned by `apps/cli/tests/invoke.test.ts:581`). Shipping both would give one product two contradictory precedence rules over the same keys — a defect that would surface as "the env var I exported did nothing", intermittently, depending on which layer read it. One config file, one rule.

New block in `plugins/kk/config.example.yaml` (values shown are the compiled defaults):

```yaml
image:
  format: free            # default --format
  style: ~                # ~ = use the format's defaultStyle
  provider: ~             # ~ = auto (0103 AUTO_ORDER)
  model: ~
  auto_confirm: false     # baoyu's quick_mode, renamed to say what it does
  max_images: 4           # mirrors KK_IMAGE_MAX_IMAGES (0104)
  preset_path: ~          # extra roots, ':'-separated → KK_IMAGE_PRESET_PATH
```

Precedence, frozen, matching the repo's existing "flag > env > config > compiled default" (`plugins/kk/config.example.yaml`):

1. Command arguments (`--format`, `--style`, …)
2. Environment (`KK_IMAGE_MAX_IMAGES`, `KK_IMAGE_PRESET_PATH`, `IMAGE_GEN_PROVIDER`, `KK_IMAGE_AUTO_CONFIRM`)
3. `image:` in `$KK_CONFIG`
4. The compiled defaults above

The skill resolves all four layers and writes the winners into `metadata.imageGen`; **credentials are not part of this chain** — they stay in `plugins.generations.image-gen.env` and reach the plugin through `invoke.ts`, untouched by the skill, so no secret ever passes through an agent's context or an `--in` file on disk.

Loading is **non-blocking**, deliberately diverging from baoyu's `Step 0: Load Preferences ⛔ BLOCKING`. A missing or malformed `image:` block is a one-line notice and the compiled defaults, because every key has a working default and refusing to draw a picture over a missing optional config is a worse failure than drawing it with defaults. A malformed *preset* is a different matter and still fails loud (0102).

#### R5 — confirmation policy (both paths specified)

The skill is in exactly one of two contexts, and it must know which **before** it can spend:

**Interactive** — the default. Before any generation the skill shows a spend preview: the resolved format and style, the fully composed prompt (from a `KK_IMAGE_DRY_RUN=1` run, so the preview is the real string the provider will receive, not a reconstruction), the provider and model, and the image count. It then asks once, via `AskUserQuestion` where available. `--dry-run` stops there and reports. Modification requests re-run the preview; the loop is bounded at **3 rounds**, the `audio-authoring` rule, after which the skill states the bound and asks the operator to restate the request.

**Non-interactive** — a `spur workflow` `agent.run` step, or any invocation where `KK_NONINTERACTIVE=1` is set. The skill **never prompts**; a skill that blocks inside a workflow node is a defect (the ticket says so, and it is right). It proceeds only if `auto_confirm: true` (config) or `KK_IMAGE_AUTO_CONFIRM=1`; otherwise it **fails loud** naming both switches. Failing is correct here — hanging is unrecoverable, and silently spending money nobody approved is worse than a failed node.

**Context detection is explicit, never inferred.** `KK_NONINTERACTIVE=1` is set by the caller; TTY probing is unreliable inside an agent session and a wrong guess in either direction is a real failure (a hang, or an unapproved spend). Workflow nodes invoking this skill must set it, and that requirement is stated in the skill's "Do not use this skill for" neighbourhood.

The cap is the backstop under both paths: `maxImages` reaches the plugin in the envelope, and the plugin refuses before spending (0104 R6). Confirmation is a courtesy; the cap is the control.

#### R6 — progressive disclosure

`SKILL.md` holds only what every invocation needs: purpose, when to use, the "do not use this skill for" list, the three operations, the invocation-contract flag table, the artifact-contract path table, the two confirmation paths, the preference chain, and the failure/recovery notes. Target ≤ 250 lines, the `audio-authoring` size.

`references/` holds:

| File | Contents | Owner |
| --- | --- | --- |
| `style-extraction.md` | the vision prompt and its schema-fill rules | 0105 |
| `illustration-positions.md` | how to detect insertion points and author captions; the `article-before` → `positions-detected` → `article-after` → `captions.json` worked example | this ticket |
| `providers.md` | the operator-facing digest of 0103's inventory — which providers accept `--ref`, which need which env var | this ticket, from 0103 |
| `migrating-from-wt.md` | the retired-flag table and the `--template`/`--resolution`/`--backend` replacements | this ticket |

**No preset gallery is shipped as a reference file.** baoyu ships 22 style and 21 layout markdown files; kk's presets are YAML the engine already reads, so a markdown gallery would be a second copy that goes stale the first time someone adds a preset. `list-presets` reads the real roots through 0102's loader and prints what is actually there, including shadowing. One source of truth, and it is the one the engine uses.

#### Handoffs and assumptions

- **Assumes from 0102:** preset names, `FormatPreset.job`, `resolvePresetRoots()` and its `shadowed` / `invalid` diagnostics (which `list-presets` surfaces verbatim).
- **Assumes from 0104:** the `metadata.imageGen` envelope, `metadata.positions`, `KK_IMAGE_DRY_RUN`, `maxImages`, and artefacts as siblings of `--out`.
- **Assumes from 0103:** `supportsReferenceImages(model)`, which gates whether `--ref` may be passed through at all; when false the skill offers `extract-style` instead (0105's fallback rule).
- **Assumes from 0105:** `references/style-extraction.md` exists and is authoritative for the `extract-style` operation.
- **Hands onward:** the `image:` config block, added to `plugins/kk/config.example.yaml` alongside 0104's `plugins.generations.image-gen.env` block — the same file, so whichever ticket lands second appends rather than rewrites.
- **Out of scope here:** the wt subagent `wt:image-generator` is not ported. A skill plus a command is the whole surface; a coordinator subagent over a single skill adds an indirection with nothing in it.

### Plan

Ordered. Each step names the R-item it serves and the check that proves it.

1. **Read `plugins/kk/skills/audio-authoring/SKILL.md` end to end** and list its section skeleton. This design is a copy of that shape onto a different job axis; deviating from it without a reason is the failure mode to avoid. *(R1, R6)*
2. **Read `plugins/kk/commands/tell-me.md`** and copy its four-key frontmatter and thin-wrapper body exactly. *(R2)*
3. **Draft `plugins/kk/commands/image-generate.md`** — frontmatter and the `Skill(skill="kk:image-authoring", args="$ARGUMENTS")` delegation line, verbatim from the Design. No parsing, no validation. *(R2)*
4. **Draft `plugins/kk/skills/image-authoring/SKILL.md`** with the frozen section skeleton: Purpose · When to use · Do not use this skill for · Operations (`generate` / `extract-style` / `list-presets`) · Invocation contract (the flag table) · Artifact contract (the path table) · Preference chain · Confirmation policy (both paths) · Failure and recovery · References. Target ≤ 250 lines. *(R1, R6)*
5. **Write the argument-validation rules into the skill** — unknown format/style (listing what `list-presets` shows), `--count` on a non-illustration job, `--ref` > 5, `--extract-style` without `--ref`, missing `--content` file, and the four retired wt flags with their replacements. *(R2)*
6. **Write the judgment-line table into the skill** and verify the other half by grep: `grep -rn 'agent.run\|AskUserQuestion\|anthropic' plugins/generations/image-gen/src/` must return nothing. *(R3)*
7. **Add the `image:` block to `plugins/kk/config.example.yaml`** — the seven keys with their compiled defaults, appended alongside 0104's `plugins.generations.image-gen.env` block. *(R4)*
8. **Implement the four-layer precedence in the skill's procedure** — arguments > environment > `$KK_CONFIG` `image:` > compiled defaults — and state that credentials are **not** in this chain and never enter the `--in` file. *(R4)*
9. **Write the two confirmation paths** — the interactive dry-run preview with a single confirmation and a 3-round revision bound; the `KK_NONINTERACTIVE=1` path that never prompts and fails loud without `auto_confirm` / `KK_IMAGE_AUTO_CONFIRM`. State that context is signalled explicitly, never inferred from a TTY. *(R5)*
10. **Write `references/illustration-positions.md`** — the detection procedure and caption authoring, walked through the wt `article-before.md` → `positions-detected.md` → `article-after.md` → `captions.json` example. *(R3, R6)*
11. **Write `references/providers.md`** from 0103's inventory — the operator-facing digest: which providers accept references, which env var each needs, which is auto-selected. *(R6)*
12. **Write `references/migrating-from-wt.md`** — the retired-flag table. *(R2, R6)*
13. **Confirm `references/style-extraction.md` is present** (written by 0105) and linked from the `extract-style` operation. If 0105 has not landed, link it and note the dependency rather than writing a second copy. *(R6)*
14. **Verify the disclosure split** — `SKILL.md` ≤ 250 lines, four reference files present, each linked from the section that needs it, and no preset gallery file anywhere in the skill directory. *(R6)*
15. **Run the capability gates** — `superskill skill validate` and `superskill command validate` against the two drafted artefacts; both clean. *(deliverable)*
16. **Run a dry-run end-to-end** — `/kk:image-generate --format cover --content <fixture> --dry-run` with `KK_IMAGE_DRY_RUN=1`; confirm the envelope carries `job: 'cover'` and the resolved format/style/provider, and that the preview prompt is the plugin's own `Content.body`. *(R2, R4, R5)*
17. **Run the operator-added-format case** — a `cover-xhs.yaml` in the user root with `job: cover`; confirm it works with no edit under `plugins/kk/`. *(R1)*
18. **Run the repo gate** — `bun run autofix && bun run spur-check` clean. *(all)*
19. **Close the ticket** — `spur task update 0106 done`; append one line to feature K's `## Decisions so far`, and **resolve the map's open question on preference loading** there (config.yaml only, no `EXTEND.md`, arguments > env > config > default).

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

**In-repo precedent (the shape this ticket copies):**

- `plugins/kk/skills/audio-authoring/SKILL.md` — one fat skill with named operations, an invocation-contract flag table, an artifact-contract path table, fail-loud extension points, explicit operator gates and a ≤3-round revision bound. The structural sibling.
- `plugins/kk/commands/tell-me.md` — the four-key command frontmatter (`name`, `description`, `argument-hint`, `allowed-tools: ["Skill"]`) and the thin `$ARGUMENTS`-forwarding body.
- `plugins/kk/commands/workflow-run.md:59,73,146` — how a workflow node reads `works_dir` / `KK_WORKS_DIR` and builds paths; the caller side of the `--out` contract.
- `plugins/kk/config.example.yaml` — the file gaining the `image:` block; also the source of the repo's "flag > env > config > compiled default" rule.

**Hard constraints:**

- `apps/cli/src/invoke.ts:118-122` — a plugin gets only `--in` / `--out`, so the skill is the only place preference precedence can live.
- `apps/cli/src/invoke.ts:43-45` — `$KK_CONFIG`, default `~/.config/kk/config.yaml`.
- `apps/cli/src/invoke.ts:133-137` and `apps/cli/tests/invoke.test.ts:581` — `process.env` wins over the config file; the rule baoyu's `EXTEND.md` would contradict.
- `apps/cli/src/config.ts` — holds only `binaryName` / `binaryVersion`; there is **no** general operator-config loader in TypeScript, which is why the skill reads the YAML itself.

**Being replaced:**

- `/Users/robin/projects/cc-agents/plugins/wt/commands/image-generate.md` — the argument surface (`--template`, `--style`, `--output`, `--var`, `--content`, `--resolution`, `--backend`, `--list-templates`) and the four retired flags.
- `/Users/robin/projects/cc-agents/plugins/wt/skills/{image-generate,image-cover,image-illustrator}/SKILL.md` — the three-skill split; each contributes exactly one piece of model work (content analysis, style auto-detection, position detection), which is why one skill suffices.
- `/Users/robin/projects/cc-agents/plugins/wt/skills/image-illustrator/examples/{article-before.md,positions-detected.md,article-after.md,captions.json}` — the worked example `references/illustration-positions.md` walks through.
- `wt:image-generator` (subagent) — deliberately **not** ported.

**Vendored prior art** (`vendors/baoyu-skills/`, MIT © 2026 Jim Liu):

- `skills/baoyu-cover-image/SKILL.md` — `Step 0: Load Preferences ⛔ BLOCKING`, `Confirmation Policy`, `Progress Checklist`, `Galleries`, `Image Modification`, `Changing Preferences`.
- `skills/baoyu-cover-image/references/config/preferences-schema.md` — `version: 3`, `quick_mode` (renamed `auto_confirm` here), `default_aspect`, `custom_palettes`, `preferred_image_backend`; the v2→v3 migration table.
- `skills/baoyu-image-gen/SKILL.md:36-49,155` — the `EXTEND.md` chain and its env-var-outranking precedence, explicitly rejected.
- `skills/baoyu-article-illustrator/SKILL.md` — `Batch Generation Policy`, the prior art for N-image confirmation.
- `skills/baoyu-infographic/references/{styles,layouts}/` — the shipped-markdown-gallery pattern, explicitly rejected in favour of `list-presets`.

**Depends on:** 0102 (preset names, `FormatPreset.job`, `resolvePresetRoots` diagnostics), 0103 (`supportsReferenceImages`, provider names and env vars), 0104 (`metadata.imageGen`, `metadata.positions`, `KK_IMAGE_DRY_RUN`, `maxImages`, artefacts beside `--out`), 0105 (`references/style-extraction.md`).

**Authoring gates:** `superskill skill --help`, `superskill command --help` — the validate/evaluate lifecycle both artefacts must clear.

### History
