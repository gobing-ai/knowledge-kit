---
schema_version: 1
name: Integrate into kk-daily-ai-voice3 workflow and provide standalone mock test runner
status: todo
template: feature-impl
created_at: 2026-11-10T04:05:28.049Z
updated_at: "2026-11-10T04:37:36.062Z"
feature_id: L2
priority: P1

dependencies: ["0348"]
---

## 0349. Integrate into kk-daily-ai-voice3 workflow and provide standalone mock test runner

### Background

Implements Feature L2 scenarios R5 and R6: wires the new cover generation and normalization into `plugins/kk/workflows/kk-daily-ai-voice3.yaml` and creates a standalone mock test runner for isolated, immediate cover verification without waiting for daily cron runs.

With presets (0347) and the typography/branding compositor (0348) established, this task completes the end-to-end pipeline:
1. Updates the `cover` stage in `kk-daily-ai-voice3.yaml` and `kk-workflow-stages.ts` to use `daily-news-podcast-cover` and `quasi-news-podcast`.
2. Implements a dedicated standalone mock test runner (`plugins/kk/scripts/daily-cover-mock.ts`) that accepts simulated news headlines and visual prompts (with optional `--mock-bg` for instant zero-token testing or `--provider` for live diffusion runs), generating and validating the final 1344x576 composite cover.
3. Ensures downstream packaging compatibility (`dailyPublishPrep`, `dailyBundleVariants`, `dailyCardsRender`, surfdash/podcast publishing).

**Refine corrections (2026-11-10)**
- Parent feature re-anchored: Feature Q was moved to L2 (docs/features/L2_daily-ai-voice-quasi-news-podcast-cover.md).
- Standalone test runner interface: Implemented as `plugins/kk/scripts/daily-cover-mock.ts` supporting `--headline`, `--scene`, `--out`, and `--mock-bg` flags for deterministic, hermetic verification without waiting for daily cron cycles or spending AI tokens during local CI.
- Downstream contract audit: Confirmed that downstream nodes (`publish-prep`, `cards-render`, `cards-package`) consume `${work_dir}/23-cover/${runDate}_07_cover_cover.png`; the composited output strictly retains this exact filename and 1344x576 PNG specification.

### Requirements

- [ ] R1. Update cover stage configuration in `plugins/kk/scripts/kk-workflow-stages.ts:88` and `plugins/kk/workflows/kk-daily-ai-voice3.yaml`: pin `COVER_FORMAT = 'daily-news-podcast-cover'` and `COVER_STYLE = 'quasi-news-podcast'` (with backwards-compatible variable overrides), so the daily voice3 pipeline executes the quasi-news podcast cover presets.
- [ ] R2. Implement standalone mock test runner `plugins/kk/scripts/daily-cover-mock.ts`: accept `--headline <text>`, `--scene <text>`, `--out <path>`, `--provider <name>`, and `--mock-bg` (renders a local gradient placeholder background when API keys are not supplied), invoking `compositeCover` to generate a 1344x576 composite PNG.
- [ ] R3. Add test runner integration test in `plugins/kk/tests/daily-cover-mock.test.ts`: test that the mock runner successfully executes with mock news input and produces a valid 1344x576 PNG file.
- [ ] R4. Verify end-to-end downstream compatibility: verify that `${work_dir}/23-cover/${runDate}_07_cover_cover.png` is correctly ingested by downstream consumers (`dailyPublishPrep` and `dailyBundleVariants`) without format or path mismatches.
- [ ] R5. Run comprehensive quality gates: execute `bun run gate` (Biome check, typecheck, tests, and rule checks) ensuring all checks pass cleanly.

### Acceptance Criteria

- [ ] AC1 — 集成接入 kk-daily-ai-voice3 生成工作流 (req: R1, R4)
  - `kk-daily-ai-voice3.yaml` executes `daily-cover` using format `daily-news-podcast-cover` and style `quasi-news-podcast`.
  - Normalization outputs `${work_dir}/23-cover/${runDate}_07_cover_cover.png` satisfying existing downstream contracts.
  - Existing workflow stage tests in `apps/cli/tests/kk-workflow-stages.test.ts` pass without regression.
- [ ] AC2 — 独立 Mock 新闻驱动封面生成测试与验收 (req: R2, R3, R5)
  - Running `bun plugins/kk/scripts/daily-cover-mock.ts --mock-bg --headline "测试大标题：模型推理能力爆发" --out /tmp/mock-out.png` outputs a 1344x576 PNG file with headline and logo badge.
  - `bun test plugins/kk/tests/daily-cover-mock.test.ts` passes.
  - `bun run gate` passes cleanly.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

#### Approach

