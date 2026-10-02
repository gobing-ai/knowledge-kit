---
schema_version: 1
name: "Deliver the preset canvas: forward declared width/height or record the delivered size"
status: testing
template: feature-impl
created_at: 2026-09-29T02:28:56.497Z
updated_at: "2026-10-02T11:00:07.420Z"
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

- [x] R1. When the format preset declares `width` and `height`, and the resolved provider reports it can honour that exact size for the resolved model, the request carries `width`/`height` and no `aspectRatio`. The rule applies to each fallback candidate independently, with that candidate's own model.
- [x] R2. When the provider cannot honour the exact size, or the preset declares none, the request stays aspect-only, byte-for-byte as today. There is no new validation failure for any existing preset × provider pair.
- [x] R3. Every written `ImageArtifact` records the **delivered** `width`/`height`, measured from the image bytes (PNG, JPEG, WebP), plus `sizeRequest: 'exact' | 'aspect'`. If the preset declared a canvas and the delivered size differs, image-gen emits `WARN image-gen: <provider>/<model> delivered <W>x<H>; format '<name>' declares <W>x<H>` on stderr. It does not fail, because the bytes are already paid for. If the dimensions cannot be parsed, image-gen omits width/height and emits one WARN.
- [x] R4. MiniMax `image-01` reports exact-size capability for 512..2048 × 512..2048 with both edges divisible by 8. Every other adapter keeps the default (no capability), so behaviour is unchanged.
- [x] R5. The measured regression is pinned: `xhs-card` on MiniMax `image-01` sends `width: 1080, height: 1440` with no `aspect_ratio`. A stubbed 864x1152 delivery is recorded as 864x1152 and emits the mismatch WARN.

### Acceptance Criteria

- [x] AC1 — A declared preset canvas reaches the provider (req: R1, R4)
- [x] AC2 — A provider that cannot honour the canvas is honest about it (req: R2, R3)
- [x] AC3 — The measured regression stays fixed (req: R5)

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

- [x] Write tests 1-7 (`tests/bytes.test.ts` new; `tests/providers/minimax.test.ts` for 2-3;
      `tests/image-gen.test.ts` for 4-6; `tests/fallback.test.ts` for 7). Confirm they fail.
- [x] `imageDimensions` in `src/bytes.ts`.
- [x] `exactSize` on the `ImageProvider` type and on MiniMax.
- [x] Request building and artifact recording in `src/index.ts`; `sizeRequest` in `src/job.ts`.
- [x] Docs, same commit (T3): `docs/04_DESIGN.md` image-gen section, covering `ImageArtifact.width/height/sizeRequest`
      and the exact-size rule. Correct the `types.ts:34-35` comment.
- [x] `bun run gate`.

Optional follow-up (not a pipeline step): operator-approved paid check — one `xhs-card` render on MiniMax, recording
the measured size in Testing. Explicitly not required for PASS; not executed this run.

### Solution

Implemented the preset canvas end to end (AC1/AC2/AC3): presets with declared `width`/`height` now reach a provider that reports it can honour them (aspect ratio omitted on that request), every other provider keeps the byte-identical aspect-only request shape, and every delivery is measured and recorded — a declared canvas that comes back different (or unparseable) warns and never fails, because the bytes are already paid for.

## Change map (file:line)

**Request gate (AC1, R1/R4)**
- `plugins/generations/image-gen/src/providers/types.ts:77` — new optional `ImageProvider.exactSize(model, width, height): boolean` capability; absent ⇒ aspect-only (R4 default). `plugins/generations/image-gen/src/providers/types.ts:31-38` documents that `ImageRequest.width/height` are only ever sent when the resolved provider reports the capability, with `aspectRatio` omitted.
- `plugins/generations/image-gen/src/providers/minimax.ts:54-56` — `isAcceptablePixelSize` (512..2048 both edges, divisible by 8, per MiniMax image-01 rule); `plugins/generations/image-gen/src/providers/minimax.ts:59-67` — existing throwing `validatePixelSize` now derives from the same predicate, keeping both frozen error messages; `plugins/generations/image-gen/src/providers/minimax.ts:155-156` — `exactSize: model === 'image-01' && isAcceptablePixelSize(w, h)`.
- `plugins/generations/image-gen/src/index.ts:407-418` — the gate runs **per candidate** with that candidate's own model (R4/D6: the primary's spec.model never leaks to a candidate); exact path sends `width`/`height` and omits `aspectRatio` (MiniMax reads them only when aspect_ratio is absent); non-exact request shape is unchanged.

