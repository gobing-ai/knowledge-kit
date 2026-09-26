---
schema_version: 1
name: "podcast-pub: reject non-Apple-compatible audio MIME before any network call"
status: todo
template: feature-impl
created_at: 2026-09-25T23:01:10.927Z
updated_at: "2026-09-25T23:10:39.787Z"
feature_id: E61
priority: P0
tags:
  - podcast-pub
  - apple-podcasts
estimate_hours: 2

---

## 0170. podcast-pub: reject non-Apple-compatible audio MIME before any network call

### Background

Implements: R2 — podcast-pub refuses non-Apple-compatible audio before any network call.

The live 2026-09-24 episode shipped as audio/wav (castfeedvalidator FATAL: invalid content type). `resolveAudioMimeType` in `plugins/publishings/podcast-pub/src/map.ts` maps `.wav → audio/wav` and nothing downstream refuses it, so microfeed stores and serves an enclosure Apple Podcasts cannot ingest.

**Refine corrections (2026-09-25)**

- "wav is only mapped, nothing else depends on it" → existing tests assert the WAV path: `plugins/publishings/podcast-pub/tests/podcast-pub.test.ts:202` (mapContentToEpisode → audio/wav), `:232` (`.m4a` → audio/mp4), and WAV publish fixtures at `:363`, `:382`, `:417`, `:1316` → Plan now updates these (fixtures switch to `.mp3`/audio/mpeg; `:202` becomes a rejection test).
- "publish and validate route through the guard" → true for `publish` (`src/index.ts:290`) and Content-mapped `validate` (`src/index.ts:483`); `validate`/`update` with an explicit `options.item` bypass `mapContentToEpisode` by design → recorded as out-of-scope, unchanged.

### Requirements

- [ ] R1. `mapContentToEpisode` throws when the resolved audio MIME type (after any `metadata.mimeType` override) is outside the Apple-accepted set: audio/mpeg, audio/x-m4a, audio/mp4, video/mp4, video/quicktime, video/x-m4v.
- [ ] R2. The error names the offending MIME type and the accepted set; `publish` surfaces it as `Invalid Content: …` (existing wrapper, `src/index.ts:291`).
- [ ] R3. Publish and Content-mapped validate fail before any microfeed request, presign, or upload.
- [ ] R4. `.m4a` resolves to audio/x-m4a.
- [ ] R5. `docs/04_DESIGN.md` podcast-pub surface (§ `@gobing-ai/podcast-pub`, line ~615) and `docs/design/podcast-pub.md` list the new error in the same commit (T3).

Out of scope: transcoding or probing audio in the plugin; guarding `update`/`validate` calls that pass a raw `options.item` (caller-owned passthrough); `AUDIO_MIME_BY_EXTENSION` entries other than `.m4a`.

### Acceptance Criteria

- [ ] AC1 — podcast-pub refuses non-Apple-compatible audio before any network call (req: R1, R2, R3, R4)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-25T23:03:57.184Z

- Q: Should `update` (raw `options.item`) also be guarded? A: No — caller-owned passthrough; the guard lives in `mapContentToEpisode`, which every publish/validate path uses (design D1).
- Q: Is `.m4a → audio/x-m4a` a breaking change? A: No known consumer publishes m4a today; both are in the accepted set.

#### Q&A entry — 2026-09-25T23:10:24.183Z

- Q: Validate/update with an explicit `options.item` — guard them? A: No (closed): caller-owned passthrough, out of scope.

### Design

Chosen: one guard inside `mapContentToEpisode` (`plugins/publishings/podcast-pub/src/map.ts:73`) on the resolved MIME, after the `resolveAudioMimeType` calls at `:163`/`:167`, backed by a module constant `APPLE_AUDIO_MIME: ReadonlySet<string>` in `map.ts`. Every Content-mapped path (publish `src/index.ts:290`, validate `:483`) already calls it pre-network, so one check covers all callers and a `metadata.mimeType` override cannot bypass it.
Frozen names: `APPLE_AUDIO_MIME` (not exported unless a test needs it); error text `unsupported audio MIME type "<type>" for Apple Podcasts: expected one of <list>`.
Rejected: transcoding in the plugin (design anti-pattern, `map.ts:54`); a guard per operation (duplicated, easy to miss one).
Invariants: `AUDIO_MIME_BY_EXTENSION` still describes what a file is; the allowlist decides what is publishable. No new options/flags.
Handoff: 0171 relies on this guard as the backstop (a WAV that slips past publish-prep fails here); 0172 relies on it before republishing.

### Plan

1. `map.ts`: add `APPLE_AUDIO_MIME`; change `.m4a` → audio/x-m4a; throw after MIME resolution in `mapContentToEpisode` (R1, R2, R4).
2. Tests `podcast-pub.test.ts`: turn `:202` into "wav file rejected"; add "mimeType override audio/wav rejected" and "publish with wav makes zero fetch calls" (R3); update `:232` to audio/x-m4a; switch WAV publish fixtures (`:363`, `:382`, `:417`, `:1316`) to `.mp3`/audio/mpeg.
3. Docs: `docs/04_DESIGN.md` podcast-pub row + `docs/design/podcast-pub.md` error note (R5).
4. Verify: `bun run lint` + `bun run test`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
