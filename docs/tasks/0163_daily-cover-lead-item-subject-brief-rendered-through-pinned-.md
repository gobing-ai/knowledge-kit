---
schema_version: 1
name: "Daily cover: lead-item subject brief rendered through pinned daily-news presets"
status: done
template: feature-impl
created_at: 2026-09-25T06:50:49.293Z
updated_at: "2026-09-25T08:45:41.557Z"
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

- [x] AC1 — Shipped presets fix the daily cover's visual style (req: R1)
- [x] AC2 — The cover subject comes from the day's lead plan item (req: R2)
- [x] AC3 — The cover image is generated deterministically from the brief (req: R3, R5, R6)
- [x] AC4 — A missing or invalid brief falls back to the default subject (req: R4)

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

- [x] 1. Add the two presets (Design). In `plugins/generations/image-gen/tests/presets.test.ts:300`, extend the shipped-names list. Add a test that `daily-news-cover` × `daily-news` composes with a single `subject` var and with the negative present (R1).
- [x] 2. Change `coverNormalizeBody` to read from the manifest. Update the two existing normalize tests (`apps/cli/tests/kk-workflow-stages.test.ts:599-620`) to write a `content.json` manifest, and add a missing-manifest failure case (R5).
- [x] 3. Add the `dailyCover` stage and dispatch it. Tests use `fakeKk` to capture the `--in` envelope:
  - a valid brief puts `vars.subject` in the envelope, with format, style, provider, model and maxImages 1;
  - an empty provider or model is omitted;
  - each of the 4 fallback reasons gives `vars: {}` and the warning line;
  - a non-zero `kk` exit fails the stage (R3, R4).
- [x] 4. Workflow YAML changes (R2, R6):
  - add the `cover_provider` / `cover_model` vars;
  - rewrite the `cover` state as brief `agent.run` → `daily-cover` → `daily-cover-normalize`.

  Update `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts`:
  - the cover assertions at `:113-124` (drop `--format cover` and the skill; assert the brief path, `onError: continue`, and the stage command);
  - keep the `['cover', 1000]` prompt cap at `:139`.
- [x] 5. Docs:
  - `docs/design/kk-daily-ai-voice.md`: the cover row, the diagram node, the intermediate artifacts line `:60`, and the `wt-image-cover` references;
  - `docs/04_DESIGN.md`: the `kk stage daily-cover` row;
  - `docs/design/image-gen*` preset inventory, if it lists the shipped presets.
- [x] 6. Run `bun run gate`.
- 7. Post-merge follow-up (operator-owned, outside this pipeline): run one live dogfood (the operator runs it). With `cover_enabled: "true"` on the next daily run, check the look against the previous days' covers, then tune the two preset files if needed.

### Solution

Implemented R1–R6.

- **R1 (presets):** new shipped image-gen presets `plugins/generations/image-gen/presets/formats/daily-news-cover.yaml:1` (21:9 1344×576, `job: cover`, single `subject` variable with the fixed-default fallback scene) and `plugins/generations/image-gen/presets/styles/daily-news.yaml:1` (flat editorial vector modifiers, navy/blue/amber palette, text/logo/flag/real-people negative). Composition, palette and visual approach live in the files; callers cannot drift them.
- **R2 (workflow):** `cover` state rewritten in `plugins/kk/workflows/kk-daily-ai-voice.yaml:170` — a scribe `agent.run` (onError: continue, prompt ≤1000 chars, 240-char subject cap) reads plan item 1 from `${run_date}_03_plan_plan.json` and writes `2-cover/${run_date}_07_cover-brief.json` (`{"subject": "..."}`); then `kk stage daily-cover` with the new pinned vars `cover_provider: "minimax"` / `cover_model: "image-01"`; `daily-cover-normalize` unchanged. The old `kk:image-authoring` invocation is gone (single path invariant).
- **R3/R4 (stage):** `dailyCover` (`plugins/kk/scripts/kk-workflow-stages.ts:909`) validates the brief via `coverBrief` (`plugins/kk/scripts/kk-workflow-stages.ts:884`) — `missing-brief` / `invalid-json` / `no-subject` / `subject-cap` — logs `cover brief: fallback (<reason>)` to stderr, and writes the pinned image-gen envelope `2-cover/${run_date}_07_cover_image-gen-in.json` (`job: cover`, `format: daily-news-cover`, `style: daily-news`, `vars.subject` or empty vars, `maxImages: 1`, provider/model only when set) before `kk executor run image-gen --out 2-cover/content.json`. Plugin failure still fails the stage.
- **R5 (normalize):** `coverNormalizeBody` (`plugins/kk/scripts/kk-workflow-stages.ts:954`) now reads the artifact path from the `2-cover/content.json` manifest (`metadata.images[0].path`) instead of hard-coded `content-cover-01.{png,jpg}`; fails loud `cover normalize: no image artifact in 2-cover/content.json` when the manifest or recorded path is missing; png→rename, jpg→sips transcode unchanged; legacy names cleaned as stale. `${run_date}_07_cover_cover.png` output name preserved.
- **R6 (tests/docs):** presets inventory + composition tests (`plugins/generations/image-gen/tests/presets.test.ts`); 4 new stage tests in `apps/cli/tests/kk-workflow-stages.test.ts` (envelope pins, provider/model/plugins-path forwarding, 6 fallback rows, plugin-failure); normalize tests moved to the manifest contract + missing-manifest failure; workflow tests assert the new cover state, 23 `kk stage daily-` call sites, and the pinned vars (`apps/cli/tests/kk-daily-ai-voice-workflow.test.ts`); docs updated (`docs/design/kk-daily-ai-voice.md`, `docs/04_DESIGN.md` daily-cover row + delegated-action count).

