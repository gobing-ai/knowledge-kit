---
schema_version: 1
name: Add MuseTalk and EchoMimicV2 avatar and hybrid-pip modes to video-gen
status: done
template: feature-impl
created_at: 2026-11-26T19:50:42.669Z
updated_at: "2026-11-28T02:45:28.878Z"
feature_id: D9
priority: P2
tags:
  - M3
  - avatar
  - hybrid-pip
  - musetalk
  - echomimic-v2
estimate_hours: 6

dependencies: ["0451", "0450"]
done_forced: "true"
done_reason: "Operator-approved force-done 2026-11-27: avatar/hybrid code shippable (gate 6262/0, heavy 575/0 incl. render-avatar-e2e). Live MuseTalk/EchoMimicV2 runs skipped by operator (no consented portrait). Follow-up: 0453 R4."
---

## 0452. Add MuseTalk and EchoMimicV2 avatar and hybrid-pip modes to video-gen

### Background

Milestone 3 avatar & Picture-in-Picture modes for Feature D9 (ADR-060, docs/design/short-form-video-promotion.md §3, §5). Reuses the shared Remotion 9:16 shell and colab-runner from M1/M2 to support AI host presenter videos for future non-daily formats (weekly commentary, explainers, multilingual promos).

Implements: R8 — Avatar mode renders MuseTalk or EchoMimicV2 presenter video on Colab and composites in Remotion; R9 — Hybrid-PiP mode overlays a MuseTalk host bubble onto the editorial Remotion canvas; R12 — Invalid video inputs or missing credentials fail closed before expensive execution.

**Refine corrections (2026-11-26)** — `/sp:dev-refine --all --feature D9 --auto --depth ready`
- 0448 R6 refuses `avatar`/`hybrid-pip` as "not yet shipped" → this task must **lift** that guard. Otherwise the new providers are unreachable (R4).
- The safe-zone numbers were restated as percentages ("bottom-25%, right-15%"). → Reuse 0448's frozen `SAFE_ZONE = {bottomPx: 480, rightPx: 162}` (480/1920 = 25%, 162/1080 = 15%), and do not re-derive them.
- The failure policy differs from editorial on purpose. 0451 makes editorial fall back with exit 0, but avatar and hybrid-pip have no honest fallback (a missing presenter is a broken video) → exit nonzero. The daily `video` node (0449) has `onError: continue`, so a failure skips the video variants and does not kill the run.
- Missing: synthetic-presenter disclosure. A lip-synced likeness is synthetic media. China's AI-generated content labeling measures (《人工智能生成合成内容标识办法》, effective 2025-09-01) require an explicit label, and YouTube's `videos` resource has a `status.containsSyntheticMedia` flag. Both are **to be verified against the official text and API reference at implementation**. → R6 adds a visible in-frame "AI生成" label, Content `metadata.syntheticPresenter: true`, and the youtube-pub mapping.
- The host portrait must be the operator's own likeness, or used with recorded consent → Q&A. The plugin only accepts an explicit `hostPortraitPath`; there is no portrait discovery or registry.
- GPU tiers follow 0451's runner: MuseTalk defaults to `T4` (L4 allowed); EchoMimicV2 defaults to `A100` (L4 allowed, T4 refused). Timeouts are 10 min / 15 min (design §4).

### Requirements

- [x] R1. `python/colab_musetalk.py` and `python/colab_echomimic_v2.py` are remote workers following 0451's cache convention (`HF_HOME=$KK_COLAB_CACHE_DIR/hf` when writable). Each takes `{portrait, audio, out}` and writes an MP4 plus a JSON result.
- [x] R2. `musetalkProvider` and `echomimicV2Provider` in `visual-provider.ts` call 0451's `runColabJob` with jobTypes `musetalk` (default T4, 600 000 ms) and `echomimic-v2` (default A100, 900 000 ms, T4 refused), and they return `{kind:'clips'}`.
- [x] R3. `AvatarReel` (full-frame presenter + `KineticCaptions` + CTA) and `HybridPipReel` (`EditorialReel` + a circular PiP bubble) are registered in `Root.tsx`. The PiP geometry comes from a pure `pipBox()` in `layout.ts` that passes `assertInSafeArea`.
- [x] R4. For `visualMode` `avatar`/`hybrid-pip`: a missing, non-absolute or non-image `hostPortraitPath`, unreadable audio, a T4 + echomimic-v2 combination, or a CCU budget refusal exits nonzero **before** any Colab spawn. A Colab synthesis failure, timeout or missing output exits nonzero with no MP4 written. The "not yet shipped" guard from 0448 is removed.
- [x] R5. Request schema extension: `provider?: 'musetalk'|'echomimic-v2'` (default `musetalk`; `hybrid-pip` only allows `musetalk`) and `hostPortraitPath?: string`.
- [x] R6. Avatar and hybrid-pip renders draw a persistent "AI生成" label inside the safe area and set `metadata.syntheticPresenter: true`. youtube-pub maps `syntheticPresenter` to `status.containsSyntheticMedia: true`, after the field is verified in the API reference. If the field does not exist, drop the mapping and note it in Solution.

