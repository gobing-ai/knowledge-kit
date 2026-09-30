---
schema_version: 1
name: "Deliver the preset canvas: forward declared width/height or record the delivered size"
status: todo
template: feature-impl
created_at: 2026-09-29T02:28:56.497Z
updated_at: "2026-09-30T05:52:45.971Z"
feature_id: F618

priority: P2
---

## 0182. Deliver the preset canvas: forward declared width/height or record the delivered size

### Background

Filed from the 0179 review (P3, originally F617, renumbered to F618). Every image-gen format preset declares `width`/`height`
(`presets/formats/*.yaml`), but `processGeneratorIO` builds the provider request with only
`aspectRatio: format.aspectRatio` (`plugins/generations/image-gen/src/index.ts:318`). The declared canvas never
reaches any adapter. MiniMax `image-01` answered `xhs-card` (`3:4`, declared 1080x1440) with its default 3:4 size,
measured at **864x1152**.

What the code already has:

- `ImageRequest.width/height` exist and are documented as "providers that only take an aspect ratio ignore them"
  (`src/providers/types.ts:34-37`).
- The MiniMax adapter already sends `width`/`height` for `image-01`, validated to 512..2048 and divisible by 8
  (`src/providers/minimax.ts:53-94`). It does so only when `aspectRatio` is **undefined**. Since index.ts always sets
  `aspectRatio`, that branch is dead today.
- `ImageArtifact.width/height` exist but are never populated (`src/job.ts:79-80`).
- Other adapters treat width/height inconsistently. OpenAI, Azure, DashScope, Seedream, Z.ai, Agnes and Replicate
  turn them into a size string with their own validators. Replicate rejects edges below 1024, so the 1344x576 cover
  would now throw. Google and OpenRouter bucket them. Forwarding them blindly would regress existing presets.

This task makes the canvas declaration truthful. Declared pixels reach a provider that can honour them, and every
artifact records what was actually delivered. The composed XHS card canvas (1080x1440 regardless of provider) is
F616 / task 0180. This task covers only the raw provider artifact.

### Requirements

- [ ] R1. When the format preset declares `width` and `height`, and the resolved provider reports it can honour that exact size for the resolved model, the request carries `width`/`height` and no `aspectRatio`. The rule applies to each fallback candidate independently, with that candidate's own model.
- [ ] R2. When the provider cannot honour the exact size, or the preset declares none, the request stays aspect-only, byte-for-byte as today. There is no new validation failure for any existing preset × provider pair.
- [ ] R3. Every written `ImageArtifact` records the **delivered** `width`/`height`, measured from the image bytes (PNG, JPEG, WebP), plus `sizeRequest: 'exact' | 'aspect'`. If the preset declared a canvas and the delivered size differs, image-gen emits `WARN image-gen: <provider>/<model> delivered <W>x<H>; format '<name>' declares <W>x<H>` on stderr. It does not fail, because the bytes are already paid for. If the dimensions cannot be parsed, image-gen omits width/height and emits one WARN.
- [ ] R4. MiniMax `image-01` reports exact-size capability for 512..2048 × 512..2048 with both edges divisible by 8. Every other adapter keeps the default (no capability), so behaviour is unchanged.
- [ ] R5. The measured regression is pinned: `xhs-card` on MiniMax `image-01` sends `width: 1080, height: 1440` with no `aspect_ratio`. A stubbed 864x1152 delivery is recorded as 864x1152 and emits the mismatch WARN.

### Acceptance Criteria

- [ ] AC1 — A declared preset canvas reaches the provider (req: R1, R4)
- [ ] AC2 — A provider that cannot honour the canvas is honest about it (req: R2, R3)
- [ ] AC3 — The measured regression stays fixed (req: R5)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-30T05:50:32.248Z

- **Opt-in capability, not blind forwarding (closed).** Forwarding width/height to every adapter would change or break
  existing presets. Replicate rejects edges below 1024, which fails the 1344x576 cover, and OpenAI/DashScope map sizes
  through their own validators. Forwarding is therefore gated per provider and model by one optional method,
  `exactSize?(model, width, height): boolean`. An absent method means aspect-only. Other adapters opt in later, one at
  a time, on measured evidence (deferred; not needed for F618).
- **`aspectRatio` omitted when exact (closed).** The MiniMax adapter's existing branch sends width/height only when
  `aspectRatio` is undefined (`minimax.ts:72-89`), so index.ts omits `aspectRatio` on the exact path. Adapter body
  logic stays unchanged, and only the capability predicate is added. The implementer confirms MiniMax's documented
  precedence (aspect_ratio vs width/height) against the official image-generation API doc and cites the URL in
  Solution.
- **Mismatch warns, never fails (closed).** The provider has already billed the image by the time the size can be
  measured. Failing would delete a paid artifact through the cleanup path. The honest signal is recorded metadata plus
  a WARN.
