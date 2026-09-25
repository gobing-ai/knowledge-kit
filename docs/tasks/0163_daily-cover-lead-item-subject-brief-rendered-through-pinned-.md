---
schema_version: 1
name: "Daily cover: lead-item subject brief rendered through pinned daily-news presets"
status: todo
template: feature-impl
created_at: 2026-09-25T06:50:49.293Z
updated_at: "2026-09-25T06:52:24.693Z"
feature_id: F614

priority: P1
estimate_hours: 3
---

## 0163. Daily cover: lead-item subject brief rendered through pinned daily-news presets

### Background

The operator's original F613 ask covered both the spoken script and a news-driven daily cover image with a consistent style. F613 (0161/0162) delivered only the script, so this feature adds the cover.

Current state (checked against the tree on 2026-09-24):

- `cover` (`plugins/kk/workflows/kk-daily-ai-voice.yaml:165`) is an `agent.run` that invokes the `kk:image-authoring` skill with `--format cover --content <article.md>` and the instruction "do not pass --style". The skill then derives `title` / `subtitle` / `topics` from the full article, so the model re-decides the inputs every day.
- Style drift has three sources:
  1. The style falls through to `image.style` (unset in `~/.config/kk/config.yaml:64`) and then to the format's `defaultStyle: vibrant`. The skill may also "propose an auto-detected style" (`plugins/kk/skills/image-authoring/SKILL.md` generate step 3).
  2. The provider is `auto` (`AUTO_ORDER`, google first). Whichever credentials are present on the machine therefore choose the look; the 2026-09-24 run happened to get `minimax/image-01`.
  3. The generic `cover` format exposes `mood`, `visual_style`, `color_palette`, `composition` and `atmosphere` as caller-overridable variables.
- The content is not news-driven. On 2026-09-24 the prompt was `title: 每日 AI 资讯 — 20260924` plus abstract topic words (`AI 治理与安全通报、模型降价竞赛…`) over "abstract geometric" defaults (`.works/kk-daily-ai-voice/20260924/2-cover/content.json`). Nothing in the image refers to a specific story.
- The artifact name comes from the format name: `<stem>-<format.name>-NN.<ext>` (`plugins/generations/image-gen/src/paths.ts:22`, called at `src/index.ts:237`). `coverNormalizeBody` (`plugins/kk/scripts/kk-workflow-stages.ts:890`) hard-codes `content-cover-01.{png,jpg}`, so a new format name would break normalize unless normalize reads the path from `content.json`.
- Stages already spawn plugins with `kk(['executor','run',…])` (`kk-workflow-stages.ts:491`; e.g. `:952` for dailynews-gen). The skill documents calling `kk executor run image-gen` directly as the programmatic path ("Do not use this skill for" section).
- The input source (the operator left it TBD) resolves to `2-plan/<date>_03_plan_plan.json`, a bare `Doc[]` with `title` and `metadata.brief` (verified on 20260924). The rendered show notes do not exist yet when the cover step runs; they are rendered after audio from this same file. Item 1 is the episode's lead, the story the script opens with.

### Requirements

- **R1 — Shipped presets.** Add `plugins/generations/image-gen/presets/formats/daily-news-cover.yaml` and `presets/styles/daily-news.yaml`.
  - The format has `job: cover`, `aspectRatio: '21:9'`, `width: 1344`, `height: 576` and `defaultStyle: daily-news`.
  - It declares exactly one variable, `subject`, with a fixed default scene.
  - Composition, palette, visual approach and atmosphere are literal template text, not variables, so no caller can override them.
  - The style has `modifiers`, a hex `palette`, and a `negative` that bans text, letters, numbers, logos, watermarks, flags, and real or recognizable people.
- **R2 — Cover brief.** The `cover` state's first action is an `agent.run` with `role: scribe`, `onError: continue`, a prompt of at most 1000 characters (ADR-115), `expectFile` and `allowAppend: false`.
  - It reads `plan.json` item 1 (`title` plus `metadata.brief`).
  - It writes `2-cover/<run_date>_07_cover-brief.json` as `{"subject": "<English, ≤240 chars>"}`: a concrete scene of objects, settings and symbols.
  - The subject contains no style, color, lighting or composition words, because the presets own those.
