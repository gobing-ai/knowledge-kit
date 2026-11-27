---
schema_version: 1
name: Add youtube-pub plugin for YouTube Shorts via YouTube Data API v3
status: done
template: feature-impl
created_at: 2026-11-26T19:50:42.664Z
updated_at: "2026-11-27T19:25:58.632Z"
feature_id: D9
priority: P1
tags:
  - M1
  - publish
  - youtube-pub
estimate_hours: 5

dependencies: ["0448", "0449"]
done_forced: "false"
done_reason: unforced close
---

## 0450. Add youtube-pub plugin for YouTube Shorts via YouTube Data API v3

### Background

Milestone 1 YouTube Shorts publisher plugin (ADR-060, docs/design/short-form-video-promotion.md §5.3). Uses the official YouTube Data API v3 resumable upload endpoint with OAuth2 refresh-token auth instead of browser automation.

Implements: R11 — YouTube Shorts publisher uploads via YouTube Data API v3 with private-first safety; R12 — Invalid video inputs or missing credentials fail closed before expensive execution.

**Refine corrections (2026-11-26)** — `/sp:dev-refine --all --feature D9 --auto --depth ready`
- "src/transport.ts implementing YouTubeUploadTransport" invents a seam. `@gobing-ai/publish-harness` is a **browser** harness (bot, browser, profile-lease) with no HTTP transport type (`packages/publish-harness/src/`). API publishers implement a plugin-local class over `fetch` with an injectable fetch, a per-request timeout and token redaction (`plugins/publishings/threads-pub/src/index.ts:11,46,189-275`). → The design is frozen on that pattern. "FakeYouTubeTransport" becomes an injected `fetchImpl` fake.
- Daily-path wiring was missing. 0449 introduces `buildVideoVariant`, the `video@<plugin>` variants and preset rows. → R6 adds `video@youtube-pub` + a `mode: off` preset row, and the dependency is now 0449 as well as 0448.
- Private-first is also enforced server-side: videos.insert from unverified API projects (created after 2020-07-28) is restricted to private (https://developers.google.com/youtube/v3/docs/videos/insert). → Q&A records that a public upload needs a Google-audited project. The plugin still defaults to private.
- Credentials live in `~/.config/kk/youtube-oauth.json`, which is consistent with ADR-042 (mission-critical config only). Mode `0600` is enforced on read, the same as other kk secrets.
- Live verification uploads to YouTube, which is an external action. → The Plan step needs explicit operator go-ahead and a private upload only.

### Requirements

- [x] R1. `plugins/publishings/youtube-pub/` (`plugin.json` `kind: publish`, `package.json` `@gobing-ai/youtube-pub`, `tsconfig.json`, `src/index.ts`, `src/youtube-client.ts`) implements `kk publish` `--in <Content> --out <Result>`.
- [x] R2. `YouTubeClient` refreshes an OAuth2 access token (`POST https://oauth2.googleapis.com/token`, `grant_type=refresh_token`) and uploads through the resumable `videos.insert` (`POST https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status`, then a `PUT` of the bytes to the returned `Location`). Credentials come from `KK_YOUTUBE_CLIENT_ID`/`KK_YOUTUBE_CLIENT_SECRET`/`KK_YOUTUBE_REFRESH_TOKEN`, else `~/.config/kk/youtube-oauth.json` `{client_id, client_secret, refresh_token}`.
- [x] R3. The following are each refused with an actionable `Result{ok:false}` and **zero** fetch calls: Content not `videoGenContentSchema`-valid; `height <= width`; `durationSec > 180`; `videoPath` unreadable or not `.mp4`; missing credentials; credentials file wider than 0600.
- [x] R4. `snippet.title` comes from Content.title (≤100 chars) and `snippet.description` from body plus `#Shorts`. `snippet.tags` comes from metadata.tags. `status.privacyStatus` is `"private"` unless `options.privacyStatus` ∈ {`unlisted`,`public`}, and `selfDeclaredMadeForKids: false`. On success it returns `ResultSchema` `{ok:true, target:'youtube-pub', id:<videoId>, url:'https://youtube.com/shorts/<videoId>'}`.
- [x] R5. Tokens and refresh secrets never appear in Result, stderr or thrown messages (`redact`). Each fetch has a timeout: token 30s; upload scales with file size, minimum 10 min.
- [x] R6. `dailyBundleVariants` writes `video@youtube-pub` using 0449's `buildVideoVariant`. `daily-ai-voice.json` gets a `youtube-pub` row with `variant: video@youtube-pub`, `mode: "off"` and `required: false`.

**Out of scope:** the OAuth consent/bootstrap flow (the operator obtains the refresh token once, documented in README); thumbnails (`thumbnails.set`); playlists; analytics; scheduled publishing; enabling the preset row.

### Acceptance Criteria

- [x] AC1 — YouTube Shorts publisher uploads via YouTube Data API v3 with private-first safety (req: R1, R2, R4, R5, R6)
  - Observed by `plugins/publishings/youtube-pub/tests/youtube-pub.test.ts` with an injected fake `fetchImpl` that records requests. Assert the token refresh, then the resumable init body (`privacyStatus: 'private'`, `#Shorts` in the description), then the PUT to `Location`. The Result URL is `https://youtube.com/shorts/<id>`. No secret substring appears in the Result or the logs. The daily-stages variants test covers `video@youtube-pub`.
- [x] AC2 — Invalid video inputs or missing credentials fail closed before expensive execution (req: R3)
  - Observed by the same suite: each R3 refusal case returns `ok:false` with a named reason, and the fake fetch records zero calls.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-26T23:17:04.744Z

- **Shared HTTP transport in publish-harness?** Closed: no. One implementation is not an abstraction. Use a plugin-local client with an injected `fetchImpl`, as threads-pub does.
- **Probe the MP4 with ffprobe or trust the metadata?** Closed: trust `videoGenContentSchema` metadata (`width`/`height`/`durationSec`) plus a file stat and extension check. No subprocess. video-gen's own ffprobe e2e (0448 AC2) owns the truth of those fields.
- **Public uploads?** Closed: private is the default. `public` additionally requires a Google-audited API project, or the API forces private anyway. That is out of scope.
- **Quota?** Closed: one upload per daily run at most. Check the current `videos.insert` unit cost on https://developers.google.com/youtube/v3/determine_quota_cost before enabling the row. No retry loop on 403 `quotaExceeded`; fail with that reason.

### Design

**Frozen names.** Target `youtube-pub`. `class YouTubeClient { constructor(opts: { fetchImpl?: typeof fetch; env?; readFile? }) ; publish(content, options): Promise<Result> }`. Credentials loader: `loadYouTubeCredentials(env, home)`; the env vars win over the file. `redact(msg, secrets[])`. `export async function main(): Promise<number>` follows the threads-pub shape (`plugins/publishings/threads-pub/src/index.ts:337-346`).
- Upload body: the PUT streams `Bun.file(videoPath)` with `Content-Type: video/mp4`. Before that, the init request sends `X-Upload-Content-Length` and `X-Upload-Content-Type`.
- Variant (`daily-stages.ts`, via 0449 `buildVideoVariant(content, 'youtube-pub')`): the Content passes through unchanged and `options.privacyStatus` is omitted.

**Anti-patterns.** Do not add the `googleapis` SDK (a new heavy dependency for two HTTP calls). Do not use browser automation. Do not retry a non-idempotent init on a 5xx without a resumable-status check. Do not log the request headers. Do not write credentials anywhere.

**Sync.** Same as 0449: `bun scripts/bundle-plugins.ts`, then `tools:fresh`, then rsync after the daily-stages edit.

### Plan

0. Preconditions: 0448 (schema) and 0449 (`buildVideoVariant`) are done. For the live check only, the operator places `~/.config/kk/youtube-oauth.json` (0600).
1. R3: scaffold the plugin. Write the refusal tests first (each case asserts zero fetches), then the validation.
2. R2/R5: token refresh and the resumable upload against the fake fetch, plus redaction and timeout tests.
3. R4: snippet/status mapping and the Result URL tests.
4. R6: the variant and the preset row, plus the daily-stages test.
5. Gate: `bun run lint`, `bun run test` (exit 0, per-file 90%), `bun run build`, then the sync.
6. Live check, **only with the operator's explicit go-ahead**: one private upload of a 0448 fixture MP4 via `kk publish`. Record the video id in Testing (not the token).

### Solution

Adds the YouTube Shorts publisher on the official Data API v3 (design §5.3) and wires it into the
frozen bundle. No `googleapis` SDK, no browser: one refresh call plus one resumable upload.

**R1 — plugin** `plugins/publishings/youtube-pub/` (`plugin.json` `kind: publish` with a `video`
publishing profile — `draft → privacyStatus private`, `live → public`, title limit 100;
`package.json` `@gobing-ai/youtube-pub`; `tsconfig.json`; `src/index.ts`, `src/youtube-client.ts`,
`src/credentials.ts`; `README.md` documents the one-time OAuth bootstrap).
- `src/index.ts:20` `processPublishIO(input, output, options)` deletes a stale Result, parses the
  Content, delegates to the client and writes `ResultSchema` JSON either way (a refusal writes
  `ok:false` **and** throws so `kk publish` exits nonzero). `:52` `main(argv, options)` is the
  `--in/--out` entry; the options bag is the test seam.

**R2 — auth + upload** `src/youtube-client.ts`
- `:191` `accessToken` → `POST https://oauth2.googleapis.com/token` with
  `grant_type=refresh_token`, 30s deadline (`TOKEN_TIMEOUT_MS`).
- `:281` `initUpload` → `POST …/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status`
  with `X-Upload-Content-Length` / `X-Upload-Content-Type`, then `Location` from the response.
- `:319` `putBytes` → `PUT` of the MP4 bytes (`Content-Type: video/mp4`) with a deadline that scales
  with file size and never drops below 10 minutes (`uploadTimeoutMs` `:78`).
- Credentials: `src/credentials.ts:88` `loadYouTubeCredentials` — `KK_YOUTUBE_*` env wins, else
  `~/.config/kk/youtube-oauth.json` at mode 0600 (refused at any wider mode). This file is the
  plugin's single sanctioned `node:fs` site (exemption recorded in
  `.spur/rules/strict/runtime-boundaries.yaml`) because the ts-runtime seam exposes no permission
  bits; every other read uses the seam or `Bun.file`.

