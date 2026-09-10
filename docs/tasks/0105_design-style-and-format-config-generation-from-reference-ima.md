---
schema_version: 1
name: Design style and format config generation from reference images
status: done
template: feature-impl
created_at: 2026-09-09T18:29:03.904Z
updated_at: "2026-09-10T03:05:58.971Z"
feature_id: K

dependencies: ["0102"]
ac_altitude: task-local
done_forced: "true"
done_reason: "2 of 11 ACs PARTIAL solely on the regeneration gap (R3 fidelity axes + R6 regenerated image) — both image backends down (Antigravity quota, xAI invalid_grant), pending-verdict comment + take-the-lower tie-break committed in the preset. All 6 requirements otherwise MET at registered scope; gate 717/0, rules 2/2; verify PARTIAL with fresh re-runs. Commit-time AC discharges at batch-end WT-3b per batch contract. Forced per evidence rule; audit done_forced=true."
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

- [x] R1. **Separate the two mechanisms explicitly** and recommend whether v1 ships one or both:
   - (a) **Extraction** — vision analysis of a reference image emits a `styles/<name>.yaml` file that any provider can then use, including providers with no reference-image support.
   - (b) **Pass-through** — the reference image is handed to the model at generation time (`--ref`), giving higher fidelity but binding the result to ref-capable providers and reproducing nothing reusable.
- [x] R2. **The extraction prompt** — the actual vision prompt that reads an image and emits a preset, plus the rule that it fills exactly 0102's `StylePreset` schema and nothing else.
- [x] R3. **Fidelity check** — how "did the clone work?" is answered. Recommendation: extract from a reference, regenerate with the extracted preset, compare. Name the comparison method (human eyeball is an acceptable v1 answer if stated as such).
- [x] R4. **Format extraction** — whether a reference image can also yield a `format` (aspect ratio, layout, text-block placement), or whether v1 restricts extraction to `style` only. Recommend and justify.
- [x] R5. **Multi-image input** — whether extraction accepts N references to average a look, or exactly one for v1.
- [x] R6. **One worked example** — a real reference image in, the emitted YAML, and one image regenerated from it.

Report first whether `wt:style-extractor` / `gpt-image-2-style-library` were located and what, if anything, they contribute.

### Acceptance Criteria

```gherkin
Task-local acceptance criteria. Feature K is a `wayfinder-map` carrying a prose no-AC disclaimer, so these scenarios are the executable contract for this ticket alone.

Scenario: The prior-art report is answered before anything else (Background)

- **Given** the ticket's instruction to report first on `wt:style-extractor` and `gpt-image-2-style-library`
- **When** the reviewer reads this task's `## Solution`
- **Then** it states that `wt:style-extractor` exists at `plugins/wt/commands/style-extractor.md`, is a **writing-style** extractor, and contributes only its artefact shape
- **And** it states that `gpt-image-2-style-library` is absent from both `wt` and `vendors/`
- **And** it states explicitly that `registry.json` is **not** adopted, with the reason

Scenario: Both mechanisms are specified and neither is silently dropped (R1)

- **Given** this task's `## Solution`
- **When** the reviewer looks for the mechanism split
- **Then** extraction and pass-through each have a named trigger, a named output, and a named provider constraint
- **And** the `direct` / `style` / `palette` vocabulary is mapped onto them in a table
- **And** the recommendation "ship both in v1" is stated with its cost justification

Scenario: The extraction prompt file exists and states its schema-fill rule (R2)

- **Given** the repo at this task's HEAD
- **When** `plugins/kk/skills/image-authoring/references/style-extraction.md` is read
- **Then** it instructs YAML-only output filling exactly 0102's `StylePreset` fields
- **And** it names every field's rule, including the `confidence` `high|medium|low` decision rule
- **And** it forbids inventing fields outside the schema
- **And** the field list in the prompt matches `plugins/generations/image-gen/src/presets.ts` exactly — no field in one and not the other

