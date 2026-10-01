---
schema_version: 1
name: Wire the text-free illustration contract into daily-xhs-render and xhs-card
status: done
template: feature-impl
created_at: 2026-09-29T02:28:56.271Z
updated_at: "2026-10-01T17:38:40.562Z"
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

- [x] R1. For every format with a `compose` block, image-gen refuses before any spend (dry run included) when the fully composed illustration prompt contains a Han character (`/\p{Script=Han}/u`), or the headline, or any point (exact substring, trimmed, length ≥ 2). The error names the offending source: template, style, `extra`, or a named var. The `xhs-knowledge` style is rewritten to be text-free and gains `negative: text, letters, numbers, Chinese characters, captions, watermark, logo`. The `xhs-card` template states `no text, no letters, no numerals` explicitly.
- [x] R2. A composed card stays legible without the model illustration. The composer's no-illustration output (0180's pre-spend compose) meets the same canvas, safe-area and glyph-floor assertions as an illustrated card. This makes the illustration decoration, not a legibility dependency.
- [x] R3. Both callers use the composing path. `dailyXhsRender` stops sending `language` and keeps `headline`/`points` in `vars`, which the composer consumes. `kk:xhs-images` step 2 drops `language`, and its Checks/limits text describes typeset copy, with no "model renders text" wording left. No caller keeps a code path or instruction that puts card copy into a prompt.
- [x] R4. Daily-stage artifacts keep their order and resume semantics. `25-xhs/cards/card-NN.in.json`, `card-NN.json` and `card-NN.prompt.txt` stay in place. `prompt.txt` now holds the text-free illustration prompt. `cards.json` entries gain `illustrationPath`, and `Content.metadata.images[]` is still the composed cards in card order. A card whose recorded composed artifact is on disk is reused with no re-spend. A resume renders only missing cards.

### Acceptance Criteria

- [x] AC1 — The illustration layer stays text-free (req: R1, R2)
- [x] AC2 — Card copy is set with real type, not generated pixels (req: R3)
- [x] AC3 — Composition is deterministic and resumable (req: R4)

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

- [x] Write tests 1-7 and confirm they fail.
- [x] `assertTextFreePrompt` and its call site in `src/index.ts`.
- [x] Rewrite the `xhs-knowledge.yaml` / `xhs-card.yaml` wording.
- [x] Daily stage edits (`kk-workflow-stages.ts:1096-1176`).
- [x] Skill and `card-layouts.md` edits; run check 8.
- [x] Docs, same commit (T3): `docs/design/xhs-image-cards.md`, `docs/04_DESIGN.md`, `docs/design/kk-daily-ai-voice.md`
      §7.
