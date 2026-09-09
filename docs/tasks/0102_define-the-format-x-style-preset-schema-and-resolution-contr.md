---
schema_version: 1
name: Define the format x style preset schema and resolution contract
status: todo
template: feature-impl
created_at: 2026-09-09T18:27:33.268Z
updated_at: "2026-09-09T21:15:31.117Z"
feature_id: K

ac_altitude: task-local
---

## 0102. Define the format x style preset schema and resolution contract

### Background

**Ticket type: `wayfinder:prototype`** — map K, frontier (unblocked). Depended on by 0104, 0105, 0106.

The load-bearing contract of the whole map: every other ticket consumes it. Two orthogonal preset axes were fixed by operator decision — `format` (the job) × `style` (the look) — but their file shape, field set, composition rule and resolution order are open.

**Question:** What exactly is a `format` file, what is a `style` file, how do they compose into one final prompt string, and how does the runtime find them across built-in / user / project roots?

**Evidence, verified against the tree on 2026-09-09.** Counts and paths below were re-checked during refinement; earlier drafts of this ticket carried three wrong ones, corrected here.

*Prior art — `wt` (the thing being replaced), at `/Users/robin/projects/cc-agents/plugins/wt/skills/`:*

- `image-generate/assets/templates/*.tpl.md` — **4** templates: `default`, `cover`, `cover-xhs`, `illustrator`. (Path is `assets/templates/`, not `materials/templates/`.) Frontmatter fields as built: `name, description, width, height, style, backend, steps, output_filename, variables{<k>:{description,default}}, keywords[]`, then a `---`-delimited body carrying `{{var}}` and `{{var | fallback}}` placeholders.
- `image-generate/materials/styles.yaml` — **9** styles under a top-level `styles:` key, each a bare `name: "comma, separated, modifiers"` string. Names: `technical-diagram, minimalist, vibrant, sketch, photorealistic, warm, fresh, cute, editorial`.
- `image-generate/materials/styles/*.md` — the same 9 names as long-form prose docs (human/model reading, not machine-parsed).
- `image-generate/scripts/template_engine.py` — **the composition rule as built** (`render_prompt`, lines 163-191): `substituted_body` → `", " + ", ".join(keywords)` → `", " + style_modifiers`. Styles resolve via `_load_styles()` (lines 257-298): a hard-coded default map merged under `materials/styles.yaml`, so file entries override built-ins. This is the only executable statement of the wt composition order.
- `image-cover/materials/templates/{blog,news,technical,tutorial}.md` — **4 content-type templates, not styles.** They classify the *source article*, not the look. `image-cover/references/style-templates.md` and `references/content-analysis.md` hold the detection heuristics.

*Prior art — baoyu (MIT, Copyright 2026 Jim Liu), at `vendors/baoyu-skills/skills/`:*

- `baoyu-cover-image/references/base-prompt.md` decomposes on **five** dimensions, not three: **type** (6: `hero, conceptual, typography, metaphor, scene, minimal`) × **palette** (11 files; 9 documented in the schema table) × **rendering** (7: `flat-vector, hand-drawn, painterly, digital, pixel, chalk, screen-print`) × **text** (4 density levels: `none, title-only, title-subtitle, text-rich`) × **mood** (3: `subtle, balanced, bold`). An earlier draft of this ticket said "3-axis"; that was wrong.
- `baoyu-cover-image/references/palettes/*.md` — the richest style-file shape available: a `| Role | Color | Hex |` table (Primary 1-3, Background, Background Alt, Accent 1-2), "Decorative Hints", a "Semantic Constraint" (never render hex codes as visible text), and "Best For".
- `baoyu-infographic/references/styles/*.md` — **22** styles; each has Color Palette, Variants table, Visual Elements, Typography, Best For. `references/layouts/*.md` — **21** layouts. The closest existing example of a two-axis gallery.
- `baoyu-cover-image/references/config/preferences-schema.md` — schema-versioned preferences (`version: 3`) with `preferred_type/palette/rendering/text/mood`, `default_aspect`, `quick_mode`, `language`, and `custom_palettes: []` — the operator-extension hook this ticket's `style` axis must be able to satisfy.

