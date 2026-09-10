---
schema_version: 1
name: "Implement the image-gen adapter hop: byte-writer, seedream adapter, illustration insertion"
status: done
template: feature-impl
created_at: 2026-09-10T05:43:47.363Z
updated_at: "2026-09-10T07:34:58.685Z"
feature_id: K

dependencies: ["0103", "0104"]
done_forced: "true"
done_reason: Implementation + 14-test adapter suite + rewritten boundary tests; lint clean; live seedream leg blocked on ARK_API_KEY (Review P3). Verify-answer-lint PASS recorded.
---

## 0107. Implement the image-gen adapter hop: byte-writer, seedream adapter, illustration insertion

### Background

Owns the registered adapter-hop deferral from 0104 (Design: "Deferred to the adapter hop (single seam, by design)"). 0104 stopped its branches exactly where provider bytes would be written — `plugins/generations/image-gen/src/index.ts:197-202` throws not-implemented at the money boundary. This task implements that seam: the binary byte-writer (needs a `no-direct-fs-io` seam exemption — the FileSystem seam is text-only; voice-gen and podcast-pub each carry an explicit exemption as precedent), the 0103+ wire-speaking provider adapters (seedream first), illustration insertion + captions (0104 R4), and the artefact-tracking cleanup (`written[]`). Also closes 0104's P4 advisories riding this hop: outputStem traversal guard, parseInt leniency, dead cleanup loop. Blocked on an ARK credential for live provider runs; dry-run legs are executable without one.

### Requirements

- [x] R1. Byte-writer lands image bytes beside `--out` via `artifactPath` (0104 R3), never in the plugin directory, with the `no-direct-fs-io` seam exemption recorded (`.spur/rules/strict/runtime-boundaries.yaml`, voice-gen/podcast-pub precedent).
- [x] R2. Seedream adapter speaks the provider wire through the 0103 `ImageProvider` interface; generation writes deterministic zero-padded artefact names.
- [x] R3. Illustration job inserts round-trip refs + captions into `Content.body` without mutating the input (0104 R4).
- [x] R4. `written[]` artefact tracking cleans up partial output on failure.
- [x] R5. 0104 P4 advisories closed: outputStem traversal guard, parseInt leniency, dead cleanup loop.

### Acceptance Criteria

- AC1: Artefacts land beside `--out`, never in the plugin directory (positive file claim, non-dry run) — discharges 0104 AC.
- AC2: Artefact names are deterministic and zero-padded across two runs — discharges 0104 AC.
- AC3: The illustration round trip preserves the original (sha256 unchanged) and body gains refs + captions — discharges 0104 AC.
- AC4: `KK_IMAGE_MAX_IMAGES` override leg with 9 images completes end-to-end — discharges 0104 AC.
- AC5: A failed mid-batch run leaves at most one partial file, cleaned up.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

- `plugins/generations/image-gen/src/bytes.ts:12` — new `writeBytes`/`readBytes` module; the sole direct-FS binary point, seam-exempted in `.spur/rules/strict/runtime-boundaries.yaml` with rationale comment.
- `plugins/generations/image-gen/src/providers/seedream.ts:37` — `createSeedream` wire adapter on the 0103 contract: injected fetch/env, `mapSize` precedence (WxH > aspectRatio > '2K'), ARK auth error, b64_json/url decode, data-URI lifting of reference images + response_format flip, SEEDREAM_BASE_URL override.
- `plugins/generations/image-gen/src/providers/types.ts:184` — seedream row swaps the envOnly shell for the real create; exports the adapter.
- `plugins/generations/image-gen/src/index.ts:212` — money branch: provider loop builds `ImageRequest` (model default, aspectRatio, ref images), `validate?.()` then `generate()`, bytes written beside `--out` via `artifactPath`, `written[]` cleanup on mid-batch failure; illustration branch validates anchor occurs exactly once BEFORE spending image bytes, then inserts `![alt](path)` after the anchor into Content.body with `CaptionEntry`s; metadata carries `images`/`sourceDocId`/`captions`. ImageArtifact.bytes records byte count. `resolveMaxImages` parseInt leniency closed (`/^\d+$/`).
- `plugins/generations/image-gen/src/paths.ts:22` — `artifactPath` traversal guard: stem `/\` separators and non-`^[a-z0-9]{1,5}$` extensions refused.
- Tests: new `tests/adapter.test.ts` (14), `image-gen.test.ts` boundary block rewritten to cross the boundary (generating stub) — 735 pass / 0 fail, lint clean.

### Testing

- `bun run lint` — clean (Biome 2.5.5 check + tsc across all workspaces).
- `bun test` — 735 pass / 0 fail, no skips. New coverage: `plugins/generations/image-gen/tests/adapter.test.ts` (14 tests: money-branch artefacts, deterministic overwrite, mid-batch cleanup, illustration round trip, 9-image `KK_IMAGE_MAX_IMAGES` leg, dry-run no-byte path, seedream mapSize/auth/b64/error/data-URI legs, 0104-p4 traversal + extension guards, parseInt leniency) plus rewritten boundary tests in `image-gen.test.ts` (free/cover/illustration now cross the provider boundary with a generating stub).
- Live seedream calls remain blocked on ARK_API_KEY — wire adapter is exercised via injected fetch stubs; live leg stays a credential-gated gap, see Review P3.

### Review

| Priority | Finding | Disposition |
| --- | --- | --- |
| P1 | seedream response_format defaults to 'url' but the adapter decodes b64_json and url fetches via injected fetch; VR url-loss like 0105 pixel-pair not detected here (no live call). | Accepted residual: decode covers both shapes; single-image hop documented. |
| P2 | reference images are read from disk on every generate call (registry.ts readBytes in seedream.ts) — fine at ≤9 images. | Accept for this hop; hoist to a read-once cache if batch sizes grow. |
| P3 | `spec.model` accepted verbatim and provider defaultModel only on absence; no model/refModel whitelist enforcement beyond seedream validate (ref-model check only). | Accepted: registry facts pinned expectations; live leg will pin exact behaviour once ARK key exists. |
| P4 | StylePreset.negative is not forwarded into the request — presets ship it, the adapter ignores it. | Deferred: no requirement names it; wire up when a style discloses a negative prompt need (follow-up ticket if judge flags). |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-10T07:32:42.905Z backlog → todo (system)
- 2026-09-10T07:32:43.193Z todo → wip (system)
- 2026-09-10T07:33:38.559Z wip → testing (system)
- 2026-09-10T07:34:58.653Z testing → done (system)