- [x] `bun run gate` — green 2026-10-01 00:13 (1607 pass / 0 fail, all rules passed).
- [x] Operator-approved paid dogfood (F616 feature-level gate, design doc §7 "one representative Chinese article
      should be rendered and inspected") — DONE 2026-10-01 via the production path: representative zh article →
      hand-authored 4-card plan → `kk stage daily-xhs-render` (minimax image-01, xhs-knowledge/xhs-card), dry-run
      pre-check confirmed the text-free prompt at 0 spend, 4/4 cards rendered sequentially in 2m35s (≈$0.014),
      all 1080×1440, operator eyeball check passed. Artifacts `.spur/run/0181-dogfood/work/25-xhs/`; evidence in
      Testing.

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `apps/cli/tests/kk-workflow-stages.test.ts:843` |
| `apps/cli/tests/kk-workflow-stages.test.ts:920` |
| `apps/cli/tests/kk-workflow-stages.test.ts:937` |
| `apps/cli/tests/kk-workflow-stages.test.ts:941` |
| `plugins/generations/image-gen/src/bytes.ts:20` |
| `plugins/generations/image-gen/src/index.ts:1` |
| `plugins/generations/image-gen/src/index.ts:199` |
| `plugins/generations/image-gen/src/index.ts:242` |
| `plugins/generations/image-gen/src/index.ts:32` |
| `plugins/generations/image-gen/src/index.ts:459` |
| `plugins/generations/image-gen/src/index.ts:529` |
| `plugins/generations/image-gen/src/index.ts:535` |
| `plugins/generations/image-gen/src/index.ts:547` |
| `plugins/generations/image-gen/src/index.ts:550` |
| `plugins/generations/image-gen/src/index.ts:6` |
| `plugins/generations/image-gen/src/job.ts:82` |
| `plugins/generations/image-gen/src/presets.ts:103` |
| `plugins/generations/image-gen/src/presets.ts:114` |
| `plugins/generations/image-gen/src/presets.ts:34` |
| `plugins/generations/image-gen/src/presets.ts:76` |
| `plugins/generations/image-gen/tests/presets.test.ts:334` |
| `plugins/generations/image-gen/tests/presets.test.ts:339` |
| `plugins/generations/image-gen/tests/presets.test.ts:356` |
| `plugins/generations/image-gen/tests/presets.test.ts:371` |
| `plugins/generations/image-gen/tests/presets.test.ts:373` |
| `plugins/kk/scripts/kk-workflow-stages.ts:1093` |
| `plugins/kk/scripts/kk-workflow-stages.ts:1127` |
| `plugins/kk/scripts/kk-workflow-stages.ts:1139` |
| `plugins/kk/scripts/kk-workflow-stages.ts:1153` |
| `plugins/kk/scripts/kk-workflow-stages.ts:1174` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Guard primitive `assertTextFreePrompt(prompt, {headline, points}, sources)` at `plugins/generations/image-gen/src/compose/card.ts:100-133` (`TextFreeSource` :83-86): Han via `/\p{Script=Han}/u` (:112) + headline/point exact-substring, trimmed, length >= 2 (:106-111); error `compose: the illustration prompt must stay text-free — ${source} contributes ${what} (card copy is typeset, never prompted)`. Call site `plugins/generations/image-gen/src/index.ts:255-290` runs for EVERY `format.compose` format, after headline/points parse (:264-272), with sources in contract order — format template, style preset, spec.extra, named vars minus headline/points/index (:273-284) — and composed-prompt fallback; guard at :285 fires BEFORE font IO (:292), assertCoverage (:314), dry compose (:317-318) and the dry-run branch (:358), i.e. on both dry-run AND spend branches. Fresh spot-check (`KK_IMAGE_DRY_RUN=1`, ad-hoc script): refusal `vars.subject contributes the headline '核心概念'` with 0 generate calls; text-free dry run composes with 0 provider calls. Zero-spend refusals locked by `plugins/generations/image-gen/tests/compose.test.ts:202-252` (Han subject names `vars.subject`, generateCalls()=0 :218; Latin copy names the headline :236; non-compose cover with CJK subject NOT refused :239-252). Error contract verbatim in `plugins/generations/image-gen/tests/text-free.test.ts:22-65` (U+4E2D padded hex :27-33, style/point/spec.extra attribution :34-54, composed-prompt fallback :55-60, <2-char exemption :62-65). Presets: `plugins/generations/image-gen/presets/styles/xhs-knowledge.yaml:8` = `negative: text, letters, numbers, Chinese characters, captions, watermark, logo` (exact string locked at `plugins/generations/image-gen/tests/presets.test.ts:350-354`; modifiers Han-free), `plugins/generations/image-gen/presets/formats/xhs-card.yaml:60` template states "Pure illustration, no text, no letters, no numerals, no captions"; text-inviting keywords gone (keywords list, plugins/generations/image-gen/presets/formats/xhs-card.yaml:15-20) and `variables.language` asserted undefined (`plugins/generations/image-gen/tests/presets.test.ts:340`). |
| R2 | MET | No-illustration card meets the same assertions as an illustrated card: glyph floors by construction pinned on `cardHtml` (`plugins/generations/image-gen/tests/text-free.test.ts:67-110` — headline starts `font-size: 96px` = headlineMinPx*1.5, floor `var headlineMinPx = 64`, points `font-size:36px`, and the no-illustration HTML has NO `<img>` :101-110); safe-area overflow refused on the no-illustration path with the identical error an illustrated card gets (`plugins/generations/image-gen/tests/compose-e2e.test.ts:153-165` — `'拆'.repeat(200)` → "overflows the safe area"; same assertion standalone in `plugins/generations/image-gen/scripts/compose-e2e-artifact.ts` `runR2()`); same canvas: fresh measurement of the R2 artifact `plugins/generations/image-gen/.spur/run/0181/card-r2-no-illustration.png` = 1080x1440 (PNG IHDR parse, this review); `assertCoverage` runs on the same pre-spend cardInput with no illustration (`plugins/generations/image-gen/src/index.ts:295-314`). bun test: 411 pass / 0 fail. |
| R3 | MET | `dailyXhsRender` (`plugins/kk/scripts/kk-workflow-stages.ts:1097`) envelope vars `:1122-1129` = role/layout/headline(`card.copy`)/points(`card.points.join('\n')`)/subject/index — NO `language`; test asserts `spec.vars.language` undefined (`apps/cli/tests/kk-workflow-stages.test.ts:921`, pinned envelope test :868-945). Skill: `plugins/kk/skills/xhs-images/SKILL.md:44` step 2 vars list `(role, layout, headline, points, subject, index)` — no language; Checks/limits `:86-89` = "copy is typeset by image-gen's composer at fixed glyph floors, not rendered by the model — the provider prompt must stay text-free (0181)… overflow fails loud before spend"; step 3 spend preview marks per-card copy "typeset by image-gen's composer, not prompt text" (:54-55). `plugins/kk/skills/xhs-images/references/card-layouts.md:23-25` typography reworded to composer typesetting. Grep gates fresh: `grep -rn "model renders text"` and `"language 简体中文"` over plugins/kk/skills/xhs-images + plugins/kk/scripts → zero matches; `简体中文` absent from all of plugins/kk. No caller puts card copy into a prompt: the guard (R1) refuses any leak at the shared seam, incl. manual `kk executor run image-gen`. |
| R4 | MET | Artifact triple unchanged: `card-NN.json` / `card-NN.prompt.txt` (`plugins/kk/scripts/kk-workflow-stages.ts:1113-1114`), `card-NN.in.json` (:1117); `prompt.txt` holds the composed (text-free) provider prompt via `writeRaw(promptPath, artifact.prompt)` (:1162-1164). `cards.json` entries gain `illustrationPath` (:1155-1161 — narrowed: non-object/absent → undefined; object+string path → `resolve()`; :1174 in the card entry); `Content.metadata.images[]` = composed cards in card order (`images.push({ ...artifact, path: imagePath })` :1165, written :1179-1186). Resume: reuse check `firstArtifact(readJson(out))` + `isFile` (:1115-1116) → no kk spawn; zero-spawn test "with every artifact already on disk spends nothing but still packages (E8 0181)" (`apps/cli/tests/kk-workflow-stages.test.ts:948-983` — `existsSync(record)` false :974 = fake kk never invoked, both cards packaged in order :975-983); partial resume "reuses a card whose artifact is still on disk instead of re-rendering it" (:1008-1050 — exactly 1 call, for card-02 only :1042-1043, cached prompt preserved :1044, images order [kept, card-02] :1045-1049). illustrationPath recorded in both fresh-run assertions (:941-943). bun test: 84 pass / 0 fail. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| The illustration layer stays text-free | MET | test | `plugins/generations/image-gen/tests/text-free.test.ts:22-65` (error contract incl. U+4E2D), `plugins/generations/image-gen/tests/compose.test.ts:202-252` (pre-spend refusal naming vars.subject, generateCalls()=0; non-compose guard scope), `plugins/generations/image-gen/tests/presets.test.ts:340-354` (language var gone; style Han-free; exact negative string); fresh cmd spot-check under KK_IMAGE_DRY_RUN=1 → refused with 0 generate calls; grep gates zero matches for "model renders text" / "language 简体中文" in plugins/kk |
| Card copy is set with real type, not generated pixels | MET | test | `plugins/generations/image-gen/tests/text-free.test.ts:67-110` (96px start / 64px floor / 36px body floors on the shared `cardHtml`; no `<img>` when illustration absent), `plugins/generations/image-gen/tests/compose-e2e.test.ts:153-165` (safe-area overflow refused on the no-illustration path), `apps/cli/tests/kk-workflow-stages.test.ts:921,941-944` (no language var; illustrationPath + typeset prompt trail); cmd: `.spur/run/0181/card-r2-no-illustration.png` measured 1080x1440 |
| Composition is deterministic and resumable | MET | test | `apps/cli/tests/kk-workflow-stages.test.ts:948-983` (zero-spawn resume: record file never created = 0 image-gen spawns; cards packaged in order), `:1008-1050` (resume re-renders only missing card-02; cached prompt preserved verbatim), `:868-945` (images order card-01→card-02, illustrationPath in cards.json); determinism of the compose itself evidenced by SHA-256 pairs in `plugins/generations/image-gen/scripts/compose-e2e-artifact.ts` (0180 contract reused by the r2 variant) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

**F616 feature-level dogfood (operator-approved paid run, 2026-10-01)**

- Production path end-to-end: representative zh article `.spur/run/0181-dogfood/article.md` → 4-card plan
  `.spur/run/0181-dogfood/work/25-xhs/20261001_18_xhs_plan.json` (cover + 2 content + closing) →
  `kk stage daily-xhs-render <work> 20261001 "" 4 xhs-knowledge minimax image-01` → exit 0, "4 cards packaged in
  card order".
- Pre-spend guard on a real envelope: `KK_IMAGE_DRY_RUN=1` dry run of card-01 passed the text-free guard and
  composed the provider prompt with 0 generate calls (`.spur/run/0181-dogfood/dry/card-01.json`; prompt carries the
  xhs-card template wording "no text, no letters, no numerals, no captions — the text band is typeset separately").
- 4/4 rendered sequentially in 2m35s, first try, no retries (minimax image-01, ≈$0.014 total).
- Cards `.spur/run/0181-dogfood/work/25-xhs/cards/card-01-xhs-card-01.png` … `card-04-xhs-card-01.png`, each
  measured 1080×1440 (sips); text-free illustration layers `card-0N-xhs-card-illustration-0N.jpg` beside them.
- `cards.json`: all four entries `rendered` with `illustrationPath` recorded; `content.json`: `metadata.images[4]`
  in card order, `publishStatus: draft` (never published — no `--live`).
- Operator eyeball check on the four PNGs: legible — copy crisp at the deterministic glyph floors; approved to
  close out F616 (2026-10-01).

### Review

#### Review Report — 0181

**Scope:** 0181 subset of the F616 working tree (guard + presets + daily stage + skill + docs + tests; 0180 files judged only where 0181 touches them)
**Dimensions:** functional, security, efficiency, correctness, usability, architecture
**Verdict:** PASS

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location |
|---|----------|-----------|---------|----------|
| 1 | P3 (minor) | correctness | `style.negative` never reaches a provider: `ImageRequest.negative` is declared ("From StylePreset.negative (0102)") but never set and read by no provider (dashscope only sets a hardcoded `QWEN_NEGATIVE_PROMPT`), so the shipped text negative is inert. Enforcement does not depend on it (the guard is hard and pre-spend; the template wording rides the prompt), but `xhs-image-cards.md` presents the negative as part of the enforcement stack. Fix: set `negative: style.negative` on the ImageRequest and consume it (or append `avoid: …` per the field's own fallback comment), or reword the doc to "declared, provider-dependent". | `plugins/generations/image-gen/src/index.ts:404-411`, `src/providers/types.ts:39-40` |
| 2 | P3 (minor) | architecture | The `TextFreeSource` enumeration in the orchestrator duplicates `composePrompt`'s frozen segment rule (0102 R2) and has already drifted both ways: `composePrompt` includes `format.keywords` (not in the source list → a keywords-borne violation is still refused, but attributed to "the composed prompt" instead of the format), while the source list checks `style.negative` (not in `composePrompt`'s output — conservative, fine). Safety holds via the composed-prompt fallback; attribution precision and future segments are the risk. Fix: export one segment builder from `presets.ts` (e.g. `promptSegments(...): TextFreeSource[]`), have `composePrompt` join it and the guard consume it. | `plugins/generations/image-gen/src/index.ts:276-286`, `src/presets.ts:247-259` |
| 3 | P4 (advisory) | correctness | `04_DESIGN.md` compose schema comment says "cover headline starts at 1.5x, content at 1x" — no such differentiation exists: every headline starts at `headlineMinPx * 1.5` and `role` is unused for sizing (0180-authored line in the section 0181 extends; one-word fix). | `docs/04_DESIGN.md:776`, `src/compose/card.ts:152-153` |
| 4 | P4 (advisory) | usability | `04_DESIGN.md` 0181 paragraph states `.illustration = { path, width, height, bytes }`; the type has width/height optional and the implementation writes only `{ path, bytes }`. Reword or populate. | `docs/04_DESIGN.md` (0181 paragraph), `src/job.ts:82-90`, `src/index.ts:536` |
| 5 | P4 (advisory) | functional | The `dailyXhsRender` doc comment was not reworded per design ("illustration generated, copy typeset"); the inline `kk()`-call comment covers it. Cosmetic. | `plugins/kk/scripts/kk-workflow-stages.ts:1089-1095,1135-1139` |

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `assertTextFreePrompt` (`src/compose/card.ts:139-172`): `\p{Script=Han}` + headline/points exact-substring (trimmed, ≥2), error `compose: the illustration prompt must stay text-free — ${source} contributes ${what}` locked verbatim by `tests/text-free.test.ts:31-36` incl. padded hex (U+4E2D); call site `src/index.ts:262-290` — after headline/points parse, BEFORE font IO (`:292`), assertCoverage and dry compose, on both dry-run and spend branches; sources in contract order (template → style → `spec.extra` → named vars minus headline/points/index → composed-prompt fallback), attribution headline→points→Han proven behaviorally (`text-free.test.ts:38-62`); refusal names the var with zero provider calls (`compose.test.ts:203-227`, `generateCalls()===0`); non-compose guard scope proven (`compose.test.ts:229-240`); `xhs-knowledge.yaml` modifiers Han-free + `negative` added; `xhs-card.yaml` template states "no text, no letters, no numerals" and text-inviting keywords dropped (`presets.test.ts:331-360` inversions). |
| R2 | MET | Floors by construction pinned on `cardHtml` (`text-free.test.ts:95-122`: 96px start / 64px floor / 36px body, no `<img>` when illustration absent); safe-area overflow refused on the no-illustration path with the same error as illustrated (`compose-e2e.test.ts` R2 negative `'拆'.repeat(200)`; standalone `scripts/compose-e2e-artifact.ts` r2 variant); artifact verified: `plugins/generations/image-gen/.spur/run/0181/card-r2-no-illustration.png` measured 1080x1440 in this review. |
| R3 | MET | `dailyXhsRender` envelope drops `language`, keeps headline/points in vars (`kk-workflow-stages.ts:1118-1128`); `SKILL.md` step 2 vars list and Checks/limits reworded, spend preview marks copy as typeset; `card-layouts.md` drops "the model renders text" and the 简体中文 default line; grep gate `rg "model renders text\|language 简体中文" plugins/kk` → zero matches; `简体中文` absent from image-gen presets; the plan-authoring prompt (`kk-daily-ai-voice.yaml:361-362`) already instructs an English text-free `subject`, so a disobedient plan fails loud pre-spend and the XHS target skips (`onError: continue`). |
| R4 | MET | Artifact triple `card-NN.{in.json,json,prompt.txt}` unchanged; `prompt.txt` = text-free composed prompt; `cards.json` gains `illustrationPath` with correct narrowing (raw unknown → undefined; object+string path → `resolve()`, idempotent since `artifactPath` already returns absolute paths, `src/paths.ts:26`); `metadata.images[]` stays the composed cards in order; resume check unchanged and zero-spawn proven (`kk-workflow-stages.test.ts` "spends nothing but still packages": 0 kk spawns, both cards packaged in order). |

AC1/AC2/AC3: satisfied (see R1/R3/R4 rows).

##### SECUA notes

- **Security:** guard closes the copy-into-prompt seam at the single shared path (manual `kk executor run` included); `escHtml` escapes headline/points in the Chromium page; `artifactPath` stem/extension guards prevent path escape; no new network/exec surface.
- **Efficiency:** refusal happens before font IO and Chromium launch — pre-spend and pre-IO as specified.
- **Correctness:** `promptVars` mirrors `composePrompts`' free-branch spread order exactly (subject override semantics identical); whitespace/`x` exemptions tested; legacy-resume (pre-0181 cards without `illustration`) degrades to `illustrationPath: undefined` by design (Q&A closed).

##### Architecture

The guard primitive lives correctly in the composition module — pure assertion over `(prompt, copy, sources)`, no preset/spec knowledge, beside `assertCoverage` in the same failure family, fully unit-testable. The call site in the orchestrator is the right seam (only it knows spec/style/extra). The residual friction is finding 2 (segment-enumeration duplication), which is the one structural debt worth paying down before a second compose format ships. Docs are same-commit consistent across all five surfaces (`04_DESIGN.md`, `xhs-image-cards.md`, `kk-daily-ai-voice.md` §7, `SKILL.md`, `card-layouts.md`).

**Verification (fresh, this review):** `bun test` in `plugins/generations/image-gen` → 411 pass / 0 fail (E2E self-skips with printed reason per the documented Bun 1.3.14 issue; standalone artifact script evidence present); `bun test tests/kk-workflow-stages.test.ts` in `apps/cli` → 84 pass / 0 fail; `tsc --noEmit` clean in both workspaces; r2 artifact measured 1080x1440.

**Next:** No P1/P2. Disposition the two P3s (negative wiring or doc reword; segment-builder refactor) as follow-ups or fix forward — neither blocks the gate. The task's own remaining steps (`bun run gate` + the operator-approved paid dogfood) stay open per plan; this review does not certify them.

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
- 2026-09-30T13:18:27.819Z todo → wip (system)
- 2026-10-01T07:33:54.305Z wip → testing (system)
- 2026-10-01T07:43:33.632Z testing → done (system)