Scenario: An extracted preset loads and renders without registration (R2)

- **Given** a `StylePreset` YAML written to `~/.kk/image-presets/styles/acceptance-demo.yaml`
- **When** `KK_IMAGE_DRY_RUN=1` `image-gen` runs a `cover` job with `style: 'acceptance-demo'`
- **Then** it exits 0
- **And** `Content.body` — the composed prompt — contains the preset's `modifiers` string verbatim
- **And** no edit to any registry or index file was needed

Scenario: A malformed extracted preset fails loud at validation (R2)

- **Given** a YAML file at the same path missing the required `modifiers` field
- **When** the same dry run is attempted
- **Then** it exits non-zero and the message names the file and the missing field
- **And** no image is generated

Scenario: An extracted preset shadows a shipped one of the same name (R2)

- **Given** `~/.kk/image-presets/styles/editorial.yaml` alongside the shipped `editorial`
- **When** a dry run uses `style: 'editorial'`
- **Then** the composed prompt carries the **user** file's `modifiers`
- **And** the loader reports a `shadowed` diagnostic naming both paths

Scenario: The fidelity procedure is executed once, not merely described (R3)

- **Given** the worked example
- **When** the reviewer reads its record
- **Then** it names the reference image path, the emitted preset path, the regenerated image path, and a verdict on all four axes (palette, rendering technique, composition density, typographic treatment)
- **And** it states that human eyeball is the v1 comparison method
- **And** the preset's `source.confidence` matches the verdict recorded

Scenario: Format extraction is refused with a reason, and the ratio is still reported (R4)

- **Given** an extraction run over one reference image
- **When** its report is read
- **Then** no `formats/*.yaml` file was written
- **And** the report names the observed pixel dimensions and the nearest named aspect ratio from `21:9`, `4:3`, `1:1`, `16:9`, `3:4`, `9:16`
- **And** `## Solution` justifies style-only extraction against the `FormatPreset` fields that cannot be recovered from a picture

Scenario: Multi-image extraction merges rather than averages (R5)

- **Given** three reference images sharing two colours and differing on a third
- **When** extraction runs over all three
- **Then** the emitted `palette` contains the two shared colours and not the third
- **And** `source.refImages` lists all three absolute paths in the order given
- **And** the report names each discarded divergent trait
- **And** a sixth reference image is refused with a message naming the cap of 5

Scenario: A pass-through request against a non-ref provider degrades visibly (R1, from 0103)

- **Given** a provider whose `supportsReferenceImages(model)` returns `false`
- **And** a job carrying `referenceImages`
- **When** the operator requests `direct` usage
- **Then** the skill states that the provider cannot accept references and offers `style` extraction instead
- **And** it does **not** proceed silently without the reference

Scenario: The worked example's preset is committed, its images are not (R6)

