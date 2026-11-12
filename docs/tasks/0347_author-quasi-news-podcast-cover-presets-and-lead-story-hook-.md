---
schema_version: 1
name: Author quasi-news podcast cover presets and lead-story Hook headline extraction
status: done
template: feature-impl
created_at: 2026-11-10T04:05:28.042Z
updated_at: "2026-11-10T23:50:24.602Z"
feature_id: L2
priority: P1

done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0347-verdict.json
---

## 0347. Author quasi-news podcast cover presets and lead-story Hook headline extraction

### Background

Implements Feature L2 scenarios R1 and R2: provides the image-gen format and style presets for quasi-news podcast covers (1344x576 at 21:9) and updates news-editorial to author both cover visual scene prompts and punchy Chinese Hook headlines from the lead story.

The existing Daily AI News cover generation pipeline relies on `daily-news-cover.yaml` and `daily-news.yaml` (plugins/generations/image-gen/presets/), which produce abstract flat vector illustrations. While clean, they lack the clickability and urgent storytelling of quasi-news podcast covers (天下杂志 Video, Focus 全球新闻, breaking news style). This task establishes the preset foundation and editorial extraction contract needed for the two-layer quasi-news cover pipeline defined in ADR-046 and docs/design/daily-news-podcast-cover.md.

**Refine corrections (2026-11-10)**
- Parent feature re-anchored: Feature Q was moved to L2 (docs/features/L2_daily-ai-voice-quasi-news-podcast-cover.md) under parent L.
- Presets inventory audit: Discovered that plugins/generations/image-gen/tests/presets.test.ts strictly asserts format inventory size (5 -> 6) and style inventory size (12 -> 13). Test suite must be updated alongside preset files.
- Editorial schema extension: Frozen EditorialCover interface in plugins/kk/scripts/daily-stages.ts and plugins/kk/skills/news-editorial/SKILL.md, supporting `{ scene: string, headline: string }` while preserving backward-compatible fallback for legacy string cover fields.
- Output contract: editorial-render stage outputs 23-cover/<date>_07_cover-brief.json with `{ subject, headline, leadStoryTitle }`.

### Requirements

- [x] R1. Author format preset `plugins/generations/image-gen/presets/formats/daily-news-podcast-cover.yaml`: aspect ratio 21:9 (1344x576), job `cover`, default style `quasi-news-podcast`, subject variable with fallback, and composition prompt leaving negative space in the lower-third for headline typography.
- [x] R2. Author style preset `plugins/generations/image-gen/presets/styles/quasi-news-podcast.yaml`: editorial documentary photography, cinematic lighting, dramatic contrast, deep navy/slate shadows, bold focal subject, and strict negative text prompt (`text, letters, words, numbers, captions, watermark, logo, brand marks, flags, real people, recognizable faces, blur, clutter`).
- [x] R3. Update preset inventory tests in `plugins/generations/image-gen/tests/presets.test.ts`: extend expected format set to include `daily-news-podcast-cover` (6 formats) and expected style set to include `quasi-news-podcast` (13 styles), verifying prompt composition and negative prompt preservation.
- [x] R4. Extend `plugins/kk/skills/news-editorial/SKILL.md` (lines 69-82) and `references/style-contract.zh.md` (lines 50, 68): allow `cover` field in the master script plan to be `{ scene: string, headline: string }`, where `scene` is an English visual description (<=240 chars) and `headline` is a 1-2 lines Chinese Hook headline (<=25 chars/line) grounded in the lead news story.
- [x] R5. Update `editorialRender` in `plugins/kk/scripts/daily-stages.ts` (lines 4402-4414): write `23-cover/<date>_07_cover-brief.json` containing `{ subject: string, headline: string, leadStoryTitle: string }`, extracting `headline` from `master.cover.headline` (or falling back to lead story title if `cover` is a legacy string).
- [x] R6. Add unit test coverage in `plugins/kk/tests/daily-stages.test.ts` (or `kk-workflow-stages.test.ts`) validating both legacy string cover and new `{ scene, headline }` object parsing during `editorialRender`.

### Acceptance Criteria

- [x] AC1 — 准新闻播客封面 preset 定义与视觉规格固化 (req: R1, R2, R3)
  - `bun test plugins/generations/image-gen/tests/presets.test.ts` passes with 0 failures.
  - `daily-news-podcast-cover` format declares width 1344, height 576, aspectRatio '21:9', defaultStyle 'quasi-news-podcast', and outputFilename 'daily-news-podcast-cover.png'.
  - `quasi-news-podcast` style declares negative text prompts forbidding text, letters, watermarks, and brand marks.
