---
schema_version: 1
name: "podcast-pub: reject non-Apple-compatible audio MIME before any network call"
status: done
template: feature-impl
created_at: 2026-09-25T23:01:10.927Z
updated_at: "2026-09-27T05:01:08.355Z"
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

- [x] R1. `mapContentToEpisode` throws when the resolved audio MIME type (after any `metadata.mimeType` override) is outside the Apple-accepted set: audio/mpeg, audio/x-m4a, audio/mp4, video/mp4, video/quicktime, video/x-m4v.
- [x] R2. The error names the offending MIME type and the accepted set; `publish` surfaces it as `Invalid Content: …` (existing wrapper, `src/index.ts:291`).
- [x] R3. Publish and Content-mapped validate fail before any microfeed request, presign, or upload.
- [x] R4. `.m4a` resolves to audio/x-m4a.
- [x] R5. `docs/04_DESIGN.md` podcast-pub surface (§ `@gobing-ai/podcast-pub`, line ~615) and `docs/design/podcast-pub.md` list the new error in the same commit (T3).

Out of scope: transcoding or probing audio in the plugin; guarding `update`/`validate` calls that pass a raw `options.item` (caller-owned passthrough); `AUDIO_MIME_BY_EXTENSION` entries other than `.m4a`.

### Acceptance Criteria

- [x] AC1 — podcast-pub refuses non-Apple-compatible audio before any network call (req: R1, R2, R3, R4)

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