**Delivery measurement + honest recording (AC2/AC3, R3/R5)**
- `plugins/generations/image-gen/src/bytes.ts:29-31` — `imageDimensions` returns `{ width, height } | null` (was PNG-only throwing); adds a JPEG SOFn marker walk (`plugins/generations/image-gen/src/bytes.ts:55-83`, SOF0–CF minus DHT/DAC/JPG) and a WebP RIFF chunk walk (`plugins/generations/image-gen/src/bytes.ts:85-131`: VP8 lossy frame header, VP8L 14-bit lossless, VP8X 24-bit extended, even-size chunk padding). Truncated/mis-signed/unknown bytes parse to `null` — no throw (0180 escalation decision A, implemented by this task).
- `plugins/generations/image-gen/src/index.ts:456-472` — raw provider bytes measured once; `plugins/generations/image-gen/src/index.ts:462-471` — mismatch ⇒ `WARN image-gen: <provider>/<model> delivered <WxH>; format '<name>' declares <WxH>`, unparseable ⇒ `WARN ... delivered unparseable image bytes; dimensions omitted`; both warn only — the run never fails after spend.
- `plugins/generations/image-gen/src/job.ts:80-88` — `ImageArtifact.sizeRequest: 'exact' | 'aspect'` (+ corrected width/height comment); `plugins/generations/image-gen/src/index.ts:575` — recorded on every written artifact.
- `plugins/generations/image-gen/src/index.ts:552-555` — compose path keeps the card canvas on the parent artifact (0180 behaviour) and now populates `illustration.width/height` from the raw provider delivery — the recorded 864x1152 home on the xhs-card compose path; `plugins/generations/image-gen/src/index.ts:560-566` — non-compose artifacts record delivered `width`/`height`; `plugins/generations/image-gen/src/index.ts:535-537` — compose now throws a specific error when the composed card itself is unparseable (previously unreachable throw-shape).

**Tests (9 new + 1 contract migration)**
- `plugins/generations/image-gen/tests/bytes.test.ts` (new, 13 tests) — PNG/JPEG(SOF0,SOF2,DHT-skip)/WebP(VP8,VP8L,VP8X,sync-corruption) fixtures parse exact canvases; truncation, mis-signature, junk ⇒ `null`.
- `plugins/generations/image-gen/tests/providers/minimax.test.ts:70-117` — exactSize units (shipped canvases pass; 504/2049/1082 and image-01-live fail); POST body pins: exact ⇒ width/height, no aspect_ratio; non-image-01 ⇒ aspect body byte-for-byte as before 0182.
- `plugins/generations/image-gen/tests/image-gen.test.ts:493-557` — pipeline level: aspect-only stub on xhs-card ⇒ `aspectRatio '3:4'`, no width/height (R2); exact-capable stub delivering 864x1152 on declared 1080x1440 ⇒ request pins, `sizeRequest 'exact'`, `illustration {864,1152}`, exact WARN text pinned (R1/R3/R5); junk delivery ⇒ dims omitted, exactly one WARN, run succeeds; model gate: image-01-live stays aspect-only (R4/D6).
- `plugins/generations/image-gen/tests/fallback.test.ts:318-342` — per-candidate gate across fallback: exact primary (cover 1344x576, aspectRatio omitted) auth-fails ⇒ aspect-only candidate on its own default model, recorded `sizeRequest 'aspect'` (R1/R2); stub gains an `exact` option.
- `plugins/generations/image-gen/tests/compose-cmap.test.ts` — the 0180 `imageDimensions` throw-contract block moved to `plugins/generations/image-gen/tests/bytes.test.ts` under the new `null` contract (file was not in the frozen list).

## Verification

- Targeted (`bun test` in plugins/generations/image-gen): `Ran 89 tests across 6 files ... 89 pass, 0 fail` — includes all 9 new 0182 tests and the migrated contract suite above (full per-test pass lines: `0182 — the preset canvas reaches the provider...` x4, `imageDimensions ...` x13 incl. PNG/JPEG/WebP, `minimax exactSize ...` x4, fallback 0182 test).
- Full plugin suite: `426 pass, 2 skip (pre-existing 0180 real-Chromium E2E, env-gated), 0 fail`.
- Repo gates: `bun run lint` clean (Biome 2.5.5 + typecheck, 0 errors 0 warnings); `bun run test` 1662 pass / 0 fail / 2 pre-existing skips, aggregate coverage 98.59% line / 98.24% function (gate 90/90), `bytes.ts` 100% lines; `bun run build` ok; `bun run gate` ok incl. `spur rule run` 2/2.

