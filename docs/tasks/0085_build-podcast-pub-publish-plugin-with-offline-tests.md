---
schema_version: 1
name: "Build podcast-pub publish plugin with offline tests"
status: done
template: feature-impl
created_at: 2026-09-02T19:04:38.667Z
updated_at: "2026-09-02T22:17:02.422Z"
feature_id: E6
priority: P1
tags: ["plugin", "publish", "microfeed"]
---

## 0085. Build podcast-pub publish plugin with offline tests

### Background

Feature E6 R3+R4+R5+R6+R7. New publish plugin `plugins/publishings/podcast-pub/` (kind publish, file-cli transport) that publishes podcast episodes to the deployed microfeed instance over `/api/v1/` with Bearer auth, plus thin management operations. Design satellite docs/design/podcast-pub.md is authoritative (D1–D8): two-phase publish (create draft item → presigned upload requires item_id → PUT bytes → update item with audio attachment + published), Idempotency-Key on create, management ops via options.operation (list/get/update/delete/validate), Content mapping via metadata (audioFile|audioUrl, durationSeconds, mimeType, status). API contract pinned to vendors/microfeed/src/shared/ApiSchemas.ts + src/server/api/handlers.ts. Secrets env-only (MICROFEED_BASE_URL, MICROFEED_API_KEY, optional MICROFEED_TIMEOUT_MS). qiita-pub is the structural reference; publish-harness FakeFileCliTransport for tests.

### Requirements

- [x] R1. (feature R3) Publishing Content that carries episode metadata + an audio reference uploads the audio via microfeed's prepare-upload flow and creates the feed item via `/api/v1/`, ending in a `Result` with `ok: true`, `target: "podcast-pub"`, and the published item URL.
- [x] R2. (feature R4) Management operations `list` / `get` / `update` / `delete` / `validate` on feed items work via the corresponding `/api/v1/` endpoints and report as `Result` JSON.
- [x] R3. (feature R5) The test suite verifies publish + management behavior entirely offline against `@gobing-ai/publish-harness` fakes — no network to a real microfeed instance.
- [x] R4. (feature R6) Any API auth/transport failure yields `Result { ok: false, error }`, a stderr log, and exit code 1.
- [x] R5. (feature R7) Content missing required episode metadata or the audio reference is rejected before any network call: `Result { ok: false }` with a validation error, exit 1.

**Non-goals (explicit out-of-scope):** WAV→MP3 or any transcode; kk-core schema changes; browser transport; webhook handling; cover-art upload (`image` category) beyond what the episode needs; live-instance testing (that is 0086).

### Acceptance Criteria