| Concern | Where |
| ------- | ----- |
| `APPLE_AUDIO_MIME` allowlist (`audio/mpeg`, `audio/x-m4a`, `audio/mp4`, `video/mp4`, `video/quicktime`, `video/x-m4v`) (R1) | `plugins/publishings/podcast-pub/src/map.ts:56-62` |
| `.m4a` → `audio/x-m4a` in `AUDIO_MIME_BY_EXTENSION` (R4) | `plugins/publishings/podcast-pub/src/map.ts:43` |
| Resolved-MIME guard inside `mapContentToEpisode`, after any `metadata.mimeType` override (R1) | `plugins/publishings/podcast-pub/src/map.ts:170-175` |
| Error text `unsupported audio MIME type "<type>" for Apple Podcasts: expected one of <list>` (R2) | `plugins/publishings/podcast-pub/src/map.ts:173` |
| Audio branch reuses the one resolved MIME (file and url) | `plugins/publishings/podcast-pub/src/map.ts:187-188` |
| `publish` maps pre-network → surfaces `Invalid Content: …` (R2/R3; call site unchanged, now covered by the guard) | `plugins/publishings/podcast-pub/src/index.ts:290` |
| Content-mapped `validate` maps pre-network (R3; call site unchanged) | `plugins/publishings/podcast-pub/src/index.ts:483` |
| Test: `.wav` reference rejected, message names the offending type and the accepted set (R1/R2) | `plugins/publishings/podcast-pub/tests/podcast-pub.test.ts:205` |
| Test: `metadata.mimeType: audio/wav` override cannot bypass the guard (R1) | `plugins/publishings/podcast-pub/tests/podcast-pub.test.ts:218` |
| Test: publish with a `.wav` audioFile makes zero microfeed requests (`api.requests.length === 0`) (R3) | `plugins/publishings/podcast-pub/tests/podcast-pub.test.ts:419-436` |
| Test: Content-mapped `validate` with a `.wav` audioUrl makes zero requests (R3) | `plugins/publishings/podcast-pub/tests/podcast-pub.test.ts:724` |
| Test: `.m4a` resolves to `audio/x-m4a` (R4) | `plugins/publishings/podcast-pub/tests/podcast-pub.test.ts:256` |
| Fixtures: `makeAudioFile` default → `episode.mp3`; the former wav-acceptance fixture at the old `:202` now maps mp3 (its wav case became the rejection test above) | `plugins/publishings/podcast-pub/tests/podcast-pub.test.ts:85,197` |
| Fixtures: WAV publish assertions switched to `audio/mpeg` (ITEM01 presign + attachment, ITEM02 presign, ASM01 attachment) | `plugins/publishings/podcast-pub/tests/podcast-pub.test.ts:387,406,460,1359` |
| Fixtures: cover-image tests pinned to `.mp3` audio so they isolate cover validation | `plugins/publishings/podcast-pub/tests/podcast-pub.test.ts:1490,1511` |
| Doc: `mapContentToEpisode` row lists the new error + Apple allowlist (R5) | `docs/04_DESIGN.md:622` |
| Doc: §4.2 Apple Podcasts audio MIME guard — error text, allowlist, `.m4a` change, out-of-scope (R5) | `docs/design/podcast-pub.md:125-142` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Re-verified 2026-09-27 at HEAD 2fb560e1: guard at plugins/publishings/podcast-pub/src/map.ts:171-175 tests the single resolved MIME against APPLE_AUDIO_MIME (map.ts:56-63 = exactly the six Apple types audio/mpeg, audio/x-m4a, audio/mp4, video/mp4, video/quicktime, video/x-m4v); resolveAudioMimeType prefers a metadata.mimeType override so an override cannot bypass. Fresh run: bun test plugins/publishings/podcast-pub/ → 55 pass / 0 fail (includes .wav refused, override audio/wav refused, .m4a mapping). |
| R2 | MET | Fail-loud text at map.ts:173 names the offending type and the full accepted set; publish wrapper src/index.ts:290-292 returns 'Invalid Content: <message>'. |
| R3 | MET | Ordering re-verified in src/index.ts: publish maps at :290 before createItem :300 and before prepareUpload/uploadBytes :339/:346; validate maps at :483 before validateItem :490. Zero-network proof tests remain in the suite (55 pass this run). |
| R4 | MET | map.ts:43 '.m4a': 'audio/x-m4a' (rg, this run); extension lowercased before lookup. |
| R5 | MET | docs/design/podcast-pub.md:134 §4.2 names the accepted allowlist (audio/mpeg, audio/x-m4a, audio/mp4, video/mp4, …); bun run lint exit 0 (Biome 2.5.5 + all workspace typechecks) this run. |
| R2 — podcast-pub refuses non-Apple-compatible audio before any network call | MET | Re-projected from this verdict's task R1-R3 rows (2026-09-27 re-verify, unchanged): guard map.ts:171-175 with the six-type APPLE_AUDIO_MIME allowlist, fail-loud message naming type + set (:173), mapping ordered before createItem/presign/upload (index.ts:290/:300/:339/:346) so a rejected MIME reaches no network call; 55/55 plugin tests pass this run. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | bun test plugins/publishings/podcast-pub/ → 55 pass / 0 fail, 217 expect() calls (2026-09-27). Cross-check: bun run lint exit 0. Guard, message, ordering, and .m4a mapping all re-confirmed against the current tree (HEAD 2fb560e1). |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Reviewed the working-tree diff vs base `e8b07e70` — `plugins/publishings/podcast-pub/src/map.ts`, `tests/podcast-pub.test.ts`, `docs/04_DESIGN.md`, `docs/design/podcast-pub.md` — across functional traceability, SECUA, and architectural depth. Fresh evidence this run: plugin test file **55 pass / 0 fail** (217 `expect()` calls, run from repo root); `bun run lint` (Biome 2.5.5 + all workspace typechecks) exit 0; ad-hoc `mapContentToEpisode` probe of the accept/reject matrix below. Note: the same test file run with cwd inside the plugin dir fails 1 test because the plugin-discovery test hardcodes `join(process.cwd(), 'plugins')` (`tests/podcast-pub.test.ts:1008`) — pre-existing cwd coupling, not this change.

