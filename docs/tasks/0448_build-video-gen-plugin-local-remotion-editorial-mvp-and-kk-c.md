---
schema_version: 1
name: Build video-gen plugin local Remotion editorial MVP and kk-core video contract
status: done
template: feature-impl
created_at: 2026-11-26T19:50:42.658Z
updated_at: "2026-11-27T19:25:57.302Z"
feature_id: D9
priority: P1
tags:
  - M1
  - video-gen
  - remotion
  - kk-core
estimate_hours: 8

done_forced: "false"
done_reason: unforced close
---

## 0448. Build video-gen plugin local Remotion editorial MVP and kk-core video contract

### Background

Milestone 1 foundation for Feature D9 (ADR-060, docs/design/short-form-video-promotion.md). Delivers the typed video Content contract in @gobing-ai/kk-core and the 100% local Remotion 9:16 editorial vertical video generator plugin so daily AI news podcast promos can render deterministically without GPU dependencies.

Implements: R1 — Typed video Content contract validates video-gen outputs in kk-core; R2 — video-gen renders a 9:16 H.264/AAC MP4 locally via Remotion from a daily AI news run; R3 — Shared local composition pipeline builds teaser hook, word timestamps, captions, waveform, safe-zones, and CTA; R4 — Editorial mode runs 100 percent locally with Ken-Burns motion by default; R12 — Invalid video inputs or missing credentials fail closed before expensive execution.

**Refine corrections (2026-11-26)** — `/sp:dev-refine --all --feature D9 --auto --depth ready`
- Generator input unspecified ("--in/--out contract") → kk-core has no Brief schema; generators parse their own `--in` JSON (`plugins/generations/vibe-voice-tts/src/index.ts:24-33`) → froze a plugin-local `VideoGenRequestSchema` (Design).
- "daily AI news work directory containing episode audio, curated script plan JSON, and cover" had no paths → verified against `dailyBundleVariants` (`plugins/kk/scripts/daily-stages.ts:3049-3054`) and the voice stages (`:1288`, `:1777`) → froze the four input paths in Design.
- Content shape for downstream publishers unstated → shipinhao `shortVideo` refuses empty `Content.title`/`Content.body` (`plugins/publishings/shipinhao-pub/src/flow.ts:965-978`) → R1/Design require video-gen to emit both.
- "heavy-tier smoke test" had no routing → the fast/heavy split is an explicit list (`scripts/test-suites.ts` `HEAVY_TEST_PATTERNS`) → Plan registers the render test there.
- Coverage risk unaddressed → bun enforces 90% per *loaded* file; `.tsx` components load only in the heavy render → pure layout/caption/safe-zone math must live in `.ts` modules the fast tier loads.
- New dependencies (remotion, @remotion/bundler, @remotion/renderer, react, react-dom) are authorized by ADR-060 (`docs/00_ADR.md:2153`) — recorded in Q&A so the implementer does not re-ask.
- R12 scope: this task owns only the video-gen leg (unreadable audio / bad mode / bad duration); the credentials leg is 0450, the portrait leg is 0452.

### Requirements

- [x] R1. `packages/kk-core/src/schemas.ts` exports `VideoVisualModeSchema`, `VideoRenderProviderSchema`, `videoGenContentSchema` and type `VideoGenContent`, exactly as `docs/design/short-form-video-promotion.md` §2, re-exported from `packages/kk-core/src/index.ts`. A payload missing `metadata.videoPath`, or with `durationSec <= 0`, is rejected.
- [x] R2. `plugins/generations/video-gen/` is a Bun workspace plugin (`plugin.json` `kind: generator`, `package.json` `@gobing-ai/video-gen`, `tsconfig.json` with `jsx: react-jsx`, `pyproject.toml` + `uv.lock`) that `kk executor run video-gen --in <request.json> --out <content.json>` discovers and runs.
- [x] R3. With `visualMode: "editorial"` and a daily work dir, the plugin writes a 1080×1920, 30fps, H.264 video + AAC audio MP4 of 45–60s to `<workDir>/32-video/<runDate>_video.mp4` and a `videoGenContentSchema`-valid Content (non-empty `title` and `body`; `renderProvider: "local-ken-burns"`) to `--out`.
- [x] R4. The composition pipeline slices a 45–60s teaser from the episode audio with `ffmpeg`, gets word-level timestamps from a locked uv `faster-whisper` worker (`python/align_captions.py`), and renders headline cards, kinetic captions, a waveform and a CTA outro with nothing inside the bottom 480px or right 162px safe-zones.
- [x] R5. Editorial mode animates the cover and card images with local Ken-Burns pan/zoom and spawns no `colab` process and makes no network call.
- [x] R6. Unreadable/missing audio, an unknown or not-yet-shipped `visualMode` (`avatar`, `hybrid-pip` until 0452), or a hook window outside 45–60s exits nonzero with an actionable message **before** spawning `ffmpeg`, `uv`, or Chromium.