```gherkin
Scenario: R3 — podcast-pub publishes a podcast episode with audio to microfeed
  Given podcast-pub is configured with a valid MICROFEED_BASE_URL and MICROFEED_API_KEY
  When the plugin receives Content carrying episode metadata and an audio media reference
  Then it uploads the audio and creates the feed item via the microfeed /api/v1/ REST API
  And writes a Result JSON with ok true, target "podcast-pub", and the published item URL

Scenario: R4 — podcast-pub provides simple management operations over the REST API
  Given podcast-pub is configured with valid credentials
  When a list, get, update, or delete item operation is invoked
  Then the corresponding /api/v1/ item endpoint is called and the outcome is reported as a Result JSON

Scenario: R5 — podcast-pub passes offline contract tests without a live instance
  Given the publish-harness fake transport fixtures
  When the podcast-pub test suite runs
  Then publish and management behavior is verified with no network access to a real microfeed instance

Scenario: R6 — podcast-pub fails loudly with a diagnostic on API errors
  Given podcast-pub is configured with credentials
  When the microfeed API answers with an authentication or transport error
  Then the plugin writes a Result JSON with ok false and a diagnostic error, logs to stderr, and exits 1

Scenario: R7 — podcast-pub rejects invalid Content input before any network call
  Given Content missing required episode metadata or the audio media reference
  When the plugin is invoked
  Then it writes a Result JSON with ok false and a validation error and exits 1
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-02T21:03:55.208Z

- **content_html = body verbatim** — chosen: microfeed sanitizes server-side and episode show notes are generated content we control. Deferred: real md→HTML rendering, on the condition show notes need rich formatting.
- **No local re-validation of microfeed's schemas** — chosen: plugin validates only its own requirements (title, audio reference) and lets `POST /items/validate` / server 400s surface the rest (R6 path). Avoids pinning a drifting copy of `apiItemInputSchema`.
- **Management ops inside the plugin via `options.operation`** — chosen over a separate CLI surface (no new `kk` noun, ADR-011).

### Design

WHAT: new publish plugin `plugins/publishings/podcast-pub/` (kind `publish`, `file-cli` transport) publishing podcast episodes to a self-hosted microfeed instance over `/api/v1/` with Bearer auth, plus thin item management ops.

WHY: kk's publish suite covers text platforms only; D5/F5 produce audio with no programmatic target. Direct REST follows the qiita-pub precedent; `@microfeed/cli` was rejected (interactive browser-granted auth vs env-only secrets). Full rationale: `docs/design/podcast-pub.md` D1–D8 (authoritative — this section freezes its implementable surface).

WHERE: new dir `plugins/publishings/podcast-pub/` only; config surface `~/.config/kk/config.yaml` (documented, not edited by this task); no changes to `apps/cli`, `packages/kk-core`, or sibling plugins.

**Frozen names:**

- Package `@gobing-ai/podcast-pub`; `plugin.json` `{ name: "podcast-pub", kind: "publish", entry: "./src/index.ts" }`.
- Deps mirror qiita-pub: `@gobing-ai/kk-core: workspace:*`, `@gobing-ai/publish-harness: workspace:*`, `@gobing-ai/ts-runtime: catalog:`, `@gobing-ai/ts-utils: catalog:`; dev `@types/bun: 1.3.14`. No new third-party deps.
- Env: `MICROFEED_BASE_URL` (required), `MICROFEED_API_KEY` (required), `MICROFEED_TIMEOUT_MS` (optional, default `300000`).
- Endpoints (pinned to `vendors/microfeed/src/server/api/handlers.ts` + `src/shared/ApiSchemas.ts`):
  - `POST {base}/api/v1/items` — create; send `Idempotency-Key: <uuid per publish attempt>`; 201 → `{id}`.
  - `POST {base}/api/v1/media_files/presigned_urls` — `{category:"audio", full_local_file_path, item_id, size, type}` → `{presigned_url, media_url}`; **audio requires item_id → item is created first.**
  - `PUT <presigned_url>` — raw bytes, same-origin.
  - `PUT {base}/api/v1/items/{id}` — attach + publish. Management: `GET /api/v1/feed` (list), `GET|PUT|DELETE /api/v1/items/{id}`, `POST /api/v1/items/validate`.
- Content mapping (`src/map.ts`): `title` ← `content.title` else first `#` heading else validation error; `content_html` ← `content.body` verbatim (server sanitizes; md→HTML upgrade only when show notes need rich formatting); `status` ← `metadata.status` default `"published"`; attachment ← `{category:"audio", url, mime_type, size_in_bytes, duration_in_seconds}` from `metadata.audioFile` (local path → upload flow) or `metadata.audioUrl` (already hosted → single create call), `metadata.mimeType` (default from file extension, `.wav` → `audio/wav`), `metadata.durationSeconds`.
- Operation routing: `options.operation` ∈ `publish` (default) | `list` | `get` | `update` | `delete` | `validate`; `options.itemId` required for get/update/delete.

**Anti-patterns (do not):**

- Do not shell out to `wrangler` or `@microfeed/cli`; direct `fetch` only.
- Do not invent a config file or plugin.json fields for secrets — env-only (`plugins.publishings.podcast-pub.env` in user config; real env wins).
- Do not transcode or probe audio; metadata carries what the caller knows.
- Do not add zod schemas duplicating microfeed's — validate only what the plugin itself requires (title resolvable, audio reference present), let the API's `validate` endpoint/server reject the rest (R4 surfaces it).
- Do not swallow HTTP errors into `ok: true`.

