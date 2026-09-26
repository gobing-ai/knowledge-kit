---
schema_version: 1
name: Create source-grounded XHS card series with image-gen and publishable Content
status: done
template: feature-impl
created_at: 2026-09-25T18:16:35.417Z
updated_at: "2026-09-26T03:56:02.419Z"
feature_id: E8
priority: P2
estimate_hours: 12

dependencies: ["0167"]
---

## 0168. Create source-grounded XHS card series with image-gen and publishable Content

### Background

Feature E8 scenarios R1, R2, R3, R7. `image-gen` already owns provider calls and format/style resolution (`plugins/generations/image-gen/src/index.ts`, `src/presets.ts`); `kk:image-authoring` owns preview and spend controls. The vendored Baoyu skill supplies card-analysis and layout guidance, not a new backend. The output must feed the existing XHS publisher in card order.

Rubric: parent E2 D2 L2 C1 R2 = 9 → decompose; this authoring slice E2 D1 L1 C1 R1 = 6, cohesive across the skill, presets, and its card artifact.

### Requirements

- [x] R1. From supplied text, plan N ordered cards: card 01 `role: cover`, then `content` cards in source order, then an optional `closing` card. Each card records `index`, `role`, `sourcePoint` (verbatim heading or sentence from the source), `copy` (short Chinese on-image text), `layout`, and `subject` (visual scene). `1 ≤ N ≤ min(10, resolved max-images cap)`. A larger `--count` is refused and the refusal names `KK_IMAGE_MAX_IMAGES` / `image.max_images`. The source file is never written.
- [x] R2. For each card, write `<out>/cards/NN.in.json`: the `image-gen` envelope with `job: free`, `format: xhs-card`, `style`, `vars`, `provider`, `model`, `maxImages: 1`, and `outputStem: card-NN`, plus `referenceImages: [<cover path>]` for NN ≥ 02 only when `references/providers.md` of `kk:image-authoring` marks the provider/model reference-capable. Run each envelope once with `KK_IMAGE_DRY_RUN=1` and save its `Content.body` as `<out>/cards/NN.prompt.txt`. That is the exact composed prompt, and it must equal `ImageArtifact.prompt` after rendering. Show **one** spend preview for the series (provider, model, style, N, the cover prompt, a per-card copy list) and follow the `kk:image-authoring` Confirmation policy once. Then render card 01, then 02..N, sequentially via `kk executor run image-gen --in cards/NN.in.json --out cards/NN.json`.
- [x] R3. Write `<out>/content.json`, a valid `Content` with: `title` (XHS title; authoring target ≤ 20 chars), `body` (Chinese note with hashtags; target ≤ 1000 chars), `format: 'text'`, `metadata.images` = each card's `cards/NN.json` `metadata.images[0]` in index order, and `metadata.publishStatus: 'draft'`. Write `<out>/cards.json` per the design (`{ source, cards: [{ index, role, sourcePoint, copy, layout, promptPath, imagePath, status }] }`, `status ∈ pending|rendered|failed`). Packaging refuses while any card is not `rendered` or its prompt/image file is missing.
- [x] R7. On the first failed card, stop spending, mark it `failed` and later cards `pending`, and report the retry. Re-running with the same `--out` reuses the existing `cards.json` and `cards/NN.in.json` (no replanning) and renders only the cards without an existing image file. Replanning requires a new `--out`.
- [x] Handoff: the skill never spawns `xhs-pub` directly. After packaging, it hands `content.json` to `kk:publish` channel `xhs`, which owns the draft/live confirmation. `--live` is passed through as the operator's live request.
- [x] Presets: ship `presets/formats/xhs-card.yaml` (`job: free`, `aspectRatio: '3:4'`, 1080×1440, `defaultStyle: xhs-knowledge`, variables `role`, `layout`, `headline`, `points`, `subject`, `language` defaulting to `简体中文`) and `presets/styles/xhs-knowledge.yaml`. Adapt Baoyu's layout, typography, and consistency guidance with attribution, and import none of its backend selection, batch/parallel generation, or `EXTEND.md` chain.

### Acceptance Criteria