**Out of scope:** Colab / `wan21-i2v` (0451); `avatar`/`hybrid-pip` (0452); publisher changes and daily-workflow wiring (0449); YouTube (0450); a host-portrait registry; 16:9 output; TTS.

### Acceptance Criteria

- [x] AC1 — Typed video Content contract validates video-gen outputs in kk-core (req: R1)
  - Given/When/Then: the feature R1 scenario, observed by `packages/kk-core/tests/schemas.test.ts` (pure zod parse).
- [x] AC2 — video-gen renders a 9:16 H.264/AAC MP4 locally via Remotion from a daily AI news run (req: R2, R3)
  - Observed by the heavy-tier `plugins/generations/video-gen/tests/render-e2e.test.ts`: real Remotion render over a fixture work dir, then `ffprobe` asserts 1080×1920, h264, an aac stream, and duration. The fixture clip may be shortened via the request's test-only `hook` window, but the duration clamp must be asserted in the fast tier.
- [x] AC3 — Shared local composition pipeline builds teaser hook, word timestamps, captions, waveform, safe-zones, and CTA (req: R4)
  - Observed by fast-tier `tests/remotion-props.test.ts` and `tests/hook-slicer.test.ts`, with a fake `faster-whisper` JSON and a recorded `ffmpeg` argv. Assert hook clamping, caption chunking, and that every layout box sits clear of y ≥ 1440 and x ≥ 918.
- [x] AC4 — Editorial mode runs 100 percent locally with Ken-Burns motion by default (req: R5)
  - Observed by fast-tier `tests/video-gen.test.ts` with an injected process runner: the recorded argv list has no `colab` entry and `renderProvider === 'local-ken-burns'`.
- [x] AC5 — Invalid video inputs or missing credentials fail closed before expensive execution (req: R6)
  - Observed by `tests/video-gen.test.ts`: each invalid request exits nonzero and the injected runner records **zero** spawns.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-26T23:15:21.665Z

