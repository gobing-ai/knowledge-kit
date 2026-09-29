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

- `--in`: episode-plan `Doc[]` array (the `21-plan/plan.json` shape). The
  generic publish kind is `Content → Result`; this array form reaches the
  entry only because `plugin.json` declares `operations["show-notes"]`
  (`doc-list` → `markdown`, 0110 I3). An undeclared publisher is rejected
  before spawn.
- Options come from `PODCAST_PUB_TITLE` and `PODCAST_PUB_RUN_DATE` env (or
  `options.title` / `options.runDate` on the transport payload); both are
  required — missing either fails loud. Optional: `PODCAST_PUB_ARTICLE_BASE_URL`,
  `PODCAST_PUB_BRIEF_MODE` (`true`/`1`), and `PODCAST_PUB_ARTICLE_POST_PATH`
  (0118 timeline layout; a non-empty postPath switches the footer to the
  published `<base>/<locale>/posts/<postSlug>` URL, empty ⇒ legacy fallback).
  The daily workflow passes the postPath from the surfdash publish result
  (`_14_publish-surfdash_result.json`, task 0137) — not the later merged
  `_17_publish_result.json`, which does not exist yet at show-notes time.
- `--out`: the rendered markdown file itself (not a `Result` JSON).
- Render failure: fail-loud `Result { ok: false, error }` written to `--out`,
  then reject (non-zero exit), matching the Content path.

Usage (workflow show-notes state):

```sh
PODCAST_PUB_TITLE="…" PODCAST_PUB_RUN_DATE="2026-09-07" \
  kk executor run podcast-pub --in "$WORK/21-plan/plan.json" --out "$WORK/31-publish/show-notes.md"
```

### 4.2 Apple Podcasts audio MIME guard (0170)

microfeed stores and serves whatever MIME it is handed, so the plugin refuses
an enclosure Apple Podcasts cannot ingest **before any network call** (no
create, no presign, no byte upload). The guard sits in `mapContentToEpisode`
(`src/map.ts`) on the resolved MIME — after a `metadata.mimeType` override — so
every Content-mapped path (publish, and `validate` without `options.item`) is
covered by one check and no override can bypass it:

- Accepted: `audio/mpeg`, `audio/x-m4a`, `audio/mp4`, `video/mp4`,
  `video/quicktime`, `video/x-m4v`.
- Error (R2): `unsupported audio MIME type "<type>" for Apple Podcasts: expected
  one of <list>` — surfaced by `publish` as `Invalid Content: …`.
- `.m4a` resolves to `audio/x-m4a` (was `audio/mp4`); `AUDIO_MIME_BY_EXTENSION`
  still describes what a file is — the allowlist decides what is publishable.

Out of scope (unchanged): transcoding or probing audio inside the plugin, and
`update`/`validate` calls that pass a raw `options.item` (caller-owned
passthrough).

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

## 8. Apple Podcasts compliance

Channel-level settings are **not automated** by kk: §1 D5 covers per-episode and
per-item operations only, and there is no `channel-update` operation (one-off
show setup; revisit if a second show needs it). This section is the operator's
action list for the channel + artwork Apple Podcasts requires, plus the
microfeed-template gaps that no channel setting can close. Every `file:line`
anchor below is relative to the vendored microfeed source `vendors/microfeed/`
(§3 authority).

### 8.1 Artwork (0173 R1)

`docs/design/assets/podcast-channel-artwork-1400.jpg` — 1400×1400, JPEG, RGB
(no alpha), sRGB, 72 dpi, **179,427 bytes** (cap 512 KB), resampled from the
live channel image (`<itunes:image>` of `https://podcast.salty.vip/rss/`) with:

```sh
sips -s format jpeg -s formatOptions 90 -z 1400 1400 <current-channel-image>.png \
  --out docs/design/assets/podcast-channel-artwork-1400.jpg
```

