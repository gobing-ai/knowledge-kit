---
schema_version: 1
name: Wire the text-free illustration contract into daily-xhs-render and xhs-card
status: todo
template: feature-impl
created_at: 2026-09-29T02:28:56.271Z
updated_at: "2026-09-30T05:52:44.530Z"
feature_id: F616

priority: P2
---

## 0181. Wire the text-free illustration contract into daily-xhs-render and xhs-card

### Background

Second half of F616. Task 0180 makes image-gen typeset card copy for any format with a `compose` block and makes the
`xhs-card` template text-free. This task **enforces** that contract where every caller passes through, and moves both
callers and their docs onto it:

- **Guard:** nothing stops a future template, style, `spec.extra` or `vars.subject` from putting Chinese copy back
  into the illustration prompt. For example, the `xhs-knowledge` style today says "large legible Chinese typography"
  (`presets/styles/xhs-knowledge.yaml` `modifiers`), which invites the model to draw text.
- **Daily caller:** `dailyXhsRender` (`plugins/kk/scripts/kk-workflow-stages.ts:1096-1176`) still passes
  `language: '简体中文'` and records only the card path. Its manifest and prompt trail must describe the new
  two-artifact shape without breaking resume.
- **Skill caller:** `plugins/kk/skills/xhs-images/SKILL.md` and `references/card-layouts.md` still say "the model
  renders text", and step 2 passes `language`.
- **Docs:** `docs/design/xhs-image-cards.md` still says "Generated Chinese text can be misspelled … bitmap text repair
  is outside scope".

Corrections to the original draft: its R4 named `cards/NN.json` / `cards/NN.prompt.txt`, but the daily stage writes
`25-xhs/cards/card-NN.{in.json,json,prompt.txt}`. The skill's own `--out` tree is the one that uses `cards/NN.*`. Its
single AC also cited a non-existent `R5`. Both are fixed below.

### Requirements

- [ ] R1. For every format with a `compose` block, image-gen refuses before any spend (dry run included) when the fully composed illustration prompt contains a Han character (`/\p{Script=Han}/u`), or the headline, or any point (exact substring, trimmed, length ≥ 2). The error names the offending source: template, style, `extra`, or a named var. The `xhs-knowledge` style is rewritten to be text-free and gains `negative: text, letters, numbers, Chinese characters, captions, watermark, logo`. The `xhs-card` template states `no text, no letters, no numerals` explicitly.
- [ ] R2. A composed card stays legible without the model illustration. The composer's no-illustration output (0180's pre-spend compose) meets the same canvas, safe-area and glyph-floor assertions as an illustrated card. This makes the illustration decoration, not a legibility dependency.
- [ ] R3. Both callers use the composing path. `dailyXhsRender` stops sending `language` and keeps `headline`/`points` in `vars`, which the composer consumes. `kk:xhs-images` step 2 drops `language`, and its Checks/limits text describes typeset copy, with no "model renders text" wording left. No caller keeps a code path or instruction that puts card copy into a prompt.
- [ ] R4. Daily-stage artifacts keep their order and resume semantics. `25-xhs/cards/card-NN.in.json`, `card-NN.json` and `card-NN.prompt.txt` stay in place. `prompt.txt` now holds the text-free illustration prompt. `cards.json` entries gain `illustrationPath`, and `Content.metadata.images[]` is still the composed cards in card order. A card whose recorded composed artifact is on disk is reused with no re-spend. A resume renders only missing cards.

### Acceptance Criteria

- [ ] AC1 — The illustration layer stays text-free (req: R1, R2)
- [ ] AC2 — Card copy is set with real type, not generated pixels (req: R3)
- [ ] AC3 — Composition is deterministic and resumable (req: R4)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-30T05:50:35.886Z

- **Guard lives in image-gen, not in callers (closed):** one check at the shared seam covers the daily stage, the skill,
  and a manual `kk executor run image-gen`. Per-caller checks would leave the manual path open.
- **Guard scope is `compose` formats only (closed):** non-compose formats (cover, illustration) may legitimately carry
  CJK in prompts. The daily cover already keeps its own subject brief text-free by task 0163 policy, and that stays
  out of scope.
- **Han-character rule, not a word list (closed):** `\p{Script=Han}` catches any Chinese that leaks in. The
  headline/points substring check also catches Latin-script copy. Numerals in `subject` are allowed. The instruction
  "no numerals" governs what the model draws, not what the prompt may mention.
- **Legacy resume (closed, not handled):** a daily run started before this change and resumed after it would reuse its
  old text-in-image cards. Daily runs are dated and not resumed across releases, so no migration is written.
- **"Illustration absent" is proven, not a new mode (closed):** 0180's pre-spend compose already renders the card with
  no illustration on every run. This task asserts that output is legible (R2). A zero-spend "text-only card" spec
  switch is deferred until an operator asks for it.

### Design