- [x] AC2 — 重大新闻 Hook 大标题与视觉主体提取契约 (req: R4, R5, R6)
  - `editorialRender` reads master script plan with `{ cover: { scene: "...", headline: "..." } }` and writes `23-cover/<date>_07_cover-brief.json` with `{ subject, headline, leadStoryTitle }`.
  - When master script plan contains legacy string `cover: "..."`, `editorialRender` preserves backwards compatibility by assigning `subject = master.cover` and falling back to lead item's title for `leadStoryTitle`.
  - Unit test in `plugins/kk/tests/daily-stages.test.ts` passes.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

#### Approach

1. **Format Preset Schema** (`plugins/generations/image-gen/presets/formats/daily-news-podcast-cover.yaml`):
```yaml
name: daily-news-podcast-cover
description: Daily AI quasi-news podcast episode cover — fixed ultrawide composition with lower-third negative space for headline text
job: cover
aspectRatio: '21:9'
width: 1344
height: 576
defaultStyle: quasi-news-podcast
keywords: [editorial documentary, dramatic contrast, news podcast, lead story scene]
outputFilename: 'daily-news-podcast-cover.png'
variables:
    subject:
        description: Concrete visual scene for the day's lead story (objects, settings, symbols, dramatic lighting; no text)
        default: an illuminated advanced semiconductor wafer glowing under industrial microscope inspection in a dark cleanroom
template: |-
    Ultrawide quasi-news podcast cover background scene for a daily technology news report.
    Scene: {{subject | an illuminated advanced semiconductor wafer glowing under industrial microscope inspection in a dark cleanroom}}.
    Composition: dramatic cinematic lighting, clear focal subject in upper-center or right-third, generous dark negative space in the lower third for headline text overlay, uncluttered background.
    Atmosphere: urgent, authoritative, investigative, cutting-edge technology journalism.
```

2. **Style Preset Schema** (`plugins/generations/image-gen/presets/styles/quasi-news-podcast.yaml`):
```yaml
name: quasi-news-podcast
description: House style for quasi-news podcast cover — editorial documentary photography, dramatic contrast, deep navy/slate shadows
modifiers: editorial documentary photography, cinematic dramatic lighting, high contrast, deep navy and slate shadows, crisp focal subject, clean composition, uncluttered lower third
palette:
    - { role: background, name: deep navy slate, hex: '#0A1424' }
    - { role: primary, name: signal white, hex: '#FFFFFF' }
    - { role: accent, name: urgent amber, hex: '#FFB800' }
negative: text, letters, words, numbers, captions, watermark, logo, brand marks, flags, real people, recognizable faces, blurry, clutter, distorted graphics
source: { kind: authored }
```

3. **Master Script Plan & Brief Schemas**:
```ts
export interface EditorialCover {
    scene: string; // English visual description (<=240 chars)
    headline: string; // Chinese hook headline for lead story (1-2 lines, <=25 chars/line)
}

export interface CoverBriefData {
    subject: string;
    headline: string;
    leadStoryTitle: string;
}
```

In `editorialRender` (`plugins/kk/scripts/daily-stages.ts:4402`):
```ts
const rawCover = master.cover;
let coverSubject = '';
let coverHeadline = '';
if (typeof rawCover === 'string') {
    coverSubject = rawCover.trim();
} else if (rawCover !== null && typeof rawCover === 'object') {
    const obj = rawCover as Record<string, unknown>;
    coverSubject = typeof obj.scene === 'string' ? obj.scene.trim() : '';
    coverHeadline = typeof obj.headline === 'string' ? obj.headline.trim() : '';
}
const leadId = orderedIds[0];
const leadDoc = leadId ? docById.get(leadId) : undefined;
const leadStoryTitle = typeof leadDoc?.title === 'string' ? leadDoc.title.trim() : '';
if (!coverHeadline && leadStoryTitle) {
    coverHeadline = leadStoryTitle;
}
if (coverSubject !== '') {
    const coverDir = join(workDir, '23-cover');
    sted('mkdir', coverDir, () => mkdirSync(coverDir, { recursive: true }));
    const coverOut = join(coverDir, `${runDate}_07_cover-brief.json`);
    sted('write', coverOut, () => writeJsonText(coverOut, {
        subject: coverSubject,
        headline: coverHeadline,
        leadStoryTitle,
    }));
    console.log(`editorial-render: wrote cover brief: ${coverOut}`);
}
```

#### Invariants
- Pixel resolution stays pinned at 1344x576 at 21:9.
- Negative text prompt strictly preserved on diffusion layer to prevent AI glyph distortion.
- Backward compatibility: If `master.cover` is a legacy string, `editorialRender` continues to write valid `cover-brief.json` with `subject` and uses `leadStoryTitle` as fallback `headline`.
- All Biome and typecheck rules adhere to 4-space indent and Biome 2.5.15.

#### Rejected Alternatives
- Direct model generation of Chinese characters inside diffusion prompts: rejected due to unpredictable glyph hallucinations and character degradation.
- Omitting negative prompt on diffusion layer: rejected to prevent rogue AI watermarks or pseudo-letters.