*In-repo precedent:*

- `docs/design/multi-root-plugin-discovery.md:91-102` — ADR-012's resolution table, **low → high, a later root shadows an earlier one**: `builtin` (package-shipped) → `user` (`~/.kk/plugins`) → `project` (`<cwd>/plugins`) → `path` (`KK_PLUGIN_PATH`, colon-separated, left → right). Note the user root is `~/.kk/…`, not `~/.config/kk/…`. Losing manifests emit a `shadowed` diagnostic. This is the pattern to mirror for preset roots.
- `plugins/generations/voice-gen/src/index.ts:318` uses `Bun.YAML.stringify`; Bun 1.3.14 ships `Bun.YAML` — YAML parsing costs no new dependency.

### Requirements

Produce, as the task's Design section and a runnable prototype:

- [ ] R1. **Zod schemas** for `FormatPreset` and `StylePreset` in TypeScript, matching repo conventions (`interface` for object shapes, `any` is an error).
- [ ] R2. **The composition rule** — the deterministic order in which format skeleton, style modifiers, user prompt, variables, and provider-specific hints concatenate into one final prompt string. Order must be explicit and testable, not emergent.
- [ ] R3. **File format decision** — YAML, Markdown-with-frontmatter, or TS module — with the reason. Note that `wt` used `.tpl.md` frontmatter and baoyu uses plain `.md` galleries; kk's own precedent is YAML (`config.example.yaml`, workflows).
- [ ] R4. **Resolution order across roots** — built-in (package-shipped) → user → project → env override, with the shadowing rule when the same preset name appears twice, mirroring ADR-012.
- [ ] R5. **The v1 preset inventory** — which of `wt`'s 9 styles and 4 cover styles survive as `styles/`, and the exact three `formats/` (`free`, `cover`, `illustration`) with their aspect ratios and variable sets.
- [ ] R6. **One rendered example checked into the task**: `format: cover` × `style: editorial` × `{title, subtitle, topics}` → the exact final prompt string.

The prototype must show a real rendered prompt, not a schema alone — a schema that has never rendered anything is not evidence.

### Acceptance Criteria

Task-local scenarios (`ac_altitude: task-local`). Feature K is a wayfinder map tagged `wayfinder-map` and carries a prose no-AC disclaimer instead of Gherkin, so these scenarios are this task's own ship criteria, not a subset of feature AC.

#### Scenario: A valid format file parses into a FormatPreset (R1)
- **Given** `presets/formats/cover.yaml` with `name, description, job, aspectRatio, defaultStyle, keywords, outputFilename, variables, template`
- **When** `FormatPresetSchema.parse` runs on the `Bun.YAML.parse` result
- **Then** it returns a `FormatPreset` whose `name` equals the filename stem, whose `job` is `'cover'`, and whose `template` retains its embedded newlines

#### Scenario: A format file without `job` is rejected (R1)
- **Given** a format YAML identical to `cover.yaml` but with the `job` key removed
- **When** `FormatPresetSchema.parse` runs on it
- **Then** it throws, and the message names `job`
- **And** `loadPresets()` emits an `invalid` diagnostic for that file rather than throwing, leaving the other formats loadable

#### Scenario: A style file with only name, description and modifiers parses (R1)
- **Given** `presets/styles/editorial.yaml` carrying exactly `name`, `description` and `modifiers`
- **When** `StylePresetSchema.parse` runs on it
- **Then** it succeeds and `palette`, `typography`, `visualElements`, `bestFor`, `negative` and `source` are all `undefined`