- **Blast radius on shipped presets (closed).** On MiniMax, `cover`/`daily-news-cover` (1344x576), `illustration`
  (1152x864) and `free` (1024x1024) all pass the image-01 rule, so they switch to exact size. MiniMax's documented 21:9
  and 4:3 defaults already match those pixels, so the daily cover output is expected to be unchanged. `xhs-card`
  changes from 864x1152 to 1080x1440. No other provider changes.
- **No new dependency (closed).** Dimension parsing is a pure header reader in `src/bytes.ts`: PNG IHDR, JPEG SOFn,
  and WebP VP8/VP8L/VP8X.

### Design

**Surfaces (all in `plugins/generations/image-gen/`):**

| File | Change |
| --- | --- |
| `src/providers/types.ts` | `ImageProvider.exactSize?(model: string, width: number, height: number): boolean`, with a doc comment covering "absent = aspect-only". |
| `src/providers/minimax.ts` | `exactSize`: `model === 'image-01'` plus the existing 512..2048 / %8 rule. Refactor `validatePixelSize` into a boolean predicate that both the throwing validator and `exactSize` use. |
| `src/index.ts:311-323` | Inside `generateWithFallback`, per candidate: `const exact = format.width !== undefined && format.height !== undefined && provider.exactSize?.(model, format.width, format.height) === true;`. The request carries `{ width, height }` when `exact`, otherwise `{ aspectRatio }`. |
| `src/bytes.ts` | `imageDimensions(bytes: Uint8Array): { width: number; height: number } \| null`, which reads PNG, JPEG (SOF0-SOF15 except DHT/DAC/JPG markers) and WebP (VP8 , VP8L, VP8X). |
| `src/index.ts:373-381` | Set `artifact.width/height` from `imageDimensions(result.bytes)` and `artifact.sizeRequest`. Emit the WARN on mismatch or parse failure. |
| `src/job.ts:67-82` | Add `sizeRequest?: 'exact' \| 'aspect'` to `ImageArtifact`. |

**Invariants:**

- The dry-run branch (`index.ts:269`) is untouched. It emits no artifacts, so there is nothing to measure.
- `spec.model` is still sent only to the primary (D6). `exactSize` is evaluated with the model actually sent.
- A fallback from an exact-capable primary to an aspect-only candidate records `sizeRequest: 'aspect'` on that
  image.
- No change to the `ImageRequest` shape. The fields already exist.

### Plan

Failure modes are enumerated before any code is written (AGENTS.md isolation rule). Each gets one test:

1. PNG, JPEG and WebP fixtures with known sizes → `imageDimensions` returns the exact size. A truncated or unknown
   buffer → `null`.
2. Stub MiniMax with `fetch`, xhs-card, `image-01` → the POST body has `width:1080,height:1440` and no `aspect_ratio`
   (R1/R5).
3. The same with `model: 'image-01-live'` (or any non-image-01) → aspect-only body (R4).
4. An aspect-only stub provider (no `exactSize`) on xhs-card → the request has `aspectRatio: '3:4'` and no
   width/height (R2).
5. The stub delivers an 864x1152 PNG for xhs-card → the artifact records 864x1152 with `sizeRequest: 'exact'`, the
   mismatch WARN is on stderr, and the exit is 0 (R3/R5).
6. The stub returns unparseable bytes → no width/height recorded, the WARN is emitted, and the run succeeds (R3).
7. Fallback from primary MiniMax (fails with a transport error) to an aspect-only candidate → the candidate's request
   is aspect-only and records `sizeRequest: 'aspect'` (R1 per candidate).
8. Regression: the existing `tests/providers/*.test.ts` and `tests/fallback.test.ts` stay green unchanged.

Steps:

- [ ] Write tests 1-7 (`tests/bytes.test.ts` new; `tests/providers/minimax.test.ts` for 2-3;
      `tests/image-gen.test.ts` for 4-6; `tests/fallback.test.ts` for 7). Confirm they fail.
- [ ] `imageDimensions` in `src/bytes.ts`.
- [ ] `exactSize` on the `ImageProvider` type and on MiniMax.
- [ ] Request building and artifact recording in `src/index.ts`; `sizeRequest` in `src/job.ts`.
- [ ] Docs, same commit (T3): `docs/04_DESIGN.md` image-gen section, covering `ImageArtifact.width/height/sizeRequest`
      and the exact-size rule. Correct the `types.ts:34-35` comment.
- [ ] `bun run gate`.
- [ ] Optional operator-approved paid check, not required for PASS. One `xhs-card` render on MiniMax, recording the
      measured size in Testing.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Feature: `docs/features/F618_image-gen-preset-canvas-declared-width-height-never-reach-the-provider.md`
- Origin: task 0179 Review, P3 (filed as F617 and renumbered to F618)
- Code: `plugins/generations/image-gen/src/index.ts:311-381`, `src/providers/minimax.ts:53-94`,
  `src/providers/types.ts:28-44`, `src/job.ts:67-82`, `src/bytes.ts`
- Related: 0180 (the composer owns the final 1080x1440 card canvas; this task owns the raw provider artifact)
- Ordering: land **before** 0180. Both edit `src/index.ts` around the request/artifact block.

### History

- 2026-09-30T05:52:45.971Z backlog → todo (system)

