---
schema_version: 1
name: Implement deterministic Chinese typography compositing and podcast logo overlay
status: done
template: feature-impl
created_at: 2026-11-10T04:05:28.048Z
updated_at: "2026-11-10T20:19:01.716Z"
feature_id: L2
priority: P1

dependencies: ["0347"]
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0348-verdict.json
---

## 0348. Implement deterministic Chinese typography compositing and podcast logo overlay

### Background

Implements Feature L2 scenarios R3 and R4: creates a deterministic typography and branding compositor that overlays Chinese headline text and the podcast logo badge onto AI news backgrounds without character corruption.

In the quasi-news podcast cover system, AI diffusion models generate clean, dramatic background imagery with strict negative text prompts, while the typography layer deterministically renders Chinese headlines and branding badges. This completely eliminates glyph hallucinations and character degradation. The compositor also anchors the podcast emblem from `assets/general/xhxs.svg` in the upper corner, cleanly omitting the lower `SALTY CLUB` text portion to maintain clean visuals.

**Refine corrections (2026-11-10)**
- Parent feature re-anchored: Feature Q was moved to L2 (docs/features/L2_daily-ai-voice-quasi-news-podcast-cover.md).
- Rendering engine verified: macOS native `sips` reliably transcodes SVG overlays with embedded PNG backgrounds, system Chinese fonts (PingFang SC), and gradient scrims into 1344x576 PNGs without external native image dependencies.
- Logo asset and simplification: `assets/general/xhxs.svg` (viewBox 0 0 1095 1095) has its lower text portion (`SALTY CLUB`, Y >= 780) stripped via viewBox re-clipping (`0 0 1095 760`), displaying only the clean central emblem at the top-left corner.
- Stage placement: Compositor is encapsulated in `plugins/kk/scripts/cover-compositor.ts` and called during `dailyCoverNormalize` in `plugins/kk/scripts/daily-stages.ts` / `plugins/kk/scripts/kk-workflow-stages.ts`.

### Requirements

- [x] R1. Create `plugins/kk/scripts/cover-compositor.ts`: build an SVG overlay generator and compositing engine that takes an input background image, Chinese headline text, and logo asset to output a 1344x576 PNG.
- [x] R2. Implement deterministic Chinese typography layout in `cover-compositor.ts`: support 1-2 lines of headline text with system font fallbacks (`PingFang SC, Hiragino Sans GB, "Noto Sans CJK SC", sans-serif`), bold sizing (44-52px), pure white/signal yellow text fills, drop-shadow filters, and a dark vertical gradient scrim in the lower-third for maximum readability.
- [x] R3. Implement podcast branding badge overlay in `cover-compositor.ts`: load `assets/general/xhxs.svg`, strip the lower `SALTY CLUB` text by adjusting the viewBox/clip boundary to `0 0 1095 760`, and place the emblem inside a compact rounded badge in the top-left corner (x: 48, y: 40, size: 80x80).
- [x] R4. Provide `compositeCover(options: CoverCompositorOptions): Promise<string> | string`: execute compositing using macOS `sips` (wrapping background and overlays into an SVG container and rendering to PNG), preserving fail-fast error handling if transcoding fails.
- [x] R5. Integrate compositor into `dailyCoverNormalize` in `plugins/kk/scripts/daily-stages.ts` and `plugins/kk/scripts/kk-workflow-stages.ts`: read `23-cover/<date>_07_cover-brief.json`; if `headline` is present, composite headline and logo onto the normalized cover before final publication handoff.
- [x] R6. Unit test `cover-compositor.ts` in `plugins/kk/tests/cover-compositor.test.ts`: test headline line-wrapping, logo SVG extraction without `SALTY CLUB`, SVG template generation, and composite rendering.

### Acceptance Criteria

- [x] AC1 — 中文大标题排版与播客品牌 Logo 确定性图层合成 (req: R1, R2, R3, R4)
  - `plugins/kk/scripts/cover-compositor.ts` renders 1-2 lines of Chinese text without glyph distortion or missing characters.
  - Lower `SALTY CLUB` text is omitted from the rendered logo badge, displaying only the upper emblem.
  - Rendered composite image matches 1344x576 at 21:9 aspect ratio in valid PNG format.
  - `bun test plugins/kk/tests/cover-compositor.test.ts` passes.
