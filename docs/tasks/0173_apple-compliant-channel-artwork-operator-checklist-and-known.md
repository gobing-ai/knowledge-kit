---
schema_version: 1
name: Apple-compliant channel artwork, operator checklist, and known microfeed gaps
status: wip
template: meta
created_at: 2026-09-25T23:01:10.935Z
updated_at: "2026-09-26T03:38:44.385Z"
feature_id: E61
priority: P1
tags:
  - podcast-pub
  - apple-podcasts
  - docs
estimate_hours: 2

---

## 0173. Apple-compliant channel artwork, operator checklist, and known microfeed gaps

### Background

Implements: R5 — Channel artwork file meets the Apple artwork spec; R6 — Operator checklist covers the channel settings the microfeed API cannot write; R7 — Episode author and full description gaps are recorded, not silently dropped.

The live feed has no channel `<description>`, no `<itunes:owner>`, one category, and a 1024² PNG artwork served under a `.jpeg` name (771 KB). kk's client (`podcast-pub/src/microfeed-client.ts`) covers items, media uploads, and feed read; microfeed itself also exposes `PUT /api/v1/channels/primary` (`vendors/microfeed/src/pages/api/v1/channels/[channelId]/index.ts:1`), so channel settings can be applied via admin UI or that API — kk does not automate them (one-off). `<itunes:owner>` renders only when `_microfeed["itunes:email"]` is set (`vendors/microfeed/src/server/feed/FeedPublicRssBuilder.ts:176`).

**Refine corrections (2026-09-25)**

- "microfeed API cannot write channel settings" (design D4 / E61 R6 wording) → false: `PUT /api/v1/channels/primary` exists (`vendors/microfeed/src/pages/api/v1/channels/[channelId]/index.ts:1`, schema `src/shared/ApiSchemas.ts:378`) → kept the operator checklist, documented the API as an alternative (E61 R6 title kept as identity key).
- "owner name missing" → root cause: `<itunes:owner>` only renders when `_microfeed["itunes:email"]` is set (`FeedPublicRssBuilder.ts:176`) → checklist requires the email.
- Verified: categories come from `_microfeed.categories` (`FeedPublicRssBuilder.ts:196`); items emit only `description` from `content_html` (`:34`); `sips` already used (`plugins/kk/scripts/kk-workflow-stages.ts:975`); the presign schema has optional `item_id` (`ApiSchemas.ts:399`).

### Requirements

- [x] R1. Produce a square RGB JPEG 1400–3000 px per side, `.jpg` extension, ≤ 512 KB (or a size the operator accepts), from the current channel image via `sips`; store it at `docs/design/assets/podcast-channel-artwork-1400.jpg`.
- [x] R2. Add `## 8. Apple Podcasts compliance` to `docs/design/podcast-pub.md`: what microfeed already satisfies; the channel checklist (description; owner email — `<itunes:owner>` renders only when `itunes:email` is set, `vendors/microfeed/src/server/feed/FeedPublicRssBuilder.ts:176`; author name; category + subcategory, up to three; artwork upload with a correct extension); verification via castfeedvalidator.
- [x] R3. The checklist names both application paths: microfeed admin UI, or `PUT /api/v1/channels/primary` (`apiChannelInputSchema`, `vendors/microfeed/src/shared/ApiSchemas.ts:378`) plus a channel-image presign without `item_id`.
- [x] R4. Record known microfeed-template gaps — item itunes:author and content:encoded (the item builder emits only `description` from `content_html`, `FeedPublicRssBuilder.ts:34`), feed ETag/Last-Modified/Content-Length, the Cloudflare notice, subscribe links — with the upgrade path (microfeed fork / post-approval).
- [ ] R5. After the operator applies the settings, the live feed emits channel `description`, `itunes:owner` (email + name), and the new artwork URL.

Out of scope: a kk channel-update operation; forking microfeed; changing the Worker's HTTP headers; subscribe links (post-approval).

### Acceptance Criteria

- [x] AC1 — Channel artwork file meets the Apple artwork spec (req: R1)
- [ ] AC2 — Operator checklist covers the channel settings the microfeed API cannot write (req: R2, R3, R5)
- [x] AC3 — Episode author and full description gaps are recorded, not silently dropped (req: R4)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-25T23:03:58.235Z