## Evidence gap (named, not hidden)

The MiniMax `image-01` size rule (512..2048 per edge, divisible by 8, width/height honoured when aspect_ratio absent) could not be re-verified against platform.minimaxi.com during this run — the docs site is a JS SPA that returns 404/cookie-shell to anonymous fetch (curl, reader proxies, and search all failed). The predicate is frozen by pre-existing pinned tests and was implemented exactly per the task's frozen design; the citation gap should be closed when network access to the official docs is available. No official-doc citation is claimed in code comments.

## Blast-radius confirmation (Q&A, closed)

MiniMax is the only `exactSize` adapter. Every other provider — google, openai/gpt-image, replicate, zai, openrouter, azure, volcano, doubao — keeps today's aspect-only request bytes (R2). Providers unable to honour a declared canvas are covered by the honest-measurement path (R3), not by guessed request reshaping.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Per-candidate exact gate using that candidate's own model: `plugins/generations/image-gen/src/index.ts:406` (model = primary `spec.model` only at the primary; candidates get their own `defaultModel()`), `plugins/generations/image-gen/src/index.ts:411-414` (`exact = format.width !== undefined && format.height !== undefined && provider.exactSize?.(model, format.width, format.height) === true`), `plugins/generations/image-gen/src/index.ts:418` (exact ⇒ request carries `width`/`height` with `aspectRatio` omitted — the two are mutually exclusive). Capability seam: `plugins/generations/image-gen/src/providers/types.ts:71-77` (optional `exactSize?(model, width, height)`, doc comment: absent = aspect-only). Executed evidence: `plugins/generations/image-gen/tests/fallback.test.ts:333-351` (primary exact 1344x576 with `aspectRatio` undefined auth-fails → the aspect-only fallback candidate is asked on its own `google-default-model`, and the artifact records `sizeRequest: 'aspect'`); `plugins/generations/image-gen/tests/image-gen.test.ts:502-524` (pipeline level: request width 1080 / height 1440, `aspectRatio` undefined). |
| R2 | MET | Non-exact request shape unchanged: `plugins/generations/image-gen/src/index.ts:418` spreads `{ aspectRatio: format.aspectRatio }` exactly as pre-0182 when `exact` is false. MiniMax body sets `aspect_ratio` when present and `width`/`height` only in the else-if branch (`plugins/generations/image-gen/src/providers/minimax.ts:95-98`); `validatePixelSize` fires only when width+height are present AND `aspectRatio` is undefined (`plugins/generations/image-gen/src/providers/minimax.ts:77`, call at `plugins/generations/image-gen/src/providers/minimax.ts:83`) — unreachable on the aspect-only path, so there is no new validation failure for any existing preset × provider pair. Only MiniMax implements `exactSize` (grep over `src/` this run: declaration `plugins/generations/image-gen/src/providers/types.ts:77`, implementation `plugins/generations/image-gen/src/providers/minimax.ts:155-156`, gate site `plugins/generations/image-gen/src/index.ts:414` — no other adapter). Executed evidence: `plugins/generations/image-gen/tests/providers/minimax.test.ts:106-117` (non-image-01 body carries `aspect_ratio: '3:4'` with no `width`/`height` keys), `plugins/generations/image-gen/tests/image-gen.test.ts:493-501` (aspect-only stub on xhs-card: request `aspectRatio '3:4'`, width/height undefined, artifact `sizeRequest: 'aspect'`); existing provider/fallback suites green unchanged in this run's spot pass. |
| R3 | MET | Delivery measured once from the raw provider bytes: `plugins/generations/image-gen/src/index.ts:460` (`imageDimensions(result.bytes)`); unparseable ⇒ one WARN and dimensions omitted (`plugins/generations/image-gen/src/index.ts:462-464`); mismatch ⇒ `WARN image-gen: <provider>/<model> delivered <W>x<H>; format '<name>' declares <W>x<H>` (`plugins/generations/image-gen/src/index.ts:466-468`); warn-only — the run never fails after spend. Parsers are header-only and all null-contract: `plugins/generations/image-gen/src/bytes.ts:29-33` (dispatch), PNG IHDR `plugins/generations/image-gen/src/bytes.ts:45-53`, JPEG SOFn walk `plugins/generations/image-gen/src/bytes.ts:61-83`, WebP VP8/VP8L/VP8X `plugins/generations/image-gen/src/bytes.ts:85-131`. `sizeRequest: 'exact' | 'aspect'` is recorded on every written artifact (`plugins/generations/image-gen/src/job.ts:79-84`, `plugins/generations/image-gen/src/index.ts:575`).
| R4 | MET | `plugins/generations/image-gen/src/providers/minimax.ts:53-55` (`isAcceptablePixelSize`: 512..2048 both edges, divisible by 8) and `plugins/generations/image-gen/src/providers/minimax.ts:155-156` (`exactSize: model === 'image-01' && isAcceptablePixelSize(w, h)`); the throwing `validatePixelSize` was refactored onto the same predicate with both frozen messages preserved (`plugins/generations/image-gen/src/providers/minimax.ts:58-68`). Every other adapter keeps the default (no `exactSize` anywhere else in `src/` — verified by grep this run), so behaviour is unchanged. Executed evidence: `plugins/generations/image-gen/tests/providers/minimax.test.ts:70-85` (1080x1440, 1344x576, 1024x1024, 1152x864, 512x2048 ⇒ true; 504, 2049, 1082 ⇒ false; `image-01-live` ⇒ false); pipeline model gate `plugins/generations/image-gen/tests/image-gen.test.ts:538-557` (image-01-live stays aspect-only — the D6 model-isolation invariant). |
| R5 | MET | `plugins/generations/image-gen/presets/formats/xhs-card.yaml:10-11` declares `width: 1080 / height: 1440`. POST-body pin `plugins/generations/image-gen/tests/providers/minimax.test.ts:89-104`: the request body carries `width: 1080`, `height: 1440` and `not.toHaveProperty('aspect_ratio')` on MiniMax `image-01`. Pipeline pin `plugins/generations/image-gen/tests/image-gen.test.ts:502-524`: the request carries 1080x1440 with `aspectRatio` undefined; a stubbed 864x1152 delivery is recorded as `illustration { width: 864, height: 1152 }` with `sizeRequest: 'exact'` and the mismatch WARN pinned character-for-character (`WARN image-gen: minimax/image-01 delivered 864x1152; format 'xhs-card' declares 1080x1440`); the real regression delivery 864x1152 is also a named PNG fixture in `plugins/generations/image-gen/tests/bytes.test.ts:88`. All green in this run's spot pass (0 fail). |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC-1 | MET | test | AC1 — A declared preset canvas reaches the provider (req: R1, R4). Gate `plugins/generations/image-gen/src/index.ts:411-418` forwards the declared width/height with `aspectRatio` omitted only when `provider.exactSize?.(model, w, h) === true`; only MiniMax reports the capability, only for `image-01` within 512..2048 %8 (`plugins/generations/image-gen/src/providers/minimax.ts:155-156`). Executed this run (`bun test` in plugins/generations/image-gen, 428 pass / 0 fail): `plugins/generations/image-gen/tests/providers/minimax.test.ts:89-104` (POST body width/height, no aspect_ratio), `plugins/generations/image-gen/tests/image-gen.test.ts:502-524` (1080x1440 request pins), `plugins/generations/image-gen/tests/fallback.test.ts:333-351` (per-candidate gate across fallback). |
| AC-2 | MET | test | AC2 — A provider that cannot honour the canvas is honest about it (req: R2, R3). Aspect-only request byte-identical to pre-0182 (`plugins/generations/image-gen/src/index.ts:418`; `plugins/generations/image-gen/src/providers/minimax.ts:93-98`; pixel validation unreachable on the aspect path — `plugins/generations/image-gen/src/providers/minimax.ts:77,83`); every delivery measured (`plugins/generations/image-gen/src/index.ts:460`) and recorded (`plugins/generations/image-gen/src/job.ts:79-84`, `plugins/generations/image-gen/src/index.ts:575`), with mismatch/unparseable WARNs that never fail the run (`plugins/generations/image-gen/src/index.ts:462-469`). Executed this run: `plugins/generations/image-gen/tests/providers/minimax.test.ts:106-117` and `plugins/generations/image-gen/tests/image-gen.test.ts:493-501` (aspect-only), `plugins/generations/image-gen/tests/image-gen.test.ts:526-536` (junk ⇒ dims omitted, exactly one WARN, run succeeds), 13 parser fixtures in `plugins/generations/image-gen/tests/bytes.test.ts`. |
| AC-3 | MET | test | AC3 — The measured regression stays fixed (req: R5). `plugins/generations/image-gen/tests/providers/minimax.test.ts:89-104` pins the wire body `width: 1080, height: 1440` with no `aspect_ratio` for xhs-card on MiniMax `image-01`; `plugins/generations/image-gen/tests/image-gen.test.ts:502-524` pins an 864x1152 stub delivery recorded as `illustration {864,1152}` with `sizeRequest: 'exact'` plus the exact mismatch WARN text; the suite is green (0 fail) this run. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