#### Scenario: composePrompt concatenates the four segments in the frozen order (R2)
- **Given** a format whose `template` renders to `BODY`, whose `keywords` are `['K1','K2']`, and a style whose `modifiers` are `M`
- **When** `composePrompt(format, style, {}, 'E')` is called
- **Then** the result is exactly `BODY, K1, K2, M, E`

#### Scenario: An empty optional segment is dropped, not left as a stray comma (R2)
- **Given** the same format and style but `keywords: []` and no `extra` argument
- **When** `composePrompt(format, style, {})` is called
- **Then** the result is exactly `BODY, M` — no doubled or trailing `, `

#### Scenario: A placeholder with no value and no fallback fails loud (R2)
- **Given** a format whose `template` contains `{{nonesuch}}` and whose `variables` map has no `nonesuch` key
- **When** `composePrompt` is called without a `nonesuch` value
- **Then** it throws an `Error` whose message names both `nonesuch` and the format's `name`

#### Scenario: The fallback form is used when the variable resolves empty (R2)
- **Given** a format whose `template` contains `{{subtitle | , subtitled "{{subtitle}}"}}`
- **When** `composePrompt` is called with `subtitle: ''`
- **Then** the rendered segment is the literal fallback text, not an empty string

#### Scenario: A project-root preset shadows the built-in of the same name (R4)
- **Given** a built-in `presets/styles/editorial.yaml` and a `<project>/.kk/image-presets/styles/editorial.yaml` with different `modifiers`
- **When** `loadPresets()` runs
- **Then** `styles.get('editorial')!.modifiers` is the project file's value **and** `diagnostics` contains one `shadowed` entry naming the built-in path

#### Scenario: KK_IMAGE_PRESET_PATH wins over the project root (R4)
- **Given** the same two files plus a third `editorial.yaml` in a directory named by `KK_IMAGE_PRESET_PATH`
- **When** `loadPresets()` runs
- **Then** the `KK_IMAGE_PRESET_PATH` copy wins and two `shadowed` diagnostics are emitted

#### Scenario: A malformed preset file is skipped, not fatal (R4)
- **Given** a user-root `styles/broken.yaml` that fails `StylePresetSchema.parse`
- **When** `loadPresets()` runs
- **Then** it returns normally, `styles` contains all 9 built-in styles, `styles.has('broken')` is `false`, and `diagnostics` contains one `invalid` entry naming that path

#### Scenario: Every shipped format declares a distinct job (R5)
- **Given** the three shipped format files
- **When** each is parsed
- **Then** `free.job === 'free'`, `cover.job === 'cover'` and `illustration.job === 'illustration'`

#### Scenario: The v1 inventory is exactly three formats and nine styles (R5)
- **Given** no user, project or `KK_IMAGE_PRESET_PATH` roots
- **When** `loadPresets()` runs against the shipped `presets/` directory
- **Then** `[...formats.keys()].sort()` is `['cover','free','illustration']` and `[...styles.keys()].sort()` is `['cute','editorial','fresh','minimalist','photorealistic','sketch','technical-diagram','vibrant','warm']`

#### Scenario: The golden cover prompt renders byte-for-byte (R6)
- **Given** the shipped `cover` format and `editorial` style
- **When** `composePrompt` runs with `{ title: 'Microservices Guide', subtitle: 'From monolith to mesh', topics: 'distributed systems' }`
- **Then** the result equals the exact string literal pinned in the Design section

### Q&A

**Closed during `--depth ready` refinement (2026-09-09).**