**Publish sequence (D2, the only legal order):** create item `status:"unpublished"` without attachment → presign with `item_id` → PUT bytes → `PUT /items/{id}` with `attachments:[…]` + `status:"published"` → `Result{ok:true, url}`. With `metadata.audioUrl`: single `POST /items` with attachment, `published`.

**Handoff:** assumes nothing from 0084 at build/test time (offline fakes); 0086 consumes the built plugin + 0084's credentials for the live smoke. Leaves 0086 a fixture-friendly `publish` path and `get`/`delete` ops for cleanup.

### Plan

- [ ] 1. Scaffold `plugins/publishings/podcast-pub/` per `docs/design/publish-plugin-specification.md`: `plugin.json`, `package.json`, `tsconfig.json` (mirror qiita-pub).
- [ ] 2. `src/microfeed-client.ts` — Bearer REST client: items create/get/update/delete, feed list, validate, presigned-upload + PUT bytes; timeout from `MICROFEED_TIMEOUT_MS`; every 4xx/5xx → thrown diagnostic (never silent).
- [ ] 3. `src/map.ts` — Content+metadata → item input; local validation of plugin-level requirements (title, audio reference) before any call.
- [ ] 4. `src/index.ts` — `PublishTransport` impl: operation routing, two-phase publish sequence, Idempotency-Key per attempt, `Result` shaping per spec §2.5 (exit 0 ok / exit 1 with `ok:false` + stderr).
- [ ] 5. `tests/` — FakeFileCliTransport-based: publish happy path (audioFile + audioUrl variants), each management op, API-error path, input-validation path. Verification intent: `bun run test` green with zero network.
- [ ] 6. `bun run lint` + `bun run test` green; plugin discoverable via `kk plugin status` (or executor list).

### Solution

**Commit:** `c6c5e8b feat(publishings): add podcast-pub publish plugin for microfeed (task 0085)`