Apple requires a square JPEG or PNG, 1400–3000 px per side, RGB, extension
matching the content type, ≤ 512 KB (`sips -g all` reports `format: jpeg`,
`samplesPerPixel: 3`, `hasAlpha: no`, `space: RGB`). The live artwork this
replaces is a 1024² **PNG** (771,672 bytes, alpha channel) served under a
`.jpeg` URL — below the 1400 px floor and a content-type/extension mismatch.

The 1400² asset is a **1.37× upscale** of that 1024² source (1024 < 1400, so the
resample interpolates and adds no real detail; it clears Apple's pixel floor but
is not sharper than the original). A native ≥1400 px source is preferable if one
ever exists.

### 8.2 What microfeed already satisfies (no action)

| Apple requirement | Emitted by | Live value (`https://podcast.salty.vip/rss/`) |
| ------------------ | ---------- | --------------------------------------------- |
| Channel `<itunes:author>` | channel `publisher` → `authors[0].name` (`src/server/feed/FeedPublicRssBuilder.ts:158`) | `Robin Min` |
| Channel `<itunes:image>` + `<image>` | channel `icon` (`src/server/feed/FeedPublicRssBuilder.ts:161`) | compliant 1400×1400 JPEG; `.jpg` URL served as `image/jpeg` (verified 0173) |
| `<language>`, `<itunes:type>`, `<itunes:explicit>` | channel fields (`src/server/feed/FeedPublicRssBuilder.ts:102-105`) | `zh-cn`, `episodic`, `false` |
| `<copyright>` | `_microfeed.copyright` (`src/server/feed/FeedPublicRssBuilder.ts:171`) | `©2026` |
| `<itunes:category>` (one to three) | channel `categories`, `"Parent/Sub"` strings (`src/server/feed/FeedPublicRssBuilder.ts:196`, `src/server/feed/FeedPublicJsonBuilder.ts:128`) | `News` → `Tech News` |
| Per-episode `<title>`/`<guid>`/`<pubDate>`/`<itunes:explicit>` + shownotes | item builder (`src/server/feed/FeedPublicRssBuilder.ts:28-93`) | published items |

### 8.3 Operator checklist (channel settings)

Two application paths for the channel settings — the microfeed **admin UI**
(path A) or one **`PUT /api/v1/channels/primary`** call (path B). The artwork row
is the exception: only the API media upload below can produce it. Field values
below are the checklist; no secret value (API key, owner email address) is
recorded in this repo.

| Setting | Required value | Why |
| -------- | -------------- | --- |
| Description | show description, non-empty | Apple requires the channel `<description>`; configured and verified non-empty (34 chars) after 0173 (`src/server/feed/FeedPublicRssBuilder.ts:153`) |
| Owner email | `_microfeed["itunes:email"]` | `<itunes:owner>` renders **only** when it is set (`src/server/feed/FeedPublicRssBuilder.ts:176`); email and owner name are present in the live feed after 0173. This address is published in the public RSS — use one you are willing to expose |
| Owner name | channel `publisher` | becomes `<itunes:owner><itunes:name>`, copied from the channel `<itunes:author>` (`src/server/feed/FeedPublicRssBuilder.ts:180`); already `Robin Min` |
| Author | channel `publisher` | channel `<itunes:author>` (`src/server/feed/FeedPublicRssBuilder.ts:158`); already set |
| Categories | one to three `Parent/Sub` entries | `<itunes:category>` comes from channel `categories` (`src/server/feed/FeedPublicRssBuilder.ts:196`); `News / Tech News` already set; the admin UI accepts up to three (`src/components/admin/channel/EditChannelApp/index.tsx:247`), but Apple recognises only the **first** category + subcategory (`src/components/admin/channel/EditChannelApp/AdminHelpContent.ts:64`) — keep the primary pair first |
| Artwork upload | `docs/design/assets/podcast-channel-artwork-1400.jpg` — presign it with `"type":"image/jpeg"`, PUT the bytes, then use the returned `media_url` as the channel `icon` (API path below) | Applied via the API path in 0173; live `.jpg` artwork is served as `image/jpeg`. If replaced, keep the `.jpg` key extension and verify the served type (§8.4). Do **not** use the admin-UI channel image upload: its cropper re-encodes the cropped canvas to PNG (`src/components/admin/shared/AdminImageUploaderApp/index.tsx:248`, `src/components/admin/shared/AdminImageUploaderApp/index.tsx:291`) and presigns that blob's type (`src/client/requests.ts:20-25`) while the stored key keeps the selected file's extension (`src/components/admin/shared/AdminImageUploaderApp/index.tsx:220-233`), so the artwork is served `image/png` under a `.jpg` name — the exact mismatch §8.1 exists to fix — with no check on the re-encoded size against the 512 KB cap (`isInvalidImage()` is a stub, `src/components/admin/shared/AdminImageUploaderApp/index.tsx:72-80`) |
| **Blocking pre-submission** — episode enclosures | every published item serves an Apple-ingestible enclosure MIME; none is `audio/wav` | no channel setting fixes this. **Partly cleared 2026-09-27**: the newest item is now `每日 AI 资讯 — 2026-09-25`, `audio/mpeg`, a `.mp3` URL, 9,380,635 B, `itunes:duration 00:17:14` — the fixed daily path publishes MP3 by default since 0171, and the feed's newest item is compliant (run `05d2535a`). **Still blocking:** the 2026-09-24 item remains live serving a ~52 MB `audio/wav`, and this row's criterion is *every* item, so the feed must not be submitted until that item is deleted or republished as MP3 (the residual 0172 records but does not repair). Apply this row after the settings above, immediately before submitting |