- [x] AC2 — 模块化封面生成与合成技能封装 (req: R5, R6)
  - `dailyCoverNormalize` detects `headline` from `cover-brief.json` and runs `compositeCover`.
  - When `headline` is absent or empty, falls back gracefully to normalizing the raw background image without breaking downstream stages.
  - Integration tests in `plugins/kk/tests/daily-cover-normalize.test.ts` pass.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

#### Approach

1. **Module Architecture** (`plugins/kk/scripts/cover-compositor.ts`):
```ts
export interface CoverCompositorOptions {
    backgroundImagePath: string;
    headline: string;
    leadStoryTitle?: string;
    logoPath?: string; // defaults to assets/general/xhxs.svg
    outputPath: string;
    width?: number; // default 1344
    height?: number; // default 576
}

export function buildCoverSvg(options: CoverCompositorOptions): string;
export function compositeCover(options: CoverCompositorOptions): string;
```

2. **SVG Template Structure**:
- Base layer: `<image href="${bgPath}" width="1344" height="576" preserveAspectRatio="xMidYMid slice" />`
- Scrim layer: `<rect x="0" y="260" width="1344" height="316" fill="url(#bottomScrim)" />`
  where `#bottomScrim` is a linear gradient from `rgba(10,20,36,0)` to `rgba(10,20,36,0.92)`.
- Brand Logo badge:
  Extract path or embed `<svg viewBox="0 0 1095 760" x="48" y="40" width="72" height="50">...`
  Cropping `viewBox="0 0 1095 760"` completely cuts off the `SALTY CLUB` text located below Y=780.
  Add a subtle translucent pill/square backdrop `<rect x="36" y="30" width="96" height="70" rx="12" fill="rgba(10,20,36,0.7)" />`.
- Chinese Typography layer:
  Split `headline` into 1 or 2 lines (by explicit `\n` or splitting <= 25 characters per line).
  Line 1: `font-size: 46px; font-weight: 800; fill: #FFFFFF; font-family: PingFang SC, Hiragino Sans GB, "Noto Sans CJK SC", sans-serif;`
  Line 2 (if present): `font-size: 32px; font-weight: 700; fill: #FFB800;`
  Text drop shadow: `filter="url(#textShadow)"` with dx=0, dy=3, stdDeviation=6, flood-color="rgba(0,0,0,0.85)".
- Media audio indicator:
  Lower-right podcast headphone / soundwave icon or "DAILY AI PODCAST" subtitle tag.

3. **Rendering Pipeline**:
- Write intermediate SVG to `${tempDir}/composite.svg`.
- Run `sips -s format png ${tempDir}/composite.svg --out ${outputPath}`.
- If `sips` exits non-zero or is absent, fail loud with actionable error message (consistent with `kk-workflow-stages.ts:1040`).

4. **Integration Seam**:
- In `dailyCoverNormalize` (`plugins/kk/scripts/daily-stages.ts:614` / `kk-workflow-stages.ts:1020`):
  After transcoding/moving raw background to `${runDate}_07_cover_cover.png`, check for `23-cover/${runDate}_07_cover-brief.json`.
  If `headline` is populated, call `compositeCover({ backgroundImagePath: tempBackground, headline, outputPath: out })`.

#### Invariants
- 100% crisp Chinese typography with zero AI diffusion character distortion.
- Logo badge retains the emblem while omitting `SALTY CLUB`.
- Output PNG maintains exact dimensions: 1344x576 at 21:9.
- Graceful degradation: if headline is blank or missing, raw background is preserved.

#### Rejected Alternatives
- Direct model diffusion of Chinese text: rejected due to uncontrollable hallucinated glyphs.
- Heavy external canvas/node-canvas C++ bindings: rejected to avoid breaking Bun cross-platform builds when `sips` already ships with macOS.
- Including full show title text in logo badge: rejected per user request to keep visuals uncluttered.