**Guard** (`plugins/generations/image-gen/src/compose/card.ts` next to 0180's `assertCoverage`):
`assertTextFreePrompt(prompt, { headline, points }, sources)`. It is called in `processGeneratorIO` immediately after
`composePrompts` for a `compose` format, before 0180's pre-spend compose. To name the source, it re-checks each
contributing segment (template body, style modifiers/negative, `spec.extra`, each var value except
headline/points/index) and reports the first hit. If no single segment hits, it falls back to `prompt`.

**Presets:**

- `presets/styles/xhs-knowledge.yaml`: replace "large legible Chinese typography" and any text-hierarchy wording with
  layout-neutral terms. Add `negative`.
- `presets/formats/xhs-card.yaml`: `keywords` drop "large-font title (Chinese-friendly)" and "crisp legible text
  hierarchy". The template states "pure illustration, no text, no letters, no numerals, no captions" and leaves the top
  band's composition free of text zones.

**Daily stage** (`plugins/kk/scripts/kk-workflow-stages.ts`):

- `:1119-1128` envelope `vars`: remove `language`.
- `:1158-1167` card entry: add `illustrationPath: resolve(artifact.illustration.path)` when present. The resume
  check at `:1111` is unchanged (`firstArtifact(...).path` = composed card on disk).
- `:1131` comment and the `dailyXhsRender` doc comment: describe "illustration generated, copy typeset".

**Skill** (`plugins/kk/skills/xhs-images/SKILL.md`): step 2 vars list drops `language`. The Checks/limits bullet "the
model renders text …" becomes "copy is typeset by image-gen's composer. Keep the headline ≤ 12 chars and 2-4 points
so the card fits at the glyph floors; overflow fails loud before spend." Step 3's spend preview lists per-card copy
as typeset text. `references/card-layouts.md` typography guidance is reworded so it no longer applies to the image
model.

**Docs:** `docs/design/xhs-image-cards.md`: the last bullet of "Checks and limits" is replaced. The "Surface" section
records `cards.json.illustrationPath` and adds the text-free rule. `docs/04_DESIGN.md`: the guard error surface.
`docs/design/kk-daily-ai-voice.md` §7: one line on typeset copy.

### Plan

Failure modes are enumerated first, before code:

1. `vars.subject` containing Chinese → pre-spend refusal naming `vars.subject`, with no provider call (R1).
2. `spec.extra` repeating the headline in Latin script → refusal naming `extra` (R1).
3. A custom style (via `KK_IMAGE_PRESET_PATH`) whose modifiers contain Han → refusal naming the style (R1).
4. The shipped `xhs-card` × `xhs-knowledge` with a real Chinese plan → passes the guard, and the prompt has no Han
   character (R1). Invert `tests/presets.test.ts:341` accordingly.
5. Non-compose format (`cover`) with a CJK subject → not refused (guard scope).
6. The E2E no-illustration card (`.spur/run/0180/card-without-illustration.png`) meets the canvas, safe-area and floor
   assertions. Reuse the 0180 E2E test with an explicit R2 assertion (R2).
7. Daily stage: the envelope has no `language`. `cards.json` entries carry `illustrationPath`. `metadata.images` are
   the composed `.png` cards in order. A second run with every `card-NN.json` artifact present spawns zero image-gen
   calls. Deleting card 02's image re-renders only card 02 (R4). Extend
   `apps/cli/tests/kk-workflow-stages.test.ts:829-975` (the fake image-gen emits `illustration` too).
8. Grep gate: `rg -n "model renders text|language 简体中文" plugins/kk/skills/xhs-images` returns nothing (R3).

Steps:

- [ ] Write tests 1-7 and confirm they fail.
- [ ] `assertTextFreePrompt` and its call site in `src/index.ts`.
- [ ] Rewrite the `xhs-knowledge.yaml` / `xhs-card.yaml` wording.
- [ ] Daily stage edits (`kk-workflow-stages.ts:1096-1176`).
- [ ] Skill and `card-layouts.md` edits; run check 8.
- [ ] Docs, same commit (T3): `docs/design/xhs-image-cards.md`, `docs/04_DESIGN.md`, `docs/design/kk-daily-ai-voice.md`
      §7.
- [ ] `bun run gate`. Then an operator-approved paid dogfood (required before F616 is `done`, per the design doc's
      "one representative Chinese article should be rendered and inspected"): `spur workflow run` the daily XHS
      states, or the skill on one article with `--count 4`, and inspect the four cards for legibility. Record the
      artifact paths in Testing.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Feature: `docs/features/F616_legible-xhs-card-text-via-deterministic-typesetting.md` (scenario R5, the caller side of
  R1, and the resume half of R3)
- Code: `plugins/kk/scripts/kk-workflow-stages.ts:79-96,1037-1176`, `plugins/kk/skills/xhs-images/SKILL.md`,
  `plugins/kk/skills/xhs-images/references/card-layouts.md`,
  `plugins/generations/image-gen/presets/{formats/xhs-card.yaml,styles/xhs-knowledge.yaml}`,
  `apps/cli/tests/kk-workflow-stages.test.ts:829-975`, `plugins/generations/image-gen/tests/presets.test.ts:330-360`
- Docs: `docs/design/xhs-image-cards.md`, `docs/design/kk-daily-ai-voice.md` §7
- Depends on: **0180** (the composer, the `compose` block, `ImageArtifact.illustration`), and transitively 0182

### History

- 2026-09-30T05:52:44.530Z backlog → todo (system)