- **New dependencies?** Closed: `remotion`, `@remotion/bundler`, `@remotion/renderer`, `react`, `react-dom` (+ `@types/react`) are authorized by ADR-060. Pin exact versions in the plugin's `package.json` only, not in the root package. Remotion's license is free for individuals and companies of ≤3 people (https://www.remotion.dev/license); the operator runs it as an individual. Revisit if that changes.
- **Request shape in kk-core?** Closed: no. `VideoGenRequestSchema` stays plugin-local. Only the output contract (`videoGenContentSchema`) is shared.
- **Which images are "illustrations"?** Closed: the cover (`23-cover/<d>_07_cover_cover.png`) plus the ordered card images in `25-xhs/content.json` `metadata.images[].path`, when present. With no cards, the cover alone gets multiple Ken-Burns passes.
- **Hook selection?** Closed: an explicit `hook: {startSec, endSec}` in the request wins. Otherwise start at 0 and take `min(60, max(45, plan lead-segment end))`. The plan's first item marks the lead segment. If audio is shorter than 45s, fail closed.

### Design

**WHAT/WHY.** ADR-060 M1: one local Remotion shell plus a pluggable visual layer, with Ken-Burns as the only provider here.

**Frozen names**
- kk-core: `VideoVisualModeSchema`, `VideoRenderProviderSchema`, `videoGenContentSchema`, `type VideoGenContent`, exactly as design §2.
- Plugin input `VideoGenRequestSchema` (`src/request.ts`, zod, strict): `{ workDir: string(abs), runDate: /^\d{8}$/, visualMode: VideoVisualMode, hook?: { startSec: number>=0, endSec: number } }`. 0451 adds `colab?`; 0452 adds `provider?`, `hostPortraitPath?`. Extend this schema; do not fork it.
- Inputs resolved from `workDir`. Audio: `31-publish/<d>_13_publish-prep_content.json` `metadata.audioFile`, else `30-audio/<d>_11_generate_content.json` `metadata.audioPath`. Plan: `24-script/<d>_08_script-write_plan.json`. Cover: `23-cover/<d>_07_cover_cover.png`. Cards: `25-xhs/content.json`.
- Outputs go to `<workDir>/32-video/`: `<d>_hook.wav`, `<d>_words.json`, `<d>_video.mp4`. Content goes to `--out`. `metadata.coverPath` is the cover, and `metadata.tags` comes from the plan, when present.
- `src/visual-provider.ts`: `interface VisualProvider { readonly id: VideoRenderProvider; prepare(ctx: VisualContext): Promise<VisualLayer> }`, where `VisualLayer = { kind: 'stills'; images: string[] } | { kind: 'clips'; clips: string[] }`. Only `localKenBurns` here.
- `src/layout.ts` (pure): `SAFE_ZONE = { bottomPx: 480, rightPx: 162 }`, `assertInSafeArea(box)`, caption chunking, and hook clamp. `.tsx` files import from here.
- Process seam: `type RunProcess = (argv: string[], opts) => Promise<{ code: number; stdout: string; stderr: string }>`, injected into `main(argv, { runProcess })`, the same pattern as `vibevoice-client.ts`.
- uv worker argv: `['uv','run','--project',pluginRoot,'--locked','--no-dev','python',join(pluginRoot,'python','align_captions.py'), …]`, mirroring `resolveVibeVoiceWorkerCommand` (`plugins/generations/vibe-voice-tts/src/vibevoice-client.ts:232`).

**Algorithm.** validate request and inputs (fail-closed, no spawns) → hook window → `ffmpeg` slice with fade → whisper words JSON → provider.prepare → `@remotion/renderer` `renderMedia({ codec: 'h264', audioCodec: 'aac' })` at 1080×1920/30 → emit Content.

**Anti-patterns.** Do not encode with raw ffmpeg filters instead of Remotion (ADR-060 rejected). Do not call Colab or the network. Do not add the request shape to kk-core. Do not write outside `<workDir>/32-video/`. Do not put branching logic in `.tsx`, because fast-tier coverage cannot see it. Do not wire this plugin into a workflow (0449 owns that).

**Handoffs.** 0449 reads `32-video/` Content. 0451 adds a `wan21-i2v` provider that returns `kind: 'clips'` and extends the request schema. 0452 adds avatar providers and `AvatarReel`/`HybridPipReel`.

### Plan

0. Precondition: `ffmpeg`/`ffprobe`/`uv` are on PATH (verified 2026-11-26 at /opt/homebrew/bin). Run `bun install` after adding deps, and commit `bun.lock`.
1. R1: add the kk-core schemas, the export, and `schemas.test.ts` cases (valid, missing videoPath, durationSec 0) → AC1.
2. R2: scaffold `plugins/generations/video-gen` (plugin.json, package.json, tsconfig, pyproject.toml + `uv lock`). Use README.md only if the convention requires one.
3. R6: write `request.ts` and input resolution with failing tests first (unreadable audio, bad mode, hook <45 / >60, audio <45s), asserting zero spawns → AC5.
4. R4: write `layout.ts`, `hook-slicer.ts`, `captions.ts`, and `python/align_captions.py`, with fast tests using a fake runner and fixture words JSON → AC3.
5. R5: write `visual-provider.ts` `localKenBurns` and a test that asserts no `colab` argv → AC4.
6. R3: write the Remotion `Root.tsx`, `EditorialReel`, `SafeZoneFrame`, `KineticCaptions`, `WaveformBar`, and `render.ts`. Add `tests/render-e2e.test.ts` and register it in `scripts/test-suites.ts` `HEAVY_TEST_PATTERNS` → AC2.
7. Gate: `bun run lint`, `bun run test` (exit code, per-file 90%), `bun run test:heavy` for the render test, `bun run build`. Then run one manual `kk executor run video-gen` against a real daily work dir and record ffprobe output in Testing.

### Solution

Fills R1/R2/R3/R4 plus this task's R5–R6 legs: the typed video contract in `@gobing-ai/kk-core` and the
100% local Remotion 9:16 editorial generator. 0449/0450/0451/0452 extend this plugin — none of them fork it.

**Contract (R1)**
- `packages/kk-core/src/schemas.ts:94` `VideoVisualModeSchema`, `:97` `VideoRenderProviderSchema`, `:104`
  `videoGenContentSchema` (+ `VideoGenContent`/`VideoVisualMode`/`VideoRenderProvider` types at `:133-137`) —
  exactly design §2, `format: "video"`, `metadata.videoPath` required, `durationSec` positive.
- `packages/kk-core/src/index.ts:80-88` re-exports. Cover: `packages/kk-core/tests/schemas.test.ts:97-152`
  (valid parse, missing `videoPath`, `durationSec: 0`, unknown mode/provider).

**Plugin (R2)** — `plugins/generations/video-gen/` (`plugin.json` `kind: generator`, `@gobing-ai/video-gen`,
`tsconfig` with `jsx: react-jsx`, `pyproject.toml` + `uv.lock` for the whisper worker).
- `src/index.ts:43-133` `main(argv, deps?)`: request → inputs → `ffprobe` → hook window → `ffmpeg` slice →
  whisper words → provider → staged assets → props → Remotion render → `videoGenContentSchema.parse` → `--out`.
  Every check that can run without a render runs first, so a bad input spawns nothing.
- `src/request.ts:21,64` plugin-local `VideoGenRequestSchema` + `parseVideoGenRequestInput`.
- `src/inputs.ts:105` resolves audio (`31-publish` `metadata.audioFile`, else `30-audio` `metadata.audioPath`),
  cover (`23-cover`), plan (`24-script`) and cards (`25-xhs`), failing closed when a required one is absent.
- `src/hook-slicer.ts:14,48,83` `ffprobe`/`ffmpeg` argv + probe parse; `src/captions.ts:14,63` locked `uv`
  worker argv + payload validation; `src/visual-provider.ts:27,38` `VisualProvider` + `local-ken-burns`.
- `src/layout.ts` (198 lines, pure): safe zone `:15`, `contentBox` `:41`, hook clamp `:63-104`, caption
  chunking `:118`, active-caption lookups `:154`, waveform `:176`.
- `src/props.ts:19,46` `EditorialReelProps` + `buildEditorialProps`; `src/render.ts:35,70` asset staging +
  render handoff with a non-empty-artifact check.
- `src/remotion/{Root,EditorialReel,SafeZoneFrame,KineticCaptions,WaveformBar}.tsx` + `engine.ts` — thin
  declarative shell; all branching lives in the `.ts` modules so the fast tier can cover it.
- `python/align_captions.py` — faster-whisper word timestamps, decoded through `ffmpeg` (see deviations).

**Deviations from the Design section (evidence in Testing)**
1. `kk executor run` validates a generator's `--in` against the kind contract (`DocListSchema`,
   `packages/kk-core/src/kinds.ts:62`; enforced at `apps/cli/src/invoke.ts:568-608`), so a bare request object is
   rejected before the plugin starts. The request therefore travels in `Doc[0].metadata`
   (`parseVideoGenRequestInput` reads that envelope and still tolerates a bare object for a direct
   `bun src/index.ts --in` run). 0449 must build the `Doc[]` envelope when it wires the daily workflow.