### Plan

1. Create `plugins/kk/scripts/cover-compositor.ts` implementing `buildCoverSvg`, logo SVG extraction with `viewBox="0 0 1095 760"`, typography styling, and `compositeCover` via `sips`.
2. Implement headline line breaking and font fallback styling with drop shadows and scrim backing.
3. Add unit tests in `plugins/kk/tests/cover-compositor.test.ts` covering SVG generation, headline wrapping, logo clipping, and image compositing. Run `bun test plugins/kk/tests/cover-compositor.test.ts`.
4. Integrate `compositeCover` into `coverNormalizeBody` in `plugins/kk/scripts/kk-workflow-stages.ts:1020` and `plugins/kk/scripts/daily-stages.ts:614`, reading `headline` from `cover-brief.json`.
5. Add integration test in `plugins/kk/tests/daily-cover-normalize.test.ts` verifying that `dailyCoverNormalize` produces a composited cover when headline is present and raw cover when headline is empty.
6. Verify with `bun run lint && bun test`.

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `apps/cli/tests/kk-workflow-stages.test.ts:283` |
| `apps/cli/tests/kk-workflow-stages.test.ts:32` |
| `apps/cli/tests/kk-workflow-stages.test.ts:4436` |
| `plugins/kk/scripts/cover-compositor.ts:1` |
| `plugins/kk/scripts/kk-workflow-stages.ts:1020` |
| `plugins/kk/scripts/kk-workflow-stages.ts:1074` |
| `plugins/kk/scripts/kk-workflow-stages.ts:59` |
| `plugins/kk/tests/cover-compositor.test.ts:1` |
| `plugins/kk/tests/daily-cover-normalize.test.ts:1` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | plugins/kk/scripts/cover-compositor.ts:13 (`CoverCompositorOptions`), cover-compositor.ts:87 (`buildCoverSvg` 1344×576 canvas), cover-compositor.ts:129 (`compositeCover` sips render); asserted by plugins/kk/tests/cover-compositor.test.ts (command: `bun test plugins/kk/tests/cover-compositor.test.ts`) |
| R2 | MET | plugins/kk/scripts/cover-compositor.ts:27 (HEADLINE_LINE_CAP 25), cover-compositor.ts:28 (PingFang SC fallback stack), cover-compositor.ts:96-102 (46px/800 #FFFFFF line 1, 32px/700 #FFB800 line 2, textShadow filter), cover-compositor.ts:91 (bottomScrim gradient over lower half); wrap/truncate asserted by plugins/kk/tests/cover-compositor.test.ts (command: `bun test plugins/kk/tests/cover-compositor.test.ts`) |
| R3 | MET | plugins/kk/scripts/cover-compositor.ts:70 (`logoBadgeSvg` re-clips viewBox to `0 0 1095 760`, cropping the SALTY CLUB band at Y≥780), cover-compositor.ts:83-85 (badge rect x36 y30 96×70 rx12 + emblem at 48,40 72×50); asserted by plugins/kk/tests/cover-compositor.test.ts (badge geometry + viewBox clip) |
| R4 | MET | plugins/kk/scripts/cover-compositor.ts:129 (`compositeCover(options): string` — writes overlay svg, wraps `sips -s format png`, fail-fast on missing binary, nonzero status, or missing output file); asserted by plugins/kk/tests/cover-compositor.test.ts (mac-only 1344×576 render + platform-neutral loud-failure) |
| R5 | MET | plugins/kk/scripts/kk-workflow-stages.ts:1021 (`briefHeadline` reads `headline` from `23-cover/<date>_07_cover-brief.json`), kk-workflow-stages.ts:1074-1087 (composite seam in `coverNormalizeBody`, graceful skip when absent/empty); daily-stages.ts:629 `dailyCoverNormalize` delegates to the same body — both callers covered; asserted by plugins/kk/tests/daily-cover-normalize.test.ts |
| R6 | MET | plugins/kk/tests/cover-compositor.test.ts (wrapHeadline, logo clipping, svg template, real sips render) + plugins/kk/tests/daily-cover-normalize.test.ts (brief variants incl. jpg transcode + composite, 19 tests total, 100% funcs / 97.4% lines) (command: `bun test plugins/kk/tests/cover-compositor.test.ts plugins/kk/tests/daily-cover-normalize.test.ts`) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 [R3] | MET | test | plugins/kk/tests/cover-compositor.test.ts — glyph-safe deterministic typography (XML-escaped, wrapped ≤2×25), SALTY CLUB-free badge (viewBox 0 0 1095 760), 1344×576 PNG render verified via `sips -g pixelWidth` (19 pass / 0 fail, replayed) |
| AC2 [R4] | MET | test | plugins/kk/tests/daily-cover-normalize.test.ts — `dailyCoverNormalize` composites when `headline` present (pixelWidth 1344) and preserves the raw cover when absent/empty (platform-neutral mv path); 19 pass / 0 fail, replayed |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Findings (none open at P1-P3):

| P | Finding | Disposition |
|---|---------|-------------|
| P4 | `leadStoryTitle` is accepted by `CoverCompositorOptions` (cover-compositor.ts:17) but the SVG template does not render it | Accept — interface parity with the task Design contract; template omits it deliberately per the uncluttered-visuals decision |
| P4 | Headlines beyond the style contract's 2×25 caps are silently ellipsized by `wrapHeadline` (cover-compositor.ts:40) | Accept — last-resort guard; upstream news-editorial enforces the cap at authoring time (0347); truncation path unit-tested |
| P4 | `compositeCover` depends on macOS `sips` with no Linux fallback | Accept — ADR-046 refine verified sips as the rendering engine; ubuntu CI skips the render via `it.skipIf(darwin)`, failure path covered platform-neutrally |

SECUA: headline text XML-escaped before template interpolation (`esc`, cover-compositor.ts:32,
tested); `spawnSync` argv-array only, no shell; intermediate SVG removed in `finally`; no secrets,
no trust-boundary changes; fixtures use `mkdtemp` + bounded cleanup.
Architecture: composite seam implemented once in shared `coverNormalizeBody`
(kk-workflow-stages.ts:1074-1087) — both stage callers covered without duplication;
`cover-compositor.ts` imports node builtins only; output artifact name unchanged so downstream
stages need no edits; graceful degradation asserted platform-neutrally (missing/malformed/empty
brief keeps the raw cover).

Review verdict evidence: 0348 review cert (6 requirements MET, AC1 [R3] MET, AC2 [R4] MET);
19 new tests pass (100% funcs / 97.4% lines); full gate PASS receipt tree d960b4fe.

Verdict: PASS

Confidence: HIGH

### References

- Parent Feature: [L2: daily-ai-voice-quasi-news-podcast-cover](file:///Users/robin/xprojects/knowledge-kit/docs/features/L2_daily-ai-voice-quasi-news-podcast-cover.md)
- Prerequisite Task: [0347](file:///Users/robin/xprojects/knowledge-kit/docs/tasks/0347_author-quasi-news-podcast-cover-presets-and-lead-story-hook-.md)
- Architecture Decision: [ADR-046](file:///Users/robin/xprojects/knowledge-kit/docs/00_ADR.md#L1678)
- Design Satellite: [docs/design/daily-news-podcast-cover.md](file:///Users/robin/xprojects/knowledge-kit/docs/design/daily-news-podcast-cover.md)
- Logo Asset: [assets/general/xhxs.svg](file:///Users/robin/xprojects/knowledge-kit/assets/general/xhxs.svg)
- Follow-up Task: [0349](file:///Users/robin/xprojects/knowledge-kit/docs/tasks/0349_integrate-into-kk-daily-ai-voice3-workflow-and-provide-stand.md)

### History

- 2026-11-10T04:28:44.581Z feature_id Q → L2 (system)
- 2026-11-10T20:16:42.498Z todo → wip (system)
- 2026-11-10T20:18:59.519Z wip → testing (system)
- 2026-11-10T20:19:01.704Z testing → done (system)