**Out of scope:** a portrait registry or face-consent workflow; voice cloning; real-time avatars; changing editorial fallback semantics; daily default enablement.

### Acceptance Criteria

- [x] AC1 — Avatar mode renders MuseTalk or EchoMimicV2 presenter video on Colab and composites in Remotion (req: R1, R2, R3, R5, R6)
  - Observed by fast `tests/avatar-provider.test.ts` (a stub `colab`: the argv for each provider has the right `--gpu`/`--timeout`, and the Content has `syntheticPresenter: true`) and heavy `tests/render-avatar-e2e.test.ts` (a fixture presenter clip, no Colab, rendered through `AvatarReel`; ffprobe 1080×1920 h264+aac). A real Colab run is manual and operator-approved, recorded in Testing.
- [x] AC2 — Hybrid-PiP mode overlays a MuseTalk host bubble onto the editorial Remotion canvas (req: R3, R5)
  - Observed by fast `tests/remotion-props.test.ts`: `pipBox()` sits clear of y ≥ 1440 and x ≥ 918, and hybrid-pip + echomimic-v2 is rejected. The heavy render is covered by the same e2e via `HybridPipReel`.
- [x] AC3 — Invalid video inputs or missing credentials fail closed before expensive execution (req: R4)
  - Observed by `tests/video-gen.test.ts`: each R4 pre-launch case exits nonzero with zero stub invocations. The synthesis-failure stub exits nonzero and leaves no `32-video/<d>_video.mp4`.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-26T23:18:53.845Z

- **Fall back to editorial when the avatar fails?** Closed: no. The operator chose avatar mode explicitly, and a silent mode switch would misrepresent the output. Exit nonzero; the daily node continues.
- **Whose face?** Closed: only the operator's own portrait, or one with recorded consent outside kk. The plugin takes an explicit path and never fetches or discovers faces.
- **Disclosure?** Closed: always-on for avatar and hybrid-pip (in-frame label + metadata). Verify the legal and API specifics at implementation (Background).
- **Separate task for the youtube-pub mapping?** Closed: no. It is one field mapping in 0450's client, kept here so the disclosure ships with the feature that needs it.

### Design

**Frozen names.** Providers `musetalkProvider` and `echomimicV2Provider`. Layout: `pipBox(): Box` with diameter 320px, anchored at bottom-left above the bottom safe-zone (x=48, y=1440−48−320), and `aiLabelBox(): Box` at top-left. Components `AvatarReel` and `HybridPipReel` and an `AiLabel` overlay. The metadata key is `syntheticPresenter`. Request fields are `provider` and `hostPortraitPath` on 0448's `VideoGenRequestSchema`. All of these reuse 0451's `runColabJob`, `CCU_PER_HOUR` and ledger unchanged.
- PiP: a circular `<OffthreadVideo>` mask over `EditorialReel` (Ken-Burns stills by default). Avatar: a full-frame presenter with captions over it, inside the safe area.

**Anti-patterns.** Do not duplicate the Colab runner logic. Do not hardcode a portrait. Do not skip the label "for aesthetics". Do not branch in `.tsx` (keep geometry in `layout.ts` for fast-tier coverage). Do not change editorial fallback.

### Plan

0. Preconditions: 0451 is done (the runner is frozen, the spike is recorded). The operator supplies a consented portrait for the manual check.
1. R4/R5: write the failing validation tests (zero stub spawns), then the schema extension and the removal of the 0448 guard.
2. R3: write the `pipBox`/`aiLabelBox` tests, then `layout.ts`, `AvatarReel`, `HybridPipReel` and `AiLabel`.
3. R1/R2: write the stub-colab provider tests, then the providers and the two remote worker scripts.
4. R6: write the `syntheticPresenter` assertion. Verify `status.containsSyntheticMedia` in https://developers.google.com/youtube/v3/docs/videos, then add the youtube-pub mapping and its test.
5. Add the heavy fixture render e2e, registered in `HEAVY_TEST_PATTERNS`.
6. Gate: `bun run lint`, `bun run test`, `bun run test:heavy`, `bun run build`, then sync if `plugins/kk` changed. Then one operator-approved real MuseTalk run, recorded in Testing.