1. **Workflow & Stage Configuration**:
- In `plugins/kk/scripts/kk-workflow-stages.ts`:
  ```ts
  export const COVER_FORMAT = 'daily-news-podcast-cover';
  export const COVER_STYLE = 'quasi-news-podcast';
  ```
- In `plugins/kk/scripts/daily-stages.ts:581` (`dailyCover`):
  Allow format and style to be configured or default to `COVER_FORMAT` and `COVER_STYLE`.
- In `plugins/kk/workflows/kk-daily-ai-voice3.yaml`:
  Maintain seamless node configuration for `cover` and `cover-normalize`. Downstream stages continue to reference `${vars.work_dir}/23-cover/${vars.run_date}_07_cover_cover.png`.

2. **Standalone Mock Test Runner** (`plugins/kk/scripts/daily-cover-mock.ts`):
- CLI flags parsed via `node:util` `parseArgs`:
  - `--headline <string>`: Chinese Hook headline (default: `"重大突破：下一代AI深度推理时代正式开启"`)
  - `--scene <string>`: Visual scene description (default: `"an illuminated advanced semiconductor wafer glowing in dark cleanroom"`)
  - `--out <path>`: Target output path (default: `/tmp/kk-cover-mock.png`)
  - `--mock-bg`: If set, generates a high-resolution 1344x576 dark gradient background PNG locally via SVG/sips without invoking external diffusion APIs.
  - `--provider <string>`: Optional AI provider if running live generation test (e.g. `minimax`).
- Pipeline:
  1. If `--mock-bg`, generate base background via local SVG -> `sips`. If not, call `kk executor run image-gen` using format `daily-news-podcast-cover` and style `quasi-news-podcast`.
  2. Invoke `compositeCover({ backgroundImagePath, headline, outputPath })`.
  3. Verify output file exists, non-empty, and has dimensions 1344x576 via `sips -g pixelWidth -g pixelHeight`.
  4. Print structured summary and output file path.

#### Invariants
- Downstream stages (`dailyPublishPrep`, `dailyBundleVariants`) continue to consume `${work_dir}/23-cover/${runDate}_07_cover_cover.png` without any contract changes.
- Standalone test runner can run 100% offline with `--mock-bg` for CI and fast unit testing.
- All code adheres to Biome 2.5.15 and Bun 1.4.3 runtime standards.

#### Rejected Alternatives
- Requiring a full 20-minute daily pipeline run (TTS, transcription, audio sync) to test cover changes: rejected per user request.
- Creating a separate disconnected workflow file: rejected to prevent workflow duplication drift.

### Plan

1. Update `COVER_FORMAT` and `COVER_STYLE` constants in `plugins/kk/scripts/kk-workflow-stages.ts:88` to `daily-news-podcast-cover` and `quasi-news-podcast`.
2. Update `dailyCover` in `plugins/kk/scripts/daily-stages.ts` and `plugins/kk/workflows/kk-daily-ai-voice3.yaml` to ensure clean resolution of the new preset constants and optional var overrides.
3. Implement `plugins/kk/scripts/daily-cover-mock.ts` with CLI argument parsing, `--mock-bg` option, integration with `compositeCover`, and output dimension validation.
4. Add integration test in `plugins/kk/tests/daily-cover-mock.test.ts` running the mock test runner with `--mock-bg` and asserting that a valid 1344x576 PNG is generated.
5. Execute `bun plugins/kk/scripts/daily-cover-mock.ts --mock-bg --headline "量子芯片算力暴涨千倍？全球科技巨头暗战打响！" --out /tmp/daily-cover-test.png` and verify visual output.
6. Run `bun run gate` (Biome format, build, spur-check with lint, pre-check, unit tests, and post-check) to verify full pass.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Parent Feature: [L2: daily-ai-voice-quasi-news-podcast-cover](file:///Users/robin/xprojects/knowledge-kit/docs/features/L2_daily-ai-voice-quasi-news-podcast-cover.md)
- Prerequisite Task: [0348](file:///Users/robin/xprojects/knowledge-kit/docs/tasks/0348_implement-deterministic-chinese-typography-compositing-and-p.md)
- Architecture Decision: [ADR-046](file:///Users/robin/xprojects/knowledge-kit/docs/00_ADR.md#L1678)
- Design Satellite: [docs/design/daily-news-podcast-cover.md](file:///Users/robin/xprojects/knowledge-kit/docs/design/daily-news-podcast-cover.md)
- Target Workflow: [plugins/kk/workflows/kk-daily-ai-voice3.yaml](file:///Users/robin/xprojects/knowledge-kit/plugins/kk/workflows/kk-daily-ai-voice3.yaml#L535)

### History

- 2026-11-10T04:28:44.581Z feature_id Q → L2 (system)

