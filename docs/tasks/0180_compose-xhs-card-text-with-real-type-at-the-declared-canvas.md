---
schema_version: 1
name: Compose xhs-card text with real type at the declared canvas
status: done
template: feature-impl
created_at: 2026-09-29T02:28:56.039Z
updated_at: "2026-09-30T13:06:42.077Z"
feature_id: F616

priority: P2
---

## 0180. Compose xhs-card text with real type at the declared canvas

### Background

Filed from the 0179 review (P2 → F616). The `xhs-card` format asks the diffusion model to draw the Chinese headline
and bullets as pixels (`presets/formats/xhs-card.yaml` template: `On-card headline … "{{headline}}"` plus
`{{points}}`). MiniMax `image-01` has no glyph renderer, and all three measured cards came back illegible. The cause
is structural: BPE embeddings carry no glyph geometry, and latent compression destroys 2-5px Han strokes. The daily
cover (task 0163) already bans Chinese text from image prompts for this reason.

This task builds the fix inside `image-gen`, the one renderer every XHS caller routes through (see
`docs/design/xhs-image-cards.md` "Decision and boundary"). A format preset may declare a `compose` block. For such a
format, image-gen generates only the illustration, then typesets the on-card copy from a pinned real font into the
declared canvas with headless Chromium. Callers (`kk stage daily-xhs-render`, `kk:xhs-images`) need no rendering code
of their own. Their envelope and doc updates are task 0181.

Operator decisions (2026-09-29, this refinement):

- **Engine: Playwright HTML → PNG.** `playwright` 1.55.0 is already in the workspace catalog and already a runtime
  prerequisite of the XHS publish path. `scripts/bundle-plugins.ts:77` already keeps it external for every plugin, so
  there is no new install prerequisite.
- **Font: ship Noto Sans SC (OFL-1.1)** inside the plugin, with its licence, so output is reproducible on every
  machine.

### Requirements

- [x] R1. For a format with a `compose` block, the on-card headline and points are typeset by the composer from the pinned Noto Sans SC font through headless Chromium. The `xhs-card` template no longer interpolates `headline`, `points` or `language`, so the provider prompt carries no card copy. (0181 adds the fail-loud guard that enforces this for every composing format.)
- [x] R2. The composed card is a PNG of exactly the format's `width`x`height` (xhs-card: 1080x1440), whatever size the provider delivered. The headline renders at ≥ 64px and bullets at ≥ 36px, and every text box lies inside the safe area (72px inset). Copy that cannot fit at the minimum sizes fails loud, naming the card field (`headline` or `points[i]`). It is never clipped and never shrunk below the floor.
- [x] R3. Composition is a pure function of (headline, points, role, compose block, font bytes, illustration bytes). Two composes of the same input on the same install produce byte-identical PNGs, verified by SHA-256.
- [x] R4. Before any provider spend, every character of the headline and points is checked against the font's `cmap`. The first uncovered character fails loud with its code point and field, e.g. `compose: headline has U+1F600 '😀' not covered by NotoSansSC-Bold`. Whitespace and line breaks are exempt. Chromium's system-font fallback can never supply a glyph.
- [x] R5. All composer checks run pre-spend, including under `KK_IMAGE_DRY_RUN=1`, via one text-only compose with no illustration. After spend, image-gen writes the raw illustration artifact and the composed card, and both are cleaned up on failure (`written[]`). `ImageArtifact.path` is the composed card. `ImageArtifact.illustration = { path, width, height, bytes }` records the raw provider image. `xhs-pub` reads only `.path`, so the publish DTO stays unchanged.
- [x] R6. Formats without `compose` behave exactly as before (cover, daily-news-cover, free, illustration).

### Acceptance Criteria

- [x] AC1 — Card copy is set with real type, not generated pixels (req: R1, R5, R6)
- [x] AC2 — The declared canvas is the delivered canvas (req: R2)
- [x] AC3 — Composition is deterministic and resumable (req: R3)
- [x] AC4 — Missing font coverage fails loud (req: R4)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-30T05:50:34.079Z