**R3 — fail-closed ladder** `src/youtube-client.ts:149` `validate` runs before the first fetch:
schema (via `videoGenContentSchema`), `height > width`, `durationSec <= 180`, `.mp4` extension, a
readable non-empty file; then the title ladder (`:241`, ≤100 chars) and credentials (`:247`). Each
refusal returns `Result{ok:false}` with a named reason and **zero** fetches.

**R4 — payload + Result** `:100` `buildUploadBody` (`snippet.title`, `snippet.description` =
body + `#Shorts` via `shortsDescription` `:84`, `snippet.tags` from `metadata.tags`,
`status.privacyStatus` private unless `options.privacyStatus ∈ {unlisted, public}`,
`selfDeclaredMadeForKids: false`); success returns `{ok:true, target:'youtube-pub', id,
url:'https://youtube.com/shorts/<id>'}` (`shortsUrl` `:91`).

**R5 — secrets + deadlines** `redact` (`credentials.ts:56`) strips the client secret and refresh
token (raw and percent-encoded) from every refusal; every fetch carries an `AbortSignal.timeout`.

**R6 — bundle wiring**
- `plugins/kk/scripts/daily-stages.ts:2821` `buildVideoVariant` now accepts `youtube-pub` and passes
  the video-gen Content through unchanged (privacy stays the client's private default; a frozen
  variant carries no `options` block), emitted at `:3227`.