- **File format — YAML, decided.** Rejected `.tpl.md` frontmatter (wt's) and `.md` galleries (baoyu's); rationale and the rejected alternatives are in the Design (R3). Closes R3 as a decision rather than an investigation.
- **Composition order — wt's order kept, decided.** `body → keywords → style → extra`. Keeping wt's order is what turns the R6 example into a regression test; inventing a "better" order would make every ported preset render differently with nothing to compare against.
- **Shadowing granularity — whole-file replace, decided.** Field-level merging of a user style over a built-in was considered and rejected: a half-overridden style cannot be reproduced from its file alone.
- **`aspectRatio` vs `width`/`height` — aspectRatio primary, decided.** wt's fixed pixels do not survive contact with 12 providers that each take dimensions differently.
- **Premise corrections applied to Background.** Three claims in the pre-refinement draft were checked and found wrong: baoyu-cover-image is 5-dimensional, not 3-axis; wt's templates live in `assets/templates/`, not `materials/templates/`; and `image-cover/materials/templates/*` are content-type templates, not per-style templates. The Design's R5 boundary (those four go to 0106) depends on that last correction.

**Deferred, with owner:**

- **Preference-file defaults** — whether a default style comes from a kk config file or a baoyu-style `EXTEND.md` is the map's open question (a), owned by the operator, and blocks 0106. `presets.ts` deliberately reads **no** preference file; it takes explicit arguments. Nothing in this ticket is blocked by that question staying open.
- **Whitespace normalization of ported templates** — the golden string preserves wt's embedded newlines and one trailing space. Whether to normalize is a follow-up once real images have been generated from both. Owner: whoever runs 0104's first live generation.

### Design

**WHAT** — the frozen preset contract every other K ticket builds against. **WHY it is frozen here:** 0104 (IO), 0105 (extraction), 0106 (agent surface) all consume these names; if this ticket leaves them open, three downstream agents each invent their own.

#### Where the code lands

`plugins/generations/image-gen/` — a new workspace member (root `package.json` already globs `plugins/generations/*`). Files this ticket owns:

| Path | Contents |
| --- | --- |
| `plugins/generations/image-gen/src/presets.ts` | Zod schemas, the resolver, the composer |
| `plugins/generations/image-gen/presets/formats/{free,cover,illustration}.yaml` | v1 formats |
| `plugins/generations/image-gen/presets/styles/*.yaml` | the 9 ported styles |
| `plugins/generations/image-gen/tests/presets.test.ts` | `bun:test`, incl. the R6 golden-prompt test |

`plugin.json`, `src/index.ts` and the job branches are **0104's**, not this ticket's. This ticket may land a `plugin.json` stub only if `bun run typecheck` needs it.

#### R3 — file format: YAML (decided)

`.yaml`, parsed with `Bun.YAML.parse`. Rejected: `.tpl.md` frontmatter (wt's choice — needs a frontmatter splitter for no gain now that the body can be a YAML block scalar); `.md` galleries (baoyu's choice — prose for a model to read, not config for a deterministic engine to parse); a TS module (defeats the whole point, since a user-authored preset must not require a rebuild). YAML also matches the in-repo precedent (`plugins/kk/config.example.yaml`, `.spur/` workflows) and costs no dependency.

#### R1 — the two schemas (frozen names)

```ts
// src/presets.ts
export interface FormatPreset {
    name: string;                 // filename stem must equal this
    description: string;
    job: 'free' | 'cover' | 'illustration';  // which plugin job branch this format drives (0104)
    aspectRatio: string;          // '21:9' | '1:1' | '4:3' — the portable primary
    width?: number;               // optional exact pixels; providers that need them
    height?: number;
    defaultStyle: string;         // style name used when the caller names none
    keywords: string[];           // quality/composition tail, joined with ', '
    outputFilename: string;       // '{{title | cover}}.png' — same placeholder syntax
    variables: Record<string, { description: string; default: string }>;
    template: string;             // YAML block scalar; the prompt body
}

export interface StylePreset {
    name: string;
    description: string;
    modifiers: string;            // THE prompt-bearing field; the only one required
    palette?: PaletteEntry[];     // { role, name, hex }
    typography?: string;
    visualElements?: string[];
    bestFor?: string;
    negative?: string;            // rendered as a provider negative prompt when supported,
                                  // otherwise appended as 'avoid: …'
    source?: PresetSource;        // provenance — 0105 writes this
}

export interface PaletteEntry { role: string; name: string; hex: string }

export interface PresetSource {
    kind: 'authored' | 'extracted';
    refImages?: string[];
    extractedAt?: string;         // ISO 8601
    confidence?: 'high' | 'medium' | 'low';
}
```