- Q: Does microfeed have a channel write API? A: Yes — `PUT /api/v1/channels/primary` (verified in vendored source after design approval). Kept the operator checklist as primary path; API documented as alternative; no kk automation (one-off).
- Q: Why no itunes:owner today? A: microfeed emits it only when `_microfeed["itunes:email"]` is set — the checklist must include the email.
- Q: Artwork size target? A: 1400² RGB JPEG ≤ 512 KB via sips; regenerate at 3000² only if the upscale looks soft.

#### Q&A entry — 2026-09-25T23:10:33.428Z

- Q: Where does the artwork asset live? A: `docs/design/assets/podcast-channel-artwork-1400.jpg` (closed).

### Design

Chosen: `sips -s format jpeg -s formatOptions <q> -z 1400 1400` resample of the current channel image (no new tool; sips is already used at `plugins/kk/scripts/kk-workflow-stages.ts:975`), plus a new § 8 in `docs/design/podcast-pub.md`. The operator applies artwork + channel settings via the microfeed admin UI, or one `PUT /api/v1/channels/primary` call (optional, documented in the checklist).
Frozen names: asset `docs/design/assets/podcast-channel-artwork-1400.jpg`; section `## 8. Apple Podcasts compliance`.
Rejected: native 3000² regeneration via image-gen (costlier, style drift; revisit if the upscale looks soft); a kk/podcast-pub `channel-update` operation (one-off settings; add if a second show needs it); a microfeed fork (maintenance burden).
Invariants: no secrets (API key, owner email value) in docs; the checklist names the fields, not the values.
Dependencies: none; independent of 0170–0172.

### Plan

1. Fetch the current channel image (URL from the live RSS `itunes:image`); resample to a 1400² RGB JPEG, tuning quality to ≤ 512 KB; verify with `sips -g all` (R1).
2. Write § 8 in `docs/design/podcast-pub.md`: what microfeed satisfies, the checklist with both paths, known gaps (R2, R3, R4).
3. Hand the checklist to the operator; after they apply it, `curl` the live RSS for channel description / itunes:owner / artwork and run castfeedvalidator (no ERROR/FATAL) → Testing (R5).

### Root Cause

<!-- For issue/bug tasks: the verified underlying cause, with a `file:line` anchor. -->

### Solution

Change map (`file:line` per table row; R1–R4 — R5 is operator-gated and has no code path):

| file:line | Change |
| --- | --- |
| `docs/design/assets/podcast-channel-artwork-1400.jpg` (binary asset — no line anchor) | R1: new 1400×1400 RGB JPEG, no alpha, sRGB, 179,427 bytes (cap 512 KB), produced by `sips -s format jpeg -s formatOptions 90 -z 1400 1400` from the live channel image; replaces the 1024² PNG (771,672 bytes) that is served under a `.jpeg` URL |
| `docs/design/podcast-pub.md:172` | R2: new `## 8. Apple Podcasts compliance` heading + framing that channel settings are not automated by kk (no `channel-update` operation, §1 D5) |
| `docs/design/podcast-pub.md:182` | R1: §8.1 artwork spec — asset path, the exact `sips` command, Apple's constraints, and the non-compliant live artwork it replaces |
| `docs/design/podcast-pub.md:204` | R2: §8.2 what microfeed already satisfies, one emitting `file:line` per element |
| `docs/design/podcast-pub.md:215` | R2/R3: §8.3 operator checklist (description, owner email + name, author, categories up to three, artwork upload) with path A = microfeed admin UI and path B = `PUT /api/v1/channels/primary` plus a channel-image presign without `item_id` |
| `docs/design/podcast-pub.md:304` | R2: §8.4 verification after applying the checklist (`curl` the live RSS/JSON for description/owner/artwork; castfeedvalidator) |
| `docs/design/podcast-pub.md:339` | R4: §8.5 known microfeed-template gaps — item `itunes:author`, item `content:encoded`, feed `ETag`/`Last-Modified`/`Content-Length`, Cloudflare fronting, subscribe links — each with its upgrade path, plus the pointer to the E61 Notes residual (2026-09-24 `audio/wav` item) |

