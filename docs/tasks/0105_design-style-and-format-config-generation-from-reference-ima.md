---
schema_version: 1
name: Design style and format config generation from reference images
status: backlog
template: feature-impl
created_at: 2026-09-09T18:29:03.904Z
updated_at: "2026-09-09T20:19:55.920Z"
feature_id: K

dependencies: ["0102"]
ac_altitude: task-local
---

## 0105. Design style and format config generation from reference images

### Background

**Ticket type: `wayfinder:prototype`** — map K. **Blocked by 0102** (it writes into the `StylePreset` schema 0102 freezes) and reads 0103's `supportsReferenceImages` / 0104's `ImageJobSpec.referenceImages`.

An explicitly required v1 capability from the operator: *"generate style/content config files based on given images … helpful when we want to clone/adjust some existing style/content."* Two distinct mechanisms hide under that one sentence and both are probably wanted.

**Premise correction.** The pre-refinement draft said `wt:style-extractor` and `gpt-image-2-style-library` "appear in the live skill catalog but were **not found on disk**". Verified 2026-09-09:

- **`wt:style-extractor` exists** — `/Users/robin/projects/cc-agents/plugins/wt/commands/style-extractor.md`. It is a **writing-style (stylometry) extractor**, not a visual one: it reads `.md`/`.txt`/`.rst`/`.adoc` files from a folder ("Minimum: at least 3 files OR 2000 words") and emits an author voice fingerprint. It contributes **nothing to visual extraction logic** — but its *artefact shape* is directly relevant prior art (lines 151-156, 235-272):
  - a frontmatter'd profile at `~/.claude/wt/styles/{profile_id}.style.md` carrying `profile_id`, `author`, `created`, `source_folder`, `corpus_size`, `confidence: High|Medium|Low`, `tags`;
  - a companion `~/.claude/wt/styles/registry.json` with `{id, confidence, file, …}` entries, deduped by `profile_id` and sorted newest-first.
  This is the same problem 0102's `PresetSource { kind, refImages, extractedAt, confidence }` already models — so the fields are validated by a second, independent implementation, and the `registry.json` half is a design question this ticket must answer rather than copy.
- **`gpt-image-2-style-library` is genuinely absent** from both the `wt` plugin and `vendors/`. Nothing to port; drop it from the evidence list.

**The prior art that does apply.** `vendors/baoyu-skills/skills/baoyu-article-illustrator/references/workflow.md:150-161,370-378` classifies every reference image into one of three usages, and applies each differently:

| Usage | Meaning | Action |
| --- | --- | --- |
| `direct` | the reference closely matches the wanted output | pass the file to the model as `--ref` |
| `style` | take the visual style only | analyse the reference, append style traits to the prompt |
| `palette` | take the colour scheme only | extract hexes, append to the prompt |

Line 24 of the same file records the persisted artefact: `references/extracted-style.md`. That three-way split is the key insight — *reference image* is not one feature, it is a routing decision — and it maps cleanly onto the two mechanisms this ticket must separate.

`vendors/baoyu-skills/skills/baoyu-infographic/references/styles/*.md` (22 hand-authored style files) are the **target shape**: what a filled-in style file actually contains. Extraction is only ever as good as the schema it fills, and 0102 froze that schema:

```ts
export interface StylePreset {
    name: string; description: string; modifiers: string;
    palette?: PaletteEntry[]; typography?: string; visualElements?: string[];
    bestFor?: string; negative?: string; source?: PresetSource;
}
export interface PresetSource {
    kind: 'authored' | 'extracted'; refImages?: string[];
    extractedAt?: string; confidence?: 'high' | 'medium' | 'low';
}
```

`vendors/baoyu-skills/skills/baoyu-cover-image/references/config/preferences-schema.md` — the `custom_palettes` fields (`colors.primary`, `colors.background`, `colors.accents`, `decorative_hints`, `best_for`) and its v2→v3 migration table showing which fields survived contact with reality.

**The one fact that shapes the whole design:** the agent running this skill already has vision. Extraction needs no new provider capability, no vision API integration, and no plugin code — it is a model reading an image and writing YAML into a schema that already exists.

### Requirements

Produce, as the task's Design section and a prototype:

- [ ] R1. **Separate the two mechanisms explicitly** and recommend whether v1 ships one or both:
   - (a) **Extraction** — vision analysis of a reference image emits a `styles/<name>.yaml` file that any provider can then use, including providers with no reference-image support.
   - (b) **Pass-through** — the reference image is handed to the model at generation time (`--ref`), giving higher fidelity but binding the result to ref-capable providers and reproducing nothing reusable.