- **R3 — Deterministic render.** Add `kk stage daily-cover <work_dir> <run_date> <plugins_path> <provider> <model>`.
  - It writes the `--in` envelope `2-cover/<run_date>_07_cover_image-gen-in.json` as a one-doc `Doc[]` whose `metadata.imageGen` is `{job:'cover', format:'daily-news-cover', style:'daily-news', vars:{subject}, maxImages:1}`, plus `provider` / `model` when they are non-empty.
  - It then runs `kk executor run image-gen --in <env> --out 2-cover/content.json`.
  - No other var is passed. Plugin failure fails the stage, matching today's cover behavior.
- **R4 — Fallback.** If the brief is absent, is not a JSON object, lacks a string `subject`, or has a trimmed subject that is empty or longer than 240 chars, the stage omits `vars.subject` so the format default applies.
  - It logs `cover brief: fallback (<reason>)` to stderr, with reason one of `missing-brief | invalid-json | no-subject | subject-cap`.
  - It continues with the same format, style, provider and model.
- **R5 — Normalize by manifest.** `coverNormalizeBody` takes the source from `2-cover/content.json` `metadata.images[0].path` instead of the hard-coded `content-cover-01.*`.
  - It fails loud when the manifest or path is missing.
  - The png/jpg handling, the `<run_date>_07_cover_cover.png` output and stale-artifact cleanup are unchanged.
- **R6 — Wiring and docs.**
  - Add vars `cover_provider: "minimax"` and `cover_model: "image-01"`.
  - The `cover` state runs the brief step, then `kk stage daily-cover …`, then `daily-cover-normalize`.
  - Transitions and the `cover_enabled` guard are unchanged.
  - Update `docs/design/kk-daily-ai-voice.md` (cover row and diagram, which still say `wt-image-cover`) and add a `docs/04_DESIGN.md` row for the stage verb.
- Out of scope: reference-image anchoring, seeds, the aspect ratio, cover consumers, the `kk:image-authoring` skill, and the generic `cover` / `vibrant` presets.

### Acceptance Criteria

- [ ] AC1 — Shipped presets fix the daily cover's visual style (req: R1)
- [ ] AC2 — The cover subject comes from the day's lead plan item (req: R2)
- [ ] AC3 — The cover image is generated deterministically from the brief (req: R3, R5, R6)
- [ ] AC4 — A missing or invalid brief falls back to the default subject (req: R4)

Tests:
- AC1: `plugins/generations/image-gen/tests/presets.test.ts`.
- AC2: `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts`.
- AC3 and AC4: `apps/cli/tests/kk-workflow-stages.test.ts`, with the envelope asserted through the suite's `fakeKk` helper (e.g. the `daily-collect-facts` test).

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-25T06:52:20.319Z

- **Q: What is the input source: the title list or the show notes?** A: `2-plan/<date>_03_plan_plan.json` item 1. It is the show notes' source, and the show notes are rendered only after audio. Using one lead story gives the image a single focal subject; a collage of about 9 headlines produces clutter and makes every day look alike. Closed 2026-09-24. Revisit only if the operator wants a multi-story montage.
- **Q: Why not keep the `kk:image-authoring` skill?** A: The skill's job is deciding the style, provider and variables, and that per-run decision is the source of the drift. Following the F613 pattern, the agent supplies only the words (`subject`) and deterministic code owns everything else. Closed.
- **Q: Why an English subject?** A: The composed prompt is English, and mixed-language prompts weaken adherence. Titles never render in the image (the negative bans text). Closed.
- **Q: Why pin the provider in workflow vars rather than config?** A: Each provider has its own look, so the pin is part of the style contract. It stays a var because the right value depends on which credentials the machine has. Closed.
- **Q: Reference-image anchoring?** A: Deferred. `minimax` references are subject references (character likeness), not style references. Add it only if the presets alone still drift after about a week of runs. Closed.

### Design

**Frozen names**