**Submit gate.** The last row is not a channel setting — the settings above do not
clear it. Re-check it after applying them, immediately before submitting; §8.5 has
the detail.

**Path A — microfeed admin UI.** Channel settings expose description
(`src/components/admin/channel/EditChannelApp/index.tsx:266`), publisher
(`src/components/admin/channel/EditChannelApp/index.tsx:225`), `itunes:email`
(`src/components/admin/channel/EditChannelApp/index.tsx:323`) and categories
(`src/components/admin/channel/EditChannelApp/index.tsx:247`). The admin UI also
offers a channel image upload
(`src/components/admin/channel/EditChannelApp/index.tsx:192`), but **it cannot
produce a compliant artwork**: the uploader forces a PNG re-encode of the cropped
canvas (`src/components/admin/shared/AdminImageUploaderApp/index.tsx:291`), so the
object is served `image/png` whatever extension the selected file had — the mismatch
of §8.1, and the artwork row above therefore routes around it. Keep using path B's media
upload for any artwork replacement. Categories are
admin-only: `PUT /api/v1/channels/primary` has no `categories` field
(`apiChannelInputSchema`, `src/shared/ApiSchemas.ts:378`) and the public→internal channel
mapper copies a fixed field set that excludes categories
(`_publicToInternalSchemaForChannel`, `src/server/feed/FeedCrudManager.ts:114`).

**Path B — public API (optional).** One `PUT /api/v1/channels/primary` call
(`src/pages/api/v1/channels/[channelId]/index.ts:1` → `updateApiPrimaryChannel`,
`src/server/api/handlers.ts:746`) applies the settings `apiChannelInputSchema` covers:

```sh
curl -X PUT "$MICROFEED_BASE_URL/api/v1/channels/primary" \
  -H "Authorization: Bearer $MICROFEED_API_KEY" -H 'content-type: application/json' \
  -d '{"description":"…","authors":[{"name":"…"}],"_microfeed":{"itunes:email":"…"},"icon":"<media_url>"}'
```

`description`, `authors[0].name` and `_microfeed["itunes:email"]` map to the
internal channel (`src/server/feed/FeedCrudManager.ts:114-158`); `upsertChannel` then
shallow-merges that mapped set over the existing channel
(`src/server/feed/FeedCrudManager.ts:205-208`), so it is a partial update — every field
you omit keeps its current value. `_microfeed` is not stored as a blob either: the
mapper lifts only the named sub-keys it knows — `itunes:explicit`, `itunes:title`,
`itunes:block`, `itunes:type`, `copyright`, `itunes:email`
(`src/server/feed/FeedCrudManager.ts:140-157`) — and the same shallow merge applies, so
an omitted sub-key survives untouched. `categories` is never mapped, so this call
cannot change it. Categories must come from path A.