- [ ] R2. **The extraction prompt** — the actual vision prompt that reads an image and emits a preset, plus the rule that it fills exactly 0102's `StylePreset` schema and nothing else.
- [ ] R3. **Fidelity check** — how "did the clone work?" is answered. Recommendation: extract from a reference, regenerate with the extracted preset, compare. Name the comparison method (human eyeball is an acceptable v1 answer if stated as such).
- [ ] R4. **Format extraction** — whether a reference image can also yield a `format` (aspect ratio, layout, text-block placement), or whether v1 restricts extraction to `style` only. Recommend and justify.
- [ ] R5. **Multi-image input** — whether extraction accepts N references to average a look, or exactly one for v1.
- [ ] R6. **One worked example** — a real reference image in, the emitted YAML, and one image regenerated from it.

Report first whether `wt:style-extractor` / `gpt-image-2-style-library` were located and what, if anything, they contribute.

### Acceptance Criteria

Task-local acceptance criteria. Feature K is a `wayfinder-map` carrying a prose no-AC disclaimer, so these scenarios are the executable contract for this ticket alone.

#### Scenario: The prior-art report is answered before anything else (Background)

- **Given** the ticket's instruction to report first on `wt:style-extractor` and `gpt-image-2-style-library`
- **When** the reviewer reads this task's `## Solution`
- **Then** it states that `wt:style-extractor` exists at `plugins/wt/commands/style-extractor.md`, is a **writing-style** extractor, and contributes only its artefact shape
- **And** it states that `gpt-image-2-style-library` is absent from both `wt` and `vendors/`
- **And** it states explicitly that `registry.json` is **not** adopted, with the reason

#### Scenario: Both mechanisms are specified and neither is silently dropped (R1)

- **Given** this task's `## Solution`
- **When** the reviewer looks for the mechanism split
- **Then** extraction and pass-through each have a named trigger, a named output, and a named provider constraint
- **And** the `direct` / `style` / `palette` vocabulary is mapped onto them in a table
- **And** the recommendation "ship both in v1" is stated with its cost justification

#### Scenario: The extraction prompt file exists and states its schema-fill rule (R2)

- **Given** the repo at this task's HEAD
- **When** `plugins/kk/skills/image-authoring/references/style-extraction.md` is read
- **Then** it instructs YAML-only output filling exactly 0102's `StylePreset` fields
- **And** it names every field's rule, including the `confidence` `high|medium|low` decision rule
- **And** it forbids inventing fields outside the schema
- **And** the field list in the prompt matches `plugins/generations/image-gen/src/presets.ts` exactly — no field in one and not the other

#### Scenario: An extracted preset loads and renders without registration (R2)

- **Given** a `StylePreset` YAML written to `~/.kk/image-presets/styles/acceptance-demo.yaml`
- **When** `KK_IMAGE_DRY_RUN=1` `image-gen` runs a `cover` job with `style: 'acceptance-demo'`
- **Then** it exits 0
- **And** `Content.body` — the composed prompt — contains the preset's `modifiers` string verbatim
- **And** no edit to any registry or index file was needed

#### Scenario: A malformed extracted preset fails loud at validation (R2)

- **Given** a YAML file at the same path missing the required `modifiers` field
- **When** the same dry run is attempted
- **Then** it exits non-zero and the message names the file and the missing field
- **And** no image is generated

#### Scenario: An extracted preset shadows a shipped one of the same name (R2)

- **Given** `~/.kk/image-presets/styles/editorial.yaml` alongside the shipped `editorial`
- **When** a dry run uses `style: 'editorial'`
- **Then** the composed prompt carries the **user** file's `modifiers`
- **And** the loader reports a `shadowed` diagnostic naming both paths

#### Scenario: The fidelity procedure is executed once, not merely described (R3)

- **Given** the worked example
- **When** the reviewer reads its record
- **Then** it names the reference image path, the emitted preset path, the regenerated image path, and a verdict on all four axes (palette, rendering technique, composition density, typographic treatment)
- **And** it states that human eyeball is the v1 comparison method
- **And** the preset's `source.confidence` matches the verdict recorded

#### Scenario: Format extraction is refused with a reason, and the ratio is still reported (R4)

- **Given** an extraction run over one reference image
- **When** its report is read
- **Then** no `formats/*.yaml` file was written
- **And** the report names the observed pixel dimensions and the nearest named aspect ratio from `21:9`, `4:3`, `1:1`, `16:9`, `3:4`, `9:16`
- **And** `## Solution` justifies style-only extraction against the `FormatPreset` fields that cannot be recovered from a picture