- `plugins/kk/publish-presets/daily-ai-voice.json` gains `youtube-pub / video /
  video@youtube-pub` (tier 3, `overseas-rss`, `mode: "off"`, `required: false`).

**Evidence.** `plugins/publishings/youtube-pub/tests/youtube-pub.test.ts` — 19 cases over an injected
`fetchImpl` (token → init → PUT order, private-first body, `#Shorts`, Shorts URL, unlisted override,
unknown privacy refusal, HTTP refusals at all three steps, 403 `quotaExceeded` with one init call, no
secret in the Result, the full refusal ladder with zero fetches, credentials env/file/mode/JSON
edges, and the `--in/--out` + `main()` contract). `plugins/kk/tests/daily-video-variants-0449.test.ts`
covers the `video@youtube-pub` variant and its preset row.

**Not done.** The live private upload (Plan step 6) requires the operator's explicit go-ahead and a
real `~/.config/kk/youtube-oauth.json`; nothing in this task has touched YouTube.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | plugins/publishings/youtube-pub/tests/youtube-pub.test.ts:337 exercises the plugin input/output entry point. |
| R2 | MET | Private resumable token → init → PUT sequence and Result validated via fake fetch in plugins/publishings/youtube-pub/tests/youtube-pub.test.ts:104. |
| R3 | MET | Schema, media, credentials and an existing file that cannot be read all refuse before fetch in plugins/publishings/youtube-pub/tests/youtube-pub.test.ts:219. |
| R4 | MET | Private resumable token → init → PUT sequence and Result validated via fake fetch in plugins/publishings/youtube-pub/tests/youtube-pub.test.ts:104. |
| R5 | MET | plugins/publishings/youtube-pub/tests/youtube-pub.test.ts:177 exercises failure confidentiality and :316 checks the per-upload deadline helper. Server payloads are kept out of error messages. |
| R6 | MET | plugins/kk/tests/daily-video-variants-0449.test.ts:111 verifies the YouTube variant and the preset tests verify opt-in. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R11 — YouTube Shorts publisher uploads via YouTube Data API v3 with private-first safety | MET | test | Private resumable token → init → PUT sequence and Result validated via fake fetch in plugins/publishings/youtube-pub/tests/youtube-pub.test.ts:104. |
| R12 — Invalid video inputs or missing credentials fail closed before expensive execution | MET | test | Schema, media, credentials and an existing file that cannot be read all refuse before fetch in plugins/publishings/youtube-pub/tests/youtube-pub.test.ts:219. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | coverage | — | Coverage: focused verification exercised the affected paths. See the current gitignored verifier logs for command results. |

### References

- `docs/00_ADR.md` ADR-060; `docs/design/short-form-video-promotion.md`; feature `docs/features/D9_short-form-vertical-video-generation-and-three-channel-podcast-promotion.md`
- `plugins/publishings/threads-pub/src/index.ts` (API publisher pattern)
- https://developers.google.com/youtube/v3/docs/videos/insert
- https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol
- https://developers.google.com/youtube/v3/determine_quota_cost

### History

- 2026-11-27T09:32:16.925Z todo → wip (system)
- 2026-11-27T09:39:07.081Z wip → testing (system)
- 2026-11-27T09:39:08.065Z testing → done (system)

