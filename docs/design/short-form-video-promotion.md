---
kind: design
title: "Short-form vertical video generation and three-channel podcast promotion"
status: accepted
created_at: 2026-11-26
updated_at: 2026-11-26
related: [D9]
tags: [contract, D9, plugin, video, colab, publish]
---

# Short-form vertical video generation and three-channel podcast promotion

Status: accepted design (D9; ADR-060). Specifies the typed `videoGenContentSchema` contract in `@gobing-ai/kk-core`, the unified `plugins/generations/video-gen` generator plugin (shared local Remotion 9:16 shell + pluggable visual providers), the `google-colab-cli` GPU batch runner with Drive weight caching, and three-channel video publishing across `shipinhao-pub`, `xhs-pub`, and `youtube-pub`.

## 1. Outcome, boundaries, and phased milestones

One 9:16 (`1080×1920`, 30fps, H.264/AAC, 45–60s) vertical MP4 asset promotes each daily AI news podcast episode across **Shipinhao (视频号)**, **Xiaohongshu (小红书)**, and **YouTube Shorts** without re-encoding. The same `video-gen` plugin supports two visual paradigms through one composition shell:

| Milestone | Scope | Runtime dependency | Daily cron behavior |
| --- | --- | --- | --- |
| **M1 — Daily News Local MVP** | `videoGenContentSchema`, `video-gen` (`editorial` + `local-ken-burns`), `faster-whisper` timestamps, Remotion 9:16 template, `shipinhao-pub` + `xhs-pub` `video` profile + `youtube-pub` | Local macOS (Bun + Remotion/Chromium + FFmpeg + uv `faster-whisper`) | 100% local, deterministic, zero GPU dependency |
| **M2 — Colab GPU Worker & Wan2.1 I2V** | `colab-runner` (`google-colab-cli` + Google Drive weight cache + CCU ledger) + `wan21-i2v` visual provider | Google AI Pro (~200 CCU/mo) L4/A100 | Auto-fallback to `local-ken-burns` on any Colab error/timeout/budget cap |
| **M3 — Avatar & Hybrid-PiP Modes** | `musetalk` (T4/L4 lip-sync) + `echomimic-v2` (L4/A100 half-body) Colab workers + Remotion `avatar` & `hybrid-pip` layouts | Google AI Pro T4/L4/A100 | Non-daily formats; fail-closed on missing portrait/audio or GPU failure |

**Boundaries (ADR-007 / ADR-042 / ADR-053 / ADR-060):**
- `kk` owns generation and publishing steps; `spur workflow` owns orchestration.
- Disposable intermediate renders (audio slices, word-timestamp JSON, Colab raw clips, final MP4) live under `<work_dir>/video/` in the works root; mission-critical credentials/config (`youtube` OAuth refresh token, Colab Drive cache config, host portrait registry) live under `~/.config/kk/`.
- Draft/private-first safety applies across all three channels (`shipinhao-pub`: `draft`, `xhs-pub`: `draft`, `youtube-pub`: `private`).

## 2. Typed contract (`@gobing-ai/kk-core`)

Add `videoGenContentSchema` to `packages/kk-core/src/schemas.ts` (mirroring `omniVoiceGenContentSchema`):

```ts
export const VideoVisualModeSchema = z.enum(['editorial', 'avatar', 'hybrid-pip']);
export const VideoRenderProviderSchema = z.enum([
    'local-ken-burns',
    'wan21-i2v',
    'musetalk',
    'echomimic-v2',
]);

export const videoGenContentSchema = ContentSchema.extend({
    format: z.literal('video'),
    metadata: z.looseObject({
        generator: z.literal('kk:video-gen'),
        videoPath: z.string().min(1),
        coverPath: z.string().optional(),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
        fps: z.number().int().positive(),
        durationSec: z.number().positive(),
        visualMode: VideoVisualModeSchema,
        renderProvider: VideoRenderProviderSchema,
        fallbackUsed: z.boolean().optional(),
        warnings: z.array(z.string()).optional(),
        ccuEstimated: z.number().nonnegative().optional(),
        captionsPath: z.string().optional(),
        tags: z.array(z.string()).optional(),
    }),
});
```

## 3. Unified generator plugin (`plugins/generations/video-gen`)

### Layout