- [x] AC1 — Source content becomes an ordered XHS card plan (req: R1)
- [x] AC2 — Existing image generator renders the planned card series (req: R2)
- [x] AC3 — Card series becomes a publishable XHS payload (req: R3)
- [x] AC4 — Rendering failure preserves the successful card prompts (req: R7)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-25T18:30:33.065Z

- **Series budget (closed 2026-09-25).** `image-gen` enforces its cap per invocation, so N calls with `maxImages: 1` would each pass a cap of 4 and bypass it. The skill therefore enforces the resolved `KK_IMAGE_MAX_IMAGES` / `image.max_images` (default 4) against the series total N before any spend. Longer series need the operator to raise the cap explicitly. Per-call `maxImages: 1` stays as the backstop.
- **"Exact saved prompt" = dry-run body (closed).** The skill cannot compose the prompt itself: `image-gen` merges the format template, style, and keywords. `KK_IMAGE_DRY_RUN=1` returns the real composed string in `Content.body` (the same mechanism as the `kk:image-authoring` preview). The retry input is `NN.in.json`, not the prompt text.
- **Isolation per card (closed).** One `--out` per card (`cards/NN.json`, stem `card-NN` → `cards/card-NN-xhs-card-01.<ext>`) means `image-gen`'s failure cleanup deletes only that card's files, which gives R7 with no plugin change.
- **Cover as reference (closed).** Dry runs do not call `provider.validate`, so the reference decision is the skill's, made from `kk:image-authoring/references/providers.md`. If that choice is wrong, the paid run of card 02 fails in `validate` before spending, which R7 handles. Without reference support, the preview discloses the weaker consistency path.
- **Publish handoff via `kk:publish` (closed).** This avoids a second live-confirmation implementation. Content shape is frozen by `docs/design/xhs-image-cards.md`, so this task can be built and dry-run before 0167 lands. Only the end-to-end draft dogfood waits for 0167.
- **Testing split (closed).** The skill is model-executed, and no TS harness is built for it. Deterministic coverage is the preset unit tests. Skill behavior is verified by a dry-run dogfood (no spend) plus one operator-approved paid render, both recorded in Testing.
- **Text fidelity (out of scope).** A misspelled card is re-rendered after editing `NN.in.json` `vars` and deleting its image. Bitmap repair is not attempted.

### Design

Approach: add one skill, `plugins/kk/skills/xhs-images/SKILL.md` (`kk:xhs-images`), plus two shipped presets. No plugin code changes.

- **Surface:** `kk:xhs-images <source-file> [--style <preset>] [--count <1..10>] [--provider <name>] [--model <id>] [--out <dir>] [--dry-run] [--live]`. `--out` defaults to a temp dir under the works dir. `--dry-run` stops after the series preview. Preferences follow the `kk:image-authoring` chain (arguments > env > `$KK_CONFIG` > defaults); no `EXTEND.md`.
- **Sequence:** resolve preferences and the cap → plan cards (R1) → write `cards.json` (all `pending`) and every `NN.in.json` → dry-run each and save `NN.prompt.txt` → one series preview and one confirmation → render 01, then 02..N (R2) → on failure stop (R7) → package `content.json` (R3) → hand off to `kk:publish xhs` (draft unless `--live`).
- **Out layout:** `<out>/cards.json`, `<out>/content.json`, `<out>/cards/NN.{in.json,prompt.txt,dry.json,json}`, `<out>/cards/card-NN-xhs-card-01.<ext>`.
- **Baoyu use:** take the analysis framework (hook, swipe flow), layout vocabulary, and the image-1 anchor rule from `vendors/baoyu-skills/skills/baoyu-xhs-images/` as condensed skill guidance under `references/`, with MIT attribution. Drop backend selection, batch size, watermark, and `EXTEND.md`.

Rejected: a new XHS generator plugin, a provider adapter, a batch mode inside `image-gen`, or a direct `xhs-pub` spawn from this skill.

Invariant: prompts are saved before paid calls; the source text is not mutated; a failed card does not delete successful card files; a rerun on the same `--out` never re-renders an existing image. Design detail: `docs/design/xhs-image-cards.md`.

### Plan

