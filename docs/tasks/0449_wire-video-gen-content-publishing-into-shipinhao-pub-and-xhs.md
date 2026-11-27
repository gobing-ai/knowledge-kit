---
schema_version: 1
name: Wire video-gen Content publishing into shipinhao-pub and xhs-pub
status: todo
template: feature-impl
created_at: 2026-11-26T19:50:42.662Z
updated_at: "2026-11-26T23:19:08.903Z"
feature_id: D9
priority: P1
tags:
  - M1
  - publish
  - shipinhao-pub
  - xhs-pub
estimate_hours: 6

dependencies: ["0448"]
---

## 0449. Wire video-gen Content publishing into shipinhao-pub and xhs-pub

### Background

Milestone 1 publishing integration for existing Chinese short-video channels (ADR-060, docs/design/short-form-video-promotion.md §5.1-5.2). Both shipinhao-pub (shortVideo at plugins/publishings/shipinhao-pub/src/index.ts:58) and xhs-pub (上传视频 at plugins/publishings/xhs-pub/src/index.ts:53) already implement video upload flows; this task wires videoGenContentSchema payloads and adds the missing xhs-pub video publishing profile.

Implements: R10 — Shipinhao and Xiaohongshu publishers accept video-gen Content and save drafts by default.

**Refine corrections (2026-11-26)** — `/sp:dev-refine --all --feature D9 --auto --depth ready`
- shipinhao-pub "accepts video-gen Content" is **already implemented**. The `shortVideo` ladder requires `format: 'video'`, a non-empty title/body and `metadata.videoPath` (MP4/MOV, ≤2 GiB), and it reads `coverPath`/`tags` and defaults `publishStatus` to draft (`plugins/publishings/shipinhao-pub/src/flow.ts:942-1060`). Its `unsupportedFields` denylist lets extra video-gen metadata keys through. → R1 is reduced to a regression test with a `videoGenContentSchema` payload. No flow change.
- The design §5.2 xhs profile `requires: { video: true }` would **fail manifest load**: `PublishingProfileRequiresSchema` is `.strict()` with only `cover`/`orderedImages` (`packages/kk-core/src/manifest.ts`). `requires` is optional (`:127`). → Declare the `video` profile without `requires`. xhs-pub's own pre-browser ladder already refuses a missing video.
- xhs 上传视频 reads **`metadata.video`** (a string or `{path}`), not `videoPath`, and has no cover input (`plugins/publishings/xhs-pub/src/modes.ts` `resolveMediaPath`). → The `video@xhs-pub` variant builder maps `metadata.video = videoPath` and drops the cover claim. No xhs-pub code change.
- Scope gap: no task owned the daily-pipeline wiring (workflow node, bundle variants, preset rows), so video-gen would never run. → Assigned here (R3–R5). Estimate 4h → 6h.
- The daily publish path is preset rows + frozen `30-variants/<variant>@<plugin>` (`plugins/kk/scripts/daily-stages.ts:3040` `dailyBundleVariants`). ITC `publishing.profiles` is consumed only by the article ITC flow (`apps/cli/src/itc-plan.ts`). → The xhs `video` profile is declared for discovery and AC parity. The daily path does not depend on it.
- ADR-059 deterministic variant safety (`isShortFormVariant`, `daily-stages.ts:5245`) does not cover video variants → R4 adds them, so the video title and description are PII-checked like the cards.

### Requirements

- [ ] R1. Regression: shipinhao-pub's `shortVideo` flow accepts a `videoGenContentSchema`-valid payload (including the extra `visualMode`/`renderProvider`/`width`… keys) and defaults it to a draft, with no flow change.
- [ ] R2. `plugins/publishings/xhs-pub/plugin.json` declares a `video` publishing profile (`format: "video"`, `locale: "zh"`, modes draft/live → operation `上传视频`, no `requires`) that passes manifest validation. Given `metadata.video` from a video-gen MP4, the existing 上传视频 ladder saves via 暂存离开 by default.
- [ ] R3. `kk-news-generate.yaml` gets a `video` node after `cards`/`voice` and before `variants`. It runs `kk executor run video-gen` with `visualMode: editorial` against the run work dir, with `onError: continue`, and it is gated on a new workflow var `video` (default `"off"`), so default daily runs are unchanged.
- [ ] R4. `dailyBundleVariants` writes `video`, `video@shipinhao-pub` (format video, `videoPath`, `coverPath`, `tags`, `publishStatus: draft`) and `video@xhs-pub` (`metadata.video = videoPath`, `operation: 上传视频`, draft) when `32-video/<d>_video.mp4` and its Content exist. Otherwise it pushes `video (no 32-video render)` to `skipped`. `isShortFormVariant` includes `video` and `video@*`.
- [ ] R5. `plugins/kk/publish-presets/daily-ai-voice.json` gets rows `shipinhao-pub` / `variant: video@shipinhao-pub` and `xhs-pub` / `variant: video@xhs-pub` / `operation: 上传视频`, both `mode: "off"` and `required: false`.

**Out of scope:** the youtube-pub row and variant (0450); shipinhao/xhs flow code changes; live publishing; enabling `video` by default; `kk-daily-ai-voice*.yaml` (legacy workflows, unless they share the node via `kk news generate-bundle`).