- `plugins/publishings/podcast-pub/plugin.json:1`, `package.json:1`, `tsconfig.json:1` — scaffold mirroring qiita-pub (kind `publish`, `@gobing-ai/podcast-pub`, same dep set, no new third-party deps).
- `src/map.ts:51` `mapContentToEpisode` — D6 mapping: title ← `content.title` else first `#` heading; `content_html` ← body verbatim; `status` ← `metadata.status` default `published`; audio ← `metadata.audioUrl` (hosted) or `metadata.audioFile` (local); `src/map.ts:35` `resolveAudioMimeType` — `metadata.mimeType` else extension table (`.wav`→`audio/wav`); `durationSeconds` passthrough. Plugin-level validation only (title, exactly one audio ref, finite nonneg duration) — throws before any network (R5).
- `src/microfeed-client.ts:37` `MicrofeedClient` — D1 Bearer REST client pinned to `vendors/microfeed/src/server/api/handlers.ts` + `ApiSchemas.ts`: `createItem` (`src/microfeed-client.ts:91`, optional `Idempotency-Key`), get/update/delete, `GET /api/v1/feed`, `items/validate`, `prepareUpload` (`src/microfeed-client.ts:150`, presigned_urls), `uploadBytes` (`src/microfeed-client.ts:169`, raw-bytes PUT); `resolveTimeoutMs` (`src/microfeed-client.ts:29`, default 300000, 1s floor); every 4xx/5xx/non-JSON/transport fault → thrown diagnostic (R4).
- `src/index.ts:163` `PodcastPubTransport` (file-cli) — operation routing on `options.operation` (publish|list|get|update|delete|validate; D5); `src/index.ts:89` `publishEpisode` — D2 two-phase publish (draft `unpublished` → presign with `item_id` → PUT bytes → `PUT /items/{id}` with audio attachment + target status), `crypto.randomUUID()` Idempotency-Key per attempt (D3); `audioUrl` variant = single create with inline attachment; `src/index.ts:68` `audioAttachment` builds the RSS-enclosure shape; Result url = returned item url, falling back to `{base}/items/{id}`. CLI: `src/index.ts:288` `processPublishIO` (`--in` Content JSON with optional top-level `options` object → `--out` Result JSON), `src/index.ts:319` `main` exit 0 ok / exit 1 fail-loud with stderr (spec §2.5).
- `packages/kk-core/tests/registry.test.ts:201`, `:512` — added `podcast-pub` to the two shipped-plugin fixture lists (same convention zenn-pub/surfdash-pub follow).
- Verification: 24 offline tests in `tests/podcast-pub.test.ts:1` (mocked fetch + publish-harness `FakeFileCliTransport`, zero network) covering two-phase + hosted publish, all five management ops, 401/400/500/network-error paths, no-network validation rejections, CLI exit codes, runInvoke discovery; coverage ~94–100% per src file. `bun run lint` (biome + typecheck) and `bun run test` green repo-wide (494 pass / 0 fail).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
| ------------- | -------- | ---------- |
| R1 | MET | src/index.ts:89-146 two-phase publish (draft→presign item_id→PUT→attach+publish); index.ts:99 Idempotency-Key per attempt; index.ts:155-162 Result ok/target/url; handlers.ts:805 item_id pin |
| R2 | MET | src/index.ts:183-262 list/get/update/delete/validate routing; microfeed-client.ts:107-148 /api/v1/ endpoints; handlers.ts:740 items[0] feed shape |
| R3 | MET | tests/podcast-pub.test.ts 24/24 offline (mocked fetch + FakeFileCliTransport); explicit fetch-not-called asserts; plugin coverage 94-100% |
| R4 | MET | microfeed-client.ts:66-86 every 4xx/5xx/non-JSON/transport fault throws; index.ts:264 fail() Result; index.ts:339-343 stderr + exit 1 |
| R5 | MET | map.ts:60-85 title/audio-ref/duration validation pre-network; index.ts:91-95; zero-fetch asserts on rejection paths |

| Acceptance Criteria | Status | Evidence Type | Evidence |
| --------------------- | -------- | --------------- | ---------- |
| R3 | MET | test | tests/podcast-pub.test.ts publish two-phase (audioFile) + hosted (audioUrl) happy paths assert Result ok:true, target podcast-pub, url |
| R4 | MET | test | tests/podcast-pub.test.ts list/get/update/delete/validate operation tests assert endpoint calls + Result JSON |
| R5 | MET | test | tests/podcast-pub.test.ts full suite runs with mocked fetch + FakeFileCliTransport; zero network to real instance |
| R6 | MET | test | tests/podcast-pub.test.ts 401/400/500/network-error paths assert ok:false Result, stderr, exit 1 |
| R7 | MET | test | tests/podcast-pub.test.ts validation-rejection tests assert ok:false + exit 1 with zero fetch calls |

- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review
<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |

### References

- Feature: E6 (`docs/features/E6_microfeed-podcast-publisher.md`)
- Design satellite: `docs/design/podcast-pub.md` (D1–D8 authoritative)
- Publish kind contract: `docs/design/publish-plugin-specification.md`
- Structural reference: `plugins/publishings/qiita-pub/` (`src/index.ts`, `package.json`)
- Test harness: `packages/publish-harness/src/index.ts` (`FakeFileCliTransport`, `PublishTransport`)
- API contract: `vendors/microfeed/src/shared/ApiSchemas.ts`, `vendors/microfeed/src/server/api/handlers.ts`
- Depends on: nothing (offline). Depended on by: 0086 (live smoke).

### History

- 2026-09-02T22:00:13.471Z todo → wip (system)
- 2026-09-02T22:10:50.765Z wip → testing (system)
- 2026-09-02T22:17:02.422Z testing → done (system)
