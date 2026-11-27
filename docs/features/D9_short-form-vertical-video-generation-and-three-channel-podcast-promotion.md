---
schema_version: 1
id: "D9"
name: "Short-form vertical video generation and three-channel podcast promotion"
status: active
priority: P2
tags: []
created_at: "2026-11-26T19:32:00.623Z"
updated_at: "2026-11-27T08:59:21.644Z"
---

# D9: Short-form vertical video generation and three-channel podcast promotion

## Goal

Enable `knowledge-kit` to automatically generate branded 9:16 vertical promotional short videos (1080×1920, 45–60s) from the daily AI news podcast pipeline and publish them to Shipinhao, Xiaohongshu, and YouTube Shorts, while establishing a single reusable video composition architecture that supports both faceless animated editorial videos (for daily AI news) and Colab GPU-powered AI host avatar / Picture-in-Picture videos (for future non-daily formats).

## Scope

### In scope
- Typed `videoGenContentSchema` (`format: "video"`) in `@gobing-ai/kk-core`.
- Unified `plugins/generations/video-gen` generator plugin with a shared local Remotion (TypeScript/React) 9:16 composition shell: 45–60s teaser hook extraction from daily AI news, audio slicing, `faster-whisper` word-level caption timestamps, branded 1080×1920 template (headline cards, kinetic ZH/EN captions, audio waveform, platform safe-zones, podcast CTA outro), and H.264/AAC MP4 output.
- Pluggable visual modes inside `video-gen`:
  - `editorial` (M1 local Ken-Burns over existing `kk` cover/illustrations; M2 optional Wan2.1 I2V motion loops via Colab GPU with automatic fallback to local Ken-Burns so daily cron never fails).
  - `avatar` and `hybrid-pip` (M3 MuseTalk lip-sync and/or EchoMimicV2 half-body animation on Colab GPU driven by host reference image + audio, composited full-screen or as a PiP overlay inside the same Remotion shell).
- Isolated `google-colab-cli` batch GPU runner (`colab run --gpu L4|A100`) with Google Drive model-weight caching (`HF_HOME`/checkpoints), timeout/teardown guards, and Google AI Pro CCU budget tracking (~200 CCU/month).
- Multi-channel video publishing:
  - Wire video publishing into existing `shipinhao-pub` (`shortVideo`) and add a `video` publishing profile (`上传视频`) to `xhs-pub`.
  - New `plugins/publishings/youtube-pub` plugin backed by YouTube Data API v3 (`videos.insert`, OAuth2 refresh-token auth) with `private`/draft-first safety.
- Phased delivery across three shippable milestones: M1 (Daily News local editorial MVP + 3-channel publish), M2 (Colab GPU worker + Drive cache + Wan2.1 I2V), M3 (MuseTalk/EchoMimicV2 avatar & hybrid-pip modes).

### Out of scope
- Long-form horizontal (16:9) full-episode video rendering or live video podcast clipping (`FunClip`/`Openshorts`).
- Stock-footage / generic-TTS faceless automation (`MoneyPrinterTurbo`/`ShortGPT`).
- Commercial paid video generation APIs (HeyGen, Kling, Runway).
- Bypassing YouTube Data API v3 OAuth verification or auto-publishing live without explicit operator opt-in (draft/private remains the default across all three channels).

## Acceptance Criteria