**Functional traceability**

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `src/map.ts:56-63` `APPLE_AUDIO_MIME` = exactly the six Apple types; guard on the resolved MIME at `src/map.ts:170-175`, after the `metadata.mimeType` override (`resolveAudioMimeType` `src/map.ts:71-78`, resolved once at `:170`). Tests `tests/podcast-pub.test.ts:205` (`.wav` refused; message names the type and the full set), `:218` (override `audio/wav` refused). |
| R2 | MET | Frozen text `src/map.ts:172-174`; `publish` wraps it as `Invalid Content: …` at `src/index.ts:288-292`; `tests/podcast-pub.test.ts:419-436` asserts both substrings. |
| R3 | MET | `publish` maps at `src/index.ts:290`, before `createItem` (`:296`/`:329`) and before `readFile` + `prepareUpload` (`:341-347`); Content-mapped `validate` maps at `src/index.ts:483`, before `client.validateItem` (`:490`). Nothing I/O-bound precedes either — `resolveClient` (`:56-76`) reads env only and `MicrofeedClient`'s constructor does no fetch. Zero-request assertions at `tests/podcast-pub.test.ts:431` and `:735`. |
| R4 | MET | `src/map.ts:43` `.m4a` → `audio/x-m4a`; `tests/podcast-pub.test.ts:256`; probe confirms uppercase `.M4A` too (extension lowercased `src/map.ts:75`). |
| R5 | MET | `docs/04_DESIGN.md:622` (error + allowlist on the `mapContentToEpisode` row) and `docs/design/podcast-pub.md:125-142` (§4.2) changed in the same tree as the code (T3). |

AC1 — podcast-pub refuses non-Apple-compatible audio before any network call (req: R1, R2, R3, R4): **MET** (R1–R4 MET; the `api.requests.length === 0` assertions are the "before any network call" proof for both publish and Content-mapped validate).

**Findings**