- Presets: `plugins/generations/image-gen/presets/formats/daily-news-cover.yaml` and `presets/styles/daily-news.yaml`.
- Stage verb: `daily-cover`, handler `dailyCover(args)` in `plugins/kk/scripts/kk-workflow-stages.ts`, dispatched beside `daily-cover-normalize` (`:1700`).
- Files in `2-cover/`:
  - `<run_date>_07_cover-brief.json`, written by the agent;
  - `<run_date>_07_cover_image-gen-in.json`, the envelope;
  - `content.json`, the image-gen `--out`;
  - `content-daily-news-cover-01.<ext>`, the plugin's artifact;
  - `<run_date>_07_cover_cover.png`, the canonical output, unchanged.
- Constants in the stage: `COVER_FORMAT = 'daily-news-cover'`, `COVER_STYLE = 'daily-news'`, `COVER_SUBJECT_CAP = 240`.

**Starting preset content** (the operator tunes the look by editing these two files; nothing else changes):

```yaml
# formats/daily-news-cover.yaml
name: daily-news-cover
description: Daily AI news episode cover — fixed composition and palette; subject is the only per-run input
job: cover
aspectRatio: '21:9'
width: 1344
height: 576
defaultStyle: daily-news
keywords: [clean composition, high detail, consistent series look]
outputFilename: 'daily-news-cover.png'
variables:
    subject:
        description: One concrete visual scene for the day's lead story (objects, settings, symbols)
        default: a glowing network of connected nodes rising above a quiet city at dawn
template: |-
    Ultrawide editorial cover illustration for a daily AI news podcast episode.
    Scene: {{subject | a glowing network of connected nodes rising above a quiet city at dawn}}.
    Composition: one central focal subject, generous negative space in the upper third, uncluttered background.
    Color palette: deep navy background with electric blue and warm amber accents.
    Atmosphere: calm, intelligent, forward-looking.
```

```yaml
# styles/daily-news.yaml
name: daily-news
description: House style for the kk-daily-ai-voice cover series — flat editorial vector, navy/blue/amber
modifiers: flat editorial vector illustration, bold simple geometric shapes, subtle paper grain, soft even lighting, limited palette
palette:
    - { role: background, name: deep navy, hex: '#0B1F3A' }
    - { role: primary, name: electric blue, hex: '#2D7FF9' }
    - { role: accent, name: warm amber, hex: '#F5A623' }
negative: text, letters, words, numbers, captions, watermark, logo, brand marks, flags, real people, recognizable faces, photorealism, clutter
source: { kind: authored }
```

**Brief prompt skeleton** (must stay ≤1000 characters; a test asserts this):

```
Read ${vars.work_dir}/2-plan/${vars.run_date}_03_plan_plan.json — a JSON array of news docs; don't edit it.
Take item 1 only (its "title" and "metadata.brief") — the episode's lead story.
Write one concrete visual scene in English, ≤240 characters, that a viewer would connect to that story: objects, settings, symbols, metaphor.
No text, letters, numbers, logos, brand marks, flags, or recognizable real people. No style, color, lighting, or composition words — the preset owns those.
Output strictly valid JSON {"subject": "..."} to ${vars.work_dir}/2-cover/${vars.run_date}_07_cover-brief.json.
```

**`dailyCover` flow**

1. Read the brief and validate it in this order:
   1. The file is missing → `missing-brief`.
   2. `JSON.parse` fails, or the result is not a plain object → `invalid-json`.
   3. `subject` is not a string → `no-subject`.
   4. The trimmed subject is empty or longer than 240 characters → `subject-cap`.
2. Build `vars`: `{subject}` when the brief is valid, otherwise `{}` plus the stderr warning `cover brief: fallback (<reason>)`.
3. Write the envelope. It is a one-element `Doc[]`:
   - `id: 'daily-cover'`, `title: run_date`, `body: ''`;
   - `metadata.imageGen = {job, format, style, vars, maxImages: 1}`, with `provider` / `model` added only when the argument is non-empty.
4. Run `kk(['executor','run','image-gen','--in',env,'--out',join(workDir,'2-cover','content.json'),...pluginsArgs(pluginsPath)])`. A non-zero exit → `failWith`.
5. Wrap the stage in `timed(workDir, 'cover', …)`, as the other stages do.