1. Presets: add `xhs-card.yaml` and `xhs-knowledge.yaml`. Update `plugins/generations/image-gen/tests/presets.test.ts`: the shipped format list (lines ~137, ~303) gains `xhs-card`, and the style count (line ~264) goes 11 → 12. Add one composition test: `xhs-card × xhs-knowledge` with `vars` → the prompt contains the headline and the style modifiers, and the format resolves `aspectRatio: '3:4'`.
2. Scaffold the skill with `superskill skill --help` → add; then author `SKILL.md` + `references/` (card analysis, layouts, adapted from Baoyu with attribution). Validate/evaluate with `superskill skill`.
3. Dry-run dogfood (no spend): a Chinese article with a title, three points, and a takeaway → check `cards.json` order/roles/sourcePoints, `NN.prompt.txt` present, and the preview shown. Refusal check: `--count` above the cap names the switch.
4. Paid dogfood (operator-approved): render the same plan. Check `NN.prompt.txt` == `ImageArtifact.prompt`, `content.json` parses with `ContentSchema` and has its images in index order, and Chinese text on the cards is legible. Simulate a failure (delete one card image, mark it `failed`) and rerun on the same `--out` → only that card renders.
5. Doc sync (T3): `docs/04_DESIGN.md` (skill surface + presets); `docs/design/xhs-image-cards.md` status → shipped. `bun run gate`. After 0167 is done, one `kk:publish xhs` draft handoff from this `content.json` (operator-owned) is recorded in Testing.

### Solution

| Concern | Where |
| ------- | ----- |
| Skill surface: plan → envelopes → dry-run+single confirmation → sequential render → package → handoff | `plugins/kk/skills/xhs-images/SKILL.md:23-96` |
| Layout catalog, typography + consistency rules (baoyu attribution) | `plugins/kk/skills/xhs-images/references/card-layouts.md:1-42` |
| `xhs-card` format preset (free, 3:4 1080×1440, vars role/layout/headline/points/subject/language) | `plugins/generations/image-gen/presets/formats/xhs-card.yaml:1-53` |
| `xhs-knowledge` style preset (notion-like card aesthetic, modifiers) | `plugins/generations/image-gen/presets/styles/xhs-knowledge.yaml:1-10` |
| Inventory + geometry + composition tests (5 formats / 12 styles) | `plugins/generations/image-gen/tests/presets.test.ts:264-352` |
| Doc sync: design status → shipped | `docs/04_DESIGN.md:48`, `docs/design/xhs-image-cards.md:1,31` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 — Source content becomes an ordered XHS card plan | MET | .spur/run/runall-e8-5a30-0168-paid-dogfood/cards.json: 01 cover, 02-03 content, 04 closing, each with index/role/sourcePoint (verbatim)/copy/layout; source.md mtime unchanged |
| R2 — Existing image generator renders the planned card series | MET | paid-dogfood cards/: 4 jpgs 57.6/85.9/119.3/93.4 KB + NN.json each (minimax image-01); prompt.txt == Content.body == ImageArtifact.prompt for 01-04; 02-04 carry referenceImages:[cover] |
| R3 — Card series becomes a publishable XHS payload | MET | ContentSchema.safeParse(content.json) -> true; title 8 chars, format text, body 86 chars, metadata.publishStatus draft, metadata.images 4 in index order == each cards.json imagePath |
| R7 — Rendering failure preserves the successful card prompts | MET | skill-dogfood: cards/01.prompt.txt (943 chars) preserved; no cards/02.json; card 03 never attempted; cards.json = 01 rendered / 02 failed / 03 pending |
| 0168 R1 cap clause — N ≤ min(10, image.max_images), refusal names the cap | MET | skill-dogfood/TRANSCRIPT.md §1: plan N=4 vs cap 3 -> REFUSED naming min(10, image.max_images/KK_IMAGE_MAX_IMAGES); 0 envelopes, no provider call; plugin half plugins/generations/image-gen/src/index.ts:227 + tests/image-gen.test.ts:172-208 |
| 0168 R2 sequential render + single series confirmation | MET | paid-dogfood: 02-04 referenceImages point at the rendered card-01 jpg, so order is provable; one series approval then renders 16:49-16:51 |
| 0168 R7 resume clause — same --out reuses cards.json + NN.in.json, renders only cards without an image | MET | .spur/run/runall-e8-5a30-0168-skill-dogfood/RESUME-TRANSCRIPT.txt: one card image deleted -> resume reused the plan (no replanning) and rendered ONLY card 03 (01/02/04 SKIP image exists; 03 RENDER exit=0) |
| Handoff — never spawns xhs-pub; hands content.json to kk:publish channel xhs | MET | plugins/kk/skills/xhs-images/SKILL.md:9,29,68-70; no xhs-pub invocation under the skill |
| Presets — xhs-card + xhs-knowledge shipped with attribution, Baoyu backend/batch/EXTEND not imported | MET | presets/formats/xhs-card.yaml (job free, 3:4, 1080x1440, defaultStyle xhs-knowledge, vars role/layout/headline/points/subject/language=简体中文); presets/styles/xhs-knowledge.yaml; MIT notice in both + references/card-layouts.md |
| Tests — preset inventory/geometry/composition + image-gen cap refusal | MET | bun test plugins/generations/image-gen/tests/{presets,image-gen}.test.ts -> 58 pass / 0 fail; presets.test.ts:137,303,316,322-333,341-352; image-gen.test.ts:172-208 |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Source content becomes an ordered XHS card plan (req: R1) | MET | command | python3 -c "json.load(cards.json)" -> [(01,cover),(02,content),(03,content),(04,closing)] with per-card sourcePoint/layout; cap refusal: KK_IMAGE_MAX_IMAGES=3 bash run.sh -> "REFUSED ... 0 envelopes" |
| AC2 — Existing image generator renders the planned card series (req: R2) | MET | test | 4 jpgs + 4 NN.json (minimax image-01); prompt equality for 01-04; one series approval |
| AC3 — Card series becomes a publishable XHS payload (req: R3) | MET | command | ContentSchema.safeParse(content.json) -> true; 4 images in index order; publishStatus draft |
| AC4 — Rendering failure preserves the successful card prompts (req: R7) | MET | command | cards/01.prompt.txt preserved (943 chars); no cards/02.json; 03 pending; resume transcript renders only the missing card |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Fresh-session reviewer (sp-super-reviewer) on `babcf9b5`: **VERDICT OK** — full artifact `.spur/run/runall-e8-5a30-review-answer.txt`. Priority table:

