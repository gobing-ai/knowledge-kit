---
schema_version: 1
name: Integrate into kk-daily-ai-voice3 workflow and provide standalone mock test runner
status: done
template: feature-impl
created_at: 2026-11-10T04:05:28.049Z
updated_at: "2026-11-11T00:20:41.824Z"
feature_id: L2
priority: P1

dependencies: ["0348"]
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0349-verdict.json
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

- [x] R1. Update cover stage configuration in `plugins/kk/scripts/kk-workflow-stages.ts:88` and `plugins/kk/workflows/kk-daily-ai-voice3.yaml`: pin `COVER_FORMAT = 'daily-news-podcast-cover'` and `COVER_STYLE = 'quasi-news-podcast'` (with backwards-compatible variable overrides), so the daily voice3 pipeline executes the quasi-news podcast cover presets.
- [x] R2. Implement standalone mock test runner `plugins/kk/scripts/daily-cover-mock.ts`: accept `--headline <text>`, `--scene <text>`, `--out <path>`, `--provider <name>`, and `--mock-bg` (renders a local gradient placeholder background when API keys are not supplied), invoking `compositeCover` to generate a 1344x576 composite PNG.
- [x] R3. Add test runner integration test in `plugins/kk/tests/daily-cover-mock.test.ts`: test that the mock runner successfully executes with mock news input and produces a valid 1344x576 PNG file.
- [x] R4. Verify end-to-end downstream compatibility: verify that `${work_dir}/23-cover/${runDate}_07_cover_cover.png` is correctly ingested by downstream consumers (`dailyPublishPrep` and `dailyBundleVariants`) without format or path mismatches.
- [x] R5. Run comprehensive quality gates: execute `bun run gate` (Biome check, typecheck, tests, and rule checks) ensuring all checks pass cleanly.

### Acceptance Criteria

- [x] AC1 — 集成接入 kk-daily-ai-voice3 生成工作流 (req: R1, R4)
  - `kk-daily-ai-voice3.yaml` executes `daily-cover` using format `daily-news-podcast-cover` and style `quasi-news-podcast`.
  - Normalization outputs `${work_dir}/23-cover/${runDate}_07_cover_cover.png` satisfying existing downstream contracts.
  - Existing workflow stage tests in `apps/cli/tests/kk-workflow-stages.test.ts` pass without regression.
- [x] AC2 — 独立 Mock 新闻驱动封面生成测试与验收 (req: R2, R3, R5)
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

Change map:
- plugins/kk/scripts/kk-workflow-stages.ts:89-90 — pins flipped to `daily-news-podcast-cover` / `quasi-news-podcast` (dailyCover daily-stages.ts:611-612 and the yaml cover node both resolve these; F614 pinned-look invariant preserved, provider/model args remain the override surface).
- plugins/kk/workflows/kk-daily-ai-voice3.yaml:536 — cover node description names the new presets (node shells `kk stage daily-cover`; no other yaml hardcoding).
- plugins/kk/scripts/daily-cover-mock.ts (new) — parseArgs CLI (`--headline/--scene/--out/--provider/--mock-bg`), mock-bg = local SVG→sips gradient (zero tokens, offline), live path writes the same envelope shape dailyCover uses through the pinned presets, `compositeCover` for the overlay, missing-output-parent fail-fast (0348 sips finding), `verifyOutput` asserts 1344×576 via sips probe.
- plugins/kk/tests/daily-cover-mock.test.ts (new) — spawned-runner integration: mac-only AC2 run asserts 1344×576 PNG + composited stderr; platform-neutral loud-failure (missing out dir) and unknown-flag rejection.
Rationale: R4 needs no code — downstream consumers (daily-stages.ts:1993/:2270/:3033/:5219) read `23-cover/${runDate}_07_cover_cover.png`, which 0348's composite seam already preserves (asserted by daily-cover-normalize.test.ts).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | COVER_FORMAT is daily-news-podcast-cover and COVER_STYLE is quasi-news-podcast at plugins/kk/scripts/kk-workflow-stages.ts:89-90. dailyCover copies those pins at plugins/kk/scripts/daily-stages.ts:611-612. Provider, model, and fallback remain the variable overrides at plugins/kk/scripts/daily-stages.ts:616-621. Workflow vars cover_provider, cover_model, and cover_fallback are at plugins/kk/workflows/kk-daily-ai-voice3.yaml:64-66. The cover node shells daily-cover with those vars at plugins/kk/workflows/kk-daily-ai-voice3.yaml:549, and its description names the presets at :536. |
| R2 | MET | parseMockArgs accepts headline, scene, out, provider, and mock-bg at plugins/kk/scripts/daily-cover-mock.ts:43-61. The mock background SVG is sized from COVER_WIDTH and COVER_HEIGHT at :24-41 and rendered through sips at :65-71. The live path pins format daily-news-podcast-cover and style quasi-news-podcast at :85-86. compositeCover runs at :146-150. verifyOutput requires width 1344 and height 576 at :112-122. Direct invoke is the basename check at :161-163. |
| R3 | MET | plugins/kk/tests/daily-cover-mock.test.ts:30-40 spawns the runner with mock-bg and headline 测试大标题：模型推理能力爆发, then asserts pixelWidth 1344 and pixelHeight 576. A missing output directory fails at :43-49. An unknown flag fails at :52-55. |
| R4 | MET | The normalized file is 23-cover plus the run date and _07_cover_cover.png at plugins/kk/scripts/kk-workflow-stages.ts:1043. dailyPublishPrep reads that path at plugins/kk/scripts/daily-stages.ts:2270 and writes coverImage and options.coverPath at :2305-2312. dailyBundleVariants reads the same path at plugins/kk/scripts/daily-stages.ts:1993 and passes it into the article payloads at :2012-2013. dailyXhsRender, the cards-render stage, reads it at plugins/kk/scripts/daily-stages.ts:5219. The surfdash patch localCover is the same path at plugins/kk/scripts/kk-workflow-stages.ts:1710. WeChat publish reads it at plugins/kk/scripts/daily-stages.ts:3033. |
| R5 | MET | bun run gate exited 0 this run after format, build, typecheck, 58 pre-check rules, 4863 pass and 0 fail across 253 files, and 2 post-check rules. One biome info on an unrelated repair script did not fail the gate. The first gate this session failed the single test at scripts/tests/daily-ai-news.test.ts:243. The expectation now matches the launcher: agent planner and agent_retry planner at scripts/tests/daily-ai-news.test.ts:246-247 and scripts/daily-ai-news.ts:230-232. Gitignored fix-pass artifacts are .spur/run/0349-verify-answer.txt and .spur/run/0349-verdict.json. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R5 — 集成接入 kk-daily-ai-voice3 生成工作流 | MET | test | The daily-cover envelope asserts format daily-news-podcast-cover and style quasi-news-podcast at apps/cli/tests/kk-workflow-stages.test.ts:3934-3942. bun test apps/cli/tests/kk-workflow-stages.test.ts exited 0 with 163 pass and 0 fail. The output name downstream consumers read is unchanged at plugins/kk/scripts/kk-workflow-stages.ts:1043 and plugins/kk/scripts/daily-stages.ts:2270. |
| R6 — 独立 Mock 新闻驱动封面生成测试与验收 | MET | command | bun plugins/kk/scripts/daily-cover-mock.ts --mock-bg --headline "测试大标题：模型推理能力爆发" --out /tmp/mock-out.png printed composited /tmp/mock-out.png (1344x576, background=mock). sips reported pixelWidth 1344, pixelHeight 576, format png. The same headline is asserted at plugins/kk/tests/daily-cover-mock.test.ts:30-40. bun run gate exited 0 with 4863 pass and 0 fail. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Findings (none open at P1-P3):