**Reviewed 2026-10-02 (run 4ba3733e, three-dimensional review: functional traceability + SECUA + architecture). Verdict: PASS.**

- **Traceability (R1–R5, AC1–AC3): all PASS.** R1: per-candidate exact gate with the candidate's own model — `src/index.ts:406,411-418`; capability seam `src/providers/types.ts:71-78`; pinned by `tests/fallback.test.ts:333-351` (primary exact 1344x576 aspect-free → candidate aspect-only on `google-default-model`, `sizeRequest 'aspect'`). R2: non-exact request byte-identical — `index.ts:418`, `minimax.ts:87-112` (width/height only when aspect_ratio absent; pixel validation unreachable on the aspect path); only MiniMax implements `exactSize`. R3: delivery measured once (`index.ts:458`), mismatch WARN verbatim (`index.ts:466-468`), unparseable ⇒ one WARN + dims omitted (`index.ts:460-463`), warn-only; `sizeRequest` unconditional (`index.ts:575`, `job.ts:80-88`); PNG/JPEG/WebP readers `src/bytes.ts:29-131` all null-contract; 13 parser fixtures + junk-delivery one-WARN test. R4: `minimax.ts:53-56,155-156` (image-01, 512..2048, %8), frozen messages preserved through the predicate refactor; boundary units pinned. R5: POST body `width:1080,height:1440` no `aspect_ratio` (`tests/providers/minimax.test.ts:97-109`); 864x1152 delivery recorded + exact WARN text pinned in `tests/image-gen.test.ts`.
- **SECUA: no findings.** Header-only parse of untrusted bytes, no decode; both parser loops provably terminate on hostile input (JPEG length ≥ 2 guard; WebP ≥ 8-byte chunk stride); no `any`, no new dependency, no secret/fetch-surface changes; WARN strings carry only registry/preset identifiers.
- **Architecture: conforms.** Matches all closed Q&A decisions (opt-in capability, aspectRatio omitted on exact path with adapter body unchanged, warn-never-fail, zero deps); D6 model isolation preserved and pinned; 0180/0182 boundary respected; docs/04_DESIGN.md in the same change (T3); throw→null contract migration of the 0180 reader tests is transparent and compose still fails loud on an unparseable card (`index.ts:535-539`).
- **Findings:**