| Priority | Finding | Disposition |
| -------- | ------- | ----------- |
| P2 | Task-record state open at review time (record/done pending) | Closes via record/done flow (this transition) |
| P3 | Spend preview omitted weaker-consistency disclosure (SKILL.md vs design flow item 2) | Fixed in `0dba7935` (consistency path disclosed) |
| P3 | Provider/model resolution unstated vs image-authoring preference chain | Fixed in `0dba7935` (arguments > env > $KK_CONFIG > defaults) |
| P3 | Resume check did not pin provider-decided artifact extension — double-spend risk (paths.ts:22-30) | Fixed in `0dba7935` (recorded path or `cards/card-NN-*` glob) |
| P4 | Dead `outputFilename` `.png` default (xhs-card.yaml:19) | Record-and-move-on |
| P4 | Dangling "Bullet points" header when points empty (xhs-card.yaml:49-50) | Record-and-move-on |
| P4 | Attribution cites gitignored `vendors/` path | Record-and-move-on (repo-conventional; MIT © Jim Liu notice preserved in all four shipped files) |

Traceability: R1–R3/R7 + handoff + presets MET; targeted presets tests 24 pass / 0 fail.

### References

- Feature: `docs/features/E8_xiaohongshu-image-card-authoring-and-publishing.md` (R1–R3, R7)
- Design: `docs/design/xhs-image-cards.md`; ADR-024
- Code: `plugins/generations/image-gen/src/index.ts` (dry run, per-call cap, failure cleanup), `src/job.ts` (`ImageJobSpecSchema`, `ImageArtifact`), `src/paths.ts` (`artifactPath`), `src/presets.ts` (preset schemas), `tests/presets.test.ts`
- Skills: `plugins/kk/skills/image-authoring/SKILL.md` (preference chain, Confirmation policy) + `references/providers.md`; `plugins/kk/skills/publish/SKILL.md`
- Vendor: `vendors/baoyu-skills/skills/baoyu-xhs-images/` (MIT © Jim Liu)
- Prerequisite: task 0167 (only for the end-to-end draft handoff)

### History

- 2026-09-25T23:21:06.742Z todo → wip (system)
- 2026-09-25T23:53:59.585Z wip → done (system)

