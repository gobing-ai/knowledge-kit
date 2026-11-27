---
schema_version: 1
name: Add MuseTalk and EchoMimicV2 avatar and hybrid-pip modes to video-gen
status: todo
template: feature-impl
created_at: 2026-11-26T19:50:42.669Z
updated_at: "2026-11-26T23:19:10.134Z"
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

- [ ] R1. `python/colab_musetalk.py` and `python/colab_echomimic_v2.py` are remote workers following 0451's cache convention (`HF_HOME=$KK_COLAB_CACHE_DIR/hf` when writable). Each takes `{portrait, audio, out}` and writes an MP4 plus a JSON result.
- [ ] R2. `musetalkProvider` and `echomimicV2Provider` in `visual-provider.ts` call 0451's `runColabJob` with jobTypes `musetalk` (default T4, 600 000 ms) and `echomimic-v2` (default A100, 900 000 ms, T4 refused), and they return `{kind:'clips'}`.
- [ ] R3. `AvatarReel` (full-frame presenter + `KineticCaptions` + CTA) and `HybridPipReel` (`EditorialReel` + a circular PiP bubble) are registered in `Root.tsx`. The PiP geometry comes from a pure `pipBox()` in `layout.ts` that passes `assertInSafeArea`.
- [ ] R4. For `visualMode` `avatar`/`hybrid-pip`: a missing, non-absolute or non-image `hostPortraitPath`, unreadable audio, a T4 + echomimic-v2 combination, or a CCU budget refusal exits nonzero **before** any Colab spawn. A Colab synthesis failure, timeout or missing output exits nonzero with no MP4 written. The "not yet shipped" guard from 0448 is removed.
- [ ] R5. Request schema extension: `provider?: 'musetalk'|'echomimic-v2'` (default `musetalk`; `hybrid-pip` only allows `musetalk`) and `hostPortraitPath?: string`.
- [ ] R6. Avatar and hybrid-pip renders draw a persistent "AI生成" label inside the safe area and set `metadata.syntheticPresenter: true`. youtube-pub maps `syntheticPresenter` to `status.containsSyntheticMedia: true`, after the field is verified in the API reference. If the field does not exist, drop the mapping and note it in Solution.

**Out of scope:** a portrait registry or face-consent workflow; voice cloning; real-time avatars; changing editorial fallback semantics; daily default enablement.

### Acceptance Criteria

- [ ] AC1 — Avatar mode renders MuseTalk or EchoMimicV2 presenter video on Colab and composites in Remotion (req: R1, R2, R3, R5, R6)
  - Observed by fast `tests/avatar-provider.test.ts` (a stub `colab`: the argv for each provider has the right `--gpu`/`--timeout`, and the Content has `syntheticPresenter: true`) and heavy `tests/render-avatar-e2e.test.ts` (a fixture presenter clip, no Colab, rendered through `AvatarReel`; ffprobe 1080×1920 h264+aac). A real Colab run is manual and operator-approved, recorded in Testing.
- [ ] AC2 — Hybrid-PiP mode overlays a MuseTalk host bubble onto the editorial Remotion canvas (req: R3, R5)
  - Observed by fast `tests/remotion-props.test.ts`: `pipBox()` sits clear of y ≥ 1440 and x ≥ 918, and hybrid-pip + echomimic-v2 is rejected. The heavy render is covered by the same e2e via `HybridPipReel`.
- [ ] AC3 — Invalid video inputs or missing credentials fail closed before expensive execution (req: R4)
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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- `docs/00_ADR.md` ADR-060; `docs/design/short-form-video-promotion.md`; feature `docs/features/D9_short-form-vertical-video-generation-and-three-channel-podcast-promotion.md`
- 0451 Design (runner/ledger), 0448 Design (SAFE_ZONE, request schema)
- https://developers.google.com/youtube/v3/docs/videos (status.containsSyntheticMedia — verify)
- 《人工智能生成合成内容标识办法》 (effective 2025-09-01 — verify official text)

### History