Verification: `bun run lint` clean; image-gen 296 pass / apps/cli 382 pass; `spur workflow validate plugins/kk/workflows/kk-daily-ai-voice.yaml` valid.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `plugins/generations/image-gen/presets/formats/daily-news-cover.yaml:1-19` (job cover, 21:9 1344×576, `defaultStyle: daily-news`, single `subject` var with fixed default; composition/palette/atmosphere literal template text) + `presets/styles/daily-news.yaml:1-9` (modifiers, hex palette #0B1F3A/#2D7FF9/#F5A623, negative bans text/letters/numbers/logo/watermark/flags/real people); tests `plugins/generations/image-gen/tests/presets.test.ts:320-368` (geometry/vars pins, composition with single var, negative coverage, default-scene fallback) |
| R2 | MET | `plugins/kk/workflows/kk-daily-ai-voice.yaml:170-197` — first cover action is `agent.run` (`role: scribe`, `onError: continue`, `expectFile` brief path, `allowAppend: false`); prompt reads `2-plan/${run_date}_03_plan_plan.json` item 1 (title + metadata.brief), English ≤240 chars, no style/color/lighting/composition words, writes `2-cover/${run_date}_07_cover-brief.json` as `{"subject": "..."}`; prompt measured 598 chars (≤1000, ADR-115); asserted in `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts:118-151` and the `['cover', 1000]` cap row |
| R3 | MET | `plugins/kk/scripts/kk-workflow-stages.ts:909-936` `dailyCover` writes one-doc `Doc[]` envelope (`2-cover/${run_date}_07_cover_image-gen-in.json`) with `metadata.imageGen {job:'cover', format:'daily-news-cover', style:'daily-news', vars:{subject}, maxImages:1}` + provider/model only when non-empty, then `kk executor run image-gen --in … --out 2-cover/content.json`; exact envelope+args asserted via fake image-gen in `apps/cli/tests/kk-workflow-stages.test.ts:905-1013` (incl. empty provider/model omitted, plugins-path forwarding); plugin failure fails stage (exit-3 test `:983-990` region) |
| R4 | MET | `plugins/kk/scripts/kk-workflow-stages.ts:884-901` `coverBrief` validates in order missing-brief → invalid-json → no-subject → subject-cap; stage omits `vars.subject` and logs `cover brief: fallback (<reason>)` to stderr (`kk-workflow-stages.ts:917-921`); 6 fallback rows (missing file, unparsable, non-object, no subject, empty, 241-char) assert `vars: {}` + warning + unchanged format/style/provider/model in `apps/cli/tests/kk-workflow-stages.test.ts:948-982` |
| R5 | MET | `plugins/kk/scripts/kk-workflow-stages.ts:954-992` `coverNormalizeBody` reads `metadata.images[0].path` from `2-cover/content.json`, fails loud `cover normalize: no image artifact in 2-cover/content.json` when manifest/path missing; png rename + jpg sips transcode + `${run_date}_07_cover_cover.png` output unchanged; legacy `content-cover-01.{png,jpg}` + source cleaned as stale; tests `apps/cli/tests/kk-workflow-stages.test.ts:606-647` (manifest png rename, real-JPEG sips transcode, missing/empty-manifest failure, sips-absent failure) |
| R6 | MET | `plugins/kk/workflows/kk-daily-ai-voice.yaml:39-40` (`cover_provider: "minimax"`, `cover_model: "image-01"`), cover state ordered brief → `kk stage daily-cover` → `daily-cover-normalize` (`:170-197`); transitions and `cover_enabled` guard untouched by diff (`git diff ab9c09ca..e46a5596` touches only vars + cover state); docs `docs/design/kk-daily-voice.md:5,20,23,60` (wt-image-cover removed, diagram + artifacts updated) and `docs/04_DESIGN.md:649,679` (daily-cover row, 23 delegated actions); asserted in `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts:118-151,160,215` |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | `plugins/generations/image-gen/tests/presets.test.ts:320-368` pins geometry, single-var, palette hexes and content-banning negative; inventory tests (`:137, :264, :290-316`) assert shipped 4 formats / 11 styles including `daily-news-cover` / `daily-news` |
| AC2 | MET | test | `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts:118-151` asserts the brief step reads `2-plan/${run_date}_03_plan_plan.json` item 1, ≤240-char English JSON subject, `onError: continue` + `expectFile`; prompt in `plugins/kk/workflows/kk-daily-ai-voice.yaml:180-186` |
| AC3 | MET | test | `apps/cli/tests/kk-workflow-stages.test.ts:905-946` asserts the byte-pinned envelope (format/style/provider/model/maxImages 1, subject only var) and frozen executor invocation; `:606-647` asserts manifest-driven normalize; workflow wiring at `plugins/kk/workflows/kk-daily-ai-voice.yaml:188-197` |
| AC4 | MET | test | `apps/cli/tests/kk-workflow-stages.test.ts:948-982` — all 6 R4 fallback rows yield `vars: {}`, the `cover brief: fallback (<reason>)` stderr line, and stage exit 0 with pinned format/style/provider/model |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |
| P4 | residual-sweep | — | blocking=0 deferrable=0 advisory=0 housekeeping=0 |
| P4 | proof-input-digest | — | sha256:448292472a144fc9889c0628c5ce2e323bfdd1f77a7b654a361eac1158391c4b |

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
- 2026-09-25T08:01:49.799Z todo → wip (system)
- 2026-09-25T08:45:18.090Z wip → testing (system)
- 2026-09-25T08:45:41.557Z testing → done (system)