### Solution

Adds the two avatar visual modes on top of 0451's Colab plane (design §3), lifting 0448's editorial-only
guard and keeping the disclosure obligations of synthetic likenesses.

**R5 — request surface** `src/request.ts`: `SHIPPED_VISUAL_MODES` now covers
`editorial|avatar|hybrid-pip`, `provider` accepts `musetalk`/`echomimic-v2`
(`SHIPPED_PROVIDERS`), and `hostPortraitPath` is a first-class field. `parseVideoGenRequest` is the whole pre-spawn ladder: editorial refuses an avatar provider; avatar/hybrid-pip require
a presenter provider (default `musetalk`), `hybrid-pip` allows `musetalk` only, and the portrait must be
present, **absolute** and a `.png/.jpg/.jpeg/.webp` image. The 0448 "not shipped" guard is gone.

**R4 — fail closed before any Colab spawn** `src/index.ts`: the avatar branch stats the portrait and throws `video-gen: host portrait … is missing or unreadable` before the provider runs; the
T4 + `echomimic-v2` refusal lives in `createEchomimicV2Provider` (`src/visual-provider.ts`), which throws
before `runJob` is called. Colab synthesis failure, timeout or a clip missing on disk exits **nonzero**
with no MP4 — deliberately no fallback (Q&A).

**R1 — remote workers** `python/colab_musetalk.py`, `python/colab_echomimic_v2.py`: same
`choose_cache()` convention as 0451 (`HF_HOME=$KK_COLAB_CACHE_DIR/hf` when writable, `cache:
drive|local` in the `KK_COLAB_RESULT` line), portrait + audio + out, and the EchoMimicV2 worker
re-refuses a T4 runtime.

**R2 — providers** `src/visual-provider.ts`: `createMusetalkProvider` (T4, 600 000 ms) and
`createEchomimicV2Provider` (A100, 900 000 ms, T4 refused) share one `createAvatarProvider` over
0451's `runColabJob` (unchanged) and return `{kind:'clips'}` with exactly one presenter clip (plus the
same existence probe 0451 added). `resolveAvatarProvider` picks by provider id.

**R3 — shells + geometry** `src/layout.ts`: `PIP_DIAMETER_PX` 320, `PIP_GAP_PX` 48, `pipBox()`
(bottom-left, above the 480px strip) and `aiLabelBox()`, both proven by
`assertInSafeArea` in the fast tier. `src/remotion/AvatarReel.tsx` (full-frame `OffthreadVideo` +
headline, captions, waveform, CTA tail), `src/remotion/HybridPipReel.tsx` (EditorialReel + circular
masked bubble), `src/remotion/AiLabel.tsx`, all registered in `Root.tsx` with their own composition
ids (`EditorialReel`, `AvatarReel`, `HybridPipReel`); `RenderArgs.compositionId` lets the shell be
chosen per render. Props are built by `buildAvatarProps` / `buildHybridPipProps` (`src/props.ts`), so
the `.tsx` files hold no branching.

**R6 — disclosure** `AiLabel` draws a persistent `AI生成` chip inside the safe area on every frame of
both avatar shells, and the Content carries `metadata.syntheticPresenter: true`
(`src/index.ts` `emitContent`). `youtube-pub` maps that flag to
`status.containsSyntheticMedia: true` (`plugins/publishings/youtube-pub/src/youtube-client.ts`),
verified against the Data API v3 `videos` resource reference (2026-11-27) — the field exists, so the
mapping ships.

**Evidence.** Fast: `tests/avatar-provider.test.ts` (request ladder with zero spawns, both shells
through `main()`, synthesis failure with no MP4, provider defaults), `tests/remotion-props.test.ts`
(pipBox/aiLabelBox + the two prop builders), `tests/request-inputs.test.ts` (mode/provider agreement),
`plugins/publishings/youtube-pub/tests/youtube-pub.test.ts` (`containsSyntheticMedia` on, absent when
not synthetic). Heavy: `tests/render-avatar-e2e.test.ts` renders both `AvatarReel` and `HybridPipReel`
from a fixture presenter clip (ffprobe 1080×1920 h264+aac), registered in `HEAVY_TEST_PATTERNS`.