### Plan

1. Author `plugins/generations/image-gen/presets/formats/daily-news-podcast-cover.yaml` matching the format schema.
2. Author `plugins/generations/image-gen/presets/styles/quasi-news-podcast.yaml` matching the style schema.
3. Update `plugins/generations/image-gen/tests/presets.test.ts` to expect 6 formats (including `daily-news-podcast-cover`) and 13 styles (including `quasi-news-podcast`), and add assertion testing prompt composition with negative text prompt. Run `bun test plugins/generations/image-gen/tests/presets.test.ts`.
4. Update `plugins/kk/skills/news-editorial/SKILL.md` (lines 69-82) and `plugins/kk/skills/news-editorial/references/style-contract.zh.md` to document the dual `{ scene, headline }` contract for `cover`.
5. Update `editorialRender` in `plugins/kk/scripts/daily-stages.ts` (lines 4402-4414) to parse `{ scene, headline }` or legacy string, resolving `headline` and `leadStoryTitle` into `23-cover/<date>_07_cover-brief.json`.
6. Add unit tests in `plugins/kk/tests/daily-stages.test.ts` verifying `cover-brief.json` output for both string and object cover inputs.
7. Run `bun run lint && bun test` to verify gate readiness.

### Solution

- R1 `plugins/generations/image-gen/presets/formats/daily-news-podcast-cover.yaml` (new): cover job pinned at 21:9 / 1344×576, `defaultStyle: quasi-news-podcast`, single `subject` variable with fixed default scene, template reserves lower-third negative space for the headline overlay (ADR-046 two-layer pipeline).
- R2 `plugins/generations/image-gen/presets/styles/quasi-news-podcast.yaml` (new): editorial documentary photography modifiers, deep navy slate / signal white / urgent amber palette, strict anti-glyph negative (text, letters, words, numbers, captions, watermark, logo, brand marks, flags, real people, recognizable faces).
- R3 `plugins/generations/image-gen/tests/presets.test.ts`: inventory extended to 6 formats / 13 styles (two existing assertions + shadow-diagnostic key list); new describe `quasi-news podcast cover presets (L2 0347 R1-R3)` pinning geometry, default style, outputFilename, negative text ban and a subject-only compose test.
- R4 `plugins/kk/skills/news-editorial/SKILL.md:69` cover bullet now documents the dual `{ scene, headline }` contract (scene ≤240 chars English; headline 1–2 Chinese lines ≤25 chars/line); `:80` JSON example shows the object form; `:104` cap list gains `coverHeadline`. `plugins/kk/skills/news-editorial/references/style-contract.zh.md:50` mirrors the dual contract; `:68` caps add `coverHeadline: 25`.
- R5 `plugins/kk/scripts/daily-stages.ts` (`dailyEditorialRender` cover-brief block): parses `master.cover` as legacy string or `{ scene, headline }` object; resolves `leadStoryTitle` from the first ordered plan doc; headline falls back to it when absent; writes `23-cover/<date>_07_cover-brief.json` with `{ subject, headline, leadStoryTitle }`. `coverSubject` stays in scope for the existing XHS first-card fallback.
- R6 `plugins/kk/tests/kk-workflow-stages.test.ts`: new describe `daily-editorial-render cover brief (task 0347 R5/R6)` — object cover writes all three fields; legacy string preserves backward compatibility with lead-title headline fallback; object cover without headline inherits the lead title.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `plugins/generations/image-gen/presets/formats/daily-news-podcast-cover.yaml:1-17` names daily-news-podcast-cover, job cover, aspectRatio 21:9, width 1344, height 576, defaultStyle quasi-news-podcast, subject variable, and lower-third negative space. Asserted at `plugins/generations/image-gen/tests/presets.test.ts:511-528`. Command `bun test plugins/generations/image-gen/tests/presets.test.ts` exited 0 with 34 pass and 0 fail. |
| R2 | MET | `plugins/generations/image-gen/presets/styles/quasi-news-podcast.yaml:1-8` sets editorial documentary photography, cinematic dramatic lighting, deep navy/slate palette `#0A1424` / `#FFFFFF` / `#FFB800`, and negative `text, letters, words, numbers, captions, watermark, logo, brand marks, flags, real people, recognizable faces, blurry, clutter, distorted graphics`. That negative string is the approved Design text. Asserted at `plugins/generations/image-gen/tests/presets.test.ts:531-540`. |
| R3 | MET | Inventory is six formats and thirteen styles, including daily-news-podcast-cover and quasi-news-podcast, at `plugins/generations/image-gen/tests/presets.test.ts:321-348`. Prompt composition and negative preservation are at `plugins/generations/image-gen/tests/presets.test.ts:543-563`. Same presets command: 34 pass, 0 fail. |
| R4 | MET | `plugins/kk/skills/news-editorial/SKILL.md:69` allows cover as an English scene or `{ scene, headline }` with headline 1-2 Chinese lines at 25 characters. Example object at `plugins/kk/skills/news-editorial/SKILL.md:80`. `plugins/kk/skills/news-editorial/references/style-contract.zh.md:50` states the same contract. Machine cap `coverHeadline` 25 at `plugins/kk/skills/news-editorial/references/style-contract.zh.md:69`. |
| R5 | MET | `plugins/kk/scripts/daily-stages.ts:4440-4468` reads master.cover as a legacy string or `{ scene, headline }`, falls back an empty headline to the lead story title, and writes `23-cover/<date>_07_cover-brief.json` with subject, headline, and leadStoryTitle. |
| R6 | MET | R6 allows `plugins/kk/tests/kk-workflow-stages.test.ts`. Describe `daily-editorial-render cover brief (task 0347 R5/R6)` at `plugins/kk/tests/kk-workflow-stages.test.ts:934`. Object form at `:960-974`, legacy string fallback at `:976-985`, object without headline at `:988-996`. Command `bun test plugins/kk/tests/kk-workflow-stages.test.ts` exited 0 with 62 pass and 0 fail. Filtered `cover brief` run exited 0 with 3 pass and 0 fail. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R1 — 准新闻播客封面 preset 定义与视觉规格固化 | MET | test | `bun test plugins/generations/image-gen/tests/presets.test.ts` exited 0, 34 pass, 0 fail. Format pins at `plugins/generations/image-gen/presets/formats/daily-news-podcast-cover.yaml:3-9` and `plugins/generations/image-gen/tests/presets.test.ts:519-524`. Negative bans for text, letters, watermark, and brand marks at `plugins/generations/image-gen/presets/styles/quasi-news-podcast.yaml:8` and `plugins/generations/image-gen/tests/presets.test.ts:538-540`. |
| R2 — 重大新闻 Hook 大标题与视觉主体提取契约 | MET | test | Object cover writes subject, headline, and leadStoryTitle at `plugins/kk/tests/kk-workflow-stages.test.ts:960-971`. Legacy string sets subject from the cover string and headline from the lead title at `plugins/kk/tests/kk-workflow-stages.test.ts:976-984`. Writer at `plugins/kk/scripts/daily-stages.ts:4443-4468`. `bun test plugins/kk/tests/kk-workflow-stages.test.ts` exited 0, 62 pass, 0 fail. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Three-dimensional review (functional traceability + SECUA + architecture) over the 0347 diff; full gate receipt 4835 pass / 0 fail (tree 9632fd53); cited suites replayed standalone (presets 34/0, kk-workflow-stages 62/0, daily-triage 11/0).