| P | Dimension | Location | Finding | Disposition |
| --- | --- | --- | --- | --- |
| P3 (minor) | Functional traceability | `src/index.ts:449-455` | `update` with a raw `options.item` still forwards `attachments[].mime_type` unchecked (e.g. `audio/wav`); `mapContentToEpisode` is not on that path, so the guard cannot refuse it. E61's parent scenario names "publish **or update**" (`docs/features/E61_apple-podcasts-compliance-for-the-microfeed-podcast-feed.md:54-58`). | Accepted as scoped: 0170 R3 names publish + Content-mapped validate only; the refinement Q&A (2026-09-25T23:10:24) closed raw-`item` `update`/`validate` as caller-owned passthrough and `docs/design/podcast-pub.md:140-142` records it. No 0170 code change; E61 closure should record the narrowing (or raise a guarded `update` as new work). |
| P4 (advisory) | Correctness | `src/map.ts:170-175`, `src/index.ts:249-263` | The guard validates the *declared* MIME, not the file: `.wav` + `metadata.mimeType: 'audio/mpeg'` passes and publishes WAV bytes labelled `audio/mpeg` (probe-verified), and the assembly merge preserves an upstream `metadata.mimeType` while swapping in `options.audioFile`. No in-repo producer sets `Content.metadata.mimeType` (`rg` clean) and probing audio is the stated design anti-pattern (`src/map.ts:66-69`). | Accepted by design (R1 defines the guard on the resolved MIME). Carry into 0171: assert the `.mp3` sibling by path and do not emit `metadata.mimeType`. |
| P4 (advisory) | Usability | `src/map.ts:172-174` | The allowlist is exact-match: `Audio/MPEG` and `audio/mpeg; codecs=mp3` are refused (probe-verified). | Accepted — fail-loud, and the message names the offending string; no in-repo producer emits case/parameter variants. |
| P4 (advisory) | Usability (behaviour change) | `src/map.ts:77`, `:170-175` | A hosted `audioUrl` whose last dot segment is not a known extension (`…/ep.mp3?token=…`, extension-less CDN URL) resolves to `application/octet-stream` and is now refused; before this change it published an octet-stream enclosure — the same Apple-FATAL class the task fixes, so the refusal is an improvement, but it is caller-visible and unstated in §4.2. | Accepted; optionally one line in `docs/design/podcast-pub.md` §4.2 naming query-string/extension-less URLs as requiring `metadata.mimeType`. |
| P4 (advisory) | Architecture / maintenance | `src/map.ts:40-49` | `.wav`, `.aac`, `.ogg`, `.oga`, `.flac`, `.opus` now resolve to types the guard always refuses; the entries' remaining value is diagnostic (`audio/flac` named rather than `application/octet-stream`). | Accepted — matches the stated invariant at `src/map.ts:168-169` ("the table describes what a file is; the allowlist decides what is publishable"). |
| P4 (advisory) | Test coverage | `src/index.ts:249-263`, `tests/podcast-pub.test.ts:205,419` | The guard is covered directly and through `publish` / Content-validate, but no test drives the assembly channel (`options.audioFile`) — the route the daily workflow uses and 0171 depends on (the merge writes `metadata.audioFile`, then the mapper guards). | Advisory: one negative assertion for `options.audioFile: '…wav'` would lock 0171's backstop claim; not required for AC1. |
| P4 (advisory) | Process / scope | `git diff e8b07e70` → `plugins/sp/scripts/inline-run-setup.ts` | The base-vs-HEAD delta also carries commit `5b438a48` (vendored harness; the test gate's root-cause fix), outside 0170's declared 4-file change set; and the task's `Testing` section is still the unfilled placeholder although `.spur/run/0170-test-gate.log` records 1413 pass / 0 fail. | `5b438a48` is already its own `fix(sp):` commit — keep it out of the 0170 product commit; verify/record stages should stamp the Testing evidence. |

No P1 (blocker) and no P2 (major) findings.

**SECUA.** Security: the guard narrows an agent-steerable field (`metadata.mimeType`) from "any string" to the six Apple types, so a hostile or erroneous value can no longer reach microfeed as an enclosure type; it is a feed-validity gate, not an auth boundary, and nothing new reaches a shell or a network call before validation (the error text is caller metadata interpolated into a JSON `Result`/stderr — no injection surface; the show-notes HTML path is untouched). Efficiency: the MIME is now resolved once instead of twice (`:170` reused at `:187-188`) and the allowlist join runs only on the throw path — no added I/O on the happy path. Correctness: set membership on the resolved value, exactly the requirement's six types and their order in the message, evaluated after the ambiguity/duration/status/coverImage/itunes pre-checks and before the return, so it fails fast and before `renderShowNotesHtml`. Usability: the message names the offending type and the full accepted set, surfaced as `Invalid Content: …` by `publish` and as an error `Result` by `validate`. Architecture: one guard at the single Content→episode seam, module-private constant co-located with the extension table — no per-operation duplication, no new options/flags, no transcoding, exactly the frozen design (D1) and its invariants.

**Architecture depth.** The policy/question split is clean: `resolveAudioMimeType` answers "what is this file" and stays permissive; `APPLE_AUDIO_MIME` plus the mapper answer "what may be published". Callers reach the guard through one deep seam rather than three shallow per-operation checks, and `update`'s deliberate exclusion is documented rather than duplicated — no responsibility leak across operations.

**Residual risk.** (1) Declared-not-actual MIME: a caller asserting `audio/mpeg` for a WAV still publishes a WAV enclosure; 0171 must not emit `metadata.mimeType`. (2) Raw-`item` `update`/`validate` remain unguarded — the only remaining route by which non-Apple audio can reach microfeed, now caller-owned and operator-driven. (3) Strictness increase for hosted URLs without a resolvable extension/with query strings — no in-repo caller affected today. (4) Coverage: `map.ts` reports 100 % lines in the gate log and the new error branch is covered directly (`tests:205,218`) and at integration level (`:419-436`, `:721-739`).

**Disposition: PASS.** R1–R5 and AC1 are MET with `file:line` and executable evidence; the sole P3 is the task's own closed scope decision (raw-`item` update) and does not affect AC1, and the P4s are advisory records, not remediation. No fix stage required for 0170; carry the declared-vs-actual note and the optional `options.audioFile` negative test into 0171, and record the E61 R2 `update`-arm narrowing at E61 closure.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-26T00:39:14.563Z todo → wip (system)
- 2026-09-26T02:48:14.441Z wip → testing (system)
- 2026-09-26T02:49:06.000Z testing → done (system)