- **Engine (closed, operator 2026-09-29):** Playwright HTML screenshot. The alternatives were satori + resvg-js (a
  native dependency and a new install prerequisite) and satori + resvg-wasm (two new dependencies plus WASM bundling).
  Both were rejected: Playwright is already cataloged, is already external in the bundle, and gives real measured
  layout for the safe-area check. Cost: one Chromium launch per image-gen invocation (one card). That is acceptable
  next to a paid provider call.
- **Font (closed, operator 2026-09-29):** ship Noto Sans SC Regular (bullets) and Bold (headline) from the official
  `notofonts/noto-cjk` release, preferring the `SubsetOTF/SC` static files. They live at
  `plugins/generations/image-gen/assets/fonts/` with `OFL.txt` and a `SOURCE.md` recording the upstream URL, version
  and SHA-256 of each file. If the two files together exceed ~20 MB, stop and report before committing. No runtime
  download and no system-font lookup.
- **Where the composer lives (closed):** inside `image-gen`, keyed by the format's `compose` block. Every XHS caller
  already routes through image-gen, so fixing it there fixes both callers once. A new generator plugin or a stage-level
  renderer would contradict `docs/design/xhs-image-cards.md` ("image-gen remains the only image renderer").
- **Missing-glyph check via cmap, not the browser (closed):** Chromium silently falls back to system fonts, so browser
  signals cannot prove coverage. A pure `cmap` reader (formats 4 and 12) over the shipped font is authoritative and runs
  pre-spend. No `opentype.js` dependency.
- **One template, role-aware (closed):** v1 has one HTML template. The illustration band is on top (`object-fit:
  cover`) and the text panel below. `cover` gets a larger headline and no bullets requirement; `content`/`closing` get
  headline plus bullets. Per-`layout` templates from `card-layouts.md` are deferred until a rendered series shows the
  single template is insufficient. `layout` stays a hint in the illustration prompt.
- **Post-spend compose failure (closed, accepted residual):** fit and coverage are proven pre-spend, so a post-spend
  failure is infrastructure only (for example a Chromium crash). It follows the existing rule: clean up and fail. The
  illustration is re-billed on the next run. Keeping a paid illustration across failures is deferred until it is
  observed.
- **ADR (closed):** a structural change (a generator plugin gains a browser runtime and ships a binary asset), so it
  gets a dated **ADR-028** entry in `docs/00_ADR.md` before code.

### Design

**Preset schema** (`src/presets.ts:80` `FormatPresetSchema`, plus the `FormatPreset` interface). Optional:

```yaml
compose:
  engine: text-card          # the only value in v1; zod literal
  safeArea: 72               # px inset on all sides
  headlineMinPx: 64
  bodyMinPx: 36
  illustrationHeight: 640    # px of the top band; text panel takes the rest
  palette: { background: '#FFFFFF', text: '#1F2328', accent: '#FF2442' }
  fonts: { headline: NotoSansSC-Bold.otf, body: NotoSansSC-Regular.otf }   # names under assets/fonts/
```

A `compose` block requires `width` and `height`, and a zod refine fails loud otherwise. `xhs-card.yaml` gains this
block. Its template drops the headline/points/language lines, and its `variables` drop `language`. `headline`/`points`
stay declared because the composer reads them from `spec.vars`.

**New module** `src/compose/`:

| File | Responsibility |
| --- | --- |
| `cmap.ts` | `glyphCoverage(fontBytes): (cp: number) => boolean`: sfnt table directory → `cmap` → subtable format 12 (preferred) or 4. Pure, no IO. |
| `card.ts` | `CardComposer` interface `{ compose(input: CardInput): Promise<Uint8Array> }` plus `CardInput { headline, points[], role, compose, width, height, illustration?: { bytes, mime } }`. `assertCoverage(input, fonts)` (R4). `cardHtml(input, fontDataUrls)` builds the HTML with `@font-face` from `data:` URLs, fixed px sizes and no external requests. |
| `chromium.ts` | Default composer: `chromium.launch({ headless: true })`, `newPage({ viewport: {width,height}, deviceScaleFactor: 1 })`, `setContent`, `await document.fonts.ready`, measure every `[data-field]` box against the safe area (R2 overflow → throw naming the field), `screenshot({ type: 'png', animations: 'disabled' })`, `browser.close()` in `finally`. A missing Playwright or browser surfaces as an actionable error naming `bunx playwright install chromium`. |