| P | Finding | Disposition |
|---|---------|-------------|
| P4 | `bunfig.toml` adds 2 coverage ignores for stage-runner bodies (`daily-stages.ts`, `kk-workflow-stages.ts`) exercised only via spawned `kk stage` subprocesses bun cannot attribute coverage to; inline why-comment matches the existing 8 entries | ACCEPTED — attribution limitation, subprocess e2e asserts cover the behavior |
| P4 | 18 binary sample JPGs under `plugins/generations/image-gen/assets/sample/` add repo weight | ACCEPTED — README gallery convention; spend user-authorized |
| P4 | `daily-triage-core.ts` ANSI fix adds one `biome-ignore` for the ESC-byte regex | ACCEPTED — the control byte is the match target; root-cause fix covered by 11/11 triage tests |

Residual risk: none open — no P1-P3 findings; preset addition follows the shipped pinned format x style compose pattern; cover dual-shape stays inside editorial-render's existing union with legacy-string compatibility.

Verdict: PASS

Confidence: HIGH

### References

- Parent Feature: [L2: daily-ai-voice-quasi-news-podcast-cover](file:///Users/robin/xprojects/knowledge-kit/docs/features/L2_daily-ai-voice-quasi-news-podcast-cover.md)
- Architecture Decision: [ADR-046](file:///Users/robin/xprojects/knowledge-kit/docs/00_ADR.md#L1678)
- Design Satellite: [docs/design/daily-news-podcast-cover.md](file:///Users/robin/xprojects/knowledge-kit/docs/design/daily-news-podcast-cover.md)
- Follow-up Task: [0348](file:///Users/robin/xprojects/knowledge-kit/docs/tasks/0348_implement-deterministic-chinese-typography-compositing-and-p.md)

### History

- 2026-11-10T04:28:44.581Z feature_id Q → L2 (system)
- 2026-11-10T04:53:44.719Z todo → wip (system)
- 2026-11-10T18:33:03.054Z wip → testing (system)
- 2026-11-10T18:33:05.737Z testing → done (system)