```text
plugins/generations/video-gen/
  plugin.json                   # { name: "video-gen", kind: "generator", entry: "./src/index.ts", version: "1.0.0" }
  package.json                  # @gobing-ai/video-gen (remotion, @remotion/bundler, @remotion/renderer, @gobing-ai/kk-core)
  pyproject.toml                # isolated uv env for local faster-whisper word-level alignment
  src/
    index.ts                    # CLI --in/--out entry, input validation (fail-closed), provider dispatch, Content emit
    hook-slicer.ts              # 45-60s teaser hook extraction + ffmpeg audio slice from daily news work_dir
    captions.ts                 # isolated uv faster-whisper runner -> WordTimestamp[] JSON
    visual-provider.ts          # VisualProvider interface + local-ken-burns + Colab provider adapters
    colab-runner.ts             # google-colab-cli batch wrapper, Drive cache env, timeout/teardown, CCU ledger
    render.ts                   # Remotion bundle/render orchestration -> 1080x1920 H.264/AAC MP4
    remotion/
      Root.tsx                  # Composition registry (EditorialReel, AvatarReel, HybridPipReel)
      SafeZoneFrame.tsx         # Enforces bottom-25% & right-15% clear margins across Shipinhao/XHS/Shorts
      KineticCaptions.tsx       # Word-highlighted ZH/EN subtitle renderer
      WaveformBar.tsx           # Audio-reactive waveform + headline card + podcast CTA outro
  python/
    align_captions.py           # Local faster-whisper word-timestamp extractor
    colab_wan21_i2v.py          # Colab worker: image -> 3-5s 9:16 motion loop (Wan2.1 I2V)
    colab_musetalk.py           # Colab worker: portrait + audio -> lip-synced clip (MuseTalk)
    colab_echomimic_v2.py       # Colab worker: portrait + audio -> half-body clip (EchoMimicV2)
  tests/
    video-gen.test.ts           # Schema, fail-closed validation, Ken-Burns + fallback behavior
    colab-runner.test.ts        # Fake CLI runner: Drive cache args, timeout teardown, CCU budget guard
    remotion-props.test.ts      # Safe-zone bounds, caption chunking, hook duration clamping (45-60s)
```

### Shared local composition pipeline (80% shared across all modes)

1. **Input validation (fail-closed, R12):** Verify audio file exists and is readable, target duration is clamped to `45–60s`, and for `avatar`/`hybrid-pip` verify `hostPortraitPath` exists before spawning Chromium, `faster-whisper`, or `google-colab-cli`.
2. **Hook & audio slice (`hook-slicer.ts`):** Reads the daily news run's curated script plan JSON + episode audio, selects the lead teaser segment (or explicit start/end timestamps from brief metadata), and slices a clean 45–60s WAV/MP3 with fade-in/out via `ffmpeg`.
3. **Word-level timestamps (`captions.ts`):** Runs `uv run --project <pluginRoot> python python/align_captions.py` (`faster-whisper`) to produce word-level `{ word, startSec, endSec }` JSON (supports ZH and EN).
4. **Visual provider resolution (`visual-provider.ts`):**
   - `editorial` + local → `local-ken-burns` (zero GPU).
   - `editorial` + Colab enabled → `wan21-i2v`; on any error, timeout, or CCU cap hit, records warning + `fallbackUsed: true` and falls back to `local-ken-burns` (R5).
   - `avatar` → `musetalk` or `echomimic-v2` (fail-closed).
   - `hybrid-pip` → `editorial` slides for background + `musetalk` host clip for corner PiP bubble (fail-closed if avatar render fails).
5. **Remotion render (`render.ts`):** Renders `1080×1920`, `30fps`, `h264`/`aac` MP4 with `SafeZoneFrame` keeping bottom 25% (480px) and right 15% (162px) clear of platform UI buttons/captions.

Provision the local runtime once from the `video-gen` plugin directory before scheduling its first render:

```sh
uv sync --locked --no-dev
uv run --locked --no-dev python -c "from faster_whisper.utils import download_model; download_model('small')"
bun -e 'import { ensureBrowser } from "@remotion/renderer"; await ensureBrowser();'
```

Generation uses the provisioned artifacts offline. A missing browser or model fails the video step with a provisioning error.

## 4. Colab GPU batch runner (`colab-runner.ts`)

Uses `colab new --gpu <T4|L4|A100>`, uploads source media, executes the worker with VM-local paths, then downloads the clips and stops the session. The installed CLI's `colab run` starts execution on a fresh VM before the input media can be uploaded.