**Not done.** One real MuseTalk/EchoMimicV2 Colab run and a real upload with the disclosure flag need
the operator's go-ahead, a consented portrait and authenticated CLIs; nothing here has spent a compute
unit or touched YouTube.

### Testing

**Pipeline verify results**

- Verdict: PARTIAL (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | PARTIAL | .spur/run/0449-0451-0452-worker-contracts.log exercises media and output contracts against local CLI fixtures. Live prepared model checkouts are unverified. MuseTalk: https://github.com/TMElyralab/MuseTalk/blob/main/inference.sh. EchoMimicV2: https://github.com/antgroup/echomimic_v2/blob/main/infer_acc.py. |
| R2 | PARTIAL | plugins/generations/video-gen/tests/avatar-provider.test.ts:199 verifies GPU and timeout defaults and plugins/generations/video-gen/tests/colab-runner.test.ts:113 verifies runner ownership. Live presenter synthesis is unverified. |
| R3 | MET | plugins/generations/video-gen/tests/render-avatar-e2e.test.ts:44 renders both compositions and probes 1080x1920 H.264/AAC. plugins/generations/video-gen/tests/remotion-props.test.ts:61 checks layout. |
| R4 | MET | plugins/generations/video-gen/tests/avatar-provider.test.ts:90 and :169 prove pre-launch refusal and no MP4 on failure. |
| R5 | MET | plugins/generations/video-gen/tests/avatar-provider.test.ts:97 and :199 prove mode constraints and provider defaults. |
| R6 | MET | plugins/generations/video-gen/tests/avatar-provider.test.ts:135 verifies synthetic presenter metadata. plugins/publishings/youtube-pub/tests/youtube-pub.test.ts:135 covers the insert payload. API reference: https://developers.google.com/youtube/data/reference/rest/v3/videos/insert. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R8 — Avatar mode renders MuseTalk or EchoMimicV2 presenter video on Colab and composites in Remotion | PARTIAL | test | plugins/generations/video-gen/tests/render-avatar-e2e.test.ts:44 validates local composition with a fixture. Live presenter synthesis is pending. |
| R9 — Hybrid-PiP mode overlays a MuseTalk host bubble onto the editorial Remotion canvas | PARTIAL | test | plugins/generations/video-gen/tests/render-avatar-e2e.test.ts:44 and plugins/generations/video-gen/tests/remotion-props.test.ts:61 verify composition and safe zones. Live MuseTalk synthesis is pending. |
| R12 — Invalid video inputs or missing credentials fail closed before expensive execution | MET | test | plugins/generations/video-gen/tests/avatar-provider.test.ts:90 and plugins/publishings/youtube-pub/tests/youtube-pub.test.ts cover invalid inputs and missing auth. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

**Closing pass (2026-11-27):** The operator decided to skip the live MuseTalk/EchoMimicV2 runs (no consented portrait supplied), so R1/R2 stay PARTIAL as documented live limits. This task inherits 0451's runner fix (`plugins/generations/video-gen/src/colab-runner.ts:182`: a 600s allocation cap; a live A100 allocation took 2m44s) and its open live findings (headless `drivemount` needs per-VM consent; `colab exec` exits 0 on worker failure). The fast avatar suites re-ran green this pass (`tests/avatar-provider.test.ts`, `tests/remotion-props.test.ts`: part of 60 pass / 0 fail); `bun run gate` exit 0 (6262/0); `bun run test:heavy` exit 0 (575/0, including `render-avatar-e2e`).

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PARTIAL)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | secua-review | — | Local media validation, fail-closed handling, Remotion composition and disclosure pass. The real GPU acceptance path is pending. |

### References

- `docs/00_ADR.md` ADR-060; `docs/design/short-form-video-promotion.md`; feature `docs/features/D9_short-form-vertical-video-generation-and-three-channel-podcast-promotion.md`
- 0451 Design (runner/ledger), 0448 Design (SAFE_ZONE, request schema)
- https://developers.google.com/youtube/v3/docs/videos (status.containsSyntheticMedia — verify)
- 《人工智能生成合成内容标识办法》 (effective 2025-09-01 — verify official text)

### History

- 2026-11-27T16:48:41.738Z todo → wip (system)
- 2026-11-27T16:51:55.989Z wip → testing (system)
- 2026-11-27T16:51:57.255Z testing → done (system)
- 2026-11-27T19:36:34.186Z done → wip (system)
- 2026-11-27T19:36:35.810Z wip → testing (system)
- 2026-11-28T02:45:28.717Z testing → done (system)