| Priority | Finding | Disposition |
|----------|---------|-------------|
| P3 | MiniMax image-01 size rule (512..2048, %8) not re-verifiable against official docs this run (platform.minimaxi.com SPA blocks anonymous fetch); predicate frozen by pre-existing pinned tests (`plugins/generations/image-gen/tests/providers/minimax.test.ts:70-117`) | Residual — close the citation when network allows (named in Evidence gap) |
| P4 | `sizeRequest` typed optional though always written | No action — optionality correct for pre-0182 content.json readers |
| P4 | Compose-path parent width/height are card dims while `sizeRequest` describes the raw request | No action — raw delivery on `illustration.width/height`, documented in docs/04_DESIGN.md |
| P4 | Exotic JPEG streams degrade to `null` → honest WARN | No action |
- **Verification:** spot evidence this run — `bun test` in plugins/generations/image-gen: 428 pass / 0 fail / 2 pre-existing env-gated skips. Repo gate PASS (attempts=1) not re-run per stage instructions.
- **Disposition: PASS — approve as implemented.**

### References

- Feature: `docs/features/F618_image-gen-preset-canvas-declared-width-height-never-reach-the-provider.md`
- Origin: task 0179 Review, P3 (filed as F617 and renumbered to F618)
- Code: `plugins/generations/image-gen/src/index.ts:311-381`, `src/providers/minimax.ts:53-94`,
  `src/providers/types.ts:28-44`, `src/job.ts:67-82`, `src/bytes.ts`
- Related: 0180 (the composer owns the final 1080x1440 card canvas; this task owns the raw provider artifact)
- Ordering: land **before** 0180. Both edit `src/index.ts` around the request/artifact block.

### History

- 2026-09-30T05:52:45.971Z backlog → todo (system)
- 2026-10-02T10:18:53.452Z todo → wip (system)
- 2026-10-02T10:47:22.685Z wip → testing (system)