**Channel artwork — the route for the artwork row above** (path A's image upload
cannot produce it). This is a two-step media upload. Step 1 — request a
presigned URL with `category: "image"`, an explicit `type`, and **no** `item_id`
(optional — `item_id` is only required for item attachments, `apiUploadInputSchema`,
`src/shared/ApiSchemas.ts:390`, `src/shared/ApiSchemas.ts:399`; route
`src/pages/api/v1/media_files/presigned_urls/index.ts:1` → `prepareApiMediaUpload`,
`src/server/api/handlers.ts:785`):

```sh
curl -X POST "$MICROFEED_BASE_URL/api/v1/media_files/presigned_urls" \
  -H "Authorization: Bearer $MICROFEED_API_KEY" -H 'content-type: application/json' \
  -d '{"category":"image","full_local_file_path":"podcast-channel-artwork-1400.jpg","size":179427,"type":"image/jpeg"}'
```

Step 2 — PUT the JPEG bytes to the returned `presigned_url`, then pass the returned
`media_url` as the channel `icon` (it must be a URL, `src/shared/ApiSchemas.ts:385`).

**`type` decides the served Content-Type — the file extension does not.** The
`type` you send is bound into the upload signature and echoed as the presigned URL's
`content-type` query param (`src/server/media/uploads.ts:85`,
`src/server/media/uploads.ts:101`, `src/server/media/uploads.ts:112`), and the upload
route stores it as the object's R2 `httpMetadata.contentType`
(`src/pages/media-upload/[...key].ts:52`). `full_local_file_path` only supplies the
stored key's `.jpg` extension (`src/server/api/handlers.ts:809-816`). The two are
independent — before 0173 the live artwork was served `content-type: image/png` from a
`.jpeg` URL (§8.1). Omit `type` and the object falls back to the PUT request's own
headers (`src/pages/media-upload/[...key].ts:52`), reintroducing exactly that
mismatch — so send `"type":"image/jpeg"` and verify it in §8.4.

### 8.4 Verification after applying the checklist

```sh
# Channel-level: parse the <channel> element so an item's CDATA <description> or
# item <itunes:image> cannot stand in for the channel's (§8.3).
curl -s "$MICROFEED_BASE_URL/rss/" | python3 -c '
import sys, xml.etree.ElementTree as ET
NS = {"i": "http://www.itunes.com/dtds/podcast-1.0.dtd"}
ch = ET.fromstring(sys.stdin.buffer.read()).find("channel")
def ok(cond): return "OK" if cond else "MISSING or EMPTY -> fix via §8.3"
desc = (ch.findtext("description") or "").strip()
own, img = ch.find("i:owner", NS), ch.find("i:image", NS)
print("channel <description>:", "OK (%d chars)" % len(desc) if desc else "MISSING or EMPTY -> fix via §8.3")
print("<itunes:owner> email+name:", ok(own is not None and own.findtext("i:email", NS) and own.findtext("i:name", NS)))
print("<itunes:image> .jpg:", ok(img is not None and img.get("href", "").endswith(".jpg")))
# The §8.3 blocking row's criterion is the enclosure MIME, so assert it here too
# instead of leaving the submit gate to an eyeball check.
it = ch.find("item")
encl = it.find("enclosure") if it is not None else None
print("newest item <enclosure> type:", "OK (%s)" % encl.get("type") if (encl is not None and encl.get("type") == "audio/mpeg") else "MISSING or wrong -> fix via §8.3 blocking row")
print("newest item <enclosure> .mp3:", ok(encl is not None and encl.get("url", "").endswith(".mp3")))
'

# Channel description/icon as the public JSON feed exposes them.
curl -s "$MICROFEED_BASE_URL/json/" | grep -oE '"(description|icon)": *"[^"]*"'

# The artwork's served Content-Type comes from the presign `type`, not the URL
# extension (§8.3) — a `.jpeg` URL serving image/png is the failure this catches.
ARTWORK_URL=$(curl -s "$MICROFEED_BASE_URL/json/" | python3 -c 'import json,sys; print(json.load(sys.stdin)["icon"])')
curl -sI "$ARTWORK_URL" | grep -i '^content-type'   # must print: content-type: image/jpeg
```