- **Google Drive model-weight caching (R6):** For the default Drive path, the runner attempts a bounded `colab drivemount` before executing the worker. Workers use a writable `KK_COLAB_CACHE_DIR/hf` and report a VM-local cache when Drive is unavailable.
- **Bounded timeout & teardown:** Each attempt appends a unique ID to the date-and-provider session name so its cleanup targets only that attempt. Session creation, transfer, and execution share the job deadline (default 10 min for Wan2.1/MuseTalk, 15 min for EchoMimicV2, plus 60 seconds of grace). The runner gives `colab stop -s <session>` a separate timeout and reports a cleanup failure with the session name.
- **CCU budget ledger:** Appends `{ timestamp, gpu, durationSec, estimatedCcu, jobType, status }` to `<works_dir>/colab-ccu-ledger.jsonl` (using conservative hourly burn factors: T4 ≈ 2 CCU/hr, L4 ≈ 3 CCU/hr, A100 ≈ 7 CCU/hr). Before launching a job, sums the rolling 30-day total against `maxMonthlyCcu` (default `180`, leaving headroom under Google AI Pro's ~200 CCU/month).

Avatar workers expect the upstream checkouts and their checkpoints under `$HF_HOME/musetalk-repo` and `$HF_HOME/echomimic-v2-repo`, with each model's dependencies available in the worker environment. MuseTalk uses its image-and-audio inference CLI. EchoMimicV2 uses accelerated inference with the trusted upstream pose sequence repeated forward and backward to cover the teaser.

## 5. Three-channel video publishing

### 5.1 Shipinhao (`plugins/publishings/shipinhao-pub`)
- Already implements `shortVideo` (`plugins/publishings/shipinhao-pub/src/index.ts:58`) as the default operation with `draft` default (`保存草稿`).
- Add `videoGenContentSchema` acceptance (`format: "video"`, reading `metadata.videoPath`, `metadata.coverPath`, `metadata.tags`) and wire a `video` publish preset row for daily news.

### 5.2 Xiaohongshu (`plugins/publishings/xhs-pub`)
- `xhs-pub` already implements the `上传视频` operation (`plugins/publishings/xhs-pub/src/index.ts:53`), but `plugins/publishings/xhs-pub/plugin.json:12-48` only declares the `note` profile.
- Add a `video` profile in `plugin.json`:
  - `format: "short-video"`, `locale: "zh"`, `requires: { video: true }`
  - `modes.draft`: `{ metadata: { operation: "上传视频", publishStatus: "draft" } }`
  - `modes.live`: `{ metadata: { operation: "上传视频", publishStatus: "public" } }`
- Ensure `xhs-pub` maps `videoGenContentSchema` (`metadata.videoPath` + `metadata.coverPath`) directly into `上传视频`.

### 5.3 YouTube Shorts (`plugins/publishings/youtube-pub`)
- New publish plugin using official **YouTube Data API v3** (`POST https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status`) — no Playwright dependency.
- **Auth:** OAuth2 client ID/secret + refresh token loaded from `~/.config/kk/youtube-oauth.json` (or `KK_YOUTUBE_*` env vars); fails closed before upload if missing or invalid (R12).
- **Shorts contract:** Validates 9:16 vertical aspect ratio (`height > width`) and duration `<= 180s` (default 45–60s), appends `#Shorts` to description/tags, sets `status.privacyStatus = "private"` by default (explicit `publishStatus: "public"` required to publish live; notes Google Cloud API audit constraint for unverified apps).
- **Testability:** Transport abstraction (`YouTubeUploadTransport` + `FakeYouTubeTransport`) following `@gobing-ai/publish-harness` so unit/integration tests run 100% offline.

## 6. Verification & testing strategy

- **Fast per-task tier (`bun run spur-check`):** Model-free tests using fake `faster-whisper` output, fake `google-colab-cli` binary stub, fake YouTube HTTP transport, and `FakeBrowserTransport` for `shipinhao-pub`/`xhs-pub`, clearing 90%/90% line/function coverage per file.
- **Heavy / E2E tier (`bun run test:heavy`):** Real Remotion render smoke test producing an actual 5s `1080×1920` H.264/AAC MP4 verified via `ffprobe` (resolution, codec, audio stream, duration).
- **Live dogfood (operator-triggered):** One real Colab L4 run for M2 (`wan21-i2v`) and M3 (`musetalk`), plus one real `draft`/`private` upload to Shipinhao, XHS, and YouTube Shorts.