#### Scenario: Multi-image extraction merges rather than averages (R5)

- **Given** three reference images sharing two colours and differing on a third
- **When** extraction runs over all three
- **Then** the emitted `palette` contains the two shared colours and not the third
- **And** `source.refImages` lists all three absolute paths in the order given
- **And** the report names each discarded divergent trait
- **And** a sixth reference image is refused with a message naming the cap of 5

#### Scenario: A pass-through request against a non-ref provider degrades visibly (R1, from 0103)

- **Given** a provider whose `supportsReferenceImages(model)` returns `false`
- **And** a job carrying `referenceImages`
- **When** the operator requests `direct` usage
- **Then** the skill states that the provider cannot accept references and offers `style` extraction instead
- **And** it does **not** proceed silently without the reference

#### Scenario: The worked example's preset is committed, its images are not (R6)

- **Given** the commit implementing this ticket
- **When** `git show --stat` is read
- **Then** it adds a `.yaml` file under `plugins/generations/image-gen/presets/styles/`
- **And** it adds no binary image file

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-09T20:19:55.316Z

**Q: Does extraction belong in the plugin (a vision API call) or in the skill (the agent's own vision)?**
The skill. The agent running the skill already has vision, so a plugin-side vision call would add a provider capability, a second credential path and a per-extraction bill to do what the session does for free. **Closed: skill operation, no plugin code in this ticket.** The consequence, stated so nobody is surprised: extraction cannot run inside a headless `spur workflow` node with no model attached — that is acceptable, because extraction is an authoring act performed once, and the *resulting preset* is what workflows consume.

**Q: Ship extraction or pass-through in v1, or both?**
Both. Pass-through is already built by 0103 and 0104 and costs only documentation; refusing it would discard the higher-fidelity path for nothing. Extraction is the operator's actual stated requirement — cloning **and adjusting** a look — which pass-through structurally cannot serve. **Closed.**

**Q: Should the extraction confidence be computed rather than judged?**
No. Every candidate metric measures the wrong thing (perceptual hash → composition; colour histogram → the one axis already stored literally as hexes) or imports a model dependency with an unjustifiable threshold (CLIP cosine distance). A number that does not correlate with "does this look right" is worse than an honest label. **Closed: `high|medium|low` by the stated decision rule, human-judged.**

**Q: Should we adopt `wt:style-extractor`'s `registry.json`?**
No. 0102's `resolvePresetRoots()` discovers by directory scan, so a registry is a second source of truth that goes stale on the first copy, rename or hand-edit, and its stated jobs (dedupe, sort by date) are already done by the filename and the filesystem. **Closed, recorded as a deliberate divergence so it is not "restored" later.**

**Q: Where do extracted presets live — the user root or the project root?**
The user root (`~/.kk/image-presets/styles/`) by default, because a cloned look is usually the operator's, not the repository's. An operator who wants a preset shared with a team writes it to the **project** root (`<KNOWLEDGE_KIT_PROJECT_ROOT>/.kk/image-presets/styles/`), which 0102's chain ranks higher. Both work with no code change; only the default is being fixed. **Closed.**

**Q: What if an extracted preset's name collides with a shipped one?**
It shadows it, whole-file, and the loader emits a `shadowed` diagnostic naming both paths (0102). That is the intended way to *adjust* a shipped style: extract, rename to match, tweak. **Closed — this is a feature, and it has an AC scenario.**

**Q: Can the operator hand a reference image to a provider that does not support references?**
No, and the failure must be visible. `supportsReferenceImages(model)` (0103) is the gate; when it is `false` the skill says so and offers `style` extraction as the fallback. Silently dropping the reference and generating anyway would produce a plausible wrong image — the worst outcome available. **Closed.**

**Q: Why cap multi-image input at 5?**
To bound the prompt and keep the reference set coherent. It is a constant, not a design commitment; raising it changes one number and one message. **Closed with the number flagged as cheap to change.**

**Q: Should extraction also be able to *update* an existing preset rather than write a new one?**
Not in v1. "Extract, then hand-edit the YAML" is a two-step the operator can already do, and an in-place merge raises questions (which fields win? what happens to `source`?) that nobody has yet needed answered. **Deferred**, owner: whoever first hits the annoyance. Nothing in 0106 depends on it.

### Design

**WHAT** — the frozen split between the two reference-image mechanisms, the extraction prompt and its schema-fill rule, the fidelity procedure, and one worked example. **WHY it is a prototype rather than research:** the deliverable is a prompt file plus a produced preset, and neither can be judged without running it once.

#### R1 — the two mechanisms, separated and both shipped in v1

They are not alternatives; they answer different questions and have different costs.

| | (a) **Extraction** | (b) **Pass-through** |
| --- | --- | --- |
| What it produces | a reusable `styles/<name>.yaml` | one image, nothing reusable |
| Works with | **every** provider, including the 4+ with no ref support | only ref-capable providers (`supportsReferenceImages(model)`, 0103) |
| Fidelity | lossy — a description of a look | high — the pixels go to the model |
| Cost to build | the extraction prompt + validation loop (this ticket) | **already done** — `ImageRequest.referenceImages` (0103) and `ImageJobSpec.referenceImages` (0104) |
| Reproducible | yes — the YAML is committed and re-runnable | no — depends on the file staying put |

**Ship both.** (b) costs nothing beyond documenting it, and refusing it would throw away the higher-fidelity path for no gain. (a) is the operator's stated requirement — cloning and *adjusting* a look — which pass-through cannot serve at all, because you cannot edit a JPEG's "style" the way you can edit `modifiers:` and a hex.

Adopt baoyu's routing vocabulary verbatim as the frozen interface between them (`baoyu-article-illustrator/references/workflow.md:150-161`), because it is already proven and already documented:

| Usage | kk mechanism |
| --- | --- |
| `direct` | (b) pass-through — the file rides `ImageJobSpec.referenceImages` to the provider |
| `style` | (a) extraction — full `StylePreset` written to disk |
| `palette` | (a) extraction, **partial** — only `palette` and `name`/`description` are filled; `modifiers` is left as the one-line summary |

#### R2 — where extraction runs, and the prompt

**Extraction is model work performed by the skill, not plugin code.** The agent already has vision; adding a vision call inside `image-gen` would mean a new provider capability, a second credential path, and an API bill for something the operator's session does for free. No plugin code is written by this ticket.

Frozen locations:

- **The prompt:** `plugins/kk/skills/image-authoring/references/style-extraction.md` (0106 owns the skill directory and its final name; this ticket owns the file's content and hands it over).
- **The output:** `~/.kk/image-presets/styles/<name>.yaml` — the **user** root of 0102's `resolvePresetRoots()` chain, so an extracted preset shadows a shipped one of the same name and is picked up with no registration step.

The prompt's frozen rules, stated in the file itself:

1. Emit **YAML only**, no prose, no code fence, filling **exactly** 0102's `StylePreset` fields and no others. An invented field is a defect, not an enhancement.
2. `name` — kebab-case, derived from the look, not the filename.
3. `modifiers` — a comma-separated fragment in the same voice as the nine shipped styles, because `composePrompt` (0102) concatenates it as segment 3 of a comma-joined prompt. Read two shipped styles before writing one.
4. `palette` — 3-6 `{role, name, hex}` entries; `role` from `{primary, secondary, accent, background, text}`; `hex` uppercase `#RRGGBB`, sampled from the image, not invented.
5. `typography`, `visualElements`, `bestFor` — only when the image actually evidences them. **Omit rather than guess.**
6. `negative` — what this look must avoid, inferred from what is conspicuously absent.
7. `source` — always `kind: extracted`, `refImages` the absolute input paths, `extractedAt` an ISO-8601 timestamp, `confidence` `high|medium|low` with the rule: `high` = a single clean image with an obvious consistent look; `medium` = mixed or noisy references; `low` = the look is ambiguous or the image is photographic content rather than a designed style.

**Validation without new code:** after writing the file, the skill runs `image-gen` with `KK_IMAGE_DRY_RUN=1 --style <name>` (0104's dry run). A malformed or unloadable preset fails there, loudly, before any money is spent. No validator is written; 0102's loader and 0104's dry run already are one.

#### R3 — fidelity check

The frozen procedure, run once as the worked example and repeatable by an operator:

1. Extract from reference image **I** → `styles/<name>.yaml`.
2. Regenerate with `--style <name>` and a prompt describing **I's own subject**, so subject variance does not contaminate the comparison.
3. Compare **I** and the regeneration on four named axes: palette, rendering technique, composition density, typographic treatment.
4. Record the verdict in the preset's `source.confidence`.

**The comparison method for v1 is human eyeball, stated as such.** Rejected for v1: perceptual hashing (measures composition, not style — a false negative machine), CLIP-embedding cosine distance (a new model dependency and a threshold nobody can justify), and dominant-colour-histogram distance (checks only the one axis already captured literally as hexes). A number that does not correlate with "does this look right" is worse than no number. Revisit only if an operator reports extraction quality drifting without noticing.

#### R4 — style only in v1; formats are not extracted

**Recommendation: extraction fills `StylePreset` only.** A `FormatPreset` (0102) carries `template` with `{{variable}}` placeholders, a `variables` map with descriptions and defaults, `keywords`, `defaultStyle` and `outputFilename` — **none of which is recoverable from a picture.** What an image *does* yield is its aspect ratio, and that is arithmetic on the file's dimensions, not extraction.

So: the extraction report **states the observed aspect ratio and the nearest named ratio** (`21:9`, `4:3`, `1:1`, `16:9`, `3:4`, `9:16`) as a suggestion for which existing format to pair the style with. It never writes a format file. Layout cloning is a genuinely harder problem — baoyu's 21 layout files are all hand-authored — and belongs to a later ticket if it is ever wanted.

#### R5 — multi-image input: 1 to 5, merged into one preset

Accept **N references, 1 ≤ N ≤ 5**. 0102 already froze `PresetSource.refImages` as `string[]`; a one-image-only rule would contradict a schema that is already committed. Merging is exactly the clone use case — a designer's look lives across a set, not in one file. The cap of 5 bounds the prompt and keeps the operator's attention on a coherent set.

Merge rules, frozen into the prompt:

- `palette` — colours **common to the set**. A colour appearing in one image only is dropped, not averaged into a muddy midpoint.
- `modifiers` — traits present in **every** image. Divergent traits are dropped and named in the extraction report so the operator sees what was discarded.
- `confidence` — capped at `medium` when the set disagrees on any of the four fidelity axes.
- `refImages` — all N absolute paths, in the order given.

#### No `registry.json`

`wt:style-extractor` maintains `~/.claude/wt/styles/registry.json` alongside its profiles (`style-extractor.md:240-272`). **Do not copy it.** 0102's `resolvePresetRoots()` discovers presets by scanning directories, so a registry would be a second source of truth that goes stale the moment a file is copied, renamed or hand-edited — and its stated purposes (dedupe by id, sort by date) are served by the filename and the filesystem. This is a deliberate divergence from the prior art, recorded so a future reader does not "restore" it.

#### R6 — the worked example

One real reference image in, one `styles/<name>.yaml` out, one image regenerated from it, and the four-axis verdict — all recorded in this task's `## Solution`. The **YAML is committed** (as a shipped example preset under `plugins/generations/image-gen/presets/styles/`); the **images are not** — binaries do not belong in this repo. The example records absolute paths plus a written description of what the comparison showed, which is what a reviewer needs and what a future extraction run can be checked against.

#### Handoffs

- **To 0106:** the extraction prompt file, and the fact that extraction is a skill operation (a mode/operation on the image skill, not a plugin call) that terminates in a dry-run validation. 0106 owns the operation's name and its place in the skill.
- **From 0103:** `supportsReferenceImages(model)` is the fact that decides `direct` is even available; when it is `false`, the skill must fall back to `style` extraction and say so rather than silently dropping the reference.
- **From 0104:** `KK_IMAGE_DRY_RUN=1` is the validation mechanism; `ImageJobSpec.referenceImages` is the pass-through channel.

### Plan

Ordered. Each step names the R-item it serves and the check that proves it.

1. **Write the prior-art report into `## Solution` first** — `wt:style-extractor` exists and is a stylometry tool; `gpt-image-2-style-library` is absent; `registry.json` is not adopted, with the reason. This is the ticket's explicit "report first" instruction. *(Background)*
2. **Read two shipped styles from 0102** (`presets/styles/editorial.yaml` and one other) end to end. The extraction prompt's output must sound like them or `composePrompt` produces a prompt in two voices. *(R2)*
3. **Write `plugins/kk/skills/image-authoring/references/style-extraction.md`** — the seven frozen rules, the merge rules, the aspect-ratio reporting rule, and a complete worked YAML output as the example. *(R2, R4, R5)*
4. **Cross-check the prompt's field list against `src/presets.ts`** field by field. Any field in one and not the other is a defect in whichever is younger. *(R2)*
5. **Run the extraction once** against a real reference image, writing `~/.kk/image-presets/styles/<name>.yaml`. *(R6)*
6. **Validate with no new code** — `KK_IMAGE_DRY_RUN=1` `image-gen`, a `cover` job with `--style <name>`; confirm exit 0 and that the composed prompt in `Content.body` carries the preset's `modifiers` verbatim. *(R2)*
7. **Prove the failure path** — delete `modifiers` from a copy of the file, re-run the dry run, confirm a non-zero exit naming the file and the field. *(R2)*
8. **Prove shadowing** — write a `~/.kk/image-presets/styles/editorial.yaml`, dry-run `--style editorial`, confirm the user file wins and a `shadowed` diagnostic names both paths. *(R2)*
9. **Regenerate and compare** — generate one image with the extracted preset against the reference's own subject; record the four-axis verdict and set `source.confidence` to match. *(R3)*
10. **Run the multi-image case** — three references sharing two colours; confirm the merge rules drop the divergent one, list all three in `source.refImages`, and name the discarded traits in the report. Confirm a sixth reference is refused naming the cap. *(R5)*
11. **Confirm no format file was written**, and that the report names the observed dimensions and the nearest named ratio. *(R4)*
12. **Commit the example preset** under `plugins/generations/image-gen/presets/styles/`; commit no binary. Record the reference and regenerated image paths in `## Solution` as text. *(R6)*
13. **Write the two handoff paragraphs** — to 0106 (extraction is a skill operation ending in dry-run validation; 0106 names the operation) and the `direct`-unavailable fallback rule from 0103's `supportsReferenceImages`. *(handoff)*
14. **Run the gate** — `bun run autofix && bun run spur-check` clean. This ticket adds no TypeScript, so the gate is confirming nothing regressed, not proving new code. *(all)*
15. **Close the ticket** — `spur task update 0105 done`, append one line to feature K's `## Decisions so far` (both mechanisms ship; extraction is skill-side vision filling 0102's `StylePreset`; style-only, 1-5 refs, no registry).

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

**Prior art — corrected:**

- `/Users/robin/projects/cc-agents/plugins/wt/commands/style-extractor.md:151-156,235-272` — **exists**; a writing-style (stylometry) extractor. Contributes its artefact shape (`profile_id`, `created`, `source_folder`, `corpus_size`, `confidence: High|Medium|Low`) and its `registry.json` pattern, which this ticket deliberately does **not** adopt.
- `gpt-image-2-style-library` — **absent** from `/Users/robin/projects/cc-agents/plugins/wt/` and from `vendors/`. Removed from the evidence list.

**Vendored prior art** (`vendors/baoyu-skills/`, MIT © 2026 Jim Liu):

- `skills/baoyu-article-illustrator/references/workflow.md:150-161` — the `direct` / `style` / `palette` usage classification adopted verbatim as this ticket's routing vocabulary.
- `skills/baoyu-article-illustrator/references/workflow.md:370-378` — the per-usage action table (`--ref` vs. append style traits vs. append hexes).
- `skills/baoyu-article-illustrator/references/workflow.md:24` — `references/extracted-style.md`, the persisted extraction artefact.
- `skills/baoyu-infographic/references/styles/*.md` (22 files) — the target shape of a filled-in style file.
- `skills/baoyu-cover-image/references/config/preferences-schema.md` — `custom_palettes` (`colors.primary`, `colors.background`, `colors.accents`, `decorative_hints`, `best_for`) and the v2→v3 migration table.
- `skills/baoyu-image-gen/SKILL.md` — `--ref` handling and which providers accept reference images.

**Depends on (frozen elsewhere, not re-decided here):**

- 0102 — `StylePreset`, `PaletteEntry`, `PresetSource { kind, refImages, extractedAt, confidence }`, `resolvePresetRoots()` (user root `~/.kk/image-presets/`, project root, whole-file shadowing, `shadowed` / `invalid` diagnostics), `composePrompt`'s segment-3 placement of `modifiers`.
- 0103 — `ImageProvider.supportsReferenceImages(model)`, the gate that decides whether `direct` is available; `ImageRequest.referenceImages`.
- 0104 — `ImageJobSpec.referenceImages` (the pass-through channel) and `KK_IMAGE_DRY_RUN=1` (the validation mechanism this ticket reuses instead of writing a validator).

**Files this ticket creates:**

- `plugins/kk/skills/image-authoring/references/style-extraction.md` — the extraction prompt (directory name owned by 0106).
- `plugins/generations/image-gen/presets/styles/<name>.yaml` — the worked example, committed.

**Downstream:** 0106 places the extraction operation in the skill and owns its name and trigger.

### History