2. faster-whisper's path-based `transcribe()` decodes through PyAV, and `av>=19` dropped the `metadata_errors`
   kwarg faster-whisper 1.2.1 still passes — the worker died on every run. `align_captions.py` now decodes to
   16kHz mono float32 via `ffmpeg` (already a hard dependency) and hands the model an array.
3. `scripts/bundle-plugins.ts:136` keeps `remotion`/`@remotion/*`/`react`/`react-dom` external: Bun cannot inline
   `@remotion/bundler` (it pulls `@remotion/studio`, whose effect/whisper peers are unresolvable at build time).
   `apps/cli/package.json` declares those five as dependencies so an installed plugin resolves them — the same
   pattern `playwright` already uses.

**Blast radius.** `packages/kk-core/tests/registry.test.ts:282,663` (shipped-plugin list gains `video-gen`),
`scripts/test-suites.ts:39` (registers the render e2e in the heavy tier), `bun.lock`.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Typed schema accepted the fixture and rejected missing videoPath and zero duration in packages/kk-core/tests/schemas.test.ts:87. |
| R2 | MET | CLI executor exited 0 with 186 word timestamps and 1,800 H.264 frames at 1080×1920/30 fps with AAC. A real caption rerun also emitted 48 PCM-derived waveform levels and preserved English separators (.spur/run/d9-editorial-caption-waveform.json). Probe: .spur/run/d9-editorial-ffprobe.json. Reproduction: .spur/run/d9-editorial-smoke.sh |
| R3 | MET | CLI executor exited 0 with 186 word timestamps and 1,800 H.264 frames at 1080×1920/30 fps with AAC. A real caption rerun also emitted 48 PCM-derived waveform levels and preserved English separators (.spur/run/d9-editorial-caption-waveform.json). Probe: .spur/run/d9-editorial-ffprobe.json. Reproduction: .spur/run/d9-editorial-smoke.sh |
| R4 | MET | CLI executor exited 0 with 186 word timestamps and 1,800 H.264 frames at 1080×1920/30 fps with AAC. A real caption rerun also emitted 48 PCM-derived waveform levels and preserved English separators (.spur/run/d9-editorial-caption-waveform.json). Probe: .spur/run/d9-editorial-ffprobe.json. Reproduction: .spur/run/d9-editorial-smoke.sh Layout checks: plugins/generations/video-gen/tests/remotion-props.test.ts:42. |
| R5 | MET | The production CLI completed the real 60-second Ken-Burns smoke using provisioned artifacts. uv --offline and HF_HUB_OFFLINE=1 forbid worker downloads, Remotion rejects a cold Chrome cache, and ffprobe rejects a playlist HTTP URL when restricted to file,pipe. |
| R6 | MET | Request and file rejection cases passed in plugins/generations/video-gen/tests/video-gen.test.ts:124 and plugins/generations/video-gen/tests/request-inputs.test.ts:82. The plugin reads one byte before ffprobe, and rejects a mode-000 file. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R1 — Typed video Content contract validates video-gen outputs in kk-core | MET | test | Typed schema accepted the fixture and rejected missing videoPath and zero duration in packages/kk-core/tests/schemas.test.ts:87. |
| R2 — video-gen renders a 9:16 H.264/AAC MP4 locally via Remotion from a daily AI news run | MET | command | CLI executor exited 0 with 186 word timestamps and 1,800 H.264 frames at 1080×1920/30 fps with AAC. A real caption rerun also emitted 48 PCM-derived waveform levels and preserved English separators (.spur/run/d9-editorial-caption-waveform.json). Probe: .spur/run/d9-editorial-ffprobe.json. Reproduction: .spur/run/d9-editorial-smoke.sh |
| R3 — Shared local composition pipeline builds teaser hook, word timestamps, captions, waveform, safe-zones, and CTA | MET | test | CLI executor exited 0 with 186 word timestamps and 1,800 H.264 frames at 1080×1920/30 fps with AAC. A real caption rerun also emitted 48 PCM-derived waveform levels and preserved English separators (.spur/run/d9-editorial-caption-waveform.json). Probe: .spur/run/d9-editorial-ffprobe.json. Reproduction: .spur/run/d9-editorial-smoke.sh Layout checks: plugins/generations/video-gen/tests/remotion-props.test.ts:42. |
| R4 — Editorial mode runs 100 percent locally with Ken-Burns motion by default | MET | command | The production CLI completed the real 60-second Ken-Burns smoke using provisioned artifacts. uv --offline and HF_HUB_OFFLINE=1 forbid worker downloads, Remotion rejects a cold Chrome cache, and ffprobe rejects a playlist HTTP URL when restricted to file,pipe. |
| R12 — Invalid video inputs or missing credentials fail closed before expensive execution | MET | test | Request and file rejection cases passed in plugins/generations/video-gen/tests/video-gen.test.ts:124 and plugins/generations/video-gen/tests/request-inputs.test.ts:82. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | coverage | — | Coverage: focused verification exercised the affected paths. See the current gitignored verifier logs for command results. |

### References

- `docs/00_ADR.md` ADR-060; `docs/design/short-form-video-promotion.md`; feature `docs/features/D9_short-form-vertical-video-generation-and-three-channel-podcast-promotion.md`
- `packages/kk-core/src/schemas.ts:66-91` (omniVoiceGenContentSchema pattern)
- `plugins/generations/vibe-voice-tts/src/{index.ts,vibevoice-client.ts:232}` (CLI + uv worker pattern)
- `plugins/kk/scripts/daily-stages.ts:3040` (input paths)
- `scripts/test-suites.ts` (HEAVY_TEST_PATTERNS)
- https://www.remotion.dev/license

### History

- 2026-11-27T08:45:30.382Z todo → wip (system)
- 2026-11-27T08:59:20.846Z wip → testing (system)
- 2026-11-27T08:59:22.065Z testing → done (system)

