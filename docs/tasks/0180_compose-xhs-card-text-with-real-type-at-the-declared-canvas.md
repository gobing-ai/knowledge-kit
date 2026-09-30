---
schema_version: 1
name: Compose xhs-card text with real type at the declared canvas
status: todo
template: feature-impl
created_at: 2026-09-29T02:28:56.039Z
updated_at: "2026-09-30T06:27:23.540Z"
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

- [ ] R1. For a format with a `compose` block, the on-card headline and points are typeset by the composer from the pinned Noto Sans SC font through headless Chromium. The `xhs-card` template no longer interpolates `headline`, `points` or `language`, so the provider prompt carries no card copy. (0181 adds the fail-loud guard that enforces this for every composing format.)
- [ ] R2. The composed card is a PNG of exactly the format's `width`x`height` (xhs-card: 1080x1440), whatever size the provider delivered. The headline renders at ≥ 64px and bullets at ≥ 36px, and every text box lies inside the safe area (72px inset). Copy that cannot fit at the minimum sizes fails loud, naming the card field (`headline` or `points[i]`). It is never clipped and never shrunk below the floor.
- [ ] R3. Composition is a pure function of (headline, points, role, compose block, font bytes, illustration bytes). Two composes of the same input on the same install produce byte-identical PNGs, verified by SHA-256.
- [ ] R4. Before any provider spend, every character of the headline and points is checked against the font's `cmap`. The first uncovered character fails loud with its code point and field, e.g. `compose: headline has U+1F600 '😀' not covered by NotoSansSC-Bold`. Whitespace and line breaks are exempt. Chromium's system-font fallback can never supply a glyph.
- [ ] R5. All composer checks run pre-spend, including under `KK_IMAGE_DRY_RUN=1`, via one text-only compose with no illustration. After spend, image-gen writes the raw illustration artifact and the composed card, and both are cleaned up on failure (`written[]`). `ImageArtifact.path` is the composed card. `ImageArtifact.illustration = { path, width, height, bytes }` records the raw provider image. `xhs-pub` reads only `.path`, so the publish DTO stays unchanged.
- [ ] R6. Formats without `compose` behave exactly as before (cover, daily-news-cover, free, illustration).

### Acceptance Criteria

- [ ] AC1 — Card copy is set with real type, not generated pixels (req: R1, R5, R6)
- [ ] AC2 — The declared canvas is the delivered canvas (req: R2)
- [ ] AC3 — Composition is deterministic and resumable (req: R3)
- [ ] AC4 — Missing font coverage fails loud (req: R4)

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

- [ ] ADR-028 in `docs/00_ADR.md`: card text is typeset, not generated. It covers image-gen's Playwright runtime and
      the shipped OFL font.
- [ ] Download the fonts per Q&A; add `assets/fonts/{NotoSansSC-Regular.otf,NotoSansSC-Bold.otf,OFL.txt,SOURCE.md}`.
- [ ] Write tests 1-9 and confirm they fail.
- [ ] `src/compose/cmap.ts`, `card.ts`, `chromium.ts`.
- [ ] `compose` in `FormatPresetSchema`; update the `xhs-card.yaml` block and template.
- [ ] Integrate in `src/index.ts`; add `illustration` to `ImageArtifact`; add `playwright` to the image-gen
      `package.json`.
- [ ] Update `tests/presets.test.ts:330-360`. The xhs-card prompt now **excludes** headline/points/language, and the
      `language` variable is gone.
- [ ] Docs, same commit (T3): `docs/04_DESIGN.md` (format `compose` block, `ImageArtifact.illustration`),
      `docs/03_ARCHITECTURE.md` (image-gen composes for `compose` formats), and the `docs/design/xhs-image-cards.md`
      "Decision and boundary" paragraph.
- [ ] `bun run build` and verify the staged bundle: `dist/` of image-gen resolves `assets/fonts` and keeps
      `playwright` external. Then `bun run gate`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

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