### Acceptance Criteria

- [ ] AC1 — Shipinhao and Xiaohongshu publishers accept video-gen Content and save drafts by default (req: R1, R2, R4, R5)
  - Observed by: `plugins/publishings/shipinhao-pub/tests/shipinhao-pub.test.ts` (new case: a videoGenContentSchema fixture reaches the shortVideo plan with `publishStatus: draft`); `plugins/publishings/xhs-pub/tests/` (manifest loads, and the `video` profile resolves `上传视频`); `plugins/kk/scripts/tests/` daily-stages variants test (fixture `32-video/` → the two variant files with the mapped keys; no `32-video/` → a `skipped` entry, no throw); a preset parse test (the rows validate against `PublishPresetTargetSchema` at mode off). The R3 workflow node is checked by `spur workflow validate plugins/kk/workflows/kk-news-generate.yaml` and by the existing workflow-shape test.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-26T23:16:16.732Z

- **Which audio does the daily video use?** Closed: the `video` node runs **before** `variants`, so `31-publish/` does not exist yet. video-gen falls back to `30-audio/<d>_11_generate_content.json` `metadata.audioPath` (0448's resolution order). That is the pre-publish-prep mix, which is acceptable for a 45–60s teaser. Moving the node after `variants` would put the video outside the frozen bundle (rejected).
- **Default on?** Closed: no. The workflow var `video` defaults to `off`, and the preset rows are `mode: off`. The operator enables both explicitly after a manual draft review.
- **Change xhs-pub to also read `videoPath`?** Closed: no. The variant builder maps the key. That is a smaller diff and keeps xhs-pub's contract stable.
- **Workflow YAML edit authorization?** Closed: `plugins/kk/workflows/*.yaml` is product pipeline source owned by this feature (ADR-060). It is not CI under `.github/workflows/`, so it is not gated.

### Design

**Frozen names.** Variant keys: `video`, `video@shipinhao-pub`, `video@xhs-pub`. The skipped string is `video (no 32-video render)`. The workflow var is `video` (`off`|`editorial`); 0451 adds `editorial-wan`. The node id is `video`, with `dependsOn: [voice, voice-fallback, voice-fallback2, cards]`, the same pool-gate `condition` plus `[ "${vars.video}" != "off" ]`, and `onError: continue`.
- Node command: `kk executor run video-gen --in "${vars.work_dir}/32-video/request.json" --out "${vars.work_dir}/32-video/<d>_video_content.json"`. The request JSON is written by a new `kk news generate-bundle --stage video-request`, or by an inline `printf`. **Prefer the stage**, so the request schema stays typed and tested next to `dailyBundleVariants`.
- Variant builders live in `daily-stages.ts` beside `buildXhsCardsContent`: `buildVideoVariant(content, plugin)`. They read video-gen Content, re-validate it with `videoGenContentSchema`, and remap per plugin.
- `daily-ai-voice.json` rows are appended after the cards rows. `tier`/`window` follow the shipinhao `image/cards` row.

**Anti-patterns.** Do not edit the shipinhao `flow.ts` or the xhs `modes.ts`. Do not add `requires.video` to the manifest schema (that is a breaking shared-schema change and is unneeded). Do not run video-gen inside `generate-bundle` (keep it a separate failure-isolated node). Do not enable live.

**Sync.** After editing `plugins/`, run `bun scripts/bundle-plugins.ts`, then `bun run tools:fresh`, then rsync `plugins/kk/{scripts,workflows}` to the install (AGENTS.md § Editing plugins/kk/scripts). Otherwise the 04:30 launch preflight refuses (exit 5).

**Handoff.** 0450 adds `video@youtube-pub` + a preset row using the same `buildVideoVariant`.

### Plan

0. Preconditions: 0448 is done (`videoGenContentSchema` exported, and `kk executor run video-gen` works on a fixture).
1. R1: write the shipinhao regression test first. It should pass without a code change. If it fails, stop and record why in Q&A.
2. R2: add the xhs `video` profile and a manifest-load test.
3. R4: write the failing variants tests (with and without `32-video/`), then `buildVideoVariant` plus the `isShortFormVariant` extension.
4. R3: add the `video-request` stage plus its test, then the workflow var and node, then `spur workflow validate`.
5. R5: add the preset rows plus a parse test.
6. Gate: `bun run lint`, `bun run test` (exit 0), `bun run build`. Then run the bundle-plugins, tools:fresh and rsync sync. Do one manual `kk-news-generate` run with `video=editorial` and a draft-only shipinhao publish, and record the receipt in Testing.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- `docs/00_ADR.md` ADR-060; `docs/design/short-form-video-promotion.md`; feature `docs/features/D9_short-form-vertical-video-generation-and-three-channel-podcast-promotion.md`
- `plugins/publishings/shipinhao-pub/src/flow.ts:942-1060`
- `plugins/publishings/xhs-pub/src/modes.ts` (resolveMediaPath, 上传视频)
- `packages/kk-core/src/manifest.ts:120-128`
- `plugins/kk/scripts/daily-stages.ts:3040,5245`
- `plugins/kk/workflows/kk-news-generate.yaml:490-520`
- `plugins/kk/publish-presets/daily-ai-voice.json`

### History