```gherkin
Feature: Short-form vertical video generation and three-channel podcast promotion

  @core
  Scenario: R1 — Typed video Content contract validates video-gen outputs in kk-core
    # covers: I1, I10
    Given a video-gen output payload with format "video" and metadata containing videoPath, width 1080, height 1920, durationSec 52, visualMode "editorial", and renderProvider "local-ken-burns"
    When the payload is parsed with videoGenContentSchema from @gobing-ai/kk-core
    Then validation succeeds and preserves the typed video metadata
    And a payload missing videoPath or carrying non-positive durationSec is rejected with a schema error

  @core
  Scenario: R2 — video-gen renders a 9:16 H.264/AAC MP4 locally via Remotion from a daily AI news run
    # covers: I1, I2, I9
    Given a completed daily AI news work directory containing episode audio, curated script plan JSON, and cover artwork
    When `kk executor run video-gen` executes in "editorial" mode with local rendering
    Then it writes a 1080x1920 H.264/AAC MP4 file between 45 and 60 seconds long
    And outputs a Content JSON document conforming to videoGenContentSchema

  @core
  Scenario: R3 — Shared local composition pipeline builds teaser hook, word timestamps, captions, waveform, safe-zones, and CTA
    # covers: I2
    Given a daily AI news episode script and audio track
    When the shared composition stage prepares the Remotion input props
    Then it slices a 45 to 60 second teaser audio segment and produces word-level timestamps via faster-whisper
    And the Remotion 9:16 template renders headline cards, kinetic ZH/EN captions, an audio waveform, and a podcast CTA outro while keeping the bottom 25 percent and right 15 percent UI safe-zones unobstructed

  @core
  Scenario: R4 — Editorial mode runs 100 percent locally with Ken-Burns motion by default
    # covers: I3, I9
    Given a daily AI news run with cover and illustration images and Colab GPU rendering disabled
    When `video-gen` runs in "editorial" mode
    Then it animates the existing cover and illustrations with local Ken-Burns pan-and-zoom transitions
    And completes without invoking google-colab-cli or requiring network GPU access

  @core
  Scenario: R5 — Editorial mode falls back to local Ken-Burns when Colab Wan2.1 I2V fails or exceeds budget
    # covers: I3, I4, I5
    Given `video-gen` is configured for "editorial" mode with Colab Wan2.1 I2V enabled
    When `google-colab-cli` exits nonzero, times out, or reports the configured monthly CCU budget is exhausted
    Then `video-gen` records a warning in Content metadata and falls back to local Ken-Burns rendering
    And exits 0 with a valid 1080x1920 MP4 so the unattended daily news cron never misses an episode

  @core
  Scenario: R6 — Colab GPU runner executes headless jobs with Google Drive weight caching and teardown guards
    # covers: I4, I9
    Given a configured `colab-runner` invocation targeting an L4 or A100 runtime via `google-colab-cli`
    When a GPU visual job runs
    Then the runner mounts or resolves the configured Google Drive cache path for `HF_HOME` and model checkpoints so weights are not re-downloaded across runs
    And enforces a bounded job timeout, tears down ephemeral sessions on completion or failure, and logs estimated CCU usage against the Google AI Pro ~200 CCU/month budget

  @core
  Scenario: R7 — Editorial mode composites Colab Wan2.1 I2V motion loops inside the shared Remotion shell
    # covers: I5, I9
    Given a daily AI news cover and key illustration images and a healthy Colab L4/A100 runtime
    When `video-gen` runs in "editorial" mode with Wan2.1 I2V enabled
    Then `colab-runner` generates 3 to 5 second vertical motion-loop MP4 clips for the selected images
    And the Remotion 9:16 shell composites those clips beneath the headline cards, kinetic captions, waveform, and CTA

  @core
  Scenario: R8 — Avatar mode renders MuseTalk or EchoMimicV2 presenter video on Colab and composites in Remotion
    # covers: I6, I9
    Given a host reference portrait image, a 45 to 60 second spoken audio track, and visualMode "avatar" with provider "musetalk" or "echomimic-v2"
    When `video-gen` executes
    Then `colab-runner` generates the audio-driven talking-head or half-body presenter clip on Colab GPU
    And the shared Remotion 9:16 shell composites the presenter clip with kinetic captions and podcast CTA into the final MP4

  @core
  Scenario: R9 — Hybrid-PiP mode overlays a MuseTalk host bubble onto the editorial Remotion canvas
    # covers: I6, I9
    Given editorial visual assets, spoken audio, a host reference portrait, and visualMode "hybrid-pip"
    When `video-gen` executes
    Then `colab-runner` renders a MuseTalk host clip and Remotion composites it as a Picture-in-Picture overlay over the editorial slides
    And keeps the PiP overlay clear of the bottom 25 percent and right 15 percent platform UI safe-zones

  @core
  Scenario: R10 — Shipinhao and Xiaohongshu publishers accept video-gen Content and save drafts by default
    # covers: I7, I10
    Given a valid `videoGenContentSchema` Content JSON payload and configured `shipinhao-pub` and `xhs-pub` plugins
    When publishing runs without an explicit live override
    Then `shipinhao-pub` executes its `shortVideo` operation saving a draft by default
    And `xhs-pub` resolves its declared `video` publishing profile (`上传视频`) in `plugin.json` and saves a draft via 暂存离开 by default

  @core
  Scenario: R11 — YouTube Shorts publisher uploads via YouTube Data API v3 with private-first safety
    # covers: I8, I9
    Given a valid 9:16 MP4 `videoGenContentSchema` payload and configured YouTube Data API v3 OAuth2 credentials
    When `youtube-pub` runs without an explicit public visibility override
    Then it uploads the video via `videos.insert` tagged for YouTube Shorts with `privacyStatus` set to "private"
    And returns a `ResultSchema` record containing the uploaded video `id` and `url`

  @edge
  Scenario: R12 — Invalid video inputs or missing credentials fail closed before expensive execution
    # covers: I1, I6, I8
    Given an `avatar` request missing a host portrait, a `youtube-pub` request missing OAuth2 credentials, or a `video-gen` request with an unreadable audio file
    When the corresponding plugin validates inputs
    Then it exits nonzero with an actionable error before spawning Remotion, `google-colab-cli`, Playwright, or YouTube API upload calls
```

## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0452 | Add MuseTalk and EchoMimicV2 avatar and hybrid-pip modes to video-gen | todo |
| 0450 | Add youtube-pub plugin for YouTube Shorts via YouTube Data API v3 | todo |
| 0448 | Build video-gen plugin local Remotion editorial MVP and kk-core video contract | testing |
| 0449 | Wire video-gen Content publishing into shipinhao-pub and xhs-pub | todo |
| 0451 | Add google-colab-cli GPU runner with Drive cache and Wan2.1 I2V provider | todo |
<!-- END AUTO-GENERATED -->

## Notes

## History

- 2026-11-27T08:59:21.644Z backlog → active (system)