Zod schemas `FormatPresetSchema` / `StylePresetSchema` are declared alongside and are the parse gate; the interfaces above are the hand-written shapes Biome's `useConsistentObjectDefinition` expects (`interface` for object shapes, `type` for unions — `biome.json`). `zod` is already a plugin-level dependency (`plugins/generations/voice-gen/package.json` pins `4.4.3`); pin the same version.

**Why `aspectRatio` is primary and `width`/`height` are optional.** wt hard-codes `width: 1344, height: 576` per template. That is not portable across the 12 baoyu providers, which variously take an aspect-ratio string, a `size`, or an `imageSize` enum (`vendors/baoyu-skills/skills/baoyu-image-gen/scripts/types.ts:14-33`). The format declares intent (`21:9`); 0103's adapter layer owns the per-provider translation. A preset that hard-codes pixels pins the engine to one provider.

**Why `modifiers` is the only required prompt-bearing style field.** It makes wt's 9 one-line styles port verbatim, and lets baoyu's structured fields (`palette`, `typography`, `visualElements`) be additive. A style with only `modifiers` renders; the extras enrich.

#### R2 — the composition rule (frozen, deterministic)

```ts
export function composePrompt(format: FormatPreset, style: StylePreset, vars: Record<string, string>, extra?: string): string
```

Exactly four segments, in this order, `.filter(Boolean).join(', ')`:

1. `renderTemplate(format.template, mergeVars(format.variables, vars))`
2. `format.keywords.join(', ')`
3. `style.modifiers`
4. `extra` — caller-supplied suffix (0105's ref-derived traits and hex lists land here)

Segments 1-3 are wt's order as built (`template_engine.py:174-190`), kept deliberately so the 9 ported styles and 3 ported formats render byte-identically to their wt originals; that is what makes the R6 golden test a *regression* test rather than a fresh assertion. Segment 4 is new and is the only addition.

`renderTemplate` implements wt's placeholder grammar and nothing more: `{{name}}` → the merged value; `{{name | fallback text}}` → the merged value if non-empty, else the literal fallback text. `mergeVars` = per-variable `caller value ?? variables[k].default`. Unknown placeholder → **throw**, naming the placeholder and the format (wt silently left it in place; a silent literal `{{title}}` reaching a paid provider is a defect).

**Anti-patterns, explicit:** do not template-engine this (no Handlebars, no Nunjucks — the grammar is two forms); do not let a provider adapter mutate the composed string (provider-specific hints ride the request object 0103 defines, not the prompt); do not add a fifth segment without changing this signature, because the golden test pins the exact output.

#### R4 — preset roots and shadowing

`resolvePresetRoots(): string[]`, low → high, mirroring `docs/design/multi-root-plugin-discovery.md:91-102`. A later root shadows an earlier one **by preset name within its axis** (a `styles/editorial.yaml` in the project root replaces the built-in one wholesale — no field merging, because a half-overridden style is unreproducible):

| # | Origin | Location | Condition |
| --- | --- | --- | --- |
| 1 | `builtin` | `<plugin dir>/presets/` | always |
| 2 | `user` | `~/.kk/image-presets/` | directory exists |
| 3 | `project` | `<KNOWLEDGE_KIT_PROJECT_ROOT>/.kk/image-presets/` | directory exists |
| 4 | `path` | each `KK_IMAGE_PRESET_PATH` entry (`:`-separated, left → right) | non-empty existing directory |

`KNOWLEDGE_KIT_PROJECT_ROOT` is already injected into every plugin's env by `apps/cli/src/invoke.ts:136`; use it rather than `process.cwd()`, because plugins are spawned with `cwd` = their own package dir (`invoke.ts:212`). Each root holds `formats/` and `styles/` subdirectories; a missing subdirectory is not an error. `loadPresets()` returns `{ formats: Map<string, FormatPreset>, styles: Map<string, StylePreset>, diagnostics: PresetDiagnostic[] }`, emitting a `shadowed` diagnostic for each losing file (ADR-012's own diagnostic code) and an `invalid` diagnostic for a file that fails its Zod parse — **skip it, do not throw**, so one bad user file cannot brick the built-ins.