Rationale:

- Artwork is a pure resample: `sips` is already used by the pipeline (`plugins/kk/scripts/kk-workflow-stages.ts:975`), so no new tool and no image-gen regeneration (design-rejected: costlier, style drift).
- R3 nuance verified in the vendored source while implementing: `PUT /api/v1/channels/primary` covers `description`, `authors[0].name` (→ channel `publisher`) and `_microfeed["itunes:email"]` (`FeedCrudManager.ts:114-158`; `upsertChannel` shallow-merges at `FeedCrudManager.ts:206`) but cannot carry `categories` — `apiChannelInputSchema` has no such field (`src/shared/ApiSchemas.ts:378`). Categories therefore stay admin-UI-only (§8.3, up to three, `EditChannelApp/index.tsx:247`), so the checklist does not present the API as a complete substitute.
- Doc anchors are `vendors/microfeed/`-relative (declared in §8's lead-in) and every one was re-resolved against the vendored source after this fix (40/40 resolve).
- No secrets: §8.3 names the fields (owner email, key) and never a value.
- R5 not attempted: no live microfeed write, channel update, or artwork upload was made (no `MICROFEED_*` credentials in this environment; channel settings are an operator action). R5 and AC2 stay unticked.

### Testing

<!-- Filled during verification: commands/checks run, outcomes, coverage claim or N/A. -->

### Review

Read-only re-review of the 0173 change set after the bounded `test-fix` hop: `docs/design/podcast-pub.md` §8 (the fix target), the new asset `docs/design/assets/podcast-channel-artwork-1400.jpg`, and the task file. Nothing was modified by this pass; no live microfeed write, channel update, upload, or fork. `file:line` anchors were resolved against `/Users/robin/xprojects/knowledge-kit/vendors/microfeed@ddcb04c` (`vendors/` is gitignored and absent from this worktree; §8 declares the vendored tree as its authority, §3). Evidence: read-only `curl` of the live RSS/JSON and the live artwork URL, the §8.4 fence executed verbatim against the live feed and against two synthetic local feeds, `file` / `sips -g all` / `stat` on the asset, and re-reads of the vendored microfeed source.

**Findings**

| Priority | Finding | Location |
| --- | --- | --- |
| P2 (major) | §8.3's primary artwork path (microfeed admin UI) cannot produce a compliant artwork: the admin image uploader re-encodes every cropped channel image to PNG and sends that blob's type to the presign, so the artwork lands under a `.jpg` key served `content-type: image/png` — the exact extension/content-type mismatch §8.1 exists to fix. The cropper output is forced PNG (`src/components/admin/shared/AdminImageUploaderApp/index.tsx:248` `cropper.getCroppedCanvas().toBlob(...)`, `:291` `}, 'image/png');`), the stored key keeps the selected file's extension (`:220` `const {name, type} = file;`, `:227` `cdnFilename = images/channel-<hex>.<ext>`), and `Requests.upload(blob, cdnFilename, ...)` (`:256`) posts `{size, key, type}` where `type` is the blob's type, i.e. `image/png` (`src/client/requests.ts:20-26` -> `src/pages/[adminPath]/ajax/r2-ops.ts:22-24` -> `src/server/media/uploads.ts:85`, `:101`, `:112` -> `src/pages/media-upload/[...key].ts:52`); the parent's `contentType: file.type` state is dead (set at `:234`, read nowhere) and `EditChannelApp` discards the value it does receive (`_contentType`). The live instance corroborates the mechanism: its artwork key is `images/channel-<32hex>.jpeg` — the admin uploader's key shape, not the API's `images/item-<32hex>.<ext>` (`src/server/api/handlers.ts:812-816`) — and it serves `content-type: image/png` over PNG bytes. Consequences: §8.3's Artwork row (`docs/design/podcast-pub.md:229`, "the uploaded file must keep a `.jpg` extension") steers the operator into that mismatch; §8.4's artwork assertion (`:320`, "must print: content-type: image/jpeg") and its `endswith(".jpg")` image check cannot pass via path A; and the unguarded PNG re-encode puts the 512 KB cap at risk (no byte-size check — `isInvalidImage()` is a stub returning null, `AdminImageUploaderApp/index.tsx:72-81`). Fix options: route the channel-artwork upload through path B only (path B now sends `type: image/jpeg` and stores the JPEG unchanged), or document the PNG re-encode and require a `.png` file name plus a PNG-aware size check — either way §8.4's type/extension expectations must match the chosen path. This contradicts the previous pass's premise that path A was unaffected. | `docs/design/podcast-pub.md:229` |
| P4 (advisory) | The task file's Solution change-map lines are now stale: the fix inserted lines inside §8, so `199` / `210` / `263` / `276` no longer point at §8.2 / §8.3 / §8.4 / §8.5 (actual: 204 / 215 / 297 / 329); `172` and `182` still match. Traceability-only — the doc itself is correct, but the previous pass's "change-map lines match the file exactly" invariant no longer holds. | `docs/tasks/0173_apple-compliant-channel-artwork-operator-checklist-and-known.md:91` |

**Prior findings — resolution status**

| Prior finding | Status | Evidence |
| --- | --- | --- |
| P2 — path-B presign lacked the field that sets the served Content-Type | RESOLVED | The presign body now carries `"type":"image/jpeg"` (`docs/design/podcast-pub.md:279`), the mechanism paragraph (`:285-295`) is accurate against the source — `src/server/media/uploads.ts:85` slices `input.type` to 255 chars, `:101` binds it into `hmac(signingPayload(objectKey, expires, contentType, size))`, `:112` sets the URL's `content-type` param only when non-empty, `src/pages/media-upload/[...key].ts:52` stores `httpMetadata: contentType ? {contentType} : request.headers`, `src/server/api/handlers.ts:809-816` derives only the key's extension — and §8.4 now asserts the served type (`:320`). Executed live, that line prints `content-type: image/png` for today's artwork (the failure it targets) and `image/jpeg` for the compliant synthetic feed. |
| P3 — "a supplied `_microfeed` object replaces the current one wholesale" was false | RESOLVED | `docs/design/podcast-pub.md:258-267` now describes the fixed sub-key extraction plus shallow merge: `_publicToInternalSchemaForChannel` (`src/server/feed/FeedCrudManager.ts:114-158`) maps `description`, `authors[0].name` and the six named sub-keys (`:140-157` = `itunes:explicit`, `itunes:title`, `itunes:block`, `itunes:type`, `copyright`, `itunes:email`) into flat internal fields, and `upsertChannel` does `{...this.feedContent.channel, ...mapped}` (`:205-208`). "`categories` is never mapped" matches `apiChannelInputSchema` (`src/shared/ApiSchemas.ts:378-388`, no such field). No trace of the false wholesale-replace claim remains. |
| P3 — §8.4's grep could not prove a non-empty channel description nor distinguish channel from item | RESOLVED | Replaced by an ElementTree parse rooted at `find("channel")` (`docs/design/podcast-pub.md:302-312`), with the owner and image checks scoped to that element. Executed verbatim three ways: the live feed reports `MISSING or EMPTY` for description/owner/image (matching the live state); a synthetic compliant feed reports `OK (49 chars)` + `OK` + `OK`; a synthetic feed whose only `<description>` / `<itunes:image>` are item-level still reports `MISSING or EMPTY` for both channel checks. The replaced command is genuinely non-discriminating — reproduced on the live feed, `grep -oE '<description>[^<]*'` prints the item's `<description>`. |
| P3 — the `audio/wav` submission blocker was in §8.5 but absent from the §8.3 checklist | RESOLVED | §8.3 now carries the `Blocking pre-submission — episode enclosures` row (`:230`) plus a "Submit gate" note (`:232-234`) that points at §8.5 and states explicitly that the channel settings above do not clear it. |
| P4 — §8.1 upscale caveat | RESOLVED | `docs/design/podcast-pub.md:199-202` states the 1.37x upscale, that it interpolates and adds no real detail, and the preference for a native >=1400 px source. |
| P4 — "Apple reads the first category" was imprecise | RESOLVED | `:228` now reads "Apple recognises only the **first** category + subcategory" with an anchor to microfeed's own help text (`src/components/admin/channel/EditChannelApp/AdminHelpContent.ts:64` = "Apple Podcasts only recognizes the first category and subcategory"), so the claim is traceable rather than the doc's own paraphrase; the actionable "keep the primary pair first" rule stands. Advisory note only: microfeed's help text is a simplification (Apple accepts up to three and treats the first as primary), so the row's "one to three" requirement remains right. |
| P4 — `<itunes:email>` public visibility | RESOLVED | `:225` now says the address is published in the public RSS and to use one you are willing to expose. |

**New-defect hunt**

- Anchors: 35 distinct `file:line` anchors in §8, **35/35 resolve** against `vendors/microfeed@ddcb04c`, each on the intended construct. The newly added anchors were spot-checked at exact text — `AdminHelpContent.ts:64`; `FeedCrudManager.ts:114`, `:114-158`, `:140-157`, `:205-208`; `src/server/media/uploads.ts:85`, `:101`, `:112`; `src/pages/media-upload/[...key].ts:52`; `src/server/api/handlers.ts:746`, `:785`, `:809-816`; `EditChannelApp/index.tsx:192`, `:225`, `:247`, `:266`, `:323`. No stale anchor.
- §8.4 snippet: extracted verbatim and executed — FAILS on today's live non-compliant feed (three `MISSING or EMPTY` lines, `content-type: image/png`), PASSES on a synthetic compliant feed (three `OK` lines, `content-type: image/jpeg`), and correctly ignores item-level `<description>` / `<itunes:image>`. It runs and discriminates as claimed.
- `"size":179427` in the presign example is correct and exact: `stat -f '%z' docs/design/assets/podcast-channel-artwork-1400.jpg` = 179427, and the presign's `size` becomes a `FixedLengthStream` on the PUT (`[...key].ts:36-40`), so the pinned value must be exact — it is. Consistent with §8.1's "179,427 bytes".
- §4.2 (0170, same file): no contradiction. §8 does not restate the MIME allowlist; §8.3's blocking row concerns the already-published 2026-09-24 item (predates the guard) and §8.5's related residual defers to the E61 Notes. §3's "Prepare upload" row already lists `type` in the upload body, so the fixed path-B presign now matches §3 rather than diverging.
- Secrets: no key value and no owner-email value anywhere in §8 or the task file — only `${MICROFEED_BASE_URL}` / `$MICROFEED_API_KEY` env names and `…` placeholders. Field names only. Holds.

**Residual risk**

- R5/AC2 remain operator-gated by design and are not re-raised as findings: the live feed still has no channel `<description>`, no `<itunes:owner>`, and still serves the 1024x1024 PNG (`.jpeg` URL, `content-type: image/png`, 771,672 bytes), so §8.4's live lines and R5 stay red until the channel settings land.
- Anchors resolve against the gitignored vendored checkout at `ddcb04c` (v1.0.8) while the deployed instance reports microfeed 1.0.9; line anchors can drift with the deployed revision.
- castfeedvalidator was not run (no HTTP endpoint, no installable package); §8.4's validator step is certified as documented only.
- Until the P2 is fixed, an operator following §8.3 top-to-bottom uploads the JPEG through path A and reproduces the artwork mismatch; the artwork itself is a mechanically valid 1.37x upscale whose visual acceptance is not judgeable offline.

**Disposition: CHANGES REQUESTED** — all five previously reported findings are genuinely resolved, 35/35 anchors resolve, the §8.4 snippet runs and discriminates, and the secrets invariant holds, but the edit leaves §8.3 recommending an artwork path (admin UI) that re-encodes to PNG and therefore reproduces the very extension/content-type mismatch §8.1 documents and §8.4 asserts against (one P2), plus one P4 stale change-map note in the task file. Apply the P2 (route the artwork through path B, or document the PNG re-encode and adapt §8.4), refresh the P4 line numbers, and the task can close with R5/AC2 left to the operator.

### References

<!-- Links to docs, tasks, decisions, or external references. -->

### History

- 2026-09-26T03:16:32.256Z todo → wip (system)