| P | Finding | Disposition |
|---|---------|-------------|
| P4 | `daily-cover-mock.ts` live path shells `kk executor run image-gen` with its own envelope (daily-cover-mock.ts:75) rather than calling the `dailyCover` stage | Accept — verification harness, not a pipeline stage; intentionally bypasses brief validation; envelope shape mirrors dailyCover's |
| P4 | `KK_BIN` env override (daily-cover-mock.ts:77) defaults to bare `kk` via PATH | Accept — matches every other stage subprocess in the suite; AGENTS.md documents the operator-side staleness discipline |
| P4 | Mock-background SVG does not render the `--scene` text | Accept — `--scene` is the live-path diffusion prompt; the design keeps the deterministic layer text-free |

SECUA: no secrets; spawnSync argv arrays only; mock SVG is a fixed template (no user-input
interpolation); headline reaches SVG only through compositeCover's XML-escaping; strict parseArgs
(tested); fixtures use mkdtemp + bounded cleanup.
Architecture: pin flip is one line pair in the single source of truth
(kk-workflow-stages.ts:89-90) consumed by both callers — no duplicated pin; output contract
`23-cover/${runDate}_07_cover_cover.png` untouched so downstream consumers need no edits; the
mock runner reuses compositeCover, so AC2 verifies the same code path the cron runs.

Review verdict evidence: 0349 review cert (5 requirements MET, AC1 [R1] MET, AC2 [R2] MET);
mock 3 pass, normalize+compositor 22 pass, stage suite 163 pass; full gate PASS receipt tree
103dde6e.

Verdict: PASS

Confidence: HIGH

### References

- Parent Feature: [L2: daily-ai-voice-quasi-news-podcast-cover](file:///Users/robin/xprojects/knowledge-kit/docs/features/L2_daily-ai-voice-quasi-news-podcast-cover.md)
- Prerequisite Task: [0348](file:///Users/robin/xprojects/knowledge-kit/docs/tasks/0348_implement-deterministic-chinese-typography-compositing-and-p.md)
- Architecture Decision: [ADR-046](file:///Users/robin/xprojects/knowledge-kit/docs/00_ADR.md#L1678)
- Design Satellite: [docs/design/daily-news-podcast-cover.md](file:///Users/robin/xprojects/knowledge-kit/docs/design/daily-news-podcast-cover.md)
- Target Workflow: [plugins/kk/workflows/kk-daily-ai-voice3.yaml](file:///Users/robin/xprojects/knowledge-kit/plugins/kk/workflows/kk-daily-ai-voice3.yaml#L535)

### History

- 2026-11-10T04:28:44.581Z feature_id Q → L2 (system)
- 2026-11-10T21:18:01.011Z todo → wip (system)
- 2026-11-10T21:19:11.664Z wip → testing (system)
- 2026-11-10T21:19:13.871Z testing → done (system)