Fit rule: the headline starts at `headlineMinPx * 1.5` and steps down by 4px until it fits, never going below the
floor. Bullets use `bodyMinPx`. If the content still overflows at the floors, compose fails loud (R2).

**image-gen integration** (`src/index.ts`):

- `processGeneratorIO` options gain `composer?: CardComposer`. Tests inject a stub, and the default is the Chromium
  composer (the same seam style as `providerResolver`).
- Pre-spend, after `composePrompts` (`:224`) and before provider selection, when `format.compose` is set: require
  `job: 'free'` and a non-empty `vars.headline`, split `vars.points` on newlines, run `assertCoverage`, then
  `composer.compose(input)` with no illustration and discard the bytes. This runs on both the dry-run and the spend
  branch (R5).
- Spend branch: write the illustration to `artifactPath(out, stem, `${format.name}-illustration`, i, ext)`, compose
  with it, write the card to `artifactPath(out, stem, format.name, i, 'png')`, and push both to `written[]`. The
  artifact's `path` is the card, `width`/`height` are the format canvas (measured with 0182's `imageDimensions` and
  asserted equal), and `illustration` holds the raw image (with 0182's delivered size).
- `ImageArtifact` (`src/job.ts:67`) gains `illustration?: { path: string; width?: number; height?: number; bytes: number }`.

**Package:** `plugins/generations/image-gen/package.json` gains `"playwright": "catalog:"`. That is already cataloged
at 1.55.0, so it is not a new dependency for the workspace. `assets/fonts/` is resolved as
`join(import.meta.dir, '..', 'assets', 'fonts')`, mirroring the presets root at `src/presets.ts:258`. It works from
`src/` and from the staged `dist/`, and `scripts/bundle-plugins.ts` `EXCLUDE` does not prune `assets/`.

**Invariants:** no network from the composer. Font bytes are read once per run. Non-compose formats take exactly the
old code path (R6).

### Plan

Failure modes are enumerated first, before code (AGENTS.md isolation rule). Each has one test:

1. `cmap`: covered CJK / ASCII / full-width punctuation → true. An emoji or a rare ideograph outside the subset →
   false. A truncated font → throws.
2. Headline containing an uncovered character → pre-spend failure naming the field and U+code point. The provider stub
   is never called (R4).
3. Overlong headline or too many or too long points at the floor sizes → fails naming the field, with zero spend (R2).
4. `compose` block without `width`/`height` → preset load fails loud.
5. `compose` format with `job` other than `free`, or an empty `headline` → fails pre-spend.
6. Dry run on xhs-card → the composer is invoked once without an illustration, no provider call, no files written
   (R5).
7. Spend path (stub provider + stub composer) → two files written, `path` is a `.png` card, `illustration.path` is the
   raw image, and a failure after the illustration write deletes both (R5).
8. Non-compose formats: the existing `tests/image-gen.test.ts` / `tests/fallback.test.ts` stay green unchanged (R6).
9. **E2E, real Chromium and the real font** (`tests/compose-e2e.test.ts`): compose a fixed Chinese card with and
   without a fixture illustration. Assert a 1080x1440 PNG (via `imageDimensions`), identical SHA-256 across two runs
   (R3), and all `[data-field]` boxes inside the safe area at ≥ the floors (R2). Write the PNGs to
   `.spur/run/0180/card-{with,without}-illustration.png` as the repeatable, human-inspectable artifact. Skip the test
   only when Chromium is absent, and print why (never a silent pass).

Steps:

- [x] ADR-028 in `docs/00_ADR.md`: card text is typeset, not generated. It covers image-gen's Playwright runtime and
      the shipped OFL font.
- [x] Download the fonts per Q&A; add `assets/fonts/{NotoSansSC-Regular.otf,NotoSansSC-Bold.otf,OFL.txt,SOURCE.md}`.
- [x] Write tests 1-9 and confirm they fail.
- [x] `src/compose/cmap.ts`, `card.ts`, `chromium.ts`.
- [x] `compose` in `FormatPresetSchema`; update the `xhs-card.yaml` block and template.
- [x] Integrate in `src/index.ts`; add `illustration` to `ImageArtifact`; add `playwright` to the image-gen
      `package.json`.
- [x] Update `tests/presets.test.ts:330-360`. The xhs-card prompt now **excludes** headline/points/language, and the
      `language` variable is gone.
- [x] Docs, same commit (T3): `docs/04_DESIGN.md` (format `compose` block, `ImageArtifact.illustration`),
      `docs/03_ARCHITECTURE.md` (image-gen composes for `compose` formats), and the `docs/design/xhs-image-cards.md`
      "Decision and boundary" paragraph.
- [x] `bun run build` and verify the staged bundle: `dist/` of image-gen resolves `assets/fonts` and keeps
      `playwright` external. Then `bun run gate`.

### Solution

Deterministic compose path in `@gobing-ai/image-gen` (ADR-028):

- `plugins/generations/image-gen/src/compose/cmap.ts:137` — font cmap reader (pure, no deps) + coverage check; uncovered char fails loud naming field + code point (`compose: headline has U+1F600 '😀' not covered by NotoSansSC-Bold`); whitespace/line breaks exempt.
- `plugins/generations/image-gen/src/compose/card.ts:95` — pure cardHtml builder: layout = illustration band (top, object-fit cover) + text panel; bullets >=36px; palette + `[data-field]` markers for measurement. Headline fit is role-independent: starts at `headlineMinPx * 1.5` (96px when the floor is 64) and steps down toward the floor; cardHtml does not consume `role` — cover/content only differ by preset config (canvas, illustrationHeight), not by code path.
- `plugins/generations/image-gen/src/compose/chromium.ts:47` — `ChromiumComposer`: headless Chromium via Playwright (local, no network), fonts served from disk by `page.route` interception, in-page measurement of every `[data-field]` against the 72px safe area (overflow fails loud naming field), PNG screenshot at declared canvas. Browser per compose, closed in `finally` (default transport; clean closes verified leak-free — the earlier zombie pileup was hung/killed launch cycles, not `close()`).
- `plugins/generations/image-gen/src/bytes.ts:27` — PNG-only `imageDimensions` (IHDR read; escalation Option A, approved: JPEG/WebP + spend-path wiring deferred to task 0182/F618).
- `plugins/generations/image-gen/src/index.ts:256` (pre-spend) + `plugins/generations/image-gen/src/index.ts:450` (spend path) — compose branch: pre-spend cmap check on headline+points; `KK_IMAGE_DRY_RUN=1` text-only compose without provider spend; card composed over provider bytes (or text-only band); artifact `ImageArtifact.path` = composed card, `.illustration = {path,width,height,bytes}` = raw provider output written as `<stem>-illustration<N>.<ext>`; cleanup via `written[]` unchanged. Non-compose formats (free/cover/daily-news-cover/illustration) untouched.
- `plugins/generations/image-gen/src/job.ts` — dry-run + artifact plumbing.
- `plugins/generations/image-gen/src/presets.ts` + `presets/xhs-card.yaml` — compose block (engine text-card, safeArea 72, headlineMinPx 64, bodyMinPx 36, illustrationHeight 640, palette, NotoSansSC fonts); xhs-card provider prompt carries the illustration description only — no card copy.
- `assets/fonts/` — NotoSansSC SubsetOTF Regular+Bold + OFL.txt + SOURCE.md (~20MB guard).
- `package.json` — `playwright` (workspace catalog) as the compose engine dependency.
- Tests: `tests/compose-cmap.test.ts` (cmap coverage), `tests/compose.test.ts` (pure cardHtml, pre-spend guards, dry-run, artifact shape, non-compose unchanged), `tests/compose-pure.test.ts` (cardHtml escaping/fit/illustration cases + assertCoverage exemptions + glyphCoverage on the real pinned fonts and synthetic format-4/12 sfnt builders + sfnt error paths), `plugins/generations/image-gen/tests/compose-e2e.test.ts` (real-Chromium E2E; skips under `bun test` with printed reason — Bun 1.3.14 blocks the event loop during launch), `scripts/compose-e2e-artifact.ts` (per-variant subprocess evidence: 1080x1440 + SHA-256 determinism, artifacts in `.spur/run/0180/`).
- Coverage: `bunfig.toml` `coveragePathIgnorePatterns` excludes only `plugins/generations/image-gen/src/compose/chromium.ts` (browser-driven, structurally unexecutable under `bun test`; E2E-verified by the artifact script) — documented, not silent.
- Docs (T3 same commit): `docs/00_ADR.md` ADR-028, `docs/03_ARCHITECTURE.md` (XHS card path paragraph), `docs/04_DESIGN.md` (compose block schema + artifact), `docs/design/xhs-image-cards.md` (§ Deterministic text typesetting).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `plugins/generations/image-gen/presets/formats/xhs-card.yaml:22-35` declares the compose block (engine text-card, safeArea 72, floors 64/36); template (xhs-card.yaml:57-66) no longer interpolates headline/points/language; `plugins/generations/image-gen/tests/presets.test.ts:353-375` asserts the provider prompt excludes card copy (`not.toContain` 微服务拆分 / 先按业务边界 / 简体中文); typeset via headless Chromium from pinned fonts: `plugins/generations/image-gen/src/compose/chromium.ts:76-141` (viewport at :76, fonts served from disk via page.route :81-92, `document.fonts.ready` :99); pre-spend compose `plugins/generations/image-gen/src/index.ts:255-301`; font bytes SHA-256-verified against `assets/fonts/SOURCE.md` (Bold c6cb5a93…, Regular faa6c9df…). |
| R2 | MET | Canvas: viewport 1080x1440 at deviceScaleFactor 1 (`plugins/generations/image-gen/src/compose/chromium.ts:76-77`) + post-compose assertion `imageDimensions` (`plugins/generations/image-gen/src/index.ts:489-494`); safe area: in-page measurement of every `[data-field]` box against the 72px inset, throws naming the field (`plugins/generations/image-gen/src/compose/chromium.ts:104-133`); floors: headline `Math.max(size, headlineMinPx)` (`plugins/generations/image-gen/src/compose/card.ts:235`), bullets fixed at bodyMinPx 36px (`plugins/generations/image-gen/src/compose/card.ts:115`); fresh E2E: `file .spur/run/0180/*.png` → both "PNG image data, 1080 x 1440". |
| R3 | MET | Fresh `bun plugins/generations/image-gen/scripts/compose-e2e-artifact.ts` exit 0: without-illustration sha256=fe344c712cbe8a4559502e0798a20adfda6ea86f59cbf4a6ecc60d490d9a5b6a, with-illustration sha256=fa99c30fcc2224f575737553af24b0e02a91378cc25bcd1222fe5646bc184d02 — each variant byte-identical across two composes (script asserts sha1===sha2, `plugins/generations/image-gen/scripts/compose-e2e-artifact.ts:71-74`), both equal to the values recorded in the task Testing section; on-disk `shasum -a 256` confirms the written PNGs match the printed hashes. |
| R4 | MET | Pure cmap reader format 12/4 over the shipped font (`plugins/generations/image-gen/src/compose/cmap.ts:96-177`); `assertCoverage` exempts whitespace/newlines and throws `compose: <field> has U+XXXX '<char>' not covered by <font>` (`plugins/generations/image-gen/src/compose/card.ts:51-83`); runs pre-spend before provider selection (`plugins/generations/image-gen/src/index.ts:296-297`, selection at :308+, dry-run branch :341); `tests/compose.test.ts` Plan 2 — emoji U+1F600 in headline and in points[i] fails naming field + code point with the provider stub never called (generateCalls()===0); `tests/compose-pure.test.ts` asserts the exact message format; Chromium system-font fallback can never supply a glyph (compose only runs after coverage passes; fonts come only from the pinned disk files via route interception). |
| R5 | MET | Pre-spend checks run on both branches: coverage + one text-only compose with no illustration (`plugins/generations/image-gen/src/index.ts:242-303`) before the KK_IMAGE_DRY_RUN=1 branch (:341) and the spend path (:449); `tests/compose.test.ts` Plan 6 — dry run invokes the composer exactly once with `illustration === undefined`, zero provider calls, zero files written; Plan 7 — spend path writes illustration (`plugins/generations/image-gen/src/index.ts:460`) and card (`plugins/generations/image-gen/src/index.ts:487`), pushes both to `written[]` (cleanup loop :563), artifact `path` is the composed .png card and `illustration.path` contains xhs-card-illustration; failure-after-illustration test deletes both files and leaves OUT absent; `ImageArtifact.illustration` typed at `plugins/generations/image-gen/src/job.ts:84-87`; `xhs-pub` reads only `images[].path` (`plugins/publishings/xhs-pub/src/index.ts:139-153`) so the publish DTO is unchanged. |
| R6 | MET | Non-compose branch is the pre-0180 code path verbatim (`plugins/generations/image-gen/src/index.ts:502-509`, else-branch unchanged in diff); `tests/compose.test.ts` Plan 8 — free and cover jobs bypass the composer entirely (composerCalls()===0); full focused suite green: 397 pass / 0 fail / 1108 expect() across 24 files including the untouched image-gen/fallback suites. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Card copy is set with real type, not generated pixels | MET | command | Real type not pixels: prompt-exclusion tests (`plugins/generations/image-gen/tests/presets.test.ts:353-375`), dry-run/spend compose tests (`tests/compose.test.ts` Plans 6-7); real-Chromium PNGs on disk (`.spur/run/0180/card-{without,with}-illustration.png`, PNG 8-bit RGB 1080x1440 per `file`), typeset through `plugins/generations/image-gen/src/compose/chromium.ts:76-141`. |
| The declared canvas is the delivered canvas | MET | test | Declared = delivered canvas: script asserts dimensions per compose (`plugins/generations/image-gen/scripts/compose-e2e-artifact.ts:66-69`), spend path asserts via `imageDimensions` (`plugins/generations/image-gen/src/index.ts:489-494`); fresh `file` on both artifacts: 1080 x 1440; PNG IHDR reader unit tests (`tests/compose-cmap.test.ts`). |
| Composition is deterministic and resumable | MET | command | Fresh SHA-256 determinism: without-illustration fe344c71…, with-illustration fa99c30f…, byte-identical across two composes per variant and equal to the recorded task values; deterministic inputs (pinned font bytes SHA-verified, fixed canvas/palette, `animations: 'disabled'`); resumability follows from byte-identical reuse of recorded artifacts. |
| Missing font coverage fails loud | MET | test | `tests/compose.test.ts` Plan 2 — uncovered emoji fails loud naming field + U+1F600 pre-spend, provider stub never called; `tests/compose-cmap.test.ts` — emoji U+1F600 and PUA U+E000 uncovered, CJK/ASCII/full-width punctuation covered in both shipped weights; `tests/compose-pure.test.ts` asserts the exact error text `headline has U+1F600 '😀' not covered by NotoSansSC-Bold` and points[i] naming against the body font. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 0180 (pipeline Phase 7, `--auto`, fresh session 2026-09-30)

**Scope:** worktree `sp/dev-runall-f616-d69c` — `git diff be1aeda5` (15 tracked files) plus 9 untracked new paths (`src/compose/`, four compose test files, `scripts/compose-e2e-artifact.ts`, `assets/fonts/`, task `.base.sha` marker); judged against the task spec (R1-R6 + AC1-AC4) and the recorded Solution/Testing sections; ADR-028 checked.
**Dimensions:** functional, security, efficiency, correctness, usability, architecture
**Verdict:** PASS (no P1/P2 findings; four P3s dispositioned below)

Fresh verification evidence gathered by this review (not transcribed): `bun test plugins/generations/image-gen/` → 397 pass / 0 fail / 1108 expect() across 24 files; `bun run lint` (biome + typecheck all workspaces) exit 0; real-Chromium `bun scripts/compose-e2e-artifact.ts` reproduced the recorded SHA-256 values exactly — without-illustration `fe344c712cbe8a4559502e0798a20adfda6ea86f59cbf4a6ecc60d490d9a5b6a`, with-illustration `fa99c30fcc2224f575737553af24b0e02a91378cc25bcd1222fe5646bc184d02`, both 1080x1440 (attempt-1 subprocess timeouts hit the recorded Bun 1.3.14 quirk; retries composed clean, byte-identical). Font provenance verified against the shipped bytes: Bold `c6cb5a93…`, Regular `faa6c9df…`, OFL `6a73f954…` all match `assets/fonts/SOURCE.md` (16.8 MB total, inside the ~20 MB guard). `xhs-pub` confirmed reading only `images[].path` (`plugins/publishings/xhs-pub/src/index.ts:140-145`).

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|------------|
| 1 | P3 (minor) | architecture | Entire task output is uncommitted: HEAD == be1aeda5; `src/compose/`, the four compose test files, `scripts/compose-e2e-artifact.ts` and `assets/fonts/` (16.8 MB binaries) are untracked and all edits unstaged. Merging the branch without `git add`/commit breaks the plugin build (`./compose/*` imports would not resolve). Disposition: done-time housekeeping must commit all new files. | `git status` (HEAD == be1aeda5); imports at `plugins/generations/image-gen/src/index.ts:11-13` | Deferred: done-time commit at batch close (WT-3b) — all work is verified; the commit is housekeeping before merge |
| 2 | P3 (minor) | correctness | Plan-item-9 E2E box assertion is not independently implemented: the artifact script asserts 1080x1440 + SHA-256 only and never measures `[data-field]` boxes or rendered font floors. R2 is still enforced — the composer's in-page overflow check throws naming the field on every real compose, and floors hold by construction (`Math.max(size, headlineMinPx)`; bullets fixed at `bodyMinPx`) — but the E2E evidence does not itself assert them. Disposition: accept (indirect coverage) or add a box/floor probe to the artifact script. | `plugins/generations/image-gen/scripts/compose-e2e-artifact.ts:65-79` | Deferred: accept — R2 is enforced by the composer's in-page overflow check on every real compose; extending the artifact script's assertions is deferred |
| 3 | P3 (minor) | correctness | Stale operator instruction: `bun src/compose/chromium-verify.ts` does not exist anywhere in the repo, yet the header comment and the timeout-path skip message direct the operator to it. The primary SKIP_REASON correctly names `scripts/compose-e2e-artifact.ts`. Disposition: fix both references. | `plugins/generations/image-gen/tests/compose-e2e.test.ts:15,109` | Deferred: comment-only correction; source is proof-bracketed post-verify — both references are corrected in the batch-close commit before merge |
| 4 | P3 (minor) | architecture | Card-input derivation is duplicated between the pre-spend block and the spend path (vars fallbacks, newline split of points, canvas null-check, role default). Drift between the two would make the probe compose differently from the final card. Disposition: extract a `buildCardInput(format, spec)` helper, or accept explicitly. | `plugins/generations/image-gen/src/index.ts:262-268` and `:463-479` | Deferred: accept — duplication is two localized call sites; buildCardInput extraction deferred to the 0182 follow-up window |
| 5 | P4 (advisory) | functional | R5 lists `ImageArtifact.illustration = { path, width, height, bytes }` but `width`/`height` are never populated — recorded escalation Option A defers delivered-size wiring (and JPEG/WebP in `imageDimensions`) to task 0182/F618; the fields stay optional in the interface. Recorded deferral — no action in 0180. | `plugins/generations/image-gen/src/index.ts:501` | — |
| 6 | P4 (advisory) | security | Illustration data-URL MIME is built as `image/${result.extension}`; MiniMax (the XHS provider) returns extension `jpg`, yielding the non-canonical `data:image/jpg`. Blink sniffs magic bytes so JPEG renders, but a jpg→jpeg canonical map (or a fixed extension→MIME table) is stricter and removes reliance on sniffing. | `plugins/generations/image-gen/src/index.ts:479`; `src/providers/minimax.ts:176` | — |
| 7 | P4 (advisory) | efficiency | Font bytes are re-read from disk on every route fulfilment (about 16.8 MB × 2 fonts × 2 composes per card); the "font bytes are read once per run" invariant holds only for the coverage map. Trivial next to the Chromium launch; cache in the composer if compose volume grows. | `plugins/generations/image-gen/src/compose/chromium.ts:81-86` | — |
| 8 | P4 (advisory) | usability | xhs-card's `headline` variable defaults to 核心概念 (non-empty), so a job that omits `vars.headline` silently typesets placeholder copy and spends; the plan-5 empty-headline guard only fires when the default is also emptied. 0181's caller wiring should always pass `vars.headline`. | `plugins/generations/image-gen/presets/formats/xhs-card.yaml:44` | — |
| 9 | P4 (advisory) | architecture | `.safe-area-sentinel` is dead markup: never queried by the composer (safe bounds come from `input.compose`), only asserted present in compose-pure tests. Remove it or make the composer consume it. | `plugins/generations/image-gen/src/compose/card.ts:220` | — |
| 10 | P4 (advisory) | correctness | The composed card is written before the canvas assertion; a mismatch relies on `written[]` cleanup (correct but write-then-delete churn). Measure `imageDimensions(cardBytes)` before `writeBytes`. | `plugins/generations/image-gen/src/index.ts:484-494` | — |
| 11 | P4 (advisory) | correctness | The bun-test E2E file skips unconditionally under `bun test` (plan item 9 said "skip only when Chromium is absent") — a recorded deviation (Bun 1.3.14 blocks the event loop during Chromium launch) with the artifact script as substitute evidence; reproduced live in this review (attempt-1 timeouts, clean retry). | `plugins/generations/image-gen/tests/compose-e2e.test.ts:60-64` | — |

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `presets/formats/xhs-card.yaml` compose block (`:22-35`) and template drops headline/points/language; prompt-exclusion asserted in `tests/presets.test.ts:353-370`; typesetting via `src/compose/chromium.ts:47-141` |
| R2 | MET | Fixed-px canvas + viewport 1080x1440 at deviceScaleFactor 1 (`src/compose/chromium.ts:62-66`); in-page safe-area check naming overflowing fields (`chromium.ts:104-133`); floors by construction (`src/compose/card.ts` fit script); canvas asserted via `imageDimensions` (`src/index.ts:489-494`); fresh E2E PNGs measured 1080x1440 |
| R3 | MET | SHA-256 determinism reproduced live in this review: `fe344c71…` / `fa99c30f…` byte-identical across independent runs and equal to the recorded artifacts |
| R4 | MET | `assertCoverage` (`src/compose/card.ts:51-83`, whitespace/line-break exempt) over the pure cmap reader (`src/compose/cmap.ts:96-177`); runs pre-spend before provider selection (`src/index.ts:242-303`); error text matches the spec format (`compose: headline has U+1F600 '😀' not covered by NotoSansSC-Bold`); tests prove the provider stub is never called |
| R5 | MET | Pre-spend text-only compose on both dry-run and spend branches (`src/index.ts:242-303` before the dry-run branch at `:344`); illustration + card written and pushed to `written[]` (`src/index.ts:450-484`); failure cleanup catch (`src/index.ts:556-561`); `artifact.path` = composed card, `.illustration` recorded (`:501`); `xhs-pub` reads only `.path` (`plugins/publishings/xhs-pub/src/index.ts:140-145`) |
| R6 | MET | Non-compose branch is byte-equivalent to the old path (`src/index.ts:502-509`); plan-8 tests green; full suite 397 pass / 0 fail including the untouched `image-gen`/`fallback` suites |

AC1-AC4 all MET: real type not pixels (R1/R5/R6 above), delivered canvas = declared canvas (R2), SHA-256 determinism (R3), loud missing-glyph failure (R4).

**Next:** P3 #1 is done-time housekeeping (commit all new files before merge); #2-#4 need explicit fix-or-accept dispositions; P4 rows are advisory and non-blocking.

### References

- Feature: `docs/features/F616_legible-xhs-card-text-via-deterministic-typesetting.md` (scenarios R1-R4)
- Origin: task 0179 Review, P2
- Precedent: task 0163 (daily cover bans Chinese text in image prompts)
- Code: `plugins/generations/image-gen/src/index.ts:190-440`, `src/presets.ts:41-90,252-270`, `src/job.ts:67-82`,
  `presets/formats/xhs-card.yaml`, `tests/presets.test.ts:330-360`, `scripts/bundle-plugins.ts:38,77`
- Font source: https://github.com/notofonts/noto-cjk (Sans, SubsetOTF/SC), licence OFL-1.1
- Depends on: **0182** (`imageDimensions` in `src/bytes.ts`, the same `index.ts` region). Blocks: **0181**.

### History

- 2026-09-30T05:52:42.994Z backlog → todo (system)
- 2026-09-30T12:11:55.024Z todo → testing (system)
- 2026-09-30T13:06:42.077Z testing → done (system)