#### R5 — v1 inventory

- **formats/** (3): `free` (from wt `default.tpl.md`, `1:1`), `cover` (from `cover.tpl.md`, `21:9`), `illustration` (from `illustrator.tpl.md`, `4:3`). `cover-xhs` is out of scope on the map and is **not** ported.
- **styles/** (9): the exact `materials/styles.yaml` set — `technical-diagram, minimalist, vibrant, sketch, photorealistic, warm, fresh, cute, editorial` — each a `modifiers` string copied verbatim, plus `description` from the matching `materials/styles/<name>.md` first line.
- `image-cover`'s `blog/news/technical/tutorial` templates are **not** formats and **not** styles. They are source-article classification heuristics; they belong to the agent surface. **Handoff: 0106 owns them** (they map to `format: cover` plus a variable set and a suggested style, chosen by the model from the article).

#### R6 — the golden prompt

`cover` × `editorial` × `{ title: 'Microservices Guide', subtitle: 'From monolith to mesh', topics: 'distributed systems' }`, all other variables at their defaults, must compose to exactly:

```
Cinematic wide-format cover illustration for "Microservices Guide", subtitled "From monolith to mesh".
Theme: distributed systems.
Visual approach: abstract geometric with clean modern lines.
Composition: strong central focal point, negative space in upper third for text overlay.
Color palette: deep navy transitioning to electric blue with warm amber accents.
Atmosphere: professional, aspirational, forward-looking, modern and aspirational sensibility.
Inspired by the article's core concepts, 
create a visually striking hero image with dramatic volumetric lighting,
fine detail textures, and cinematic depth of field.
Magazine-quality digital art with strong visual hierarchy., 8K, ultra-high-quality, masterpiece, cinematic composition, rule of thirds, volumetric lighting, dramatic shadows, fine detail textures, professional color grading, editorial magazine style, high contrast, bold composition, dramatic directional lighting, sophisticated design, strong visual hierarchy, premium quality
```

Assert it as a single string literal in `tests/presets.test.ts`. If the port changes it, the port changed behavior — that is the point. (Whitespace, including the trailing space after `concepts,` and the embedded newlines, comes from the wt template body verbatim; preserve it. Normalizing whitespace is a separate, later decision.)

#### What this ticket assumes, and what it leaves open

- **Assumes** nothing from 0103, 0104, 0105 or 0106. It is the root of the dependency graph.
- **Leaves to 0103:** how `aspectRatio` / `width` / `height` / `negative` translate into each provider's wire format.
- **Leaves to 0104:** how a caller names a format, a style and the variables (they arrive in `Doc.metadata` — 0104's contract), and where the rendered image is written.
- **Leaves to 0105:** populating `StylePreset.palette` / `visualElements` / `source` from a reference image. The `source` field exists **now** so 0105 has a landing place and does not need to reopen this schema.
- **Leaves to 0106:** the content-type heuristics, and the preference file (if any) that supplies a default style — the map's open question (a) is unresolved, so **Why `job` is a field and not a name convention.** The three v1 formats are named `free`, `cover` and `illustration`, one per plugin job branch — so today the mapping could be read off the name. It must not be: an operator adding `cover-xhs` (or any fourth format) would have no way to say which branch it drives, and the slash command's whole promise is that `--format` alone selects the work (0106 R2). `job` is required with no default, so every preset file — shipped or operator-authored — states it explicitly. 0104's `ImageJobSpec.job` stays the plugin's authoritative input; the skill fills it from the chosen format's `job`.

`presets.ts` reads **no** preference file; it takes explicit arguments only.

### Plan

1. **Scaffold the workspace** — `plugins/generations/image-gen/package.json` (`@gobing-ai/image-gen`, `private: true`, `type: module`, `typecheck` script, deps `@gobing-ai/kk-core` workspace + `zod@4.4.3`, dev `@types/bun@1.3.14`), copying `plugins/generations/voice-gen/package.json` field for field. Confirm `bun install` picks it up via the existing `plugins/generations/*` workspace glob.
2. **Write `src/presets.ts` schemas** (R1) — the four interfaces and their Zod counterparts. `bun run typecheck` clean.
3. **Write `renderTemplate` + `mergeVars`** (R2) — the two-form placeholder grammar; throw on unresolvable. Tests: the fallback scenario and the fail-loud scenario.
4. **Write `composePrompt`** (R2) — four segments, `.filter(Boolean).join(', ')`. Tests: frozen-order and empty-segment scenarios.
5. **Port the 9 styles** (R5) — transcribe `materials/styles.yaml` values verbatim into `presets/styles/<name>.yaml`; take `description` from each `materials/styles/<name>.md`. Do not rewrite a modifier string — a "clean-up" here silently changes every generated image.
6. **Port the 3 formats** (R5) — `default.tpl.md` → `free.yaml`, `cover.tpl.md` → `cover.yaml`, `illustrator.tpl.md` → `illustration.yaml`. Frontmatter maps field-for-field; `width`/`height` become `aspectRatio` (`1:1`, `21:9`, `4:3`) **with** the original pixels retained in `width`/`height`; `backend` and `steps` are dropped (0103 owns provider selection); `style` becomes `defaultStyle`; the body becomes the `template` block scalar with whitespace preserved.
7. **Write `resolvePresetRoots` + `loadPresets`** (R4) — four roots, later-wins, `shadowed` / `invalid` diagnostics, missing subdirectory tolerated. Tests: the three R4 scenarios, driven by `KK_IMAGE_PRESET_PATH` and a tmpdir so no test touches `~/.kk/`.
8. **Write the golden-prompt test** (R6) — the exact literal from the Design. This is the port's regression gate; if it does not match, fix the port, not the literal.
9. **Inventory test** (R5) — assert the two sorted key lists.
10. **Verify** — `bun run lint` (Biome 2.5.5 + typecheck) clean; `bun run test` passes with line and function coverage ≥ 90% for `src/presets.ts`; `git status` shows only the intended new files.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Parent map: [K — kk image pipeline (wayfinder map)](../features/K_kk-image-pipeline-migrate-wt-image-skills-to-a-typescript-generator-plugin-wayfinder-map.md)
- Dependents: 0103 (provider request shape), 0104 (Doc→Content IO), 0105 (extraction target schema), 0106 (agent surface)
- `docs/design/multi-root-plugin-discovery.md` §"Default discovery" — the root-order and `shadowed`-diagnostic pattern mirrored by R4
- `docs/00_ADR.md` → ADR-009 (kind collections), ADR-012 (multi-root discovery)
- `apps/cli/src/invoke.ts:136` — `KNOWLEDGE_KIT_PROJECT_ROOT` injection; `:212` — plugins are spawned with `cwd` = their own package dir
- wt prior art: `/Users/robin/projects/cc-agents/plugins/wt/skills/image-generate/{assets/templates/*.tpl.md,materials/styles.yaml,materials/styles/*.md,scripts/template_engine.py,references/template-system.md}`
- baoyu prior art (MIT, Copyright 2026 Jim Liu — `vendors/baoyu-skills/LICENSE`): `baoyu-cover-image/references/{base-prompt.md,palettes/*.md,config/preferences-schema.md}`, `baoyu-infographic/references/{styles,layouts}/*.md`

### History

- 2026-09-09T21:15:31.117Z backlog → todo (system)