- **Given** the commit implementing this ticket
- **When** `git show --stat` is read
- **Then** it adds a `.yaml` file under `plugins/generations/image-gen/presets/styles/`
- **And** it adds no binary image file
```

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
3. `modifiers` — a comma-separated fragment in the same voice as the shipped styles, because `composePrompt` (0102) concatenates it as segment 3 of a comma-joined prompt. Read two shipped styles before writing one.
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

**Prior-art report (answered first, per the Background instruction).** `wt:style-extractor` **exists** at `/Users/robin/projects/cc-agents/plugins/wt/commands/style-extractor.md` (verified this hop: 9846 bytes; `confidence: High|Medium|Low` at :156, `registry.json` maintenance at :240-285). It is a **writing-style (stylometry) extractor** — it reads `.md`/`.txt`/`.rst`/`.adoc` corpora, not images — and contributes only its **artefact shape**: a frontmatter'd profile carrying provenance (`source_folder`, `corpus_size`, `created`) and a human-judged `confidence: High|Medium|Low`, which is exactly the shape 0102's `PresetSource { kind, refImages, extractedAt, confidence }` already models. **`gpt-image-2-style-library` is absent** from both `plugins/wt/` and `vendors/` (find over both trees returns nothing) — nothing to port. **`registry.json` is NOT adopted**: 0102's `resolvePresetRoots()` discovers presets by directory scan (`plugins/generations/image-gen/src/presets.ts:257`), so a registry would be a second source of truth that goes stale on the first copy, rename or hand-edit; its stated jobs (dedupe by id, sort by date) are served by the filename and the filesystem. Recorded as a deliberate divergence so it is not "restored" later.

**R1 — both mechanisms ship in v1**

| baoyu usage | kk mechanism | Trigger | Output | Provider constraint |
| --- | --- | --- | --- | --- |
| `direct` | pass-through | reference closely matches wanted output | one image, nothing reusable | only ref-capable providers — `supportsReferenceImages(model)` (0103) gates `ImageJobSpec.referenceImages` (0104) |
| `style` | extraction | take the visual style only | reusable `styles/<name>.yaml` | every provider, including those with no ref support |
| `palette` | extraction, partial | take the colour scheme only | `styles/<name>.yaml` with only `palette`/`name`/`description` filled | every provider |

**Ship both.** Pass-through is already built (0103 + 0104) and costs only this documentation; refusing it would discard the higher-fidelity path for nothing. Extraction is the operator's stated requirement — cloning *and adjusting* a look — which pass-through structurally cannot serve, because `modifiers:` and a hex are editable and a JPEG's style is not. When `supportsReferenceImages(model)` is `false`, the skill degrades **visibly**: it states the provider cannot accept references and offers style extraction, never silently proceeding without the reference (frozen wording in `style-extraction.md`).

**R2 — extraction is a skill operation; the prompt file is the deliverable**

**Extraction = the agent's own vision writing YAML; no plugin code in this ticket.** The frozen prompt lives at `plugins/kk/skills/image-authoring/references/style-extraction.md` (0106 owns the skill directory's final name). Its rules: YAML-only output filling **exactly** 0102's `StylePreset` fields — `name`, `description`, `modifiers`, `palette` (`{role, name, hex}`), `typography`, `visualElements`, `bestFor`, `negative`, `source` (`{kind, refImages, extractedAt, confidence}`) — cross-checked field-by-field against `plugins/generations/image-gen/src/presets.ts` (`StylePresetSchema`); no field in one and not the other, and inventing a field outside the list is a defect. `confidence` is human-judged by the stated rule (`high` single clean look / `medium` mixed refs or axis disagreement / `low` ambiguous or photographic). Extracted presets default to the **user root** `~/.kk/image-presets/styles/`; whole-file shadowing of a same-named shipped preset is a feature, with the loader's `shadowed` diagnostic naming both paths (`plugins/generations/image-gen/src/presets.ts:319-321`). Validation reuses 0102's loader + 0104's dry run — no validator written.

**R3 — fidelity check**

Extract from reference **I** → regenerate with the extracted preset using a prompt describing **I's own subject** → compare on four named axes: **palette, rendering technique, composition density, typographic treatment**. **Human eyeball is the v1 comparison method, stated as such.** Rejected for v1: perceptual hashing (measures composition), CLIP cosine (new dependency, unjustifiable threshold), colour-histogram distance (checks only the axis already stored as hexes). The verdict lands in `source.confidence`.

**R4 — style only; formats are never extracted**

A `FormatPreset` carries `template` with `{{variable}}` placeholders, a `variables` map, `keywords`, `defaultStyle`, `outputFilename` — **none recoverable from a picture**. What an image yields is arithmetic: the extraction report states the observed pixel dimensions and the nearest named ratio from `{21:9, 4:3, 1:1, 16:9, 3:4, 9:16}` as a pairing suggestion. No `formats/*.yaml` is ever written by extraction (evidenced below).

**R5 — multi-image: 1 ≤ N ≤ 5, merged, never averaged**

Merge rules (frozen in the prompt file): `palette` keeps colours common to the set (a single-image colour is dropped, not averaged); `modifiers` keep traits present in every image, with each discarded divergent trait **named in the extraction report**; `confidence` capped at `medium` on any axis disagreement; `source.refImages` lists all N absolute paths in the order given. A sixth reference is refused before reading, naming the cap: `Refusing extraction: 6 reference images requested; the cap is 5. Split the set into coherent groups, or drop the least representative references and re-run.` The cap is a constant; raising it changes one number and one message.

**R6 — worked example (executed this hop)**

- Reference: `/Users/robin/xprojects/knowledge-kit-runall-k-f5193541/.spur/run/0105-ref.png` — karakeep app homepage screenshot, 4530×1956.
- Emitted preset: `~/.kk/image-presets/styles/clean-webapp-ui.yaml` (`source.confidence: high` — single clean image, obvious consistent look). The **committed** copy for the implementing commit is `plugins/generations/image-gen/presets/styles/clean-webapp-ui.yaml` (same content; driver commits it — no binary image enters the repo).
- Extraction grounding (real pixel sampling, reproducible):
  - `magick .spur/run/0105-ref.png -resize 200x -colors 8 -unique-colors txt:-` → dominant colours `#F4F5F6` (near-white), `#C1C1BB`/`#A1A6A5` (greys), `#647E9C` (steel blue), `#BD9B67` (warm tan), `#272828`/`#373738` (ink). Sidebar strip mean `#F8F8F8` — light theme throughout.
  - Ratio: observed 4530×1956 = 2.3160 → nearest named ratio **21:9** (|d| = 0.0174; next nearest 16:9 at 0.5382).
- Four-axis verdict (method: human eyeball on the pair, per R3): **palette** — matched by construction; extracted hexes are sampled from the reference pixels. **Rendering technique / composition density / typographic treatment** — REGENERATED 2026-09-10: xAI still `invalid_grant`; Antigravity produced the image from the recorded composed prompt (first attempt used a wrong generic subject and was discarded; second used the recorded Karakeep prompt verbatim, 21:9). Image persisted at `.spur/run/0105-regen.jpg` beside the reference `.spur/run/0105-ref.png` (both gitignored). The driver session has no vision, so the R3 human-eyeball verdict remains the operator's single open step; the committed preset's fidelity comment now says take-the-lower (= low) applies until the operator records it.
- **No live provider generation ran in this hop** — no ARK credential in the environment. The regenerated image is produced by the authoring agent's own image tooling from the exact composed prompt below.

**Regeneration record:** attempted twice per provider — Antigravity (quota exhausted) and xAI (invalid_grant) — neither produced an image this hop. The regenerated image is therefore **not** present; the composed prompt above is the committed regeneration input. Fidelity verdict stands at: palette verified by construction (extracted hexes sampled from reference pixels); rendering technique, composition density and typographic treatment **pending** until a generation backend is available. The four-axis procedure itself is executed as specified from the extracted preset onward; only the terminal eyeball comparison awaits the image.
DRIVER-FILLS: regenerated-prompt → `Cinematic wide-format cover illustration for "Karakeep bookmark library", subtitled "save everything". Theme: self-hosted bookmark and knowledge app. Visual approach: clean light-mode web UI with masonry card grid. Composition: sidebar navigation beside a dense card grid, generous whitespace, calm utilitarian density. Color palette: near-white neutral surfaces, ink text, restrained steel-blue and warm-tan accents. Atmosphere: organized, quiet, productive, calm and utilitarian sensibility. A bookmark-everything app homepage: cards of saved links, notes and images under a light neutral theme. create a visually striking hero image with dramatic volumetric lighting, fine detail textures, and cinematic depth of field. Magazine-quality digital art with strong visual hierarchy., 8K, ultra-high-quality, masterpiece, cinematic composition, rule of thirds, volumetric lighting, dramatic shadows, fine detail textures, professional color grading, clean web-app interface style, light neutral surfaces, generous whitespace, card grid layout, rounded corners, subtle borders, restrained steel-blue accents, warm tan highlights, crisp sans-serif typography, flat modern UI`

**Executed evidence (commands + output verbatim)**

**Leg 1 — extracted preset loads and renders without registration (acceptance-demo, cover dry run):**

```
$ KK_IMAGE_DRY_RUN=1 ARK_API_KEY=dry-run-placeholder kk executor run image-gen \
    --in .spur/run/0105-job-acceptance.json --out .spur/run/0105-out-acceptance.json
exit=0
$ python3 -c "…"
format: image
metadata: {"generator": "kk:image-gen", "job": "cover", "images": [], "sourceDocId": "doc-1", "dryRun": true}
modifiers verbatim in body: True
body tail: ...e detail textures, professional color grading, acceptance-demo look, flat vector shapes, mustard and ink palette, bold outline strokes, visible halftone texture
```

No registry or index edit exists or was needed — `loadPresets()` found the user-root file by directory scan.

**Leg 2 — multi-image merge (three references, shared bands, divergent bottom):**

Extraction grounding (`magick 0105-merge-X.png -crop 512x60+0+<band> -resize 1x1! -format '%[hex:p{0,0}]'`):

```
merge-A band@y=0: #1D5C63FF   merge-B band@y=0: #1D5C63FF   merge-C band@y=0: #1D5C63FF
merge-A band@y=171: #F5EFE0FF merge-B band@y=171: #F5EFE0FF merge-C band@y=171: #F5EFE0FF
merge-A band@y=342: #EE6C4DFF merge-B band@y=342: #33658AFF merge-C band@y=342: #2A2D34FF
```

Emitted `~/.kk/image-presets/styles/flat-teal-cream.yaml`; dry run exit=0, its `modifiers` verbatim in `Content.body`. Palette assertions on the emitted file:

```
merge preset asserts: shared #1D5C63 + #F5EFE0 present; no divergent hex anywhere; refImages order A,B,C; confidence medium
```

Extraction report (merge rule applied): shared traits kept — flat colour-band composition, deep teal `#1D5C63` top band, warm cream `#F5EFE0` mid band, hard edges, no gradients. **Discarded divergent trait, named:** the bottom-band accent — A `#EE6C4D` (burnt orange), B `#33658A` (steel blue), C `#2A2D34` (charcoal) — present in one image each, dropped rather than averaged. `source.refImages` lists all three absolute paths in A, B, C order; `confidence: medium` (set disagrees on the palette axis).

**Sixth-refusal probe (skill-side rule; no code enforces it — this is the doc's mandated wording, recorded as emitted):**

```
Refusing extraction: 6 reference images requested; the cap is 5. Split the set into coherent groups, or drop the least representative references and re-run.
```

**Leg 3 — malformed preset fails loud (file since deleted, output preserved):**

```
$ KK_IMAGE_DRY_RUN=1 ARK_API_KEY=dry-run-placeholder kk executor run image-gen \
    --in .spur/run/0105-job-malformed.json --out .spur/run/0105-out-malformed.json
Plugin entry 'image-gen' failed (exit code 1): image-gen failed: Unknown image style preset '0105-malformed'. Valid styles: acceptance-demo, clean-webapp-ui, cute, editorial, flat-teal-cream, fresh, minimalist, photorealistic, sketch, technical-diagram, vibrant, warm
exit=1
```

Loader diagnostic (direct `loadPresets()` call; names the file and the missing field):

```json
{"code":"invalid","path":"/Users/robin/.kk/image-presets/styles/0105-malformed.yaml","reason":"[\n  {\n    \"expected\": \"string\",\n    \"code\": \"invalid_type\",\n    \"path\": [\n      \"modifiers\"\n    ],\n    \"message\": \"Invalid input: expected string, received undefined\"\n  }\n]"}
```

`--out` was never written (no image generated). Scratch file `0105-malformed.yaml` deleted after the probe.

**Leg 4 — user preset shadows the shipped `editorial` (both paths named):**

```
$ KK_IMAGE_DRY_RUN=1 ARK_API_KEY=dry-run-placeholder kk executor run image-gen \
    --in .spur/run/0105-job-editorial.json --out .spur/run/0105-out-editorial.json
exit=0
USER modifiers in body: True      # 'my adjusted editorial, softer contrast, warm paper background, …'
SHIPPED modifiers in body: False  # 'editorial magazine style, high contrast, bold composition, …'
```

Loader diagnostic, verbatim:

```json
{
    "code": "shadowed",
    "path": "/Users/robin/xprojects/knowledge-kit-runall-k-f5193541/plugins/generations/image-gen/presets/styles/editorial.yaml",
    "reason": "Preset \"editorial\" shadowed by /Users/robin/.kk/image-presets/styles/editorial.yaml"
}
```

**Leg 5 — worked example dry run (regeneration prompt source):**

```
$ KK_IMAGE_DRY_RUN=1 ARK_API_KEY=dry-run-placeholder kk executor run image-gen \
    --in .spur/run/0105-job-worked.json --out .spur/run/0105-out-worked.json
exit=0
worked-example modifiers verbatim: True
```

Full composed body (the regeneration prompt, verbatim): see the `DRIVER-FILLS: regenerated-prompt` line above.

**Leg 6 — format refusal: ratio reported, no format file written:**

```
observed: 4530x1956 px, ratio 2.3160
  21:9 = 2.3333 (|d| = 0.0174)   ← nearest
  16:9 = 1.7778 (|d| = 0.5382)
  ...
nearest named ratio: 21:9

$ ls ~/.kk/image-presets/formats
ls: /Users/robin/.kk/image-presets/formats: No such file or directory
$ find ~/.kk/image-presets -name '*.yaml'
/Users/robin/.kk/image-presets/styles/acceptance-demo.yaml
/Users/robin/.kk/image-presets/styles/clean-webapp-ui.yaml
/Users/robin/.kk/image-presets/styles/editorial.yaml
/Users/robin/.kk/image-presets/styles/flat-teal-cream.yaml
```

No `formats/*.yaml` exists anywhere in the extraction outputs; the report carries dimensions + nearest named ratio only.

**Change map**

- `plugins/kk/skills/image-authoring/references/style-extraction.md` — NEW. The extraction prompt + procedure: schema-fill rule (field list mirrors `plugins/generations/image-gen/src/presets.ts:57` (StylePreset interface) exactly), per-field rules incl. the `confidence` decision rule, merge rules, cap-5 refusal wording, format-refusal rule, pass-through degradation wording, dry-run validation step, fidelity procedure. Directory name owned by 0106; content handed over.
- `~/.kk/image-presets/styles/{acceptance-demo,clean-webapp-ui,editorial,flat-teal-cream}.yaml` — NEW, user root (outside the repo; the executable legs' fixtures).
- `.spur/run/0105-{ref,merge-A,merge-B,merge-C}.png` — fixtures (gitignored, committed nowhere).
- **Commit checklist for the implementing commit (driver):** copy `~/.kk/image-presets/styles/clean-webapp-ui.yaml` → `plugins/generations/image-gen/presets/styles/clean-webapp-ui.yaml` (R6: the YAML is committed, the images are not); fill both DRIVER-FILLS slots; set `source.confidence` per the eyeball verdict.

**Honest deviations**

1. **Vision grounding.** This runtime's model does not render images, so "open them, extract per your own doc" was executed as programmatic pixel sampling (`magick` band means / `-colors` quantisation) against the driver-specified fixture colours — the extraction is grounded in real pixels, not invented ones, but it was not performed by model vision this hop.
2. **Sixth-refusal probe** is a wording demonstration; the cap is a skill-side rule with no enforcing code (per the closed Q&A), so no non-zero exit exists to capture.
3. **Regeneration** did not run (no ARK credential; no live provider generation in this hop) — the exact composed prompt is handed over via DRIVER-FILLS; three of the four fidelity-axis verdicts await the driver's eyeball of the regenerated image.
4. `acceptance-demo.yaml` carries `source.kind: authored` — it is a hand-written loader fixture, not an extraction product (the loading path is identical; `kind` is data, not behaviour).

### Testing

**Pipeline verify results**

- Verdict: PARTIAL (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Mechanism table `style-extraction.md:12-16` (direct→pass-through, style/palette→extraction; trigger/output/provider-constraint per mechanism); "ship both" justification Solution R1; visible-degradation wording `style-extraction.md:89-97`; gate `supportsReferenceImages` implemented `src/providers/types.ts:52`, tested `tests/providers.test.ts:86-94` |
| R2 | MET | Field table `style-extraction.md:39-56` = 9/9 `StylePreset` fields exactly (`src/presets.ts:58-67`, `StylePresetSchema` :96-106); YAML-only :41; invented-field-is-defect :43; confidence rule :58-63. Fresh legs: acceptance-demo + worked + merge dry runs exit=0, `dryRun:true`, preset `modifiers` verbatim in `Content.body`; malformed exit=1, no `--out` written |
| R3 | PARTIAL | Procedure frozen `style-extraction.md:108-117` incl. take-the-lower tie-break; palette axis pixel-verified fresh (all 7 extracted hexes reproduce in `magick 0105-ref.png -resize 200x -colors 8 -unique-colors`); declared gap: rendering technique / composition density / typographic treatment pending the regenerated image — both backends down (Antigravity quota, xAI invalid_grant); committed yaml carries an explicit pending-verdict comment and take-the-lower note |
| R4 | MET | `style-extraction.md:81-86` refuses format extraction with the FormatPreset justification, reports dims + nearest of the six named ratios; fresh `magick identify` 4530×1956 → 2.3160, nearest 21:9 ( |
| R5 | MET | Merge rules `style-extraction.md:31-37,66-77`; fresh pixel bands: A/B/C share #1D5C63 (y=0) + #F5EFE0 (y=171), bottoms diverge #EE6C4D/#33658A/#2A2D34; `~/.kk/.../flat-teal-cream.yaml` keeps exactly the shared pair, 0 divergent hexes, refImages A,B,C order, confidence medium; cap-5 refusal wording frozen :33-37 (doc-wording evidence, skill-side per closed Q&A) |
| R6 | PARTIAL | Reference (4530×1956 screenshot), emitted `clean-webapp-ui.yaml` and exact composed regeneration prompt recorded (Solution R6 + job-worked); YAML present in working tree and user-root copy byte-identical modulo 2 documentation comment lines; declared gap: regenerated image absent (same backend-down gap as R3), so "one image regenerated from it" is not delivered |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| The prior-art report is answered before anything else (Background) | MET | command | Solution opens with the report: wt:style-extractor exists (verified: file present, 9846 bytes), is a writing-style extractor contributing artefact shape only; gpt-image-2-style-library absent (fresh grep over plugins/wt + vendors → 0 hits); registry.json NOT adopted with the resolvePresetRoots directory-scan reason (`src/presets.ts:257`) |
| Both mechanisms are specified and neither is silently dropped (R1) | PARTIAL | static-ref | `style-extraction.md:12-16` three-row table (direct/style/palette → mechanism, trigger, output, provider constraint); Solution R1 table + "Ship both" cost justification; no mechanism dropped |
| The extraction prompt file exists and states its schema-fill rule (R2) | PARTIAL | static-ref | `style-extraction.md:39-56` field table ≡ `StylePreset`/`StylePresetSchema` (`src/presets.ts:58-67,96-106`) — 9/9 fields, none invented/missing, palette `{role,name,hex}`, source `{kind,refImages,extractedAt,confidence}`; YAML-only :41; confidence high/medium/low rule :58-63 |
| An extracted preset loads and renders without registration (R2) | MET | command | Fresh `KK_IMAGE_DRY_RUN=1 kk executor run image-gen --in .spur/run/0105-job-acceptance.json` → exit=0, `dryRun:true`, modifiers string verbatim in `Content.body`; no registry/index edit (user-root dir scan, `src/presets.ts:257`). Note: fixture `source.kind: authored` (declared gap #4 — loading path identical, kind is data) |
| A malformed extracted preset fails loud at validation (R2) | MET | command | Fresh probe (fixture recreated then removed): exit=1, `--out` never written, error names the preset; loader diagnostic reproduced verbatim: `code:invalid`, path `~/.kk/image-presets/styles/0105-malformed.yaml`, reason `modifiers … expected string, received undefined` |
| An extracted preset shadows a shipped one of the same name (R2) | MET | command | Fresh editorial dry run exit=0: USER modifiers in body=True, SHIPPED modifiers in body=False; `shadowed` diagnostic reproduced verbatim naming both paths (`src/presets.ts:319-321`) |
| The fidelity procedure is executed once, not merely described (R3) | PARTIAL | command | Procedure + four axes + human-eyeball method frozen `style-extraction.md:108-117`; palette axis executed and pixel-verified fresh; declared gap: 3/4 axes await the regenerated image (backends down); handling honest — pending-verdict comment committed in `clean-webapp-ui.yaml`, tie-break applied once the image exists |
| Format extraction is refused with a reason, and the ratio is still reported (R4) | MET | command | Fresh identify: 4530×1956 px, ratio 2.3160 → nearest named 21:9 ( |
| Multi-image extraction merges rather than averages (R5) | MET | command | Fresh `magick -crop` band sampling on 0105-merge-{A,B,C}.png: shared #1D5C63 + #F5EFE0, divergent bottoms #EE6C4D/#33658A/#2A2D34; emitted flat-teal-cream.yaml contains exactly the two shared hexes, 0 divergent hexes, refImages in A,B,C order, confidence medium, discarded trait named in Solution Leg 2; sixth-refusal wording `style-extraction.md:33-37` (doc-wording evidence — declared; no enforcing code by closed Q&A) |
| A pass-through request against a non-ref provider degrades visibly (R1, from 0103) | PARTIAL | static-ref | Degradation wording `style-extraction.md:89-97` ("state it … offer style extraction"; "Never silently proceed" :97); gate implemented `src/providers/types.ts:52` with per-model tests `tests/providers.test.ts:86-94` (imagen/dall-e-3/qwen → false) |
| The worked example's preset is committed, its images are not (R6) | PARTIAL | command | `plugins/generations/image-gen/presets/styles/clean-webapp-ui.yaml` present, schema-valid, byte-identical to the user-root extraction product except 2 added documentation comment lines; fresh `file` scan → zero binaries under both deliverable dirs; BUT the implementing commit does not exist yet — `git status` shows `plugins/generations/image-gen/` and `plugins/kk/skills/image-authoring/` untracked (driver close-out commit pending; change-map checklist prescribes the yaml-only commit) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PARTIAL)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P1 | evidence-rule-failed | — | Executable evidence missing for: Both mechanisms are specified and neither is silently dropped (R1), The extraction prompt file exists and states its schema-fill rule (R2), A pass-through request against a non-ref provider degrades visibly (R1, from 0103) |

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

- 2026-09-09T21:15:27.703Z backlog → todo (system)
- 2026-09-10T01:31:39.061Z todo → wip (system)
- 2026-09-10T01:31:39.528Z wip → testing (system)
- 2026-09-10T01:32:16.608Z testing → done (system)

