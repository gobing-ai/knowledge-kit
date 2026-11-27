---
schema_version: 1
name: Build video-gen plugin local Remotion editorial MVP and kk-core video contract
status: todo
template: feature-impl
created_at: 2026-11-26T19:50:42.658Z
updated_at: "2026-11-26T23:19:08.513Z"
feature_id: D9
priority: P1
tags:
  - M1
  - video-gen
  - remotion
  - kk-core
estimate_hours: 8

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

- [ ] R1. `packages/kk-core/src/schemas.ts` exports `VideoVisualModeSchema`, `VideoRenderProviderSchema`, `videoGenContentSchema` and type `VideoGenContent`, exactly as `docs/design/short-form-video-promotion.md` §2, re-exported from `packages/kk-core/src/index.ts`. A payload missing `metadata.videoPath`, or with `durationSec <= 0`, is rejected.
- [ ] R2. `plugins/generations/video-gen/` is a Bun workspace plugin (`plugin.json` `kind: generator`, `package.json` `@gobing-ai/video-gen`, `tsconfig.json` with `jsx: react-jsx`, `pyproject.toml` + `uv.lock`) that `kk executor run video-gen --in <request.json> --out <content.json>` discovers and runs.
- [ ] R3. With `visualMode: "editorial"` and a daily work dir, the plugin writes a 1080×1920, 30fps, H.264 video + AAC audio MP4 of 45–60s to `<workDir>/32-video/<runDate>_video.mp4` and a `videoGenContentSchema`-valid Content (non-empty `title` and `body`; `renderProvider: "local-ken-burns"`) to `--out`.
- [ ] R4. The composition pipeline slices a 45–60s teaser from the episode audio with `ffmpeg`, gets word-level timestamps from a locked uv `faster-whisper` worker (`python/align_captions.py`), and renders headline cards, kinetic captions, a waveform and a CTA outro with nothing inside the bottom 480px or right 162px safe-zones.
- [ ] R5. Editorial mode animates the cover and card images with local Ken-Burns pan/zoom and spawns no `colab` process and makes no network call.
- [ ] R6. Unreadable/missing audio, an unknown or not-yet-shipped `visualMode` (`avatar`, `hybrid-pip` until 0452), or a hook window outside 45–60s exits nonzero with an actionable message **before** spawning `ffmpeg`, `uv`, or Chromium.

**Out of scope:** Colab / `wan21-i2v` (0451); `avatar`/`hybrid-pip` (0452); publisher changes and daily-workflow wiring (0449); YouTube (0450); a host-portrait registry; 16:9 output; TTS.

### Acceptance Criteria

- [ ] AC1 — Typed video Content contract validates video-gen outputs in kk-core (req: R1)
  - Given/When/Then: the feature R1 scenario, observed by `packages/kk-core/tests/schemas.test.ts` (pure zod parse).
- [ ] AC2 — video-gen renders a 9:16 H.264/AAC MP4 locally via Remotion from a daily AI news run (req: R2, R3)
  - Observed by the heavy-tier `plugins/generations/video-gen/tests/render-e2e.test.ts`: real Remotion render over a fixture work dir, then `ffprobe` asserts 1080×1920, h264, an aac stream, and duration. The fixture clip may be shortened via the request's test-only `hook` window, but the duration clamp must be asserted in the fast tier.
- [ ] AC3 — Shared local composition pipeline builds teaser hook, word timestamps, captions, waveform, safe-zones, and CTA (req: R4)
  - Observed by fast-tier `tests/remotion-props.test.ts` and `tests/hook-slicer.test.ts`, with a fake `faster-whisper` JSON and a recorded `ffmpeg` argv. Assert hook clamping, caption chunking, and that every layout box sits clear of y ≥ 1440 and x ≥ 918.
- [ ] AC4 — Editorial mode runs 100 percent locally with Ken-Burns motion by default (req: R5)
  - Observed by fast-tier `tests/video-gen.test.ts` with an injected process runner: the recorded argv list has no `colab` entry and `renderProvider === 'local-ken-burns'`.
- [ ] AC5 — Invalid video inputs or missing credentials fail closed before expensive execution (req: R6)
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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- `docs/00_ADR.md` ADR-060; `docs/design/short-form-video-promotion.md`; feature `docs/features/D9_short-form-vertical-video-generation-and-three-channel-podcast-promotion.md`
- `packages/kk-core/src/schemas.ts:66-91` (omniVoiceGenContentSchema pattern)
- `plugins/generations/vibe-voice-tts/src/{index.ts,vibevoice-client.ts:232}` (CLI + uv worker pattern)
- `plugins/kk/scripts/daily-stages.ts:3040` (input paths)
- `scripts/test-suites.ts` (HEAVY_TEST_PATTERNS)
- https://www.remotion.dev/license

### History