**`coverNormalizeBody` change:** set `source = metadata.images[0].path` from `2-cover/content.json`. When the manifest is missing or unreadable, or `images[0].path` is not an existing file, fail with `'cover normalize: no image artifact in 2-cover/content.json'`. The png/jpg branches, the output name, and the cleanup of both `source` and any stale `content-*-01.{png,jpg}` stay as they are.

**Workflow `cover` state (in this order):**
1. `agent.run` (the brief step, `onError: continue`, `expectFile` = the brief path).
2. `shell`: `kk stage daily-cover "${vars.work_dir}" "${vars.run_date}" "${vars.plugins_path}" "${vars.cover_provider}" "${vars.cover_model}"`.
3. `shell`: `daily-cover-normalize`, unchanged.

**Invariants**
- The brief is the only model output in the cover path.
- Given the same brief, the envelope is byte-identical across runs.
- A bad brief never fails the run. A provider failure still fails it, as it does today.

**Anti-patterns**
- Passing `--style` or `--var` anywhere other than the envelope.
- Letting the agent pick the provider, palette or composition.
- Putting `title` or any Chinese text into the image prompt.
- Keeping the old skill invocation as a second path.

### Plan

- [ ] 1. Add the two presets (Design). In `plugins/generations/image-gen/tests/presets.test.ts:300`, extend the shipped-names list. Add a test that `daily-news-cover` × `daily-news` composes with a single `subject` var and with the negative present (R1).
- [ ] 2. Change `coverNormalizeBody` to read from the manifest. Update the two existing normalize tests (`apps/cli/tests/kk-workflow-stages.test.ts:599-620`) to write a `content.json` manifest, and add a missing-manifest failure case (R5).
- [ ] 3. Add the `dailyCover` stage and dispatch it. Tests use `fakeKk` to capture the `--in` envelope:
  - a valid brief puts `vars.subject` in the envelope, with format, style, provider, model and maxImages 1;
  - an empty provider or model is omitted;
  - each of the 4 fallback reasons gives `vars: {}` and the warning line;
  - a non-zero `kk` exit fails the stage (R3, R4).
- [ ] 4. Workflow YAML changes (R2, R6):
  - add the `cover_provider` / `cover_model` vars;
  - rewrite the `cover` state as brief `agent.run` → `daily-cover` → `daily-cover-normalize`.

  Update `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts`:
  - the cover assertions at `:113-124` (drop `--format cover` and the skill; assert the brief path, `onError: continue`, and the stage command);
  - keep the `['cover', 1000]` prompt cap at `:139`.
- [ ] 5. Docs:
  - `docs/design/kk-daily-ai-voice.md`: the cover row, the diagram node, the intermediate artifacts line `:60`, and the `wt-image-cover` references;
  - `docs/04_DESIGN.md`: the `kk stage daily-cover` row;
  - `docs/design/image-gen*` preset inventory, if it lists the shipped presets.
- [ ] 6. Run `bun run gate`.
- [ ] 7. Run one live dogfood (the operator runs it). With `cover_enabled: "true"` on the next daily run, check the look against the previous days' covers, then tune the two preset files if needed.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Feature: `docs/features/F614_daily-cover-news-driven-image-with-a-fixed-visual-style.md`
- Sibling pattern: F613 / 0161 / 0162 (the agent supplies the words, deterministic code owns the structure); `docs/design/daily-voice-script-plan.md`
- Code:
  - `plugins/kk/workflows/kk-daily-ai-voice.yaml:165` (cover state), `:441-475` (cover transitions)
  - `plugins/kk/scripts/kk-workflow-stages.ts:874-920` (normalize), `:491` (`kk` spawn), `:1700` (dispatch)
  - `plugins/generations/image-gen/src/presets.ts`, `src/paths.ts:22`, `src/index.ts:237`
  - `plugins/generations/image-gen/presets/formats/cover.yaml`
- Skill contract: `plugins/kk/skills/image-authoring/SKILL.md` (envelope schema, preference chain), `references/providers.md` (reference-image capability)
- Evidence: `.works/kk-daily-ai-voice/20260924/2-cover/{content.json,image-gen-in.json}` (local, gitignored)

### History

- 2026-09-25T06:52:24.693Z backlog → todo (system)

