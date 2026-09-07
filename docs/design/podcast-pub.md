# podcast-pub publish plugin (microfeed)

Feature **E6** (shipped). Publish plugin `plugins/publishings/podcast-pub/`
(`kind: publish`, `file-cli` transport) that publishes podcast episodes to a
self-hosted [microfeed](https://github.com/microfeed/microfeed) instance on
Cloudflare via its Bearer-authenticated `/api/v1/` REST API, plus thin item
management operations and pure show-notes rendering from a bare episode-plan
`Doc[]` input (§4.1). Companion setup: operator-deployed microfeed instance
(`npx @microfeed/cli manage`, interactive by design; out of automation scope).

> Chosen approach: direct REST transport (qiita-pub precedent). Rejected:
> wrapping `@microfeed/cli` (browser-granted interactive auth fights the
> env-only secrets contract); hosted podcast platforms (operator chose
> self-host); management-via-dashboard-only (drops a stated requirement).

Authority: publish contract `docs/design/publish-plugin-specification.md`;
microfeed API contract pinned to vendored source `vendors/microfeed` —
`src/shared/ApiSchemas.ts` + `src/server/api/handlers.ts`. No new ADR —
extends the E2/E4/E5 publish precedents; two-way door (delete the plugin dir).

---

## 1. Decisions

| ID | Choice | Rejected | Why |
| ---- | -------- | ---------- | ----- |
| D1 | Direct REST `/api/v1/` calls from the plugin process (`fetch` + `Authorization: Bearer mf_…`) — classified `file-cli` per ADR-008 (execution mechanism, not network usage) | `@microfeed/cli` child process; Playwright browser transport | CLI auth is interactive browser-granted; browser transport deferred per spec §2.2. qiita-pub already proves token-API `file-cli`. |
| D2 | Publish sequence: create draft item → prepare upload (`item_id` required for audio) → PUT bytes to presigned URL → PUT item with attachment + `published` | Prepare upload before item exists; single-call publish | `apiUploadInputSchema` requires `item_id` for non-image categories (`handlers.ts:prepareApiMediaUpload`). Two-phase is the only legal order. |
| D3 | Caller-supplied `Idempotency-Key` on item create (uuid per publish attempt) | No idempotency; kk-side dedup table | `createApiItem` implements 24h idempotent create (`apiIdempotencyKeySchema`). Free retry safety. |
| D4 | Config = `plugins.publishings.podcast-pub.env` in `~/.config/kk/config.yaml`: `MICROFEED_BASE_URL`, `MICROFEED_API_KEY` (+ optional `MICROFEED_TIMEOUT_MS`) | Config file fields outside env; hardcoded domain | Existing secrets channel (flag > env > config > default). Domain bind is a config edit — no code change when the custom domain lands. |
| D5 | Management ops inside the plugin via an `options.operation` field on the invoke payload: `list` (GET `/api/v1/feed`), `get`/`update`/`delete` (`/api/v1/items/{id}`), `validate` (`POST /api/v1/items/validate`) | Separate management CLI; dashboard-only | One plugin, one transport; thin wrappers over endpoints that already exist. |
| D6 | Content mapping: `title` → item `title`; `body` (markdown) → `content_html`; `metadata.audioUrl` **or** `metadata.audioFile` (local path) → attachment; `metadata.durationSeconds`, `metadata.mimeType`, `metadata.status` (`published` default) | New Content schema fields; WAV→MP3 transcode in plugin | kk-core schemas unchanged (scope). Transcode belongs to a generator/ffmpeg step, not publish. |
| D7 | Offline tests via `FakeFileCliTransport` fixtures; live smoke check is a manual gated step after deployment | Live-dependent CI tests | House precedent (E3–E5); CI must not depend on the operator's instance. |
| D8 | No ADR | ADR for "publish to microfeed" | Extends E2/E4/E5 precedent. Reversible. |

---

## 2. Module layout

```text
plugins/publishings/podcast-pub/
  plugin.json            # kind: publish, entry ./src/index.ts
  package.json           # @gobing-ai/podcast-pub
  src/index.ts           # PublishTransport impl: publish() + management ops + processPublishIO (Content | bare Doc[] array)
  src/microfeed-client.ts# Bearer REST client (items CRUD, feed list, validate, presigned upload)
  src/map.ts             # Content → apiItemInputSchema mapping
  src/show-notes.ts      # Show-notes markdown renderer (episode-plan Doc[] → markdown, 0095)
  tests/                 # FakeFileCliTransport-based, no network
docs/design/podcast-pub.md   # this satellite
```

No new Bun workspace beyond the plugin package. No change to `apps/cli`,
kk-core schemas, or sibling plugins.

**Deletion test:** remove the plugin dir + config section + this doc; E2–E5
plugins, the executor, and voice-gen still work. The only lost capability is
"Content + audio → published microfeed episode".

## 3. microfeed API contract (pinned to `vendors/microfeed`)

| Operation | Endpoint | Notes |
| --------- | -------- | ----- |
| Create item | `POST /api/v1/items` | Body `apiItemInputSchema`; optional `Idempotency-Key`; 201 → `{id}` |
| Validate item | `POST /api/v1/items/validate` | Same schema; 200 `{valid: true}` or 400 |
| Get item | `GET /api/v1/items/{itemId}` | JSON Feed item shape |
| Update item | `PUT /api/v1/items/{itemId}` | Body `apiItemInputSchema`; returns updated item |
| Delete item | `DELETE /api/v1/items/{itemId}` | 200 `{}` / 404 |
| List items | `GET /api/v1/feed` | JSON Feed document |
| Prepare upload | `POST /api/v1/media_files/presigned_urls` | Body `apiUploadInputSchema` (`category`, `full_local_file_path`, `item_id` required for audio, `size`, `type`); 201 → `{presigned_url, media_url}` |
| Upload bytes | `PUT <presigned_url>` | Same-origin; then persist `media_url` on the item |

Attachment (`apiAttachmentSchema`): `category: "audio"`, `url` (the returned
`media_url`), optional `mime_type`, `size_in_bytes`, `duration_in_seconds`.
This becomes the RSS enclosure / JSON Feed `attachments[0]`.

Auth: every request carries `Authorization: Bearer $MICROFEED_API_KEY`; API
access must be enabled in the dashboard and the key needs write scope.
Error shape: `{error: string}` with 4xx/5xx (see `apiErrorSchema`).

## 4. Publish sequence (D2)

```text
Content + metadata.audioFile
  → POST /items {title, content_html, status: "unpublished"}       (+ Idempotency-Key)
  → POST /media_files/presigned_urls {category: "audio", item_id, size, type, full_local_file_path}
  → PUT presigned_url (file bytes)
  → PUT /items/{id} {attachments: [{category: "audio", url: media_url, …}], status: "published"}
  → Result { ok: true, target: "podcast-pub", url: <item URL>, id }
```

Any step failure → `Result { ok: false, error }`, stderr log, exit 1
(spec §2.5). `metadata.audioUrl` (already-hosted audio) skips the middle two
steps and creates the published item in one call.

### 4.1 Show-notes array input (bare `Doc[]` `--in`, 0095)

A **bare JSON array** input selects the pure show-notes render — no microfeed
client, no credentials, no API call:

- `--in`: episode-plan `Doc[]` array (the `2-plan/plan.json` shape). The
  publish kind contract is the two-form union `Content | Doc[]` (0100), so
  executor pre-validation passes this form through to the plugin entry.
- Options come from `PODCAST_PUB_TITLE` and `PODCAST_PUB_RUN_DATE` env (or
  `options.title` / `options.runDate` on the transport payload); both are
  required — missing either fails loud.
- `--out`: the rendered markdown file itself (not a `Result` JSON).
- Render failure: fail-loud `Result { ok: false, error }` written to `--out`,
  then reject (non-zero exit), matching the Content path.

Usage (workflow show-notes state):

```sh
PODCAST_PUB_TITLE="…" PODCAST_PUB_RUN_DATE="2026-09-07" \
  kk executor run podcast-pub --in "$WORK/2-plan/plan.json" --out "$WORK/3-publish/show-notes.md"
```

## 5. Config surface (D4)

```yaml
plugins:
  publishings:
    podcast-pub:
      env:
        MICROFEED_BASE_URL: ""   # e.g. https://<instance>.workers.dev; custom domain later
        MICROFEED_API_KEY:  ""   # mf_… named key, write scope
        MICROFEED_TIMEOUT_MS: "300000"  # optional; large audio uploads
```

## 6. Verification

- Unit: mapping (Content → item input), error paths (R6/R7), idempotency key
  plumbing, management op routing — all against the fake transport.
- Live (manual, post-deploy): `plugin status`-style smoke — validate a draft
  item, publish a fixture episode, confirm it appears in `/json/`.

## 7. Risks

- **API drift**: contract pinned to vendored source; deployed instance version
  may differ → live smoke step validates before first real publish.
- **Large uploads**: presigned PUT streams the file; timeout configurable (D4).
- **Manual prerequisites**: API enablement + key creation are dashboard steps —
  captured as deployment-task AC, not code.