Every line must report `OK` / a non-empty channel `<description>` /
`content-type: image/jpeg`; a `MISSING or EMPTY` line means the corresponding §8.3
step did not land. The two artwork lines are assertions on the §8.3 API upload: the
`endswith(".jpg")` check reads the stored key's extension and the `content-type`
check reads the presign `type`, so a PNG-re-encoded upload from path A passes the
first and fails the second. Then validate the feed at <https://castfeedvalidator.com> — no
ERROR/FATAL in its Feed/Artwork/Media sections (its warning/critical findings, if
any, are the template gaps of §8.5). That step is **browser-only**: castfeedvalidator
ships as a web UI whose form is a Jaxon AJAX RPC, with no installable package
(`pip3 download castfeedvalidator` → no matching distribution; `npm view
castfeedvalidator` → 404) and no documented API, so it cannot be scripted from here —
the operator runs it. The script above is the machine-checkable part of this gate;
treat a `MISSING or wrong` enclosure line as blocking even though the browser
validator could not be automated.

Last live verification (0173, 2026-09-27): description (34 chars), owner email/name,
`.jpg` artwork served as `image/jpeg` (179,427 B), and the newest episode's `.mp3`
`audio/mpeg` enclosure passed. The 2026-09-24 `audio/wav` item remains a submission
blocker; re-run this check after any channel or feed change and inspect every item before
submission.

### 8.5 Known microfeed-template gaps (0173 R4)

Recorded rather than silently dropped. Each needs a microfeed (or Cloudflare)
change, which is out of scope here — a microfeed fork is the upgrade path if
Apple or a validator turns one into a blocker.

| Gap | Evidence | Consequence | Upgrade path |
| ---- | -------- | ----------- | ------------ |
| Episode `<itunes:author>` | the item builder emits `title`, `guid`, `pubDate`, `itunes:explicit`, `description`, link, item image, enclosure and the `itunes:season`/`episode` tags — but no author (`src/server/feed/FeedPublicRssBuilder.ts:28-93`) | every episode shows the channel author; per-episode hosts/guests cannot be expressed | microfeed fork (item builder); until then the channel `publisher` is the author of record |
| Episode `<content:encoded>` | shownotes land in `<description>` only, from `content_html` (`src/server/feed/FeedPublicRssBuilder.ts:34`) | players that render `content:encoded` fall back to the plain description | microfeed fork (same builder) |
| Feed `ETag` / `Last-Modified` / `Content-Length` | `rssFeedResponse` sets only `content-type: application/xml` (`src/server/feed/responses.ts:125-127`) | no conditional GET from the Worker; pollers re-download the feed | microfeed fork (Worker response headers) |
| Cloudflare in front of the feed | live response headers: `server: cloudflare`, `cf-cache-status: HIT`, `cache-control: no-cache`, `content-length` injected | caching/conditional-GET behaviour is Cloudflare's, not microfeed's — validators note the Cloudflare fronting | Cloudflare config / fork, not a channel setting |
| Subscribe links on the site | only the default `rss`/`json` subscribe methods are enabled (`/json/` → `_microfeed.subscribe_methods`) | no Apple Podcasts subscribe button | post-approval, once the Apple Podcasts URL exists |

Related residual, tracked in the E61 feature Notes rather than here: the
2026-09-24 item still serves a ~52 MB `audio/wav` enclosure. Apple requires
every episode to be playable, so submitting the feed with that item live would
likely fail review. See
`docs/features/E61_apple-podcasts-compliance-for-the-microfeed-podcast-feed.md`
→ Notes.
